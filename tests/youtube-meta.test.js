// PAP Magazine — YouTube Shorts 제목 접두사·해시태그 테스트
//
// 지키는 회귀 (2026-08-04 도메니코):
//   "제목 가장 앞에 셀럽 기사는 [ CELEBRITY ], 다른 건 다르게 표시하고 있는데
//    카테고리를 학습해서 나눠줘야할거 같아. 해시태그도 기사에 관련있는 셀럽이나
//    내용의 단어로 바꿔줘."
//   - 접두사 문자열은 채널 실측 표기 그대로 (안쪽 공백 포함) 일 것
//   - 사람이 주인공이면 팝업/이벤트 기사라도 [ CELEBRITY ] 일 것
//   - "성별을 지운 향, 프라다…" 같은 문장형 헤드라인을 셀럽으로 오인하지 말 것
//   - '파리 팝업' 을 [ Paris Fashion Week ] 로 오인하지 말 것
//   - 해시태그는 articles.tags 에서 나올 것 (#패션뉴스 같은 고정값 아님)
//   - 제목의 < > 는 제거될 것 (2026-07-19 upload init 400 재발 방지)
//   - 제목 총길이 100자 (YouTube 하드 상한) 이내일 것
//
// Run with `node tests/youtube-meta.test.js` (npm test 에 연결됨).

'use strict';

const {
  PREFIX, classify, buildTitle, toHashtag, buildHashtags, buildTagList,
  stripPrefix, stripSuffix, MAX_TITLE,
} = require('../api/_lib/youtubeMeta');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const A = (title, category, tags) => ({ title, category, tags: tags || [] });

/* ---------------------------------------------------------------- */
section('접두사 표기 — 채널 실측 그대로');

ok('[ CELEBRITY ] 안쪽 공백 유지', PREFIX.CELEBRITY === '[ CELEBRITY ]');
ok('[ Milan Fashion Week ] 대소문자 유지', PREFIX.MILAN === '[ Milan Fashion Week ]');
ok('[ Paris Fashion Week ] 대소문자 유지', PREFIX.PARIS === '[ Paris Fashion Week ]');

/* ---------------------------------------------------------------- */
section('classify — 셀럽');

ok('안보현 로얄 살루트 → CELEBRITY',
  classify(A('안보현, 로얄 살루트와 함께한 프레스티지 나이트', 'Culture',
    ['ahn bo-hyun', 'royal salute', 'korean actor'])) === PREFIX.CELEBRITY);
ok('레드벨벳 컴백 → CELEBRITY (제목에 쉼표가 없어도 사전으로 잡는다)',
  classify(A('여름이 오면 결국 레드벨벳이다', 'News',
    ['red velvet', 'k-pop', 'comeback'])) === PREFIX.CELEBRITY);
ok('리즈 팝업스토어 → EVENT 아니라 CELEBRITY (사람이 주인공)',
  classify(A('리즈, 토니모리 20주년 팝업스토어 현장에서 빛난 미모', 'Beauty',
    ['liz', 'tonymoly', 'popup'])) === PREFIX.CELEBRITY);
ok('태그의 k-pop 만으로도 CELEBRITY',
  classify(A('무대를 뒤집은 그 밤', 'Culture', ['k-pop', 'stage'])) === PREFIX.CELEBRITY);

/* ---------------------------------------------------------------- */
section('classify — 셀럽 오탐 방지');

ok('"성별을 지운 향, 프라다…" 는 셀럽 아님',
  classify(A('성별을 지운 향, 프라다 패러다임 맨의 도발', 'Beauty',
    ['prada', 'paradigme', 'fragrance'])) === PREFIX.BEAUTY);
ok('브랜드 협업은 카테고리 폴백',
  classify(A('아더에러와 버켄스탁, 실로 이은 두 번째 만남', 'Fashion',
    ['ader error', 'birkenstock'])) === PREFIX.FASHION);

/* ---------------------------------------------------------------- */
section('classify — 패션위크·에디토리얼·프레젠테이션·이벤트');

ok('밀라노 + 런웨이 → Milan Fashion Week',
  classify(A('MTLSTUDIO SS27 밀라노 패션위크 런웨이', 'Fashion',
    ['mtlstudio'])) === PREFIX.MILAN);
