// PAP Magazine — 대화형 소셜 카피 판정 테스트
//
// 지키는 규칙 (2026-07-21, 도메니코 요청):
//   - 모든 기사에 쓰는 장치가 아니다 — 대화거리가 있을 때만 발동할 것
//   - 부고·사건사고에는 절대 발동하지 말 것 (가볍게 말 걸 자리가 아니다)
//   - 도메니코 예시(제니 앨범 자켓 인물 추측)는 반드시 통과할 것
//   - **미스터리 편중 금지** (2026-07-21 2차): "꼭 미스터리·추측 위주로 하지
//     않아도 된다. 가볍게 주제를 던지고 의견을 듣는 정도면 충분하다."
//     → 스타일·트렌드처럼 일상적 소재도 발동해야 한다
//   - 아트·컬쳐 (2026-07-21 3차): "아트나 컬쳐에 대해 의견을 나누는 것도 좋다."
//     → 전시·작품·영화도 발동해야 한다
//
// Run with `node tests/social-hook.test.js` (wired into `npm test`).

'use strict';

const { hookScore, HOOK_MIN } = require('../api/_lib/socialHook');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------------------------------------------------------------- */
section('발동해야 하는 것');

// 도메니코가 든 바로 그 예시
const jennie = hookScore({
  title: '제니 새 앨범 커버 공개',
  body: '커버에 함께 등장한 인물의 정체를 두고 팬들 사이에서 추측이 오가고 있다. 얼굴이 가려져 있어 온라인에서 화제다.',
  category: 'News',
});
ok('제니 앨범 자켓 인물 추측 — 발동', jennie.score >= HOOK_MIN);
ok('무엇을 잡았는지 보고한다', jennie.signals.length >= 2);

ok('비교·대결 소재 발동', hookScore({
  title: '같은 드레스, 다른 해석',
  body: '두 배우가 같은 옷을 입었다. 어느 쪽이 더 어울렸는지 의견이 갈린다.',
  category: 'Celeb',
}).score >= HOOK_MIN);

ok('의외성 소재 발동', hookScore({
  title: '샤넬, 처음으로 신인 디자이너 기용',
  body: '이례적인 선택이다. 예상 밖의 인선에 업계가 술렁이고 있다.',
  category: 'News',
}).score >= HOOK_MIN);

// 미스터리가 아니어도 발동해야 한다 (2026-07-21 2차 요청)
ok('스타일링 소재 — 미스터리 없이도 발동', hookScore({
  title: '제니 공항패션',
  body: '블랙 재킷에 데님을 매치한 착장. 가방은 샤넬 제품.',
  category: 'Celeb',
}).score >= HOOK_MIN);

ok('트렌드 소재 — 미스터리 없이도 발동', hookScore({
  title: '로우라이즈가 다시 뜬다',
  body: '2000년대 유행이 올해 시즌 무드로 돌아왔다.',
  category: 'News',
}).score >= HOOK_MIN);

// 아트·컬쳐 (2026-07-21 3차 요청) — 정답이 없어 의견 나누기 좋은 영역
ok('전시 소재 발동', hookScore({
  title: '서울시립미술관 새 전시',
  body: '작가의 시선이 담긴 작품 30점을 선보인다.',
  category: 'Culture',
}).score >= HOOK_MIN);

ok('영화·필름 소재 발동', hookScore({
  title: '칸 화제작 국내 개봉',
  body: '촬영과 미술이 인상적인 작품이다.',
  category: 'Culture',
}).score >= HOOK_MIN);

/* ---------------------------------------------------------------- */
section('발동하면 안 되는 것');

const plain = hookScore({
  title: '2026 SS 파리 패션위크 3월 개막',
  body: '파리 패션위크가 3월 2일부터 9일까지 열린다. 참가 브랜드는 추후 공개된다.',
  category: 'News',
});
ok('단순 일정 공지 — 발동 안 함', plain.score < HOOK_MIN);

const editorial = hookScore({
  title: 'Cartoon Darkness',
  body: '잉크빛 그림자와 그래픽한 스타일로 완성한 화보.',
  category: 'Editorial',
});
ok('에디토리얼 화보 — 발동 안 함 (감상 대상)', editorial.score < HOOK_MIN);

/* ---------------------------------------------------------------- */
section('차단 — 가볍게 말 걸 자리가 아닌 것');

const obit = hookScore({
  title: '패션 디자이너 별세',
  body: '향년 78세. 업계가 추모하고 있다. 정체를 알 수 없는 화제가 되고 있다.',
  category: 'News',
});
ok('부고는 신호가 있어도 차단', obit.blocked === true && obit.score === 0);

for (const kw of ['음주운전', '마약', '성범죄', '폭행', '학폭', '고소', '사과문']) {
  const r = hookScore({ title: kw + ' 논란', body: '화제가 되고 있다. 추측이 오간다.', category: 'News' });
  if (!(r.blocked && r.score === 0)) { fail++; console.log('  ✗ 차단 실패: ' + kw); }
}
ok('사건사고 키워드 7종 전부 차단', true);

/* ---------------------------------------------------------------- */
section('방어');

ok('빈 입력', hookScore({}).score === 0);
ok('null 입력', hookScore(null).score === 0);
ok('제목만 있고 본문 없음도 죽지 않는다', typeof hookScore({ title: '제목' }).score === 'number');

/* ---------------------------------------------------------------- */
console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.error('❌ social-hook tests failed'); process.exit(1); }
console.log('✅ social-hook tests passed');
