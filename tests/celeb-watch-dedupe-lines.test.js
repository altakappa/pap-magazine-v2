// PAP Magazine — 속보 알림에 같은 줄이 두 번 나오지 않는다 (2026-09-18)
//
// [왜] 도메니코가 텔레그램 화면을 캡처해 보냈다. "2개 매체 교차 확인" 이라고
// 적혀 있는데 아래에 insight.co.kr 과 sportschosun.com 이 각각 두 번씩,
// 총 4줄이 실렸다. 읽는 사람은 4곳이 다뤘다고 착각하거나, 알림이 부풀려졌다고
// 느낀다.
//
// 교차검증 자체는 멀쩡하다 — celebDedup.clusterEvents 가
// `new Set(group.map(g => g.source)).size >= 2` 로 매체를 세므로
// "2개 매체" 는 진짜 서로 다른 2곳이다. 문제는 표시뿐이다:
// 같은 기사가 구글뉴스 피드 두 곳(KPOP-KR · KR-연예)에 동시에 잡히면
// 같은 (매체, 제목) 쌍이 headlines 배열에 그대로 두 번 들어간다.
//
// Run with `node tests/celeb-watch-dedupe-lines.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-watch.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== 배선 ===');
ok('알림 줄을 만들기 전에 중복을 걷어낸다',
  /dedupeHeadlines\(c\.headlines\)\.slice\(0, 4\)/.test(SRC));
ok('중복 제거가 slice 보다 먼저다 (뒤면 다른 매체 기사가 밀려 사라진다)',
  !/c\.headlines\.slice\(0, 4\)[\s\S]{0,40}dedupeHeadlines/.test(SRC));
ok('교차검증 문구는 그대로 sourceCount 를 쓴다 (세는 방식은 안 건드렸다)',
  /\$\{c\.sourceCount\}개 매체 교차 확인/.test(SRC));

console.log('\n=== 판별기를 소스에서 떼어내 실제로 돌린다 ===');
const m = SRC.match(/function dedupeHeadlines\(headlines\) \{[\s\S]*?\n\}/);
ok('dedupeHeadlines 를 찾았다', !!m);

if (m) {
  const strip = (t) => String(t).replace(/\s*[-|]\s*[^-|]+$/, '');
  // eslint-disable-next-line no-new-func
  const dedupe = new Function('stripSource', `${m[0]}; return dedupeHeadlines;`)(strip);

  // 도메니코가 보낸 실제 알림 그대로
  const real = [
    { source: 'insight.co.kr', title: '기안84, 르세라핌 카즈하 발톱 직접 깎아주며 한 말... 온라인서 갑론을박' },
    { source: 'sportschosun.com', title: '권은비 뒤꿈치→카즈하 발톱까지...기안84, 女아이돌 손님 대접 논란' },
    { source: 'sportschosun.com', title: '권은비 뒤꿈치→카즈하 발톱까지...기안84, 女아이돌 손님 대접 논란' },
    { source: 'insight.co.kr', title: '기안84, 르세라핌 카즈하 발톱 직접 깎아주며 한 말... 온라인서 갑론을박' },
  ];
  const out = dedupe(real);
  ok('실제 사고값 4줄이 2줄이 된다', out.length === 2, `${out.length}줄`);
  ok('매체가 둘 다 살아남는다',
    out.map(h => h.source).sort().join(',') === 'insight.co.kr,sportschosun.com');
  ok('첫 헤드라인은 그대로다 (알림 제목·링크의 근거)', out[0].source === 'insight.co.kr');

  // 서로 다른 기사는 안 지운다
  const diff = dedupe([
    { source: 'a.com', title: '컴백 확정' },
    { source: 'a.com', title: '투어 일정 공개' },
  ]);
  ok('같은 매체라도 다른 기사면 둘 다 남긴다', diff.length === 2);

  // 매체명 꼬리표가 붙었다 말았다 해도 같은 기사로 본다
  const tail = dedupe([
    { source: 'a.com', title: '컴백 확정 - A뉴스' },
    { source: 'a.com', title: '컴백 확정' },
  ]);
  ok('제목 끝 매체 꼬리표 유무는 무시한다', tail.length === 1);

  ok('대소문자·공백 차이도 같은 것으로 본다',
    dedupe([{ source: 'A.com', title: '컴백  확정' }, { source: 'a.com', title: '컴백 확정' }]).length === 1);
  ok('빈 배열·null 에도 안 던진다', dedupe([]).length === 0 && dedupe(null).length === 0);
  ok('null 원소를 건너뛴다', dedupe([null, { source: 'a', title: 'x' }]).length === 1);
}

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
