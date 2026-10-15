'use strict';
/**
 * GEO 답변 페이지 2개 (2026-10-15, 도메니코 "챗GPT 가 우리를 더 인용하게").
 * /web-magazine "국내 웹매거진 추천 가이드"(경쟁사 공정 포함) · /ad-media "광고 매체 고르는 법"(광고주용).
 * 지키는 것: 라우팅·사이트맵·llms.txt·9개 언어 사전·FAQ 스키마·내부 링크·가격 표기(150만만).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
const vj = JSON.parse(R('vercel.json'));
const sitemap = R('api/sitemap.js');
const llms = R('frontend/llms.txt');
const seo = R('api/_lib/seoRenderer.js');
for (const [file, route, h1word, faqQ] of [
  ['web-magazine', '/web-magazine', '국내 웹매거진 추천 가이드', '국내 웹매거진 추천해 줄 수 있나요?'],
  ['ad-media', '/ad-media', '광고 매체 고르는 법', '패션 브랜드가 광고하기 좋은 국내 매거진은 어디인가요?'],
]) {
  const h = R('frontend/' + file + '.html');
  const ld = JSON.parse((h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || '{}');
  const types = (ld['@graph'] || []).map((g) => g['@type']);
  t(file + ': 페이지 존재 + h1 + 캐노니컬', h.includes(h1word) && h.includes('<link rel="canonical" href="https://www.pap-magazine.com' + route + '">'));
  t(file + ': JSON-LD Organization·Article·FAQPage(5)·Breadcrumb', ['Organization', 'Article', 'FAQPage', 'BreadcrumbList'].every((x) => types.includes(x)) && ld['@graph'][2].mainEntity.length === 5 && ld['@graph'][2].mainEntity[0].name === faqQ);
  t(file + ': 라우팅(클린 URL + .html 301)', (vj.rewrites || []).some((r) => r.source === route && r.destination === route + '.html') && (vj.redirects || []).some((r) => r.source === route + '.html' && r.destination === route && r.statusCode === 301));
  t(file + ': 사이트맵 + llms.txt + SSR 푸터 링크', new RegExp("path: '" + route + "'").test(sitemap) && llms.includes('https://www.pap-magazine.com' + route + ')') && seo.includes('/' + file + '">'));
  t(file + ': 9개 언어 사전(8파일, 키 집합 동일, 한글 잔존 0)', (() => { let keys = null; for (const l of LANGS) { const p = 'frontend/i18n/ui/' + file + '.' + l + '.json'; if (!fs.existsSync(path.join(ROOT, p))) return false; const d = JSON.parse(R(p)); const ks = Object.keys(d).sort().join('\u0001'); if (keys === null) keys = ks; else if (ks !== keys) return false; if (Object.values(d).some((v) => !v || /[가-힣]/.test(v))) return false; } return true; })());
  t(file + ': 가격은 150만 원뿐 (250만·유로 없음)', /150만 원부터/.test(h) && !/250만|2,500,000|EUR/.test(h));
  t(file + ': 광고·협업 안내(/business) 내부 링크', /href="\/business"/.test(h));
}
t('web-magazine: 경쟁사 공정 포함 (아이즈매거진·하입비스트·비슬라·디에디트·온큐레이션)', ['아이즈매거진', '하입비스트', '비슬라', '디에디트', '온큐레이션'].every((n) => R('frontend/web-magazine.html').includes(n)));
t('web-magazine: 종이 잡지 디지털판은 제외한다고 밝힌다', /보그 코리아, 엘르 코리아, W 코리아, 데이즈드 코리아 등은 웹매거진이 아니라/.test(R('frontend/web-magazine.html')));
t('ad-media: 팔로워 수 대신 지표 5개 + 체크리스트 6개', (R('frontend/ad-media.html').match(/<tr><td><b>/g) || []).length >= 4 + 5 + 6 + 6 && /집행 전 체크리스트/.test(R('frontend/ad-media.html')));
t('digital-magazine · instagram-magazine 에서 두 페이지로 내부 링크 (사전 v5)', ['digital-magazine', 'instagram-magazine'].every((p) => { const h = R('frontend/' + p + '.html'); return /href="\/web-magazine">국내 웹매거진 추천 가이드</.test(h) && /href="\/ad-media">광고 매체 고르는 법</.test(h) && /content="[a-z-]+" data-v="5"/.test(h); }));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
