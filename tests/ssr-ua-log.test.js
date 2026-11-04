/**
 * 서버 렌더 페이지 요청자 이름(User-Agent) 로그 (2026-11-04, 11/03 DB 다운 후속)
 *   ① 한 줄 형식: [ssr-ua] <kind> <path?lang> | <UA 160자>   ② 절대 throw 안 함 · IP 안 남김
 *   ③ 화보·기사·브랜드 세 페이지 함수 맨 앞(handleCors 다음)에서 부른다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const { logSsrUa, uaOf } = require(path.join(ROOT, 'api', '_lib', 'ssrUaLog.js'));
const lines = []; const orig = console.log; console.log = (s) => lines.push(String(s));
logSsrUa('editorial', { url: '/api/seo/editorial/aura?lang=ja', headers: { 'user-agent': 'Mozilla/5.0 (compatible; AhrefsSiteAudit/6.1; +http://ahrefs.com/robot/)', 'x-forwarded-for': '1.2.3.4' } });
logSsrUa('brand', { url: '/api/seo/brand/prada', headers: {} });
logSsrUa('article', null);
let threw = false; try { logSsrUa('article', { get headers() { throw new Error('x'); } }); } catch (_) { threw = true; }
console.log = orig;

console.log('\n[1] 형식');
t('kind · 경로(?lang 포함) · UA', lines[0] === '[ssr-ua] editorial /api/seo/editorial/aura?lang=ja | Mozilla/5.0 (compatible; AhrefsSiteAudit/6.1; +http://ahrefs.com/robot/)', lines[0]);
t('IP 는 남기지 않는다', !/1\.2\.3\.4/.test(lines.join('\n')));
t('UA 없으면 (없음)', /\| \(없음\)$/.test(lines[1]), lines[1]);
t('UA 160자 자름', uaOf({ headers: { 'user-agent': 'x'.repeat(500) } }).length === 160);
t('req 없어도 안 죽음', lines.length >= 3 && !threw);

console.log('\n[2] 연결');
[['api/seo/editorial/[slug].js', 'editorial'], ['api/seo/article/[slug].js', 'article'], ['api/seo/brand/[id].js', 'brand']].forEach(([f, k]) => {
  const s = R(f);
  t(f + ': handleCors 다음 줄에서 부른다', new RegExp("if \\(handleCors\\(req, res\\)\\) return;\\n  require\\('\\.\\./\\.\\./_lib/ssrUaLog'\\)\\.logSsrUa\\('" + k + "', req\\);").test(s));
});
t('DB 에 쓰지 않는다', !/supabase/.test(R('api/_lib/ssrUaLog.js').replace(/\/\*[\s\S]*?\*\//g, '')));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ ssr-ua-log tests FAILED'); process.exit(1); }
console.log('✅ ssr-ua-log tests passed');
