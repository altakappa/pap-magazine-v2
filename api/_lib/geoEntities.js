/**
 * GEO 엔티티 그라운딩 (2026-08-17)
 *
 * [왜] 기사 JSON-LD 에 about/mentions 가 전무했다. 생성 엔진과 지식그래프는
 * 기사가 "무엇에 관한 문서인지"를 엔티티(위키피디아 sameAs)로 고정할 때
 * 훨씬 안정적으로 인용한다 — 같은 브랜드를 다룬 문서끼리 묶이고, 브랜드
 * 질의("샤넬 캠페인")에 우리 기사가 후보로 걸린다.
 *
 * [원칙]
 *  - 사전은 **확실한 것만** 넣는다. 위키피디아 URL 이 불확실한 엔티티는
 *    안 넣는 게 낫다 — 틀린 sameAs 는 없느니만 못하다.
 *  - 짧거나 중의적인 별칭(V·Jin·IU 등)은 태그 정확 일치로만 매칭한다.
 *    제목 부분 문자열 매칭은 라틴 4자·한글 3자 이상만.
 *  - about = 제목에 등장(주제), mentions = 태그에만 등장(언급). about 최대 2,
 *    mentions 최대 6 — 도배는 스팸 신호다.
 */
'use strict';

const W = (slug) => 'https://en.wikipedia.org/wiki/' + slug;

/* type: Organization(브랜드) | Person | MusicGroup | Event
   aliases: 소문자 비교. tagOnly:true 면 제목 매칭 금지(중의성). */
