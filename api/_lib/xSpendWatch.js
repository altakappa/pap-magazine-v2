/**
 * X API 지출 한도(spend cap) 소진을 원인 단계에서 잡아 개인 텔레그램으로 알린다 (2026-11-02 신설)
 *
 * 왜: 2026-10-23 11:26 KST 부터 X 가 모든 게시를 HTTP 403 "Your monthly spend cap has been
 * reached." 로 거부했다. 11/02 까지 magazine 계정 140건이 전부 실패했고, X 유입이 하루
 * 15~40명에서 2~5명으로 떨어졌다. 그런데 아무 알림이 없었다 — postTweet 은 실패를 x_posts 에
 * 적기만 하고, 주간 브리핑의 발행 장부는 시도 건수를 '발행' 으로 셌다.
 * 조치가 명확한 장애(한도 상향 = 결제, 도메니코 몫)라서 즉시 알리는 게 맞다. aiCreditWatch 와 같은 설계.
 *
 * 설계:
 *   · 절대 throw 하지 않는다. 감시가 게시 경로를 죽이면 본말전도다.
 *   · 쿨다운 12시간 — 하루 20번 넘게 게시를 시도하므로 없으면 수십 통이 온다.
 *   · PAP(magazine) 계정만. 페퍼릿은 도메니코가 따로 처리한다.
 *   · supabase·pushAlert 는 알릴 때만 늦게 불러온다(xPost 를 require 하는 테스트가 env 없이 돈다).
 */
'use strict';

const ALERT_KEY = 'x_spend_cap';
const COOLDOWN_H = 12;

/** X 응답이 지출 한도 소진인가 (순수 함수) */
function isSpendCap(status, detail) {
  if (Number(status) !== 403) return false;
  return /spend-cap-reached|spend cap has been reached/i.test(String(detail || ''));
}

/**
 * @param {{status:number, detail:string, account:string}} f
 * @returns {Promise<{spendCap:boolean, alerted:boolean}>}
 */
async function reportXFailure(f) {
  const spendCap = isSpendCap(f && f.status, f && f.detail);
  if (!spendCap || (f.account && f.account !== 'magazine')) return { spendCap, alerted: false };
  if (!process.env.SUPABASE_URL) return { spendCap, alerted: false };   // 테스트·로컬
  try {
    const { supabaseAdmin } = require('./supabase');
    const { pushAlert } = require('./pushAlert');
    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at').eq('key', ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    if (Date.now() - lastAt < COOLDOWN_H * 3600000) return { spendCap, alerted: false };

    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { count } = await supabaseAdmin.from('x_posts').select('*', { count: 'exact', head: true })
      .eq('account', 'magazine').eq('ok', false).ilike('error', '%spend%').gte('created_at', since);
    await pushAlert({
      personalOnly: true,
      title: '🚫 X 게시 중단 — API 월 지출 한도 소진',
      lines: [
        'X 가 모든 게시를 거부하고 있습니다 (HTTP 403 spend cap reached).',
        '최근 7일 실패: ' + (count == null ? '?' : count) + '건. 글이 X 에 하나도 안 올라갑니다.',
        '조치: X 개발자 콘솔 → 결제(Billing) → 지출 한도(spend cap) 상향 또는 크레딧 충전.',
        '링크 포함 게시는 1건에 약 $0.20 (2026-10 기준). 하루 23건이면 월 약 $140.',
      ],
      url: 'https://console.x.com', urlLabel: 'X 콘솔',
    });
    await supabaseAdmin.from('ops_alert_state').upsert({
      key: ALERT_KEY, last_alert_at: new Date().toISOString(),
      last_payload: { status: 403, failed_7d: count == null ? null : count },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    return { spendCap, alerted: true };
  } catch (e) {
    console.error('[xSpendWatch] 알림 실패', e && e.message);
    return { spendCap, alerted: false };
  }
}

module.exports = { isSpendCap, reportXFailure, ALERT_KEY, COOLDOWN_H };
