/**
 * PAP Magazine — 다이제스트 갈래 2차 판정 크론 (2026-08-07 신설)
 * Route: /api/cron/celeb-classify   (10분 주기)
 *
 * 1차(태그 마커, api/_lib/digestKind.js)가 확신 못 한 기사를 AI 가 판정해
 * articles.digest_kind 에 남긴다. 다이제스트는 그 값을 읽기만 한다.
 * 갈래는 셋이다 — celeb · collection · none(두 모음 모두에서 뺀다).
 *
 * 왜 AI 가 필요한가 ──────────────────────────────────────────────────
 * 마커는 '분야' 를 본다(kpop, korean actor, comeback …). 그런데 실측 반례:
 *
 *   '페라가모 플래그십이 영화제 포토콜로 변한 순간'
 *   tags: [ferragamo, nana, kim hee-ae, yoon seung-ah, kim moo-yul, cara bag, …]
 *
 * 나나·김희애·윤승아·김무열 — 전부 셀럽인데 분야 마커가 하나도 없다.
 * 사람 이름은 끝이 없어서 명단으로 못 막는다. 반대로 이름만 보고 판정하면
 * 작가·디자이너(존 갈리아노, 릭 오웬스, 마리나 뢰노 오노레)까지 셀럽이 된다.
 * '유명인이냐' 가 아니라 '연예인이냐' 를 물어야 하는데, 그 구분은 규칙보다
 * 판단에 가깝다.
 *
 * 'none' 도 AI 몫이다. 마커는 아트·패션·뷰티 단어가 하나도 없을 때만 none
 * 이라 답하는데, 그건 아주 보수적인 기준이다(45일 332건 중 1건 — 폭염경보).
 * 도메니코 지시 "애매한건 억지로 포함시키지 말고 그냥 빼줘" 를 제대로
 * 지키려면 사람이 읽고 판단하는 층이 한 겹 필요하다.
 *
 * 비용 설계 ─────────────────────────────────────────────────────────
 * 기사 하나에 한 번만 묻는다(digest_kind 가 채워지면 다시 안 묻는다).
 * 한 번에 BATCH 건을 묶어 한 콜로 처리하고, 본문은 안 보낸다 — 제목과
 * 태그면 충분하고 토큰이 20배 싸다. 모델도 하이쿠 기본값.
 *
 * 안전 설계 ─────────────────────────────────────────────────────────
 *   · kind_by='manual' 은 절대 안 건드린다 (도메니코가 손으로 고친 값)
 *   · 응답이 깨지면 그 배치는 통째로 버리고 다음 실행에 다시 시도한다.
 *     반만 저장해 두면 어디까지 됐는지 알 수 없다.
 *   · AI 미설정이면 조용히 넘어간다 — 마커 판정만으로도 다이제스트는 돈다.
 *   · 돌았는데 아무것도 안 했으면 note 에 그렇게 적는다 ('돌았다 ≠ 했다').
 *
 * 환경변수:
 *   ANTHROPIC_API_KEY          필수 (없으면 건너뜀)
 *   CELEB_CLASSIFY_MODEL       기본 claude-haiku-4-5-20251001
 *   CELEB_CLASSIFY_BATCH       기본 25 (한 콜에 묶는 기사 수)
 *   CELEB_CLASSIFY_MAX_BATCHES 기본 4  (한 실행 최대 콜 수)
 *   CELEB_CLASSIFY_DAYS        기본 0 = 전체. 값을 주면 그 일수 내 기사만.
 */

'use strict';

const { bearerOk } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { markerKind, tagList, KINDS } = require('../_lib/digestKind');
const { reportAiResponse } = require('../_lib/aiCreditWatch');

const MODEL = process.env.CELEB_CLASSIFY_MODEL || 'claude-haiku-4-5-20251001';
const BATCH = Math.max(1, Math.min(50, Number(process.env.CELEB_CLASSIFY_BATCH) || 25));
const MAX_BATCHES = Math.max(1, Math.min(10, Number(process.env.CELEB_CLASSIFY_MAX_BATCHES) || 4));

