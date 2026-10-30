/**
 * 셀럽속보 아이돌 한정 필터 (2026-10-30, 도메니코 "아이돌 한정기사로 추려줘")
 *   ① 실제 텔레그램 발송 제목(10/23~10/30) 중 아이돌 기사는 남긴다
 *   ② 배우·트로트·'아이돌 출신' 문구·인도 영화 BTS(behind the scenes)·AI/로봇/버추얼은 버린다
 *   ③ 짧은 이름이 일반 단어 속에 숨은 경우(제니퍼·있지만·프랜차이즈·아이브로우)는 이름으로 보지 않는다
 *   ④ CELEB_WATCH_SCOPE=all 로 끌 수 있다
 *   ⑤ celeb-watch 크론이 isOnTarget 다음에 이 관문을 건다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const { isIdolNews, idolOnly, btsIsBand } = require(path.join(ROOT, 'api', '_lib', 'celebIdol.js'));

console.log('\n[1] 남겨야 하는 아이돌 기사 (실제 발송 제목)');
[
  '블랙핑크 지수, 문화훈장 받고 바로 신곡 발매…물속에서 펼친 `ADDICTED` - 마이데일리',
  '있지 채령, 11월 9일 솔로 데뷔 - BNT뉴스',
  "'솔로데뷔' ITZY 채령, 홀리는 비주얼…확신의 연프상 - 조이뉴스24",
  '우리은행, 걸그룹 리센느와 함께한 \'우리는 해\' CM송 광고 공개',
  "'컴백' 아일릿 원희·이로하, 발목 부상...\"안무 일부 조정\" - 싱글리스트",
  "'잇츠 미' 이후 첫 컴백…'체포하겠어'로 더 선명해진 '아일릿코어' - 뉴스1",
  '희망브리지, 아이브와 소방관 응원…목소리 재능기부 연계 - 글로벌이코노믹',
  "'컴백' 리사, VMA 너머 그래미 노리나…제작진 56.4%가 그래미와 인연 [TEN스타필드] - 텐아시아",
  '[퇴근길이슈] 텐 열애설 부인·베스티 음방·어도어 뉴진스 MV 소송· - 조이뉴스24',
  '블랙핑크 지수가 알리는 태국 비타민 음료 ‘비타데이’, CU서 국내 첫선 - 동아일보',
  '아이들 소연·미연의 K/DA, 신곡 \'FIRESTARTER\' 공개하며 8년만 컴백 - 금강일보',
  'PVR INOX to screen BTS concerts from Buenos Aires, São Paulo across India - Telegraph India',
  "BTS' Jungkook performs ATEEZ's viral BAD dance in Argentina - The Nation (Pakistan )",
  'Twice’s Nayeon sets solo comeback date - The Korea Herald',
  'LE SSERAFIM — First K-Pop Act to Headline Countdown Japan 2 Years Running - The Korea Daily',
  '‘AAA 2026’, 인기상 순위? BTS·스키즈 176표 차 접전…변우석·김혜윤·임영웅 1위 유지 - 톱스타뉴스',
  '이수만, 신인 걸그룹 1위에 \'골든벨\'…고깃집 통째로 계산 - 파이낸셜뉴스',
  '[미성년 아이돌의 빛과 그림자] “전수조사 시급…산업 성장만 강조 말고, 청소년 보호도 살펴야” - 스포츠월드',
].forEach(s => t('남김: ' + s.slice(0, 40), isIdolNews(s) === true));

console.log('\n[2] 버려야 하는 비아이돌 기사 (실제 발송 제목)');
[
  '[공식] 송혜교, 새 소속사 찾았다…STAND와 전속계약',
  '공명, BH엔터와 전속계약..."장르불문 배우와 시너지 기대" - 싱글리스트',
  '윤하, 씨나인이엔티와 전속계약 해지…정산금 미지급 갈등에 소송',
  '임영웅, 무려 291주 연속 1위-아이돌 차트 철옹성 - 미디어파인',
  '안성훈·송가인 케이팝킹퀸 1위…김희재-진해성 900표 차 - 톱스타뉴스',
  '‘무명전설2’ 장민호·김대호, 이수만 걸그룹에 도전장?…‘니욘 앤 비욘’ 완벽 소화 - 일간스포츠',
  'Kalki 2898 AD makers release BTS video for Prabhas’ birthday - The News Mill',
  'Raashii Khanna wraps ‘Mauja Hi Mauja’, shares BTS with Akshay Kumar, Vidya Balan - Telegraph India',
  '‘Lagaan’ turns 25: Rachel Shelley shares unseen BTS pictures with Ashutosh Gowariker - The Times of India',
  '제니퍼 로렌스, 가슴 확대 수술 고백 "섹시한 엄마 되고 싶다" [TD할리우...',
  '‘아이돌 출신’ 女스타, ‘7살 연상♥’과 결혼 1년 10개월 만에 첫 아이 출산 [MHN:글로벌] - MHN스포츠',
  "'걸그룹 졸업생' 유이, 결혼 2년 만 출산..발 도장까지 공개 \"소중한 딸\" - 스타뉴스",
  '아이돌 연습생 출신다운 춤선…김지원, 제복 입고 ‘소원을 말해봐’ 무대 재조명[핫피플] - OSEN',
  "'출판계 아이돌' 김민경, 성공했네…전현무와 나란히 '전착시' MC 발탁",
  '뉴진스 하니 닮은꼴, 日 21세 배드민턴 아이돌…실력은 왜 이러나, 3연속 16강 탈락 ‘충격’ - 머니투데이',
  'KPR, 로봇 아이돌 ‘치치앤키키’ 데뷔…공연 데이터도 공개한다 - 헤럴드경제',
  'AI 걸그룹 ‘루미나’ 선보였다”데뷔곡 ‘OVERRIDE’ 250만뷰 돌파 - 한국일보',
  '버추얼 아이돌 넥스트비트, 오늘 데뷔곡 ‘Ego Ring’ 발매로 정식 데뷔 - 톱스타뉴스',
  "'언니만 따라와' 장영란, 아이돌 유행 시술 고백…\"콧볼 보톡스 맞았다...",
  '강석우 딸, 결혼하나?…웨딩드레스 입고 신부 화보 공개 - 텐아시아',
  '‘피겨 잠정 은퇴’ 배우 진출 선언한, 차준환[O! STAR 숏폼] - 조선일보',
].forEach(s => t('버림: ' + s.slice(0, 40), isIdolNews(s) === false));

console.log('\n[3] 짧은 이름이 일반 단어 속에 숨은 경우');
['제니퍼 로렌스 근황', '있지만 괜찮아', '프랜차이즈 업계 동향', '아이브로우 펜슬 추천', '치치앤키키 데뷔', '슬기로운 의사생활']
  .forEach(s => t('이름 아님: ' + s, isIdolNews(s) === false));
['세븐틴의 컴백', '정국, 남미 실트 1위', '지수가 알리는 음료']
  .forEach(s => t('이름 맞음: ' + s, isIdolNews(s) === true));
t('BTS 한글 제목 = 방탄', btsIsBand('BTS 정국 3억뷰 - 연합뉴스'));
t('BTS 영어 맥락 없음 = behind the scenes', !btsIsBand('Makers release BTS video for birthday'));
t('빈 제목', isIdolNews('') === false && isIdolNews(null) === false);

console.log('\n[4] 끄기 스위치');
{
  const old = process.env.CELEB_WATCH_SCOPE;
  delete process.env.CELEB_WATCH_SCOPE; t('기본 = 아이돌 한정', idolOnly() === true);
  process.env.CELEB_WATCH_SCOPE = 'all'; t('all = 끔', idolOnly() === false);
  process.env.CELEB_WATCH_SCOPE = 'ALL'; t('대소문자 무시', idolOnly() === false);
  if (old === undefined) delete process.env.CELEB_WATCH_SCOPE; else process.env.CELEB_WATCH_SCOPE = old;
}

console.log('\n[5] 크론 연결');
{
  const src = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-watch.js'), 'utf8');
  t('require 경로 ../_lib/celebIdol', /require\('\.\.\/_lib\/celebIdol'\)/.test(src));
  const a = src.indexOf('items.filter(i => isOnTarget(i.title))');
  const b = src.indexOf('items.filter(i => isIdolNews(i.title))');
  const c = src.indexOf('clusterEvents(items)');
  t('isOnTarget → isIdolNews → 클러스터링 순서', a > 0 && b > a && c > b, { a, b, c });
  t('idolOnly() 스위치로 감쌌다', /if \(idolOnly\(\)\) items = items\.filter\(i => isIdolNews/.test(src));
  t('dry 응답에 dropped_non_idol', /dropped_non_idol: droppedNonIdol/.test(src));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ celeb-idol-filter tests FAILED'); process.exit(1); }
console.log('✅ celeb-idol-filter tests passed');
