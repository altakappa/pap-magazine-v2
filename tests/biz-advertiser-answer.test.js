/**
 * B2B GEO — /business 가 "IG 광고할 국내 매거진" 질문의 정답 페이지다 (2026-08-17)
 *
 * [왜] 광고·PR 에이전시가 ChatGPT·Gemini 에 매체를 물을 때, RAG 는 그 질문에
 * 직접 답하는 문서를 문다. /business 에는 효율 근거가 0 이었다.
 * 도메니코 승인 방식: 공개 검증 가능 수치만 · 경쟁 매체 익명(A/B) · 최상급 금지.
 *
 * [무엇을 지키나] ① 효율 섹션(공개 좋아요 일대일 비교표) 존재 ② 광고주 FAQ
 * 화면-스키마 정합 ③ 경쟁 매체 실명 미노출 ④ 제목·메타에 광고 질의어
 * ⑤ llms.txt Advertising Q&A ⑥ 사이트맵 등록
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const biz = R('frontend/business.html');
const llms = R('frontend/llms.txt');
const sitemap = R('api/sitemap.js');

console.log('\n[1] 효율 섹션 — 공개 수치 일대일 비교');
{
  t('섹션이 정적 HTML 로 존재 (JS 주입 아님)', /<section class="biz-why" id="why-pap"/.test(biz));
  t('핵심 주장: 팔로워가 아니라 반응', /팔로워 수가 아니라 반응으로/.test(biz));
  t('비교표에 실측 수치 (4,100 / 1,803 / 1,261)', /4,100/.test(biz) && /1,803/.test(biz) && /1,261/.test(biz));
  t('팔로워 보정 6~8배 명시', /6~8배/.test(biz));
  t('영어 요약 병기 (lang="en")', /<p lang="en"/.test(biz) && /383K followers/.test(biz));
  t('FTC 표기 유지', /FTC·EU 준수/.test(biz));
}

console.log('\n[2] 정직성 가드');
{
  t('경쟁 매체 실명 미노출 (익명 A/B)', !/아이즈매거진|eyesmag|데일리패션뉴스|하입비스트/.test(biz));
  t("막연한 최상급 미사용 ('업계 최상위권 참여율' 은 기존 i18n 문구라 예외)",
    !/업계 1위|국내 최고 효율|최고의 매체/.test(biz));
}

console.log('\n[3] 광고주 FAQ — 화면·스키마 정합');
{
  const m = biz.match(/<script type="application\/ld\+json">(\{"@context": "https:\/\/schema\.org", "@type": "FAQPage"[\s\S]*?)<\/script>/);
  t('FAQPage JSON-LD 존재', !!m);
  if (m) {
    const faq = JSON.parse(m[1].replace(/\\u003c/g, '<'));
    t('스키마 6문항', faq.mainEntity.length === 6);
    t('전 문항이 화면에도 있다', faq.mainEntity.every(q => biz.includes('<summary>' + q.name + '</summary>')));
    t('타깃 질의어가 문항에 있다', faq.mainEntity.some(q => /인스타그램 광고를 집행할 국내 매거진/.test(q.name)));
  }
}

console.log('\n[4] 발견 표면');
{
  t('제목에 광고·팝매거진', /<title>광고·미디어킷 \| PAP MAGAZINE 팝매거진/.test(biz));
  t('메타 설명에 인스타그램 광고 질의어', /인스타그램 광고 매체를 찾는다면/.test(biz));
  t('llms.txt 에 en 광고 Q&A', /Which Korean fashion magazine is efficient for Instagram advertising/.test(llms));
  t('llms.txt 에 ko 광고 Q&A', /인스타그램 광고할 국내 매거진은/.test(llms));
  t('사이트맵에 /business', /['"]\/business['"]/.test(sitemap));
}

console.log('\n=== SUMMARY ===');
console.log('passed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ biz-advertiser-answer tests passed');
