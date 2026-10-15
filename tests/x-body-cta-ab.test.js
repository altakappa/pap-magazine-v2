/**
 * X 본문 CTA 한 줄 A/B (2026-10-15, 도메니코 "링크만 vs 링크를 알리는 한 줄")
 *
 * 성질: env 로만 켜지고 날짜로 꺼진다 · 갈래는 id 홀짝으로 결정적 ·
 * CTA 는 링크 바로 윗줄 · 문구는 기사/영상/에디토리얼 세 가지(도메니코 지정) ·
 * 넘치면 CTA 를 떼고 링크만(kind 도 bare) · 계측 라벨이 kind·src 에 남는다 ·
 * 스레드 부스트 문구는 건드리지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

delete process.env.X_BODY_CTA_AB; delete process.env.X_BODY_CTA_AB_UNTIL;
const ab = require('../api/_lib/xBodyLinkAb');
const x = require('../api/_lib/xPost');

console.log('[1] 문구 — 도메니코가 정한 세 줄 그대로');
t('일반 기사', ab.CTA_LINE.article === '자세한 내용은 아래 링크에서↓');
t('영상 기사', ab.CTA_LINE.video === '풀 영상은 아래 링크에서 ↓');
t('에디토리얼', ab.CTA_LINE.editorial === '전체 화보는 아래 링크에서 ↓');
t('ctaLineFor: video → 영상 문구, 그 외 → 기사 문구', ab.ctaLineFor('video') === ab.CTA_LINE.video && ab.ctaLineFor('image') === ab.CTA_LINE.article && ab.ctaLineFor('none') === ab.CTA_LINE.article);

console.log('[2] 스위치 — env 로 켜고 날짜로 끈다');
t('기본은 꺼짐 (env 없음 → null)', ab.ctaVariantFor('abc1') === null && ab.ctaIsOn() === false);
process.env.X_BODY_CTA_AB = 'on';
t('켜면 홀수 끝자리 → cta', ab.ctaVariantFor('abc1') === 'cta' && ab.ctaVariantFor('abcd') === 'cta' && ab.ctaVariantFor('17895') === 'cta');
t('켜면 짝수 끝자리 → bare', ab.ctaVariantFor('abc0') === 'bare' && ab.ctaVariantFor('abce') === 'bare' && ab.ctaVariantFor('17894') === 'bare');
t('같은 id 는 늘 같은 갈래', ab.ctaVariantFor('7f6f81a6-1c24-4b7e-9589-e8276520b35d') === ab.ctaVariantFor('7f6f81a6-1c24-4b7e-9589-e8276520b35d'));
process.env.X_BODY_CTA_AB_UNTIL = '2026-10-23';
t('UNTIL 전이면 켜짐', ab.ctaVariantFor('abc1', Date.parse('2026-10-22T23:00:00Z')) === 'cta');
t('UNTIL 이후면 저절로 꺼짐', ab.ctaVariantFor('abc1', Date.parse('2026-10-23T00:00:01Z')) === null);
delete process.env.X_BODY_CTA_AB_UNTIL;
process.env.X_BODY_CTA_AB = 'all';
t('all 모드: 전부 cta', ab.ctaVariantFor('abc0') === 'cta' && ab.ctaVariantFor('abc1') === 'cta');
process.env.X_BODY_CTA_AB = 'on';

console.log('[3] 본문 조립 — CTA 는 링크 바로 윗줄');
const body = '후킹 한 줄\n\n본문이다.\n\n#PAPMAGAZINE';
const link = 'https://www.pap-magazine.com/api/ig-out?src=x_body_cta&to=post&url=https%3A%2F%2Fwww.instagram.com%2Freel%2FABC%2F';
const r1 = ab.bodyWithIgLinkCta(body, link, ab.CTA_LINE.article, x);
t('본문 \\n\\n CTA \\n 링크 \\n\\n 태그 순서', r1 && r1.cta === true && r1.text === '후킹 한 줄\n\n본문이다.\n\n자세한 내용은 아래 링크에서↓\n' + link + '\n\n#PAPMAGAZINE', r1 && JSON.stringify(r1.text));
t('CTA 갈래에 옛 안내 줄(풀 영상은 인스타 pap_magazine)은 없다', !/풀 영상은 인스타 pap_magazine/.test(r1.text));
const r2 = ab.bodyWithIgLinkCta(body, link, '', x);
t('CTA 문구가 비면 링크만 (bare 갈래 = 지금 그대로)', r2 && r2.cta === false && r2.text === ab.bodyWithIgLink(body, link, x));
const r3 = ab.bodyWithIgLinkCta('가'.repeat(115) + '\n\n#PAPMAGAZINE', link, ab.CTA_LINE.video, x);
t('CTA 넣으면 280 넘칠 때: CTA 를 떼고 링크만(cta:false)', r3 && r3.cta === false && !/풀 영상은 아래/.test(r3.text) && /ig-out/.test(r3.text));
t('링크만으로도 넘치면 null (호출부가 종전 경로로)', ab.bodyWithIgLinkCta('가'.repeat(135) + '\n\n#PAPMAGAZINE', link, ab.CTA_LINE.video, x) === null);

console.log('[4] 계측 라벨');
process.env.X_BODY_LINK_AB = 'all';
t("kind: 상시 body + CTA 들어감 → 'body_cta'", ab.kindWithCta(ab.kindFor('body', true), true) === 'body_cta');
t("kind: 상시 body + CTA 못 넣음 → 'body'", ab.kindWithCta(ab.kindFor('body', true), false) === 'body');
t("kind: 링크 자체가 못 들어감 → 'article' (CTA 표시 없음)", ab.kindWithCta(ab.kindFor('body', false), true) === 'article');
delete process.env.X_BODY_LINK_AB;
t("ig-out src 'x_body_cta'", ab.IG_OUT_SRC_CTA === 'x_body_cta');
const igout = rd('api/ig-out.js');
t('ig-out 화이트리스트: x_body_cta · boost_x · boost_x_cta', /'x_body_cta'/.test(igout) && /'boost_x'/.test(igout) && /'boost_x_cta'/.test(igout));
t('igFirstLink 채널에 x_body_cta (없으면 other 로 뭉개진다)', /'x_body_cta'/.test(rd('api/_lib/igFirstLink.js')));
const { igOutUrl } = require('../api/_lib/igFirstLink');
t('igOutUrl 이 x_body_cta 를 src 로 보낸다', /src=x_body_cta/.test(igOutUrl('https://www.instagram.com/reel/ABC/?igsh=1', 'x_body_cta')));

console.log('[5] 배선 — sync-instagram (기사 트윗)');
const sync = rd('api/cron/sync-instagram.js');
t('갈래는 body 갈래(본문 링크)일 때만 계산', /const ctaVariant = abVariant === 'body' \? ab\.ctaVariantFor\(inserted\.id\) : null/.test(sync));
t('src 는 갈래로 고른다 (x_body_cta / x_body)', /const igSrc = ctaVariant === 'cta' \? ab\.IG_OUT_SRC_CTA : ab\.IG_OUT_SRC/.test(sync));
t('CTA 문구는 미디어 종류로 고른다 (영상/기사)', /ctaVariant === 'cta' \? ab\.ctaLineFor\(xMedia\.kind\) : ''/.test(sync));
t('kind 는 실제로 CTA 가 들어갔을 때만 _cta', /ab\.kindWithCta\(ab\.kindFor\(abVariant, !!abBody\), !!\(abCta && abCta\.cta\)\)/.test(sync));
t('abBody 는 조립 결과 텍스트 (답글 분기·postTweet 그대로 쓴다)', /const abBody = abCta \? abCta\.text : null/.test(sync) && /kind: abKind/.test(sync));

console.log('[6] 배선 — goldenBoost (에디토리얼 부스트 트윗)');
const gb = rd('api/_lib/goldenBoost.js');
t('boostTextX 가 있고 X 는 그걸 쓴다', /function boostTextX\(permalink, mediaId\)/.test(gb) && /const xt = boostTextX\(m\.permalink, m\.id\)/.test(gb) && /x\.postTweet\(xt\.text, \{ kind: xt\.kind \}\)/.test(gb));
t('스레드는 boostText(src=boost) 그대로', /const text = boostText\(m\.permalink\);/.test(gb) && /threads\.postText\(text/.test(gb) || /postText\(text\)/.test(gb));
t('cta 갈래 문구·src·kind', /ab\.CTA_LINE\.editorial/.test(gb) && /src=boost_x_cta/.test(gb) && /kind: 'boost_cta'/.test(gb));
t("bare 갈래는 src boost_x · kind 'boost' · 꺼지면 src boost", /boostText\(permalink, 'boost_x'\), kind: 'boost'/.test(gb) && /return \{ text: boostText\(permalink\), kind: 'boost' \}/.test(gb));
t('boostText 기본 src 는 boost (기존 호출 호환)', /\(src \|\| 'boost'\)/.test(gb));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
