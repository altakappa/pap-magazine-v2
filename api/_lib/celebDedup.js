/**
 * PAP Magazine — celeb-watch 중복 판정 로직 (2026-07-21 분리)
 *
 * 왜 분리했나: 도메니코 피드백 "중복된 기사가 너무 많이 온다".
 * 중복 판정이 크론 핸들러 안에 묻혀 있어 테스트가 불가능했다. 순수 함수로
 * 빼서 tests/celeb-dedup.test.js 로 회귀를 막는다.
 *
 * 이 파일의 함수들은 네트워크·DB 를 건드리지 않는다 (순수 함수).
 */

'use strict';

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* HTML 엔티티 복원 — 숫자 엔티티까지.
   2026-07-21 2차: 이걸 안 하면 `&#038;` `&#160;` `&#8216;` 가 토큰화 단계에서
   038·160·8216 이라는 "단어"가 된다. 실측 celeb_watch_seen 에 그대로 남아 있었고,
   매체마다 인코딩이 달라 실행마다 이 숫자들이 들쭉날쭉 → 매번 "새 요소"로 잡혀
   같은 사건이 6번씩 알림으로 나갔다. 중복 폭주의 1번 원인. */
function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch (_e) { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (_e) { return ' '; } })
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

/* 구글뉴스·매체 RSS 의 제목 끝 " - 매체명" 꼬리 제거.
   2026-07-21 2차: 이 꼬리 때문에 chosunbiz·starnewskorea·com·네이트 같은
   **매체 이름이 사건의 구성 요소로** 들어갔다. 같은 사건이라도 어느 매체가
   클러스터에 잡히느냐에 따라 core 가 달라져 중복 판정이 새어나갔다.
   중복 폭주의 2번 원인. */
function stripSource(title) {
  // 2026-08-05: 구글뉴스가 " - 머니투데이 - 머니투데이" 처럼 꼬리를 두 번 붙이는
  // 경우가 있다(실측). 한 번만 떼면 매체명이 사건 요소로 남는다 → 최대 2회 제거.
  let t = decodeHtml(title);
  for (let i = 0; i < 2; i++) {
    const cut = t.replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/u, '');
    if (cut === t) break;
    t = cut;
  }
  return t.replace(/\s+/g, ' ').trim();
}

const STOP = new Set([
  // 영어 기능어
  'the','a','an','of','in','on','at','for','to','and','or','with','his','her','its',
  'new','says','said','after','from','over','into','this','that','be','is','are','was',
  'were','has','have','had','will','k','pop','as','by','but','not','out','up','off','all',
  'more','most','than','then','who','what','when','where','why','how','here','there',
  'it','he','she','they','we','you','their','our','your','one','two','about',
  // 2026-07-21 2차 — 헤드라인 상용어. 사건의 "요소"가 아니라 문장을 채우는 말이라
  // 리워딩마다 들락날락하며 가짜 새 요소를 만든다 (bold·dress·ball·having…).
  'watch','video','photo','photos','pic','pics','image','images','star','stars','show',
  'shows','news','report','reports','update','look','looks','style','styles','wear',
  'wears','wore','dress','dressed','outfit','sneakers','ball','kick','bold','having',
  'shop','release','releases','released','drops','drop','first','best','top','global',
  'official','ahead','link','links','behind','scenes','back','fans','fan','moment',
  'reveal','reveals','revealed','share','shares','shared','post','posts','via','com','www',
  // 한국어 상용어 (2026-07-21 2차)
  '사진','영상','기사','뉴스','공연','무대','모습','현장','네이트','스타일','화보',
  '공개','발표','소식','오늘','어제','관련','이번','지난','최근','대한','통해','위해',
  // 2026-07-27 3차 — 실측(BTS Butter 3번·정국 스포티파이 2번·NCT 티저 2번)에서
  // 같은 사건이 반복된 원인. 조회수·순위·플랫폼·컴백 상용어가 core 에 남아
  // 리워딩마다 '새 요소'를 만든다. 네이버 뉴스 소스 추가로 한↔영 표기 충돌 심화.
  // 조회수·수치 (숫자는 keywords 필터가, 단위·명사는 여기서)
  'billion','million','thousand','views','view','streams','stream','streaming',
  'record','records','milestone','surpasses','surpass','surpassed','becomes','become',
  'hits','hit','enters','enter','entered','tops','topped','reaches','reached',
  // 플랫폼·차트 (사건 식별에 부차적 — 여러 플랫폼 기사가 같은 사건)
  'spotify','billboard','youtube','melon','itunes','circle','hanteo','chart','charts',
  'hot','200','100','album','albums','single','singles','song','songs','track','tracks',
  // 컴백·발매 상용어 (그룹·작품명이 앵커라 이건 노이즈)
  'comeback','teaser','trailer','announce','announces','announced','announcement',
  'drop','drops','dropped','unveil','unveils','unveiled','reveals','revealed',
  'full','length','mini','repackage','prerelease','title','lead',
  // 군입대 (그룹·멤버명이 앵커)
  'enlist','enlists','enlistment','military','service','date','dates','army',
  // 기타 헤드라인 동사·명사
  'sweep','sweeps','spot','spots','meme','sparks','frenzy','higher','resolved','row',
  'tour','concert','performance','stage','win','wins','won','award','awards',
  // 시각물 명사 — 한쪽 기사에만 붙어 가짜 새 요소를 만든다 (NCT 'Logo/Banner Teaser').
  'logo','banner','poster','concept','visual','visuals','clip','preview','still',
  'jacket','tracklist','schedule','spoiler','snippet','edition','version',
  // 한국어 조회수·순위·플랫폼·컴백·군입대 상용어
  '돌파','뷰','스트리밍','스포티파이','빌보드','유튜브','멜론','차트','순위','기록',
  '달성','수록','활동','컴백','티저','예고','앨범','싱글','신곡','발매','공식',
  '입대','군입대','입영','전역','현역','육군','해군','공군','병역','의무','이행','대체복무','군백기','나란히','시작',
  '인기','독보적','최고','입찰','경매','유니폼','수상','정상','석권','올킬',
  // 2026-07-27 4차 — 한국어 상태·관계·시점 필러. 실측: 남궁민·진아름 득남이
  // 4번 발송(13:40→14:10 '+진아름' → 14:25 '+부부' → 15:35 '+됐다,+부모').
  // 사건 자체(득남)는 그대로인데 매체가 관계어("부부"·"부모 됐다")를 덧붙였을
  // 뿐인데 novel 로 잡혀 '사건 확장'이 됐다. 사건의 요소가 아니라 문장을 채우는
  // 말이므로 STOP 으로 내린다. (엔티티인 '진아름'은 남긴다 — 인물은 앵커)
  '됐다','했다','한다','됐고','밝혔다','전했다','알렸다','밝혀','전해',
  // 반응·인용 보도어 (2026-07-27 4차, 실측 손담비 호텔 비매너 2번 발송).
  // 같은 해명 하나를 매체가 '정색'·'침대'·'뭐가' 등으로 달리 옮겨 적어 매번
  // 새 요소가 됐다. 사건은 '논란+해명'이고 이 단어들은 서술 방식일 뿐이다.
  '정색','침대','뭐가','결국','직접','해명','입장','심경','발끈','토로','호소',
  '부부','부모','아빠','엄마','아버지','어머니','아들','딸','품에','안았다',
  '만에','만의','앞두고','이어','역시','당시','현재','이날','최초','드디어',
  // 2026-08-05 5차 — 헤드라인 수식어. 사건의 요소가 아니라 기사 제목을 꾸미는 말이라
  // 매체마다 들락날락하며 가짜 새 요소를 만든다 (블랙핑크 실측: 초특급·조화·만남).
  '초특급','조화','만남','기념','입은','선보인','선보여','맞손','손잡','눈길','화제',
  // 따옴표·괄호 뒤에 홀로 떨어져 나온 조사 (예: 'DEADLINE'으로 → deadline + 으로)
  '으로','에서','에게','까지','부터','이라','라며','와의','과의','대해','따르면',
  '이슈','문화','특별','완벽','역대급','파격','깜짝','전격','단독','독점','최초공개',

]);

