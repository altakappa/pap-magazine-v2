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
 *  · EN 도 공개한다 (2026-11-16 뒤집음). 10/15 에 막은 이유는 그때 영문판이 4월판
 *    (373K·유로 가격·오타)이었기 때문이고, 11/15 신규본(Figma, 13쪽)이 나와 사라졌다.
 *    도메니코 11/16 "열어 — EN 도 공개". 파일·/business 링크·사이트맵·llms 에 모두 있어야 한다.
 *  · 팀 페이지(12쪽, 개인 휴대폰·개인 이메일)는 **포함한다** (2026-11-16 뒤집음).
 *    10/15 에는 공개본에서 그 쪽을 뺐다. 11/16 에 새 키트를 올리며 도메니코가 "그대로 올려" 로
 *    정했다 — 공개 URL 은 검색엔진이 사본을 들고 있을 수 있어 되돌리기 어렵다는 점을 알린 뒤의
 *    결정이다. 그래서 이 테스트는 쪽수나 연락처 유무를 단정하지 않는다(그건 편집 결정이다).
 *    다시 빼기로 하면 KO·EN 에서 12쪽을 제거하고 이 주석을 뒤집는다.
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

for (const p of [KO, EN]) {
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
t('/business 에 EN PDF 직링크 <a href>', biz.includes('href="' + EN + '"'));
t('/business 계측 버튼(downloadMediaKit)은 그대로', /downloadMediaKit\('ko'\)/.test(biz) && /downloadMediaKit\('en'\)/.test(biz));

const llms = R('frontend/llms.txt');
t('llms.txt 에 KO PDF 절대 URL', llms.includes('https://www.pap-magazine.com' + KO));
t('llms.txt 에 EN PDF 절대 URL', llms.includes('https://www.pap-magazine.com' + EN));

const sm = R('api/sitemap.js');
t('사이트맵 정적 목록에 KO PDF', sm.includes("path: '" + KO + "'"));
t('사이트맵 정적 목록에 EN PDF', sm.includes("path: '" + EN + "'"));
t('EN PDF 파일이 레포에 있다 (배포된다)', fs.existsSync(path.join(ROOT, 'frontend', EN)));

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
t('봇용 /mediakit 응답에 EN PDF 링크', mk.includes('Media-Kit-2026-EN'));

/* 2026-11-16 — 공개본이 둘이 됐으니 매일 점검도 둘을 다 봐야 한다 */
const watch = R('api/cron/mediakit-link-watch.js');
t('링크 점검이 KO·EN 공개 PDF 를 모두 본다',
  watch.includes('Media-Kit-2026-KO.pdf') && watch.includes('Media-Kit-2026-EN.pdf'));

const pkg = R('package.json');
t('npm test 에 이 테스트가 묶여 있다', pkg.includes('node tests/mediakit-public-pdf.test.js'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