ok('"잠실 팝업에서 파리를 열다" 는 Paris Fashion Week 아님',
  classify(A('이즈나 X 루브르바게트, 잠실 팝업에서 파리를 열다', 'Culture',
    ['izna', 'louvre baguette'])) !== PREFIX.PARIS);
ok('Fashion Editorial → FASHION',
  classify(A("Fashion Editorial 'Jequitiba'", 'Fashion', ['editorial'])) === PREFIX.FASHION);
ok('백스테이지 → BACKSTAGE',
  classify(A("Fashion Editorial 'Saints of 79' 비하인드", 'Fashion',
    ['editorial', 'backstage'])) === PREFIX.BACKSTAGE);
ok('컬렉션 프레젠테이션 → PRESENTATION',
  classify(A('이자벨마랑 26FW 프레젠테이션', 'Fashion', ['isabel marant'])) === PREFIX.PRESENTATION);
ok('사람 없는 팝업/오픈 → EVENT',
  classify(A('폴렌느 레더 아틀리에 서울 오픈', 'Fashion',
    ['polene', 'store opening'])) === PREFIX.EVENT);

/* ---------------------------------------------------------------- */
section('classify — 카테고리 폴백');

ok('Fashion 폴백', classify(A('실루엣의 계절', 'Fashion', [])) === PREFIX.FASHION);
ok('Beauty 폴백', classify(A('여름의 피부', 'Beauty', [])) === PREFIX.BEAUTY);
ok('Culture 폴백', classify(A('도시의 소리', 'Culture', [])) === PREFIX.CULTURE);
ok('쉼표 다중 카테고리는 첫 값 기준',
  classify(A('실루엣의 계절', 'Fashion,Culture', [])) === PREFIX.FASHION);
ok('카테고리 없으면 NEWS', classify(A('무제', '', [])) === PREFIX.NEWS);

/* ---------------------------------------------------------------- */
section('classify — 셀럽 우선순위 (2026-08-04 실측 회귀)');
/* 'BTS × 캘빈클라인 … 컬렉션 공개' 가 [ PRESENTATION ] 으로 빠졌다.
   컬렉션 발표라도 사람이 주인공이면 [ CELEBRITY ] 다. */
ok('셀럽 렉시콘이 PRESENTATION 을 이긴다',
  classify(A("BTS × 캘빈클라인, '아리랑' 파자마 컬렉션 공개", 'Fashion',
    ['bts', 'calvin klein', 'k-pop fashion'])) === PREFIX.CELEBRITY);
ok('셀럽 태그도 PRESENTATION 을 이긴다',
  classify(A('프라다 뷰티 글로벌 앰배서더 컬렉션 공개', 'Beauty',
    ['brand ambassador', 'celebrity beauty'])) === PREFIX.CELEBRITY);
/* 반대쪽: 사람 없는 브랜드 발표는 그대로 PRESENTATION 이어야 한다.
   '이자벨마랑,' 은 이름처럼 보이지만(LEAD_NAME_RE) 셀럽이 아니다. */
ok('사람 없는 컬렉션 발표는 PRESENTATION 유지',
  classify(A('이자벨마랑, 26FW 컬렉션 공개', 'Fashion',
    ['isabel marant', 'collection'])) === PREFIX.PRESENTATION);
ok('톰포드 룩북도 PRESENTATION',
  classify(A('톰포드 26FW 룩북', 'Fashion', ['tom ford'])) === PREFIX.PRESENTATION);

section('toHashtag — 약어 보존 (2026-08-04 실측 회귀)');
ok('#BTS (Bts 아님)', toHashtag('bts') === '#BTS');
ok('#MV', toHashtag('mv') === '#MV');
ok('#VIPDinner', toHashtag('vip dinner') === '#VIPDinner');
ok('#DJPerformance', toHashtag('dj performance') === '#DJPerformance');
ok('#3RACHA', toHashtag('3racha') === '#3RACHA');
ok('kpop / k-pop 둘 다 #KPop',
  toHashtag('kpop') === '#KPop' && toHashtag('k-pop') === '#KPop');
ok('일반 단어는 그대로 첫 글자만', toHashtag('red velvet') === '#RedVelvet');
ok('한글 태그는 손대지 않는다', toHashtag('레드벨벳') === '#레드벨벳');

section('buildTitle');