// 2026-07-21 — 한국어 대응. 기존 `length >= 3` 은 영어 기준이라 한국어 헤드라인의
// 핵심어(정국·결승·무대·수상…)를 거의 전부 버렸고, 그래서 한국어 기사끼리는
// 중복 판정이 사실상 작동하지 않았다. CJK 는 2자부터 의미가 있으므로 분리한다.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

// 한국어 조사 분리 (2026-07-27 4차). 형태소 분석기 없이 안전하게: 한글 3자 이상
// 토큰의 '끝 조사'만 떼어 어간을 남긴다. 2자 토큰은 건드리지 않는다(조사 떼면
// 1자만 남아 의미가 사라지고, 이름·단어가 뭉개진다).
//   진아름과 → 진아름 · 정국이 → 정국 · 무대에서 → 무대
// 어간이 2자 미만이 되면 원본을 유지해 과잉 절단을 막는다.
// 주의: '이'·'가' 는 조사 목록에서 뺐다 — 한국어 명사가 이 글자로 끝나는 경우가
// 많아 과잉 절단이 난다(실측: 스포티파이 → 스포티파 로 잘려 한/영 지문이 어긋남,
// 음악가·작곡가도 동일 위험). 이름 뒤 주격조사는 ENTITY_ALIASES 치환이 이미 분리한다.
const PARTICLE_RE = /(으로써|으로서|에게서|이라며|라면서|에서도|으로는|에게는|이라는|라는|와의|과의|에서|에게|으로|이라|라며|께서|부터|까지|보다|처럼|만큼|조차|마저|이랑|하고|와|과|은|는|을|를|의|에|도|로|만|랑)$/;
/* 활용 어미 분리 (2026-08-05 5차). 실측: 블랙핑크 국립중앙박물관 협업 하나가
   6번 발송됐다. 원인 중 하나가 '협업한' vs '협업' 이 서로 다른 토큰이 된 것이다.
   조사(PARTICLE_RE)만 떼고 관형형·서술형 어미는 그대로 뒀기 때문이다.
   조사보다 먼저 떼야 '협업했다' 같은 형태도 어간에 도달한다. */
const ENDING_RE = /(하는|되는|하던|했던|했다|한다|된다|하다|되다|시킨|한|된|인)$/;

function stripParticle(w) {
  // 숫자·라틴이 앞에 붙은 형태(48세에 · k팝과)도 대상.
  // 2026-08-05: 기존 정규식이 `^[0-9]*[가-힯]+$` 라 'k팝과' 처럼 라틴이 섞이면
  // 통째로 건너뛰어 조사가 안 떨어졌다(실측 core 에 'k팝과' 가 그대로 남음).
  if (!/^[0-9a-zA-Z]*[가-힯]+$/.test(w) || w.length < 3) return w;
  let stem = w.replace(ENDING_RE, '');
  if (stem.length < 2) stem = w;
  const out = stem.replace(PARTICLE_RE, '');
  return out.length >= 2 ? out : stem;
}
function keywords(title) {
  return norm(canonicalize(stripSource(title))).split(' ')
    // 순수 숫자·수치는 사건의 요소가 아니다. 2026-07-27 강화:
    // 연도·엔티티코드(순수숫자) + 조회수·스트리밍 단위(15억·11억·1000만) +
    // 서수(7th·1st) 전부 제거 — 실측 Butter '11억' vs '1.1 billion' 충돌 원인.
    // STOP 단어는 조사 분리 '전에' 걸러낸다 — 안 그러면 상용어가 잘려(스포티파이 →
    // 스포티파) STOP 을 빠져나가 가짜 요소가 된다(실측 회귀).
    .filter(w => !STOP.has(w))
    // 한국어 조사 분리 — '진아름과' vs '진아름' 이 다른 토큰으로 잡혀 가짜 새 요소가
    // 됐다(실측). 3자 이상 CJK 토큰의 끝 조사만 떼어 어간을 남긴다(2자 이름 보호).
    // 수치 필터보다 먼저 돌려야 '48세에' → '48세' → 수치로 걸러진다.
    .map(w => stripParticle(w))
    // 2026-07-27 4차 — 나이·인원 수치도 제거(48세·30대·2명). 한 매체만 나이를
    // 쓰면 그게 '새 요소'가 돼 같은 사건이 또 발송된다(남궁민 '48세에' 실측).
    .filter(w => !/^\d+(억|만|천|백|위|세|살|대|명|주년|회|일|월|년|차|호|번|기|주|시|분|th|st|nd|rd)?$/i.test(w))
    .filter(w => (CJK_RE.test(w) ? w.length >= 2 : w.length >= 3) && !STOP.has(w));
}

