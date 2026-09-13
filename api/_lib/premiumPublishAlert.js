'use strict';
/**
 * 프리미엄 회원 에디토리얼 게재 알림 문구 (도메니코 2026-09-13).
 *   "3번은 릴스 편집은 제외하고 인스타그램 피드 + 스토리 포스팅 보장으로 변경."
 * 프리미엄 회원의 에디토리얼이 처음 공개되는 순간 운영자 텔레그램에 붙는 문구.
 * 비프리미엄은 에디터 재량(문구 없음). 릴스는 보장하지 않는다.
 */
function premiumPublishAlertText(editorial, profile) {
  const title = String((editorial && editorial.title) || '').slice(0, 80);
  const slug = (editorial && editorial.slug) ? String(editorial.slug) : '';
  const ig = profile && profile.instagram ? '@' + String(profile.instagram).replace(/^@/, '') : '';
  const who = (profile && (profile.display_name || profile.email)) || '';
  return '⭐ 프리미엄 회원 에디토리얼 게재 — 인스타그램 피드 + 스토리 포스팅 보장 대상'
    + '\n제목: ' + title
    + (slug ? '\n페이지: https://www.pap-magazine.com/editorial/' + encodeURIComponent(slug) : '')
    + '\n크리에이터: ' + String(who).slice(0, 60) + (ig ? ' (' + ig + ')' : '')
    + '\n할 일: ① 피드 포스팅 ② 스토리 포스팅' + (ig ? ' (' + ig + ' 태그)' : '') + ' — 릴스는 보장 대상 아님';
}
module.exports = { premiumPublishAlertText };
