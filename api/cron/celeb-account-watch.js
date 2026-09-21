/**
 * GET /api/cron/celeb-account-watch — 셀럽·브랜드 계정 자동 감시 (2026-08-23 신설)
 * vercel.json: 12,32,52 * * * * (20분 주기, celeb-brief 의 :00 과 어긋나게)
 *
 * 왜: 도메니코 "자동 감지로 바꿔라" (2026-08-23).
 * 기존 흐름은 도메니코가 인스타 링크를 텔레그램으로 보내야 시작됐다.
 * 이 크론은 감시 계정 목록(celeb_watch_accounts)을 business_discovery 로 폴링해
 * 새 게시물을 발견하면 **캡션이 담긴 알림 한 통**을 텔레그램으로 보낸다.
 *
 * 2026-09-18 변경 (도메니코): "기사는 내가 쓴다. 캡션 내용과 함께 새 소식만
 * 알려달라." → 브리프 적재를 걷어냈다. 이 크론은 이제 **알리기만 한다**.
 * 브리프가 필요하면 종전대로 텔레그램에 인스타 링크를 보내면 된다
 * (그 경로는 celeb-brief 크론이 그대로 담당한다). **자동 발행 경로는 없다.**
 *
 * ── 07-20 스팸(144건 draft) 재발 방지 장치 ──────────────────────
 * ① 기준선: 계정 첫 폴링은 기존 게시물을 seen 에만 넣고 브리프를 만들지 않는다.
 * ② 신선도: 게시 24시간 이내 것만 적재한다 (놓친 옛 글이 몰려오지 않게).
 * ③ 상한: 한 실행에 브리프 최대 4건. 넘치면 seen 에 안 넣고 다음 실행에 잡는다.
 * ④ 중복: celeb_account_seen (username,shortcode) PK + 큐 (batch_key,shortcode)
 *    유니크 이중 방어.
 *
 * 계정 관리는 코드 배포 없이 DB 로: celeb_watch_accounts 에 행 추가/enabled 토글.
 * 잘못된 핸들(비공개·개인 계정)은 last_error 에 남아 목록에서 보인다.
 */

const { bearerOk } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard, reportProduction } = require('../_lib/cronGuard');
const { discoverAccount } = require('../_lib/igDiscovery');
const { discoverChannel } = require('../_lib/ytDiscovery');
const { collectSubPosts } = require('../_lib/igSubPosts');
const { sendTextToChatSafe } = require('../_lib/telegram');

const FRESH_MS = 24 * 3600 * 1000;   // ② 게시 24시간 이내만
/* ③ 실행당 판정 상한. 한 배치(NEWS_BATCH)와 같게 둬서 **AI 콜은 실행당 1회**다.
   왜 40 이 아니라 20 인가 — 실측: 계정 12개 폴링에 6.9초가 걸렸다(09-18 첫 실행).
   19개면 11초쯤이다. 함수 상한은 60초이고, 상한을 넘기면 플랫폼이 죽여서
   **크론이 자기 죽음을 기록조차 못 한다**. 11초 + AI 25초 = 36초로 여유를 남긴다.
   넘친 게시물은 seen 에 안 넣으므로 20분 뒤 다음 실행이 잡는다. */
const MAX_JUDGE = 20;
const MEDIA_PER_ACCOUNT = 5;
/* 한 실행에 폴링할 계정 수. 계정당 ~0.6초(실측) 이므로 20개 = 약 12초.
   AI 판정 25초를 더해도 37초로 60초 상한에 여유가 있다.
   이 값을 올리려면 MAX_JUDGE·AI 타임아웃과 함께 60초 예산을 다시 계산할 것. */
const POLL_PER_RUN = Math.max(1, Math.min(60, Number(process.env.CELEB_POLL_PER_RUN) || 20));

