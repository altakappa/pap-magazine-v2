/*
 * community-xss-lockdown.test.js — 2026-11-07 보안감사 H-1 · H-2 · M-3~M-7 회귀 가드
 *
 * ■ 무슨 일이 있었나 (실측)
 * 커뮤니티 글 본문·제목·작성자 이름이 **이스케이프 없이** innerHTML 로 들어가고 있었다.
 *   저장: api/community/posts/index.js 가 title·content 를 그대로 INSERT (길이 제한도 없음)
 *   출력: frontend/community.html 의 openPost() 가 tPost(post.content,post) 를 날것으로 삽입
 *   실행: vercel.json 의 CSP 가 script-src 'unsafe-inline' 이라 <img onerror> 가 그대로 실행
 * 무료 회원 1명이 글 하나로 커뮤니티를 보는 **모든 방문자(관리자 포함)** 브라우저에서
 * 스크립트를 돌릴 수 있었다. pap_auth 쿠키는 HttpOnly 라 탈취는 막히지만, XSS 는 같은
 * 출처에서 fetch(..., {credentials:'include'}) 를 쓸 수 있다 — 관리자가 그 글을 열면
 * 그 세션으로 /api/admin/* 을 호출할 수 있었다. 사실상 관리자 권한 탈취 경로였다.
 *
 * 작성자 이름은 `onclick="openProfile('…')"` 의 **JS 문자열 자리**에 들어갔다. 값의 출처는
 * api/auth/me.js 의 name(길이 제한·정제 없음)과 OAuth 의 meta.full_name 이다.
 *
 * 함께 닫은 것 — 공개 anon 키만으로 로그인 없이 INSERT 가 되던 표 5개
 * (affiliate_clicks · community_badges · community_notifications · community_post_views ·
 *  editorial_views). 테이블 GRANT 와 `with_check: true` 정책이 동시에 열려 있었다.
 * RLS 를 켜도 정책이 true 면 아무 조건 없이 통과한다 — 착각하기 쉬운 지점이다.
 *
 * ■ 이 테스트가 지키는 계약
 *  1) community.html 의 DB 유래 값은 전부 escHtml / escJsAttr / papSanitizeHtml 를 거친다.
 *  2) papSanitizeHtml 은 **허용 목록** 방식이고, 파싱을 DOMParser 에 맡기고, 실패 시
 *     서식을 포기한다(fail-closed). 정규식 파싱 살균기로 되돌리는 것을 막는다.
 *  3) URL 스킴 검사 함수는 javascript:·data:text/html 을 통과시키지 않는다 — **실제 실행**으로 잰다.
 *  4) 저장 단계(api)에도 길이 상한·거부 목록·태그 화이트리스트가 걸려 있다.
 *  5) 프런트가 anon 키로 community_post_views 에 직접 INSERT 하지 않는다(서버 경유).
 *  6) 마이그레이션 181 이 정책 5개를 지우고 그랜트를 회수한다.
 *
 * ■ 왜 브라우저 테스트가 아닌가
 * papSanitizeHtml 본체는 DOMParser 를 쓰므로 Node 에서는 못 돌린다(이 저장소 하네스는
 * 브라우저 없이 돈다 — Vercel 배포 게이트에서도 같은 하네스가 돈다). 실제 Chromium 에서
 * XSS 페이로드 25종을 넣어 **0건 실행**을 확인한 것은 작업 당시 수동으로 했고, 여기서는
 * 브라우저가 필요 없는 부분(스킴 검사·escJsAttr·소스 계약)을 실행·검사로 잠근다.
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

const HTML = R('frontend/community.html');
const V2 = R('frontend/community-v2.js');

// ───────────────────────────────────────────────────────────────
console.log('\n=== 1. 출력 싱크가 전부 감싸져 있다 (H-1·H-2) ===');

t('목록 제목: escHtml(tPost(p.title,p))', HTML.includes('escHtml(tPost(p.title,p))'));
t('상세 제목: escHtml(tPost(post.title,post))', HTML.includes('escHtml(tPost(post.title,post))'));
t('상세 본문: papSanitizeHtml(tPost(post.content,post))', HTML.includes('papSanitizeHtml(tPost(post.content,post))'));
t('목록 작성자 onclick: escJsAttr(p.author)', HTML.includes('escJsAttr(p.author)'));
t('상세 작성자 onclick: escJsAttr(post.author)', HTML.includes('escJsAttr(post.author)'));
t('상세 작성자 텍스트: escHtml(post.author)', HTML.includes('escHtml(post.author)'));
t('작성자 배지 class: escHtml(post.level)', HTML.includes("escHtml(post.level)"));
t('상세 역할: escHtml(post.role)', HTML.includes('escHtml(post.role)'));

/* 되돌림 방지 — 날것 삽입 패턴이 하나라도 되살아나면 실패한다.
   (문자열 연결 안에서 DB 값이 escape 없이 들어가는 형태를 직접 찾는다) */
