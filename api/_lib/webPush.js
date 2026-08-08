/**
 * 웹 푸시 발송 — api/_lib/webPush.js (B-7, 2026-08-09)
 *
 * 왜: 부스트 실측에서 드러난 사실 — 스레드 평균 조회 33회, X 는 그 이하.
 * "점화 부대"가 될 수 있는 자체 즉시 채널이 없었다. 웹 푸시는 회원·방문자를
 * 게시 순간 동원할 수 있는 유일한 자체 채널이다.
 *
 * 알림은 신뢰 자산이다 — 규칙:
 *   - 하루 최대 2건 (넘으면 침묵 — 스팸 한 번이면 구독 해지 사태)
 *   - 에디토리얼(주력 콘텐츠)만. 뉴스 기사 3~8건/일을 다 쏘면 끝장난다
 *   - 410/404 응답 구독은 즉시 비활성 (죽은 구독에 재발송 금지)
 *   - VAPID env 미설정이면 전부 조용히 no-op (배포 안전)
 *
 * web-push 는 함수 안에서 lazy require — cronGuard 도달 모듈의 최상단
 * npm require 금지 규칙(no-eager-npm-deps) 준수.
 */

'use strict';

const { supabaseAdmin } = require('./supabase');

const DAILY_CAP = Math.max(1, parseInt(process.env.PUSH_DAILY_CAP || '2', 10) || 2);
const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';

function configured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function underDailyCap() {
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabaseAdmin.from('push_broadcasts')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', dayStart.toISOString());
  if (error) throw error;
  return (count || 0) < DAILY_CAP;
}

/**
 * 새 화보 알림 브로드캐스트. 실패해도 던지지 않는다 (호출부는 부스트 —
 * 알림 실패가 부스트·수집을 못 막는다).
 * @param {{postId, permalink, title}} p
 */
async function broadcastNewPost(p) {
  try {
    if (!configured()) return { sent: 0, reason: 'vapid-미설정' };
    if (!(await underDailyCap())) return { sent: 0, reason: 'daily-cap' };

    const { data: subs, error } = await supabaseAdmin.from('push_subscriptions')
      .select('endpoint, p256dh, auth').is('disabled_at', null).limit(5000);
    if (error) throw error;
    if (!subs || !subs.length) return { sent: 0, reason: 'no-subs' };

    const webpush = require('web-push'); // lazy — no-eager-npm-deps
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:contact@pap-magazine.com',
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY
    );

    const clean = String(p.permalink || '').split('?')[0];
    const payload = JSON.stringify({
      title: p.title || 'PAP MAGAZINE',
      body: '새 화보가 공개됐습니다 — 지금 가장 먼저 보기',
      url: SITE + '/api/ig-out?src=push&to=post&url=' + encodeURIComponent(clean),
    });

    let sent = 0, failed = 0;
    const dead = [];
    for (let i = 0; i < subs.length; i += 50) {
      const chunk = subs.slice(i, i + 50);
      const rs = await Promise.allSettled(chunk.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload, { TTL: 3600 }
        )
      ));
      rs.forEach((r, j) => {
        if (r.status === 'fulfilled') { sent++; return; }
        failed++;
        const code = r.reason && r.reason.statusCode;
        if (code === 404 || code === 410) dead.push(chunk[j].endpoint);
      });
    }
    if (dead.length) {
      await supabaseAdmin.from('push_subscriptions')
        .update({ disabled_at: new Date().toISOString() }).in('endpoint', dead);
    }
    await supabaseAdmin.from('push_broadcasts')
      .insert({ post_id: String(p.postId || ''), title: (p.title || '').slice(0, 200), sent, failed });
    return { sent, failed, dead: dead.length };
  } catch (e) {
    console.warn('[webPush] broadcast 실패:', (e && e.message) || e);
    return { sent: 0, reason: String((e && e.message) || e).slice(0, 120) };
  }
}

module.exports = { broadcastNewPost, configured, DAILY_CAP };
