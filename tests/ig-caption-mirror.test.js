/**
 * 인스타그램 캡션 형식 고정 + 서버/어드민 미러 일치 (2026-08-03 신설).
 *
 * 왜 필요했나:
 *   캡션 빌더가 두 벌 존재한다 —
 *     · 서버: api/_lib/igCaption.js#buildPapIgCaption
 *       (review.js 승인, auto-generate.js 🤖, auto-generate-bulk.js)
 *     · 어드민: frontend/pap-admin.js#_buildIgCaptionFromEditorial (🔄 템플릿 재조립)
 *   손으로 미러링하는 구조라 한쪽만 고치면 조용히 어긋난다. 실제로
 *   2026-08-03 타이틀 줄 문구(exclusive editorial → 오리지널 에디토리얼)를
 *   바꿀 때 두 파일을 함께 고쳐야 했는데, 이를 강제하는 하네스가 없었다.
 *
 * 여기서 지키는 것:
 *   ① 타이틀 줄 문구는 '오리지널 에디토리얼' — 두 파일 모두
 *   ② 블록 순서: 훅 → 타이틀 → KR → 크레딧 → 구분선 → EN → IT → 링크 → Fashion → 태그
 *   ③ 해시태그는 정확히 5개, 줄바꿈 구분
 *   ④ 구조 표지가 두 파일에 모두 존재한다 (한쪽만 사라지면 실패)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const { buildPapIgCaption } = require('../api/_lib/igCaption');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

const TITLE_LINE = 'PAP 매거진 오리지널 에디토리얼';
const OLD_LINE = 'PAP 매거진 exclusive editorial';

const srv = R('api/_lib/igCaption.js');
const adm = R('frontend/pap-admin.js');

console.log('\n=== [1] 타이틀 줄 문구 ===');
(function () {
  t('서버 빌더가 오리지널 에디토리얼 을 쓴다', srv.indexOf(TITLE_LINE) !== -1);
  t('어드민 미러도 오리지널 에디토리얼 을 쓴다', adm.indexOf(TITLE_LINE) !== -1);
  t('옛 문구(exclusive editorial)가 서버에 남아있지 않다',
    srv.indexOf(OLD_LINE) === -1,
    '도메니코 확인(2026-08-03): 기존 캡션 표기는 오리지널 에디토리얼');
  t('옛 문구가 어드민에도 남아있지 않다', adm.indexOf(OLD_LINE) === -1);
})();

console.log('\n=== [2] 실제 출력 — Reir Llorando 기준 캡션 ===');
const cap = buildPapIgCaption({
  title: 'Reir Llorando',
  hook: '무대 위 가면과 그 아래 얼굴 사이, 경계는 생각보다 얇다.',
  descKo: '한국어 단락입니다.',
  descEn: 'English paragraph.',
  descIt: 'Paragrafo italiano.',
  creditLines: [
    'Photographer & Art Director @daiaquije',
    'Stylist @tone_mode',
    'Make Up & Hair @lina_m_u_a_',
    'Retouching @daiaquije',
  ],
  starring: ['@candedecarli'],
  brandHandles: ['@juanperezvintage', '@dudouvintage'],
  moodTag: '연극적패션',
  slug: 'reir-llorando',
});
const L = cap.split('\n');
const at = (needle) => L.findIndex((l) => l.indexOf(needle) !== -1);

(function () {
  t('첫 줄은 한국어 훅 (피드 접힘 위 유일한 문장)',
    L[0] === '무대 위 가면과 그 아래 얼굴 사이, 경계는 생각보다 얇다.');
  t("타이틀 줄은 'Reir Llorando' — PAP 매거진 오리지널 에디토리얼",
    cap.indexOf("'Reir Llorando' — " + TITLE_LINE) !== -1);
  const iHook = 0;
  const iTitle = at(TITLE_LINE);
  const iKo = at('한국어 단락입니다.');
  const iCredit = at('Photographer & Art Director @daiaquije');
  const iStar = at('Starring @candedecarli');
  const iRule = at('FOR MORE EDITORIALS | @pap_magazine');
  const iEn = at('(EN) English paragraph.');
  const iIt = at('(IT) Paragrafo italiano.');
  const iLink = at('Full Story link🔎 <Screenshot and copy-paste>');
  const iUrl = at('https://www.pap-magazine.com/editorial/reir-llorando');
  const iFashion = at('Fashion by @juanperezvintage @dudouvintage');
  const iTag = at('#패션화보');

  t('모든 블록이 존재한다',
    [iTitle, iKo, iCredit, iStar, iRule, iEn, iIt, iLink, iUrl, iFashion, iTag]
      .every((i) => i > 0),
    JSON.stringify({ iTitle, iKo, iCredit, iStar, iRule, iEn, iIt, iLink, iUrl, iFashion, iTag }));
  const order = [iHook, iTitle, iKo, iCredit, iStar, iRule, iEn, iIt, iLink, iUrl, iFashion, iTag];
  t('블록 순서: 훅→타이틀→KR→크레딧→Starring→구분선→EN→IT→링크→URL→Fashion→태그',
    order.every((v, i) => i === 0 || v > order[i - 1]),
    JSON.stringify(order));
  t('URL 은 링크 안내 바로 다음 줄', iUrl === iLink + 1);
})();

console.log('\n=== [3] 해시태그 정책 (캡션+댓글 합산 5개) ===');
(function () {
  const tags = cap.split('\n').filter((l) => /^#\S+$/.test(l.trim()));
  t('정확히 5개', tags.length === 5, tags.join(' '));
  t('줄바꿈으로 구분된다 (한 줄에 하나)', tags.every((l) => l.trim().split(' ').length === 1));
  t('고정 태그 #패션화보 #에디토리얼 포함',
    cap.indexOf('#패션화보') !== -1 && cap.indexOf('#에디토리얼') !== -1);
  t('무드 태그(AI)가 들어간다', cap.indexOf('#연극적패션') !== -1);
  t('마지막은 #papmagazine', cap.trim().split('\n').pop().trim() === '#papmagazine');
})();

console.log('\n=== [4] 선택 블록은 없으면 생략 ===');
(function () {
  const bare = buildPapIgCaption({ title: 'Solo' });
  t('훅이 없으면 타이틀 줄이 첫 줄',
    bare.split('\n')[0] === "'Solo' — " + TITLE_LINE);
  t('slug 없으면 Full Story link 블록 없음',
    bare.indexOf('Full Story link') === -1);
  t('IT 없으면 (IT) 줄 없음', bare.indexOf('(IT)') === -1);
  t('브랜드 없으면 Fashion by 없음', bare.indexOf('Fashion by') === -1);
  t('빈 줄이 3연속으로 남지 않는다', bare.indexOf('\n\n\n') === -1);
})();

console.log('\n=== [5] 어드민 미러가 같은 구조 표지를 갖는다 ===');
(function () {
  const MARKERS = [
    'FOR MORE EDITORIALS',
    'Full Story link',
    '(EN) ',
    '(IT) ',
    'Fashion by ',
    'Starring ',
    '패션화보',
    '에디토리얼',
    'papmagazine',
    'FASHIONEDITORIAL',
  ];
  MARKERS.forEach((m) => {
    t('미러에 표지 존재: ' + m.trim(), adm.indexOf(m) !== -1,
      'frontend/pap-admin.js#_buildIgCaptionFromEditorial 이 서버 형식과 어긋났다');
  });
  t('서버 파일에도 같은 표지가 전부 있다', MARKERS.every((m) => srv.indexOf(m) !== -1));
  t('미러 함수가 실제로 존재한다',
    adm.indexOf('_buildIgCaptionFromEditorial') !== -1);
  t('서버 주석이 미러 동기화 의무를 명시한다',
    srv.indexOf('_buildIgCaptionFromEditorial') !== -1,
    '형식 변경 시 어드민도 함께 고치라는 안내가 사라지면 재발한다');
})();

console.log(`\n${fail === 0 ? '✅' : '❌'} ig-caption-mirror: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
