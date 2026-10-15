'use strict';
/**
 * 공개 미디어킷 PDF (2026-10-15, 도메니코 "그럼 그렇게 해보자").
 *
 * 왜: /mediakit 계측 경로는 봇에게 200+noindex 빈 페이지만 돌려줘서(9/8 GSC 5xx 수리)
 * AI 검색이 미디어킷을 읽을 길이 없었다. 10/15 챗GPT 실측에서 경쟁 매체는 CDN 에 둔
 * 공개 미디어킷 PDF 가 그대로 인용됐다. 그래서 같은 PDF 를 frontend/media-kit/ 정적
 * 파일로 두고 /business·llms.txt·사이트맵·봇 응답에서 크롤 가능한 링크로 건다.
 *
 * 지키는 것
 *  · KO 파일이 있고, PDF 헤더이며, 5MB 를 넘지 않는다 (원본 KO 21.5MB → 1.5MB 축소본)
 *  · EN 은 공개하지 않는다 (2026년 4월판 373K·유로 가격·오타. 도메니코 10/15 "영문판은 인용하지 않게").
 *    파일·링크·사이트맵·llms 어디에도 없어야 한다. 최신 영문판이 나오면 이 검사를 뒤집는다.
 *  · 팀원 개인 휴대폰 번호 페이지는 뺐다 (KO 12쪽 → 11쪽 + 연락처는 contact@ 만)
 *  · /business 에 크롤 가능한 <a href> 직링크 (계측 버튼은 그대로 둔다)
 *  · llms.txt 광고 Q&A 에 PDF 절대 URL
 *  · 사이트맵 정적 목록에 2건
 *  · vercel.json 에 PDF 헤더(Content-Type application/pdf, inline, 캐시)
 *  · 봇용 /mediakit 응답 HTML 에 PDF 링크 (200+noindex 는 유지: mediakit-bot-crawl 테스트가 지킨다)
 *  · /:slug 편집 SSR 리라이트가 .pdf 경로를 삼키지 않는다 ([^./]+)
 *
 * Run with `node tests/mediakit-public-pdf.test.js` (wired into `npm test`).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  — ' + x : '')); } }

console.log('\n=== 공개 미디어킷 PDF ===');
const KO = '/media-kit/PAP-Magazine-Media-Kit-2026-KO.pdf';
const EN = '/media-kit/PAP-Magazine-Media-Kit-2026-EN.pdf';

for (const p of [KO]) {
  const abs = path.join(ROOT, 'frontend', p);
  const exists = fs.existsSync(abs);
  t(p + ' 파일이 있다', exists);
  if (!exists) continue;
  const buf = fs.readFileSync(abs);
  t(p + ' 는 PDF 헤더(%PDF-)로 시작한다', buf.slice(0, 5).toString() === '%PDF-');
  t(p + ' 는 5MB 이하 (' + (buf.length / 1048576).toFixed(2) + 'MB)', buf.length <= 5 * 1048576);
  t(p + ' 는 /Title 메타데이터를 가진다', /PAP Magazine Media Kit 2026/.test(buf.toString('latin1')));
}

const biz = R('frontend/business.html');
t('/business 에 KO PDF 직링크 <a href>', biz.includes('href="' + KO + '"'));
t('/business 에 EN PDF 링크가 없다 (4월판 미공개)', !biz.includes(EN));
t('/business 계측 버튼(downloadMediaKit)은 그대로', /downloadMediaKit\('ko'\)/.test(biz) && /downloadMediaKit\('en'\)/.test(biz));

const llms = R('frontend/llms.txt');
t('llms.txt 에 KO PDF 절대 URL', llms.includes('https://www.pap-magazine.com' + KO));
t('llms.txt 에 EN PDF 가 없다', !llms.includes(EN));

const sm = R('api/sitemap.js');
t('사이트맵 정적 목록에 KO PDF', sm.includes("path: '" + KO + "'"));
t('사이트맵에 EN PDF 가 없다', !sm.includes(EN));
t('EN PDF 파일이 레포에 없다 (배포되지 않는다)', !fs.existsSync(path.join(ROOT, 'frontend', EN)));

const v = JSON.parse(R('vercel.json'));
const h = (v.headers || []).find((x) => x.source === '/media-kit/(.*).pdf');
t('vercel.json 에 /media-kit/(.*).pdf 헤더 규칙', !!h);
if (h) {
  const get = (k) => (h.headers.find((y) => y.key === k) || {}).value || '';
  t('  Content-Type application/pdf', get('Content-Type') === 'application/pdf');
  t('  Content-Disposition inline (브라우저에서 바로 열림)', get('Content-Disposition') === 'inline');
  t('  Cache-Control public', /public/.test(get('Cache-Control')));
}
const slugRw = (v.rewrites || []).find((x) => x.source === '/:slug([^./]+)');
t('/:slug SSR 리라이트는 점(.)이 든 경로를 안 잡는다 (.pdf 보호)', !!slugRw && slugRw.source.includes('[^./]+'));
t('/media-kit/ 를 잡는 리라이트가 없다', !(v.rewrites || []).some((x) => /media-kit/.test(x.source)));

const mk = R('api/mediakit.js');
t('봇용 /mediakit 응답에 KO PDF 링크 (언어 무관)', mk.includes("'/media-kit/PAP-Magazine-Media-Kit-2026-KO.pdf\""));
t('봇용 /mediakit 응답에 EN PDF 링크가 없다', !mk.includes('Media-Kit-2026-EN'));

const pkg = R('package.json');
t('npm test 에 이 테스트가 묶여 있다', pkg.includes('node tests/mediakit-public-pdf.test.js'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