/* 헤드라인 하나의 지문 — 같은 기사가 실행마다 다시 잡히는 것을 막는다.
   단어 순서·꼬리 매체명·엔티티 인코딩 차이를 흡수하도록 정렬된 키워드 집합으로 만든다.
   (클러스터 core 는 어떤 헤드라인이 함께 묶이느냐에 따라 흔들리지만, 이 키는
    헤드라인 하나만 보므로 흔들리지 않는다 — 중복 방지의 마지막 방어선.) */
function titleKey(title) {
  const ks = [...new Set(keywords(title))].sort();
  return ks.length ? ks.join('-') : norm(stripSource(title)).slice(0, 60);
}

/* 한·영 표기 통일 — BTS 와 방탄소년단이 다른 토큰이면 같은 사건이 갈라진다.
   토큰화 전에 별칭을 하나의 정규 표기로 치환한다. */
const ENTITY_ALIASES = [
  ['bts', /(bts|방탄소년단|방탄)/gi],
  ['blackpink', /(blackpink|블랙핑크)/gi],
  ['newjeans', /(newjeans|뉴진스)/gi],
  ['aespa', /(aespa|에스파)/gi],
  ['straykids', /(stray\s?kids|스트레이\s?키즈)/gi],
  ['seventeen', /(seventeen|세븐틴)/gi],
  ['twice', /(twice|트와이스)/gi],
  // 2026-07-27 한국 소스 보강 — 한국발 기사와 영문 기사가 같은 사건으로 묶이도록.
  ['jungkook', /(jung\s?kook|정국)/gi],
  ['jimin', /(jimin|지민)/gi],
  ['jennie', /(jennie|제니)/gi],
  ['gdragon', /(g[-\s]?dragon|지드래곤|권지용)/gi],
  ['아이유', /\bIU\b|아이유/g],
  ['lesserafim', /(le\s?sserafim|르세라핌)/gi],
  ['ive', /\bIVE\b|아이브/g],
  // 2026-07-27 3차 — 실측 중복(세븐틴 군입대 4번)의 멤버 표기 통일.
  ['dokyeom', /(dokyeom|도겸)/gi],
  ['vernon', /(vernon|버논)/gi],
  ['taehyung', /(taehyung|태형)/gi],
  ['nct', /(nct\s?127|nct127)/gi],
  ['worldcup', /(world\s?cup|월드컵)/gi],
  ['superbowl', /(super\s?bowl|슈퍼볼)/gi],
  ['halftime', /(halftime|하프타임)/gi],
  ['metgala', /(met\s?gala|멧\s?갈라)/gi],
  ['oscars', /(oscars?|아카데미\s?시상식)/gi],
  ['grammys', /(grammys?|그래미)/gi],
  ['cannes', /(cannes|칸\s?영화제)/gi],
  ['chanel', /(chanel|샤넬)/gi],
  ['dior', /(dior|디올)/gi],
  ['gucci', /(gucci|구찌)/gi],
  ['prada', /(prada|프라다)/gi],
  ['louisvuitton', /(louis\s?vuitton|루이\s?비통)/gi],
  ['balenciaga', /(balenciaga|발렌시아가)/gi],
  ['saintlaurent', /(saint\s?laurent|생\s?로랑)/gi],
  // 2026-07-27 4차 — 사건 동의어 통일. 같은 출산 사건을 매체가 득남/출산/첫아들로
  // 달리 쓰면 서로 '새 요소'가 돼 중복 발송된다(남궁민·진아름 실측 4건).
  // 아들/딸 구분은 알림 문구(원문 제목)에 그대로 남으므로 지문만 통일한다.
  // 2026-08-05 5차 — 기관·사물·행사 동의어. 아티스트 이름만 통일돼 있어서
  // 같은 사건을 매체가 다른 이름으로 부르면 갈라졌다. 실측(블랙핑크 6회 발송):
  //   국중박 / 국립박물관 / 국립중앙박물관 · 뮷즈 / MU:DS · 협업 / 콜라보 가 전부 별개 토큰이었다.
  ['국립중앙박물관', /(국립\s?중앙\s?박물관|국립\s?박물관|국중박)/g],
  ['뮷즈', /(뮷즈|mu\s?:?\s?ds)/gi],
  ['kpop', /(k[-\s]?pop|케이팝|k팝)/gi],
  ['협업', /(콜라보레이션|콜라보|collaboration|collab)/gi],
  ['컬렉션', /(콜렉션|collection)/gi],
  ['앰배서더', /(앰배서더|앰버서더|ambassador|브랜드\s?뮤즈)/gi],
  ['팝업', /(팝업\s?스토어|pop[-\s]?up\s?store)/gi],
  ['시구', /(시구자|시구|first\s?pitch)/g],
  ['다저스', /(la\s?다저스|다저스|dodgers)/gi],
  ['txt', /(투모로우바이투게더|tomorrow\s?x\s?together|\bTXT\b)/g],
  ['챌린지', /(챌린지|challenge)/gi],
  /* 2026-08-05 6차 — 앵커 사전 확장 (도메니코 지시).
     실측(08-05 알림 43건): 재탕 가드는 '공유 앵커가 없으면 판정 자체를 포기'하는데,
     사전이 36개뿐이고 한글 표기가 거의 없어 한국 아티스트는 가드가 아예 안 돌았다.
     이하이 월드투어 취소가 35분·45분 간격으로 3번 나간 게 대표 사례다.
     짧은 이름(선미·플로·디노·연준)은 다른 단어의 일부로 잡히면 오탐이 되므로
     한글 경계 룩어라운드를 건다 — 예: '플로'가 '플로리다·플로럴'에 걸리면 안 된다.
     뒤쪽 경계는 **조사는 허용**한다: '씨스타가·이하이는' 에서 이름을 못 잡으면
     의미가 없다. 조사가 아닌 한글이 이어지면(플로리다의 '리') 불일치. */
  ['이하이', /(?<![가-힣])이하이(?!(?![은는이가을를의에도와과로만])[가-힣])|\bLee\s?Hi\b/gi],
  ['선미', /(?<![가-힣])선미(?!(?![은는이가을를의에도와과로만])[가-힣])|\bSunmi\b/gi],
  ['에이티즈', /(?<![가-힣])에이티즈(?!(?![은는이가을를의에도와과로만])[가-힣])|\bATEEZ\b/gi],
  ['아일릿', /(?<![가-힣])아일릿(?!(?![은는이가을를의에도와과로만])[가-힣])|\bILLIT\b/gi],
  ['악뮤', /(?<![가-힣])(악뮤|악동뮤지션)(?!(?![은는이가을를의에도와과로만])[가-힣])|\bAKMU\b/gi],
  ['우주소녀', /(?<![가-힣])우주소녀(?!(?![은는이가을를의에도와과로만])[가-힣])|\bWJSN\b/gi],
  ['박재범', /(?<![가-힣])박재범(?!(?![은는이가을를의에도와과로만])[가-힣])|\bJay\s?Park\b/gi],
  ['김희철', /(?<![가-힣])김희철(?!(?![은는이가을를의에도와과로만])[가-힣])/g],
  ['씨스타', /(?<![가-힣])씨스타(?!(?![은는이가을를의에도와과로만])[가-힣])|\bSISTAR\b/gi],
  ['제이홉', /(?<![가-힣])제이홉(?!(?![은는이가을를의에도와과로만])[가-힣])|\bj[-\s]?hope\b/gi],
  ['ourbirthday', /(?<![가-힣])아워벌스데이(?!(?![은는이가을를의에도와과로만])[가-힣])|\bOURBIRTHDAY\b/gi],
  ['flo', /(?<![가-힣])플로(?!(?![은는이가을를의에도와과로만])[가-힣])|\bFLO\b/g],
  ['미니브', /(?<![가-힣])미니브(?!(?![은는이가을를의에도와과로만])[가-힣])|\bMINIV\b/gi],
  ['디노', /(?<![가-힣])디노(?!(?![은는이가을를의에도와과로만])[가-힣])|\bDINO\b/g],
  ['연준', /(?<![가-힣])연준(?!(?![은는이가을를의에도와과로만])[가-힣])|\bYeonjun\b/gi],
  ['출산', /(득남|득녀|첫아들|첫딸|출산|순산)/g],
  ['열애', /(열애|공개연애|교제)/g],
  ['결별', /(결별|파경|이혼)/g],
];
function canonicalize(text) {
  let s = String(text || '');
  for (const [key, re] of ENTITY_ALIASES) s = s.replace(re, ' ' + key + ' ');
  return s;
}

