// PAP Magazine — celeb-watch 중복 판정 테스트
//
// 지키는 회귀 (2026-07-21, 도메니코: "중복된 기사가 너무 많이 온다"):
//   - 한국어 헤드라인의 키워드가 살아남을 것 (기존 length>=3 은 한국어를 전멸시켰다)
//   - 표현만 바꾼 재탕은 중복으로 잡힐 것
//   - **새 인물이 추가되면 다른 사건으로 볼 것** (도메니코: "정호연 BTS 출연은 다른 기사")
//     ※ 2026-07-27 최종 (도메니코): "문장만 바뀐 같은 뉴스만 막아라" —
//        novel===1 병합(efb80d6)은 같은 날 철회. 재탕 억제는 STOP·숫자 필터가
//        담당하고, 진짜 새 요소(새 인물)는 하나여도 새 사건으로 알린다.
//   - BTS ↔ 방탄소년단 처럼 한·영 표기가 갈려도 같은 토큰일 것
//   - 시그니처가 클러스터 항목 순서에 흔들리지 않을 것
//
// Run with `node tests/celeb-dedup.test.js` (wired into `npm test`).

'use strict';

const {
  keywords, canonicalize, clusterEvents, clusterCore, sameEvent, hotScore, HOT_MIN,
  decodeHtml, stripSource, titleKey,
} = require('../api/_lib/celebDedup');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------------------------------------------------------------- */
section('keywords — 한국어가 살아남는가');

const koKw = keywords('BTS 정국, 월드컵 결승 하프타임쇼 무대 확정');
ok('한국어 2자 단어를 버리지 않는다 (결승)', koKw.includes('결승'));
ok('정국 → jungkook 으로 통일된다 (2026-07-27 한국 소스 보강)', koKw.includes('jungkook'));
ok('월드컵은 정규표기 worldcup 으로 통일된다', koKw.includes('worldcup'));
ok('영문 3자 이상은 그대로 (bts)', koKw.includes('bts'));
ok('영문 불용어는 제외 (the)', !keywords('The New Look of the Year').includes('the'));

/* ---------------------------------------------------------------- */
section('canonicalize — 한·영 표기 통일');

ok('방탄소년단 → bts 토큰', keywords('방탄소년단 월드투어').includes('bts'));
ok('BTS 도 같은 토큰', keywords('BTS world tour').includes('bts'));
ok('샤넬 → chanel', keywords('샤넬 신임 디렉터').includes('chanel'));
ok('하프타임 → halftime', keywords('월드컵 하프타임쇼').includes('halftime'));

/* ---------------------------------------------------------------- */
section('2026-07-27 한국 소스 보강 — 한/영 표기·피드·매체명 추출');

// 한국발 기사와 영문 기사가 같은 사건으로 묶이는가
ok('아이유 ↔ IU 같은 토큰', keywords('아이유 신곡 발표').includes('아이유')
  && keywords('IU drops surprise single tonight').includes('아이유'));
ok('지드래곤 ↔ G-Dragon 같은 토큰', keywords('지드래곤 월드투어 확정').includes('gdragon')
  && keywords('G-Dragon announces world tour dates').includes('gdragon'));
ok('아이브 ↔ IVE 같은 토큰 (I\'ve 는 오인하지 않음)',
  keywords('아이브 컴백 티저').includes('ive')
  && keywords('IVE teases comeback stage').includes('ive')
  && !keywords("I've never seen this trend before").includes('ive'));
ok('한국어 사건 키워드도 화제성 가산 (컴백)', hotScore({
  sourceCount: 2, newestTs: Date.now(),
  headlines: [{ title: '뉴진스 컴백 확정' }, { title: '뉴진스 새 앨범 발표' }],
}) >= HOT_MIN);

// celeb-watch.js 소스 텍스트 검증 — 크론 핸들러는 env 없이 require 할 수 없어
// 기존 관례(cron-alert-telegram.test.js)대로 소스 텍스트로 확인한다.
const fs = require('fs');
const path = require('path');
const watchSrc = fs.readFileSync(path.join(__dirname, '../api/cron/celeb-watch.js'), 'utf8');
ok('한국 피드: GoogleNews-KR-연예 등록', watchSrc.includes("source: 'GoogleNews-KR-연예'"));
ok('한국 피드: 연합뉴스 등록', watchSrc.includes('yna.co.kr/rss/entertainment.xml'));
ok('구글뉴스 <source> 태그로 실제 매체명 추출', /<source\[\^>\]\*>/.test(watchSrc) || watchSrc.includes('<source[^>]*>'));
ok('신디케이터(네이트 등) 제외 처리', watchSrc.includes('SYNDICATORS') && watchSrc.includes('네이트'));
ok('KR 아티스트 쿼리 확대 (뉴진스 포함)', watchSrc.includes(encodeURIComponent('뉴진스')));

