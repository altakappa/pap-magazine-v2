/**
 * GET /api/admin/test-alert — 푸시 알림 채널 점검 (관리자 전용)
 *
 * 텔레그램·카카오톡 환경변수를 설정한 뒤 이 URL 을 한 번 호출하면
 * 실제로 폰이 울리는지 즉시 확인할 수 있다. 응답에 채널별 성공/실패가
 * 그대로 담기므로 어디서 막혔는지도 바로 보인다.
 *
 * 텔레그램 chat_id 를 모를 때: 봇에게 아무 메시지나 보낸 뒤
 *   https://api.telegram.org/bot<TOKEN>/getUpdates
 * 를 열면 chat.id 가 보인다 (그룹은 -100 으로 시작).
 */

const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { pushAlert } = require('../_lib/pushAlert');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  const configured = {
    telegram: !!(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID)),
    kakao: !!(process.env.KAKAO_REST_API_KEY && process.env.KAKAO_REFRESH_TOKEN),
    slack: !!process.env.SLACK_WEBHOOK_URL,
    discord: !!process.env.DISCORD_WEBHOOK_URL,
  };

  const result = await pushAlert({
    title: '✅ PAP 알림 테스트',
    lines: [
      '속보 감시 알림이 이 형태로 도착합니다.',
      '이 메시지가 보이면 채널 연결 성공.',
    ],
    url: 'https://www.pap-magazine.com/admin/news',
    urlLabel: '어드민 열기',
  });

  return res.status(200).json({ ok: true, configured, result });
};