/* 교차 검증 클러스터링 — 키워드 3개 이상 겹치고 소스가 서로 다르면 같은 사건.
   두 개 이상 매체가 다룬 사건만 속보 후보 (단독 낚시 기사 배제). */
function clusterEvents(items) {
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const base = keywords(items[i].title);
    if (base.length < 2) continue;
    const group = [items[i]];
    used.add(i);
    for (let k = i + 1; k < items.length; k++) {
      if (used.has(k)) continue;
      const other = keywords(items[k].title);
      const overlap = base.filter(w => other.includes(w));
      if (overlap.length >= 3) { group.push(items[k]); used.add(k); }
    }
    const sources = new Set(group.map(g => g.source));
    if (sources.size >= 2) {
      // 2026-07-21 — 시그니처를 "첫 헤드라인의 앞 6단어"로 만들면 같은 사건이라도
      // 클러스터의 첫 항목이 바뀔 때마다 시그니처가 달라져 중복 판정이 새어나갔다.
      // 그룹 전체에서 가장 자주 등장한 키워드로 만들어 순서에 흔들리지 않게 한다.
      const kw = clusterKeywords(group);
      const core = clusterCore(group);
      clusters.push({
        signature: core.length ? core.join('-') : kw.slice(0, 5).sort().join('-'),
        kw,
        core,
        headlines: group.map(g => ({ title: g.title, link: g.link, source: g.source })),
        sourceCount: sources.size,
        topic: group[0].topic,
        newestTs: Math.max(...group.map(g => g.ts || 0)),
      });
    }
  }
  return clusters.sort((a, b) => b.sourceCount - a.sourceCount);
}