// 네이버 뉴스 API (2026-07-27 2차 — 키 없으면 자동 스킵이라 배포 순서 자유)
ok('네이버: 키 없으면 조용히 건너뜀', /NAVER_CLIENT_ID[\s\S]{0,120}return \[\]/.test(watchSrc));
ok('네이버: 공식 검색 API 사용', watchSrc.includes('openapi.naver.com/v1/search/news.json'));
ok('네이버: 최신순 정렬', watchSrc.includes('sort=date'));
ok('네이버: 원문 도메인을 매체 구분으로 사용', watchSrc.includes('originallink')
  && watchSrc.includes("hostname.replace(/^www\\./, '')"));
ok('네이버: 수집 단계에 합류', watchSrc.includes('fetchNaverNews(), //'));

/* ---------------------------------------------------------------- */
section('sameEvent — 도메니코 규칙: 새 요소가 추가되면 다른 사건');

// 이미 알린 사건: BTS 2026 하프타임쇼 출연
const seen = ['bts', 'halftime', 'worldcup'];

// ① 표현만 바꾼 재탕 → 중복 (다시 안 보냄)
ok('"BTS 하프타임쇼 무대 확정" 재탕은 중복',
  sameEvent(['bts', 'halftime', 'worldcup'], seen));
ok('일부만 언급한 후속(부분집합)도 중복',
  sameEvent(['bts', 'halftime'], seen));

// ② 새 인물이 추가되면 다른 사건 → 알림 보냄 (정호연 규칙 — 2026-07-27 재확인.
//    도메니코: "문장만 바뀐 같은 뉴스만 막아라". 재탕은 STOP·숫자 필터가 잡는다.)
ok('"정호연·BTS 하프타임쇼"는 정호연이 추가됐으므로 새 사건',
  !sameEvent(['bts', 'halftime', 'worldcup', '정호연'], seen));
ok('새 요소가 하나만 늘어도 새 사건',
  !sameEvent(['bts', 'halftime', 'worldcup', '리허설공개'], seen));
ok('새 요소가 둘 이상이어도 당연히 별개 (정호연 + 새 맥락)',
  !sameEvent(['bts', 'halftime', 'worldcup', '정호연', '불꽃무대'], seen));

// ③ 완전히 다른 사건
ok('샤넬 디렉터 선임은 무관한 사건', !sameEvent(['chanel', '디렉터', '선임'], seen));
ok('겹침이 1개뿐이면 중복으로 보지 않는다', !sameEvent(['worldcup'], seen));

// ④ 방어
ok('빈 배열은 항상 false', !sameEvent([], seen) && !sameEvent(seen, []));

/* ---------------------------------------------------------------- */
section('clusterCore — 리워딩 노이즈는 빼고 공통 요소만 남는가');

const grp = [
  { title: 'BTS 정국, 월드컵 하프타임쇼 무대 확정' },
  { title: 'BTS 정국 월드컵 하프타임쇼 무대 오른다' },
  { title: 'BTS 정국, 월드컵 하프타임쇼 출연 발표' },
];
const core = clusterCore(grp);
ok('공통 요소(bts)는 남는다', core.includes('bts'));
ok('공통 요소(정국→jungkook)도 남는다', core.includes('jungkook'));
ok('한 곳에만 나온 표현(오른다)은 빠진다', !core.includes('오른다'));
ok('한 곳에만 나온 표현(발표)도 빠진다', !core.includes('발표'));

// 같은 사건 + 새 인물이 붙은 클러스터는 core 가 달라야 한다
const grp2 = [
  { title: '정호연·BTS 정국, 월드컵 하프타임쇼 동반 출연' },
  { title: '정호연 BTS 정국 월드컵 하프타임쇼 함께 오른다' },
];
ok('새 인물(정호연)이 core 에 들어간다', clusterCore(grp2).includes('정호연'));
// 정호연이 추가된 클러스터는 다른 사건 (2026-07-27 최종 재확인)
ok('정호연이 추가된 클러스터는 새 사건', !sameEvent(clusterCore(grp2), core));
ok('반대로 원래 사건은 여전히 중복', sameEvent(core, core));

/* ---------------------------------------------------------------- */
section('clusterEvents — 교차 검증과 시그니처 안정성');

const mk = (title, source, topic) => ({ title, link: 'https://x/' + encodeURIComponent(title), source, topic, ts: Date.now() });

