/**
 * 2026-09-04 보안감사 1군 수정 가드
 *
 * 감사에서 나온 명백한 버그급 7건을 고쳤다. 이 파일은 그 수정이 되돌아가지 않게 붙잡는다.
 * 각 항목에 '왜' 를 남긴다 — 나중에 이 테스트를 지우려는 사람이 이유부터 보게.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('=== ① admin/download-logs — requireAdmin 에 await (일반 회원이 PII 로그를 읽던 구멍) ===');
{
  const s = rd('api/admin/download-logs.js');
  t('await requireAdmin(req, res)', /await requireAdmin\(req, res\)/.test(s));
  t('await 없는 requireAdmin 호출이 admin/ 전체에 없다', (() => {
    const dir = path.join(ROOT, 'api', 'admin');
    const walk = (d) => fs.readdirSync(d).flatMap((n) => {
      const p = path.join(d, n); return fs.statSync(p).isDirectory() ? walk(p) : [p];
    });
    return walk(dir).filter((p) => p.endsWith('.js')).every((p) => {
      const src = fs.readFileSync(p, 'utf8');
      return !/(?<!await )\brequireAdmin\(req, res\)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''));
    });
  })());
}

console.log('\n=== ② auth/send-code · verify-code — 코드 해시가 클라이언트에서 역산 불가 ===');
{
  const a = rd('api/auth/send-code.js'), b = rd('api/auth/verify-code.js');
  const pick = (s) => (s.match(/function hashCode\([^)]*\) \{[\s\S]*?\n\}/) || [''])[0];
  t('send-code 가 HMAC(비밀키) 를 쓴다', /createHmac\('sha256', JWT_SECRET\)/.test(pick(a)));
  t('verify-code 가 HMAC(비밀키) 를 쓴다', /createHmac\('sha256', JWT_SECRET\)/.test(pick(b)));
  t('두 파일의 hashCode 가 글자 하나까지 같다 (다르면 인증이 통째로 깨진다)', pick(a) === pick(b) && pick(a).length > 50);
  t('무염 sha256(code) 가 남아 있지 않다', !/createHash\('sha256'\)\.update\(code\)/.test(a + b));
  t('해시에 이메일이 섞인다 (토큰 재사용 방지)', /hashCode\(code, email\)/.test(a) && /hashCode\(code\.toString\(\)\.trim\(\), decoded\.email\)/.test(b));
}

console.log('\n=== ③ fail-open → fail-closed (시크릿 없으면 거부) ===');
{
  for (const f of ['api/cron/backfill-translations.js', 'api/cron/sync-pinterest.js']) {
    const s = rd(f).replace(/\/\*[\s\S]*?\*\//g, '');
    t(f + ': CRON_SECRET 없으면 500', /if \(!process\.env\.CRON_SECRET\) return res\.status\(500\)/.test(s));
    t(f + ': `if (process.env.CRON_SECRET) {` 조건부 검사가 사라졌다', !/if \(process\.env\.CRON_SECRET\) \{/.test(s));
  }
  const ix = rd('api/indexnow.js').replace(/\/\*[\s\S]*?\*\//g, '');
  t('indexnow: INDEXNOW_SECRET 없으면 503', /if \(!process\.env\.INDEXNOW_SECRET\)[\s\S]{0,200}status\(503\)/.test(ix));
  t('indexnow: `INDEXNOW_SECRET && !cronOk` 조건부 검사가 사라졌다', !/process\.env\.INDEXNOW_SECRET && !cronOk/.test(ix));
}

console.log('\n=== ④ brand-inquiry — DB 기반 레이트리밋 ===');
{
  const s = rd('api/brand-inquiry.js');
  t('rateLimitStrict 를 부른다', /await rateLimitStrict\(req, res, RATE_LIMITS\.auth, 'brand-inquiry'\)/.test(s));
  t('honeypot 보다 먼저 온다 (봇이 honeypot 을 비워도 리밋에 걸리게)',
    s.indexOf('rateLimitStrict(req') < s.indexOf('if (b.website)'));
}

console.log('\n=== ⑤ community/scrap-upload — 확장자 AND MIME, 저장 타입은 서버가 정한다 ===');
{
  const s = rd('api/community/scrap-upload.js').replace(/\/\*[\s\S]*?\*\//g, '');
  t('둘 중 하나라도 틀리면 415 (||)', /!ALLOWED_EXT\.includes\(ext\) \|\| !ALLOWED_MIME\.includes\(mime\)/.test(s));
  t('OR 통과였던 && 조건이 사라졌다', !/!ALLOWED_EXT\.includes\(ext\) && !ALLOWED_MIME\.includes\(mime\)/.test(s));
  t('저장 contentType 이 클라이언트 mime 이 아니라 EXT_TO_MIME 에서 나온다',
    /contentType: EXT_TO_MIME\[safeExt\]/.test(s) && !/contentType: mime \|\|/.test(s));
}

console.log('\n=== ⑥ threads/delete · uninstall — Meta signed_request 검증 (실제 HMAC 으로) ===');
{
  const { verifySignedRequest } = require('../api/_lib/metaSignedRequest');
  const secret = 'test-app-secret';
  const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload = b64u(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '123', issued_at: 1 }));
  const goodSig = b64u(crypto.createHmac('sha256', secret).update(payload).digest());
  const badSig = b64u(crypto.createHmac('sha256', 'wrong').update(payload).digest());
  const mk = (sr, q) => ({ body: sr == null ? {} : { signed_request: sr }, query: q || {} });

  t('올바른 서명 → ok', verifySignedRequest(mk(goodSig + '.' + payload), secret).ok === true);
  t('틀린 서명 → 거부(400)', (() => { const r = verifySignedRequest(mk(badSig + '.' + payload), secret); return !r.ok && r.status === 400; })());
  t('signed_request 없음 → 거부(400)', (() => { const r = verifySignedRequest(mk(null), secret); return !r.ok && r.status === 400; })());
  t('APP_SECRET 미설정 → 거부(503, fail-closed)', (() => { const r = verifySignedRequest(mk(goodSig + '.' + payload), ''); return !r.ok && r.status === 503; })());
  t('form-urlencoded 문자열 바디도 읽는다',
    verifySignedRequest({ body: 'signed_request=' + encodeURIComponent(goodSig + '.' + payload), query: {} }, secret).ok === true);
  for (const f of ['api/threads/delete.js', 'api/threads/uninstall.js']) {
    const s = rd(f);
    t(f + ': verifySignedRequest 를 부르고 실패면 DB 전에 return', 
      /verifySignedRequest\(req, process\.env\.THREADS_APP_SECRET\)/.test(s)
      && s.indexOf('if (!v.ok)') < s.indexOf("from('threads_auth')"));
  }
}


/* ───────────────────────── 2군 (2026-09-04, 도메니코 "권고대로하자") ───────────────────────── */