/* 클러스터 대표 키워드 — 빈도 높은 순, 동률이면 사전순(결정적). */
function clusterKeywords(group) {
  const freq = new Map();
  for (const g of group) {
    for (const w of new Set(keywords(g.title))) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(e => e[0])
    .slice(0, 12);
}

/* 사건의 "실체" 키워드 — 여러 매체가 공통으로 쓴 단어만 남긴다.
   도메니코 규칙(2026-07-21):
     "단어나 문장만 바꿔가며 BTS가 출연했다는 기사는 중복.
      다만 정호연이 추가되면 정호연이 들어갔으므로 다른 기사."
   즉 사건의 정체성은 **등장 요소(인물·브랜드·이벤트)의 집합**이지 문장 표현이
   아니다. 리워딩으로 생긴 단어는 한 매체에만 나타나고, 진짜 새 인물은 여러
   매체 헤드라인에 동시에 등장한다 — 그 차이로 둘을 가른다. */
function clusterCore(group) {
  const need = group.length >= 3 ? 2 : group.length; // 2건이면 둘 다에, 3건 이상이면 2건 이상에
  const freq = new Map();
  for (const g of group) {
    for (const w of new Set(keywords(g.title))) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].filter(e => e[1] >= need).map(e => e[0]).sort();
}

/* 이미 알린 사건과 같은가.
   판정: 새 사건의 실체 키워드가 **기존에 없던 요소를 하나라도 더하면 다른 사건**.
   더하는 게 없고 겹치기만 하면(= 표현만 바꾼 재탕) 중복.

   예) 기존: [bts, halftime, worldcup]
       "BTS 하프타임쇼 무대 오른다"     → core [bts, halftime, worldcup] → 중복 ✅
       "정호연·BTS 하프타임쇼 동반 출연" → core [+정호연]                → 새 사건 ✅ */
// 이만큼 겹치면 새 표현이 몇 개 붙든 같은 사건으로 본다 (2026-07-27 실측 기준).
const STRONG_OVERLAP = 4;

function sameEvent(newCore, seenCore, opts) {
  const A = (newCore || []).filter(Boolean);
  const B = new Set((seenCore || []).filter(Boolean));
  if (!A.length || !B.size) return false;

  let inter = 0, novel = 0;
  for (const w of new Set(A)) (B.has(w) ? inter++ : novel++);
  if (!inter) return false;

  // ① 새 요소가 없다 = 기존 사건의 부분집합 = 표현만 바꾼 재탕 → 중복.
  //    단, 겹침이 1개뿐이면 우연일 수 있으니(예: 'worldcup' 만 같음) 제외.
  if (novel === 0) {
    const minOverlap = (opts && opts.minOverlap) || 2;
    return inter >= minOverlap || (inter === 1 && A.length === 1 && B.size === 1);
  }

  // ② 도메니코 원칙2 (2026-07-27 확정): "비슷한 소식이면 중복으로 보내지
  //    않되, 추가된 소식이 많다면 예외로 둘 것."
  //    → 새 요소가 '하나'뿐이고 공유 앵커가 2개 이상이면 같은 사건의 커버리지
  //      차이(멤버 한 명 더 언급 등)로 보고 병합.
  //    → 새 요소가 '둘 이상'이면 사건이 실질 확장된 것 — 별도 알림.
  //    (7/21 정호연 규칙 '새 인물 하나 = 새 알림'은 이 원칙으로 대체됨.
  //     같은 날 af54b4d 가 novel>0 전면 알림으로 갔다가 이 원칙으로 재확정.)
  if (novel === 1 && inter >= 2) return true;

  // ③ 강한 겹침 우선 (2026-07-27 18:20 도메니코 실측 지시 — "비슷한 기사가 너무
  //    많이 와, 이건 다 걸러야 해"). 손담비 호텔 비매너 논란이 17:35·17:40·17:55·
  //    18:10·18:20 다섯 번 발송됐다. 매번 '손담비·논란·비매너·적당히·호텔' 5~6개가
  //    그대로 겹쳤는데도, 매체가 새로 붙인 표현(억울했다·이번엔 / sns·분노 /
  //    대놓고·드러냈다)이 2개 이상이라 원칙2 의 '사건 확장'으로 빠져나갔다.
  //    → 핵심어가 4개 이상 겹치면 새 표현이 몇 개든 같은 사건으로 본다.
  //    novel 카운트보다 '겹침의 크기'가 사건 동일성의 더 강한 신호다.
  //    (겹침 3개 이하일 때만 원칙2 의 novel 판정이 그대로 살아 있다 —
  //     예: 앵커 3개짜리 사건에 새 인물·새 요소가 붙는 경우는 여전히 별도 알림)
  if (inter >= STRONG_OVERLAP) return true;

  return false;
}

/* 화제성 점수 — 알림을 보낼 가치가 있는가.
   도메니코 결정(2026-07-21): "5분마다 검토해서 화제성이 있는 것만 텔레그램".
   교차 매체 수가 가장 강한 신호이고, 대형 이벤트 키워드·최신성을 가산한다. */
const HOT_RE = /(bts|blackpink|방탄|블랙핑크|월드컵|world\s?cup|super\s?bowl|halftime|met\s?gala|oscar|grammy|cannes|comeback|debut|creative\s+director|artistic\s+director|steps?\s+down|appointed|사망|은퇴|열애|결혼|입대|전역|수상|1위|컴백|데뷔|해체|파경)/i;
function hotScore(c) {
  let s = c.sourceCount * 2;                              // 교차 검증 = 핵심 신호
  if (HOT_RE.test(c.headlines.map(h => h.title).join(' '))) s += 3;
  if (c.newestTs && Date.now() - c.newestTs < 60 * 60 * 1000) s += 2; // 1시간 이내
  if (c.headlines.length >= 4) s += 1;                    // 헤드라인 물량
  return s;
}
const HOT_MIN = 7; // 2개 매체(4) + 최신(2) 만으로는 안 보냄. 3개 매체 또는 대형 키워드 필요.

/* 주제 이탈 거부 (2026-07-27 — 도메니코: "셀럽 뉴스 아닌 정치뉴스 등은 제외").
   왜: 네이버·연합뉴스 소스가 추가되면서 정치·시사·재난 기사가 섞여 들어왔다.
   실측: "윤석열 공직선거법 1심 징역형" 이 5개 매체 교차검증을 통과해 알림으로 나감.
   PAP/페퍼릿은 셀럽·패션·뷰티·컬쳐 매거진이므로 그 밖의 주제는 걸러야 한다.

   ⚠️ 설계 원칙 — 연예 뉴스와 겹치는 단어는 넣지 않는다:
     · '병역·입대·현역·군백기'는 셀럽(도겸·버논 입대)이라 거부 대상 아님 → 국방 일반어 제외.
     · '검찰·법원·재판'은 셀럽 사건에도 나오므로 넣지 않음(정치인 이름·선거·탄핵 같은
       정치 고유 신호로만 판정).
   그래서 여기 목록은 '연예에 거의 안 나오는 정치·시사·경제·재난 고유어'만 담는다. */
const OFF_TOPIC_RE = new RegExp([
  // 정치 — 인물·기관·제도 (연예 헤드라인에 거의 없음)
  '윤석열','이재명','한동훈','조국','대통령','대통령실','청와대','국회','국회의원',
  '여당','야당','국민의힘','더불어민주당','민주당','정의당','조국혁신당','원내대표',
  '대선','총선','보궐선거','지방선거','공직선거','선거법','탄핵','특검','공수처',
  '국정감사','대정부질문','개헌','정상회담','외교부','국방부장관','통일부',
  // 북한·안보 (셀럽 '입대'와 겹치지 않는 고유어만)
  '북한','김정은','미사일 도발','핵실험','무인기',
  // 경제·시사
  '금리 인상','금리 인하','기준금리','환율','코스피','코스닥','증시','부동산 정책',
  '재건축','물가 상승','무역수지','추경',
  // 재난·사회 (연예 무관)
  '태풍','지진','폭우','호우','산불','참사','붕괴 사고','침수',
  // 기업 IR·B2B PR (2026-07-27 4차) — 실측: 코스맥스 'SNS 혁신대상' 2번 발송.
  // 뷰티 '기업'의 수상·실적 보도자료는 셀럽·컬쳐 매거진 소재가 아니다.
  // 주의: 셀럽 시상식(그래미·아카데미·백상)은 여기 없는 고유어라 계속 통과한다.
  '혁신대상','소셜아이어워드','브랜드대상','대상 수상','고객만족도','품질대상',
  '영업이익','당기순이익','분기 실적','실적 발표','매출 증가','매출 감소','컨퍼런스콜',
  '기업설명회','업무협약','MOU','수주','증설','공장 준공','상장 예비심사','유상증자',
  '자사주','최대주주','지분 인수','인수합병','물적분할','ODM','OEM',
  '코스맥스','한국콜마',
].join('|'), 'i');

/* 셀럽·컬쳐 매거진 주제가 아닌가 (제목 기준). 이게 true면 알림에서 제외한다. */
function isOffTopic(title) {
  return OFF_TOPIC_RE.test(String(title || ''));
}

/* ─── 타깃 관문 (2026-07-27 도메니코 지시) ───────────────────────────────
   "메시지가 너무 많이 오니 케이팝 셀럽 혹은 10~20대 타깃 소식으로 축소."
   기존 isOffTopic 은 '빼는' 필터라 남는 게 너무 많았다(실측 24h: 중년 배우
   예능·기업 협업 드라마·백화점 팝업·e스포츠·웹툰까지 통과). 그래서 '들이는'
   관문을 둔다 — 아래 신호 중 하나라도 없으면 알림하지 않는다. */
// 한글 신호 — 부분일치 사고를 피하려고 '진'·'뷔' 같은 1~2자 멤버명과, 연극·드라마
// 에도 쓰이는 범용어('데뷔'·'컴백' 단독)는 넣지 않는다. 그룹명·케이팝 활동어 위주.
const ON_TARGET_KO = [
  // ① 케이팝 활동 어휘
  '아이돌','걸그룹','보이그룹','케이팝','케이팝그룹','연습생','데뷔조','솔로데뷔',
  '컴백무대','컴백일','완전체','타이틀곡','미니앨범','정규앨범','수록곡','선공개곡',
  '뮤직비디오','뮤비','음악방송','음원차트','음원강자','쇼케이스','팬미팅','팬콘',
  '팬사인회','팬덤','응원봉','월드투어','단독공연','앙코르 콘서트','컴백 쇼케이스',
  '전속계약','재계약','해체설','서바이벌','아이돌그룹','신인그룹','걸크러시',
  // 소속사 — 케이팝 생태계 신호
  '하이브','에스엠','와이지','제이와이피','어도어','빅히트','플레디스','스타쉽',
  '쏘스뮤직','빌리프랩','안테나','큐브엔터','알이피',
  // ② 대표 그룹·아티스트 (2자 이하·범용 단어와 겹치는 이름은 제외)
  '방탄소년단','블랙핑크','뉴진스','아이브','에스파','르세라핌','세븐틴',
  '스트레이키즈','트와이스','엔시티','투모로우바이투게더','베이비몬스터',
  '제로베이스원','엔하이픈','아일릿','키스오브라이프','레드벨벳','여자아이들',
  '아이콘','위너','마마무','오마이걸','엔믹스','케플러','스테이씨','우주소녀',
  '트레저','샤이니','슈퍼주니어','엑소','갓세븐','몬스타엑스','더보이즈','에이티즈',
  '빅뱅','라이즈','있지','있지','에이핑크','프로미스나인','izna','보이넥스트도어',
  '정국','지드래곤','아이유','장원영','카리나','태연','제니','로제','리사','태민',
  '백현','수호','창빈','미연','안유진','설윤','츄','닝닝','윈터','하이키',
  // ③ 10~20대 타깃 문화 — 매거진 본업(패션·뷰티) 접점
  '앰버서더','앰배서더','브랜드 뮤즈','화보','패션위크','런웨이','포토그래퍼',
  '틱톡','챌린지','버추얼 아이돌','숏폼','팝업스토어',
];
// 영문 신호 — 부분일치(drive 안의 ive) 방지로 단어 경계를 강제한다.
const ON_TARGET_EN = [
  'k-?pop','bts','blackpink','newjeans','aespa','ive','le\\s?sserafim','seventeen',
  'stray\\s?kids','twice','nct','txt','babymonster','zerobaseone','enhypen','illit',
  'itzy','riize','ikon','comeback','fandom','world\\s?tour','idol','girl\\s?group',
  'boy\\s?group','billboard','melon\\s?chart',
];
const ON_TARGET_RE = new RegExp(
  '(' + ON_TARGET_KO.join('|') + ')|\\b(' + ON_TARGET_EN.join('|') + ')\\b', 'i');

/* 이 소식이 케이팝·10~20대 타깃인가. false 면 알림하지 않는다. */
function isOnTarget(title) {
  return ON_TARGET_RE.test(String(title || ''));
}

/* ─── 같은 앵커 · 짧은 시간창 재탕 가드 (2026-08-05 5차 신설) ──────────────
   왜 만들었나 — 실측: 블랙핑크 × 국립중앙박물관 뮷즈 협업 **하나**가
   02:35 · 03:35 · 05:15 · 05:40 · 06:10 · 07:31 총 6번 알림으로 나갔다.
   기존 sameEvent 로는 못 잡았다. 매체마다 헤드라인 어휘가 워낙 달라
   (굿즈/컬렉션/헤리티지 · 국중박/국립박물관 · 황후 예복/문화유산의 조화)
   겹침이 2~3개에 그치고 새 단어가 2개 이상 붙어 매번 '사건 확장'으로 빠져나갔다.

   판정 — **알려진 앵커(아티스트·브랜드·기관)를 공유하면서 실체 키워드가
   2개 이상 겹치면 같은 사건.** 새 단어가 몇 개 붙든 상관하지 않는다.
   앵커를 요구하는 이유: 흔한 단어 2개만 우연히 겹치는 경우를 배제하기 위해서다.

   왜 안전한가 — 앵커만 같고 실체가 안 겹치면(예: 같은 날 블랙핑크 컴백 발표,
   core=[blackpink, 앨범명]) 겹침이 1개라 그대로 통과한다. 같은 아티스트의
   진짜 다른 소식은 묻히지 않는다.
   호출부에서 **최근 6시간 이내 기록**에만 적용한다 (celeb-watch 핸들러). */
/* 앵커 = 사건을 특정하는 **고유 존재**(인물·그룹·브랜드·기관·대회).
   ENTITY_ALIASES 에는 표기 통일 목적의 '사건·사물 표현'도 섞여 있는데
   (협업·컬렉션·시구·출산·열애…) 이건 앵커가 아니다. 서로 다른 두 사건이
   '협업' 같은 흔한 말을 공유한다고 같은 사건일 수는 없다.
   2026-08-05 회귀: 앵커 목록을 별칭 전체로 잡았더니 ['컬렉션','협업'] 두 개가
   겹치는 무관한 두 사건이 재탕으로 묶였다. */
const NON_ANCHOR_KEYS = new Set([
  'kpop', '협업', '컬렉션', '앰배서더', '팝업', '시구', '챌린지',
  '출산', '열애', '결별',
]);
const ANCHOR_SET = new Set(
  ENTITY_ALIASES.map(([k]) => k).filter(k => !NON_ANCHOR_KEYS.has(k))
);
const RERUN_WINDOW_MS = 6 * 3600 * 1000;
const RERUN_MIN_OVERLAP = 2;
// 앵커를 못 찾았을 때의 기준 — 사전에 없는 인물·사건도 판정하되 문턱을 높인다.
const RERUN_MIN_OVERLAP_NOANCHOR = 3;

function anchorsOf(core) {
  return (core || []).filter(w => ANCHOR_SET.has(w));
}

function sameEventRecent(newCore, seenCore, opts) {
  const A = new Set((newCore || []).filter(Boolean));
  const B = new Set((seenCore || []).filter(Boolean));
  if (!A.size || !B.size) return false;
  let sharedAnchor = false;
  for (const w of A) if (ANCHOR_SET.has(w) && B.has(w)) { sharedAnchor = true; break; }
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  /* 2026-08-05 6차 — 앵커가 없어도 판정한다 (도메니코 지시).
     종전엔 공유 앵커가 없으면 여기서 false 를 반환해 **재탕 가드가 통째로
     꺼졌다**. 앵커 사전은 사람이 채우는 목록이라 새 아이돌이 나올 때마다 같은
     구멍이 다시 생긴다 — 구조로 막는다.
     대신 앵커가 없을 때는 우연 일치를 피하려 겹침 기준을 3개로 올린다.
     (앵커 있음 2개 / 없음 3개. 실측 08-05: 이하이 월드투어 취소 3건이
      '이하이·월드투어·취소' 3개로 겹쳐 이 경로에서 잡힌다.) */
  const minOverlap = (opts && opts.minOverlap)
    || (sharedAnchor ? RERUN_MIN_OVERLAP : RERUN_MIN_OVERLAP_NOANCHOR);
  return inter >= minOverlap;
}

/* ─── 페퍼릿 적합도 태깅 (2026-08-05 도메니코 지시) ────────────────────────
   왜 — PAP 본지와 페퍼릿이 같은 감시망(celeb-watch)을 쓴다. PAP 은 사건사고·
   논란도 알아야 하지만 페퍼릿(Z세대 케이팝 데일리)은 그걸 다루지 않는다.
   그래서 **수집에서 빼지 않고 태그만 붙인다.** PAP 알림은 종전 그대로 가고,
   페퍼릿 예약작업은 `where pep_blocked=false and pep_category is not null` 로 고른다.

   ⚠️ 여기서 거른다고 기사가 안 나가는 건 아니다. 페퍼릿 에이전트가 한 번 더
   교차검증·중복검사를 한다. 이건 '들이는 관문'이 아니라 '미리 빼두는 체'다. */
const PEP_BLOCK_RE = new RegExp([
  // 사생활·연애
  '열애', '결혼', '파경', '이혼', '결별', '재혼', '임신', '출산',
  // 사건사고·법적 분쟁
  '사망', '별세', '빈소', '조문', '사고', '고소', '고발', '피소', '송치', '기소',
  '구속', '영장', '재판', '법정', '벌금', '집행유예', '실형',
  '음주운전', '마약', '도박', '학폭', '성희롱', '성추행', '성폭행', '갑질',
  // 분쟁·부정 이슈
  '논란', '해명', '사과문', '폭로', '저격', '루머', '탈퇴', '해체', '퇴출',
  '계약해지', '전속계약 분쟁', '법적대응', '내홍', '왕따',
  // 외모 평가·줄세우기 (브랜드 가이드 금지)
  '서열', '싸움', '순위 매기', '줄세우기', '외모 평가', '성형', '다이어트',
  '몸매', '굴욕', '민낯', '충격', '경악', '발칵',
].join('|'));

/* 카테고리 판정 — 페퍼릿 5종 중 무엇인가. 없으면 null (= 페퍼릿 소재 아님).
   순서가 중요하다: NEWS 를 먼저 본다. '데뷔 10주년 기념 컬렉션' 을
   NEW FACE 로 오분류하지 않기 위해서다(실측 블랙핑크 헤리티지). */
// 순서 = 우선순위. NEW FACE 를 먼저 본다 — 데뷔 소식은 컴백·협업 어휘가 같이 나와도
// 본질이 '새 얼굴' 이기 때문이다. 단 '데뷔 10주년' 은 신인이 아니라 기념 소식이므로
// 아래 ANNIVERSARY_RE 로 뺀다(실측: 블랙핑크 데뷔 10주년 헤리티지 컬렉션).
// ⚠️ '뮤즈' 를 단독으로 넣지 않는다 — 소속사 '아뮤즈' 에 부분일치해 신인 데뷔가
//    NEWS 로 잘못 분류됐다(실측 AEN).
const ANNIVERSARY_RE = /\d+\s*(주년|년\s*만)/;
const PEP_CATEGORY_RULES = [
  ['NEW FACE', /(데뷔|신인|연습생|데뷔조|첫\s?싱글|프리\s?데뷔|신인그룹|새\s?걸그룹|새\s?보이그룹)/],
  ['NEWS', /(컴백|발매|신곡|타이틀곡|선공개|수록곡|미니앨범|정규앨범|협업|컬렉션|앰배서더|브랜드\s?뮤즈|광고\s?모델|모델\s?발탁|시상식|수상|시구|챌린지|월드투어|콘서트)/],
  ['SCHEDULE', /(스케줄|일정|투어|팬미팅|팬콘|쇼케이스|페스티벌|팬사인회)/],
  ["TODAY'S LOOK", /(공항\s?패션|화보|착장|패션위크|런웨이|스타일링|포토그래퍼)/],
];

function pepBlocked(title) {
  return PEP_BLOCK_RE.test(stripSource(String(title || '')));
}

/* 페퍼릿용 타깃 관문 — isOnTarget 보다 살짝 넓다.
   왜: isOnTarget 은 '알려진 그룹 이름'을 요구한다. 그런데 NEW FACE 는 **이름이
   아직 안 알려진 신인**을 다루는 카테고리다(실측: '아워벌스데이 첫 싱글로 정식
   데뷔' 가 이름이 목록에 없어 걸러졌다). 케이팝 생태계 어휘가 있으면 통과시키고,
   최종 판정은 아래 카테고리 정규식에 맡긴다. */
const PEP_CONTEXT_RE = /(걸그룹|보이그룹|아이돌|신인그룹|연습생|데뷔조|소속사|앨범|타이틀곡|음악방송|음원|뮤직비디오|뮤비|팬덤|컴백|데뷔|\d+\s?집|싱글|수록곡|쇼케이스)/;

function pepCategory(title) {
  const t = stripSource(String(title || ''));
  if (!t || pepBlocked(t)) return null;
  if (!isOnTarget(t) && !PEP_CONTEXT_RE.test(t)) return null;  // 케이팝 맥락이 없으면 제외
  for (const [cat, re] of PEP_CATEGORY_RULES) {
    if (!re.test(t)) continue;
    // '데뷔 10주년' 은 신인 소식이 아니다 — NEW FACE 를 건너뛰고 다음 규칙으로.
    if (cat === 'NEW FACE' && ANNIVERSARY_RE.test(t)) continue;
    return cat;
  }
  return null;                               // 5종 어디에도 안 맞으면 페퍼릿 소재가 아니다
}

/* 페퍼릿 우선순위 점수 — 화제성(score)에 카테고리 적합도를 얹는다.
   차단된 소식은 0. 페퍼릿 예약작업이 `order by pep_score desc` 로 쓴다. */
function pepScore(title, baseScore) {
  if (pepBlocked(title)) return 0;
  const cat = pepCategory(title);
  if (!cat) return 0;
  let s = Number(baseScore) || 0;
  if (cat === 'NEWS' || cat === 'NEW FACE') s += 3;   // 페퍼릿 핵심 카테고리
  return s;
}

module.exports = {
  norm, canonicalize, keywords, clusterEvents, clusterKeywords, clusterCore,
  sameEvent, hotScore, HOT_MIN, decodeHtml, stripSource, titleKey, STOP,
  isOffTopic, OFF_TOPIC_RE, isOnTarget, ON_TARGET_RE, STRONG_OVERLAP,
  // 2026-08-05 5차 — 같은 앵커 재탕 가드 + 페퍼릿 태깅
  sameEventRecent, anchorsOf, ANCHOR_SET, NON_ANCHOR_KEYS, RERUN_WINDOW_MS, RERUN_MIN_OVERLAP, RERUN_MIN_OVERLAP_NOANCHOR,
  pepBlocked, pepCategory, pepScore, PEP_BLOCK_RE, PEP_CATEGORY_RULES, PEP_CONTEXT_RE,
};
