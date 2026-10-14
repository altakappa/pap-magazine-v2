'use strict';
/**
 * 이미지 CDN 모듈 보강 (2026-10-14 건강 점검 후속).
 * 홈·에디토리얼 허브 실측: Supabase 원본 37장(2~9초) + JS 가 eager/auto 로 그린 S3 카드 18장(5~13초)이
 * /_vercel/image 를 안 거쳤다. 모듈이 S3 만 보고, lazy 만 바꿨기 때문.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

const cdn = R('frontend/pap-img-cdn.js');
t('허용 호스트 2개(S3 + Supabase storage), vercel.json remotePatterns 와 일치', (() => {
  const v = JSON.parse(R('vercel.json')); const hosts = (v.images.remotePatterns || []).map((p) => p.hostname).sort();
  const m = cdn.match(/var HOSTS = \[([\s\S]*?)\];/); if (!m) return false;
  const inMod = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  return JSON.stringify(hosts) === JSON.stringify(inMod);
})());
t('호스트 판정은 https://host/ 접두 일치(서브스트링 아님)', /src\.indexOf\('https:\/\/' \+ HOSTS\[i\] \+ '\/'\) === 0/.test(cdn));
t('gif·svg·동영상·supabase render/image 는 건너뛴다', /\\\.\(gif\|svg\|mp4\|webm\)\$/.test(cdn) && /\/render\/image\//.test(cdn));
t('동적 삽입(MutationObserver)은 loading 값 무관, 정적 HTML 은 lazy 만', /if\(img\.complete\) return;\s*\n\s*if\(!dynamic && img\.loading !== 'lazy'\) return;/.test(cdn) && /rewrite\(n, true\);\s*\n\s*else sweep\(n, true\);/.test(cdn));
t('초기 sweep 은 여전히 lazy 만 (히어로 LCP 보호)', /querySelectorAll\(dynamic \? 'img' : 'img\[loading="lazy"\]'\)/.test(cdn));
t('변환 실패 시 원본 복원(onerror) 유지', /img\.dataset\.papOrig && img\.src !== img\.dataset\.papOrig/.test(cdn));
t('SIZES 3종 유지 (2026-08-10 비용 절감)', /SIZES = \[320, 960, 1920\]/.test(cdn));
const htmls = fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => f.endsWith('.html')).filter((f) => R('frontend/' + f).includes('pap-img-cdn.js'));
t('모듈을 쓰는 HTML 전부 캐시버스트 v=3 (' + htmls.length + '개)', htmls.length >= 14 && htmls.every((f) => /\/pap-img-cdn\.js\?v=3"/.test(R('frontend/' + f))));
t('모듈 문법', (() => { try { new Function(cdn); return true; } catch (e) { return e.message; } })());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