/* ── 뉴스 판정 게이트 (2026-09-18) ─────────────────────────────────────
 * 도메니코: "모든 게시물을 다 알려주는 게 아니라 뉴스가 될 만한 소식만
 * 골라서 주면 돼."
 *
 * 왜 규칙으로 못 거르나 — 09-01 에 이 감시를 껐던 이유가 여기 있다.
 * 아이돌 공식 계정은 컴백 티저와 멤버 셀카를 같은 모양으로 올린다.
 * 좋아요 수로도, 게시 유형으로도, 키워드 목록으로도 안 갈린다.
 * "이게 기사가 되나" 는 규칙이 아니라 판단이다. 그래서 celeb-classify 와
 * 같은 설계를 쓴다 — 한 배치를 한 콜로, 싼 모델로, 캡션만 보내고.
 *
 * 비용: 게시물 하나에 한 번만 묻는다. 판정이 끝나면 news 든 아니든
 * celeb_account_seen 에 남기므로 같은 게시물을 다시 묻지 않는다.
 *
 * 실패하면 **아무것도 안 보내고 seen 에도 안 남긴다.** 다음 실행에 다시
 * 묻는다. 반대로 하면(실패 시 전부 보내기) API 가 흔들릴 때마다 스팸이
 * 되고, 그건 09-01 에 이 기능을 죽인 바로 그 실패 방식이다.
 * 조용한 대신 note 에 이유를 적는다 — '돌았다 ≠ 했다'. */
const NEWS_MODEL = process.env.CELEB_NEWS_MODEL || 'claude-haiku-4-5-20251001';
const NEWS_BATCH = Math.max(1, Math.min(40, Number(process.env.CELEB_NEWS_BATCH) || 20));

const NEWS_SYSTEM = [
  '너는 K-POP 을 다루는 패션·컬쳐 매거진의 뉴스 데스크다.',
  '아이돌·셀럽의 인스타그램 게시물과 공식 유튜브 업로드를 보고',
  '**기사가 될 소식인지**만 판정한다.',
  '유튜브는 제목이 핵심 신호다 — [MV] · Official Teaser · Comeback Trailer ·',
  'Concept Film 은 뉴스, 브이로그 · 비하인드 · 챌린지 · 커버 · 리액션은 아니다.',
  '',
  '뉴스다 (news: true) — 밖에서 일어난 일, 날짜가 붙는 일, 처음 알려지는 일:',
  '  · 컴백·신곡·앨범·데뷔·타이틀곡 공개, 티저',
  '  · 투어·콘서트·팬미팅 일정 발표',
  '  · 브랜드 앰배서더 선정, 광고 캠페인, 협업',
  '  · 시상식·레드카펫·패션위크·공항 등 공식 석상',
  '  · 매거진 화보·커버',
  '  · 수상, 차트 기록, 판매 기록',
  '  · 열애·결혼·입대·전역·탈퇴·해체·재계약 같은 신상 변동',
  '  · 방송·드라마·영화 출연 확정',
  '',
  '뉴스가 아니다 (news: false) — 안에서 일어난 일, 날짜가 없는 일:',
  '  · 일상 셀카, 근황, 셀프 촬영',
  '  · 팬 인사, 생일 축하, 기념일 축하',
  '  · 이미 발표된 일정의 리마인드·재공지',
  '  · 무대 비하인드, 연습실 사진',
  '  · 멤버 개인 취미·반려동물·음식',
  '  · 캡션이 없거나 이모지뿐이라 무슨 일인지 알 수 없는 것',
  '',
  '애매하면 false 다. 도메니코 지시: "애매한 건 억지로 포함시키지 말고 그냥 빼줘."',
  '놓치는 것보다 시끄러운 쪽이 이 기능을 죽인다 (09-01 실측: 브리프 136건 → 발행 1건).',
  '',
  '출력은 JSON 배열만. 설명도 코드펜스도 쓰지 마라.',
  '[{"i":0,"news":true,"why":"컴백 티저 공개"},{"i":1,"news":false,"why":"일상 셀카"}]',
  'why 는 한국어 12자 이내. news 가 false 여도 why 를 적어라.',
].join('\n');

function buildNewsPrompt(rows) {
  const items = rows.map((r, i) => ({
    i,
    account: r.acc.label || r.acc.username,
    platform: r.acc.platform === 'youtube' ? '유튜브' : '인스타그램',
    type: r.acc.platform === 'youtube' ? '영상'
      : (TYPE_KO[String(r.m.type || '').toUpperCase()] || String(r.m.type || '')),
    likes: r.m.likes,
    comments: r.m.comments,
    caption: String(r.m.caption_head || '').replace(/\s+/g, ' ').trim(),
  }));
  return '다음 게시물들을 판정해라.\n' + JSON.stringify(items);
}

