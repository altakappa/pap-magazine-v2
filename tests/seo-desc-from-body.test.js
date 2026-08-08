/**
 * 번역 페이지의 요약문 (2026-08-09 신설).
 *
 * ── 실제 상태 ────────────────────────────────────────────────────────
 * 아티클 번역 16,108행을 세어 보니:
 *     제목 있음 16,108 · 본문 있음 16,108 · **설명 있음 0**
 * 아티클 번역 프롬프트가 `{"i","title","body"}` 만 요청하기 때문이다.
 * 그런데 렌더러는 `tr.description || descEn` 이라, 아티클은 **항상** 영어
 * (없으면 한국어)로 떨어졌다. 라이브 실측:
 *
 *     /ru/article/avavav-ss25-backstage-87
 *       제목 «AVAVAV SS25: бэкстейдж…»          러시아어 ✓
 *       본문 «Бэкстейдж показа коллекции…»      러시아어 ✓
 *       리드·meta  "<PAP>가 아바바브 백스테이지 현장을 담아왔다"   한국어 ✗
 *
 * meta description 은 **검색 결과에 뜨는 그 한 줄**이고, 리드 문단은 화면에서
 * 제목 바로 아래 보인다. 7개 언어 × 2,300 기사 ≈ 16,000 페이지가 그 두 곳만
 * 남의 언어였다.
 *
 * ── 왜 재번역이 아니라 조립인가 ─────────────────────────────────────
 * **본문은 이미 번역돼 있다.** 요약을 AI 로 다시 만들 이유가 없다 —
 * 번역된 본문의 첫 문장을 쓰면 된다. API 호출 0 · DB 쓰기 0 · 렌더 시점 조립.
 * (이 저장소가 _enrichMeta 에서 이미 쓰는 방식이다.)
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 번역 본문에서 뽑은 요약이 **그 언어**일 것 (원문 한국어·영어가 아닐 것)
 *   ② 태그·엔티티가 화면에 그대로 새지 않을 것
 *   ③ 문장 중간에서 흉하게 끊기지 않을 것 · 상한을 넘지 않을 것
 *   ④ 뽑을 게 없으면 **기존 폴백을 그대로** 탈 것 (나빠지지 않을 것)
 *   ⑤ ko·en 경로와 에디토리얼(설명이 원래 있는 쪽)은 **안 바뀔 것**
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const R = require(path.join(ROOT, 'api/_lib/seoRenderer.js'));
const { descFromBody, renderSeoHtml } = R;
const SRC = fs.readFileSync(path.join(ROOT, 'api/_lib/seoRenderer.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 220)); }
}

/* 라이브에서 실제로 저장돼 있는 형태의 번역 본문(HTML). */
const RU = '<p>Бэкстейдж показа коллекции AVAVAV на Неделе моды в Милане весна/лето 2025.'
  + ' Это моменты за кулисами, когда модели готовятся выйти на подиум.</p>';
const JA = '<p>HYBEの新レーベルABDが、待望のガールグループTUIDEの7人のメンバーをついに公開した。デビューは来年春を予定している。</p>';
const ZH = '<p>意大利品牌在米兰时装周发布了2025春夏系列。设计师以极简剪裁重新诠释了都市女性的日常。</p>';

console.log('\n=== ① 뽑은 요약이 그 언어다 ===');
t('러시아어 — 키릴 문자가 들어 있다', /[А-Яа-я]/.test(descFromBody(RU)), descFromBody(RU));
t('러시아어 — 한글이 없다', !/[가-힣]/.test(descFromBody(RU)));
t('일본어 — 가나가 들어 있다', /[ぁ-んァ-ン]/.test(descFromBody(JA)), descFromBody(JA));
t('중국어 — 한자가 들어 있다', /[一-鿿]/.test(descFromBody(ZH)), descFromBody(ZH));

console.log('\n=== ② 태그·엔티티가 새지 않는다 ===');
const dirty = descFromBody('<p><strong>AVAVAV</strong> &amp; PAP&nbsp;— бэкстейдж на Неделе моды в Милане, полный отчёт.</p>');
t('태그가 남지 않는다', !/[<>]\w/.test(dirty), dirty);
t('&amp; 가 & 로 풀린다', dirty.includes('&') && !dirty.includes('&amp;'), dirty);
t('&nbsp; 가 보통 공백이 된다', !dirty.includes('&nbsp;'), dirty);
t('<br> 은 공백이 되어 단어가 붙지 않는다',
  descFromBody('<p>Первое предложение о показе<br>второе предложение о коллекции сегодня</p>')
    .includes('показе второе'), descFromBody('<p>a<br>b</p>'));

