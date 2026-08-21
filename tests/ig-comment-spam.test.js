/**
 * IG 스팸 댓글 탐지기 — 2026-08-19 PAP 게시물에서 실제로 수집한 표본 기반.
 * 이 테스트가 지키는 것: ①실제 스팸을 놓치지 않는다 ②정상 댓글을 잡지 않는다
 * ③미끼 이름이 바뀌어도 '수법'만으로 잡는다 ④같은 문구 다계정 반복을 묶는다
 */
const assert = require('assert');
const { score, fingerprint, structuralSignals, normalize, autoHidable, ownSignals } = require('../api/_lib/igCommentSpam');

const T = 60;
let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

// 실제 수집 표본 (2026-08-19 13:31~13:35, pap_magazine 커버낫 게시물)
const SPAM = [
  '(19x.zone) 쮸ι소ι창에 검ιι색 해 봐 남ιι자 만 들 어 와 송ι하ι리 。라ι방ι사ι건 ㄹㅈㄷ그거 나옴ㅋㅋ',
  '(19x。club) 쮸ι소ι창에 검ιι색 해 봐 남 자 만 들 어 와 난 리 났 다 하더라',
  '"송ι하ι리 Gι컵 원ι본"  G: ::: O: :: O: :: G: :: L: :: E: 로 찾 기 해 봐 ㄹㅇ 미 드 장난아니더라',
  '밀。탱。크。녀。  ⑤. 4. ⑦. 2. 원‥‥ 본 G...._O__O__G__L__E 로 검ιι색 해 봐 V..I..P 전..용 방..송...사..고나옴ㅋ',
  '(19x。zone) 쥬ι소ι쳐ι봐 남 자 만 들 어 와 미드 장난아니더라 인플루언서 VIP 전..용 방..송..사..고 나옴ㅋ',
  "(밀。탱。크。녀。③ι⑥ι⑨ι②)  G⁺O⁺O⁺G⁺L⁺E 로 검ιι색 해 봐 존//예 ㄹㅈㄷ그거 나옴ㅋㅋ",
  '19x。club 쮸ι소ι창에 검ιι색 해 봐 <<G:→O:→O:→G:→L:→E: 검..색 남 자 만 들 어 와 지컵ㄹㅈㄷ그거 나옴ㅋㅋ 어린애들은 검색하지마라 ——',
  "'밀'탱'크'녀⑤:4:⑦:2 원.본'  꾸◇....。◇◇◇....글 로 검ιι색 해 봐 V..I..P 전용 방.. 송..사 ..고 나옴ㅋ",
];

// 정상 댓글 — 특히 어필리에이트 구매 의향과 광고·협업 문의는 절대 잡히면 안 된다
const HAM = [
  '이 자켓 어디서 구매할 수 있나요? 링크 부탁드려요',
  '협업 문의드립니다. 디엠 확인 부탁드려요!',
  '사나 진짜 예쁘다 ㄹㅈㄷ',
  '원본 사진 더 볼 수 있나요?',
  '커버낫 이번 컬렉션 너무 좋아요',
  'Where can I buy this? Link please',
  '이거 정품 맞나요? 가격 궁금해요',
  '영상 언제 올라오나요?',
  '와 이 화보 미쳤다 진짜 레전드',
  '광고 문의는 어디로 드리면 될까요?',
];

console.log('IG 댓글 스팸 탐지기');

t('실제 스팸 표본을 전부 탐지한다', () => {
  for (const s of SPAM) {
    const r = score(s);
    assert.ok(r.total >= T, `놓침(${r.total}점): ${s.slice(0, 30)}`);
  }
});

t('정상 댓글을 하나도 잡지 않는다', () => {
  for (const h of HAM) {
    const r = score(h);
    assert.ok(r.total < T, `오탐(${r.total}점, ${r.signals}): ${h}`);
  }
});