console.log('\n=== 2군 D — 쿠키 인증 CSRF: Origin 검사 (실제 JWT 로) ===');
{
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';
  const jwt = require('jsonwebtoken');
  const { verifyToken } = require('../api/_lib/auth');
  const tok = jwt.sign({ id: 'u1', email: 'a@b.c', role: 'user', tv: 0 }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const cookieReq = (method, headers) => ({ method, headers: Object.assign({ cookie: 'pap_auth=' + tok }, headers || {}) });
  const bearerReq = (method, headers) => ({ method, headers: Object.assign({ authorization: 'Bearer ' + tok }, headers || {}) });

  t('쿠키 + GET + 아무 Origin → 통과 (읽기는 CSRF 무관)', !!verifyToken(cookieReq('GET', { origin: 'https://evil.example' })));
  t('쿠키 + POST + 우리 Origin → 통과', !!verifyToken(cookieReq('POST', { origin: 'https://www.pap-magazine.com' })));
  t('쿠키 + POST + 남의 Origin → 차단 (CSRF)', verifyToken(cookieReq('POST', { origin: 'https://evil.example' })) === null);
  t('쿠키 + DELETE + 남의 Origin → 차단', verifyToken(cookieReq('DELETE', { origin: 'https://evil.example' })) === null);
  t('쿠키 + POST + Origin 없음 + Sec-Fetch-Site cross-site → 차단', verifyToken(cookieReq('POST', { 'sec-fetch-site': 'cross-site' })) === null);
  t('쿠키 + POST + Origin 없음 + Sec-Fetch-Site same-origin → 통과', !!verifyToken(cookieReq('POST', { 'sec-fetch-site': 'same-origin' })));
  t('쿠키 + POST + 헤더 둘 다 없음(구형 브라우저·서버간) → 통과', !!verifyToken(cookieReq('POST', {})));
  t('Bearer + POST + 남의 Origin → 통과 (Bearer 는 브라우저가 자동으로 안 붙임)', !!verifyToken(bearerReq('POST', { origin: 'https://evil.example' })));
}

console.log('\n=== 2군 E — 시크릿 비교 timing-safe 공용 헬퍼 ===');
{
  const { safeEqual, bearerOk } = require('../api/_lib/secretCompare');
  t('safeEqual 같음', safeEqual('abc', 'abc') === true);
  t('safeEqual 다름', safeEqual('abc', 'abd') === false);
  t('safeEqual 길이 다름', safeEqual('abc', 'abcd') === false);
  t('safeEqual 빈값·null 은 항상 false (fail-closed)', !safeEqual('', '') && !safeEqual(null, null) && !safeEqual('a', undefined));
  t('bearerOk 정상', bearerOk('Bearer s3cr3t', 's3cr3t') === true);
  t('bearerOk 접두사 없음', bearerOk('s3cr3t', 's3cr3t') === false);
  t('bearerOk 시크릿 미설정이면 false', bearerOk('Bearer ', '') === false && bearerOk('Bearer x', undefined) === false);
  /* 소스 레벨: api/ 아래 어디에도 시크릿 문자열 비교가 남아 있지 않다 (송신용 헤더 조립은 제외) */
  const walk = (d) => fs.readdirSync(d).flatMap((n) => { const q = path.join(d, n); return fs.statSync(q).isDirectory() ? walk(q) : [q]; });
  const srcs = walk(path.join(ROOT, 'api')).filter((q) => q.endsWith('.js') && !q.includes(path.sep + '_lib' + path.sep));
  const leftovers = srcs.filter((q) => {
    const src = fs.readFileSync(q, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return /(===|!==)\s*'Bearer ' \+ process\.env\.[A-Z_]+/.test(src)
        || /'Bearer ' \+ process\.env\.[A-Z_]+\s*(===|!==)/.test(src)
        || /if \(got !== expected\)/.test(src)
        || /(===|!==)\s*process\.env\.(CRON_SECRET|INDEXNOW_SECRET|HEARTBEAT_SECRET|TELEGRAM_WEBHOOK_SECRET)\b/.test(src);
  }).map((q) => path.relative(ROOT, q));
  t('api/ 에 시크릿 === / !== 비교가 남아 있지 않다', leftovers.length === 0, leftovers.join(', '));
  /* require 경로가 실제로 resolve 된다 — CLAUDE.md: api/ 최상위는 ./_lib, node --check 는 못 잡는다 */
  const badReq = srcs.filter((q) => {
    const m = fs.readFileSync(q, 'utf8').match(/require\('([^']*_lib\/secretCompare)'\)/); // 접두사 없는 '_lib/…' 도 잡는다
    return m && !fs.existsSync(path.resolve(path.dirname(q), m[1] + '.js'));
  }).map((q) => path.relative(ROOT, q));
  t('secretCompare require 경로가 전부 resolve 된다', badReq.length === 0, badReq.join(', '));
}

console.log('\n=== 2군 A(쉬운 부분) — CSP 에서 unsafe-eval 제거 ===');
{
  const v = rd('vercel.json');
  t("vercel.json 에 'unsafe-eval' 없음", !v.includes("'unsafe-eval'"));
  t('프론트에 eval / new Function 사용 없음 (있으면 위 제거가 화면을 깨뜨린다)', (() => {
    const dir = path.join(ROOT, 'frontend');
    const files = fs.readdirSync(dir).filter((n) => /\.(js|html)$/.test(n));
    return files.every((n) => !/\beval\(|new Function\(/.test(fs.readFileSync(path.join(dir, n), 'utf8')));
  })());
}

console.log('\n=== 2군 C — 결제 경로는 requireAuthStrict ===');
{
  for (const f of ['api/subscriptions/checkout.js', 'api/submissions/paypal-capture.js', 'api/submissions/paypal-authorize.js', 'api/submissions/paypal-order.js']) {
    const s = rd(f).replace(/\/\*[\s\S]*?\*\//g, '');
    t(f + ': await requireAuthStrict', /await requireAuthStrict\(req, res\)/.test(s) && !/\brequireAuth\(req, res\)/.test(s));
  }
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
console.log((fail ? '❌' : '✅') + ' security-audit-2026-09 ' + (fail ? 'FAILED' : 'passed'));
process.exit(fail ? 1 : 0);