/** 판정 결과를 { [i]: {news, why} } 로. 못 읽으면 null (배치 통째로 버린다). */
function parseNewsVerdicts(text) {
  /* 공용 jsonRepair 를 쓴다 — 모델이 코드펜스·홑따옴표·꼬리 쉼표를 섞는 건
     이 저장소가 여러 번 겪은 일이고, 그 수리 규칙이 두 벌이 되면 안 된다. */
  const { parseJsonArray } = require('../_lib/jsonRepair');
  /* parseJsonArray 는 배열이 아니라 { value, repaired } 를 돌려준다.
     여기서 바로 배열로 받으면 항상 null 이 되어 게이트가 통째로 죽는다
     (테스트가 이 실수를 잡았다). */
  let arr = null;
  try { arr = (parseJsonArray(String(text || ''), 'celeb-news') || {}).value; }
  catch (_e) { arr = null; }
  if (!Array.isArray(arr)) return null;
  const out = {};
  for (const o of arr) {
    if (!o || !Number.isInteger(o.i) || typeof o.news !== 'boolean') continue;
    out[o.i] = { news: o.news, why: String(o.why || '').slice(0, 30) };
  }
  return Object.keys(out).length ? out : null;
}

async function judgeNews(rows) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'ANTHROPIC_API_KEY 미설정' };
  const merged = {};
  for (let i = 0; i < rows.length; i += NEWS_BATCH) {
    const chunk = rows.slice(i, i + NEWS_BATCH);
    let j;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: NEWS_MODEL, max_tokens: 2000,
          system: NEWS_SYSTEM,
          messages: [{ role: 'user', content: buildNewsPrompt(chunk) }],
        }),
        /* 45초가 아니라 25초다 — 위 MAX_JUDGE 주석의 60초 예산 계산과 한 몸이다.
           여기만 늘리면 함수가 통째로 죽고 아무 기록도 안 남는다. */
        signal: AbortSignal.timeout(25000),
      });
      j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, reason: 'AI 호출 실패 ' + r.status };
    } catch (e) {
      return { ok: false, reason: 'AI 호출 예외: ' + String((e && e.message) || e).slice(0, 80) };
    }
    const text = (j.content || []).map((c) => c.text || '').join('');
    const v = parseNewsVerdicts(text);
    if (!v) return { ok: false, reason: 'AI 응답을 못 읽었다' };
    for (const k of Object.keys(v)) merged[i + Number(k)] = v[k];
  }
  return { ok: true, verdicts: merged };
}

/* ── 알림 문구 (2026-09-18) ───────────────────────────────────────────
 * 도메니코: "기사는 내가 쓴다. 캡션 내용과 함께 새 소식만 알려달라."
 *
 * 왜 브리프를 뺐나 — 08-23~09-01 자동감시 9일 실측: 브리프 136건, 발행 1건.
 * 그동안 나는 "하루 14건이라 많아서 안 봤다" 고 설명했는데 **틀렸다.**
 * 같은 기간 PAP 속보(뉴스)는 하루 23~46건(평균 36건)이 갔고 도메니코는
 * 그건 잘 본다고 했다. 양이 문제가 아니었다.
 * 게시물 하나당 메시지가 **두 개**(감지 알림 + 사진 여러 장 브리프)였고,
 * 두 번째가 "올릴래 말래" 라는 결정을 매번 요구한 것이 문제였다.
 * 그래서 결정을 요구하는 쪽을 없애고 읽기만 하면 되는 쪽만 남긴다.
 *
 * 형식은 PAP 속보와 맞춘다 — 도메니코 원칙1(2026-07-27):
 * "한 메시지당 하나의 소식만." 게시물 하나 = 메시지 하나.
 *
 * 캡션은 200자에서 잘린다(discoverAccount 가 그만큼만 받아온다).
 * 잘렸다는 사실을 '…' 로 표시한다 — 안 하면 원문이 그게 전부인 줄 안다. */
function fmtCount(n) {
  if (n == null) return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v >= 10000) return (Math.round(v / 1000) / 10) + '만';
  if (v >= 1000) return v.toLocaleString('en-US');
  return String(v);
}

const TYPE_KO = { IMAGE: '사진', VIDEO: '릴스', CAROUSEL_ALBUM: '여러 장' };

function fmtAgo(ts) {
  const ms = Date.now() - (Number(ts) || 0);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return '방금';
  if (min < 60) return min + '분 전';
  return Math.floor(min / 60) + '시간 전';
}