const ENTITIES = [
  // ── 패션 하우스 ──
  { name: 'Chanel', type: 'Organization', sameAs: W('Chanel'), aliases: ['chanel', '샤넬'] },
  { name: 'Dior', type: 'Organization', sameAs: W('Dior'), aliases: ['dior', '디올'] },
  { name: 'Louis Vuitton', type: 'Organization', sameAs: W('Louis_Vuitton'), aliases: ['louis vuitton', '루이비통', '루이 비통'] },
  { name: 'Gucci', type: 'Organization', sameAs: W('Gucci'), aliases: ['gucci', '구찌'] },
  { name: 'Prada', type: 'Organization', sameAs: W('Prada'), aliases: ['prada', '프라다'] },
  { name: 'Miu Miu', type: 'Organization', sameAs: W('Miu_Miu'), aliases: ['miu miu', '미우미우'] },
  { name: 'Hermès', type: 'Organization', sameAs: W('Herm%C3%A8s'), aliases: ['hermès', 'hermes', '에르메스'] },
  { name: 'Balenciaga', type: 'Organization', sameAs: W('Balenciaga'), aliases: ['balenciaga', '발렌시아가'] },
  { name: 'Bottega Veneta', type: 'Organization', sameAs: W('Bottega_Veneta'), aliases: ['bottega veneta', '보테가 베네타', '보테가베네타'] },
  { name: 'Givenchy', type: 'Organization', sameAs: W('Givenchy'), aliases: ['givenchy', '지방시'] },
  { name: 'Fendi', type: 'Organization', sameAs: W('Fendi'), aliases: ['fendi', '펜디'] },
  { name: 'Versace', type: 'Organization', sameAs: W('Versace'), aliases: ['versace', '베르사체'] },
  { name: 'Burberry', type: 'Organization', sameAs: W('Burberry'), aliases: ['burberry', '버버리'] },
  { name: 'Moschino', type: 'Organization', sameAs: W('Moschino'), aliases: ['moschino', '모스키노'] },
  { name: 'Maison Margiela', type: 'Organization', sameAs: W('Maison_Margiela'), aliases: ['maison margiela', '메종 마르지엘라', '메종마르지엘라', 'margiela', '마르지엘라'] },
  { name: 'Comme des Garçons', type: 'Organization', sameAs: W('Comme_des_Gar%C3%A7ons'), aliases: ['comme des garçons', 'comme des garcons', '꼼데가르송'] },
  { name: 'Rick Owens', type: 'Person', sameAs: W('Rick_Owens'), aliases: ['rick owens', '릭 오웬스', '릭오웬스'] },
  { name: 'Jil Sander', type: 'Organization', sameAs: W('Jil_Sander'), aliases: ['jil sander', '질 샌더', '질샌더'] },
  { name: 'Acne Studios', type: 'Organization', sameAs: W('Acne_Studios'), aliases: ['acne studios', '아크네 스튜디오', '아크네스튜디오'] },
  { name: 'Valentino', type: 'Organization', sameAs: W('Valentino_(fashion_house)'), aliases: ['valentino', '발렌티노'] },
  { name: 'Celine', type: 'Organization', sameAs: W('Celine_(brand)'), aliases: ['celine', '셀린느'] },
  // ── 스포츠·스트리트 ──
  { name: 'Nike', type: 'Organization', sameAs: W('Nike,_Inc.'), aliases: ['nike', '나이키'] },
  { name: 'Adidas', type: 'Organization', sameAs: W('Adidas'), aliases: ['adidas', '아디다스'] },
  { name: 'Puma', type: 'Organization', sameAs: W('Puma_(brand)'), aliases: ['puma', '퓨마'] },
  { name: 'New Balance', type: 'Organization', sameAs: W('New_Balance'), aliases: ['new balance', '뉴발란스'] },
  { name: 'Vans', type: 'Organization', sameAs: W('Vans'), aliases: ['vans', '반스'] },
  { name: 'Fila', type: 'Organization', sameAs: W('Fila_(company)'), aliases: ['fila', '휠라'] },
  { name: 'Supreme', type: 'Organization', sameAs: W('Supreme_(brand)'), aliases: ['supreme', '슈프림'] },
  // ── K-pop 그룹 ──
  { name: 'BTS', type: 'MusicGroup', sameAs: W('BTS'), aliases: ['bts', '방탄소년단'] },
  { name: 'Blackpink', type: 'MusicGroup', sameAs: W('Blackpink'), aliases: ['blackpink', '블랙핑크'] },
  { name: 'NewJeans', type: 'MusicGroup', sameAs: W('NewJeans'), aliases: ['newjeans', '뉴진스'] },
  { name: 'Aespa', type: 'MusicGroup', sameAs: W('Aespa'), aliases: ['aespa', '에스파'] },
  { name: 'IVE', type: 'MusicGroup', sameAs: W('Ive_(group)'), aliases: ['아이브', 'ive'], tagOnly: true },
  { name: 'Seventeen', type: 'MusicGroup', sameAs: W('Seventeen_(South_Korean_band)'), aliases: ['seventeen', '세븐틴'] },
  { name: 'Stray Kids', type: 'MusicGroup', sameAs: W('Stray_Kids'), aliases: ['stray kids', '스트레이 키즈', '스트레이키즈'] },
  { name: 'Tomorrow X Together', type: 'MusicGroup', sameAs: W('Tomorrow_X_Together'), aliases: ['tomorrow x together', 'txt', '투모로우바이투게더'], tagOnly: true },
  { name: 'Ateez', type: 'MusicGroup', sameAs: W('Ateez'), aliases: ['ateez', '에이티즈'] },
  { name: 'Riize', type: 'MusicGroup', sameAs: W('Riize'), aliases: ['riize', '라이즈'] },
  { name: 'NCT', type: 'MusicGroup', sameAs: W('NCT_(group)'), aliases: ['nct', '엔시티'], tagOnly: true },
  { name: 'Exo', type: 'MusicGroup', sameAs: W('Exo'), aliases: ['exo', '엑소'], tagOnly: true },
  { name: 'BigBang', type: 'MusicGroup', sameAs: W('BigBang_(South_Korean_band)'), aliases: ['bigbang', '빅뱅'] },
  // ── 인물 ──
  { name: 'G-Dragon', type: 'Person', sameAs: W('G-Dragon'), aliases: ['g-dragon', '지드래곤', 'gd'] },
  { name: 'Jennie', type: 'Person', sameAs: W('Jennie_(singer)'), aliases: ['jennie', '제니'] },
  { name: 'Rosé', type: 'Person', sameAs: W('Ros%C3%A9_(singer)'), aliases: ['rosé', 'rose', '로제'], tagOnly: true },
  { name: 'Lisa', type: 'Person', sameAs: W('Lisa_(rapper)'), aliases: ['lisa', '리사'], tagOnly: true },
  { name: 'Jisoo', type: 'Person', sameAs: W('Jisoo'), aliases: ['jisoo', '지수'], tagOnly: true },
  { name: 'Jimin', type: 'Person', sameAs: W('Jimin'), aliases: ['jimin', '지민'], tagOnly: true },
  { name: 'V', type: 'Person', sameAs: W('V_(singer)'), aliases: ['v', '뷔'], tagOnly: true },
  { name: 'Jungkook', type: 'Person', sameAs: W('Jungkook'), aliases: ['jungkook', '정국'] },
  { name: 'Jin', type: 'Person', sameAs: W('Jin_(singer)'), aliases: ['jin', '진'], tagOnly: true },
  { name: 'Bae Suzy', type: 'Person', sameAs: W('Bae_Suzy'), aliases: ['suzy', '수지', 'bae suzy'], tagOnly: true },
  { name: 'Han So-hee', type: 'Person', sameAs: W('Han_So-hee'), aliases: ['han so-hee', 'han sohee', '한소희'] },
  { name: 'Park Bo-gum', type: 'Person', sameAs: W('Park_Bo-gum'), aliases: ['park bo-gum', 'park bogum', '박보검'] },
  { name: 'IU', type: 'Person', sameAs: W('IU_(singer)'), aliases: ['iu', '아이유'], tagOnly: true },
  { name: 'Karina', type: 'Person', sameAs: W('Karina_(South_Korean_singer)'), aliases: ['karina', '카리나'], tagOnly: true },
  { name: 'Taemin', type: 'Person', sameAs: W('Taemin'), aliases: ['taemin', '태민'] },
  { name: 'Zico', type: 'Person', sameAs: W('Zico_(rapper)'), aliases: ['zico', '지코'], tagOnly: true },
  { name: 'Jay Park', type: 'Person', sameAs: W('Jay_Park'), aliases: ['jay park', '박재범'] },
  { name: 'Pharrell Williams', type: 'Person', sameAs: W('Pharrell_Williams'), aliases: ['pharrell', 'pharrell williams', '퍼렐'] },
  { name: 'Hailey Bieber', type: 'Person', sameAs: W('Hailey_Bieber'), aliases: ['hailey bieber', '헤일리 비버'] },
  { name: 'Margot Robbie', type: 'Person', sameAs: W('Margot_Robbie'), aliases: ['margot robbie', '마고 로비'] },
  // ── 이벤트 ──
  { name: 'Met Gala', type: 'Event', sameAs: W('Met_Gala'), aliases: ['met gala', '멧 갈라', '멧갈라'] },
  { name: 'Coachella', type: 'Event', sameAs: W('Coachella'), aliases: ['coachella', '코첼라'] },
  { name: 'Paris Fashion Week', type: 'Event', sameAs: W('Paris_Fashion_Week'), aliases: ['paris fashion week', '파리 패션위크', '파리패션위크'] },
  { name: 'Milan Fashion Week', type: 'Event', sameAs: W('Milan_Fashion_Week'), aliases: ['milan fashion week', '밀라노 패션위크', '밀라노패션위크'] },
  { name: 'London Fashion Week', type: 'Event', sameAs: W('London_Fashion_Week'), aliases: ['london fashion week', '런던 패션위크'] },
  { name: 'New York Fashion Week', type: 'Event', sameAs: W('New_York_Fashion_Week'), aliases: ['new york fashion week', '뉴욕 패션위크'] },
  { name: 'Seoul Fashion Week', type: 'Event', sameAs: W('Seoul_Fashion_Week'), aliases: ['seoul fashion week', '서울 패션위크', '서울패션위크'] },
];

