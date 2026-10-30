/**
 * PAP Magazine — 기사 관련 텔레그램은 전부 'PAP 셀럽속보' 방으로 (2026-10-30 신설)
 *
 * 도메니코 2026-10-30: "기사 관련된 내용은 전부 pap 셀럽속보 방으로 전달하면 돼요."
 *
 * 셀럽속보 방 = celeb-watch(pushAlert)가 쓰는 TELEGRAM_CHAT_IDS 의 첫 방
 *   (10/30 로그 실측: -5490514666 한 곳).
 * 이 모듈을 쓰는 곳 (기사 관련):
 *   · celeb-account-watch  아이돌 계정 새 게시물 알림 (예전: 개인방 PAP Alerts)
 *   · celeb-brief          브리프(기사 초안·캡션·사진)와 웹/인스타 게시 결과 (예전: 링크 보낸 방 = 개인방)
 *   · admin/celeb-carousel-telegram  캐러셀 파일 (예전: 브리프 받은 방)
 *   · admin/telegram-text  기사 초안 텍스트 (예전: 운영 그룹)
 * 기사와 무관한 것(결제·구독·제출·크론 고장·파이프라인 감시)은 그대로 둔다.
 *
 * 우선순위: CELEB_CHAT_ID(직접 지정) → TELEGRAM_CHAT_IDS 첫 방 → (호출부의 예전 방)
 * 예전으로 되돌리기: Vercel 환경변수 CELEB_CHAT_ROUTE=old
 */
'use strict';

function routeOld() {
  return String(process.env.CELEB_CHAT_ROUTE || '').trim().toLowerCase() === 'old';
}

/** 셀럽속보 방 chat_id. 되돌리기 상태거나 설정이 없으면 '' */
function celebChatId() {
  if (routeOld()) return '';
  const direct = String(process.env.CELEB_CHAT_ID || '').trim();
  if (direct) return direct;
  return String(process.env.TELEGRAM_CHAT_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)[0] || '';
}

/** 셀럽속보 방, 없으면 호출부가 원래 쓰던 방 (알림이 사라지지 않게) */
function celebOr(fallback) {
  return celebChatId() || String(fallback || '');
}

module.exports = { celebChatId, celebOr, routeOld };