function buildAlert(acc, m, why) {
  /* 어디서 온 소식인지 한눈에 갈리게 한다. 인스타와 유튜브가 같은 채팅방에
     섞여 오므로, 아이콘이 같으면 무엇을 보고 있는지 매번 다시 읽어야 한다. */
  const isYt = acc.platform === 'youtube';
  const icon = isYt ? '▶️' : '📸';
  const who = (isYt ? '' : '@') + acc.username + (acc.label ? ' (' + acc.label + ')' : '');
  const meta = [
    isYt ? '유튜브 영상' : (TYPE_KO[String(m.type || '').toUpperCase()] || null),
    fmtCount(m.likes) ? '♥ ' + fmtCount(m.likes) : null,
    fmtCount(m.comments) ? '💬 ' + fmtCount(m.comments) : null,
    fmtAgo(m.ts),
  ].filter(Boolean).join(' · ');

  const cap = String(m.caption_head || '').replace(/\s+/g, ' ').trim();
  const capLine = cap ? (cap.length >= 200 ? cap + '…' : cap) : '(캡션 없음)';

  const head = icon + ' ' + who + (why ? '  · ' + why : '');
  return [head, meta, '', capLine, '', m.permalink]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
}

/* permalink 에서 shortcode. business_discovery 는 shortcode 필드를 안 준다. */
function shortcodeOf(permalink) {
  const m = /\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(String(permalink || ''));
  return m ? m[1] : null;
}

function briefChatId() {
  return process.env.TELEGRAM_PERSONAL_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
}

