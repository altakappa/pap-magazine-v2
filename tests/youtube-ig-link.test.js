/**
 * 유튜브 설명란 IG 유입 링크 + 경로형 계측 (2026-07-30 신설, 도메니코 요청).
 *
 * 배경: "유튜브에 인스타 주소도 적어서 유입을 늘리고 싶은데 패널티가 있나?"
 *   → 유튜브 정책상 외부 링크 자체는 제재 대상이 아니다(가이드라인 위반
 *     사이트·멀웨어·스팸만). 다만 설명란 첫 줄부터 링크로 도배하면 스팸
 *     신호가 되므로 본문 뒤에 둔다.
 *
 * 계측을 붙인 이유: 직링크로 두면 "유튜브가 실제로 인스타 유입을 만드는가" 를
 * 영영 알 수 없다. PAP 에서 이미 두 번 겪은 문제다 — IG 버튼 직링크(B-2)와
 * 미디어킷 드라이브 직링크. 측정 지점이 없으면 최적화 판단도 없다.
 *
 * 경로형(/ig/youtube)인 이유: 미디어킷 실측(2026-07-29) — 링크가 외부 앱을
 * 거치면 추적성 쿼리 파라미터가 지워지거나 재작성된다. 경로 세그먼트는 중간
 * 매개체가 건드리지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

console.log('\n=== 설명란 문안 ===');
(function () {
  const src = R('api/cron/youtube-post.js');
  t('IG 링크가 들어간다', /\/ig\/youtube/.test(src));
  t('직링크(instagram.com)를 쓰지 않는다', !/instagram\.com/.test(src),
    '직링크면 유입을 셀 수 없다 — 계측 경유가 목적이다');
  // 스팸 신호 방지: 제목·본문 뒤에 링크가 와야 한다
  const iTitle = src.indexOf("art.title + ' — PAP MAGAZINE'");
  const iIg = src.indexOf('/ig/youtube');
  t('링크는 제목·본문 뒤에 온다 (스팸 신호 회피)', iTitle > -1 && iIg > iTitle);
  t('기사 링크도 함께 유지', /기사 전문/.test(src));
  t('도메인은 환경변수 우선', /NEXT_PUBLIC_SITE_URL/.test(src));
})();

console.log('=== 경로형 계측 /ig/:src ===');
(function () {
  const src = R('api/ig-out.js');
  t('경로 세그먼트에서 src 를 읽는다', /function readPathSrc/.test(src));
  t('쿼리가 있으면 쿼리 우선', /req\.query\.src \|\| pathSrc/.test(src));
  t('youtube 가 화이트리스트에 있다', /'youtube'/.test(src),
    '없으면 other 로 뭉개져 유튜브 기여도를 분리할 수 없다');
  t('url 없이 오면 공식 프로필로', /PROFILE_URL/.test(src) && /pathSrc \? PROFILE_URL : null/.test(src));
  t('목적지는 코드 내장 값만 (오픈 리다이렉터 방지)',
    /const PROFILE_URL = 'https:\/\/www\.instagram\.com\//.test(src));
  t('쿼리 url 검증은 그대로 유지', /normalizeIgUrl\(req\.query\.url\)/.test(src));
  t('src 정규화로 로그 오염 차단', /replace\(\/\[\^a-z0-9_-\]\/g, ''\)/.test(src));
})();

console.log('=== 라우팅 ===');
(function () {
  const vercel = JSON.parse(R('vercel.json'));
  const rw = (vercel.rewrites || []).find((r) => r.source === '/ig/:src');
  t('/ig/:src → /api/ig-out 리라이트 등록', !!rw && rw.destination === '/api/ig-out');
  // 경로형 계측의 선례(미디어킷)와 같은 패턴인지 — 규칙이 흩어지면 다음 사람이 헷갈린다
  const mk = (vercel.rewrites || []).find((r) => r.source === '/mediakit/:src');
  t('미디어킷과 같은 경로형 패턴', !!mk && mk.destination === '/api/mediakit');
})();

console.log('=== 봇 필터가 그대로인가 (계측 오염 방지) ===');
(function () {
  const src = R('api/ig-out.js');
  t('두 판별기를 OR 로 유지', /isLikelyBot\(_ua\) \|\| isBot\(_ua\)/.test(src),
    '2026-07-29 스파이크 교훈 — 한쪽만으로는 새 크롤러를 놓친다');
  t('레이트리밋 유지', /rateLimitStrict/.test(src));
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ youtube-ig-link tests FAILED'); process.exit(1); }
console.log('✅ youtube-ig-link tests passed');
