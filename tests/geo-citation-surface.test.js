/**
 * GEO — 생성 엔진 인용 표면 (2026-08-17 신설)
 *
 * [왜] ChatGPT·Perplexity 유입이 2026-08-10 부터 붙기 시작했다.
 * 10일 실측: 92클릭 / 고유 IP 87 / 서로 다른 페이지 68 / 모바일 65%.
 * IP 와 페이지가 거의 1:1 이고 모바일 비율이 사람 수준이라 봇이 아니다.
 * 같은 기간 스레드 유입(계측 개시분)과 IG 아웃클릭(봇 포함)을 걷어내면
 * **이번 달 유일하게 진짜인 신규 채널**이다.
 *
 * 언어별로 갈라 보면 영어가 한국어와 거의 동률이다 (ko 42 / en 41 / ja 5 / 기타 7).
 * 인용된 페이지는 전부 고유명사·시점·장소가 있는 사실형 기사였다.
 *
 * [그래서 무엇을 지키나] 생성 엔진은 문서를 통째로 읽지 않고 **문단 단위로
 * 뽑아** 인용한다. 그래서 두 가지가 필요하다:
 *   ① 첫 두 문장이 리드일 것 (누가·무엇을·언제·어디서)
 *   ② 작성자·날짜가 **화면에 보일** 것 (JSON-LD 는 기계용이고, 생성 엔진은
 *      본문 텍스트에서 신뢰 신호를 읽는다)
 *
 * 이 테스트는 그 두 규칙이 코드에서 사라지지 않게 지킨다. 문장의 품질은
 * 기계로 못 재므로, 규칙이 프롬프트·렌더러에 살아 있는지만 본다.
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

const imp = R('api/_lib/instagramImport.js');
const seo = R('api/_lib/seoRenderer.js');

console.log('\n[1] 리드 규칙 — 첫 두 문장에 육하원칙');
{
  t('첫 두 문장을 리드로 지시한다', /첫 단락의 처음 두 문장은 \*\*리드\*\*다/.test(imp));
  t('고유명사를 원문 그대로 쓰라고 지시한다',
    /브랜드명·인물명·제품명·날짜·장소 같은 고유명사를 원문 그대로 적는다/.test(imp));
  t('분위기·수사적 질문·일반론으로 시작하지 말라고 지시한다',
    /분위기 묘사, 수사적 질문/.test(imp) && /일반론으로 시작하지 않는다/.test(imp));
  t('영문 본문에도 같은 규칙을 건다 (영어가 한국어와 동률로 인용된다)',
    /body_en 의 첫 두 문장도 같은 규칙을 따른다/.test(imp));
  t('PAP 리듬을 죽이지 않는다 — 규칙은 첫 두 문장에만',
    /둘째 단락부터는 PAP 리듬 그대로다/.test(imp),
    '이 단서가 빠지면 기사 전체가 통신사 기사체가 된다');
  t('근거가 코드에 남아 있다 (다음 사람이 지우기 전에 이유를 본다)',
    /생성 엔진은 문서를 통째로\s*\n?\s*\*\*읽지 않고\*\*|문단 단위로 뽑아/.test(imp)
    || /문단 단위로/.test(imp));
}

console.log('\n[2] 신뢰 신호 — 화면에 보이는 작성자·날짜');
{
  t('byline 을 렌더링한다', /<p class="seo-byline">By \$\{escText\(/.test(seo));
  t('기여자가 있으면 실명, 없으면 매체 편집부',
    /contributors\.length \? contributors\.join\(', '\) : SITE_NAME \+ ' Editorial'/.test(seo));
  t('byline 이 escText 를 거친다 (이름에 <> 가 들어와도 안전)',
    /seo-byline">By \$\{escText\(/.test(seo));
  t('byline 스타일이 있다 (안 보이면 없는 것과 같다)', /\.seo-byline\{/.test(seo));
  t('발행일이 <time datetime> 으로 이미 노출된다', /<time datetime="\$\{escAttr\(published\)\}">/.test(seo));
  t('byline 이 본문(bodyHtml)보다 위에 있다',
    seo.indexOf('seo-byline') < seo.indexOf('${bodyHtml}'),
    '리드보다 아래로 내려가면 신뢰 신호로 안 읽힌다');
}

console.log('\n[3] 기존 구조화 데이터가 살아 있는가 (회귀)');
{
  t('Article 스키마에 author 가 있다', /author: contributors\.length/.test(seo));
  t('datePublished · dateModified 가 있다',
    /datePublished: published/.test(seo) && /dateModified: modified/.test(seo));
  t('mainEntityOfPage 가 있다', /mainEntityOfPage: \{ '@type': 'WebPage'/.test(seo));
  t('FAQ 는 답을 먼저 말하도록 지시돼 있다 (AEO)',
    /답을 먼저 말하고 근거를 붙일 것/.test(imp));
}

console.log('\n[4] GEO 확장 — alt 의미화 · 위키데이터 엔티티 연결 (2026-08-27)');
{
  const llms = R('frontend/llms.txt');
  t('갤러리 alt 가 의미 텍스트를 실는다 (altText 변수 사용)',
    /alt="\$\{escAttr\(altText\)\}"/.test(seo));
  t('화보 alt 에 fashion editorial 어휘가 들어간다', /fashion editorial/.test(seo));
  t('alt 는 실재 태그·크레딧만 싣는다 (tags 조건부)', /tags\.length \? `\$\{tags\[0\]\}/.test(seo));
  t('Organization sameAs 에 위키데이터 항목이 있다',
    /wikidata\.org\/wiki\/Q140578366/.test(seo));
  t('llms.txt 에 위키데이터 Q번호가 병기된다', /Q140578366/.test(llms));
  t('llms.txt 에 레퍼런스 파인더 섹션이 있다',
    /Finding editorial references/.test(llms) && /macro beauty/.test(llms));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ geo-citation-surface tests FAILED'); process.exit(1); }
console.log('✅ geo-citation-surface tests passed');
