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
const { collectSubPosts } = require('../_lib/igSubPosts');
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
        + ' · 큐 적재 ' + out.queued + '건 · 오류 ' + out.errors.length + '건' + offNote);
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

  reportProduction(res, { produced: out.queued, remaining: unwatched,
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