console.log('\n=== ③ 끊는 자리와 길이 ===');
const long = '<p>' + 'Бэкстейдж показа коллекции AVAVAV на Неделе моды в Милане. '.repeat(8) + '</p>';
const cut = descFromBody(long);
t('상한(220자)을 넘지 않는다', cut.length <= 220, cut.length);
t('문장 끝(.)에서 끊는다', /\.$/.test(cut), cut.slice(-40));
const cjkLong = '<p>' + '意大利品牌在米兰时装周发布了2025春夏系列。'.repeat(20) + '</p>';
const cjkCut = descFromBody(cjkLong);
t('CJK 는 。에서 끊는다', /。$/.test(cjkCut), cjkCut.slice(-14));
t('CJK 도 상한을 넘지 않는다', cjkCut.length <= 220, cjkCut.length);
const noPunct = descFromBody('<p>' + 'あ'.repeat(400) + '</p>');
t('구두점이 없어도 상한을 넘지 않는다', noPunct.length <= 220, noPunct.length);
t('구두점이 없으면 …로 끝낸다', noPunct.endsWith('…'), noPunct.slice(-3));

console.log('\n=== ④ 뽑을 게 없으면 기존 폴백을 탄다 ===');
t('빈 값 → 빈 문자열', descFromBody(null) === '' && descFromBody(undefined) === '' && descFromBody('') === '');
t('태그만 있으면 빈 문자열', descFromBody('<p></p><div></div>') === '');
t('너무 짧으면(40자 미만) 빈 문자열 — 요약 구실을 못 한다',
  descFromBody('<p>짧은 글</p>') === '', descFromBody('<p>짧은 글</p>'));
t('40자 이상이면 뽑는다',
  descFromBody('<p>' + 'A'.repeat(45) + '</p>').length >= 40);