const ABOUT_MAX = 2;
const MENTIONS_MAX = 6;

function _norm(s) { return String(s || '').toLowerCase().trim(); }

/* 제목 매칭 허용 별칭인가 — 라틴 4자 이상 / 한글 3자 이상, tagOnly 아님 */
function _titleMatchable(entity, alias) {
  if (entity.tagOnly) return false;
  const hangul = /[가-힯]/.test(alias);
  return hangul ? alias.length >= 3 : alias.length >= 4;
}

/**
 * @param {{title?: string, tags?: string[]}} input
 * @returns {{about: object[], mentions: object[]}} schema.org 노드 배열
 */
function matchEntities(input) {
  const title = _norm(input && input.title);
  const tags = ((input && input.tags) || []).map(_norm).filter(Boolean);
  const about = [], mentions = [], seen = new Set();

  for (const e of ENTITIES) {
    if (seen.has(e.name)) continue;
    const inTags = e.aliases.some(a => tags.includes(a));
    const inTitle = e.aliases.some(a => _titleMatchable(e, a) && title.includes(a));
    if (!inTags && !inTitle) continue;
    seen.add(e.name);
    const node = { '@type': e.type, name: e.name, sameAs: e.sameAs };
    if (inTitle && about.length < ABOUT_MAX) about.push(node);
    else if (mentions.length < MENTIONS_MAX) mentions.push(node);
  }
  return { about, mentions };
}

module.exports = { matchEntities, ENTITIES, ABOUT_MAX, MENTIONS_MAX };
