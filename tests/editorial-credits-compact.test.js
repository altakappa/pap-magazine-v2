/**
 * 화보 크레딧 옛 압축 형식 {r, h:[{n, id}]} 를 서버 렌더가 읽는다 (2026-11-04)
 *   실측: 게시 화보 2,292건 중 2,111건(92%)이 이 형식 → 구글이 보는 HTML 에 Credits 가 통째로 빠져 있었다(aura).
 *   ① Credits 블록: 역할 한 줄에 핸들 여러 개 (앱 화면과 같은 모양) · 브랜드 줄도 보인다
 *   ② 작성자(byline)·Person 스키마: 사람만 (Fashion by·함께한 브랜드·Studio·Location·감사 줄 제외)
 *   ③ 새 형식(name/roles/instagram)·역할별 객체 형식은 예전과 똑같다
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const abs = path.join(ROOT, 'api', '_lib', 'supabase.js');
require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: { supabaseAdmin: { from: () => ({}) }, supabase: {} } };
const S = require(path.join(ROOT, 'api', '_lib', 'seoRenderer.js'));
const C = S._credits;
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

// 실제 aura 행의 크레딧 (2026-11-04 운영 DB, 일부)
const AURA = [
  { h: [{ n: 'Nawi D', id: '@nawi.d' }, { n: 'Fredericelfeld', id: '@fredericelfeld' }], r: 'Creative Direction' },
  { h: [{ n: 'Fredericelfeld', id: '@fredericelfeld' }], r: 'Photography' },
  { h: [{ n: 'Johanna Madle', id: '@johanna_madle' }], r: 'Hair & MakeUp' },
  { h: [{ n: 'Morphstudios', id: '@MorphStudios' }], r: 'Special thanks to' },
  { h: [{ n: 'Quusje', id: '@quusje' }], r: 'Starring' },
  { h: [{ n: 'Weekday', id: '@weekday' }, { n: 'Prada', id: '@prada' }], r: 'Fashion by' },
];
const rec = (credits) => ({ id: 'e1', slug: 'aura', title: 'Aura', title_en: 'Aura', status: 'published',
  published_date: '2025-07-17', description: '설명', description_en: 'desc', credits });

console.log('\n[1] 압축 형식 판정·펼치기');
t('압축 형식으로 본다', C.isCompactCredits(AURA));
t('새 형식은 압축 아님', !C.isCompactCredits([{ name: 'A', roles: ['Photographer'], instagram: '@a' }]));
const ex = C.expandCompactCredits(AURA);
t('사람 한 명당 한 항목 (8명)', ex.length === 8, ex.length);
t('이름·역할·핸들이 새 형식으로', ex[1].name === 'Fredericelfeld' && ex[1].roles[0] === 'Creative Direction' && ex[1].instagram === '@fredericelfeld');
const people = C.expandCompactCredits(AURA, true);
t('사람만: 브랜드·감사 줄 제외 (5명)', people.length === 5 && !people.some((p) => /weekday|prada|morph/i.test(p.name)), people.map((p) => p.name));
['함께한 브랜드', 'Studio', 'Location', 'Fashion by'].forEach((r) => t('사람 아님: ' + r, C.NON_PERSON_ROLE_RE.test(r)));
['Photography', 'Starring', 'Makeup', '모델', 'Creative Direction'].forEach((r) => t('사람: ' + r, !C.NON_PERSON_ROLE_RE.test(r)));
t('빈 사람·빈 이름 건너뜀', C.expandCompactCredits([{ r: 'X', h: [null, {}, { n: '', id: '' }] }]).length === 0);

console.log('\n[2] Credits 블록 (서버 렌더 HTML)');
{
  const rows = C.extractStructuredCredits(rec(AURA));
  t('역할 6줄 (브랜드 줄도 보인다 — 앱 화면과 같게)', rows.length === 6, rows);
  t('Creative Direction = @nawi.d @fredericelfeld', rows[0].role === 'Creative Direction' && rows[0].handles.join(' ') === '@nawi.d @fredericelfeld');
  const html = S.renderSeoHtml('editorial', rec(AURA), { lang: 'ko' });
  const sec = (html.match(/<section class="seo-credits">[\s\S]*?<\/section>/) || [''])[0];
  t('HTML 에 Credits 섹션', /<h2>Credits<\/h2>/.test(sec));
  t('사진가가 보인다 (@fredericelfeld)', /@fredericelfeld/.test(sec));
  t('작성자 줄에 브랜드 없음', !/seo-byline">By [^<]*(Weekday|Prada)/.test(html), (html.match(/seo-byline">[^<]*/) || [''])[0]);
  t('작성자 줄에 사진가', /seo-byline">By [^<]*Fredericelfeld/.test(html));
  const persons = C.extractPersonEntities(rec(AURA));
  const fred = persons.find((p) => p.name === 'Fredericelfeld');
  t('Person 스키마: 역할 합침 + 인스타 sameAs', fred && /Creative Direction/.test(fred.jobTitle) && /Photography/.test(fred.jobTitle)
    && fred.sameAs[0] === 'https://www.instagram.com/fredericelfeld/', fred);
  t('Person 스키마: 브랜드 없음', !persons.some((p) => /weekday|prada/i.test(p.name)));
  t('특수문자 이스케이프', !/<script>/.test(S.renderSeoHtml('editorial', rec([{ r: '<script>', h: [{ n: 'x', id: '@x' }] }]), { lang: 'ko' })
    .match(/<section class="seo-credits">[\s\S]*?<\/section>/)[0]));
}

console.log('\n[3] 다른 형식은 그대로');
{
  const NEW = [{ name: 'Cristian Azazel', roles: ['Photographer'], instagram: '@azazelc' }, { name: 'Franco Paz Soldan', roles: ['Art Director'], instagram: '@francopazsoldan' }];
  const rows = C.extractStructuredCredits(rec(NEW));
  t('새 형식: 2줄 · Photographer @azazelc', rows.length === 2 && rows[0].role === 'Photographer' && rows[0].handles[0] === '@azazelc', rows);
  t('새 형식: 작성자 이름', C.extractContributors(rec(NEW)).join(',') === 'Cristian Azazel,Franco Paz Soldan');
  const OBJ = { photographer: ['Kim (@kim)'], stylist: ['Lee (@lee)'] };
  const r2 = C.extractStructuredCredits(rec(OBJ));
  t('역할별 객체 형식: Photographer @kim · Style @lee', r2.length === 2 && r2[0].handles[0] === '@kim' && r2[1].role === 'Style', r2);
  t('크레딧 없음: 빈 결과', C.extractStructuredCredits(rec(null)).length === 0);
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ editorial-credits-compact tests FAILED'); process.exit(1); }
console.log('✅ editorial-credits-compact tests passed');
