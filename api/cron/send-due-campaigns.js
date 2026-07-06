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

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');

const BATCH_SIZE = 50;          // recipients per fan-out wave
const MAX_CAMPAIGNS_PER_RUN = 5; // process at most N due campaigns per cron tick

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

module.exports = async function handler(req, res) {
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
        .select('id, email, display_name, language, email_language, country')
        .eq('email_consent', true)
        .not('email', 'is', null);
      if (recErr) throw recErr;

      const recipientList = (recipients || []).filter(r => r.email);
      let sent = 0, failed = 0;

      // Pick the template module-side from the campaign type.
      const templateFn = campaign.type === 'editorial-weekly'
        ? templates.weeklyEditorial
        : campaign.type === 'news-weekly'
          ? templates.weeklyNews
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
            const result = await sendEmail(user.email, built);
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

      // 5) Mark campaign sent.
      await supabaseAdmin
        .from('email_campaigns')
        .update({
          status: 'sent',
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
};