console.log('\n=== ⑤ 렌더러 배선 — 번역 본문이 meta 와 리드에 반영된다 ===');
const record = {
  id: 'x1', slug: 'avavav-ss25-backstage-87', title: 'AVAVAV 백스테이지',
  title_en: 'AVAVAV SS25 Backstage',
  description: '<PAP>가 아바바브 백스테이지 현장을 담아왔다',        // 한국어 원문
  description_en: 'PAP captured the AVAVAV backstage.',            // 영어 원문
  content: '<p>한국어 본문</p>', status: 'published', published_date: '2025-01-02',
};
const trRu = { title: 'AVAVAV SS25: бэкстейдж', description: null, body: RU };
const htmlRu = renderSeoHtml('article', record, { lang: 'ru', translation: trRu, availableLangs: ['ko', 'en', 'ru'] });
const metaRu = (htmlRu.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
const leadRu = (htmlRu.match(/<p class="seo-desc-primary">([\s\S]*?)<\/p>/) || [])[1] || '';
t('meta description 이 러시아어다', /[А-Яа-я]/.test(metaRu), metaRu.slice(0, 90));
t('meta description 에 한글이 없다 (사고 재현 방지)', !/[가-힣]/.test(metaRu), metaRu.slice(0, 90));
t('화면 리드 문단도 러시아어다', /[А-Яа-я]/.test(leadRu), leadRu.slice(0, 90));
t('화면 리드에 한글이 없다', !/[가-힣]/.test(leadRu), leadRu.slice(0, 90));

console.log('\n=== ⑤ ko·en 과 에디토리얼은 안 바뀐다 ===');
const htmlKo = renderSeoHtml('article', record, { lang: 'ko' });
t('한국어 페이지는 한국어 설명 그대로',
  /[가-힣]/.test((htmlKo.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ''));
const htmlEn = renderSeoHtml('article', record, { lang: 'en' });
const metaEn = (htmlEn.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
t('영어 페이지는 영어 설명 그대로 (번역 본문으로 덮어쓰지 않는다)',
  /PAP captured/.test(metaEn), metaEn.slice(0, 80));
/* 에디토리얼은 tr.description 이 원래 있다 → 새 경로를 타면 안 된다. */
const trIt = { title: 'MIRROR IMAGE', description: 'Un ritratto della dualità in luce fredda e neutra.', body: null };
const htmlIt = renderSeoHtml('editorial', { id: 'e1', slug: 'mirror-image', title: 'MIRROR IMAGE',
  description: '한국어 설명', description_en: 'English desc', status: 'published' },
  { lang: 'it', translation: trIt, availableLangs: ['ko', 'en', 'it'] });
const metaIt = (htmlIt.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
t('에디토리얼은 원래의 tr.description 을 그대로 쓴다', /ritratto della dualit/.test(metaIt), metaIt.slice(0, 80));

console.log('\n=== 폴백 순서가 코드에 그대로 있다 ===');
t('tr.description 이 tr.body 보다 우선한다',
  /\(tr && tr\.description\) \|\| \(tr && tr\.body \? descFromBody\(tr\.body\) : ''\)/.test(SRC));
t('meta 가 번역엔 _trDesc, 영어엔 _enDesc 를 쓴다',
  /descMain = lang === 'ko' \? descKo : \(lang === 'en' \? _enDesc : \(_trDesc \|\| descEn\)\)/.test(SRC));
t('화면 리드도 같은 두 갈래를 쓴다',
  /bodyMain = lang === 'ko' \? bodyKo : \(lang === 'en' \? _enDesc : \(_trDesc \|\| bodyEn\)\)/.test(SRC));
t('한국어는 어느 쪽도 타지 않는다 (descKo 그대로)', /descMain = lang === 'ko' \? descKo/.test(SRC));

console.log('\n=== ⑥ 영어판도 영어 본문에서 만든다 (2026-08-09 2차) ===');
/* `articles` 에는 description·description_en 컬럼이 없다(실측: subtitle·content·
   content_en 만). 그래서 영어 기사 meta 가 항상 한국어(또는 제목 에코)였다.
   발행 2,303건 전부 content_en 이 있고 subtitle 302건은 전부 한국어다. */
const artRec = {
  id: 'a1', slug: 'avavav-ss25-backstage-87', title: 'AVAVAV 백스테이지',
  title_en: 'AVAVAV SS25 Backstage',
  subtitle: '<PAP>가 아바바브 백스테이지 현장을 담아왔다',       // 한국어뿐
  content: '<p>한국어 본문입니다. 여기에 충분히 긴 한국어 문장이 들어갑니다.</p>',
  content_en: '<p>Backstage at the AVAVAV show during Milan Fashion Week SS25.'
    + ' These are the moments before the show begins, as models prepare to walk.</p>',
  status: 'published', published_date: '2025-01-02',
};
const hEn = renderSeoHtml('article', artRec, { lang: 'en', availableLangs: ['ko', 'en'] });
const mEn = (hEn.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
const lEn = (hEn.match(/<p class="seo-desc-primary">([\s\S]*?)<\/p>/) || [])[1] || '';
t('영어 meta 에 한글이 없다 (사고 재현 방지)', !/[가-힣]/.test(mEn), mEn.slice(0, 90));
t('영어 meta 가 영문 본문에서 나온다', /Backstage at the AVAVAV/.test(mEn), mEn.slice(0, 90));
t('영어 화면 리드에도 한글이 없다', !/[가-힣]/.test(lEn), lEn.slice(0, 90));

console.log('\n=== ⑥ 한국어 페이지는 영향을 받지 않는다 (descAlt 보호) ===');
const hKo2 = renderSeoHtml('article', artRec, { lang: 'ko', availableLangs: ['ko', 'en'] });
const mKo2 = (hKo2.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
t('한국어 meta 는 한국어 그대로', /[가-힣]/.test(mKo2), mKo2.slice(0, 80));
/* descEn 을 직접 바꿨다면 한국어 페이지에 영어 보조문단이 새로 붙는다.
   _enDesc 를 영어판 전용으로 둔 이유가 이것이다. */
const altKo = (hKo2.match(/<p class="seo-desc-en">([\s\S]*?)<\/p>/) || [])[1] || '';
t('한국어 페이지에 영문 보조문단이 새로 생기지 않는다',
  !/Backstage at the AVAVAV/.test(altKo), altKo.slice(0, 80));
t('영어 전용 변수를 쓴다 (descEn 자체를 바꾸지 않았다)',
  /const _enDesc = descFromBody\(record\.content_en\) \|\| descEn;/.test(SRC)
  && /const descEn = record\.description_en \|\| _filmDescEn \|\| descKo;/.test(SRC));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ seo-desc-from-body tests passed');
