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

console.log('\npassed: ' + pass + '   failed: ' + fail);
console.log((fail ? '❌' : '✅') + ' security-audit-2026-09 ' + (fail ? 'FAILED' : 'passed'));
process.exit(fail ? 1 : 0);