t('미끼 이름이 전부 바뀌어도 구조 신호만으로 탐지한다', () => {
  const future = [
    '(88y.top) 쮸ι소ι창에 검ιι색 해 봐 남ιι자 만 들 어 와 김ι나ι현 。클ι럽ι영ι상 그거 나옴ㅋㅋ',
    "【|백'조'녀③:①:④:⑦|]걔 맞다던데...? 영 상 아직 뜨긴 하더라. |NιAιVιEιR|에 |김。나。현。클,럽,영,상| 쳐봐봐",
  ];
  for (const s of future) {
    const only = structuralSignals(s).reduce((a, x) => a + x.w, 0);
    assert.ok(only >= T, `이름 없이 못 잡음(${only}점): ${s.slice(0, 30)}`);
  }
});

t('같은 문구를 여러 계정이 뿌리면 지문이 같다', () => {
  const a = '(밀。탱。크。녀。③ι⑥ι⑨ι②)  G⁺O⁺O⁺G⁺L⁺E 로 검ιι색 해 봐 존//예 ㄹㅈㄷ그거 나옴ㅋㅋ';
  assert.strictEqual(fingerprint(a), fingerprint(a));
  // 숫자 자리만 바뀐 변형도 같은 지문으로 묶인다
  const b1 = "밀'탱'크'녀 ⑤:④:⑦:② 。원ι본 。 꾸。글 로 검ιι색 해 봐";
  const b2 = "밀'탱'크'녀 ③:②:⑤:④ 。원ι본 。 꾸。글 로 검ιι색 해 봐";
  assert.strictEqual(fingerprint(b1), fingerprint(b2));
});

t('정상 댓글끼리는 지문이 겹치지 않는다', () => {
  const fps = new Set(HAM.map(fingerprint));
  assert.strictEqual(fps.size, HAM.length);
});

t('이모지만 있는 댓글은 지문을 만들지 않는다 (2026-08-19 실전 오탐)', () => {
  // 실전에서 '😢😢😢😢' 류 20건이 전부 빈 지문으로 묶여 '20계정 살포'로
  // 오인됐다. 서로 무관한 팬 반응이었다. 묶을 글자가 없으면 묶지 않는다.
  for (const v of ['😢😢😢😢', '🔥🔥🔥', '❤️', '👏🏻🎂🎱', '...', '   ']) {
    assert.strictEqual(fingerprint(v), null, `지문이 생기면 안 됨: ${v}`);
  }
});

t('짧은 정상 댓글도 지문을 만들지 않는다', () => {
  // '잘생깃다', 'Anton❤️' 같은 짧은 반응이 우연히 겹쳐 살포로 몰리면 안 된다
  for (const v of ['Anton❤️', '소희 귀여워', '멋져요']) {
    assert.strictEqual(fingerprint(v), null);
  }
});

t('우리 계정을 태그만 한 댓글은 지문을 만들지 않는다 (2026-08-19 오탐 2차)', () => {
  // 실전: '@pap_magazine 🤍' 류 4건이 정확히 60점(살포 가산만)으로 스팸 판정됐다.
  // 여러 팬이 우리를 태그하면 정규화 후 같은 문자열이 된다. 그건 살포가 아니다.
  // 그리고 이건 숨기면 가장 아까운 댓글이다.
  for (const v of ['@pap_magazine 🤍', '🤝🏼🤍 @pap_magazine', '@pap_magazine 🥹🧡', '@pepperitmag ❤️']) {
    assert.strictEqual(fingerprint(v), null, `지문이 생기면 안 됨: ${v}`);
  }
});

t('멘션 댓글은 점수가 0이다', () => {
  for (const v of ['@pap_magazine 🤍', '🤝🏼🤍 @pap_magazine', '@pap_magazine 🥹🧡']) {
    assert.strictEqual(score(v).total, 0, `점수가 붙으면 안 됨: ${v}`);
  }
});

t('실제 스팸 문구는 지문이 생긴다', () => {
  for (const s2 of SPAM) assert.ok(fingerprint(s2), '스팸인데 지문 없음: ' + s2.slice(0, 25));
});

