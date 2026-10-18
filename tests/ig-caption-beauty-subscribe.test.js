/**
 * 인스타 캡션 형식 2026-10-18 (도메니코 MATISSE 예시 "인스타그램 캡션은 텔레그램으로 이렇게 줘야해")
 *  ① 뷰티 화보(장르 BEAUTY, FASHION 아님)는 브랜드 줄이 'Beauty by'
 *  ② 브랜드 줄 다음 · 해시태그 앞에 구독 안내 한 줄
 * 서버 빌더(igCaption.js)와 어드민 미러(pap-admin.js)가 같아야 한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }
const ig = require('../api/_lib/igCaption');

const SUB = 'Subscribe to the PAP platform to enjoy affordable access to a range of premium services, including tearsheet downloads, collaborator selection, and more.';
t('구독 안내 문구 원문 그대로', ig.SUBSCRIBE_LINE === SUB);
t("BEAUTY·ART·PORTRAIT → 'Beauty by'", ig.brandLineLabel(['BEAUTY', 'ART', 'PORTRAIT']) === 'Beauty by');
t("FASHION → 'Fashion by'", ig.brandLineLabel(['FASHION']) === 'Fashion by');
t("FASHION+BEAUTY → 'Fashion by' (패션이 섞이면 패션)", ig.brandLineLabel(['FASHION', 'BEAUTY']) === 'Fashion by');
t("장르 없음 → 'Fashion by' (종전 그대로)", ig.brandLineLabel([]) === 'Fashion by' && ig.brandLineLabel(undefined) === 'Fashion by');
t('editorials.tags 의 pap:* 태그가 섞여도 판정', ig.brandLineLabel(['BEAUTY', 'pap:pin-ok']) === 'Beauty by');

// MATISSE 실데이터로 조립 → 도메니코 예시의 뼈대와 같아야 한다
const cap = ig.buildPapIgCaption({
  title: 'MATISSE', hook: '누드에서 네온까지, 마티스의 언어로 쓴 뷰티.',
  descKo: '앙리 마티스의 조형 언어에서 출발했다.', descEn: 'A beauty film.', descIt: 'Un beauty film.',
  creditLines: ['Photographer @saburovdmitrii', 'Art Director @sshagavr', 'Make Up & Hair @thrhko'],
  starring: ['@sggzv33', '@vprojectmodels'],
  brandHandles: ['@makeupforever', '@kryolanofficial', '@krygina.cosmetics'],
  moodTag: '아트뷰티', slug: 'matisse', genres: ['BEAUTY', 'ART', 'PORTRAIT'],
});
const want = [
  '누드에서 네온까지, 마티스의 언어로 쓴 뷰티.', '',
  "'MATISSE' — PAP 매거진 오리지널 에디토리얼", 'Published by @kangdm', '',
  '앙리 마티스의 조형 언어에서 출발했다.', '',
  'Photographer @saburovdmitrii', 'Art Director @sshagavr', 'Make Up & Hair @thrhko', 'Starring @sggzv33 @vprojectmodels', '',
  'FOR MORE EDITORIALS | @pap_magazine', '',
  '(EN) A beauty film.', '', '(IT) Un beauty film.', '',
  'Full Story link🔎 <Screenshot and copy-paste>', 'https://www.pap-magazine.com/editorial/matisse?utm_source=ig&utm_campaign=caption', '',
  'Beauty by @makeupforever @kryolanofficial @krygina.cosmetics', '',
  SUB, '',
  '#패션화보', '#에디토리얼', '#아트뷰티', '#FASHIONEDITORIAL', '#papmagazine',
].join('\n');
t('MATISSE 조립 결과 = 도메니코 예시 뼈대 (줄 단위 일치)', cap === want, cap);
const fashion = ig.buildPapIgCaption({ title: 'X', brandHandles: ['@agolde'], genres: ['FASHION'] });
t('패션 화보는 Fashion by + 구독 안내', /\nFashion by @agolde\n\nSubscribe to the PAP platform/.test(fashion));
const noBrand = ig.buildPapIgCaption({ title: 'X' });
t('브랜드가 없어도 구독 안내는 해시태그 바로 앞', /Subscribe to the PAP platform[^\n]*\n\n#패션화보/.test(noBrand));

// 호출부 배선
t('review.js 가 desc.genre 를 넘긴다', /genres: Array\.isArray\(desc\.genre\)/.test(rd('api/submissions/[id]/review.js')));
t('auto-generate 가 editorials.tags 를 넘긴다', /genres: \(ed && Array\.isArray\(ed\.tags\)\)/.test(rd('api/admin/editorials/[id]/auto-generate.js')));
const bulk = rd('api/admin/editorials/auto-generate-bulk.js');
t('auto-generate-bulk 도 tags 를 읽고 넘긴다', /source_submission_id, tags'\)/.test(bulk) && /genres: \(ed && Array\.isArray\(ed\.tags\)\)/.test(bulk));

// 어드민 미러
const adm = rd('frontend/pap-admin.js');
t('어드민 미러: Beauty by 판정 (tags 기준)', /_g\.indexOf\('BEAUTY'\) !== -1 && _g\.indexOf\('FASHION'\) === -1\) \? 'Beauty by' : 'Fashion by'/.test(adm));
t('어드민 미러: 구독 안내 문구가 서버와 같다', adm.indexOf(SUB) !== -1);
t('캐시버스트 pap-admin.js ≥170', (() => { const m = rd('frontend/admin.html').match(/pap-admin\.js\?v=(\d+)/); return m && Number(m[1]) >= 170; })());

// 크레딧 수정 동기화가 Beauty by 줄을 지킨다
const { syncCaptionCredits } = require('../api/_lib/captionCreditSync');
const r = syncCaptionCredits(want, [], [], { beforeBrands: [{ instagram: '@makeupforever' }], afterBrands: [{ instagram: '@makeupforever' }, { instagram: '@nars' }] });
t("크레딧 동기화: 'Beauty by' 머리말 유지하며 브랜드 교체", /\nBeauty by @makeupforever @nars\n/.test(r.caption), r.caption);
t('크레딧 동기화: 구독 안내 줄은 크레딧 줄로 안 본다', !/Subscribe[^\n]*\n[^\n]*@new/.test(syncCaptionCredits(want, [], [{ instagram: '@new', roles: ['Stylist'] }]).caption));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