const t1 = buildTitle(A('안보현, 로얄 살루트와 함께한 프레스티지 나이트', 'Culture', ['ahn bo-hyun']));
ok('접두사가 맨 앞', t1.indexOf('[ CELEBRITY ] ') === 0);
ok('접미사가 맨 뒤', /\| PAP MAGAZINE$/.test(t1));

const t2 = buildTitle(A('영케이가 말하는 시간, 해밀턴과 <오디세이>의 만남', 'Culture', ['hamilton']));
ok('< > 제거 (2026-07-19 400 재발 방지)', t2.indexOf('<') === -1 && t2.indexOf('>') === -1);

const long = buildTitle(A('가'.repeat(200), 'News', []));
ok('100자 상한 준수', long.length <= MAX_TITLE);
ok('길면 말줄임', long.indexOf('…') !== -1);

const t3 = buildTitle(A('[ CELEBRITY ] 카리나 | PAP MAGAZINE', 'News', ['karina']));
ok('이미 붙은 접두사를 중복해서 붙이지 않는다',
  (t3.match(/\[ CELEBRITY \]/g) || []).length === 1);
ok('이미 붙은 접미사를 중복해서 붙이지 않는다',
  (t3.match(/PAP MAGAZINE/g) || []).length === 1);
ok('stripPrefix', stripPrefix('[ EVENT ] 무엇') === '무엇');
ok('stripSuffix (구표기 ㅡ Pap magazine)', stripSuffix('무엇 ㅡ Pap magazine') === '무엇');

/* ---------------------------------------------------------------- */
section('toHashtag');

ok('영문 다단어 → 파스칼', toHashtag('red velvet') === '#RedVelvet');
ok('하이픈 이름 → 파스칼', toHashtag('ahn bo-hyun') === '#AhnBoHyun');
ok('k-pop → #KPop', toHashtag('k-pop') === '#KPop');
ok('아포스트로피 제거', toHashtag("surfin' boy") === '#SurfinBoy');
ok('한글은 그대로', toHashtag('안보현') === '#안보현');
ok('빈 값은 null', toHashtag('  ') === null);
ok('숫자만이면 null', toHashtag('2026') === null);

/* ---------------------------------------------------------------- */
section('buildHashtags — 기사 태그에서 나온다');

const h = buildHashtags(A('안보현, 로얄 살루트와 함께한 프레스티지 나이트', 'Culture',
  ['ahn bo-hyun', 'royal salute', 'whisky', 'korean actor']));
ok('#Shorts 앵커', h[0] === '#Shorts');
ok('#PAPMAGAZINE 앵커', h[1] === '#PAPMAGAZINE');
ok('셀럽명이 들어간다', h.indexOf('#AhnBoHyun') !== -1);
ok('브랜드명이 들어간다', h.indexOf('#RoyalSalute') !== -1);
ok('고정 #패션뉴스 는 더 이상 없다', h.indexOf('#패션뉴스') === -1);
ok('카테고리 해시태그(#CULTURE)를 붙이지 않는다', h.indexOf('#CULTURE') === -1);

const dup = buildHashtags(A('x', 'News', ['Red Velvet', 'red velvet', 'RED VELVET']));
ok('대소문자 중복 제거', dup.filter((x) => x.toLowerCase() === '#redvelvet').length === 1);
ok('개수 상한(기본 12)', buildHashtags(A('x', 'News', Array.from({ length: 40 }, (_, i) => 'tag' + i))).length <= 12);
ok('태그 없으면 앵커만', buildHashtags(A('x', 'News', [])).length === 2);

/* ---------------------------------------------------------------- */
section('buildTagList — YouTube snippet.tags');

const tl = buildTagList(A('x', 'News', ['red velvet', 'joy', '레드벨벳']));
ok('브랜드 앵커가 첫 번째', tl[0] === 'PAP MAGAZINE');
ok('기사 태그 원문 유지', tl.indexOf('red velvet') !== -1);
ok('한글 태그 유지', tl.indexOf('레드벨벳') !== -1);
ok('15개 상한', buildTagList(A('x', 'News', Array.from({ length: 40 }, (_, i) => 't' + i))).length <= 15);

/* ---------------------------------------------------------------- */
console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.error('❌ youtube-meta tests failed'); process.exit(1); }
console.log('✅ youtube-meta tests passed');
