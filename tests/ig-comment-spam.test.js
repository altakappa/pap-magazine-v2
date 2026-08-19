/**
 * IG 스팸 댓글 탐지기 — 2026-08-19 PAP 게시물에서 실제로 수집한 표본 기반.
 * 이 테스트가 지키는 것: ①실제 스팸을 놓치지 않는다 ②정상 댓글을 잡지 않는다
 * ③미끼 이름이 바뀌어도 '수법'만으로 잡는다 ④같은 문구 다계정 반복을 묶는다
 */
const assert = require('assert');
const { score, fingerprint, structuralSignals, normalize } = require('../api/_lib/igCommentSpam');

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

console.log(`\n${n}개 테스트 통과`);
