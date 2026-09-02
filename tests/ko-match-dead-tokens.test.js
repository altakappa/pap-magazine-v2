/**
 * 파일명↔기사 매칭 — 판별력 없는 낱말을 분모에서 뺀다 (2026-09-02 신설)
 *
 * ■ 무엇이 망가져 있었나
 * 드라이브 '유튜브'·'틱톡' 크론이 매 실행 '매칭 실패 15건' 만 뱉고 있었다.
 * 만들어 둔 영상이 유튜브·틱톡에 하나도 안 나가고 있었다는 뜻이다.
 *
 * 최근 21일 기사 206편으로 **실제 파일명 3개를 재현**한 결과 (배포 전):
 *
 *   0902_산드로 설윤 댓글 DM.mp4   0.50 (기준 0.60) 거부
 *     토큰 4개 중 '댓글'·'DM' 이 어느 기사에도 안 걸린다. 영상 내용을 적은
 *     작업용 낱말인데 분모에 남아 점수를 절반으로 깎았다.
 *
 *   0902_휠라 한소희.mp4           0.50 거부
 *     한소희 1.00, 휠라 0.00. 외래어 브랜드는 한글 표기가 음차라 로마자
 *     규칙이 안 맞는다:  휠라→hwilra vs fila→dice 0.250
 *                        오트리→oduri vs audry→dice 0.000  (아예 0)
 *
 *   0901_오트리 창빈.mp4           1.00 vs 1.00 거부
 *     같은 사건으로 기사가 2편 나갔다. **이건 옳은 거부다.**
 *
 * ■ 지키는 것
 *   ① 판별력 0 인 토큰(어느 기사에도 안 걸림)은 분모에서 뺀다
 *   ② 임계값 0.60·마진 0.20 두 문은 **그대로 둔다** ← 사고를 막는 장치다
 *   ③ 절반도 안 남으면 거부한다 (파일명이 기사와 무관하다는 뜻)
 *   ④ 같은 사건 기사 2편은 계속 거부한다 — 사람이 골라야 한다
 *   ⑤ 버려진 낱말을 결과에 남긴다 (왜 이렇게 판정했는지 보여야 한다)
 */
'use strict';

const path = require('path');
const km = require(path.resolve(__dirname, '..', 'api', '_lib', 'koMatch.js'));

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

/* 라이브 DB 에서 그대로 뜬 기사들 (2026-09-02, 최근 21일 발행분) */
const A_SULLYOON_SANDRO = { title: '설윤이 직접 말하는 산드로 26FW 프레젠테이션',
  tags: ['sullyoon', 'nmixx', 'sandro', '26fw', 'paris', 'presentation', 'kpop', 'fashion'] };
const A_SULLYOON_SMILE = { title: '설윤의 미소를 다운로드하는 법',
  tags: ['sullyoon', 'nmixx', 'sandro', 'fw26', 'editorial', 'kpop', 'paris', 'minimalism'] };
const A_HANSOHEE_FILA = { title: '한소희가 발견한 실버의 온도',
  tags: ['han so-hee', 'fila', 'fila colore', 'silver', 'art project', 'echappe silver moon'] };
const A_CHANGBIN_1 = { title: '창빈의 시그니처가 오트리 위에 올라탔다',
  tags: ['changbin', 'autry', 'stray kids', 'sneakers', 'capsule collection'] };
const A_CHANGBIN_2 = { title: '스트레이 키즈 창빈, 오트리와 협업 런칭 파티 호스트로 나서다',
  tags: ['stray kids', 'changbin', 'autry', 'collaboration', 'launch party'] };
const ALL = [A_HANSOHEE_FILA, A_SULLYOON_SMILE, A_SULLYOON_SANDRO, A_CHANGBIN_1, A_CHANGBIN_2];

console.log('[1] 실제로 막혀 있던 파일 두 건이 붙는다');
const m1 = km.matchArticle('0902_산드로 설윤 댓글 DM.mp4', ALL);
t('산드로 건이 매칭된다', m1.matched === A_SULLYOON_SANDRO, m1.reason);
t('맞는 기사를 골랐다 (설윤 기사 두 편 중 산드로가 제목에 있는 쪽)',
  m1.matched && m1.matched.title === '설윤이 직접 말하는 산드로 26FW 프레젠테이션');
t('버려진 낱말이 결과에 남는다', (m1.dead || []).join('·') === '댓글·DM', m1.dead);
t('2등과 충분히 벌어졌다', m1.score - m1.runnerUp >= km.MARGIN, m1.score + ' vs ' + m1.runnerUp);

const m2 = km.matchArticle('0902_휠라 한소희.mp4', ALL);
t('휠라 건이 매칭된다', m2.matched === A_HANSOHEE_FILA, m2.reason);
t('로마자가 안 맞던 휠라를 버렸다', (m2.dead || []).join('·') === '휠라', m2.dead);

