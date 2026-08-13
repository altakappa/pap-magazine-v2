/**
 * 게재료 결제 승인 SLA 스윕 — 2026-08-12 (도메니코 "2일 내 무조건 검토")
 *
 * ■ 이 크론이 있어야 2일 약속이 코드로 지켜진다
 *   제출 시 카드에 €380/€790 이 묶인다. 심사가 늦어지면 크리에이터 돈이
 *   이유 없이 잠긴 채로 남는다. PayPal Honor Period(3일)를 넘기면 우리도
 *   캡처하지 못해 아무도 이득이 없다.
 *
 *   그래서 SLA(48h)를 넘긴 미심사 건은 자동으로 **보이드**한다.
 *   보이드는 환불이 아니다 — 돈이 빠진 적이 없다. 묶인 한도를 푸는 것이다.
 *
 * ■ 두 가지 일을 한다
 *   1) 마감 임박(12시간 이내) 건 → 도메니코에게 알림. 아직 심사할 시간이 있다.
 *   2) 마감 초과 건 → 보이드 + status='pending' 유지 + 알림.
 *      서브미션 자체는 지우지 않는다. 크리에이터가 다시 결제 승인하면 살아난다.
 *
 * ■ 심사가 끝난 건은 건드리지 않는다
 *   payment_status='authorized' 인 건만 본다. 승인되면 'paid', 거절되면
 *   'voided' 로 바뀌므로 자연히 대상에서 빠진다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { withCronGuard } = require('../_lib/cronGuard');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const {
  voidAuthorization, isAlreadySettled, slaDeadlineFrom, REVIEW_SLA_HOURS,
} = require('../_lib/paypalAuthorizations');

// 마감까지 이만큼 남았으면 "곧 만료" 로 알린다.
const WARN_WITHIN_HOURS = 12;
// 한 번에 처리할 최대 건수 — 폭주해도 함수 시간 안에 끝나게 한다.
const MAX_PER_RUN = 50;

module.exports = withCronGuard('submission-authorization-sweep', async function handler(req, res) {
  // 예약 실행만 허용한다 — 돈(PayPal 보이드)을 건드리는 크론은 전부 이 검사를
  // 한다(withdraw-purge / subscription-expiry-sweep 등). 이 크론만 빠져 있었다.
  // 남이 불러도 SLA 넘긴 건만 처리되니 돈이 새진 않지만, 무제한 호출로 PayPal
  // 레이트리밋·함수 비용·텔레그램 도배가 가능하다. (2026-08-13)
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ message: 'CRON_SECRET not configured' });
  }
  if ((req.headers.authorization || '') !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  // 🔴 Vercel 서버리스의 res 에는 locals 가 없다. 이 한 줄이 없으면 맨 아래
  //   res.locals.cronNote 대입에서 죽는다 — 할 일을 다 끝낸 직후에. 실측:
  //   6번 실행 6번 전부 500(2026-08-13). 돈은 안전했지만 매번 거짓 실패
  //   알림이 나갔다. 거짓 경보가 쌓이면 진짜 고장을 아무도 안 믿는다.
  res.locals = res.locals || {};

  const now = Date.now();
  const stats = { scanned: 0, warned: 0, voided: 0, failed: 0 };

  const { data: rows, error } = await supabaseAdmin
    .from('submissions')
    .select('id, title, status, payment_status, paypal_authorization_id, authorized_at')
    .eq('payment_status', 'authorized')
    .not('paypal_authorization_id', 'is', null)
    .order('authorized_at', { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) throw error;

  stats.scanned = (rows || []).length;
  const warnList = [];
  const voidList = [];
  const failList = [];

  for (const row of rows || []) {
    if (!row.authorized_at) continue;
    const deadline = new Date(slaDeadlineFrom(row.authorized_at)).getTime();
    const hoursLeft = (deadline - now) / 3600000;

    if (hoursLeft > 0) {
      if (hoursLeft <= WARN_WITHIN_HOURS) {
        warnList.push('· ' + (row.title || row.id) + ' — 남은 시간 ' + hoursLeft.toFixed(1) + 'h');
        stats.warned += 1;
      }
      continue;
    }

    // 마감 초과 — 묶인 돈을 푼다.
    const v = await voidAuthorization(row.paypal_authorization_id);
    if (!v.ok && !isAlreadySettled(v.code)) {
      failList.push('· ' + (row.title || row.id) + ' — void 실패 ' + (v.code || v.status));
      stats.failed += 1;
      continue;
    }
    const { error: upErr } = await supabaseAdmin.from('submissions').update({
      payment_status: 'awaiting_authorization',
      authorization_voided_at: new Date().toISOString(),
      paypal_authorization_id: null,
      authorized_at: null,
      authorization_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (upErr) {
      failList.push('· ' + (row.title || row.id) + ' — 보이드는 됐으나 DB 반영 실패');
      stats.failed += 1;
      continue;
    }
    voidList.push('· ' + (row.title || row.id));
    stats.voided += 1;
  }

  // 알림은 반드시 await 한다 — 서버리스는 응답 반환 후 함수를 얼린다(6a13439).
  if (warnList.length) {
    await sendTextToTelegramSafe('⏳ 게재료 심사 마감 임박 ' + warnList.length + '건 ('
      + REVIEW_SLA_HOURS + '시간 SLA)\n' + warnList.slice(0, 20).join('\n')
      + '\n\n지금 심사하지 않으면 자동으로 승인이 취소됩니다(청구 없음).');
  }
  if (voidList.length) {
    await sendTextToTelegramSafe('🔓 SLA 초과로 결제 승인 자동 취소 ' + voidList.length + '건\n'
      + voidList.slice(0, 20).join('\n')
      + '\n\n청구되지 않았습니다. 서브미션은 남아 있고, 크리에이터가 다시 결제 승인하면 심사할 수 있습니다.');
  }
  if (failList.length) {
    await sendTextToTelegramSafe('🚨 결제 승인 취소 실패 ' + failList.length + '건 — 수동 확인 필요\n'
      + failList.slice(0, 20).join('\n')
      + '\nPayPal 에서 직접 void 해 주세요. 두면 크리에이터 한도가 계속 잠깁니다.');
  }

  res.locals.cronNote = 'scanned=' + stats.scanned + ' warned=' + stats.warned
    + ' voided=' + stats.voided + ' failed=' + stats.failed;
  return res.status(200).json({ ok: true, ...stats });
});
