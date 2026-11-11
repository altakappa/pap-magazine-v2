/*
 * submission-track-select.test.js — 서브미션 3트랙 갈림길 (2026-11-11, 1단계)
 *
 * ■ 무엇이 바뀌었나
 * `/submission` 은 원래 에디토리얼 폼이었다. 트랙이 셋(에디토리얼·아티클·제보)으로
 * 늘면서 그 자리를 **갈림길 화면**으로 바꾸고, 폼은 `/submission/editorial` 로 옮겼다.
 *
 * 사이트 곳곳(안내 페이지 CTA·마이페이지·메일 템플릿·구독 페이지)의 기존 링크가 전부
 * `/submission` 을 가리킨다. 그 링크들은 **그대로 두고** 갈림길에 도착하게 한다 —
 * 도메니코가 원한 동작이 그것이다.
 *
 * ■ 이 테스트가 지키는 계약
 *  1) 갈림길에 트랙 카드가 **셋** 있고, 아직 안 연 트랙은 **링크가 없다.**
 *     준비 안 된 폼으로 보내면 404 가 되고, 그건 "곧 열림" 보다 나쁘다.
 *  2) 에디토리얼 폼의 **정본 주소(canonical/og:url)가 새 경로**를 가리킨다.
 *     옛 주소를 그대로 두면 구글이 "폼 페이지가 갈림길을 정본이라 주장한다" 로 읽는다.
 *  3) 라우팅 3종(갈림길 rewrite · 폼 rewrite · 옛 파일 301)이 전부 있다.
 *  4) 갈림길에 **한글이 없다.** pap-ui-i18n 은 한글 원문을 사전으로 번역하는 구조라,
 *     한글을 두려면 /i18n/ui/ 사전 8개 언어를 함께 만들어야 한다. 사전 없이 한글을
 *     두면 어떤 언어를 골라도 한글로 남는다(프런트 언어 정책 위반).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

const SEL = 'frontend/submission-select.html';
const selExists = fs.existsSync(path.join(ROOT, SEL));
const PAGE = selExists ? R(SEL) : '';
const FORM = R('frontend/submission.html');
const VERCEL = JSON.parse(R('vercel.json'));

console.log('\n=== 1. 갈림길 화면 ===');
t('파일이 있다', selExists);
/* class="cards" (컨테이너)까지 세지 않도록 card 뒤를 경계로 묶는다 */
const CARD_RE = /class="card(?: [a-z]+)?"/g;
t('트랙 카드가 3개', (PAGE.match(CARD_RE) || []).length === 3,
  String((PAGE.match(CARD_RE) || []).length));
t('에디토리얼 카드가 새 경로로 간다', /href="\/submission\/editorial"/.test(PAGE));
t('에디토리얼 카드만 live', (PAGE.match(/class="card live"/g) || []).length === 1);
t('아직 안 연 트랙은 2개이고 soon 으로 표시', (PAGE.match(/class="card soon"/g) || []).length === 2);
/* 준비 안 된 트랙이 링크를 가지면 404 로 간다 — 그게 이 테스트의 핵심이다. */
const soonBlocks = PAGE.split('class="card soon"').slice(1).map((s) => s.split('</div>\n\n')[0]);
t('준비 중 카드에 href 가 없다', soonBlocks.every((b) => !/href=/.test(b)),
  '준비 안 된 폼으로 보내면 404 가 된다');
t('세 트랙 이름이 다 보인다',
  /Editorial/.test(PAGE) && /Article/.test(PAGE) && /News Tip/.test(PAGE));
t('안내 페이지로 돌아가는 길이 있다', /href="\/submissions"/.test(PAGE));
t('소셜 필수 게재를 알린다', /social channels/i.test(PAGE));

console.log('=== 2. 한글 없음 (사전 없이 두면 번역 안 됨) ===');
/* HTML 주석은 제외한다 — 렌더되지도 번역되지도 않으므로 사전이 필요 없다.
   이 저장소는 주석을 한국어로 쓰는 것이 관례다. 검사 대상은 **보이는 글자**다. */
const VISIBLE = PAGE.replace(/<!--[\s\S]*?-->/g, '');
const hangul = VISIBLE.match(/[가-힣]/g) || [];
t('갈림길의 보이는 글자에 한글이 0자', hangul.length === 0,
  '발견: ' + hangul.slice(0, 20).join('') + ' — 한글을 두려면 /i18n/ui/ 사전 8개 언어가 함께 필요하다');

console.log('=== 3. 폼의 정본 주소가 새 경로 ===');
t('canonical 2곳 모두 /submission/editorial',
  (FORM.match(/rel="canonical" href="https:\/\/www\.pap-magazine\.com\/submission\/editorial"/g) || []).length === 2);
t('og:url 도 새 경로',
  /og:url" content="https:\/\/www\.pap-magazine\.com\/submission\/editorial"/.test(FORM));
t('옛 정본 주소가 남아 있지 않다',
  !/canonical" href="https:\/\/www\.pap-magazine\.com\/submission"/.test(FORM) &&
  !/og:url" content="https:\/\/www\.pap-magazine\.com\/submission"/.test(FORM));

console.log('=== 4. 라우팅 ===');
const rw = VERCEL.rewrites || [];
const rd = VERCEL.redirects || [];
const findRw = (src) => rw.find((r) => r.source === src);
t('/submission → 갈림길', (findRw('/submission') || {}).destination === '/submission-select.html',
  JSON.stringify(findRw('/submission')));
t('/submission/editorial → 폼', (findRw('/submission/editorial') || {}).destination === '/submission.html',
  JSON.stringify(findRw('/submission/editorial')));
const old301 = rd.find((r) => r.source === '/submission.html');
t('/submission.html 은 폼으로 301',
  old301 && old301.destination === '/submission/editorial' && old301.statusCode === 301,
  JSON.stringify(old301));
t('안내 페이지 라우팅은 그대로', (findRw('/submissions') || {}).destination === '/submissions.html');

console.log('=== 5. 기존 링크는 건드리지 않았다 ===');
const GUIDE = R('frontend/submissions.html');
t('안내 페이지 CTA 는 여전히 /submission (= 갈림길)',
  /pap-magazine\.com\/submission"/.test(GUIDE),
  '기존 링크를 그대로 두고 갈림길에 도착시키는 것이 의도다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ submission-track-select tests FAILED'); process.exit(1); }
console.log('✅ submission-track-select tests passed');