const RAW_SINKS = [
  { pat: /\+tPost\(p\.title,p\)\+/, why: '목록 제목이 날것으로 돌아갔다' },
  { pat: /\+tPost\(post\.title,post\)\+/, why: '상세 제목이 날것으로 돌아갔다' },
  { pat: /\+tPost\(post\.content,post\)\+/, why: '상세 본문이 날것으로 돌아갔다 — 저장형 XSS 재발' },
  { pat: /openProfile\(\\'\+p\.author\+\\'/, why: "작성자명이 onclick 홑따옴표 안으로 돌아갔다" },
  { pat: /openProfile\(\\'\+post\.author\+\\'/, why: "작성자명이 onclick 홑따옴표 안으로 돌아갔다" },
  { pat: /">'\+post\.author\+'</, why: '작성자명이 텍스트 노드로 날것 삽입됐다' },
];
for (const s of RAW_SINKS) t('날것 삽입 없음: ' + s.why, !s.pat.test(HTML), s.why);

// ───────────────────────────────────────────────────────────────
console.log('=== 2. papSanitizeHtml 의 설계 계약 ===');

t('papSanitizeHtml 가 정의돼 있다', /function papSanitizeHtml\s*\(/.test(HTML));
t('파싱을 DOMParser 에 맡긴다 (정규식 파싱 금지)', /new DOMParser\(\)\.parseFromString/.test(HTML));
t('DOMParser 가 없으면 텍스트로 떨어진다 (fail-closed)',
  /typeof DOMParser !== 'function'\) return escHtml\(src\)/.test(HTML));
t('살균 도중 예외가 나면 텍스트로 떨어진다 (fail-closed)',
  /catch\(e\)\{\s*\n?\s*return escHtml\(src\);/.test(HTML) || HTML.includes('return escHtml(src);   // 살균 도중 실패하면 서식을 포기한다'));
t('허용 태그 목록이 있다', /_PAP_OK_TAGS\s*=\s*\{/.test(HTML));
t('허용 속성 목록이 있다', /_PAP_OK_ATTRS\s*=\s*\{/.test(HTML));
t('내용까지 버릴 태그 목록이 있다', /_PAP_KILL_TAGS\s*=\s*\{/.test(HTML));

for (const tag of ['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'FORM', 'STYLE']) {
  t('KILL 목록에 ' + tag, new RegExp('_PAP_KILL_TAGS[\\s\\S]{0,400}?\\b' + tag + ':1').test(HTML));
}
/* style·srcset·on* 은 허용 속성에 **없어야** 한다 — 허용 목록 방식이므로 없으면 제거된다. */
const okAttrsBlock = (HTML.match(/_PAP_OK_ATTRS\s*=\s*\{[^}]*\}/) || [''])[0];
t('허용 속성에 style 이 없다', !/\bstyle\b/.test(okAttrsBlock), okAttrsBlock);
t('허용 속성에 srcset 이 없다', !/\bsrcset\b/.test(okAttrsBlock), okAttrsBlock);
t('허용 속성에 on 핸들러가 없다', !/\bon[a-z]+\b/.test(okAttrsBlock), okAttrsBlock);
t('허용 속성은 href·src·alt·title·colspan·rowspan 만',
  /href:1/.test(okAttrsBlock) && /src:1/.test(okAttrsBlock) && okAttrsBlock.split(':1').length - 1 <= 6, okAttrsBlock);

// ───────────────────────────────────────────────────────────────
console.log('=== 3. URL 스킴 검사 — 실제로 돌려서 잰다 ===');

/* 순수 문자열 함수라 브라우저 없이 실행할 수 있다. IIFE/인라인 스크립트 안에 있어
   export 가 없으므로 소스를 뽑아 new Function 으로 되살린다 (이 저장소 관례). */
function liveFn(name) {
  const m = HTML.match(new RegExp('function ' + name + '\\(v\\)\\{[\\s\\S]*?\\n\\}', 'm'));
  if (!m) return null;
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '; return ' + name + ';')();
}
const safeSrc = liveFn('_papSafeSrc');
const safeHref = liveFn('_papSafeHref');
t('_papSafeSrc 소스를 뽑아 실행할 수 있다', typeof safeSrc === 'function');
t('_papSafeHref 소스를 뽑아 실행할 수 있다', typeof safeHref === 'function');

if (typeof safeSrc === 'function' && typeof safeHref === 'function') {
  const BAD = [
    'javascript:alert(1)',
    'jAvAsCrIpT:alert(1)',
    ' javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    '//evil.test/x.png',          // 프로토콜 상대 = 외부 출처
    'file:///etc/passwd',
  ];
  for (const b of BAD) {
    t('src 거부: ' + b.slice(0, 34), safeSrc(b) === '', 'got ' + JSON.stringify(safeSrc(b)));
    t('href 거부: ' + b.slice(0, 34), safeHref(b) === '', 'got ' + JSON.stringify(safeHref(b)));
  }
  t('src 허용: https 외부 이미지', safeSrc('https://x.test/a.png') === 'https://x.test/a.png');
  t('src 허용: data:image (편집기 insertImage)',
    safeSrc('data:image/png;base64,iVBORw0KGgo=') === 'data:image/png;base64,iVBORw0KGgo=');
  t('src 거부: data:image 로 위장한 비이미지', safeSrc('data:image/svg+xml;base64,PHN2Zz4=') === '');
  t('src 허용: 사이트 내부 절대경로', safeSrc('/img/a.png') === '/img/a.png');
  t('href 허용: https', safeHref('https://x.test/p') === 'https://x.test/p');
  t('href 허용: mailto', safeHref('mailto:contact@pap-magazine.com') === 'mailto:contact@pap-magazine.com');
  t('href 거부: 빈 값', safeHref('') === '' && safeSrc('') === '');
}

// ───────────────────────────────────────────────────────────────
console.log('=== 4. escJsAttr — onclick 의 JS 문자열 자리를 닫는다 ===');

const escBlock = HTML.match(/function escHtml\(s\)\{[\s\S]*?\n\}/);
const escJsBlock = HTML.match(/function escJsAttr\(s\)\{[\s\S]*?\n\}/);
t('escHtml·escJsAttr 소스를 뽑을 수 있다', !!escBlock && !!escJsBlock);
if (escBlock && escJsBlock) {
  // eslint-disable-next-line no-new-func
  const escJsAttr = new Function(escBlock[0] + escJsBlock[0] + '; return escJsAttr;')();
  const out = escJsAttr("');alert(1);//");
  t('따옴표 탈출 시도가 속성 밖으로 못 나간다', !/'/.test(out) && !/"/.test(out), out);
  t('속성 구분자(")가 엔티티화된다', out.indexOf('&quot;') === 0, out);
  t("O'Brien 같은 정상 이름도 깨지지 않는다", escJsAttr("O'Brien").includes('&#39;'), escJsAttr("O'Brien"));
  t('escHtml 은 따옴표까지 엔티티화한다 (속성에도 안전)',
    new Function(escBlock[0] + '; return escHtml;')()('"x\'y') === '&quot;x&#39;y');
}

// ───────────────────────────────────────────────────────────────
console.log('=== 5. 저장 단계 관문 (api/_lib/userHtml.js) — 실제 require ===');

const U = require('../api/_lib/userHtml');
t('MAX 상한이 한 곳에 모여 있다', U.MAX && U.MAX.title > 0 && U.MAX.content > 0 && U.MAX.name > 0);
const DANGER = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<IMG SRC=x OnErRoR=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '<iframe src=x></iframe>',
  '<svg/onload=alert(1)>',
  '<object data=x></object>',
  '<img src="data:text/html;base64,PHM+">',
  '<form><input></form>',
  '<template><img src=x onerror=1></template>',
];
for (const d of DANGER) t('거부: ' + d.slice(0, 40), U.hasDangerousHtml(d) === true);
const LEGIT = [
  '<p>한글 본문 <strong>굵게</strong><br>줄바꿈</p>',
  '<a href="https://x.test/a">링크</a>',
  '<img src="data:image/png;base64,iVBORw0KGgo=" alt="사진">',
  '<ul><li>하나</li><li>둘</li></ul>',
  '본문에 on average = 3 이라고 써도 된다',   // 산문 오탐 방지
  '<blockquote>인용</blockquote>',
];
for (const g of LEGIT) t('통과: ' + g.slice(0, 40), U.hasDangerousHtml(g) === false, JSON.stringify(g));

t('safeHttpUrl: https 통과', U.safeHttpUrl('https://x.test/a') === 'https://x.test/a');
t('safeHttpUrl: javascript 거부', U.safeHttpUrl('javascript:alert(1)') === '');
t('safeHttpUrl: data 거부', U.safeHttpUrl('data:text/html,x') === '');
t('safeHttpUrl: 스킴 없는 값 거부', U.safeHttpUrl('x.test') === '');
t('cleanText: 길이 상한', U.cleanText('a'.repeat(500), 10).length === 10);
t('cleanText: 제어문자 제거', U.cleanText('a\u0000b\u001fc', 50) === 'abc');

// ───────────────────────────────────────────────────────────────
console.log('=== 6. 저장 라우트에 관문이 배선돼 있다 ===');

const POSTS = R('api/community/posts/index.js');
t('userHtml 을 가져온다', /require\('\.\.\/\.\.\/_lib\/userHtml'\)/.test(POSTS));
t('길이 상한을 적용한다', /MAX\.title/.test(POSTS) && /MAX\.content/.test(POSTS));
t('위험 패턴이면 거부한다', /hasDangerousHtml/.test(POSTS));
t('거부는 400 + code 로 돌려준다 (api 규칙)', /POST_UNSAFE_HTML/.test(POSTS) && /POST_TOO_LONG/.test(POSTS));
t('tag 는 화이트리스트만', /ALLOWED_TAGS/.test(POSTS) && /ALLOWED_TAGS\.includes/.test(POSTS));
t('정제된 값을 INSERT 한다 (날것 변수 아님)',
  /title:\s*_title/.test(POSTS) && /content:\s*_content/.test(POSTS) && /tag:\s*_tag/.test(POSTS));

const ME = R('api/auth/me.js');
t('me.js 가 userHtml 을 가져온다', /require\('\.\.\/_lib\/userHtml'\)/.test(ME));
t('name·bio 에 길이 상한', /cleanText\(name, MAX\.name\)/.test(ME) && /cleanText\(bio, MAX\.bio\)/.test(ME));
t('location 에 길이 상한', /cleanText\(location, MAX\.location\)/.test(ME));
t('website 는 스킴 검사 후 저장', /safeHttpUrl\(_site\)/.test(ME) && /WEBSITE_INVALID/.test(ME));

// ───────────────────────────────────────────────────────────────
console.log('=== 7. 프로필 website 링크의 스킴 검사 (community-v2.js) ===');
t('website href 에 http(s) 검사가 있다', /\^https\?:\\\/\\\//.test(V2) || /test\(_site\)/.test(V2));
t('검사에 걸리면 링크 대신 텍스트', /_okSite\s*\?/.test(V2) && /<span style="color:var\(--text4\)">/.test(V2));
t('escHtml 만으로 href 를 만들지 않는다',
  !/href="'\+escHtml\(p\.website\)\+'"/.test(V2),
  'escHtml 은 스킴을 보지 않는다 — javascript: 가 통과한다');

// ───────────────────────────────────────────────────────────────
console.log('=== 8. anon 직접 쓰기 제거 + 서버 경유 (M-6) ===');
t('프런트가 community_post_views 에 직접 INSERT 하지 않는다',
  !/from\('community_post_views'\)\s*\.insert/.test(HTML.replace(/\s+/g, ' ').replace(/ \./g, '.')),
  'anon 키로 누구나 조회수를 넣을 수 있게 된다');
t('서버 조회 엔드포인트가 있다', fs.existsSync(path.join(ROOT, 'api/community/posts/[id]/view.js')));
const VIEW = R('api/community/posts/[id]/view.js');
t('조회 엔드포인트는 service_role 로 쓴다', /supabaseAdmin/.test(VIEW));
t('조회 엔드포인트에 레이트리밋', /rateLimit\(req, res, RATE_LIMITS\.api\)/.test(VIEW));
t('조회 엔드포인트가 봇을 걸러낸다', /isBot\(/.test(VIEW));
t('프런트는 그 엔드포인트를 호출한다', /\/view'/.test(HTML) && /recordView/.test(HTML));

// ───────────────────────────────────────────────────────────────
console.log('=== 9. 마이그레이션 181 (M-3~M-7 · S-8 · S-13) ===');
const MIG = R('supabase_migrations/181_security_audit_2026_11_anon_write_lockdown.sql');
const POLICIES = [
  ['affiliate_clicks', 'anon_insert_click'],
  ['community_badges', 'System can award badges'],
  ['community_notifications', 'System can create notifications'],
  ['community_post_views', 'System can record views'],
  ['editorial_views', 'anon_insert_view'],
];
for (const [tb, pol] of POLICIES) {
  t(tb + ' 의 무조건 통과 정책을 지운다',
    MIG.includes('DROP POLICY IF EXISTS "' + pol + '"') && MIG.includes('public.' + tb));
  t(tb + ' 의 anon 쓰기 그랜트를 회수한다',
    new RegExp('REVOKE INSERT, UPDATE, DELETE ON public\\.' + tb + '\\s+FROM anon, authenticated').test(MIG));
}
t('S-8: SECURITY DEFINER 뷰 2개의 공개 읽기를 막는다',
  /REVOKE ALL ON public\.ai_inflow_weekly\s+FROM anon, authenticated/.test(MIG) &&
  /REVOKE ALL ON public\.social_inclicks_health\s+FROM anon, authenticated/.test(MIG));
t('S-13: profiles 의 DELETE 그랜트를 회수한다',
  /REVOKE DELETE ON public\.profiles\s+FROM anon, authenticated/.test(MIG));
t('트랜잭션으로 묶여 있다', /^BEGIN;/m.test(MIG) && /^COMMIT;/m.test(MIG));
t('멱등하다 (두 번 돌려도 안전)', (MIG.match(/IF EXISTS/g) || []).length >= 5);
t('is_admin() 은 건드리지 않는다 (RLS 정책이 지탱하는 권한 — 근거가 적혀 있다)',
  !/REVOKE[^\n]*is_admin/.test(MIG) && /is_admin\(\) 은 건드리지 않는다/.test(MIG));

// ───────────────────────────────────────────────────────────────
console.log('=== 10. 캐시버스트 (프런트 규칙) ===');
const mv = HTML.match(/community-v2\.js\?v=(\d+)/);
t('community-v2.js 캐시버스트가 6 이상으로 올라갔다', !!mv && Number(mv[1]) >= 6,
  '안 올리면 사용자에게 살균 전 코드가 계속 서빙된다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ community-xss-lockdown tests FAILED'); process.exit(1); }
console.log('✅ community-xss-lockdown tests passed');
