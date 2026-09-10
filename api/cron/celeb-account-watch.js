/**
 * GET /api/cron/celeb-account-watch — 셀럽·브랜드 계정 자동 감시 (2026-08-23 신설)
 * vercel.json: 12,32,52 * * * * (20분 주기, celeb-brief 의 :00 과 어긋나게)
 *
 * 왜: 도메니코 "자동 감지로 바꿔라" (2026-08-23).
 * 기존 흐름은 도메니코가 인스타 링크를 텔레그램으로 보내야 시작됐다.
 * 이 크론은 감시 계정 목록(celeb_watch_accounts)을 business_discovery 로 폴링해
 * 새 게시물을 발견하면 celeb_brief_queue 에 **직접 적재**한다.
 * 그 뒤는 전부 기존 경로다: celeb-brief 크론이 브리프를 만들어 텔레그램으로
 * 보내고, 도메니코가 "올려" 라고 쳐야만 게시된다. **자동 발행 경로는 없다.**
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
const { sendTextToChatSafe } = require('../_lib/telegram');

const FRESH_MS = 24 * 3600 * 1000;   // ② 게시 24시간 이내만
const MAX_BRIEFS = 4;                // ③ 실행당 브리프 상한
const MEDIA_PER_ACCOUNT = 5;

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

  const accounts = (allAccounts || []).filter((a) => a && a.enabled);
  const totalAccounts = (allAccounts || []).length;
  /* 목록에 있는데 꺼져 있어 아무도 안 보고 있는 계정 수. */
  const unwatched = totalAccounts - accounts.length;

  const out = { polled: 0, baselined: 0, queued: 0, errors: [] };
  let briefBudget = MAX_BRIEFS;

  for (const acc of accounts || []) {
    let media = [];
    try {
      const d = await discoverAccount(acc.username, MEDIA_PER_ACCOUNT);
      media = (d && d.media) || [];   // discoverAccount 는 정규화된 배열을 준다 (ts·permalink)
      out.polled++;
      if (!dry) await supabaseAdmin.from('celeb_watch_accounts')
        .update({ last_polled_at: new Date().toISOString(), last_error: null })
        .eq('username', acc.username);
    } catch (e) {
      /* 비공개·개인 계정·오타 핸들은 여기로 온다. 죽지 말고 기록만. */
      out.errors.push(acc.username + ': ' + String((e && e.message) || e).slice(0, 120));
      if (!dry) await supabaseAdmin.from('celeb_watch_accounts')
        .update({ last_polled_at: new Date().toISOString(), last_error: String((e && e.message) || e).slice(0, 300) })
        .eq('username', acc.username);
      continue;
    }

    const items = media
      .map((m) => ({ shortcode: shortcodeOf(m.permalink), permalink: m.permalink, ts: Date.parse(m.ts || '') || 0 }))
      .filter((m) => m.shortcode);

    // ① 첫 폴링은 기준선만 — 브리프 없이 seen 채우고 끝
    if (!acc.baseline_done) {
      if (!dry && items.length) {
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
        // ② 신선하지 않은 건 조용히 seen 처리 (브리프 없이)
        if (!dry) await supabaseAdmin.from('celeb_account_seen')
          .upsert([{ username: acc.username, shortcode: m.shortcode }],
            { onConflict: 'username,shortcode', ignoreDuplicates: true });
        continue;
      }
      if (briefBudget <= 0) continue;   // ③ 상한 초과분은 seen 에 안 넣는다 → 다음 실행에 잡힌다
      briefBudget--;

      if (!dry) {
        /* 기존 웹훅 적재와 같은 모양. batch_key 는 게시물 단위로 고유 —
           (batch_key,shortcode) 유니크가 재실행 중복을 막는다. */
        await supabaseAdmin.from('celeb_brief_queue').upsert([{
          batch_key: 'watch:' + acc.username + ':' + m.shortcode,
          chat_id: chatId,
          seq: 0,
          username: acc.username,
          shortcode: m.shortcode,
          permalink: m.permalink,
          status: 'queued',
        }], { onConflict: 'batch_key,shortcode', ignoreDuplicates: true });
        await supabaseAdmin.from('celeb_account_seen')
          .upsert([{ username: acc.username, shortcode: m.shortcode }],
            { onConflict: 'username,shortcode', ignoreDuplicates: true });
        await sendTextToChatSafe(chatId,
          '👀 감지: @' + acc.username + (acc.label ? ' (' + acc.label + ')' : '')
          + ' 새 게시물 — 브리프 준비 중\n' + m.permalink);
      }
      out.queued++;
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
   *   · 전부 꺼짐 (지금 상태)      → produced 0 · remaining 12 → 6회 뒤 '막힘' 경보
   * 세 번째만 울린다. 이게 이 신고가 존재하는 이유다. */
  const note = totalAccounts === 0
    ? '감시 목록이 비어 있음 (등록된 계정 0개)'
    : (accounts.length === 0
      ? '감시 대상 0개 — 등록된 ' + totalAccounts + '개가 전부 비활성(enabled=false)'
      : '폴링 ' + out.polled + '/' + accounts.length + '개 · 기준선 ' + out.baselined
        + ' · 큐 적재 ' + out.queued + '건 · 오류 ' + out.errors.length + '건'
        + (unwatched ? ' · 비활성 ' + unwatched + '개' : ''));
  reportProduction(res, { produced: out.queued, remaining: unwatched, note });

  return res.status(200).json({
    ok: true, dry, ...out,
    accounts: { total: totalAccounts, enabled: accounts.length, unwatched },
  });
});