function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

const SYSTEM = [
  '너는 PAP 매거진(아트 기반 패션·뷰티·컬처 매거진)의 기사 분류기다.',
  '기사 목록을 받아 각 기사를 셋 중 하나로 분류한다.',
  '',
  '"celeb" — 연예인이 주인공인 기사.',
  '  · 아이돌·가수·배우·모델 등 대중 연예인의 활동, 착장, 화보, 광고, 컴백,',
  '    공항 패션, 브랜드 앰배서더 선정, 팬 이벤트, 시상식·포토콜 참석 등',
  '  · 브랜드 이야기라도 그 자리의 주인공이 연예인이면 celeb 이다',
  '    (예: "정국이 전하는 샤넬 향수" → celeb)',
  '  · 패션·뷰티 기사이면서 동시에 연예인이 주인공이면 celeb 이 우선한다',
  '',
  '"collection" — 아트·패션·뷰티·컬처 콘텐츠. 주인공이 연예인이 아닌 것.',
  '  · 디자이너·아티스트·크리에이티브 디렉터·사진가·공예가',
  '    (존 갈리아노 회고전, 릭 오웬스 컬렉션, 신진 작가 소개)',
  '  · 브랜드·제품·전시·팝업·컬렉션·패션위크·업계 뉴스',
  '',
  '"none" — 아트도 셀럽도 아닌 것. **두 모음 어디에도 안 실린다.**',
  '  · 날씨·재난·사회 일반 뉴스 (예: "서울 전역에 내려진 폭염중대경보")',
  '  · 우리 매거진의 두 모음 어느 쪽 독자에게도 소재가 안 되는 글',
  '  · **none 은 마지막 수단이다. 조금이라도 걸리면 celeb 또는 collection 을 골라라.**',
  '',
  '2026-08-07 실측 오답 — 아래는 전부 none 이 아니다:',
  '  ✗ "지코, 워터밤 서울 피날레 무대" → none (X) · celeb (O)',
  '     축제·시상식 무대에 연예인이 서면 celeb 이다. 같은 워터밤 기사인',
  '     태민·박재범은 celeb 으로 갔는데 지코만 none 으로 갔다 — 일관성이 없다.',
  '  ✗ "자이언티·코드 쿤스트와 함께한 메종 마르지엘라 향수의 밤" → none (X) · celeb (O)',
  '     브랜드 행사라도 그 자리의 주인공이 연예인이면 celeb 이다.',
  '  ✗ "푸마 x 맨시티 성수 팝업" → none (X) · collection (O)  팝업은 collection 이다.',
  '  ✗ "놀란 감독의 한글 타이, 메종 드 윤" → none (X) · collection (O)  공예·브랜드다.',
  '  ✗ "스포츠 사진가 Geoff Lowe" → none (X) · collection (O)  사진가는 collection 이다.',
  '',
  '  · 도메니코 지시 "애매한건 억지로 포함시키지 말고 그냥 빼줘" 의 뜻은',
  '    **아트가 아닌 걸 collection 에 억지로 넣지 말라**는 것이지,',
  '    컬처 콘텐츠를 none 으로 버리라는 뜻이 아니다.',
  '',
  '판단 순서: 연예인이 주인공인가? → 아니면 아트/패션/뷰티 콘텐츠인가?',
  '→ 둘 다 아니면 none.',
  '',
  '출력은 JSON 배열 하나만. 설명·코드펜스 금지.',
  '형식: [{"i":0,"kind":"celeb"},{"i":1,"kind":"collection"},{"i":2,"kind":"none"}]',
  'i 는 입력에 붙은 번호 그대로. kind 는 celeb|collection|none 셋 중 하나. 빠뜨리지 말 것.',
].join('\n');