const items = [
  mk('BTS 정국 월드컵 하프타임쇼 무대 확정', 'Soompi', 'kpop'),
  mk('정국, 월드컵 하프타임쇼 무대 확정 발표', 'Allkpop', 'kpop'),
  mk('전혀 다른 소식: 신인 브랜드 서울 팝업', 'WWD', 'fashion'),
];
const cl = clusterEvents(items);
ok('2개 매체가 다룬 사건만 클러스터가 된다', cl.length === 1);
ok('단독 기사는 버려진다', !cl.some(c => c.headlines.some(x => x.title.includes('팝업'))));
ok('클러스터에 kw 배열이 붙는다', Array.isArray(cl[0].kw) && cl[0].kw.length > 0);
ok('클러스터에 core 배열이 붙는다', Array.isArray(cl[0].core) && cl[0].core.length > 0);

// 시그니처 안정성 — 입력 순서를 뒤집어도 같은 시그니처여야 한다.
const cl2 = clusterEvents([items[1], items[0], items[2]]);
ok('시그니처가 입력 순서에 흔들리지 않는다', cl[0].signature === cl2[0].signature);

/* ---------------------------------------------------------------- */
section('hotScore — 화제성 임계값');

const big = {
  sourceCount: 3, headlines: [{ title: 'BTS 월드컵 하프타임쇼' }], newestTs: Date.now(),
};
const small = {
  sourceCount: 2, headlines: [{ title: '어느 브랜드의 조용한 소식' }], newestTs: Date.now(),
};
ok('대형 사건은 임계값을 넘는다', hotScore(big) >= HOT_MIN);
ok('평범한 2개 매체 건은 임계값 미달 → 알림 안 감', hotScore(small) < HOT_MIN);

/* ---------------------------------------------------------------- */
// 2026-07-21 2차 — 도메니코: "여전히 중복된 기사가 여러 번 온다".
// 아래는 실제 celeb_watch_seen 에 남아 있던 데이터로 만든 회귀 테스트다.
// 같은 기사가 5분 간격으로 6번 나간 원인 세 가지를 각각 못 박는다.
section('노이즈 제거 — 중복 폭주의 실제 원인');

// ① HTML 숫자 엔티티가 "단어"가 되던 문제 (038·160·8216 이 core 에 박혀 있었다)
const billboard = 'Watch Burna Boy Link Up With Justin Bieber, Shakira &#038; More in Behind-the-Scenes World Cup Halftime Video&#160;Diary';
const bbKw = keywords(billboard);
ok('숫자 엔티티가 키워드로 남지 않는다 (038/160)', !bbKw.some(w => /^\d+$/.test(w)));
ok('엔티티 디코딩', decodeHtml('A &#038; B') === 'A & B');

// ② 구글뉴스 " - 매체명" 꼬리가 사건 구성요소로 들어가던 문제
ok('매체명 꼬리를 뗀다', stripSource("BLACKPINK's Jennie Releases New Single - 조선일보") === "BLACKPINK's Jennie Releases New Single");
const gnKw = keywords("BTS Proves K-pop's Global Status at FIFA World Cup Final Halftime Show - 조선일보");
ok('매체명이 키워드에 섞이지 않는다', !gnKw.includes('조선일보') && !gnKw.includes('chosunbiz'));
ok('매체 도메인 조각(com)이 키워드에 없다',
  !keywords('BTS Jimin Stuns Global Fans - starnewskorea.com').includes('com'));

// ③ 헤드라인 상용어가 실행마다 들락날락하며 가짜 "새 요소"를 만들던 문제
ok('헤드라인 상용어는 버린다 (watch/video/show/photo)',
  !bbKw.includes('watch') && !bbKw.includes('video'));

section('titleKey — 같은 기사는 몇 번을 봐도 같은 지문');

ok('인코딩·꼬리가 달라도 같은 지문', titleKey(billboard) === titleKey(
  'Watch Burna Boy Link Up With Justin Bieber, Shakira & More in Behind-the-Scenes World Cup Halftime Video Diary - Billboard'));
ok('단어 순서가 바뀌어도 같은 지문',
  titleKey('BTS 지민 월드컵 하프타임 무대') === titleKey('월드컵 하프타임 무대 BTS 지민'));
ok('다른 사건은 다른 지문',
  titleKey('BTS 월드컵 하프타임쇼 출연') !== titleKey('블랙핑크 제니 신곡 공개'));
ok('빈 제목도 죽지 않는다', typeof titleKey('') === 'string');

section('실측 재현 — 같은 사건이 6번 나가던 core 들');

