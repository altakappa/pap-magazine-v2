/**
 * 마이페이지 모바일 탭 — 재점검 수정 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA: 프로필·구독·활동만 정상, 참여작품·업로드·풀레터는 "엉뚱한 화면으로
 * 이동", 다운로드·알림설정·계정은 "슬라이드해도 안 나온다".
 *
 * ── 실측 (Chrome, 386px 뷰포트 / 라이브 DOM) ────────────────────────
 * 먼저 의심했던 것들은 사실이 아니었다.
 *   · 탭 9개 href 는 전부 #mp-* 로 정상, 대상 섹션 9개도 전부 존재·표시됨
 *   · 가로 스크롤 정상: 트랙 819px / 화면 386px, scrollLeft 0→433 이동 가능
 *   · 히트테스트 정상: 각 탭 중심점에서 elementFromPoint 가 자기 자신을 반환
 * 즉 링크·스크롤·클릭 자체는 멀쩡했다.
 *
 * ── 진짜 원인 두 가지 ───────────────────────────────────────────────
 * (1) 클릭 후 섹션이 고정 헤더+탭바 뒤로 숨었다.
 *     오프셋(scroll-margin-top)이 28px 인데 모바일 가림막은 117px 이다
 *     (.mp-wrapper 의 padding-top 이 그 높이를 이미 알고 있었다).
 *     섹션 높이 실측: 프로필 140 / 구독 274 / 활동 313 —— 참여작품 88 /
 *     업로드 88 / 풀레터 88 / 다운로드 88.
 *     88px 짜리는 117px 가림막 뒤로 통째로 숨어 화면엔 그 다음 섹션이 보이고,
 *     키가 큰 앞의 셋은 일부라도 보였다. QA 가 나눈 3개/3개 경계와 정확히 일치.
 *     추가로 #mp-preferences 는 오프셋 선택자에서 아예 빠져 있었다.
 *
 * (2) 탭이 아닌 것이 탭 트랙에 섞여 있었다.
 *     데스크톱 세로 사이드바 아래쪽에 있던 "관리자 페이지"(admin.html)와
 *     "로그아웃"이 가로 탭바에서는 10·11번째 탭처럼 붙는다(실측 x=630, x=739).
 *     로그아웃은 doLogout() → location.href='/' 이라, 탭을 훑다 잘못 누르면
 *     메인홈으로 이탈한다. QA 의 "메인홈 이동"과 가장 잘 맞는 설명이다.
 *     (다만 이 경로는 재현하지 못했다. 원인 확정이 아니라 제거 대상이다)
 *
 * ── 수정 ────────────────────────────────────────────────────────────
 *  · 가림막 높이를 --mp-chrome 한 곳에 두고 padding-top 과 scroll-margin-top
 *    이 함께 쓴다. 숫자를 두 군데 적으면 한쪽만 고쳤을 때 이 버그가 재발한다.
 *  · 모바일 탭 트랙에서 관리자·로그아웃·구분선 숨김 (로그아웃은 헤더 계정
 *    메뉴에 있어 접근성 유지)
 *  · 탭 터치 높이 확대(10→14px), 트랙 끝 여백으로 "더 있다" 신호
 *  · 활성 탭이 화면 밖이면 트랙 안으로 끌어옴
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 오프셋과 가림막 높이가 같은 출처를 쓸 것 (드리프트 방지)
 *  2. 탭 9개가 빠짐없이 오프셋 대상일 것
 *  3. 탭 아닌 항목이 모바일 트랙에 다시 나타나지 않을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const mp = fs.readFileSync(path.join(ROOT, 'frontend/mypage.html'), 'utf8');

/* 탭 목록은 마크업에서 읽는다 — 테스트에 9개를 박아두면 탭이 늘 때 함께
   깨지지 않고 조용히 옛 사실만 지킨다. */
const TAB_IDS = [...mp.matchAll(/class="mp-side-link"[^>]*href="#(mp-[a-z]+)"|href="#(mp-[a-z]+)"[^>]*class="mp-side-link"/g)]
  .map((m) => m[1] || m[2]);

console.log('\n=== 1. 탭 목록 ===');
t('탭을 마크업에서 읽었다 (' + TAB_IDS.length + '개)', TAB_IDS.length >= 9,
  TAB_IDS.join(', '));
t('모든 탭의 대상 섹션이 존재한다',
  TAB_IDS.every((id) => mp.includes('id="' + id + '"')),
  TAB_IDS.filter((id) => !mp.includes('id="' + id + '"')).join(', ') + ' 없음');