console.log('\n[2] 같은 사건 기사 2편은 계속 거부한다  ← 고치면 안 되는 것');
const m3 = km.matchArticle('0901_오트리 창빈.mp4', ALL);
t('오트리 건은 거부된다', m3.matched === null, m3.reason);
t('사유가 "사람이 골라야 한다" 다', /사람이 골라야 한다/.test(m3.reason), m3.reason);
t('두 기사 제목이 사유에 다 나온다',
  /창빈의 시그니처/.test(m3.reason) && /런칭 파티/.test(m3.reason), m3.reason);

console.log('\n[3] 두 문(임계값·마진)은 그대로다  ← 사고를 막는 장치');
t('임계값이 0.60', km.THRESHOLD === 0.60, km.THRESHOLD);
t('마진이 0.20', km.MARGIN === 0.20, km.MARGIN);
/* 파일 머리말의 실측 사례 — 이게 이 파일이 존재하는 이유다. */
const BAEDELI_1 = { title: '규진의 공항 패션, 베이델리로 완성한 꾸안꾸 스타일링', tags: ['kyujin'] };
const BAEDELI_2 = { title: '엔믹스 규진, 베이델리 제주 애월 플래그십 오픈 현장 공개', tags: ['kyujin'] };
const mb = km.matchArticle('베이델리 규진.mp4', [BAEDELI_1, BAEDELI_2]);
t('"베이델리 규진" 은 여전히 거부된다 (머리말의 실측 사례)', mb.matched === null, mb.reason);

console.log('\n[4] 절반도 안 남으면 거부한다 (억지 매칭 금지)');
const m4 = km.matchArticle('한소희 최종본 v2 수정 컬러 보정 렌더.mp4', ALL);
t('낱말 6개 중 1개만 걸리면 거부', m4.matched === null, m4.reason);
t('사유에 몇 개 중 몇 개인지 적힌다', /개 중 .*개만 기사에 걸림/.test(m4.reason), m4.reason);
t('버린 낱말을 나열한다', /버림:/.test(m4.reason), m4.reason);

const m5 = km.matchArticle('완전히 상관없는 파일 이름.mp4', ALL);
t('하나도 안 걸리면 그 사실을 적는다', m5.matched === null && /어느 기사에도 안 걸림/.test(m5.reason), m5.reason);

console.log('\n[5] 엉뚱한 기사에 붙지 않는다  ← 이게 틀리면 공개 유튜브 사고다');
/* 판별력 0 토큰을 빼도 **순위는 바뀌지 않는다** — 뺀 토큰은 모든 기사에서 0 이므로
   모든 기사의 점수를 똑같이 깎고 있었을 뿐이다. 그 성질을 여기서 고정한다. */
const only = [A_HANSOHEE_FILA];
t('기사가 하나뿐이어도 안 닮았으면 거부',
  km.matchArticle('창빈 오트리.mp4', only).matched === null,
  km.matchArticle('창빈 오트리.mp4', only).reason);
t('사람 이름이 다르면 안 붙는다',
  km.matchArticle('휠라 지수.mp4', only).matched === null,
  km.matchArticle('휠라 지수.mp4', only).reason);
t('빈 파일명은 거부', km.matchArticle('.mp4', ALL).matched === null);
t('기사 목록이 비면 거부', km.matchArticle('휠라 한소희.mp4', []).matched === null);
t('null 을 넘겨도 던지지 않는다', km.matchArticle('휠라 한소희.mp4', null).matched === null);

console.log('\n[6] tokenIsLive 자체');
t('제목에 있는 낱말은 살아 있다', km.tokenIsLive('한소희', ALL) === true);
t('태그로만 걸려도 살아 있다', km.tokenIsLive('설윤', ALL) === true);
t('어디에도 없는 낱말은 죽었다', km.tokenIsLive('댓글', ALL) === false);
t('로마자가 안 맞는 외래어도 죽은 것으로 본다', km.tokenIsLive('휠라', ALL) === false);
t('기사가 없으면 죽었다', km.tokenIsLive('한소희', []) === false);

console.log('\n[낱말 경계] 낱말 중간에서 걸리면 안 된다 (2026-09-02)');
/* 실측 사고: 토큰 '유가'(카스쿨 아티스트)가 기사 '공유가 보여준 브라운 NEVO의
   어른 남자 제스처' 에 **만점 1.0** 으로 붙었다. squash 가 공백을 지워 제목이
   한 덩어리가 되는 바람에 낱말 중간에서도 걸렸기 때문이다.

   지금은 다른 토큰이 점수를 눌러 문턱을 못 넘고 있을 뿐이다. 가중치를 손대는
   순간 1등이 된다 — 낱말 가중치(1/df) 실험에서 '카스쿨 유가.mp4' 가 저 기사에
   0.80 으로 붙는 걸 실제로 봤다. 이 파일의 존재 이유가 바로 그 사고 방지다.

   한글은 조사가 뒤에 붙지 앞에 안 붙는다. 그래서 '덩어리 시작' 규칙이 성립한다. */
const 공유기사 = { title: '공유가 보여준 브라운 NEVO의 어른 남자 제스처', tags: [] };
t('낱말 중간에서 걸린 조각은 0 이다  ← 가짜 일치', km.tokenHit('유가', 공유기사) === 0,
  km.tokenHit('유가', 공유기사));