// celeb_watch_seen 22:40 / 22:50 / 23:00 행에서 뽑은 실제 core.
// 노이즈를 걷어내면 남는 요소가 같아야 하고, sameEvent 가 중복으로 잡아야 한다.
const runA = keywords("BTS Proves K-pop's Global Status at FIFA World Cup Final Halftime Show - 조선일보");
const runB = keywords("BTS Proves K-pop's Global Status at FIFA World Cup Final Halftime Show - chosunbiz.com");
ok('같은 헤드라인이면 매체가 달라도 같은 요소 집합', titleKey(runA.join(' ')) === titleKey(runB.join(' ')));
ok('같은 헤드라인은 중복으로 판정된다', sameEvent(runA, runB) === true);

// 도메니코 규칙은 그대로 살아 있어야 한다 — 새 인물이 들어오면 다른 사건.
ok('새 인물이 추가되면 여전히 다른 사건 (정호연 규칙 유지)',
  sameEvent(keywords('정호연 BTS 월드컵 하프타임쇼 동반 출연'),
            keywords('BTS 월드컵 하프타임쇼 출연')) === false);

/* ---------------------------------------------------------------- */
// 2026-07-27 3차 — 도메니코 "한 뉴스는 한 번만, 중복 더 엄격히".
// 아래는 실제 celeb_watch_seen 24h 에서 같은 사건이 반복된 케이스들.
section('3차 실측 재현 — 한/영·조회수 표기 차이 중복');

// ① 조회수 단위·서수는 키워드에서 사라진다
ok('조회수 단위(11억) 제거', !keywords('BTS Butter 11억 뷰 돌파').includes('11억'));
ok('billion·views 제거',
  !keywords('BTS Butter 1.1 billion views').some(w => ['billion','views'].includes(w)));
ok('서수(7th) 제거', !keywords("NCT 127 7th Full Album").includes('7th'));

// ② BTS Butter 11억뷰 — 한/영·조회수 표기가 달라도 같은 지문 (실측 3번 발송)
ok('Butter 11억 vs 1.1 billion 같은 지문',
  titleKey("방탄소년단 'Butter', 11억 뷰 돌파 - bntnews.co.kr")
  === titleKey("BTS 'Butter' MV surpasses 1.1 billion views - starnewskorea.com"));

// ③ 정국 스포티파이 — 한/영 (실측 2번 발송)
ok('정국 스포티파이 한/영 같은 지문',
  titleKey("BTS 정국 'Standing Next to You', 스포티파이 15억 스트리밍 돌파")
  === titleKey("Jung Kook [BTS] hits 1.5 billion Spotify streams with 'Standing Next to You'"));

// ④ NCT BLINGY 티저 — Logo/Banner 노이즈 제거 후 수렴 (실측 2번 발송)
ok('NCT BLINGY 티저 같은 지문',
  titleKey("NCT 127 - 7th Full Album 'BLINGY' (Logo / Banner Teaser Image)")
  === titleKey("Watch: NCT 127 Drops 1st Teaser For Comeback With Full-Length Album 'BLINGY'"));

section('3차 방향성 — 부분집합은 재탕, 새 인물 추가는 새 사건');

// ⑤ 세븐틴 입대 실측 4번: 같은 두 멤버를 문장만 바꿔 반복한 재탕(부분집합)은 죽고,
//    반대로 이미 알린 뒤 멤버가 '추가'되면 정호연 규칙대로 새 알림이 간다.
ok('도겸만 vs 도겸+버논(이미 알림) = 재탕 (부분집합)',
  sameEvent(keywords('세븐틴 도겸 입대'), keywords('세븐틴 도겸 버논 군입대')) === true);
ok('도겸+버논 vs 도겸만(이미 알림) = 버논이 추가됐으므로 새 사건',
  sameEvent(keywords('세븐틴 도겸 버논 군입대'), keywords('세븐틴 도겸 입대')) === false);

// ⑥ 그래도 서로 다른 작품·사건은 눌리지 않는다 (과잉 병합 방지)
ok('같은 그룹 다른 작품은 별개 지문',
  titleKey("BTS Butter 11억 뷰") !== titleKey("BTS Dynamite 20억 뷰"));
ok('같은 그룹 다른 사건은 병합 안 됨 (공유 1개뿐)',
  sameEvent(keywords('BTS Butter 뷰 기록'), keywords('BTS 정국 하프타임 무대')) === false);

/* ---------------------------------------------------------------- */
console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.error('❌ celeb-dedup tests failed'); process.exit(1); }
console.log('✅ celeb-dedup tests passed');