function buildUserPrompt(rows) {
  return rows.map((r, i) => {
    const tags = tagList(r.tags).slice(0, 12).join(', ');
    return [
      'i=' + i,
      '제목: ' + String(r.title || '').slice(0, 120),
      '카테고리: ' + String(r.category || ''),
      '태그: ' + (tags || '(없음)'),
    ].join('\n');
  }).join('\n---\n');
}

/* 코드펜스·서두 설명을 걷어내고 배열만 취한다. 번역 백필에서 같은 일을
   겪어 만든 방식(seoTranslateBackfill.parseJsonArray)과 같은 사고다 —
   모델은 "펜스 쓰지 마"라고 해도 가끔 붙인다. */
function parseVerdicts(text) {
  const s = String(text || '');
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try {
    const arr = JSON.parse(s.slice(a, b + 1));
    if (!Array.isArray(arr)) return null;
    return arr.filter((o) => o && Number.isInteger(o.i) && KINDS.includes(o.kind));
  } catch (_e) {
    return null;
  }
}

async function askClaude(rows) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(rows) }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => ({}));
  try { reportAiResponse({ ok: r.ok, status: r.status, body: j, where: 'celeb-classify' }); } catch (_e) { /* 알림 실패가 분류를 막지 않는다 */ }
  if (!r.ok) throw new Error('AI 호출 실패 ' + r.status + ': ' + JSON.stringify(j).slice(0, 200));
  const text = (j.content || []).map((c) => c.text || '').join('');
  return parseVerdicts(text);
}

/* 2026-08-07 사고 — 여기서 upsert 를 썼다가 10분마다 500 으로 죽었다.
   실측: cron_runs 18회 중 14회 실패, 전부 같은 메시지 —
   `null value in column "title" of relation "articles" violates not-null constraint`

   왜인가 — PostgREST 의 upsert 는 INSERT ... ON CONFLICT 다. 행이 이미
   있어도 **먼저 INSERT 를 시도**하므로, 페이로드에 없는 NOT NULL 컬럼
   (articles.title 은 NOT NULL·기본값 없음)에서 걸린다.
   우리가 하려던 건 처음부터 UPDATE 였다. onConflict:'id' 는 충돌 대상만
   정할 뿐 INSERT 시도 자체를 없애지 않는다.

   그래서 UPDATE 로 바꾼다. 덤으로 `.is('digest_kind', null)` 을 걸어,
   그 사이 사람이 손으로 채운 값(kind_by='manual')을 덮어쓸 여지를 없앤다 —
   조회 시점과 저장 시점 사이의 틈을 저장 쪽에서도 막는다. */
async function applyKind(ids, kind, by) {
  if (!ids || !ids.length) return null;
  const { error } = await supabaseAdmin.from('articles')
    .update({ digest_kind: kind, kind_by: by })
    .in('id', ids)
    .is('digest_kind', null);
  return error || null;
}

/* 2026-08-07 (도메니코 결정) — 'none' 은 사람 확인 대기열로 보낸다.
 *
 * 왜 — none 은 파괴적 판정이다. 두 모음 **모두**에서 빠지고, 되돌리려면
 * 사람이 손대야 한다. 그런데 실측 정확도가 낮았다: 첫 100건 중 none 13건을
 * 전수 확인했더니 최소 7건이 명백한 오답이었다(지코 워터밤·마르지엘라 향수
 * 행사 2건·맨시티 팝업 2건·메종 드 윤 공예·스포츠 사진가).
 * celeb·collection 판정은 멀쩡했다 — 문제는 none 하나다.
 *
 * 그래서 none 은 이렇게 저장한다:
 *   digest_kind = 'collection'   ← 확인 전까지는 아트 모음에 그대로 실린다
 *   kind_by     = 'ai_none_pending'
 *
 * 이 조합의 뜻은 "AI 는 빼자고 했지만 아직 사람이 확인 안 했다" 다.
 *   · 다이제스트는 digest_kind 만 보므로 글이 사라지지 않는다 (안전 쪽 실패)
 *   · digest_kind 가 찼으니 매 실행 다시 묻지 않는다 (비용·무한루프 방지)
 *   · 어드민에서 kind_by='ai_none_pending' 으로 한 번에 뽑아 검토한다
 *   · 사람이 정하면 kind_by='manual' 이 되고 그건 무엇보다 우선한다
 *
 * 잘못 빼는 것보다 잘못 남기는 쪽이 싸다 — 남은 건 눈에 띄지만
 * 빠진 건 아무도 못 본다. */
