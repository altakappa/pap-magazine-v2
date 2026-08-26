/**
 * GET /api/cron/send-due-campaigns
 *
 * Vercel Cron entry point. Runs every hour (see vercel.json), picks
 * up any email_campaigns rows where status='scheduled' AND
 * scheduled_at <= now(), and sends them to all consented recipients.
 *
 * Security: Vercel signs cron requests with the CRON_SECRET env var
 * passed as `Authorization: Bearer <secret>`. We reject anything that
 * doesn't carry it so the route can't be triggered by curl/bots.
 *
 * Concurrency: We claim a campaign by flipping status to 'sending'
 * with a guarded UPDATE so two overlapping cron invocations can't
 * double-send. The previous status is restored to 'failed' (with the
 * error) if anything throws below.
 */

const { withCronGuard } = require('../_lib/cronGuard');   // 실행기록·실패알림 (2026-07-30)
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');
const { hasActivePlan } = require('../_lib/subscriptionAccess');

const BATCH_SIZE = 50;          // recipients per fan-out wave
const MAX_CAMPAIGNS_PER_RUN = 5; // process at most N due campaigns per cron tick

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

module.exports = withCronGuard('send-due-campaigns', async function handler(req, res) {
  if (handleCors(req, res)) return;

  // Auth check — Vercel cron passes Bearer <CRON_SECRET>
  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) {
    console.error('[cron/send-due-campaigns] CRON_SECRET env not set — refusing to run');
    return res.status(500).json({ message: 'CRON_SECRET not configured' });
  }
  if (got !== expected) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  // 1) Pull due campaigns
  const nowIso = new Date().toISOString();
  const { data: due, error: dueErr } = await supabaseAdmin
    .from('email_campaigns')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_CAMPAIGNS_PER_RUN);

  if (dueErr) {
    console.error('[cron/send-due-campaigns] fetch error:', dueErr.message);
    return res.status(500).json({ message: dueErr.message });
  }
  if (!due || due.length === 0) {
    return res.status(200).json({ processed: 0, message: 'No due campaigns' });
  }

  const summary = [];

  for (const campaign of due) {
    // 2) Atomically claim — only flip status when it's still 'scheduled'.
    // This stops two overlapping cron invocations from sending the same
    // campaign twice if their clocks line up around the hourly tick.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('email_campaigns')
      .update({ status: 'sending', updated_at: nowIso })
      .eq('id', campaign.id)
      .eq('status', 'scheduled')
      .select()
      .single();

    if (claimErr || !claimed) {
      // Another invocation grabbed it; skip silently.
      summary.push({ id: campaign.id, skipped: true });
      continue;
    }

    try {
      // 3) Fetch recipients — only members with email_consent = true.
      // We pull language, email_language AND country (migration 038)
      // because they feed the locale resolution chain in
      // _lib/emailLocale.js: email_language (explicit newsletter pref)
      // > language (site UI) > country-derived guess > 'en'.
      const { data: recipients, error: recErr } = await supabaseAdmin
        .from('profiles')
        .select('id, email, display_name, language, email_language, country, subscription_plan, subscription_status')
        .eq('email_consent', true)
        .not('email', 'is', null);
      if (recErr) throw recErr;

      let recipientList = (recipients || []).filter(r => r.email);

      /* 3-b) 대상 세그먼트 (2026-08-26 — 유료 구독자 늘리기 1탄-②).
       *
       * payload.audience === 'submitters_free' 인 캠페인은 전체 수신동의
       * 회원이 아니라 「서브미션을 낸 적이 있는 무료 회원」에게만 나간다.
       *   - 제출자 판정: submissions.user_id (distinct)
       *   - 무료 판정: hasActivePlan(profile,'standard') === false
       *     (subscriptionAccess.js 의 단일 진실원천 — plan 과 status 를
       *      함께 본다. 이미 유료인 사람에게 구독 권유를 보내면 안 된다.)
       * audience 값이 없으면 기존과 동일하게 전체 발송 — 주간 뉴스레터
       * 캠페인들의 동작은 바뀌지 않는다. */
      const audience = campaign.payload && campaign.payload.audience;
      if (audience === 'submitters_free') {
        const { data: subRows, error: subErr } = await supabaseAdmin
          .from('submissions')
          .select('user_id');
        if (subErr) throw subErr;
        const submitterIds = new Set((subRows || []).map(r => r.user_id).filter(Boolean));
        recipientList = recipientList.filter(r =>
          submitterIds.has(r.id) && !hasActivePlan(r, 'standard'));
      } else if (audience) {
        // 모르는 audience 값은 조용히 전체 발송하지 말고 실패시킨다 —
        // 「누구에게 갔는지 모르는 발송」이 최악이다.
        throw new Error(`Unknown campaign audience "${audience}"`);
      }

      let sent = 0, failed = 0;

      // Pick the template module-side from the campaign type.
      const templateFn = campaign.type === 'editorial-weekly'
        ? templates.weeklyEditorial
        : campaign.type === 'news-weekly'
          ? templates.weeklyNews
          : campaign.type === 'creator-pullletter'
            ? templates.creatorPullletter
            : null;
      if (!templateFn) {
        throw new Error(`No template for campaign type "${campaign.type}"`);
      }

      // 4) Send in batches with per-recipient try/catch so one bad
      // address doesn't sink the rest. Promise.allSettled tolerates
      // individual rejections — we record outcomes either way.
      for (const batch of chunk(recipientList, BATCH_SIZE)) {
        await Promise.allSettled(batch.map(async (user) => {
          // Mint a per-recipient unsubscribe token. Single-use; redeemed
          // when the user clicks the link in their email.
          const { data: tok, error: tokErr } = await supabaseAdmin
            .from('email_unsubscribe_tokens')
            .insert({ user_id: user.id, campaign_id: campaign.id })
            .select('token')
            .single();
          if (tokErr) throw tokErr;

          try {
            // Collapse the locale columns into the single `language`
            // field the template consumes. Precedence (emailLocale.js):
            // email_language (explicit newsletter pref) > language
            // (site UI) > countryToLang(country) > 'en'. Done inline
            // per-user so we don't mutate the original profiles row.
            const renderUser = {
              ...user,
              language: resolveEmailLang(user),
            };
            const built = templateFn(campaign, renderUser, tok.token);

            /* 일시 오류 1회 재시도 (2026-08-26 실측 후속).
             * 첫 creator-pullletter 발송에서 28통 중 3통이 Gmail SMTP
             * 421 'Temporary System Problem' 으로 죽었다 — 주소 문제가
             * 아니라 배치를 한꺼번에 쏘면서 순간적으로 막힌 것.
             * 4xx 일시 계열(421·4.3.0·try again)만 5초 뒤 정확히 1회
             * 재시도한다. 영구 오류(550 주소 없음 등)는 재시도해도
             * 같은 답이므로 그대로 실패 기록. */
            const TRANSIENT_RE = /\b421\b|4\.[0-9]\.[0-9]|try again|temporar/i;
            let result = await sendEmail(user.email, built);
            if (!(result && result.sent === true)
                && TRANSIENT_RE.test(String((result && result.error) || ''))) {
              await new Promise((r) => setTimeout(r, 5000));
              result = await sendEmail(user.email, built);
            }
            const ok = result && result.sent === true;

            await supabaseAdmin.from('email_log').insert({
              campaign_id: campaign.id,
              user_id: user.id,
              email: user.email,
              status: ok ? 'sent' : 'failed',
              error: ok ? null : (result && result.error) || 'unknown',
              sent_at: ok ? new Date().toISOString() : null,
            });
            if (ok) sent++; else failed++;
          } catch (sendErr) {
            await supabaseAdmin.from('email_log').insert({
              campaign_id: campaign.id,
              user_id: user.id,
              email: user.email,
              status: 'failed',
              error: (sendErr.message || String(sendErr)).slice(0, 500),
            });
            failed++;
          }
        }));
      }

      /* 5) 결과 표시.
       *
       * 2026-08-07 — 예전엔 무조건 'sent' 로 찍었다. 그러면 한 통도 못 나간
       * 캠페인이 대시보드에 '발송 완료' 로 뜬다. SMTP 가 꺼져 있으면
       * sendEmail 이 {skipped:true} 를 돌려주고 전원이 failed 로 쌓이는데,
       * 캠페인은 'sent' 였다 — 오늘 하루 종일 쫓던 '돌았다 ≠ 했다' 그대로다.
       * 받는 사람이 있었는데 한 통도 못 갔으면 그건 실패다. */
      const allFailed = recipientList.length > 0 && sent === 0;
      await supabaseAdmin
        .from('email_campaigns')
        .update({
          status: allFailed ? 'failed' : 'sent',
          sent_at: new Date().toISOString(),
          recipient_count: recipientList.length,
          sent_count: sent,
          failed_count: failed,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      summary.push({ id: campaign.id, sent, failed, recipients: recipientList.length });
    } catch (err) {
      console.error('[cron/send-due-campaigns] campaign failed:', campaign.id, err.message || err);
      await supabaseAdmin
        .from('email_campaigns')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);
      summary.push({ id: campaign.id, error: err.message || String(err) });
    }
  }

  return res.status(200).json({ processed: due.length, summary });
});
