/**
 * GET /api/cron/withdraw-purge — 예약 탈퇴 계정 정리 (매일)
 *
 * 탈퇴를 신청했지만 이미 결제한 기간이 남아 있던 계정은 즉시 지우지 않고
 * profiles.withdraw_delete_after 에 삭제 예정일을 적어 둔다
 * (api/auth/withdraw.js — 도메니코 정책: "탈퇴해도 한 달치는 이용할 수 있어야").
 * 그 날짜가 지난 계정을 실제로 지우는 것이 이 크론이다.
 *
 * ⚠️ 이 크론이 없으면 예약은 영원히 실행되지 않는다. 탈퇴했다고 믿은 사람의
 *    계정과 개인정보가 그대로 남는다 — 약속 위반이자 개인정보 문제다.
 *
 * 구독은 탈퇴 시점에 이미 해지됐다. 여기서는 결제사를 다시 부르지 않는다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { withCronGuard } = require('../_lib/cronGuard');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

const MAX_PER_RUN = 200; // 폭주 방지

async function handler(req, res) {
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ message: 'CRON_SECRET not configured' });
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  res.locals = res.locals || {};

  const nowIso = new Date().toISOString();
  const stats = { due: 0, deleted: 0, failed: 0 };
  const failures = [];

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, withdraw_delete_after')
      .not('withdraw_delete_after', 'is', null)
      .lt('withdraw_delete_after', nowIso)
      .limit(MAX_PER_RUN);
    if (error) throw new Error(error.message);

    stats.due = (rows || []).length;

    for (const row of rows || []) {
      try {
        const { error: pErr } = await supabaseAdmin.from('profiles').delete().eq('id', row.id);
        if (pErr) throw new Error(pErr.message);
        const { error: aErr } = await supabaseAdmin.auth.admin.deleteUser(row.id);
        if (aErr) {
          // 프로필은 지워졌는데 auth 가 남으면 로그인은 되고 데이터는 없는 상태가 된다.
          console.error('[withdraw-purge] auth 삭제 실패:', row.id, aErr.message);
          failures.push((row.email || row.id) + ' (auth)');
        }
        stats.deleted += 1;
      } catch (e) {
        stats.failed += 1;
        failures.push((row.email || row.id) + ' — ' + e.message);
        console.error('[withdraw-purge] 삭제 실패:', row.id, e.message);
      }
    }

    if (stats.failed || failures.length) {
      sendTextToTelegramSafe('⚠️ 예약 탈퇴 정리 실패 ' + failures.length + '건\n' + failures.slice(0, 10).join('\n'));
    }
    if (stats.deleted) {
      console.log('[withdraw-purge] 정리 완료:', JSON.stringify(stats));
    }
    res.locals.cronNote = `due=${stats.due} deleted=${stats.deleted} failed=${stats.failed}`;
    return res.status(200).json({ message: 'Withdraw purge complete', at: nowIso, ...stats });
  } catch (e) {
    console.error('[withdraw-purge] 실패:', e.message);
    return res.status(500).json({ message: 'Withdraw purge failed', error: e.message });
  }
}

module.exports = withCronGuard('withdraw-purge', handler);
