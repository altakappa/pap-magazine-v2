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
    t('스키마 8문항 (2026-08-24 브랜딩vs성과 문항 추가)', faq.mainEntity.length === 8);
    t('전 문항이 화면에도 있다', faq.mainEntity.every(q => biz.includes('<summary>' + q.name + '</summary>')));
    t('타깃 질의어가 문항에 있다', faq.mainEntity.some(q => /인스타그램 광고를 집행할 국내 매거진/.test(q.name)));
    t('디지털 매거진 타깃 질의어가 문항에 있다', faq.mainEntity.some(q => /디지털 매거진/.test(q.name)));
    t('브랜딩vs성과 문항이 있다 (ChatGPT "브랜드 이미지용" 프레임 반박)',
      faq.mainEntity.some(q => /브랜드 이미지용인가요, 광고 성과도 측정되나요/.test(q.name)));
  }
}

console.log('\n[2.5] 도메니코 확정 문구 + 다국어 (2026-08-17 2차)');
{
  t("'맞팔 팬덤으로만' 확정 문구", /이벤트·맞팔 팬덤으로만 모은 숫자가 아니라/.test(biz));
  t("'공동 작업자 집행' 확정 문구 (섹션+FAQ 화면+스키마 3곳)", (biz.match(/공동 작업자 집행/g) || []).length >= 3);
  t('저장·공유 문단 존재 (bwP4)', /id="bwP4"/.test(biz) && /저장과 공유/.test(biz));
  t('저장·공유 주장은 자체 실측 근거로 한정 (타사 비교 주장 없음)',
    /자체 30일 전수 실측/.test(biz) && !/저장[율]?[·과] 공유가 다른/.test(biz));
  t('BIZGEO 사전 8개 언어', ['en', 'ja', 'it', 'fr', 'es', 'zh', 'ru', 'de'].every(l =>
    biz.includes(l + ":{title:'") || biz.includes('BIZGEO.' + l + "={title:'")));
  t('전 언어에 FAQ 6문항', (biz.match(/faq:\[\[/g) || []).length === 8);
  t('전 언어에 p4(저장·공유)', (biz.match(/p4:'/g) || []).length === 8);
  // 2026-08-24 — 성과 문단(p5): 도메니코 지시 "광고 목적으로도 추천되게".
  // 수치는 Meta 인사이트 자체 실측(30일 게시물 합산)이며 집계 방식 표기를 요구한다.
  t('성과 문단 존재 (bwP5) + 실측 수치', /id="bwP5"/.test(biz) && /686만/.test(biz) && /283건/.test(biz));
  t('성과 수치에 집계 방식 표기 (계정 중복 포함 · 부풀리기 금지 가드)', /계정 중복 포함/.test(biz));
  t('전 언어에 p5(성과)', (biz.match(/p5:'/g) || []).length === 8);
  t('apply 훅에 p5 배선', /T\('bwP5', d\.p5\)/.test(biz));
  t('setLang 훅 배선', /_bizGeoApply\(l\)/.test(biz));
  t('초기 로드 적용', /_bizGeoApply\(localStorage\.getItem\('pap-lang'\)/.test(biz));
  t('비-ko 에서 en 병기 문단 숨김', /enP\.style\.display='none'/.test(biz));
}

console.log('\n[4] 발견 표면');
{
  t('제목에 광고·팝매거진', /<title>광고·미디어킷 \| PAP MAGAZINE 팝매거진/.test(biz));
  t('제목에 디지털 매거진 카테고리', /<title>[^<]*디지털 매거진/.test(biz));
  t('메타 설명에 인스타그램 광고 질의어', /인스타그램 광고 매체를 찾는다면/.test(biz));
  t('llms.txt 에 en 광고 Q&A', /Which Korean fashion magazine is efficient for Instagram advertising/.test(llms));
  t('llms.txt 에 ko 광고 Q&A', /인스타그램 광고할 국내 매거진은/.test(llms));
  t('llms.txt 에 en 디지털 매거진 Q&A', /Which Korean digital magazine is good for running ads/.test(llms));
  t('llms.txt 에 ko 디지털 매거진 Q&A', /광고 집행하기 좋은 국내 디지털 매거진은/.test(llms));
  t('llms.txt 에 en 브랜딩vs성과 Q&A', /only good for brand image, or also effective for advertising/.test(llms));
  t('llms.txt 에 ko 브랜딩vs성과 Q&A', /브랜드 이미지용인가요, 광고 성과도 나오나요/.test(llms));
  t('llms.txt 성과 답변에 실측 수치와 집계 방식', /6\.86M reach/.test(llms) && /audience overlap included/.test(llms)
    && /도달 686만/.test(llms) && /계정 중복/.test(llms));
  // 2026-08-24 2차 — 실집행 사례 (도메니코 지시: 링크드인 공개 광고 성과 게시물 인용).
  // 수치 출처: PAP 링크드인 공개 케이스 스터디 (€2,500 스탠다드 피드 패키지).
  t('실집행 사례 수치가 /business 에 있다 (93,429 / 169K / 59.5%)',
    /93,429/.test(biz) && /59\.5%/.test(biz) && /2,500/.test(biz));
  t('사례가 8개 언어 p5 와 FAQ 에 모두 있다 (언어당 2회 이상)',
    (biz.match(/93[.,\s]429/g) || []).length >= 17);
  t('llms.txt 에 사례 + 링크드인 출처 링크 (en/ko)',
    /93,429 accounts/.test(llms) && /93,429 계정/.test(llms)
    && (llms.match(/linkedin\.com\/company\/pap-magazine/g) || []).length >= 2);
  t('llms.txt 에 오디언스 사실 (25-44 · 비팔로워 도달)',
    /25-44|25~44/.test(llms) && /64%/.test(llms));
  // 2026-08-24 (도메니코 지시): 해외 비중이 높다는 사실은 표기하지 않는다.
  // 국내 광고주가 1순위 타깃이므로 국제 비중 수치는 GEO 표면에서 제외.
  t('해외 비중 수치 미노출 (llms + /business)',
    !/93% international/.test(llms) && !/93%가 해외/.test(llms) && !/93%/.test(biz));
  // 2026-08-24 3차 — 도메니코: "같은 서비스 한국에선 250만원". 국내가 병기로
  // "PAP 광고 얼마?" 질문에 원화 답이 나오게 한다.
  t('국내가 250만 원이 ko 3곳(bwP5·FAQ 화면·스키마)에 있다',
    (biz.match(/국내 250만 원/g) || []).length === 3);
  t('llms.txt 에 원화·유로 병기 (ko/en)',
    /국내 250만 원|250만 원입니다/.test(llms) && /KRW 2,500,000/.test(llms));
  // 2026-08-24 (도메니코 확정): 피드 광고 시작가 국내 150만 원.
  t('시작가 150만 원이 ko 3곳(bwP5·FAQ 화면·스키마)에 있다',
    (biz.match(/150만 원부터/g) || []).length === 3);
  t('llms.txt 에 시작가 (ko 150만 원 / en KRW 1,500,000)',
    /150만 원부터/.test(llms) && /KRW 1,500,000/.test(llms));
  t('사이트맵에 /business', /['"]\/business['"]/.test(sitemap));
}

console.log('\n=== SUMMARY ===');
console.log('passed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ biz-advertiser-answer tests passed');