t('진짜 낱말은 그대로 1 이다', km.tokenHit('공유', 공유기사) === 1);
t('조사가 뒤에 붙어도 걸린다 (설윤이·한소희가)',
  km.tokenHit('설윤', { title: '설윤이 직접 말하는 산드로 26FW 프레젠테이션', tags: [] }) === 1
  && km.tokenHit('한소희', { title: '한소희가 발견한 실버의 온도', tags: [] }) === 1);
/* squash 가 공백을 지우는 것 자체는 지켜야 한다 — '디올뷰티' ↔ '디올 뷰티'. */
t('띄어쓰기가 달라도 여전히 걸린다 (경계 규칙이 이걸 깨면 안 된다)',
  km.tokenHit('디올뷰티', { title: '뽀용한 블러 립 원한다면, 디올 뷰티가 정답', tags: [] }) === 1);
t('제목 맨 앞도 시작으로 본다',
  km.tokenHit('넥스지', { title: '넥스지가 컴백했다', tags: [] }) === 1);
t('영문·숫자 뒤는 한글 덩어리가 아니므로 시작으로 본다',
  km.tokenHit('마틴', { title: 'YSL 마틴의 밤', tags: [] }) === 1);

console.log('\n[실패 목록] 이름만 찍으면 사람이 무엇을 할지 모른다 (2026-09-02)');
/* 0821_몬스타엑스 가 12일째 매 10분마다 이름만 찍히고 있었다.
   14건이 전부 같은 '매칭 실패' 로 보였지만 성격이 셋이고 할 일이 다 다르다.
   도메니코 2026-09-02: "몬스타엑스는 이미 올려서 삭제해도 된다" →
   지우는 대신 목록에서 빼는 쪽을 골랐다. 원본을 지우는 건 되돌릴 수 없다. */
const U = [
  { name: 'a.mp4', reason: '같은 사건 기사가 여럿 (1.00 vs 1.00) — 사람이 골라야 한다: A / B' },
  { name: 'b.mp4', reason: '같은 사건 기사가 여럿 (1.00 vs 1.00) — 사람이 골라야 한다: C / D' },
  { name: 'c.mp4', reason: '파일명 낱말이 어느 기사에도 안 걸림 (베를린·쇼룸)' },
  { name: 'd.mp4', reason: '가장 닮은 기사도 0.50 (기준 0.6) — 닮은 게 없음' },
];
const g = km.groupUnmatched(U);
t('사유별로 묶는다 (셋이 한 덩어리로 보이면 아무도 안 건드린다)',
  /사람이 골라야 2/.test(g) && /기사 없음 1/.test(g) && /닮은 기사 없음 1/.test(g), g);
t('파일 이름을 잃지 않는다', /a\.mp4/.test(g) && /c\.mp4/.test(g), g);
t('빈 목록에도 안 죽는다', km.groupUnmatched([]) === '' && km.groupUnmatched(null) === '');
t('사유가 없어도 안 죽는다 (판단 못 하면 기타로 둔다)',
  /기타/.test(km.groupUnmatched([{ name: 'x.mp4' }])));

console.log('\n[목록에서 빼기] 지우지 않고 표시로 뺀다');
/* ⚠️ driveVideos 는 supabase 를 끌고 온다. 테스트에서 그대로 require 하면
   env 없는 CI 에서 'supabaseUrl is required' 로 죽는다 —
   2026-07-30 에 이미 겪은 사고이고 faqHealth.js 머리말에 적혀 있다.
   내가 그걸 그대로 반복했다. 클라이언트를 만들지 않도록 먼저 막는다. */
const Module = require('module');
(() => {
  const sp = path.join(__dirname, '..', 'api', '_lib', 'supabase.js');
  const m = new Module(sp, null);
  m.filename = sp; m.loaded = true; m.exports = { supabaseAdmin: {}, supabase: {} };
  require.cache[sp] = m;
})();
const drive = require(path.join(__dirname, '..', 'api', '_lib', 'driveVideos.js'));
t("'_' 로 시작하면 뺀다 (종전부터 있던 규칙)", !!drive.shouldSkip('_0821_몬스타엑스', null, 'youtube'));
t("이름에 '완료' 가 있으면 뺀다  ← 이번에 추가", !!drive.shouldSkip('0821_몬스타엑스 완료', null, 'youtube'));
t("'done' 도 받는다", !!drive.shouldSkip('monstax done.mp4', null, 'youtube'));
t("'보류' 는 그대로 받는다 (뜻이 다르지만 종전 표기를 깨지 않는다)",
  !!drive.shouldSkip('보류_a.mp4', null, 'youtube'));
t('표시가 없으면 그대로 처리한다 (아무거나 빼면 안 된다)',
  drive.shouldSkip('0821_몬스타엑스', null, 'youtube') === null);
/* 2026-08-21 실사고 — 압축 중 임시 파일이 그대로 업로드됐다. 이건 절대 안 깨져야 한다. */
t("'.' 로 시작하는 작업 중 파일은 계속 막는다",
  !!drive.shouldSkip('.압축중_123_x.mp4', null, 'youtube'));

console.log('\n' + (fail ? '✗' : '✓') + ' ko-match-dead-tokens: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