const PENDING_BY = 'ai_none_pending';
const PENDING_KIND = 'collection';

module.exports = withCronGuard('celeb-classify', async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  /* 2026-08-07 사고 — 처음에 `req.headers['x-vercel-cron']` 로 크론을 알아보려
     했다. **버셀은 그 헤더를 안 보낸다.** 보내는 건 Authorization: Bearer
     $CRON_SECRET 이다. 그래서 예약 실행이 전부 requireAdmin 에 막혀 401 로
     끝났고, cron_runs 에는 ok=true / note 빈칸으로 남았다 —
     '돌았다 ≠ 했다' 그 패턴을, 그걸 고치자고 만든 크론에 내가 심었다.
     이 저장소의 다른 크론들과 같은 모양으로 되돌린다. */
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) {
    const admin = await requireAdmin(req, res);
    if (!admin) { note(res, '인증 거부 — 크론 시크릿도 관리자 세션도 아님'); return; }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({ ok: true, note: note(res, 'ANTHROPIC_API_KEY 미설정 — 마커 판정만으로 진행') });
  }

  /* 2026-08-07 — ?recheck=none
   *
   * 대기열 정책을 넣기 전에 AI 가 이미 none 으로 확정해 버린 행들을 되살린다.
   * 그 판정은 실측 정확도가 낮았다(13건 중 최소 7건 오답). digest_kind 를
   * 비우면 다음 실행부터 새 프롬프트로 다시 묻고, 이번엔 확인 대기열로 간다.
   *
   * kind_by='manual' 은 건드리지 않는다 — 사람이 정한 값이 항상 우선이다.
   * (그래서 조건에 kind_by='ai' 를 명시한다. 'ai_none_pending' 도 제외 —
   *  그건 이미 새 정책으로 안전하게 대기 중이라 다시 물을 이유가 없다.) */
  if (String((req.query && req.query.recheck) || '') === 'none') {
    const { data: cleared, error: rcErr } = await supabaseAdmin.from('articles')
      .update({ digest_kind: null, kind_by: null })
      .eq('kind_by', 'ai').eq('digest_kind', 'none')
      .select('id');
    if (rcErr) {
      note(res, 'recheck 실패: ' + rcErr.message);
      return res.status(500).json({ ok: false, error: 'recheck failed', detail: rcErr.message });
    }
    const n = (cleared || []).length;
    return res.status(200).json({ ok: true, recheck: 'none', cleared: n,
      note: note(res, "recheck=none — 옛 none 판정 " + n + "건을 비웠다. 다음 실행부터 다시 묻는다.") });
  }

  const days = Number(process.env.CELEB_CLASSIFY_DAYS) || 0;
  let q = supabaseAdmin.from('articles')
    .select('id, title, category, tags, digest_kind, kind_by')
    .eq('status', 'published')
    .is('digest_kind', null)
    .order('published_date', { ascending: false })
    .limit(BATCH * MAX_BATCHES * 3);
  if (days > 0) q = q.gte('published_date', new Date(Date.now() - days * 86400000).toISOString());

  const { data, error } = await q;
  if (error) {
    note(res, '대기열 조회 실패: ' + error.message);
    return res.status(502).json({ ok: false, error: 'queue failed', detail: error.message });
  }

  /* 마커로 이미 셀럽인 건 AI 에 안 묻는다 — 대신 그 결과를 바로 저장해서
     대기열에서 빼 준다. 안 그러면 매 실행 같은 행이 앞자리를 차지한다
     (번역 백필에서 이미 겪은 poison-pill 모양). */
  const markerHits = [];
  const askRows = [];
  for (const r of (data || [])) {
    if (markerKind(r).kind === 'celeb') markerHits.push(r);
    else askRows.push(r);
  }

  let savedMarker = 0;
  if (markerHits.length) {
    const e1 = await applyKind(markerHits.map((r) => r.id), 'celeb', 'marker');
    if (e1) {
      note(res, '마커 판정 저장 실패: ' + e1.message);
      return res.status(500).json({ ok: false, error: 'save marker failed', detail: e1.message });
    }
    savedMarker = markerHits.length;
  }

  let savedAi = 0; let batches = 0; let pendingNone = 0; const failures = [];
  for (let i = 0; i < askRows.length && batches < MAX_BATCHES; i += BATCH) {
    const chunk = askRows.slice(i, i + BATCH);
    batches += 1;
    let verdicts = null;
    try {
      verdicts = await askClaude(chunk);
    } catch (e) {
      failures.push(String((e && e.message) || e).slice(0, 120));
      break;                      // 한도·장애면 다음 실행에 재개한다
    }
    if (!verdicts || !verdicts.length) {
      failures.push('응답 파싱 실패 (배치 ' + batches + ')');
      continue;                   // 이 배치만 버린다 — 반만 저장하지 않는다
    }
    /* 갈래별로 묶어 한 번씩 UPDATE 한다 — kind 는 최대 3종이라 콜도 최대 3번. */
    const byKind = new Map();
    verdicts.forEach((v) => {
      if (!chunk[v.i]) return;
      // none 은 바로 빼지 않고 확인 대기열로 (위 PENDING_BY 주석 참고)
      const key = v.kind === 'none' ? PENDING_BY : 'ai';
      const k = key + '|' + (v.kind === 'none' ? PENDING_KIND : v.kind);
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k).push(chunk[v.i].id);
      if (v.kind === 'none') pendingNone += 1;
    });
    let n = 0;
    for (const [k, ids] of byKind) {
      const [by, kind] = k.split('|');
      const e2 = await applyKind(ids, kind, by);
      if (e2) {
        note(res, 'AI 판정 저장 실패: ' + e2.message);
        return res.status(500).json({ ok: false, error: 'save ai failed', detail: e2.message });
      }
      n += ids.length;
    }
    if (!n) continue;
    savedAi += n;
  }

  /* 2026-08-07 — 여기가 거짓말을 하고 있었다.
     askRows 는 이번에 '가져온' 300건 중 마커를 뺀 수라, 실제 대기열이
     1,745건일 때도 note 에 '남은 대기 199건' 이라고 적혔다. 진행률을 못 믿으면
     언제 끝나는지 알 수 없다. 남은 총수를 DB 에 직접 묻는다(head 조회라 싸다). */
  let remaining = Math.max(0, askRows.length - savedAi);
  try {
    const { count } = await supabaseAdmin.from('articles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published').is('digest_kind', null);
    if (typeof count === 'number') remaining = count;
  } catch (_e) { /* 못 세면 근사치라도 남긴다 */ }
  const msg = savedMarker + savedAi === 0
    ? (askRows.length === 0 && markerHits.length === 0
      ? '판정 대기 기사 없음 — 완주'
      : '판정 0건' + (failures.length ? ' — ' + failures[0] : ''))
    : '갈래 판정 ' + (savedMarker + savedAi) + '건 저장 (마커 ' + savedMarker + ' · AI ' + savedAi
      + (pendingNone ? ' · 제외후보 ' + pendingNone : '')
      + ') · 남은 대기 ' + remaining + '건' + (failures.length ? ' · 실패 ' + failures.length : '');

  return res.status(200).json({
    ok: true, savedMarker, savedAi, pendingNone, batches, remaining, failures: failures.slice(0, 3),
    note: note(res, msg),
  });
});

module.exports.SYSTEM = SYSTEM;
module.exports.parseVerdicts = parseVerdicts;
module.exports.buildUserPrompt = buildUserPrompt;
