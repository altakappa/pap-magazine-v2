'use strict';
/**
 * 인스타 아이디 등록 알림 (2026-10-03, 도메니코 "속이면?" → 두 겹 중 첫 겹).
 * 회원이 인스타 아이디를 새로 적거나 바꾸면, 그 아이디가 적힌 화보 크레딧이 몇 편인지 세서
 * 도메니코에게 텔레그램을 보낸다. 가짜(남의 아이디)를 사람이 걸러낼 수 있게. 둘째 겹은 instagram_verified_at 도장.
 * 실패해도 저장은 막지 않는다.
 */
const { sendTextToTelegramSafe } = require('./telegram');

/** 크레딧 jsonb 에 이 핸들(@ 유무 모두)이 적힌 게재 화보 수 */
async function countCreditedEditorials(db, handle) {
  const h = String(handle || '').toLowerCase().replace(/^@/, '');
  if (!db || !h) return 0;
  let n = 0;
  for (const v of [h, '@' + h]) {
    try {
      const { count } = await db.from('editorials').select('id', { count: 'exact', head: true })
        .eq('status', 'published').contains('credits', [{ instagram: v }]);
      n += Number(count || 0);
    } catch (_) { /* 세기 실패는 0 */ }
  }
  return n;
}

/**
 * credited 를 넘기면 다시 세지 않는다(me.js 가 도장 판정에 쓴 값 그대로).
 * autoVerified=true 면 "0편이라 자동 도장" 안내 — 도메니코가 할 일이 없다 (2026-10-14).
 */
async function alertInstagramClaim(db, { email, userId, handle, previous, credited, autoVerified }) {
  try {
    const n = (typeof credited === 'number') ? credited : await countCreditedEditorials(db, handle);
    const text = '🪪 인스타 아이디 ' + (previous ? '변경' : '등록') + ': ' + (email || userId) + ' → @' + handle
      + (previous ? ' (전: @' + previous + ')' : '')
      + '\n크레딧에 이 아이디가 적힌 게재 화보: ' + n + '편'
      + (autoVerified
        ? '\n✅ 0편이라 자동으로 확인 도장을 찍었다. 할 일 없음.'
        : '\n확인 전엔 연락 버튼·프리미엄 배지가 안 붙는다. 인스타에서 본인 계정인지 보고 관리자 → 회원 → IG 확인 도장.');
    await sendTextToTelegramSafe(text);
    return { credited: n };
  } catch (e) {
    console.warn('[instagramClaimAlert]', e && e.message);
    return { credited: 0, error: (e && e.message) || String(e) };
  }
}

module.exports = { countCreditedEditorials, alertInstagramClaim };
