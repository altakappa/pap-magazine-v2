/**
 * GEO — 엔티티 그라운딩 + 신뢰 신호 (2026-08-17 신설)
 *
 * [왜] "GEO 노출 업계 최고" 재구성 감사에서 확정된 공백 2개:
 *  ① 기사 JSON-LD 에 about/mentions 가 전무 — AI·지식그래프가 기사를
 *     엔티티(브랜드·인물·이벤트)에 못 건다
 *  ② NewsMediaOrganization 에 masthead·correctionsPolicy 부재
 *
 * [무엇을 지키나]
 *  - matchEntities: 확실한 사전만 · 중의적 별칭은 태그 전용 · about≤2/mentions≤6
 *  - 렌더러가 about/mentions 를 스키마에 싣는다 (빈 배열이면 필드 생략)
 *  - 신뢰 필드 3종이 실재 앵커(/about#corrections)를 가리키고, 그 앵커가
 *    about.html 에 실제로 존재한다 — 없는 정책 선언 금지
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

const { matchEntities, ENTITIES } = require(path.join(ROOT, 'api', '_lib', 'geoEntities.js'));
const seo = R('api/_lib/seoRenderer.js');
const about = R('frontend/about.html');

console.log('\n[1] matchEntities — 매칭 규칙');
{
  const r = matchEntities({ title: 'Chanel Unveils 25 Bag Campaign', tags: ['제니'] });
  t('제목 매칭은 about 으로', r.about.length === 1 && r.about[0].name === 'Chanel');
  t('태그 매칭은 mentions 로', r.mentions.length === 1 && r.mentions[0].name === 'Jennie');
  t('sameAs 는 위키피디아 URL', /^https:\/\/en\.wikipedia\.org\/wiki\//.test(r.about[0].sameAs));

  const v = matchEntities({ title: 'Louis Vuitton SS27: Vision of Water', tags: [] });
  t('중의적 별칭(V)은 제목에서 안 잡힌다', !v.about.concat(v.mentions).some(n => n.name === 'V'));
  const v2 = matchEntities({ title: '', tags: ['V'] });
  t('중의적 별칭도 태그 정확 일치는 잡힌다', v2.mentions.some(n => n.name === 'V'));

  const many = matchEntities({ title: '', tags: ['샤넬', '디올', '구찌', '프라다', '펜디', '버버리', '나이키', '아디다스', '퓨마'] });
  t('mentions 상한 6', many.mentions.length === 6);
  const none = matchEntities({ title: '무명 신진 브랜드 룩북', tags: ['신진 디자이너'] });
  t('사전 밖은 매칭 없음', none.about.length === 0 && none.mentions.length === 0);
  t('사전 항목이 전부 위키피디아 sameAs 를 가진다', ENTITIES.every(e => /^https:\/\/en\.wikipedia\.org\/wiki\/./.test(e.sameAs)));
  t('한 엔티티가 두 번 나오지 않는다', (() => {
    const r2 = matchEntities({ title: 'Chanel show', tags: ['chanel', '샤넬'] });
    return r2.about.length + r2.mentions.length === 1;
  })());
}

console.log('\n[2] 렌더러 배선');
{
  t('geoEntities 를 require 한다', /require\('\.\/geoEntities'\)/.test(seo));
  t('스키마에 about 필드', /about: _entityAbout\.length \? _entityAbout : undefined/.test(seo));
  t('스키마에 mentions 필드', /mentions: _entityMentions\.length \? _entityMentions : undefined/.test(seo));
  t('제목은 표시 제목+한국어 원제를 함께 본다', /matchEntities\(\{ title: String\(titleMain \|\| ''\) \+ ' ' \+ String\(titleKo \|\| ''\)/.test(seo));
}

console.log('\n[3] 신뢰 신호 — 실재하는 것만 선언');
{
  t('masthead 선언', /masthead: SITE \+ '\/about'/.test(seo));
  t('correctionsPolicy 선언', /correctionsPolicy: SITE \+ '\/about#corrections'/.test(seo));
  t('actionableFeedbackPolicy 선언', /actionableFeedbackPolicy: SITE \+ '\/about#corrections'/.test(seo));
  t('about.html 에 #corrections 앵커가 실존한다', /id="corrections"/.test(about));
  t('정정 문구에 연락 경로가 있다', /정정·제보[\s\S]{0,300}contact@pap-magazine\.com/.test(about));
  t('선언 안 한 정책은 코드에도 없다 (ethics/diversity — 실재 문구 없음)',
    !/ethicsPolicy|diversityPolicy/.test(seo));
}

console.log('\n=== SUMMARY ===');
console.log('passed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ geo-entity-grounding tests passed');