t('정규화가 이물질 문자를 걷어낸다', () => {
  assert.strictEqual(normalize('송ι하ι리'), '송하리');
  assert.strictEqual(normalize('검ιι색'), '검색');
  assert.ok(normalize('⑤②⑨⑦').includes('5297'));
});

t('빈 입력·null 에 터지지 않는다', () => {
  for (const v of [null, undefined, '', '   ', 123]) {
    const r = score(v);
    assert.ok(typeof r.total === 'number');
  }
});

t('자동 숨김: 살포 가산만으로는 절대 자동 처리되지 않는다', () => {
  // 2026-08-19 오탐 2건은 둘 다 '자기 신호 0개 + 살포 가산' 이었다.
  // 점수를 아무리 올려도 이 모양은 자동 숨김이 되면 안 된다.
  assert.strictEqual(autoHidable(60, []).auto, false);
  assert.strictEqual(autoHidable(120, ['burst:20건']).auto, false);
  assert.strictEqual(autoHidable(900, ['burst:99건']).auto, false, '살포만으로 자동 처리됨');
});

t('자동 숨김: 실전 표본이 올바르게 갈린다', () => {
  // 하룻밤 실전 107건 중 최저점(110점)과 최고점(460점)
  assert.strictEqual(autoHidable(110, ['char_spacing', 'search_bait', 'bait:밀탱크녀']).auto, false,
    '110점은 자동 기준(150) 미만이라 사람이 봐야 한다');
  assert.strictEqual(autoHidable(460, ['char_spacing', 'domain_bait', 'bait:19x', 'burst:5건']).auto, true);
  assert.strictEqual(autoHidable(150, ['char_spacing', 'domain_bait']).auto, true, '경계값이 안 걸린다');
});

t('자동 숨김: 자기 신호가 1개뿐이면 자동 처리하지 않는다', () => {
  assert.strictEqual(autoHidable(400, ['bait:19x']).auto, false);
  assert.strictEqual(autoHidable(400, ['bait:19x', 'burst:9건']).auto, false, '살포를 자기 신호로 센다');
});

t('ownSignals 가 살포 가산을 걸러낸다', () => {
  assert.deepStrictEqual(ownSignals(['char_spacing', 'burst:5건', 'bait:19x']), ['char_spacing', 'bait:19x']);
});

/* 2026-08-21: 스패머가 ⑤,,②,,⑨,,⑦ → 5,,4,,7,,2 로 바꿔 30점을 피해 갔다.
 * 원문자냐 아니냐가 아니라 '숫자를 구두점으로 끊는다' 가 수법이다. */

t('한 자리 숫자를 구두점으로 끊은 것을 잡는다', () => {
  const a = score('밀′′탱′′크′′녀 5,,4,,7,,2 꾸 글 로 검ιι색 해 봐');
  assert.ok(a.signals.includes('spaced_digits'), '일반 숫자 끊기를 못 잡는다: ' + a.signals.join(','));
});

t('같은 수법을 두 번 세지 않는다 (원문자면 더하지 않는다)', () => {
  const b = score('밀′′탱′′크′′녀 ⑤,,②,,⑨,,⑦ 꾸 글 로 검ιι색 해 봐');
  assert.ok(b.signals.includes('enclosed_digits'));
  assert.ok(!b.signals.includes('spaced_digits'), '원문자와 숫자끊기가 이중 계산된다');
});

t('날짜·금액·전화번호는 숫자끊기로 걸리지 않는다', () => {
  for (const t of ['2026.08.21 발매래요', '5,000원이면 진짜 싸다', '문의 010-1234-5678 로 주세요',
                   '9 : 30 에 공개된대요', '키 175 몸무게 55 인데 M 사이즈 맞을까요']) {
    const r = score(t);
    assert.ok(!r.signals.includes('spaced_digits'), '오탐: ' + t + ' → ' + r.signals.join(','));
    assert.ok(r.total < 60, '오탐 점수: ' + t + ' → ' + r.total);
  }
});

console.log(`\n${n}개 테스트 통과`);