module.exports = withCronGuard('celeb-account-watch', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  const dry = String((req.query || {}).dry || '') === '1';
  const chatId = briefChatId();
  if (!chatId) return res.status(200).json({ ok: false, error: 'TELEGRAM_CHAT_ID 미설정' });

  /* 목록 전체를 읽고 enabled 를 코드에서 가른다 (2026-09-10).
     왜 전체를 읽나 — '감시할 게 원래 없다' 와 '있는데 전부 꺼져 있다' 는
     완전히 다른 상태인데, .eq('enabled',true) 로 걸러 오면 둘 다 빈 배열이라
     구분할 수단이 사라진다. 아래 remaining 계산이 이 구분에 달려 있다. */
  const { data: allAccounts, error: accErr } = await supabaseAdmin
    .from('celeb_watch_accounts').select('*')
    .order('last_polled_at', { ascending: true, nullsFirst: true });
  if (accErr) return res.status(500).json({ ok: false, error: accErr.message });

  /* ── 순번 폴링 (2026-09-18) ────────────────────────────────────────
   * 계정이 19개일 때 폴링에 11초가 걸렸다(실측). 계정 하나에 약 0.6초다.
   * 멤버 개인 계정까지 넣으면 80개가 넘는데, 그러면 폴링만 50초라
   * 60초 함수 상한에서 죽는다. **죽은 크론은 자기 죽음을 기록도 못 한다.**
   *
   * 그래서 한 실행에 전부 보지 않고 POLL_PER_RUN 개씩만 본다.
   * 위 조회가 이미 last_polled_at 오름차순(nullsFirst)이라, 가장 오래
   * 안 본 계정이 앞에 온다 — 자르기만 하면 자연스럽게 순번이 돈다.
   *
   * 놓치지 않는 근거: 계정 80개 · 20개씩 · 20분 주기면 한 계정이 80분마다
   * 돌아온다. 신선도 창은 24시간이라 그 사이 올라온 글은 다음 차례에
   * 그대로 잡힌다. 알림이 최대 80분 늦을 뿐 사라지지 않는다. */
  const enabledAll = (allAccounts || []).filter((a) => a && a.enabled);
  const accounts = enabledAll.slice(0, POLL_PER_RUN);
  const waiting = Math.max(0, enabledAll.length - accounts.length);
  const totalAccounts = (allAccounts || []).length;

  /* ── 꺼진 계정을 두 갈래로 나눈다 (2026-09-12, 마이그레이션 150) ──────
     이 크론은 09-11 에 "생산 0 · 잔여 12" 로 18회 연속 경보를 울렸다.
     파본 건 없었다. 12개가 09-01 에 전부 꺼졌을 뿐이고, 그건 **옳은 결정**
     이었다(자동감시 브리프 126건 → 발행 0건, 하루 14건 텔레그램 알림).
     경보가 틀린 게 아니라 시스템이 그 결정을 모르고 있었다.

     그래서 이유가 적힌 비활성과 설명 없는 비활성을 가른다.
       · disabled_reason 있음 → 사람이 알고 끈 것. 경보하지 않는다.
       · disabled_reason 없음 → 아무도 모르게 꺼진 것. 계속 경보한다.
     경보를 없애는 게 아니라 **울릴 이유가 있을 때만 울리게** 하는 것이다.
     계정을 끌 때 사유를 안 적으면 여전히 시끄럽다. 그게 의도다. */
  const offAccounts = (allAccounts || []).filter((a) => a && !a.enabled);
  const offExplained = offAccounts.filter(
    (a) => typeof a.disabled_reason === 'string' && a.disabled_reason.trim() !== '').length;
  /* 설명 없이 꺼져 있어 **아무도 안 보고 있는 줄도 모르는** 계정 수.
     remaining 은 '밀린 일' 이라는 뜻이다. 의도적으로 끈 계정은 밀린 일이 아니다. */
  const unwatched = offAccounts.length - offExplained;

  const out = { polled: 0, baselined: 0, alerted: 0, skipped: 0, unjudged: 0, empty: 0, emptyNames: [], judgeError: null, errors: [] };
  const candidates = [];

  for (const acc of accounts || []) {
    let media = [];
    let ytResolved = null;
    try {
      /* 2026-09-18 — 플랫폼이 둘이 됐다(인스타·유튜브). 갈라지는 곳은 여기
         **한 군데뿐**이다. 아래 신선도·중복·판정·알림은 전부 공통이다.
         ytDiscovery 가 igDiscovery 와 같은 모양을 돌려주도록 맞춰 놨기 때문이다.
         플랫폼마다 루프를 복사하면 규칙이 두 벌이 되고 한쪽만 고쳐진다. */
      let d;
      if (acc.platform === 'youtube') {
        d = await discoverChannel({ extId: acc.ext_id, handle: acc.username, limit: MEDIA_PER_ACCOUNT });
        ytResolved = d && d.channelId && d.channelId !== acc.ext_id ? d.channelId : null;
      } else {
        d = await discoverAccount(acc.username, MEDIA_PER_ACCOUNT);
      }
      media = (d && d.media) || [];   // 두 discovery 모두 정규화된 배열을 준다 (ts·permalink)
      out.polled++;
      /* 2026-09-18 — API 가 말하는 그 계정의 **실제 이름과 팔로워 수**를 적어 둔다.
         왜: 핸들을 사람이 찍어 넣으면 두 가지가 조용히 통과한다.
           ① 오타인데 그 핸들이 실존하는 남의 계정인 경우
           ② 공식이 아니라 팬 계정인 경우
         둘 다 last_error 에 안 걸린다 — 읽히긴 읽히니까. 그래서 '읽혔다' 로는
         부족하고 '누구인지' 를 적어야 한다. api_name 이 label 과 어긋나거나
         팔로워가 터무니없이 적으면 잘못 넣은 계정이다. 사람이 한 번 훑으면 보인다. */
      /* 2026-09-21 — 예전엔 여기서 last_error 를 **무조건** null 로 지웠다.
         읽기가 성공했으니 오류가 없다고 본 것이다. 그런데 '읽혔지만 0건' 은
         성공이 아니다. 지우면 증거까지 사라진다. 0건이면 사유를 남긴다. */
      const emptyWhy = media.length ? null
        : '읽혔으나 게시물 0건 — 개인(비프로페셔널) 계정이면 Graph API 로 못 읽는다';
      if (!dry) await supabaseAdmin.from('celeb_watch_accounts')
        .update(Object.assign({
          last_polled_at: new Date().toISOString(), last_error: emptyWhy,
          /* 유튜브는 팔로워 수를 안 가져온다(유닛 절약). name 은 채널명이다. */
          api_name: (d && d.name) || acc.api_name || null,
          followers: (d && Number.isFinite(Number(d.followers))) ? Number(d.followers) : acc.followers,
        /* 핸들→채널ID 는 한 번만 풀고 캐시한다. 안 그러면 20분마다 1유닛씩 샌다. */
        }, ytResolved ? { ext_id: ytResolved } : {}))
        .eq('username', acc.username);
    } catch (e) {
      /* 비공개·개인 계정·오타 핸들은 여기로 온다. 죽지 말고 기록만. */
      out.errors.push(acc.username + ': ' + String((e && e.message) || e).slice(0, 120));
      if (!dry) await supabaseAdmin.from('celeb_watch_accounts')
        .update({ last_polled_at: new Date().toISOString(), last_error: String((e && e.message) || e).slice(0, 300) })
        .eq('username', acc.username);
      continue;
    }

    /* 2026-09-18 — 캡션·유형·반응을 버리지 않는다.
       예전엔 shortcode/permalink/ts 만 남기고 나머지를 버렸다. 브리프를 만들 때는
       어차피 다시 받아오니 상관없었지만, 이제는 알림 자체가 결과물이라
       discoverAccount 가 이미 준 것을 그대로 쓴다 (추가 API 호출 0). */
    const items = media
      .map((m) => ({
        /* 인스타는 permalink 에서 뽑고, 유튜브는 discovery 가 영상 ID 를 직접 준다. */
        shortcode: m.shortcode || shortcodeOf(m.permalink),
        permalink: m.permalink,
        ts: Date.parse(m.ts || '') || 0,
        type: m.type || null,
        likes: m.likes == null ? null : m.likes,
        comments: m.comments == null ? null : m.comments,
        caption_head: String(m.caption_head || ''),
      }))
      .filter((m) => m.shortcode);

    /* ⓪ 읽히긴 했는데 게시물이 0건 — 2026-09-21 에 잡은 구멍.
       이 계정은 `out.polled++` 로 성공에 세어지고, last_error 는 null 로
       지워지고, 아래 기준선 분기에서 `items.length` 가 0 이라 baseline_done
       이 **영영 안 켜진다**. 그래서 매 순번마다 다시 '기준선' 으로 세어졌다.
       실측: baseline_done=false 인 인스타 계정 9개 × 하루 폴링 147회분
       = 예측 132건/일, 실제 노트 130건/일. 9일간 이 9개는 단 한 번도
       감시 단계에 들어가 본 적이 없다.
       해당 9개는 전부 개인 멤버 계정(리사·정국·윈터·닝닝·지젤·정한·원우·
       승한·워니)이다. Graph business_discovery 는 프로페셔널 계정만
       읽는다 — 개인 계정은 앞으로도 0건이다.
       그래서 '기준선' 이 아니라 '읽었지만 아무것도 없었다' 로 따로 센다.
       자동 비활성은 하지 않는다: 도메니코가 필수라고 지정한 계정이다.
       끄고 말고는 사람이 정한다. 여기서는 보이게만 만든다. */
    if (!items.length) {
      out.empty++;
      if (out.emptyNames.length < 12) out.emptyNames.push(acc.label || acc.username);
      continue;
    }

    // ① 첫 폴링은 기준선만 — 알림 없이 seen 채우고 끝
    if (!acc.baseline_done) {
      if (!dry) {
        await supabaseAdmin.from('celeb_account_seen')
          .upsert(items.map((m) => ({ username: acc.username, shortcode: m.shortcode })),
            { onConflict: 'username,shortcode', ignoreDuplicates: true });
        await supabaseAdmin.from('celeb_watch_accounts')
          .update({ baseline_done: true }).eq('username', acc.username);
      }
      out.baselined++;
      continue;
    }

    const { data: seenRows } = await supabaseAdmin.from('celeb_account_seen')
      .select('shortcode').eq('username', acc.username)
      .in('shortcode', items.map((m) => m.shortcode));
    const seen = new Set((seenRows || []).map((r) => r.shortcode));

    for (const m of items) {
      if (seen.has(m.shortcode)) continue;
      if (Date.now() - m.ts > FRESH_MS) {
        // ② 신선하지 않은 건 조용히 seen 처리 (알림 없이)
        if (!dry) await supabaseAdmin.from('celeb_account_seen')
          .upsert([{ username: acc.username, shortcode: m.shortcode }],
            { onConflict: 'username,shortcode', ignoreDuplicates: true });
        continue;
      }
      if (candidates.length >= MAX_JUDGE) continue;  // ③ 상한 초과분은 seen 에 안 넣는다 → 다음 실행에 잡힌다
      candidates.push({ acc, m });
    }
  }

  /* ── 뉴스 판정 (2026-09-18) ────────────────────────────────────────
   * 계정별로 알리던 것을 여기서 한 번에 모아 판정한다. 계정마다 AI 를
   * 부르면 콜 수가 계정 수만큼 늘어난다 — 19개 계정이면 19콜이다.
   * 모아서 한 배치로 물으면 보통 1콜이면 끝난다. */
  let judged = null;
  if (candidates.length && !dry) {
    judged = await judgeNews(candidates);
    if (!judged.ok) {
      /* 실패하면 아무것도 안 보내고 seen 에도 안 남긴다 → 다음 실행에 재시도.
         반대로 하면(전부 보내기) API 가 흔들릴 때마다 스팸이 된다. */
      out.judgeError = judged.reason;
    }
  }

  if (judged && judged.ok) {
    for (let i = 0; i < candidates.length; i++) {
      const { acc, m } = candidates[i];
      const v = judged.verdicts[i];
      /* 판정이 안 돌아온 항목은 seen 에 안 남긴다 — 다음 실행에 다시 묻는다.
         '답이 없다' 를 '뉴스 아님' 으로 삼으면 소식이 조용히 사라진다. */
      if (!v) { out.unjudged++; continue; }

      /* 중복 방어 (2026-09-18) — 예전엔 두 겹이었다: celeb_account_seen PK +
         큐의 (batch_key,shortcode) 유니크. 큐를 걷어냈으니 한 겹만 남는다.
         그래서 **기록이 성공했을 때만 보낸다**. 순서를 뒤집거나 에러를
         무시하면, 기록이 실패한 게시물이 매 실행마다 다시 알림으로 나간다
         (20분마다 같은 메시지 = 최악의 스팸). 기록 실패 시엔 조용히 넘기고
         다음 실행에 다시 시도한다 — 알림 한 번 늦는 게 훨씬 낫다. */
      const { error: seenErr } = await supabaseAdmin.from('celeb_account_seen')
        .upsert([{ username: acc.username, shortcode: m.shortcode }],
          { onConflict: 'username,shortcode', ignoreDuplicates: true });
      if (seenErr) {
        out.errors.push(acc.username + '/' + m.shortcode + ' seen 기록 실패: '
          + String(seenErr.message || seenErr).slice(0, 80));
        continue;
      }
      /* 뉴스가 아니어도 seen 에는 남긴다 — 같은 게시물을 20분마다 다시 묻는
         것이 이 게이트에서 가장 비싼 실수다. */
      if (!v.news) { out.skipped++; continue; }
      await sendTextToChatSafe(chatId, buildAlert(acc, m, v.why));
      out.alerted++;
    }
  }

  /* ── 생산량 신고 (2026-09-10 신설) ────────────────────────────────
   *
   * 실측: 이 크론은 2026-08-24 신설 이후 1,247회 실행에서 **단 한 번도**
   * 폴링한 적이 없다. 실패는 0건이다. 09-01 20:12 에 12개 계정(BTS·블랙핑크·
   * 샤넬·디올·프라다 …)이 전부 enabled=false 가 됐고, 그 뒤로 목록 조회가
   * 빈 배열을 주니 루프가 그냥 안 돌았다. 매번 ok=true · polled 0 이었다.
   *
   * 왜 아무 감시에도 안 걸렸나 — pipeline-watch 의 checkProduction 은 이미
   * "돌았는데 생산이 0" 을 크론 이름과 무관하게 잡는다. 그런데 그 판정은
   * produced/remaining 을 **신고한 크론만** 대상으로 한다(미신고는 '모른다'
   * 로 빼고 부채로만 센다). 이 크론이 바로 그 미신고 쪽에 있었다.
   * 그래서 새 감시를 만들지 않는다 — 이미 있는 감시에 신고를 시작할 뿐이다.
   *
   * remaining 의 뜻을 여기서는 '아직 아무도 안 보고 있는 계정 수' 로 잡는다.
   *   · 정상(전부 켜짐, 새 글 없음) → produced 0 · remaining 0 → '완주' · 조용함
   *   · 목록이 비어 있음           → produced 0 · remaining 0 → '완주' · 조용함
   *   · 사유 적고 꺼둠             → produced 0 · remaining 0 → '완주' · 조용함
   *   · 사유 없이 꺼져 있음        → produced 0 · remaining N → 6회 뒤 '막힘' 경보
   * 마지막 것만 울린다. 이게 이 신고가 존재하는 이유다.
   *
   * ── 2026-09-12 정정 ─────────────────────────────────────────────
   * 원래는 '전부 꺼짐' 자체를 울렸다. 그래서 09-11 에 18회 연속 울렸는데,
   * 파본 건 없었다 — 09-01 에 사람이 일부러 끈 것이었고 그건 옳은 결정이었다
   * (자동감시 126건 → 발행 0건). 경보가 정보를 다 준 뒤에도 계속 울리면
   * 그때부터는 헛알림이다(09-05·09-06 에 두 번 잡았던 그 병).
   * 그래서 판정 기준을 '꺼짐' 에서 '설명 없이 꺼짐' 으로 옮겼다.
   * 마이그레이션 150 의 disabled_reason 이 그 설명을 담는다. */
  /* 꺼진 계정 설명은 켜진 경우·꺼진 경우 양쪽에 같은 문장으로 붙인다.
     "의도적 비활성 12개" 가 보이면 사람이 로그만 보고도 상태를 안다. */
  const offNote = (offExplained ? ' · 의도적 비활성 ' + offExplained + '개' : '')
    + (unwatched ? ' · ⚠️ 사유 없는 비활성 ' + unwatched + '개' : '');
  const note = totalAccounts === 0
    ? '감시 목록이 비어 있음 (등록된 계정 0개)'
    : (accounts.length === 0
      ? '감시 대상 0개 — 등록된 ' + totalAccounts + '개가 전부 비활성' + offNote
      : '폴링 ' + out.polled + '/' + accounts.length + '개 · 기준선 ' + out.baselined
        + (waiting ? ' (순번 대기 ' + waiting + '개)' : '')
        + ' · 알림 ' + out.alerted + '건'
        + (out.skipped ? ' · 뉴스 아님 ' + out.skipped + '건' : '')
        /* 읽혔는데 0건인 계정은 순번만 먹고 아무것도 못 낸다. 노트에
           안 적으면 '기준선' 에 섞여 영원히 정상으로 보인다. */
        + (out.empty ? ' · ⚠️ 읽혔으나 0건 ' + out.empty + '개('
            + out.emptyNames.join(', ') + ')' : '')
        /* 판정을 못 한 건 '한 게 없다' 가 아니라 '밀렸다' 다. 노트에 안 적으면
           AI 가 며칠 죽어 있어도 "알림 0건" 으로만 보이고 아무도 모른다. */
        + (out.unjudged ? ' · ⚠️ 판정 누락 ' + out.unjudged + '건' : '')
        + (out.judgeError ? ' · ⚠️ 판정 실패(' + out.judgeError + ') 대기 ' + candidates.length + '건' : '')
        + ' · 오류 ' + out.errors.length + '건' + offNote);
  /* 2026-09-13 — 부계정 피드 참조 수집을 여기에 얹는다 (api/_lib/igSubPosts.js).
     이유는 그 파일 머리말 참고: 크론 호출 예산이 2,599/2,600 이라 새 크론을 못 만든다.
     이 크론은 하루 72회 · 평균 94ms 로 가장 가볍고, 성격도 '계정 감시' 라 맞는다.
     STALE_MS(2시간) 게이트가 있어 실제 수집은 하루 12회다.
     **곁다리 일이 본 일을 망치면 안 된다** — 여기서 던져도 위 감시 결과는 그대로 낸다. */
  let sub = { saved: 0, note: '부계정 수집 건너뜀', failures: [] };
  if (!dry) {
    try {
      sub = await collectSubPosts(supabaseAdmin);
    } catch (e) {
      sub = { saved: 0, failures: [String((e && e.message) || e).slice(0, 120)],
        note: '부계정 수집 실패 — ' + String((e && e.message) || e).slice(0, 60) };
    }
  }

  /* 판정이 막혀 못 보낸 건은 remaining 에 더한다. produced 0 · remaining 0 이면
     판정기가 통째로 죽어도 '할 일이 없었다' 로 보여 조용히 지나간다. */
  reportProduction(res, { produced: out.alerted,
    remaining: unwatched + (out.judgeError ? candidates.length : 0) + out.unjudged,
    note: note + ' · ' + sub.note });

  return res.status(200).json({
    ok: true, dry, ...out,
    accounts: {
      total: totalAccounts, enabled: accounts.length,
      disabledExplained: offExplained, unwatched,
    },
    subPosts: { saved: sub.saved, skipped: !!sub.skipped, failures: (sub.failures || []).slice(0, 2) },
  });
});