console.log('\n=== 2. 오프셋이 가림막 높이와 같은 출처를 쓰는가 ===');
t('가림막 높이를 --mp-chrome 변수로 정의한다',
  /--mp-chrome:\s*\d+px/.test(mp));
t('.mp-wrapper padding-top 이 그 변수를 쓴다',
  /\.mp-wrapper\{padding-top:var\(--mp-chrome\)\}/.test(mp),
  '숫자를 직접 적으면 오프셋과 어긋난다');
t('scroll-margin-top 도 같은 변수를 쓴다',
  /scroll-margin-top:calc\(var\(--mp-chrome\)/.test(mp),
  '이 둘이 갈리는 순간 섹션이 다시 헤더 뒤로 숨는다');
/* 브레이크포인트마다 변수를 정의해야 한다. 하나라도 빠지면 그 화면폭에서
   상위 값이 새어 들어와 오프셋이 어긋난다. */
const chromeDefs = (mp.match(/--mp-chrome:\s*\d+px/g) || []);
const paddingUses = (mp.match(/padding-top:var\(--mp-chrome\)/g) || []);
t('변수 정의 수와 padding-top 사용 수가 같다 (' + chromeDefs.length + ' / ' + paddingUses.length + ')',
  chromeDefs.length === paddingUses.length && chromeDefs.length >= 3);

console.log('\n=== 3. 오프셋 대상에서 빠진 탭이 없는가 ===');
/* #mp-preferences 가 빠져 있어 알림설정만 오프셋 0 이었던 것이 이번 원인 중 하나. */
const offsetBlocks = [...mp.matchAll(/((?:#mp-[a-z]+,?\s*)+)\{scroll-margin-top:[^}]+\}/g)];
t('오프셋 규칙을 찾았다 (' + offsetBlocks.length + '개)', offsetBlocks.length > 0);
offsetBlocks.forEach((b, i) => {
  const listed = [...b[1].matchAll(/#(mp-[a-z]+)/g)].map((m) => m[1]);
  const missing = TAB_IDS.filter((id) => !listed.includes(id));
  t('오프셋 규칙 #' + (i + 1) + ' 에 모든 탭이 들어있다', missing.length === 0,
    '빠진 탭: ' + missing.join(', ') + ' → 그 탭만 헤더 뒤로 숨는다');
});

console.log('\n=== 4. 탭 아닌 항목이 모바일 트랙에 없는가 ===');
/* 모바일 미디어쿼리 블록만 잘라서 본다. */
const mobileBlock = (mp.match(/@media\(max-width:900px\)\{[\s\S]*?\n\}/) || [''])[0];
t('모바일 미디어쿼리 블록을 찾았다', mobileBlock.length > 0);
t('로그아웃을 트랙에서 숨긴다',
  /\.mp-side-link\.danger\{display:none\}|\.mp-side-link\.danger[^{]*\{[^}]*display:none/.test(mobileBlock),
  '로그아웃은 메인홈으로 보낸다. 탭처럼 붙어 있으면 오조작으로 이탈한다');
t('관리자 페이지를 트랙에서 숨긴다 (JS 인라인 style 을 이겨야 하므로 !important)',
  /#mpSideAdminGroup\{display:none!important\}/.test(mobileBlock),
  'JS 가 인라인으로 display:flex 를 넣으므로 !important 가 없으면 안 먹는다');
t('트랙 끝 여백이 있다 (마지막 탭이 잘려도 "더 있다"가 보이게)',
  /\.mp-side-nav::after\{content:'';flex:0 0 \d+px\}/.test(mobileBlock));
t('탭 터치 높이를 확보했다 (padding 14px)',
  /\.mp-side-link\{padding:14px/.test(mobileBlock),
  '36px 짜리 얇은 띠는 가로로 밀기 어렵다');

console.log('\n=== 5. 활성 탭 자동 노출 ===');
t('활성 탭이 화면 밖이면 트랙 안으로 끌어온다',
  /scrollIntoView\(\{\s*behavior:\s*'smooth',\s*inline:\s*'center'/.test(mp));
t('세로 스크롤은 건드리지 않는다 (읽던 위치가 튀지 않게)',
  /inline:\s*'center',\s*block:\s*'nearest'/.test(mp));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ mypage-tab-offset tests FAILED'); process.exit(1); }
console.log('✅ mypage-tab-offset tests passed');
