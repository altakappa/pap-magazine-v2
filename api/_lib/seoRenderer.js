/**
 * PAP Magazine — Shared SEO Page Renderer
 *
 * One reusable HTML/schema builder for every server-rendered content type
 * (editorial, article, film, short). Keeping the template here avoids
 * 4×500-line duplicates and makes meta-tag/schema improvements one-edit.
 *
 * Each content endpoint passes a `kind` plus a normalized record and gets
 * back a full <!doctype html> string ready to send.
 */

const SITE = 'https://www.pap-magazine.com';

/* 2단계 상품매칭 — 품목 매핑의 단일 출처는 affiliateUrl.js 다. 여기서는
   "매핑 가능한 품목인가"의 판정에만 쓴다 (칩 표기·?item= 전달 게이트). */
const { ITEM_CATEGORY_PATHS, normalizeItemWord } = require('./affiliateUrl');

/* 카카오 공유 JavaScript 키 (2026-08-07 신설).
   미설정이면 버튼 자체를 안 그린다 — 눌러도 안 되는 버튼을 보여주는 게
   버튼이 없는 것보다 나쁘다. 키는 공개용(JavaScript 키)이라 HTML 에 나가도
   된다. 도메인 화이트리스트가 카카오 콘솔에서 보안을 담당한다. */
const KAKAO_JS_KEY = process.env.KAKAO_JS_KEY || '';

/* 네이버 애널리틱스 (2026-08-07 신설).
   지금까지 **네이버 유입을 측정하는 도구가 하나도 없었다.** 에이치레프스는
   구글만 본다. 한국 매체가 네이버 유입을 모르는 건 눈을 감고 뛰는 것이다. */
const NAVER_ANALYTICS_ID = process.env.NAVER_ANALYTICS_ID || '';

/* 참여 블록을 붙이는 종류. 리스팅·아카이브에는 안 붙인다 — 대상이 하나가
   아니라 목록이라 좋아요/댓글의 대상이 모호해진다. */
const ENGAGE_KINDS = new Set(['article', 'editorial', 'film', 'short']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 참여 블록 문구. 한국 독자가 주 대상이라 ko 를 기본으로 두고, 나머지
   언어는 영어로 떨어뜨린다(번역 파이프라인이 UI 문자열은 안 다룬다). */
const ENGAGE_T = {
  ko: { like: '좋아요', likeAria: '이 글에 좋아요', comments: '댓글', jump: '댓글 보기',
        empty: '첫 댓글을 남겨보세요.', placeholder: '이 기사에 대한 생각을 남겨주세요',
        send: '등록', login: '로그인하고 댓글 남기기', del: '삭제', now: '방금' },
  en: { like: 'Like', likeAria: 'Like this story', comments: 'Comments', jump: 'Jump to comments',
        empty: 'Be the first to comment.', placeholder: 'Share your thoughts on this story',
        send: 'Post', login: 'Sign in to comment', del: 'Delete', now: 'just now' },
};
const SITE_NAME = 'PAP Magazine';
const DEFAULT_OG_IMAGE = 'https://igcazquhkwxtqsaqpznx.supabase.co/storage/v1/object/public/media/uploads/1782883490406_pbkv6ny169.jpg';
const ORG_LOGO = 'https://www.pap-magazine.com/pap-logo.png';

/* QA(2026-07-21) — SSR 이 참조하는 pap-styles.css 캐시버스트 버전.
   ─────────────────────────────────────────────────────────────────
   기사·에디토리얼 상세는 SSR 페이지가 곧 실제 화면이다(SPA 셸이 아니다).
   그런데 여기가 ?v=15 로 하드코딩돼 있었고 프론트 HTML 은 이미 v=39 였다 —
   24개 버전만큼의 CSS 변경이 상세 페이지에만 빠져 있었다는 뜻이다.
   SPA 안에서 기사를 열면 최신 CSS 로 보이다가, 새로고침해서 이 SSR 페이지에
   직접 착지하면 옛 CSS 로 그려져 "레이아웃·폰트가 붕괴된" 것처럼 보였다
   (QA: "새로고침하면 레이아웃과 폰트가 완전히 붕괴").
   프론트 HTML 의 ?v= 와 반드시 같아야 하며, tests/seo-css-version.test.js
   가 두 값이 어긋나면 실패시킨다. pap-styles.css 를 고칠 땐 여기도 같이. */
const PAP_STYLES_VERSION = 43;
/* 같은 이유로 pap-header.js 도 버전이 어긋나 있었다(SSR v=19 vs 프론트 v=23).
   헤더 스크립트가 옛 버전이면 로고 경로·햄버거 동작 같은 수정이 상세 페이지에만
   반영되지 않는다. 위와 동일하게 테스트가 드리프트를 감시한다. */
const PAP_HEADER_VERSION = 29;

/* Instagram SEO — 홈의 Organization(@id) 와 동일 엔티티로 묶고, 모든 SSR
 * 상세 페이지의 publisher 에 sameAs 를 실어 Google 지식그래프가 사이트와
 * @pap_magazine 계열 SNS 를 같은 브랜드로 인식하게 한다. */
const ORG_ID = SITE + '/#organization';
// 2026-07: 공식 계정군 확정 — pap_celeb 핸들 교정, pap_icons 추가,
// pap_korea 제거 (PEPPERIT @pepperitmag 로 전환된 별개 매거진 — 동일 엔티티 아님).
const ORG_SAMEAS = [
  'https://www.instagram.com/pap_magazine/',
  'https://www.instagram.com/pap_celeb/',
  'https://www.instagram.com/papfashion_/',
  'https://www.instagram.com/papbeauty_/',
  'https://www.instagram.com/pap_trends/',
  'https://www.instagram.com/papstudios_/',
  'https://www.instagram.com/pap_object/',
  'https://www.instagram.com/pap_icons/',
  'https://www.facebook.com/papmagazine/',
  'https://www.youtube.com/@pap-magazine',
  'https://www.threads.net/@pap_magazine',
  'https://www.pinterest.com/07667zb6r6qwnjy4kbo8nl6hmxbcaz/',
  // 2026-07-07: 신규 공식 채널 — X 자동 게시 + 네이버 블로그 + 틱톡(공식 핸들 확정).
  'https://x.com/papmagazine_',
  'https://blog.naver.com/pap_magazine',
  'https://www.tiktok.com/@pap_magazine',
  /* 2026-08-27 (GEO) — 위키데이터 엔티티 상호 연결. 항목(Q140578366)은 이미
   * 존재·정비돼 있었는데(창간 2018-01·본사·식별자 5종) 사이트가 가리키지 않아
   * 지식그래프-사이트 양방향 연결이 끊겨 있었다. LLM·구글은 sameAs 의
   * 위키데이터 링크를 엔티티 동일성의 최상위 근거로 쓴다. */
  'https://www.wikidata.org/wiki/Q140578366'
];
// 허브-스포크 퍼널 — 기사 카테고리에 맞는 니치 계정 (메인과 나란히 노출).
// [정규식, 니치 계정, 주제어] — 주제어는 카테고리 맞춤 CTA 문구에 쓰인다.
// 정규식은 하위 카테고리·영문 변형까지 폭넓게 매칭(2026-07-16 참여개선).
const NICHE_IG = [
  [/beaut|cosmetic|makeup|skin|fragrance|hair|nail/i, 'papbeauty_',  '뷰티'],
  [/fashion|runway|street|designer|collection|couture/i, 'papfashion_', '패션'],
  [/news|celeb|music|k-?pop|idol|interview|award/i, 'pap_celeb',   '셀럽·뮤직'],
  [/\bart\b|photograph|exhibit|gallery/i, 'papstudios_', '아트'],
  [/culture|life|trend|film|movie|book/i, 'pap_trends',  '컬처·트렌드'],
];
/* 본문(content) → 평문. record.content 는 세 형태로 온다:
   (a) HTML/평문 문자열 (b) 블록 JSON 문자열 (c) 블록 배열.
   JSON-LD articleBody 와 meta description 두 곳에서 쓰므로 모듈 스코프로 뺐다
   (2026-07-29 — 기존엔 JSON-LD 안에만 있어서 meta 쪽이 본문을 못 썼다). */
function _plainBody(content) {
  let blocks = null;
  if (typeof content === 'string' && content.trim().charAt(0) === '[') {
    try { const p = JSON.parse(content); if (Array.isArray(p)) blocks = p; } catch { blocks = null; }
  } else if (Array.isArray(content)) { blocks = content; }
  let raw = '';
  if (blocks) {
    raw = blocks
      .map(b => !b ? '' : (typeof b === 'string' ? b : String(b.text || b.content || b.caption || '')))
      .join(' ');
  } else if (typeof content === 'string') { raw = content; }
  // <br> 는 문장 경계라 공백으로 — 안 그러면 단어가 붙는다
  return raw.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ─── 2026-08-09 — 번역된 본문에서 요약을 만든다 ──────────────────────
 *
 * ■ 왜 필요한가 (실측)
 *
 * 아티클 번역 16,108행을 세어 보니 이렇다:
 *     제목 있음 16,108 · 본문 있음 16,108 · **설명 있음 0**
 * 아티클 번역 프롬프트가 `{title, body}` 만 요청하기 때문이다(설계상 그렇다).
 * 그런데 아래 descMain 은 `tr.description || descEn` 이라, 아티클은 **항상**
 * 영어(없으면 한국어)로 떨어진다. 라이브 확인:
 *
 *     /ru/article/avavav-ss25-backstage-87
 *       제목  «AVAVAV SS25: бэкстейдж…»            (러시아어 ✓)
 *       본문  «Бэкстейдж показа коллекции…»        (러시아어 ✓)
 *       리드·meta description  "<PAP>가 아바바브 백스테이지 현장을 담아왔다"  ← 한국어 ✗
 *
 * meta description 은 **검색 결과에 뜨는 그 한 줄**이고, 리드 문단은 화면에서
 * 제목 바로 아래 보이는 문장이다. 7개 언어 × 2,300 기사 ≈ 16,000 페이지가
 * 제목·본문은 자기 언어인데 그 두 곳만 남의 언어인 상태였다.
 *
 * ■ 왜 재번역하지 않나
 *
 * **본문은 이미 번역돼 있다.** 요약을 다시 AI 로 만들 이유가 없다 —
 * 번역된 본문의 첫 문장들을 쓰면 된다. API 호출 0, DB 쓰기 0, 렌더 시점 조립.
 * (같은 이유로 만들어진 _enrichMeta 주석 참고 — 이 저장소가 이미 쓰는 방식이다.)
 *
 * ■ 경계 처리
 * · 문장 끝(. ! ? 。 ！ ？ …)에서 끊는다. 없으면 마지막 공백, 그것도 없으면 그냥 자른다.
 * · 너무 짧으면('' 반환) 호출부가 기존 폴백(descEn)을 그대로 탄다 — 나빠지지 않는다.
 * · 태그 제거는 _plainBody 재사용. 엔티티는 화면에 그대로 보이면 안 되니 푼다
 *   (출력할 때 escText 가 다시 이스케이프한다).
 */
const _ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–' };
function _decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&([a-z]+);/gi, (m, name) => {
      const v = _ENTITIES[String(name).toLowerCase()];
      return v === undefined ? m : v;
    });
}
const DESC_FROM_BODY_MAX = 220;   // meta 상한(_enrichMeta 가 다시 다듬는다)
const DESC_FROM_BODY_MIN = 40;    // 이보다 짧으면 요약 구실을 못 한다 → 폴백
function descFromBody(body) {
  const text = _decodeEntities(_plainBody(body)).replace(/\s+/g, ' ').trim();
  if (text.length < DESC_FROM_BODY_MIN) return '';
  if (text.length <= DESC_FROM_BODY_MAX) return text;
  const head = text.slice(0, DESC_FROM_BODY_MAX);
  /* 문장 끝에서 끊는다. 라틴은 '. ' · CJK 는 '。' 로 끝나므로 둘 다 본다. */
  const sentence = Math.max(
    head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '),
    head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('… ')
  );
  if (sentence >= DESC_FROM_BODY_MIN) {
    // 구두점 자체는 남긴다(공백 앞까지). CJK 구두점은 1글자라 +1.
    const end = /[。！？]/.test(head.charAt(sentence)) ? sentence + 1 : sentence + 1;
    return head.slice(0, end).trim();
  }
  /* 문장 끝이 없으면 마지막 공백에서. 붙일 '…' 한 글자만큼 미리 줄여
     결과가 상한을 넘지 않게 한다(상한이 상한이어야 한다). */
  const room = head.slice(0, DESC_FROM_BODY_MAX - 1);
  const space = room.lastIndexOf(' ');
  return (space >= DESC_FROM_BODY_MIN ? room.slice(0, space) : room).trim() + '…';
}

function nicheIg(category) {
  const c = String(category || '');
  for (const [re, acct] of NICHE_IG) if (re.test(c)) return acct;
  return null;
}
// 카테고리별 맞춤 CTA 문구용 — { acct, topic }. 매칭 없으면 null.
function nicheMeta(category) {
  const c = String(category || '');
  for (const [re, acct, topic] of NICHE_IG) if (re.test(c)) return { acct, topic };
  return null;
}

/* ── 반응형 이미지 (2026-07-16) ──────────────────────────────────────
 * vercel.json 의 `images` 설정(avif/webp 변환, sizes 320~1920)은 지금까지
 * SPA 전용이었고 SSR 은 원본 S3/Supabase URL 을 그대로 내보냈다.
 * /_vercel/image 변환 URL 로 srcset 을 깔아 SSR 페이지(구글이 실제로
 * 렌더링·측정하는 대상)의 LCP/전송량을 줄인다.
 * 허용된 remotePatterns 호스트만 변환 — 그 외(유튜브 썸네일 등)는 원본 유지. */
const IMG_OPT_HOSTS = [
  'pap-korea-bucket.s3.ap-northeast-2.amazonaws.com',
  'igcazquhkwxtqsaqpznx.supabase.co',
];
const IMG_OPT_WIDTHS = [320, 960, 1920]; // 2026-08-10 비용 절감 — 생성 3종 (허용 목록은 과도기 5종, pap-img-cdn.js 주석 참조)
function canOptimizeImg(url) {
  try { return IMG_OPT_HOSTS.indexOf(new URL(url).hostname) !== -1; } catch (_) { return false; }
}
function vercelImgUrl(url, w, q) {
  return '/_vercel/image?url=' + encodeURIComponent(url) + '&w=' + w + '&q=' + (q || 75);
}
/* srcset+sizes 속성 문자열 (이스케이프 포함). 최적화 불가 URL 이면 빈 문자열. */
function srcsetAttrs(url, sizes) {
  if (!canOptimizeImg(url)) return '';
  const srcset = IMG_OPT_WIDTHS.map(w => vercelImgUrl(url, w) + ' ' + w + 'w').join(', ');
  return ' srcset="' + escAttr(srcset) + '" sizes="' + escAttr(sizes) + '"';
}

/* 2026-08-17 (GEO) — 기사/에디토리얼 엔티티 그라운딩. 태그·제목에서 확실한
   엔티티만 골라 about/mentions 로 스키마에 싣는다 — 지식그래프 앵커. */
const { matchEntities } = require('./geoEntities');

const ORG_PUBLISHER = {
  // 2026-07-16: 홈(index.html)의 NewsMediaOrganization 과 동일 @id·동일 타입으로
  // 통일 — 같은 엔티티가 페이지마다 다른 @type 이면 지식그래프 신호가 갈라진다.
  '@type': 'NewsMediaOrganization',
  '@id': ORG_ID,
  name: SITE_NAME,
  // 전 검색엔진 브랜드 검색 대응 — PAP MAGAZINE / PAP MAG / PAP / PAP 매거진 / PAP매거진 / 팝매거진.
  alternateName: ['PAP MAGAZINE', 'PAP MAG', 'PAP', 'PAP 매거진', 'PAP매거진', '팝매거진', '팹매거진'],
  // 브랜드 자기소개 한 문장 (2026-07-16 도메니코 확정) — 전 채널 통일 표기.
  // AEO/GEO: 모든 SSR 페이지가 같은 엔티티 서술을 반복해 AI 의 브랜드 인식을 일관화.
  // 2026-08-12 도메니코 정정: "뉴스 매체는 아니고 패션 매거진, 디지털 패션 매거진".
  // 이전 문안(2026-07-16 확정)은 '아트를 중심으로 한'이 주어라 AI 가 PAP 을
  // '아트 서브미션 매거진'으로만 인식했다. 카테고리어(디지털 패션 매거진)를 앞으로
  // 내고 아트 에디토리얼은 정체성으로 뒤에 남긴다 — 둘 다 사실이다.
  description: 'PAP MAGAZINE(팝매거진)은 서울에 기반을 둔 한국의 디지털 패션 매거진입니다. 전 세계 크리에이티브 팀과 함께 만든 오리지널 아트 에디토리얼을 매월 20편 이상 발행하고, 패션위크·컬렉션·셀럽 스타일·뷰티·컬쳐 전반을 다룹니다. 밀라노 데스크를 함께 운영하며 9개 언어로 발행합니다. A Korean digital fashion magazine based in Seoul, with a Milan desk. It publishes 20+ original art-driven fashion editorials every month with creative teams worldwide, alongside daily fashion, beauty and culture coverage.',
  url: SITE,
  logo: { '@type': 'ImageObject', url: ORG_LOGO },
  sameAs: ORG_SAMEAS,
  /* Ⅲ-31 (2026-08-27) — 편집·정정 정책 명문화. 뉴스 신뢰 신호(E-E-A-T):
     정책 페이지가 있어도 스키마로 선언하지 않으면 기계는 모른다. */
  publishingPrinciples: SITE + '/editorial-policy',
  correctionsPolicy: SITE + '/editorial-policy#corrections',

  /* ── AI/GEO 엔티티 보강 (2026-08-12) ───────────────────────────────────
   * 왜: ChatGPT 등에 "디지털 매거진 추천"을 물으면 PAP 이 안 나오고, 나와도
   * "아트 서브미션 기반 에디토리얼 매거진"으로만 인식된다. 원인 중 하나는
   * Organization 엔티티가 name·description·sameAs 만 있고 **무엇을 다루는
   * 매체인지·어디 매체인지·언제부터인지**가 비어 있었다는 것이다.
   * LLM 과 지식그래프는 이 필드들을 그대로 읽는다.
   *
   * 아래는 전부 사실 진술이라 브랜드 카피 결정이 필요 없다. description 문장
   * 자체(2026-07-16 도메니코 확정)는 건드리지 않았다 — 그건 별도 승인 사항. */

  // 어느 나라 매체인가 — "한국 디지털 매거진" 질의에 걸리는 핵심 신호.
  // 창간지는 밀라노(2018-01), 본사는 서울. about.html 의 자기소개·FAQ 와 같은 값이어야 한다.
  // 2026-08-12: foundingDate 를 2019 로 두면 /about 의 "2018년 1월 출범"과 모순되어
  // AI 가 둘 다 신뢰하지 않는다. VOL 1(2019)은 아카이브 시작이지 창간이 아니다.
  foundingLocation: {
    '@type': 'Place',
    address: { '@type': 'PostalAddress', addressLocality: 'Milan', addressCountry: 'IT' }
  },
  location: {
    '@type': 'Place',
    address: { '@type': 'PostalAddress', addressLocality: 'Seoul', addressCountry: 'KR' }
  },
  areaServed: [
    { '@type': 'Country', name: 'South Korea' },
    { '@type': 'Place', name: 'Worldwide' }
  ],
  foundingDate: '2018-01',

  // 무엇을 다루는 매체인가 — AI 가 주제어 목록을 그대로 인용한다.
  // 에디토리얼만이 아니라 뉴스·트렌드도 다룬다는 사실을 명시한다.
  knowsAbout: [
    // 카테고리 호명어 — "디지털 매거진 추천" 류 질의에 걸리는 말들. 맨 앞에 둔다.
    '디지털 매거진', '디지털 패션 매거진', '온라인 패션 매거진', '웹 매거진',
    '한국 패션 매거진', '인스타그램 매거진',
    '패션', '뷰티', '컬쳐', '패션위크', '스트릿 스타일', '셀럽 패션', 'K-팝 스타일',
    '뷰티 트렌드', '한국 패션 브랜드', '팝업스토어', '전시', '패션 필름',
    '패션 에디토리얼', '아트 에디토리얼',
    'Fashion', 'Beauty', 'Culture', 'Fashion Week', 'Street Style',
    'Celebrity Fashion', 'K-pop Fashion', 'Korean Fashion Brands',
    'Fashion Editorial', 'Fashion Film',
    'Digital Magazine', 'Digital Fashion Magazine', 'Online Fashion Magazine',
    'Korean Fashion Magazine', 'Instagram Magazine'
  ],

  /* 발행 언어 (9개) — 다국어 매체임을 엔티티 수준에서 선언.
     2026-08-22: inLanguage → knowsLanguage. inLanguage 는 schema.org 에서
     CreativeWork 속성이고 Organization 에는 없다. Organization 이 다루는
     언어는 knowsLanguage 다. (아래 publisher 건과 같은 원인) */
  knowsLanguage: ['ko', 'en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'],

  publishingPrinciples: SITE + '/about',
  ownershipFundingInfo: SITE + '/about',
  /* 2026-08-17 (GEO) — 신뢰 신호 3종 추가. masthead 는 어바웃(발행인·데스크
     명시), 정정·피드백은 어바웃의 정정 안내 절(#corrections, 같은 커밋에서
     신설)로 건다. 없는 정책을 선언하지 않는다 — 실재 문구가 있는 것만. */
  masthead: SITE + '/about',
  correctionsPolicy: SITE + '/about#corrections',
  actionableFeedbackPolicy: SITE + '/about#corrections',
  /* ── 2026-08-22 — publisher → parentOrganization ───────────────────
     [배경] Ahrefs 감사가 'Structured data has schema.org validation error' 를
     **10,001페이지 전부**에 띄우고 있었다. 개별 페이지를 열면
     jsonld_validation_kinds 가 비어 있어 한동안 실체를 못 찾았는데,
     '전 페이지'라는 숫자가 힌트였다 — 모든 페이지에 실리는 노드는
     이 Organization 블록 하나뿐이다.

     [원인] 이 노드에 그 타입에 없는 속성 두 개가 붙어 있었다.
       · inLanguage — CreativeWork 속성이다. Organization 에는 없다.
       · publisher  — 역시 CreativeWork 속성이다. Organization 에는 없다.
     둘 다 '뜻은 통하지만 타입이 틀린' 경우다. 검증기는 이걸 잡는다.

     [고침] 법인(알타카파)은 PAP 매거진의 **상위 조직**이므로
     parentOrganization 이 정확한 관계다. 언어는 knowsLanguage.
     의미가 더 정확해지고 검증도 통과한다 — 잃는 것이 없다.

     ⚠️ 이건 schema.org 정의를 읽고 내린 판단이다. Google Rich Results Test
     로 한 번 확인하면 확정된다. 다만 두 속성 다 바꾼 쪽이 명백히 옳으므로
     확인 전에 고쳐도 손해가 없다. */
  parentOrganization: {
    '@type': 'Organization',
    name: 'ALTAKAPPA Co., Ltd.',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu',
      addressLocality: 'Seoul',
      addressCountry: 'KR'
    }
  }
};

/* ── escape helpers ─────────────────────────────────── */
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escText(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escJson(obj) {
  return JSON.stringify(obj, (k, v) => v === undefined ? undefined : v).replace(/</g, '\\u003c');
}
function fmtIsoDate(d) {
  if (!d) return new Date().toISOString();
  try { return new Date(d).toISOString(); } catch { return new Date().toISOString(); }
}
// QA(2026-07) #8 — 발행일 표기 통일. 메인홈 카드가 쓰는 "DD Mon YYYY"
// (예: 12 Jul 2026) 형식을 상세 SSR 에서도 동일하게 사용한다(기존엔
// ISO "2026-07-12" 라 홈/목록과 형식이 달랐다). datetime 속성은 ISO 유지.
const _SEO_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDisplayDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return ('0' + dt.getDate()).slice(-2) + ' ' + _SEO_MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
}
// 2026-07-20 QA 표기통일 — 프론트 papTitleCat(pap-utils.js)의 서버측 대응.
// 쉼표 구분 카테고리 각 조각 첫 글자만 대문자 (DB 소문자 저장 — QA #223).
function fmtTitleCat(cat) {
  return String(cat || '').split(',').map(p => {
    p = p.trim();
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : '';
  }).filter(Boolean).join(',');
}
function truncate(s, n) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) return parsed; } catch {}
    return v.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function extractContributors(record) {
  const names = new Set();
  let c = record.credits;
  if (!c) return [];
  try {
    const obj = typeof c === 'string' ? JSON.parse(c) : c;
    if (Array.isArray(obj)) {
      obj.forEach(entry => {
        if (entry && typeof entry === 'object' && entry.name) names.add(String(entry.name));
        else if (typeof entry === 'string') names.add(entry);
      });
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(v => {
        if (Array.isArray(v)) v.forEach(x => x && names.add(String(x.name || x)));
        else if (typeof v === 'string') names.add(v);
      });
    }
  } catch { /* free-form text — ignore */ }
  return Array.from(names).slice(0, 30);
}

/* Ⅱ-18 (확장전략55, 2026-08-27) — Person 엔티티화.
 * 이름 문자열만으로는 "김OO"이 누구인지 기계가 특정 못 한다. credits 의
 * instagram 핸들을 sameAs 로 붙이면 Person 이 실존 프로필과 연결된 엔티티가
 * 되고, 생성 엔진이 "이 화보의 포토그래퍼" 답에 프로필까지 인용할 수 있다.
 * roles 는 jobTitle 로. 이미 공개 게재 중인 크레딧 정보만 쓴다 — 새 정보 없음. */
function extractPersonEntities(record) {
  let c = record.credits;
  if (!c) return [];
  const seen = new Map();
  try {
    const obj = typeof c === 'string' ? JSON.parse(c) : c;
    const arr = Array.isArray(obj) ? obj : [];
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object' || !entry.name) continue;
      const name = String(entry.name).trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const cur = seen.get(key) || { '@type': 'Person', name, _roles: new Set() };
      (Array.isArray(entry.roles) ? entry.roles : []).forEach(r => r && cur._roles.add(String(r)));
      const ig = String(entry.instagram || '').trim().replace(/^@/, '');
      if (ig && !cur.sameAs && /^[A-Za-z0-9._]{1,60}$/.test(ig)) {
        cur.sameAs = ['https://www.instagram.com/' + ig + '/'];
      }
      seen.set(key, cur);
    }
  } catch { return []; }
  return Array.from(seen.values()).slice(0, 30).map(pn => {
    const out = { '@type': 'Person', name: pn.name };
    if (pn._roles.size) out.jobTitle = Array.from(pn._roles).slice(0, 4).join(', ');
    if (pn.sameAs) out.sameAs = pn.sameAs;
    return out;
  });
}

/* ── QA #177 — structured credit helpers ────────────────────────────
 *
 * Parses record.credits into the row shape the editorial overlay
 * renders (`Role @handle1 @handle2`). Mirrors the SPA's buildCreditBlock
 * so a direct visit and an in-app overlay show the same crew list.
 *
 * Input shapes:
 *   new (post QA #168) — [{roles:[…], name, instagram, website}, …]
 *   legacy submission  — {photographer:["Name (@handle)"], …}
 *   bare array of {role, name, instagram}  — pre-roles[] form
 *
 * Output:
 *   [{ role: 'Photographer', handles: ['@handle1', '@handle2'] }, …]
 *   Empty array when nothing usable. */
const IG_ROLE_LABEL = {
  photographer: 'Photographer',
  photographer_assist: 'Assisted by', photo_assist: 'Assisted by', photo_asst: 'Assisted by',
  stylist: 'Style', styling: 'Style',
  styling_assist: 'Style assist', stylist_assist: 'Style assist',
  hair: 'Hair', hairstylist: 'Hair', hair_asst: 'Hair assist',
  makeup: 'Make Up', make_up: 'Make Up', mua: 'Make Up', muah: 'Make Up',
  casting: 'Casting', casting_director: 'Casting',
  set_design: 'Set Design', set_designer: 'Set Design',
  art_director: 'Art Director', creative_director: 'Creative Director',
  producer: 'Producer',
  video: 'Video', videographer: 'Video', director: 'Director',
  starring: 'Starring', model: 'Starring',
};
function normalizeHandle(s) {
  if (!s) return '';
  let h = String(s).trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/$/, '');
  if (!h) return '';
  return h.charAt(0) === '@' ? h : '@' + h;
}
function humanizeRoleKey(raw) {
  const k = String(raw || '').toLowerCase().replace(/[\s.]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (IG_ROLE_LABEL[k]) return IG_ROLE_LABEL[k];
  const s = String(raw || '').trim();
  if (!s) return 'Credit';
  if (/^[a-z0-9_]+$/.test(s)) return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return s;
}
function extractStructuredCredits(record) {
  const c = record.credits;
  if (!c) return [];
  let obj;
  try { obj = typeof c === 'string' ? JSON.parse(c) : c; } catch { return []; }
  if (!obj) return [];
  const rows = []; // {role, handles}
  if (Array.isArray(obj)) {
    obj.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const handle = normalizeHandle(entry.instagram || entry.website || '');
      if (!handle && !entry.name) return;
      // QA #302 — 다중 역할 병합. 'Photo & Art Director' 처럼 모두 표기.
      const _rolesArr = Array.isArray(entry.roles) && entry.roles.length
        ? entry.roles
        : (entry.role ? [entry.role] : ['Credit']);
      const role = _rolesArr
        .map(function (r) { return humanizeRoleKey(r); })
        .filter(Boolean)
        .join(' & ') || humanizeRoleKey(_rolesArr[0]);
      const handles = handle ? [handle] : (entry.name ? [escText(entry.name)] : []);
      rows.push({ role, handles });
    });
  } else if (typeof obj === 'object') {
    Object.keys(obj).forEach((roleKey) => {
      const arr = Array.isArray(obj[roleKey]) ? obj[roleKey] : [obj[roleKey]];
      const role = humanizeRoleKey(roleKey);
      const handles = [];
      arr.forEach((entry) => {
        if (!entry) return;
        if (typeof entry === 'object') {
          const h = normalizeHandle(entry.instagram || entry.website || '');
          if (h) handles.push(h);
          return;
        }
        const m = String(entry).match(/\(([^)]+)\)/);
        if (m) {
          const h = normalizeHandle(m[1]);
          if (h) handles.push(h);
        }
      });
      if (handles.length) rows.push({ role, handles });
    });
  }
  return rows;
}

/* QA #177 — fashion brand chips ("Wearing" section).
 * Input shape: record.fashion = { brands: [{name, instagram}, …] } */
function extractFashionBrands(record) {
  const f = record.fashion;
  if (!f) return [];
  let obj;
  try { obj = typeof f === 'string' ? JSON.parse(f) : f; } catch { return []; }
  const arr = obj && Array.isArray(obj.brands) ? obj.brands : [];
  const seen = new Set();
  const out = [];
  arr.forEach((b) => {
    if (!b) return;
    const handle = normalizeHandle(b.instagram || b.name || '');
    if (!handle) return;
    const key = handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(handle);
  });
  return out;
}

/* 2단계 상품매칭 (2026-08-17) — imageCredits("@ralphlauren Top, ...")에서
 * 브랜드 핸들→품목 단어를 뽑는다. 품목은 affiliateUrl.js 의
 * ITEM_CATEGORY_PATHS 에 있는 것만 인정 (매핑 불가 단어를 칩에 노출하거나
 * ?item= 으로 흘리지 않기 위해 — 노이즈: "other", "total look", 사람 이름 등).
 * hasOwnProperty: 'constructor' 같은 단어가 프로토타입 함수를 매핑으로
 * 오인하지 않게. 같은 브랜드에 품목이 여럿이면 첫 등장을 쓴다. */
function extractBrandItems(record) {
  const f = record.fashion;
  let obj;
  try { obj = typeof f === 'string' ? JSON.parse(f) : f; } catch { return {}; }
  const credits = obj && obj.imageCredits && typeof obj.imageCredits === 'object' && !Array.isArray(obj.imageCredits)
    ? obj.imageCredits : {};
  const out = Object.create(null);
  Object.keys(credits).forEach((k) => {
    String(credits[k] || '').split(',').forEach((part) => {
      const m = part.match(/@([A-Za-z0-9._]+)\s+([A-Za-z-]{2,20})\s*$/);
      if (!m) return;
      const item = normalizeItemWord(m[2]);
      if (!Object.prototype.hasOwnProperty.call(ITEM_CATEGORY_PATHS, item)) return;
      const h = m[1].toLowerCase();
      if (!out[h]) out[h] = item;
    });
  });
  return out;
}

/* QA #177 — per-image credit map { img_1: "@brand Type, @brand2 Type2" }.
 * Returns the matching credit string for the 1-based gallery index, or ''. */
function getImageCredit(record, oneBasedIdx) {
  const f = record.fashion;
  if (!f) return '';
  let obj;
  try { obj = typeof f === 'string' ? JSON.parse(f) : f; } catch { return ''; }
  const map = obj && obj.imageCredits && typeof obj.imageCredits === 'object' ? obj.imageCredits : null;
  if (!map) return '';
  return String(map['img_' + oneBasedIdx] || '').trim();
}

/* ── per-kind config: route prefix, breadcrumb labels, default schema ── */
const KIND = {
  editorial: {
    pathPrefix: '/editorial/',
    breadcrumb: { name: 'Magazine', url: SITE + '/magazine' },
    schemaType: 'Article',
    sectionFallback: 'Editorial'
  },
  article: {
    pathPrefix: '/article/',
    breadcrumb: { name: 'Articles', url: SITE + '/articles' },
    schemaType: 'NewsArticle',
    sectionFallback: 'Article'
  },
  film: {
    pathPrefix: '/film/',
    breadcrumb: { name: 'Films', url: SITE + '/films' },
    schemaType: 'VideoObject',
    sectionFallback: 'Film'
  },
  short: {
    pathPrefix: '/short/',
    breadcrumb: { name: 'Films', url: SITE + '/films' },
    schemaType: 'VideoObject',
    sectionFallback: 'Short'
  }
};

/* ── 다국어 SEO (2026-07-16) ─────────────────────────── */
// 1단계 'en' — DB 원본 필드(title_en/description_en) 사용.
// 2단계 'it'|'fr'|'es' — seo_translations(082) 의 번역을 opts.translation 으로
// 받아 렌더 (에디토리얼만, 번역 없으면 핸들러가 /en/ 으로 302).
// 3단계 'ja' 추가 (2026-07-21) — 서치콘솔 확인 결과 전용 페이지 없이도 일본
// 노출이 it/fr/es 보다 커 최우선 후보. 나머지는 seo_translations 경로 그대로.
const LANG_META = {
  ko: { og: 'ko_KR', inLang: 'ko-KR' },
  en: { og: 'en_US', inLang: 'en-US' },
  it: { og: 'it_IT', inLang: 'it-IT' },
  fr: { og: 'fr_FR', inLang: 'fr-FR' },
  es: { og: 'es_ES', inLang: 'es-ES' },
  ja: { og: 'ja_JP', inLang: 'ja-JP' },
  de: { og: 'de_DE', inLang: 'de-DE' },
  zh: { og: 'zh_CN', inLang: 'zh-CN' },
  ru: { og: 'ru_RU', inLang: 'ru-RU' },
};

/* ── main render function ───────────────────────────── */
// opts.lang: 'ko'(기본)|'en'|'it'|'fr'|'es'
// opts.translation: {title, description, body} — it/fr/es/ja 전용 (body 는 기사 SSR 본문 번역)
// opts.availableLangs: hreflang 으로 선언할 언어 목록 (기본 ['ko','en'])
/* 2026-08-17 — SSR FAQ 블록 제목 (9개 언어). 번역 FAQ 다국어 렌더와 세트. */
const FAQ_HEADING = {
  ko: '자주 묻는 질문', en: 'FAQ', ja: 'よくある質問', fr: 'FAQ',
  es: 'Preguntas frecuentes', it: 'Domande frequenti', de: 'Häufige Fragen',
  zh: '常见问题', ru: 'Частые вопросы',
};

/* 2026-08-27 (확장전략55 Ⅰ-1, 도메니코 확정) — 요약 라벨.
   본문에 TL;DR 문단을 새로 쓰지 않는다: .seo-desc-primary 가 이미 40~60단어급
   요약이다. 빠져 있던 것은 "이것이 요약이다"라는 **명시 라벨**뿐 — 생성 엔진의
   발췌기는 라벨 붙은 요약 블록을 우선 집는다. PAP 문체 규격(본문 소제목·요약형
   금지)은 본문이 아니라 메타 영역이므로 건드리지 않는다. */
const TLDR_LABEL = {
  ko: '한눈에 · TL;DR', en: 'TL;DR', ja: '要約 · TL;DR', fr: 'TL;DR',
  es: 'Resumen · TL;DR', it: 'In breve · TL;DR', de: 'Kurz gefasst · TL;DR',
  zh: '摘要 · TL;DR', ru: 'Кратко · TL;DR',
};

function renderSeoHtml(kind, record, opts) {
  const cfg = KIND[kind] || KIND.editorial;
  const slug = record.slug || record.custom_url || record.id;
  const lang = (opts && LANG_META[opts.lang]) ? opts.lang : 'ko';
  const isEn = lang !== 'ko'; // '비한국어 페이지' 공통 플래그 (기존 분기 재사용)
  const tr = (opts && opts.translation) || null;
  const availableLangs = (opts && Array.isArray(opts.availableLangs) && opts.availableLangs.length)
    ? opts.availableLangs : ['ko', 'en'];

  /* 2026-08-05 — 에디토리얼 번역본 noindex 를 **같은 날 철회했다**.
   * 색인 정책은 원상복구(index, follow). 아래는 왜 붙였다 뗐는지의 기록이다.
   *
   * 붙였던 근거: GSC 7/1~8/4 에서 에디토리얼 번역본 클릭이 0 이었고,
   * 무관한 한국어 쿼리('찰스엔터 얼굴 여백' 등)에 매칭되는 게 관측됐다.
   *
   * 철회한 이유 — 그 데이터로는 판정할 수 없었다:
   *   1) 번역 데이터가 너무 어리다. seo_translations 실측으로 에디토리얼
   *      번역의 최초 생성이 2026-07-16, 30일 넘은 행이 **0건**이다.
   *      색인·랭킹이 붙기 전에 '클릭 0' 을 결론으로 쓴 셈이다.
   *   2) 대부분 기간 사이트맵에 없었다. sitemap-editorials.js 의 5,000행
   *      상한 버그(f74cf1c, 2026-08-04)로 약 11,200쪽이 검색엔진에 아예
   *      알려지지 않았다. 즉 측정 창의 마지막 하루만 유효했다.
   *   3) 비교 대상을 잘못 골랐다. 원본(한국어) 에디토리얼도 같은 증상을
   *      **더 크게** 보인다 — /editorial/dark-girl 355노출 0클릭('ekzmrjf'),
   *      /editorial/asdfghjkl 315노출 0클릭('연준 인스티즈'). 번역본
   *      /fr/editorial/dark-girl 은 37노출이다. 원본이 같은 문제를 겪는데
   *      번역본만 색인에서 빼는 건 원인 진단이 아니라 증상 회피다.
   *
   * 남은 진짜 질문(미해결): 에디토리얼이 검색 채널이긴 한가.
   * 5주간 전 언어·원본 포함 약 26클릭이고, 같은 기간 아티클은 2,200+ 이다.
   * 한 단어 슬러그(suit, lily, run, tar)가 엉뚱한 질의에 걸리는 것으로
   * 보이며, 이는 번역의 결함이 아니라 에디토리얼 페이지 전반의 성질이다.
   * → 다음 판정은 사이트맵이 고쳐진 상태로 6~8주 재측정한 뒤에 한다.
   *
   * 같은 날 만든 것 중 **90일 컷과 6,000자 상한은 유지한다** — 그 둘은
   * 원문 기사 클릭의 나이 분포(1년 초과 0.0%)와 zh 성공 사례 길이 분포
   * (최대 2,293자)라는 단단한 실측 위에 서 있다.
   *
   * 다시 붙이려면: kind==='editorial' && lang!=='ko' && lang!=='en' 조건을
   * 되살려 robots/googlebot 을 'noindex, follow' 로 바꾸고, hreflang 에서도
   * 같은 언어를 빼면 된다(색인 불가 URL 을 대안으로 선언하면 신호가 모순).
   * 근거 문서: 볼트 45_Business/PAP_SEO_가이드라인_2026-08-05.md */

  /* QA #308 — Film credit inheritance from a linked editorial.
   *
   * When a film is registered by linking an existing editorial (QA #229)
   * we don't re-type the crew list on the film row. In that case the film
   * has an empty `credits` array. If a related editorial IS linked and IT
   * carries the credits, mirror them onto the record so both the SSR
   * <section class="seo-credits"> block AND the Article-schema author list
   * pick them up without any per-caller changes. Only kicks in for the
   * 'film' kind — editorial/article/short don't inherit. */
  if (kind === 'film'
      && (!record.credits
          || (Array.isArray(record.credits) && record.credits.length === 0))
      && record.related_editorial
      && Array.isArray(record.related_editorial.credits)
      && record.related_editorial.credits.length){
    record = Object.assign({}, record, {
      credits: record.related_editorial.credits
    });
  }

  const titleKo = record.title || SITE_NAME;
  const titleEn = record.title_en || titleKo;
  // 필름 설명 보강 (2026-07-18, 지우/다인) — 필름은 본문 텍스트가 없어 검색엔진이
  // '내용 부족'으로 색인을 낮춘다. 실 설명이 없을 때만 보유한 사실 데이터
  // (제목·연계 에디토리얼·크레딧)로 사실 기반 디스크립터를 생성한다(허구 서술 금지).
  let _filmDescKo = null, _filmDescEn = null;
  if (kind === 'film' && !(record.seo_description || record.description || record.subtitle)) {
    const _relT = (record.related_editorial && record.related_editorial.title) ? String(record.related_editorial.title) : '';
    const _credArr = Array.isArray(record.credits) ? record.credits : [];
    const _credLine = _credArr
      .map(c => typeof c === 'string' ? c : (c && (c.value || c.name) ? String(c.value || c.name) : ''))
      .filter(Boolean).slice(0, 6).join(', ');
    _filmDescKo = `《${titleKo}》는 PAP 매거진이 선보이는 패션 필름입니다.`
      + (_relT ? ` 에디토리얼 〈${_relT}〉와 함께 제작됐습니다.` : '')
      + (_credLine ? ` 크레딧: ${_credLine}.` : '')
      + ` 서울·밀라노 기반 아트 중심 패션·뷰티·컬처 매거진 PAP.`;
    _filmDescEn = `"${titleEn}" is a fashion film by PAP Magazine`
      + (_relT ? `, created alongside the editorial "${_relT}"` : '')
      + '.'
      + (_credLine ? ` Credits: ${_credLine}.` : '')
      + ` Art-driven fashion, beauty and culture from Seoul & Milan.`;
  }
  const descKo = record.seo_description || record.description || record.subtitle || _filmDescKo || `${titleKo} — ${SITE_NAME}`;
  const descEn = record.description_en || _filmDescEn || descKo;
  // 언어 우선 표기 (본문 h1·리드·스키마 공용) — it/fr/es 는 번역본, 없으면 EN 폴백
  const titleMain = lang === 'ko' ? titleKo : (lang === 'en' ? titleEn : ((tr && tr.title) || titleEn));
  const titleAlt = lang === 'ko' ? titleEn : titleKo;
  /* 번역본에 설명이 없으면 **번역된 본문**에서 만든다 (2026-08-09).
     아티클 번역은 설명을 아예 안 받아오므로(위 descFromBody 주석의 실측),
     이게 없으면 meta description 과 리드 문단이 영어·한국어로 나간다.
     에디토리얼은 tr.description 이 있어 이 경로를 타지 않는다. */
  const _trDesc = (tr && tr.description) || (tr && tr.body ? descFromBody(tr.body) : '');
  /* ── 영어판도 같은 처지였다 (2026-08-09 실측) ──────────────────────
   * `articles` 테이블에는 description·description_en 컬럼이 **아예 없다**
   * (있는 건 subtitle·content·content_en). 그래서
   *     descKo = … || subtitle || '제목 — PAP Magazine'
   *     descEn = record.description_en(없음) || … || descKo
   * 즉 **영어 기사 페이지의 meta 가 항상 한국어(또는 제목 에코)** 였다.
   * 실측: 발행 2,303건 전부 content_en 이 있고, subtitle 은 302건뿐인데
   * 그 302건이 **전부 한국어**다. 영어 본문이 멀쩡히 있는데 검색 설명만
   * 한국어로 나가고 있었다.
   *
   * 여기서도 재작성하지 않는다 — content_en 에서 만든다.
   * ⚠️ descEn 자체는 건드리지 않는다. descEn 은 한국어 페이지의 '보조 문단
   * (descAlt)' 에도 쓰여서, 바꾸면 한국어 기사에 영어 문단이 새로 붙는다.
   * 영어판이 자기 설명으로 쓸 때만 적용한다. */
  const _enDesc = descFromBody(record.content_en) || descEn;
  const descMain = lang === 'ko' ? descKo : (lang === 'en' ? _enDesc : (_trDesc || descEn));
  const descAlt = lang === 'ko' ? descEn : (lang === 'en' ? descKo : descEn);
  /* 2026-07-22 (SPA 룩 통일) — 일부 요약(desc)이 "제목 — PAP Magazine" 줄로 시작해
     화면에서 h1 바로 아래 제목이 한 번 더 보였다(백필 산출물). SPA 에는 이 줄이 없다.
     '정확히 그 형태로 시작할 때만' 화면 표시에서 잘라낸다 — meta description(desc)과
     JSON-LD 는 descMain 원본을 그대로 쓰므로 SEO 에는 영향 없음. */
  const _stripTitleEcho = (s) => {
    if (!s) return s;
    for (const t of [titleKo, titleMain]) {
      if (!t) continue;
      const echo = `${t} — ${SITE_NAME}`;
      if (s.startsWith(echo)) return s.slice(echo.length).replace(/^[\s\n]+/, '');
    }
    return s;
  };
  /* 2026-07-29 — 본문 문단은 seo_description 이 아니라 description 을 우선한다.
     seo_description 은 <meta> 전용으로 155자에서 잘린 값이라(backfill-meta-desc 가
     그렇게 저장한다), 위의 descKo 우선순위를 그대로 쓰면 새로 채운 300자+ 서술이
     화면에서 "…" 로 잘려 보인다(라이브 실측 the-modern-muse — 한국어만 155자에서
     끊기고 영어는 전문 노출). meta·JSON-LD 는 기존 descMain 을 그대로 쓰므로
     설명문 길이 정책은 건드리지 않는다. */
  const bodyKo = record.description || record.seo_description || record.subtitle || _filmDescKo || descKo;
  const bodyEn = record.description_en || _filmDescEn || bodyKo;
  /* 화면 리드 문단도 같은 폴백을 쓴다 — 라이브에서 러시아어 기사의 리드가
     한국어로 나가고 있었다(제목·본문은 러시아어). meta 만 고치면 화면은
     그대로 남는다. */
  const bodyMain = lang === 'ko' ? bodyKo : (lang === 'en' ? _enDesc : (_trDesc || bodyEn));
  const bodyAlt = lang === 'ko' ? bodyEn : (lang === 'en' ? bodyKo : bodyEn);
  const descDisplay = _stripTitleEcho(bodyMain);
  const descAltDisplay = _stripTitleEcho(bodyAlt);
  /* 2026-07-27 (Ahrefs 7/26 크롤 — Title too long 1,398건): 제목이 길면
     " | PAP Magazine" 브랜드 접미사가 60자 한계(≈600px)를 넘긴다. 접미사를
     포함해 60자 이내일 때만 붙이고, 넘치면 제목만 남긴다(제목 자체는 자르지
     않음 — 헤드라인 훼손 금지). record.seo_title(수동 지정)은 그대로 존중. */
  /* 2026-08-22 — 브랜드 접미사도 언어별 상한을 따른다. ja(40)·zh(32) 는
     60 보다 좁은데 접미사가 14자라, 60 기준만 보면 자른 제목에 접미사를 붙여
     다시 상한을 넘겼다(실측: ja 잘라서 27자 → 접미사 붙여 42자). */
  const _brand = (t, lg) => {
    const cap = (lg && TITLE_SOFT[lg]) || 60;
    const withBrand = `${t} | ${SITE_NAME}`;
    return withBrand.length <= cap ? withBrand : t;
  };
  const TITLE_SOFT = { ja: 40, zh: 32, ru: 58 };
  /* ── 되돌림: <title> 을 자르지 않는다 (2026-08-22, 도메니코 결정) ─────
     [무엇을 했었나] 2026-08-21, 번역 제목을 60자(ja 40·zh 32·ru 58)에서
     단어 경계로 자르고 '…' 를 붙였다. 근거는 8월 fr·it·es·de·ru 974쪽 실측:
       상한 이내 903쪽 CTR 1.74% · 상한 초과 71쪽 CTR 1.17% (순위는 9.4 vs 9.6)
     기대 클릭 112 대비 실제 75, 3.5σ. 그래서 "길이가 CTR 을 죽인다"고 봤다.

     [무엇이 틀렸나] 그건 상관이지 인과가 아니었다. 긴 제목은 기계 번역이
     부풀린 제목이기도 해서, 길이가 아니라 번역 품질이 CTR 을 낮췄을 수 있다.
     그리고 자르기는 실제 손해를 냈다 —

       쿼리 `quando esce animal delle katseye` (it) — 우리 순위 **1.24위**
       제목: "KATSEYE annuncia una trasformazione audace con il singolo…"
       → 검색어의 핵심 단어 **'ANIMAL' 이 잘려 나갔다.**
       노출 258 · 클릭 6 · CTR 2.33%. 1위에서 2.33% 는 정상이 아니다.

     규모: 상한 초과 제목 7,590편 (fr 1,388·de 1,346·es 1,347·ru 1,302·
     it 1,284·ja 462·zh 461). 유럽어 5개는 절반 이상이 잘린 채 노출됐다.

     [왜 되돌리나] 자르기의 목적은 Ahrefs 감사의 "Title too long" 경고를
     없애는 것이었다. 그건 구글 순위 요인이 아니다 — 구글은 긴 제목을
     **표시할 때만** 줄이고, 태그 전체를 관련성 신호로 읽는다. 태그에서
     단어를 지우면 표시에서도 신호에서도 함께 사라진다.
     검증 가능한 이득이 없는 감사 숫자를 위해 실제 키워드를 버린 셈이다.

     [지금 방식] 제목은 그대로 내보낸다. 표시 길이는 구글이 정한다.
     브랜드 접미사(_brand)만 언어별 상한 안에서 붙인다 — 그건 우리가 덧붙이는
     군더더기라 넘치면 빼는 게 맞다.
     극단적으로 긴 번역(최장 133자)의 진짜 해법은 렌더 시점 자르기가 아니라
     번역 생성기 쪽 상한이고, 그건 2026-08-20 에 이미 들어가 있다(신규분 한정). */
  const seoTitle = lang === 'ko'
    ? (record.seo_title || (kind === 'film' ? _brand(`${titleKo} 패션 필름`, 'ko') : _brand(titleKo, 'ko')))
    : (kind === 'film'
        ? _brand(`${titleMain} — Fashion Film`, lang)
        : _brand(titleMain, lang));
  /* 2026-07-23 (Ahrefs 감사 — meta description too short 3,261건) — 온페이지
     표시(descDisplay)는 그대로 두고, <meta name="description"> 만 짧을 때
     실제 맥락(등장 패션 브랜드·카테고리)으로 보강한다. AI·크론·DB 쓰기 없이
     렌더 시점 조립이라 다음 크롤에 전편 일괄 개선되고 Vercel 부하도 0.
     브랜드명은 검색어라 SEO 실익이 크고, 없으면 매체 소개로 폴백한다. */
  /* 2026-08-23 (도메니코: "우리는 영문 디지털 매거진으로 불리면 안돼") —
     ChatGPT 가 PAP 를 "서울·밀라노 기반의 영문 디지털 매거진"으로 소개했다.
     원인: 영어 페이지의 자기소개 문구가 언어 정체성 없이 "based in Seoul and
     Milan"만 말해서, 생성 엔진이 '영어로 쓰인 매거진'으로 추론했다.
     그래서 전 페이지 영문 폴백 설명에 **Korean** 을 명시한다 — 한국 매거진이
     9개 언어로 발행되는 것이지, 영문 매거진이 아니다. llms.txt 의 설명 지침과
     같은 말을 해야 한다(소스가 갈라지면 엔진이 아무거나 집는다). */
  function _enrichMeta(base) {
    const isKo = lang === 'ko';
    // 제목 에코("제목 — PAP Magazine") 폴백은 실질 설명이 아니므로 비운다
    // — 안 그러면 아래 매체 서명과 제목이 두 번 겹친다(HIJA…HIJA).
    let s = String(base || '').trim();
    for (const t of [titleKo, titleMain, titleEn]) {
      if (t && s === `${t} — ${SITE_NAME}`) { s = ''; break; }
    }
    if (s.length >= 110) return s;               // 이미 충분히 길면 그대로
    /* 2026-07-29 (GSC 실측) — 본문 첫 문장을 태그 나열보다 먼저 쓴다.
       설명이 비어 있으면 parts 가 태그부터 시작해 스니펫이
       "waterbomb · waterbomb seoul 2026 · music festival. 제목 — PAP MAGAZINE 뉴스…"
       처럼 키워드 나열로 나왔다(라이브 실측, 워터밤 기사). 정작 그 기사 본문
       첫 문장은 "올여름 가장 뜨거운 음악 축제가 돌아온다…" 로 훨씬 낫다.
       GSC 7월 — 노출 27,646(4월 대비 46배)인데 클릭은 826 로 오히려 감소,
       CTR 12.6%→3.0%. 스니펫 품질이 유력 원인이라 본문을 우선 쓰게 한다.
       EN 페이지에 한국어 본문을 넣지 않도록 언어별 소스를 고른다. */
    if (!s) {
      const srcBody = isKo ? record.content : (record.content_en || null);
      const bt = _plainBody(srcBody);
      if (bt.length >= 40) {
        // 문장 경계에서 끊는다(마침표·물음표·느낌표). 없으면 그대로 자른다.
        const cut = bt.slice(0, 200);
        const m = cut.match(/^[\s\S]*?[.!?。？！](?=\s|$)/);
        s = ((m && m[0].length >= 60) ? m[0] : cut).trim();
      }
    }
    const parts = s ? [s] : [];
    // 등장 브랜드 (record.fashion.brands[].name) — 최대 6개
    let brands = [];
    try {
      const f = record.fashion;
      const arr = f && Array.isArray(f.brands) ? f.brands : [];
      brands = arr.map(b => (b && b.name ? String(b.name).trim() : '')).filter(Boolean).slice(0, 6);
    } catch (_) {}
    if (brands.length) parts.push((isKo ? '패션: ' : 'Fashion: ') + brands.join(', ') + '.');
    // 카테고리/태그 (해시태그·중복 제외, 최대 3개)
    let tags = [];
    try {
      tags = asArray(record.tags).map(t => String(t || '').replace(/^#/, '').trim())
        .filter(t => t && !/^\d+$/.test(t) && !/^pap:/i.test(t)).slice(0, 3);
    } catch (_) {}
    if (tags.length && parts.join(' ').length < 130) parts.push(tags.join(' · ') + '.');
    // 여전히 짧으면 제목(유니크) + 매체 소개 서명으로 110자 이상 확보.
    // 제목이 앞에 오므로 페이지마다 고유 — 중복 meta 로 잡히지 않는다.
    if (parts.join(' ').length < 110) {
      /* 2026-08-28 (네이버 브랜드 검색 실측): 한국어 서명의 브랜드 표기를
         "PAP MAGAZINE" → "PAP 매거진(팝매거진)" 으로 바꾼다. 근거 —
         네이버 웹문서 '팝매거진' 상위 15건 중 14건이 sbskpop.kr('스브스케이팝매거진',
         "케이팝매거진"의 부분문자열)이고 우리는 홈 1건(7위)뿐이었다. 홈·about 등
         약 20개 정적 페이지에만 '팝매거진' 문자열이 있었고, SSR 기사·화보 수천 개에는
         없었다. 이 서명은 desc 155자 컷보다 앞에 오므로 잘리지 않는다.
         타이틀은 건드리지 않는다(브랜드 접미사 60자 한계 · 기존 스니펫 규격 유지).
         ※ 검색량 자체는 미미하다(데이터랩: '팝매거진' 표시 하한 미만) — 이 조치는
           브랜드 별칭 방어용이지 트래픽 견인책이 아니다. 기록: 볼트
           45_Business/PAP_GEO_수동리그레션_2026-08-28.md */
      // kind 별 정확한 서명 — 아티클(뉴스)에 "패션 에디토리얼"을 붙이면 부정확.
      if (kind === 'article') {
        parts.push(isKo
          ? `${titleKo} — PAP 매거진(팝매거진) 뉴스. 서울과 밀라노 기반 아트 중심 패션·뷰티·컬처 매거진 PAP이 전하는 패션·셀럽·컬처 소식입니다.`
          : `${titleMain} — news from PAP Magazine, the Korean art-driven fashion, beauty and culture magazine published from Seoul, with a Milan desk.`);
      } else if (kind === 'film') {
        parts.push(isKo
          ? `${titleKo} — PAP 매거진(팝매거진) 패션 필름. 서울과 밀라노 기반 아트 중심 매거진 PAP이 전 세계 크리에이티브 팀과 만든 영상입니다.`
          : `${titleMain} — a fashion film by PAP Magazine, the Korean art-driven fashion, beauty and culture magazine published from Seoul, with a Milan desk.`);
      } else {
        parts.push(isKo
          ? `${titleKo} — PAP 매거진(팝매거진) 독점 패션 에디토리얼. 서울과 밀라노를 기반으로 활동하는 아트 중심 매거진 PAP이 전 세계 포토그래퍼·스타일리스트와 함께 선보이는 패션·뷰티·컬처 화보와 크리에이티브 스토리를 만나보세요.`
          : `${titleMain} — an exclusive fashion editorial by PAP Magazine, the Korean art-driven fashion, beauty and culture magazine published from Seoul with a Milan desk, created with photographers and stylists worldwide.`);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  /* 2026-07-27 (Ahrefs 7/26 크롤 — Meta description too long 4,544건):
     Ahrefs·구글 스니펫 한계는 ~160자. 기존 175자 컷이 보강분을 전부
     161~175자 구간에 앉혀 경고를 양산했다. 155자로 낮춘다(110자 최소
     보강 목표와 양립 — 110~155 구간이 정상 범위). */
  const desc = truncate(_enrichMeta(descMain), 155);

  /* 2026-08-05 (GSC '중복 페이지 — Google에서 사용자와 다른 표준을 선택함' 41건):
     JSON-LD description 이 descMain 원본을 그대로 써서, description/description_en
     이 비어 있는 기사에선 436행 폴백("한국어제목 — PAP Magazine")이 en/it/es 등
     모든 언어판 스키마에 똑같이 박혔다. <meta name=description> 은 _enrichMeta 가
     그 에코를 비우고 언어별로 재조립하므로 영어인데 스키마만 한국어 → 구글이
     /en/article/* 를 /article/* 의 중복으로 보고 한국어판을 표준으로 선택.
     스키마도 meta 와 같은 보강값을 쓰게 한다(길이 컷은 meta 전용이라 미적용). */
  const schemaDesc = _enrichMeta(descMain);

  /* Cover image: per-kind preferred fields */
  const ogImage = record.og_image
    || record.cover_image
    || record.hero_image_url
    || record.thumbnail_url
    || record.thumbnail
    || (record.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_id)
        ? `https://img.youtube.com/vi/${record.youtube_id}/maxresdefault.jpg`
        : null)
    || DEFAULT_OG_IMAGE;

  const koCanonical = `${SITE}${cfg.pathPrefix}${encodeURIComponent(slug)}`;
  const langUrl = (l) => l === 'ko' ? koCanonical : `${SITE}/${l}${cfg.pathPrefix}${encodeURIComponent(slug)}`;
  const canonical = langUrl(lang);
  /* 카카오로 퍼진 링크는 utm 을 달고 돌아와야 집계된다 (2026-08-07).
     canonical 자체에는 절대 붙이지 않는다 — 정본 URL 이 오염되면 색인이 갈린다.
     공유 링크만 별도로 만든다. */
  const kakaoShareUrl = canonical + (canonical.indexOf('?') >= 0 ? '&' : '?')
    + 'utm_source=kakao&utm_medium=share';
  // hreflang: 실재하는 언어 변형만 선언 (ko/en 은 항상, it/fr/es 는 번역 존재 시)
  const hreflangLinks = availableLangs
    .filter(l => LANG_META[l])
    .map(l => `<link rel="alternate" hreflang="${l}" href="${escAttr(langUrl(l))}">`)
    .concat([`<link rel="alternate" hreflang="x-default" href="${escAttr(koCanonical)}">`])
    .join('\n');

  /* 갤러리 잠금 패널 카피 — 9개 언어 (2026-08-27 도메니코 결정).
     전체 이미지는 스탠다드부터. 그 아래 등급에는 앞 2장만 나간다. */
  const GALLERY_LOCK_T = {
    ko: {
      count: (t, h) => `총 ${t}장 중 ${h}장이 더 있습니다`,
      headFree: '가입하면 전체 이미지를 볼 수 있습니다',
      subFree: '최신 에디토리얼 10편은 회원이면 무료입니다.',
      ctaFree: '가입하고 보기',
      headStandard: 'STANDARD 멤버부터 전체 이미지를 볼 수 있습니다',
      headPremium: 'PREMIUM 멤버부터 전체 이미지를 볼 수 있습니다',
      subStandard: '최신 화보의 모든 컷과 이미지 다운로드가 열립니다.',
      subPremium: '2019년부터의 전체 아카이브가 모든 컷과 함께 열립니다.',
      cta: '멤버십 보기',
    },
    en: {
      count: (t, h) => `${h} more of ${t} images`,
      headFree: 'Sign up to see every image',
      subFree: 'The 10 most recent editorials are free for members.',
      ctaFree: 'Sign up',
      headStandard: 'Standard members see the full set',
      headPremium: 'Premium members see the full set',
      subStandard: 'Every frame of recent editorials, plus image downloads.',
      subPremium: 'The full archive since 2019, every frame included.',
      cta: 'See membership',
    },
    it: {
      count: (t, h) => `Altre ${h} immagini su ${t}`,
      headFree: 'Iscriviti per vedere tutte le immagini',
      subFree: 'Gli ultimi 10 editoriali sono gratuiti per i membri.',
      ctaFree: 'Iscriviti',
      headStandard: 'I membri Standard vedono il servizio completo',
      headPremium: 'I membri Premium vedono il servizio completo',
      subStandard: 'Tutti gli scatti degli editoriali recenti, download inclusi.',
      subPremium: "L'archivio completo dal 2019, scatto per scatto.",
      cta: 'Scopri gli abbonamenti',
    },
    fr: {
      count: (t, h) => `${h} images de plus sur ${t}`,
      headFree: 'Inscrivez-vous pour voir toutes les images',
      subFree: 'Les 10 derniers éditoriaux sont gratuits pour les membres.',
      ctaFree: 'S\'inscrire',
      headStandard: 'Les membres Standard voient la série complète',
      headPremium: 'Les membres Premium voient la série complète',
      subStandard: 'Toutes les images des éditoriaux récents, téléchargements inclus.',
      subPremium: "L'archive complète depuis 2019, image par image.",
      cta: 'Voir les abonnements',
    },
    es: {
      count: (t, h) => `${h} imágenes más de ${t}`,
      headFree: 'Regístrate para ver todas las imágenes',
      subFree: 'Los 10 editoriales más recientes son gratis para los miembros.',
      ctaFree: 'Registrarse',
      headStandard: 'Los miembros Standard ven la serie completa',
      headPremium: 'Los miembros Premium ven la serie completa',
      subStandard: 'Todas las tomas de los editoriales recientes, con descargas.',
      subPremium: 'El archivo completo desde 2019, toma por toma.',
      cta: 'Ver membresías',
    },
    ja: {
      count: (t, h) => `全${t}枚のうち、あと${h}枚`,
      headFree: '会員登録で全カットをご覧いただけます',
      subFree: '最新エディトリアル10本は会員なら無料です。',
      ctaFree: '登録して見る',
      headStandard: 'STANDARD 会員から全カットをご覧いただけます',
      headPremium: 'PREMIUM 会員から全カットをご覧いただけます',
      subStandard: '最新エディトリアルの全カットと画像ダウンロードが開きます。',
      subPremium: '2019年からの全アーカイブが、全カットとともに開きます。',
      cta: 'メンバーシップを見る',
    },
    zh: {
      count: (t, h) => `共 ${t} 张,还有 ${h} 张`,
      headFree: '注册后即可查看全部图片',
      subFree: '最新 10 篇大片对会员免费。',
      ctaFree: '注册查看',
      headStandard: 'STANDARD 会员可查看全部图片',
      headPremium: 'PREMIUM 会员可查看全部图片',
      subStandard: '最新大片的全部照片,并可下载图片。',
      subPremium: '2019 年至今的完整档案,一张不少。',
      cta: '查看会员方案',
    },
    de: {
      count: (t, h) => `${h} weitere von ${t} Bildern`,
      headFree: 'Registriere dich, um alle Bilder zu sehen',
      subFree: 'Die 10 neuesten Editorials sind für Mitglieder kostenlos.',
      ctaFree: 'Registrieren',
      headStandard: 'Standard-Mitglieder sehen die komplette Strecke',
      headPremium: 'Premium-Mitglieder sehen die komplette Strecke',
      subStandard: 'Alle Aufnahmen aktueller Editorials, inklusive Downloads.',
      subPremium: 'Das komplette Archiv seit 2019, jede Aufnahme.',
      cta: 'Mitgliedschaft ansehen',
    },
    ru: {
      count: (t, h) => `Ещё ${h} из ${t} снимков`,
      headFree: 'Зарегистрируйтесь, чтобы увидеть все снимки',
      subFree: '10 свежих эдиториалов бесплатны для участников.',
      ctaFree: 'Зарегистрироваться',
      headStandard: 'Участники Standard видят серию целиком',
      headPremium: 'Участники Premium видят серию целиком',
      subStandard: 'Все кадры свежих эдиториалов и скачивание изображений.',
      subPremium: 'Полный архив с 2019 года, каждый кадр.',
      cta: 'Смотреть подписку',
    },
  };

  /* IG 퍼널 CTA 카피 — 언어별. 유입자가 인스타로 넘어가는 마지막 관문까지 해당 언어로. */
  const FUNNEL_T = {
    ko: {
      srcCopy: 'PAP의 화보와 필름, 패션·셀럽 소식을<br><b>인스타그램</b>에서 편하게 만나보세요.',
      srcBtn: '인스타그램에서 보기 ↗',
      niche: (nm) => `${nm.topic} 소식은 <b>@${nm.acct}</b>에서,<br>PAP의 화보와 매거진 전체는 <b>@pap_magazine</b>에서 편하게 보실 수 있습니다.`,
      main: 'PAP의 화보와 필름, 패션·셀럽 소식을<br><b>인스타그램</b>에서 편하게 만나보세요.',
      topPost: '인스타그램에서 기사 확인하기',
      // 화보는 '기사'가 아니다. 같은 자리에 다른 말이 나가야 한다 (도메니코 2026-08-27)
      topPostEditorial: '인스타그램에서 에디토리얼 확인하기',
      topProfile: 'PAP 인스타그램 팔로우',
      pin: 'Pinterest에 저장',
      sub: '전 세계 크리에이티브 팀과 만드는 월 20+ 에디토리얼 · <a href="' + SITE + '/network" style="color:inherit">PAP 인스타그램 네트워크 →</a>',
    },
    en: {
      srcCopy: 'Editorials, films, fashion and celebrity news —<br>all in one place on <b>Instagram</b>.',
      srcBtn: 'View on Instagram ↗',
      niche: (nm) => `More ${nm.topic} on <b>@${nm.acct}</b>,<br>and the full magazine on <b>@pap_magazine</b>.`,
      main: 'Editorials, films, fashion and celebrity news —<br>all in one place on <b>Instagram</b>.',
      topPost: 'See the original post on Instagram',
      topProfile: 'Follow PAP on Instagram',
      pin: 'Save to Pinterest',
      sub: '20+ editorials a month with creative teams worldwide · <a href="' + SITE + '/network" style="color:inherit">PAP Instagram network →</a>',
    },
    it: {
      srcCopy: 'Il post originale è su <b>Instagram</b>.<br>Metti like e salvalo — e scopri lì per primo i nuovi editoriali, ogni giorno.',
      srcBtn: 'Guarda su Instagram ↗',
      niche: (nm) => `Ti è piaciuta questa storia <b>${nm.topic}</b>? —<br>Altro ${nm.topic} su <b>@${nm.acct}</b>, e i nuovi editoriali prima di tutti su <b>@pap_magazine</b>, ogni giorno.`,
      main: 'Editoriali quotidiani, moda e celebrity news —<br>scoprili <b>prima su Instagram</b>.',
      topPost: 'Guarda il post originale su Instagram',
      topProfile: 'Segui PAP su Instagram',
      pin: 'Salva su Pinterest',
      sub: '20+ editoriali al mese con team creativi da tutto il mondo · <a href="' + SITE + '/network" style="color:inherit">Il network Instagram di PAP →</a>',
    },
    fr: {
      srcCopy: 'Le post original est sur <b>Instagram</b>.<br>Likez-le, enregistrez-le — et découvrez-y les nouveaux éditoriaux en premier, chaque jour.',
      srcBtn: 'Voir sur Instagram ↗',
      niche: (nm) => `Cette histoire <b>${nm.topic}</b> vous a plu ? —<br>Plus de ${nm.topic} sur <b>@${nm.acct}</b>, et les nouveaux éditoriaux en avant-première sur <b>@pap_magazine</b>, chaque jour.`,
      main: 'Éditoriaux quotidiens, mode et actus célébrités —<br>découvrez-les <b>d’abord sur Instagram</b>.',
      topPost: 'Voir le post original sur Instagram',
      topProfile: 'Suivre PAP sur Instagram',
      pin: 'Enregistrer sur Pinterest',
      sub: '20+ éditoriaux par mois avec des équipes créatives du monde entier · <a href="' + SITE + '/network" style="color:inherit">Le réseau Instagram de PAP →</a>',
    },
    es: {
      srcCopy: 'La publicación original está en <b>Instagram</b>.<br>Dale like y guárdala — y descubre allí los nuevos editoriales primero, cada día.',
      srcBtn: 'Ver en Instagram ↗',
      niche: (nm) => `¿Te gustó esta historia de <b>${nm.topic}</b>? —<br>Más ${nm.topic} en <b>@${nm.acct}</b>, y los nuevos editoriales primero en <b>@pap_magazine</b>, cada día.`,
      main: 'Editoriales diarios, moda y noticias de celebridades —<br>descúbrelos <b>primero en Instagram</b>.',
      topPost: 'Ver la publicación original en Instagram',
      topProfile: 'Seguir a PAP en Instagram',
      pin: 'Guardar en Pinterest',
      sub: '20+ editoriales al mes con equipos creativos de todo el mundo · <a href="' + SITE + '/network" style="color:inherit">La red de Instagram de PAP →</a>',
    },
    ja: {
      srcCopy: 'このコンテンツのオリジナル投稿は<b>Instagram</b>にあります。<br>いいね・保存して、毎日公開される新しいエディトリアルを誰よりも早くチェックしましょう。',
      srcBtn: 'Instagramで見る ↗',
      niche: (nm) => `この<b>${nm.topic}</b>のストーリーが気に入ったら —<br>${nm.topic}専門アカウント<b>@${nm.acct}</b>でもっと${nm.topic}コンテンツを、<b>@pap_magazine</b>で毎日新しいエディトリアルを誰よりも早く。`,
      main: '毎日更新されるエディトリアルとファッション・セレブニュースを、<br><b>Instagramで真っ先に</b>チェック。',
      topPost: 'この記事のInstagram原文を見る',
      topProfile: 'PAPのInstagramをフォロー',
      pin: 'Pinterestに保存',
      sub: '世界中のクリエイティブチームと制作する月20本以上のエディトリアル · <a href="' + SITE + '/network" style="color:inherit">PAP Instagramネットワーク →</a>',
    },
    de: {
      srcCopy: 'Der Originalbeitrag ist auf <b>Instagram</b>.<br>Like und speichere ihn — und entdecke dort täglich die neuesten Editorials als Erste.',
      srcBtn: 'Auf Instagram ansehen ↗',
      niche: (nm) => `Diese <b>${nm.topic}</b>-Story gefallen? —<br>Mehr ${nm.topic} auf <b>@${nm.acct}</b>, und die neuesten Editorials zuerst auf <b>@pap_magazine</b>, jeden Tag.`,
      main: 'Tägliche Editorials, Mode und Promi-News —<br>entdecke sie <b>zuerst auf Instagram</b>.',
      topPost: 'Originalbeitrag auf Instagram ansehen',
      topProfile: 'PAP auf Instagram folgen',
      pin: 'Auf Pinterest speichern',
      sub: '20+ Editorials im Monat mit Kreativteams weltweit · <a href="' + SITE + '/network" style="color:inherit">Das Instagram-Netzwerk von PAP →</a>',
    },
    zh: {
      srcCopy: '原始帖子发布在 <b>Instagram</b> 上。<br>点赞并收藏——每天第一时间发现最新的时尚大片。',
      srcBtn: '在 Instagram 查看 ↗',
      niche: (nm) => `喜欢这篇 <b>${nm.topic}</b> 报道吗？—<br>在 <b>@${nm.acct}</b> 查看更多 ${nm.topic} 内容，在 <b>@pap_magazine</b> 每天抢先看最新大片。`,
      main: '每日更新的时尚大片、时装与名人资讯，<br><b>抢先在 Instagram 上</b>查看。',
      topPost: '查看 Instagram 原帖',
      topProfile: '关注 PAP Instagram',
      pin: '保存到 Pinterest',
      sub: '每月与全球创意团队合作产出 20+ 时尚大片 · <a href="' + SITE + '/network" style="color:inherit">PAP Instagram 网络 →</a>',
    },
    ru: {
      srcCopy: 'Оригинальная публикация — в <b>Instagram</b>.<br>Поставьте лайк и сохраните — и открывайте там новые эдиториалы первыми, каждый день.',
      srcBtn: 'Смотреть в Instagram ↗',
      niche: (nm) => `Понравилась эта история <b>${nm.topic}</b>? —<br>Больше ${nm.topic} на <b>@${nm.acct}</b>, а новые эдиториалы первыми — на <b>@pap_magazine</b>, каждый день.`,
      main: 'Ежедневные эдиториалы, мода и новости о знаменитостях —<br>открывайте их <b>первыми в Instagram</b>.',
      topPost: 'Смотреть оригинал в Instagram',
      topProfile: 'Подписаться на PAP в Instagram',
      pin: 'Сохранить в Pinterest',
      sub: '20+ эдиториалов в месяц с креативными командами со всего мира · <a href="' + SITE + '/network" style="color:inherit">Instagram-сеть PAP →</a>',
    },
  };
  const FT = FUNNEL_T[lang] || FUNNEL_T.en;
  const ET = ENGAGE_T[lang] || ENGAGE_T.en;

  /* IG 아웃클릭 소스 분리 (2026-07-30).
   *
   * 지금까지 에디토리얼·기사·필름 SSR 이 모두 src='ssr' 로 기록돼, 30일 8,139건이
   * 한 덩어리였다. 어느 콘텐츠 종류가 실제로 팔로워를 만드는지 판단할 수 없었고,
   * 주간 73편이 나가는 기사 채널의 기여도는 아예 보이지 않았다.
   * 에디토리얼만 'ssr' 로 남겨 과거 추세를 끊지 않고, 나머지를 분리한다. */
  const IG_SRC = kind === 'article' ? 'ssr_article' : (kind === 'film' ? 'ssr_film' : 'ssr');

  const published = fmtIsoDate(record.published_date);
  const modified = fmtIsoDate(record.updated_at || record.published_date);

  // 예약 태그(`pap:` 접두)는 운영 전용 플래그(예: pap:pin-ok) — 독자 화면·keywords·
  // article:tag meta 어디에도 노출하지 않는다. 태그 배열 원천에서 걸러 하위 전부 정합.
  const tags = asArray(record.tags)
    .filter(t => !/^pap:/i.test(String(t || '').replace(/^#/, '').trim()));

  /* 2026-08-17 (GEO) — 엔티티 매칭. 스키마 선언보다 먼저 계산해야 한다(TDZ).
     제목은 표시 제목+한국어 원제를 함께 본다 — 번역 페이지에서도 원제의
     브랜드·인물이 잡히도록. */
  const { about: _entityAbout, mentions: _entityMentions } =
    matchEntities({ title: String(titleMain || '') + ' ' + String(titleKo || ''), tags });
  const contributors = extractContributors(record);

  /* Gallery for editorials/articles */
  const galleryAll = asArray(record.gallery).filter(u => typeof u === 'string').slice(0, 60);
  /* 이미지 미리보기 (2026-08-27 도메니코 결정) ──────────────────────────
   * SSR 페이지에는 열람 게이트가 아예 없었다. /editorial/:slug 는 모든
   * 방문자에게 이 HTML 을 주므로, 잠금은 여기서 걸어야 실제로 걸린다.
   *
   * 로그인 여부로 HTML 을 다르게 주지 않는다. 이 응답은 CDN 에 공용으로
   * 캐시되므로 사람마다 달라지면 한 사람의 화면이 다른 사람에게 캐시된다.
   * 크롤러에게만 전체를 주는 방법도 있지만(구글이 페이월 마크업과 함께
   * 허용한다) UA 로 응답이 갈리면 캐시가 쪼개진다. 실측상 화보의 이미지
   * 검색 유입이 사실상 0(최근 30일 상위 60개 중 화보 1개, 클릭 0)이라
   * 잃을 것이 없어 **모두에게 같은 2장**을 준다.
   *
   * 전체 이미지는 로그인한 스탠다드 이상이 브라우저에서 채운다
   * (pap-content-editorial.js → /api/editorials/:id). */
  const galleryPreviewLimit = (opts && Number.isFinite(opts.galleryLimit))
    ? Math.max(0, opts.galleryLimit)
    : null;
  const galleryLocked = galleryPreviewLimit !== null && galleryAll.length > galleryPreviewLimit;
  const gallery = galleryLocked ? galleryAll.slice(0, galleryPreviewLimit) : galleryAll;
  /* 스키마의 image 는 실제로 보이는 것만 싣는다. 안 보이는 이미지를 구조화
     데이터로만 흘리면 색인과 화면이 어긋난다. */
  const allImages = [ogImage, ...gallery].filter(Boolean);

  /* Build the primary schema (Article / NewsArticle / VideoObject).
   * Only emit VideoObject when the stored id is in the canonical 11-char
   * shape — anything else would produce a broken contentUrl/embedUrl that
   * Google rejects from the rich-result. */
  let primarySchema;
  if (cfg.schemaType === 'VideoObject' && record.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_id)) {
    primarySchema = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: titleMain,
      description: schemaDesc,
      thumbnailUrl: [ogImage].filter(Boolean),
      uploadDate: published,
      contentUrl: `https://www.youtube.com/watch?v=${record.youtube_id}`,
      embedUrl: `https://www.youtube.com/embed/${record.youtube_id}`,
      publisher: ORG_PUBLISHER,
      keywords: tags.length ? tags.join(', ') : undefined,
      inLanguage: LANG_META[lang].inLang
    };
  } else {
    // QA #187 — richer Article schema. Adds wordCount + articleBody
    // (truncated) so Google's "About this result" panel can quote the
    // editorial, and switches `image` from bare URLs to ImageObject
    // arrays with caption text — boosts image-search ranking and gives
    // the AI overviews enough metadata to attribute the photographer.
    // 2026-07-12 — articleBody 를 요약문(descKo)이 아니라 실제 본문 전문으로.
    // record.content 는 (a) HTML/plain 문자열 (b) 블록 JSON 문자열 (c) 블록 배열
    // 세 형태가 오므로 전부 평문으로 정규화한다. 본문이 없으면 기존처럼 요약문 폴백.
    const bodyPlain = _plainBody(record.content);
    const bodyForWordCount = bodyPlain || String(descKo || '').replace(/\s+/g, ' ').trim();
    const wordCount = bodyForWordCount
      ? bodyForWordCount.split(' ').filter(Boolean).length
      : undefined;
    const imgCreditText = contributors.length ? contributors.join(', ') : SITE_NAME;
    // 2026-07-28 — GSC '이미지 메타데이터' 경고 3종 해소:
    // creator / license / acquireLicensePage 누락. 색인을 막는 오류는 아니지만
    // 구글 이미지 검색의 '라이선스 가능' 배지와 크리에이터 크레딧 노출 기회를
    // 놓치고 있었다(화보가 자산인 매체라 실익이 크다).
    //   creator            — 실제 기여자(포토그래퍼 등), 없으면 매체명
    //   license            — 이용약관(이미지 사용 조건이 명시된 페이지)
    //   acquireLicensePage — 사용 문의 경로
    const personEntities = extractPersonEntities(record);
    const imgCreator = personEntities.length
      ? personEntities
      : (contributors.length
        ? contributors.map(name => ({ '@type': 'Person', name }))
        : { '@type': 'Organization', name: SITE_NAME });
    const imageObjects = allImages.map((u, i) => ({
      '@type': 'ImageObject',
      url: u,
      contentUrl: u,
      caption: i === 0 ? `${titleKo} — Cover` : `${titleKo} — Look ${i}`,
      creator: imgCreator,
      creditText: imgCreditText,
      copyrightNotice: `© ${SITE_NAME}`,
      copyrightHolder: { '@type': 'Organization', name: SITE_NAME },
      license: SITE + '/terms',
      acquireLicensePage: SITE + '/contact',
      representativeOfPage: i === 0 ? true : undefined
    }));

    primarySchema = {
      '@context': 'https://schema.org',
      '@type': cfg.schemaType,
      headline: titleMain,
      // 2026-08-05 — 비한국어 페이지에 한국어 제목을 실으면 언어 신호가 섞여
      // 구글이 ko 판을 표준으로 고른다(articleBody 와 동일 원칙). ko 에서만 방출.
      alternativeHeadline: (!isEn && titleAlt !== titleMain) ? titleAlt : undefined,
      description: schemaDesc,
      image: imageObjects,
      // EN 페이지엔 한국어 본문을 articleBody 로 싣지 않는다 (언어 신호 혼선 방지)
      articleBody: !isEn && bodyForWordCount ? truncate(bodyForWordCount, 8000) : undefined,
      wordCount: isEn ? undefined : wordCount,
      datePublished: published,
      dateModified: modified,
      author: personEntities.length
        ? personEntities
        : contributors.length
        ? contributors.map(name => ({ '@type': 'Person', name }))
        : [{ '@type': 'Organization', name: SITE_NAME, url: SITE }],
      publisher: ORG_PUBLISHER,
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      keywords: tags.length ? tags.join(', ') : undefined,
      articleSection: record.issue || record.category || cfg.sectionFallback,
      /* 2026-08-17 (GEO) — 엔티티 그라운딩. 제목 매칭은 about(주제),
         태그 매칭은 mentions(언급). 빈 배열이면 필드 자체를 내지 않는다. */
      about: _entityAbout.length ? _entityAbout : undefined,
      mentions: _entityMentions.length ? _entityMentions : undefined,
      inLanguage: LANG_META[lang].inLang,
      // QA #187 — explicit isAccessibleForFree so Google news/Discover
      // doesn't mistake the editorial for paywalled content.
      // 2026-08-27 — 이미지가 잘린 화보는 실제로 회원 전용 구간이 있으므로
      // 거짓으로 true 를 말하지 않는다. 구글의 페이월 마크업 규격대로
      // hasPart 로 어느 구간이 잠겼는지 알린다.
      isAccessibleForFree: !galleryLocked,
      hasPart: galleryLocked ? {
        '@type': 'WebPageElement',
        isAccessibleForFree: false,
        cssSelector: '.seo-gallery-locked',
      } : undefined,
      // 2026-07-16 (GEO) — speakable: 음성 어시스턴트/AI 답변 엔진에게
      // "이 페이지를 읽어줄 때 인용할 핵심 구간"을 명시. 제목 + 리드 문단.
      speakable: {
        '@type': 'SpeakableSpecification',
        cssSelector: ['.seo-meta h1', '.seo-desc-primary']
      }
    };
  }

  /* AEO FAQ (2026-07-16, 083 · 2026-08-17 다국어 확장 · 2026-08-28 en 배선) —
     기사 생성 파이프라인이 만든 {q,a} 배열. 기존엔 ko 전용이었는데, Ahrefs 실측으로
     AI Overview 사정권 페이지(상위 20위 + AIO 존재)가 대부분 ja/fr/en 이라는 게
     드러났다 — 정작 인용될 페이지에 답변형 블록이 없던 것. 번역 FAQ
     (seo_translations.faq)가 있으면 그 언어로 렌더한다. 원문(ko)을 다른 언어
     페이지에 섞지 않으므로 언어 신호 혼선 없음 — 번역이 없으면 렌더하지 않는다.

     ⚠️ en 은 seo_translations 를 **읽지 않는다**. 이 저장소에서 en 은 일관되게
     DB 원본 칼럼 언어이고(title_en·description_en·content_en), seo_translations
     에는 en 행이 0개다(실측: de·es·fr·it·ja·ru·zh 뿐). 그런데 2026-08-28 까지
     이 삼항식이 en 을 `tr` 쪽으로 보냈다 → tr 은 언제나 null → **영문 페이지
     전량에 FAQ 블록도 FAQPage 스키마도 한 번도 뜬 적이 없었다.** 백필이 밀린 게
     아니라 경로가 없었다. en 은 faq_en 칼럼을 본다(마이그레이션 139). */
  const faqItems = (() => {
    let f = (lang === 'ko') ? record.faq
          : (lang === 'en') ? (record.faq_en || null)
          : ((tr && tr.faq) || null);
    if (typeof f === 'string') { try { f = JSON.parse(f); } catch (_) { f = null; } }
    return Array.isArray(f)
      ? f.filter(x => x && typeof x.q === 'string' && typeof x.a === 'string' && x.q.trim() && x.a.trim()).slice(0, 5)
      : [];
  })();
  const faqSchema = faqItems.length ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  } : null;

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: cfg.breadcrumb.name, item: cfg.breadcrumb.url },
      { '@type': 'ListItem', position: 3, name: titleMain, item: canonical }
    ]
  };

  /* HTML pieces */
  const tagHtml = tags.length
    ? '<ul class="seo-tags">' + tags.map(t => `<li>#${escText(t)}</li>`).join('') + '</ul>'
    : '';

  /* QA #177 — structured Credit block matching the in-app overlay
   * (`Role @handle1 @handle2`). Falls back to the legacy flat contributor
   * list when extractStructuredCredits returns nothing — better than
   * dropping the section entirely on very old rows. */
  const creditRows = extractStructuredCredits(record);
  const creditsHtml = creditRows.length
    ? '<section class="seo-credits"><h2>Credits</h2>' +
        creditRows.map(({ role, handles }) =>
          `<div class="ed-cred-row"><div class="ed-cred-role">${escText(role)}</div><div class="ed-cred-val">${handles.map(h => escText(h)).join(' ')}</div></div>`
        ).join('') +
      '</section>'
    : (contributors.length
        ? '<section class="seo-credits"><h2>Credits</h2><ul>' +
            contributors.map(n => `<li>${escText(n)}</li>`).join('') +
          '</ul></section>'
        : '');

  /* QA #271 v4 — SSR 페이지에도 다운로드 영역 추가. SPA overlay와 동일한
   * 동작: 회원가입 사용자만 다운로드 가능, 비로그인 시 CTA 표시.
   * 로그인 상태는 클라이언트 JS가 결정 → 일단 placeholder만 출력하고
   * pap-content-editorial.js가 hydrate 시점에 _renderEditorialDownloads()로
   * 채움. coverUrl + gallery는 data-* attribute로 전달.
   *
   * 단, SSR 페이지는 SPA로 즉시 redirect 되므로 (QA #131), 실제로는 hydrate
   * 시점에 SPA 오버레이가 열리고 그쪽이 다운로드 영역을 렌더한다. 그래도
   * 혹시 redirect 전에 본문이 잠시 노출되는 경우를 대비해 SSR HTML에도
   * 같은 div를 포함. */
  const ssrCoverUrlForDl = String((record && record.cover_image) || '').replace(/"/g, '&quot;');
  const ssrGalleryForDl = (() => {
    try { return Buffer.from(JSON.stringify(asArray(record.gallery))).toString('base64'); }
    catch (_) { return ''; }
  })();
  const ssrTitleForDl = String((record && record.title) || 'editorial')
    .replace(/[^a-zA-Z0-9가-힯 ]/g, '').replace(/\s+/g, '-').toLowerCase() || 'editorial';
  /* 2026-08-25 (GSC 표준 태그 충돌 1,655건 진단) — 이 블록이 전 언어에 한국어로
     나가고 있었다. /it 화보 실측: 이탈리아어는 제목·설명 2~3문장뿐인데 다운로드
     안내·버튼이 전부 한국어 → 언어판이 ko 정본의 사본처럼 보여 구글이
     self-canonical 을 무시하고 ko 로 접는다(사용자 선언 /it vs Google 선택 /
     — sacre-chaos URL 검사 실측). 언어판의 한국어 UI 를 현지화해 중복 신호를
     줄인다. ko 는 종전 문구 그대로다. */
  const DL_T = {
    ko: { note: '커버 및 로고 이미지 다운로드는 <strong style="color:#fff">스탠다드 멤버십</strong> 전용입니다.<br>참여 크리에이터는 본인 작품을 무료로 다운로드할 수 있어요.', sub: '멤버십 구독하기 →', login: '로그인', use: '개인 사용 및 비상업적 용도에 한해 사용 가능' },
    en: { note: 'Cover and logo image downloads are for <strong style="color:#fff">Standard members</strong>.<br>Contributing creators can download their own work for free.', sub: 'Subscribe →', login: 'Log in', use: 'Personal, non-commercial use only' },
    it: { note: 'Il download di cover e immagini con logo è riservato ai <strong style="color:#fff">membri Standard</strong>.<br>I creativi che hanno partecipato possono scaricare gratuitamente il proprio lavoro.', sub: 'Abbonati →', login: 'Accedi', use: 'Solo per uso personale e non commerciale' },
    fr: { note: 'Le téléchargement des couvertures et images avec logo est réservé aux <strong style="color:#fff">membres Standard</strong>.<br>Les créatifs ayant participé peuvent télécharger gratuitement leur propre travail.', sub: "S'abonner →", login: 'Se connecter', use: 'Usage personnel et non commercial uniquement' },
    es: { note: 'La descarga de portadas e imágenes con logo es exclusiva para <strong style="color:#fff">miembros Standard</strong>.<br>Los creativos participantes pueden descargar su propio trabajo gratis.', sub: 'Suscribirse →', login: 'Iniciar sesión', use: 'Solo uso personal y no comercial' },
    ja: { note: 'カバーおよびロゴ入り画像のダウンロードは<strong style="color:#fff">スタンダード会員</strong>限定です。<br>参加クリエイターはご自身の作品を無料でダウンロードできます。', sub: '会員登録 →', login: 'ログイン', use: '個人・非商用利用に限ります' },
    de: { note: 'Der Download von Covern und Logo-Bildern ist <strong style="color:#fff">Standard-Mitgliedern</strong> vorbehalten.<br>Beteiligte Kreative können ihre eigene Arbeit kostenlos herunterladen.', sub: 'Abonnieren →', login: 'Anmelden', use: 'Nur für private, nicht-kommerzielle Nutzung' },
    zh: { note: '封面及带 Logo 图片下载仅限<strong style="color:#fff">标准会员</strong>。<br>参与创作者可免费下载自己的作品。', sub: '订阅会员 →', login: '登录', use: '仅限个人及非商业用途' },
    ru: { note: 'Скачивание обложек и изображений с логотипом доступно только <strong style="color:#fff">участникам Standard</strong>.<br>Участвовавшие авторы могут бесплатно скачать свои работы.', sub: 'Подписаться →', login: 'Войти', use: 'Только для личного некоммерческого использования' },
  };
  const DL = DL_T[lang] || DL_T.en;
  const downloadsHtml =
    '<section class="seo-downloads" id="edDetailDownloads" ' +
      'data-cover-url="' + ssrCoverUrlForDl + '" ' +
      'data-gallery-b64="' + ssrGalleryForDl + '" ' +
      'data-title="' + ssrTitleForDl + '" ' +
      'style="margin-top:24px;padding:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px">' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999">DOWNLOADS</div>' +
        '<div style="font-size:13px;color:#ccc">' + DL.note + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' +
          '<a href="/subscribe" style="display:inline-block;padding:10px 22px;border:1px solid #fff;background:#fff;color:#000;font-size:10px;font-weight:700;letter-spacing:.12em;text-decoration:none">' + DL.sub + '</a>' +
          '<a href="/auth.html" style="display:inline-block;padding:10px 22px;border:1px solid #555;color:#fff;font-size:10px;font-weight:700;letter-spacing:.12em;text-decoration:none">' + DL.login + '</a>' +
        '</div>' +
        '<div style="font-size:11px;color:#666;margin-top:4px">' + DL.use + '</div>' +
      '</div>' +
    '</section>';

  /* QA #177 — fashion brand chips, mirrors the SPA overlay's "Fashion by"
   * row. Hidden when the editorial has no brands listed. */
  const fashionBrands = extractFashionBrands(record);
  const fashionHtml = fashionBrands.length
    ? '<section class="seo-fashion"><h2>Fashion</h2><div class="ed-fashion-chips">' +
        fashionBrands.map(h => {
          /* 2026-08-10 — /go·instagram 링크는 IG 핸들 형태일 때만.
           * 옷 이름 크레딧("jacket fursac" 등)이 깨진 /go URL 로 GSC 에
           * 10건 잡힌 사고의 SSR 쪽 봉쇄. 핸들이 아니면 텍스트 칩만. */
          const bare = h.replace(/^@/, '');
          if (!/^[a-z0-9._]{2,30}$/.test(bare.toLowerCase())) {
            return `<span class="ed-fashion-pair"><span class="ed-fashion-chip">${escText(h)}</span></span>`;
          }
          return `<span class="ed-fashion-pair"><a class="ed-fashion-chip" href="https://www.instagram.com/${escAttr(bare)}/" target="_blank" rel="noopener noreferrer">${escText(h)}</a><a class="ed-buy-chip" href="/go/${encodeURIComponent(bare.toLowerCase())}" target="_blank" rel="sponsored nofollow noopener">구매</a></span>`;
        }).join('') +
      '</div></section>'
    : '';

  /* 2026-08-18 — SHOP THE STORY 를 SSR 에도. SPA 에는 이미 있었는데
   * (pap-content-editorial.js, 2026-08-10) 글로벌 유입(핀터레스트·AI검색·
   * 구글)이 처음 밟는 SSR 페이지에는 작은 '구매' 칩뿐이었다. 이축 전제
   * (2026-08-17 도메니코): 어필리에이트·구독 = 글로벌 트래픽 게임 —
   * 글로벌 방문자의 첫 페이지에 수익 표면이 있어야 한다.
   * /go 는 핸들 형태만 (2026-08-10 깨진 URL 사고의 같은 가드). */
  const shopBrands = kind === 'editorial'
    ? fashionBrands.map(h => h.replace(/^@/, '')).filter(b => /^[a-z0-9._]{2,30}$/.test(b.toLowerCase()))
    : [];
  /* 2단계 상품매칭 (2026-08-17) — 크레딧에 품목이 있으면 칩에 표기하고
   * /go 에 ?item= 으로 넘긴다. URL 매핑은 서버(affiliateUrl.js) 한 곳에서만. */
  const shopItems = kind === 'editorial' ? extractBrandItems(record) : {};
  const shopHtml = shopBrands.length
    ? '<section class="seo-shop" style="margin:36px 0 0;padding:24px;border:1px solid rgba(255,255,255,.16)">' +
      '<h2 style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#999;margin:0 0 12px;font-weight:700">Shop the Story</h2>' +
      '<div>' + shopBrands.slice(0, 12).map(b => {
        const item = shopItems[b.toLowerCase()] || '';
        const q = item ? '?item=' + encodeURIComponent(item) : '';
        const tail = item
          ? (lang === 'ko' ? `${escText(item)} 구매 →` : `Shop ${escText(item)} →`)
          : (lang === 'ko' ? '구매 →' : 'Shop →');
        return `<a href="/go/${encodeURIComponent(b.toLowerCase())}${q}" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;margin:0 8px 8px 0;padding:9px 16px;border:1px solid rgba(255,255,255,.25);font-size:12px;color:#fff;text-decoration:none;letter-spacing:.04em">${escText(b)} <span style="opacity:.55">${tail}</span></a>`;
      }).join('') + '</div>' +
      `<div style="font-size:10.5px;color:#666;margin-top:8px">${lang === 'ko' ? '링크를 통해 구매 시 PAP에 수수료가 지급될 수 있습니다.' : 'PAP may earn a commission on purchases made through these links.'}</div>` +
      '</section>'
    : '';

  /* 2026-07-28 — 브랜드 페이지 내부 링크 (Ahrefs orphan 1,359건 해소).
   * 위 칩은 인스타그램(외부)·구매(sponsored nofollow)로만 나가서 우리 /brand/*
   * 페이지에는 내부 링크가 0건이었다. 그래서 사이트맵에만 있고 크롤 우선순위가
   * 낮은 '고아 페이지'가 됐다. record.linked_brands 는 SSR 라우트가
   * editorial_brands ⋈ brands 로 실존 확인해 넣어주므로 404 링크가 생기지 않는다.
   * (해당 데이터가 없으면 이 블록은 통째로 생략 — 기존 동작 유지) */
  const linkedBrands = Array.isArray(record.linked_brands) ? record.linked_brands : [];
  const brandLinksHtml = linkedBrands.length
    ? '<section class="seo-brandlinks"><h2>Brands in this editorial</h2><div class="ed-brand-links">' +
        linkedBrands.slice(0, 24).map(b =>
          `<a class="ed-brand-link" href="/brand/${encodeURIComponent(String(b.brand_id).toLowerCase())}">${escText(b.display_name)}</a>`
        ).join('') +
      '</div></section>'
    : '';

  /* QA #177 — optional video embed when an editorial carries a YouTube /
   * Vimeo / Instagram link in record.url. We only handle the common
   * YouTube watch / youtu.be / Vimeo formats here — anything else is
   * rendered as a plain link. Mirrors the SPA's _renderEditorialVideo. */
  function _extractEmbed(url) {
    const u = String(url || '').trim();
    if (!u) return null;
    let m;
    if ((m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/))) {
      return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0` };
    }
    if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/))) {
      return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
    }
    if (/instagram\.com\/(reel|p)\//i.test(u)) {
      return { kind: 'link', href: u, label: 'Watch on Instagram' };
    }
    if (/^https?:\/\//i.test(u)) return { kind: 'link', href: u, label: 'Watch external' };
    return null;
  }
  const videoEmbed = cfg.schemaType !== 'VideoObject' ? _extractEmbed(record.url) : null;
  const videoHtml = videoEmbed
    ? (videoEmbed.kind === 'iframe'
        ? `<section class="seo-video-section"><div class="seo-embed"><iframe src="${escAttr(videoEmbed.src)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div></section>`
        : `<section class="seo-video-section"><a class="seo-embed-link" href="${escAttr(videoEmbed.href)}" target="_blank" rel="noopener noreferrer">${escText(videoEmbed.label)} ↗</a></section>`)
    : '';

  /* QA #162 — Related Editorial card (films only). The /api/films join
   * embeds editorials!related_editorial_id under record.related_editorial,
   * so when a film has one we render a link card to /editorial/<slug>.
   * Hidden when absent so editorials / articles (which don't carry the
   * field) get no empty section. */
  const rel = record.related_editorial && typeof record.related_editorial === 'object'
    ? record.related_editorial : null;
  const relatedEditorialHtml = (cfg.schemaType === 'VideoObject' && rel && rel.title)
    ? `<section class="seo-related"><h2>Related Editorial</h2>
        <a class="seo-related-card" href="/editorial/${escAttr(rel.slug || rel.id || '')}">
          ${rel.cover_image || rel.thumbnail ? `<img src="${escAttr(rel.cover_image || rel.thumbnail)}"${srcsetAttrs(rel.cover_image || rel.thumbnail, '120px')} alt="${escAttr(rel.title)} — Cover" loading="lazy" width="240" height="160">` : ''}
          <div class="seo-related-meta">
            <div class="seo-related-tagline">RELATED EDITORIAL</div>
            <div class="seo-related-title">${escText(rel.title)}</div>
          </div>
        </a></section>`
    : '';

  /* QA #163 — Related Films cards (editorials only). The /api/editorials
   * reverse-join embeds matching films under record.related_films, so when
   * an editorial has linked films we render cards that click through to
   * /film/<slug>. Mirrors the SPA overlay's _renderRelatedFilms() output. */
  const relFilms = (cfg.schemaType !== 'VideoObject' && Array.isArray(record.related_films))
    ? record.related_films.filter(f => f && f.title && (f.slug || f.id))
    : [];
  /* 2026-07-22 (Ahrefs: 고아 페이지 1,378) — 에디토리얼 상세 본문 내 내부링크 블록.
     이전/다음(발행일 체인)으로 전 에디토리얼이 그래프에 연결되고, 태그 관련 4건이
     링크 에쿼티를 분배한다. record.more_editorials 는 [slug].js 가 탑재(에디토리얼 전용). */
  /* 2026-07-23 (Ahrefs Tip #3: 내부 링크로 중요 페이지 강화) — kind 별 일반화.
     에디토리얼은 record.more_editorials(/editorial/·"More Editorials"), 아티클은
     record.more_articles(/article/·"More Articles"). 둘 다 [slug].js 가 탑재. */
  const _more = record.more_editorials || record.more_articles || null;
  const _moreBase = record.more_articles ? '/article/' : '/editorial/';
  const _moreHeading = record.more_articles ? 'More Articles' : 'More Editorials';
  const _edCard = (e, tag) => {
    if (!e || !e.title || !(e.slug || e.id)) return '';
    const th = e.thumbnail || e.cover_image || e.og_image || '';
    /* 2026-08-04 — 내부링크 언어 프리픽스. /ja/editorial/x 의 카드가 /editorial/y
       (한국어)를 가리켜 번역 페이지끼리 전혀 연결되지 않았다(GSC '발견됨 - 현재
       색인이 생성되지 않음' 4,474건의 대부분이 ja/fr/it/es/en 번역 URL).
       [slug].js 가 실제 번역이 존재하는 항목에만 e._lang 을 달아준다 —
       번역이 없는데 프리픽스를 붙이면 302 체인이 생기기 때문. */
    const _lp = (e._lang && e._lang !== 'ko') ? '/' + e._lang : '';
    return `<a class="seo-related-card" href="${_lp}${_moreBase}${escAttr(e.slug || e.id)}">
      ${th ? `<img src="${escAttr(th)}" alt="${escAttr(e.title)} — Cover" loading="lazy" width="240" height="160">` : ''}
      <div class="seo-related-meta">
        <div class="seo-related-tagline">${tag}</div>
        <div class="seo-related-title">${escText(e.title)}</div>
      </div>
    </a>`;
  };
  const moreEditorialsHtml = _more && (_more.prev || _more.next || (_more.related && _more.related.length))
    ? `<section class="seo-related"><h2>${_moreHeading}</h2>
        <div class="seo-related-films">${[
          _edCard(_more.prev, 'PREVIOUS'),
          ...(Array.isArray(_more.related) ? _more.related.map(e => _edCard(e, 'RELATED')) : []),
          _edCard(_more.next, 'NEXT'),
        ].join('')}</div></section>`
    : '';

  const relatedFilmsHtml = relFilms.length
    ? `<section class="seo-related"><h2>Related Films</h2>
        <div class="seo-related-films">${relFilms.map(f => {
          const ytThumb = (f.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(f.youtube_id))
            ? `https://img.youtube.com/vi/${f.youtube_id}/hqdefault.jpg` : '';
          const thumb = f.thumbnail_url || ytThumb || '';
          return `<a class="seo-related-card" href="/film/${escAttr(f.slug || f.id)}">
            ${thumb ? `<img src="${escAttr(thumb)}"${srcsetAttrs(thumb, '120px')} alt="${escAttr(f.title)} — Cover" loading="lazy" width="240" height="160">` : ''}
            <div class="seo-related-meta">
              <div class="seo-related-tagline">FILM</div>
              <div class="seo-related-title">${escText(f.title)}</div>
            </div>
          </a>`;
        }).join('')}</div></section>`
    : '';

  /* Hero — image for editorial/article, YouTube embed for film/short.
   *
   * youtube_id has to match the canonical 11-char id shape before we
   * concatenate it into the embed URL. Without this guard, a legacy row
   * whose youtube_id is a full URL ("https://www.youtube.com/<id>")
   * produces an iframe src like
   *   https://www.youtube-nocookie.com/embed/https://www.youtube.com/<id>
   * which YouTube serves as a blank page (QA #160 — "Selects" film).
   * The new admin form (saveFilm + savePost) refuses to insert non-id-
   * shaped values, but historical rows still need this defence. */
  const isValidYtId = typeof record.youtube_id === 'string'
    && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_id);
  const heroHtml = (cfg.schemaType === 'VideoObject' && isValidYtId)
    ? `<div class="seo-video"><iframe src="https://www.youtube-nocookie.com/embed/${escAttr(record.youtube_id)}?rel=0" title="${escAttr(titleKo)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
    : ogImage
      ? `<div class="seo-hero"><img src="${escAttr(ogImage)}"${srcsetAttrs(ogImage, '(max-width:1200px) 100vw, 1200px')} alt="${escAttr(titleKo)} — Cover" loading="eager" fetchpriority="high" width="1200" height="800" data-pin-url="${escAttr(canonical)}" data-pin-media="${escAttr(ogImage)}" data-pin-description="${escAttr(titleKo + ' — PAP Magazine editorial')}"></div>`
      : '';

  /* QA #177 — gallery now annotates each image with the per-look fashion
   * credit string when fashion.imageCredits has one for that index. Same
   * data path the SPA uses (`@brand1 Item, @brand2 Item2`). The caption
   * sits below the image instead of as a hover overlay so it works
   * without JS (matters for SSR/crawlers + accessibility). */
  const galleryHtml = gallery.length
    ? '<section class="seo-gallery" aria-label="Gallery">' +
        gallery.map((src, i) => {
          const credit = getImageCredit(record, i + 1);
          // Pinterest 리치핀/저장 최적화 (2026-07): 각 이미지에 data-pin-*
          // 를 실어 방문자가 핀 저장 시 캐노니컬 PAP 페이지로 역링크되고
          // 룩·크레딧이 설명으로 채워진다 → 콘텐츠가 핀터레스트 검색
          // 그래프로 유입되는 플라이휠.
          const pinDesc = titleKo + ' — Look ' + (i + 1) + (credit ? ' · ' + credit : '') + ' | PAP Magazine';
          /* 2026-08-27 (GEO) — alt 의미화. "Look N" 만으로는 이미지 검색·LLM 이미지
             인용이 잡을 텍스트가 없다. 실재 데이터만 싣는다: 첫 태그(무드/장르) +
             콘텐츠 종류(editorial 은 화보에만) + 크레딧. 없는 값은 지어내지 않는다. */
          const altKind = cfg.sectionFallback === 'Editorial'
            ? (tags.length ? `${tags[0]} fashion editorial` : 'fashion editorial')
            : (tags.length ? tags[0] : '');
          const altText = `${titleKo}${altKind ? ' — ' + altKind : ''}, Look ${i + 1}`
            + (credit ? ' · ' + truncate(credit, 80) : '');
          return `<figure>`
            + `<img src="${escAttr(src)}"${srcsetAttrs(src, '(max-width:900px) 100vw, 584px')} alt="${escAttr(altText)}" loading="lazy" decoding="async" data-pin-url="${escAttr(canonical)}" data-pin-media="${escAttr(src)}" data-pin-description="${escAttr(pinDesc)}">`
            + (credit ? `<figcaption class="ed-img-credits">${escText(credit)}</figcaption>` : '')
            + `</figure>`;
        }).join('') +
      '</section>'
    : '';

  /* 잠금 패널 (2026-08-27) — 몇 장이 남았는지, 어느 등급부터 열리는지,
     다음 행동이 무엇인지 셋 다 말한다. 하나라도 빠지면 문의가 들어온다.
     .seo-gallery-locked 는 위 hasPart 의 cssSelector 와 같아야 한다. */
  const galleryLockHtml = galleryLocked
    ? (() => {
        /* 어느 등급부터 열리는가. 호출부(api/seo/editorial/[slug].js)가
           최신 10편 여부까지 보고 넘겨준다. 없으면 가장 보수적으로. */
        const need = ({ free: 'free', standard: 'standard' })[String((opts && opts.lockTier) || '')] || 'premium';
        const L = GALLERY_LOCK_T[lang] || GALLERY_LOCK_T.en;
        const hidden = galleryAll.length - gallery.length;
        const head = need === 'free' ? L.headFree : (need === 'standard' ? L.headStandard : L.headPremium);
        const sub = need === 'free' ? L.subFree : (need === 'standard' ? L.subStandard : L.subPremium);
        /* 무료 회원이면 열리는 화보는 구독이 아니라 가입으로 보낸다.
           돈을 낼 필요가 없는 사람을 결제 페이지로 보내면 그냥 이탈한다. */
        const ctaHref = need === 'free'
          ? SITE + '/auth?utm_source=editorial_gallery_lock&utm_medium=web'
          : SITE + '/subscribe?utm_source=editorial_gallery_lock&utm_medium=web';
        return '<section class="seo-gallery-locked" aria-label="Members only">'
          + '<div class="sgl-count">' + escText(L.count(galleryAll.length, hidden)) + '</div>'
          + '<div class="sgl-head">' + escText(head) + '</div>'
          + '<div class="sgl-sub">' + escText(sub) + '</div>'
          + '<a class="sgl-cta" href="' + escAttr(ctaHref) + '">'
          + escText(need === 'free' ? L.ctaFree : L.cta) + '</a>'
          + '</section>'
      })()
    : '';

  /* Content body for articles.
     QA(2026-07): admin v2 는 content 를 JSON 블록 배열
     ([{type:'text'|'image'|'quote'|'video'|'videogroup'|'gallery'|'slide', …}])
     로 저장한다. 예전엔 이 문자열을 그대로 출력해서, /article/<slug> 직접
     진입 시(기사 SSR 은 SPA 로 리다이렉트하지 않음) PC·모바일 모두 원본
     JSON([{"type":...}])이 노출됐다. 여기서 파싱해 정적 시맨틱 HTML 로
     렌더한다 — SPA 의 _renderArticleBlocks(pap-content-article.js) 서버 미러.
     상호작용(슬라이드 화살표·라이트박스)은 없지만 텍스트·이미지·영상·갤러리는
     정상 노출된다. 블록 배열이 아니면(레거시 HTML/텍스트) 원문을 그대로 쓴다. */
  function _renderArticleBody(content) {
    let blocks = null;
    if (typeof content === 'string' && content.trim().charAt(0) === '[') {
      try { const p = JSON.parse(content); if (Array.isArray(p)) blocks = p; } catch { blocks = null; }
    } else if (Array.isArray(content)) {
      blocks = content;
    }
    if (!blocks) {
      return typeof content === 'string' ? content : escText(JSON.stringify(content));
    }
    const iframe = (src) => `<div style="margin:36px 0;position:relative;padding-bottom:56.25%;height:0;overflow:hidden"><iframe src="${escAttr(src)}" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe></div>`;
    const vid = (u) => {
      const e = _extractEmbed(u);
      if (e && e.kind === 'iframe') return iframe(e.src);
      if (u) return `<p style="margin:36px 0;font-size:12px"><a href="${escAttr(u)}" target="_blank" rel="noopener" style="color:#aaa">${escText(u)} ↗</a></p>`;
      return '';
    };
    let html = '';
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      const t = b.type || 'text';
      const c = (b.content || '').toString();
      const url = (b.url || '').toString();
      if (t === 'text') {
        /* 2026-08-17 — JSON 블록 본문 안에 <br><br> 가 '문자로' 들어있는 기사가 7편 있다.
           escText 가 그걸 &lt;br&gt; 로 이스케이프해서 화면에 태그가 그대로 찍혔다.
           월 노출 6,300 인 워터밤 기사(우리 최상위 기사 페이지)가 여기 해당했고,
           2026-08-14 발행분에도 있어 지금도 계속 생기고 있다.
           그래서 두 가지를 한다. <br> 두 개 이상은 단락 경계로 보고 끊고,
           남은 홑 <br> 은 이스케이프 뒤에 줄바꿈으로 되돌린다.
           되돌리는 대상은 <br> 패턴 하나뿐이라 다른 태그는 여전히 이스케이프된다. */
        const paras = c.split(/\n\n+|(?:<br\s*\/?>\s*){2,}/i);
        html += paras.map(p => `<p style="margin:0 0 22px;line-height:1.9">${escText(p).replace(/\n/g, '<br>').replace(/&lt;br\s*\/?&gt;/gi, '<br>')}</p>`).join('');
      } else if (t === 'image') {
        if (!url) continue;
        html += `<figure style="margin:36px 0"><img src="${escAttr(url)}"${srcsetAttrs(url, '(max-width:800px) 100vw, 752px')} alt="${escAttr(c || titleMain)}" loading="lazy" style="width:100%;display:block;border-radius:2px">${c ? `<figcaption style="margin-top:12px;font-size:12px;color:#888;text-align:center;letter-spacing:.04em;line-height:1.6">${escText(c)}</figcaption>` : ''}</figure>`;
      } else if (t === 'quote') {
        const src = (b.source || '').toString();
        html += `<blockquote style="margin:36px 0;padding:20px 26px;border-left:3px solid #999;font-style:italic;color:#ddd;font-size:16px;line-height:1.85">${escText(c)}${src ? `<footer style="margin-top:14px;font-size:11px;color:#888;font-style:normal;text-align:right">— ${escText(src)}</footer>` : ''}</blockquote>`;
      } else if (t === 'video') {
        html += vid(c || url);
      } else if (t === 'videogroup') {
        const vids = Array.isArray(b.videos) ? b.videos : [];
        if (!vids.length) continue;
        html += '<div style="margin:36px 0;display:flex;flex-direction:column;gap:24px">';
        for (const v of vids) { if (v && v.url) html += `<div style="margin:0">${vid(v.url)}${v.caption ? `<div style="margin-top:6px;font-size:11px;color:#888;text-align:center">${escText(v.caption)}</div>` : ''}</div>`; }
        html += '</div>';
      } else if (t === 'gallery') {
        const imgs = Array.isArray(b.images) ? b.images : [];
        if (!imgs.length) continue;
        html += '<div style="margin:36px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px">';
        for (const im of imgs) { if (im && im.url) html += `<figure style="margin:0"><img src="${escAttr(im.url)}"${srcsetAttrs(im.url, '(max-width:800px) 100vw, 376px')} alt="${escAttr(im.caption || titleMain)}" loading="lazy" style="width:100%;aspect-ratio:4/5;object-fit:cover;display:block;border-radius:2px">${im.caption ? `<figcaption style="margin-top:8px;font-size:11px;color:#888;text-align:center;line-height:1.5">${escText(im.caption)}</figcaption>` : ''}</figure>`; }
        html += '</div>';
      } else if (t === 'slide') {
        const imgs = Array.isArray(b.images) ? b.images : [];
        if (!imgs.length) continue;
        html += '<div style="margin:36px 0;display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch">';
        for (const im of imgs) { if (im && im.url) html += `<figure style="margin:0;flex:0 0 88%;scroll-snap-align:center"><img src="${escAttr(im.url)}"${srcsetAttrs(im.url, '88vw')} alt="${escAttr(im.caption || titleMain)}" loading="lazy" style="width:100%;aspect-ratio:4/5;object-fit:cover;display:block;border-radius:2px">${im.caption ? `<figcaption style="margin-top:8px;font-size:11px;color:#888;text-align:center;line-height:1.6">${escText(im.caption)}</figcaption>` : ''}</figure>`; }
        html += '</div>';
      } else {
        html += `<p style="margin:0 0 22px;line-height:1.9">${escText(c)}</p>`;
      }
    }
    return html;
  }
  // 2026-07-21 — SSR 본문을 언어에 맞춰 고른다. 기존엔 record.content(한국어)를
  // 모든 언어에 렌더해, 비한국어 SSR 페이지가 lang=xx 인데 본문이 한국어였다
  // (크롤러·초기 페인트가 한국어를 색인). 우선순위: 번역 본문(tr.body) → en은
  // content_en → 없으면 한국어 원문(fallback). tr.body 는 기사 핸들러만 전달하므로
  // editorial/film/short 는 record.content 로 기존 동작을 그대로 유지한다.
  const _trBody = (tr && typeof tr.body === 'string' && tr.body.trim()) ? tr.body : null;
  const _enBody = (lang === 'en' && typeof record.content_en === 'string' && record.content_en.trim()) ? record.content_en : null;
  const bodySource = _trBody || _enBody || record.content;
  const bodyHtml = bodySource
    ? `<div class="seo-body">${_renderArticleBody(bodySource)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="${lang}" prefix="og: https://ogp.me/ns#">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escText(seoTitle)}</title>
<meta name="description" content="${escAttr(desc)}">
${tags.length ? `<meta name="keywords" content="${escAttr(tags.join(', '))}">` : ''}
<meta name="author" content="${escAttr(SITE_NAME)} - ALTAKAPPA Co., Ltd.">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="googlebot" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">

<link rel="canonical" href="${escAttr(canonical)}">
<!-- hreflang (2026-07-16): 실재하는 언어별 SSR URL 만 선언 — ko/en 항상,
     it/fr/es 는 seo_translations 에 번역이 있는 경우만 (핸들러가 전달). -->
${hreflangLinks}


<meta property="og:type" content="${cfg.schemaType === 'VideoObject' ? 'video.other' : 'article'}">
<meta property="og:title" content="${escAttr(seoTitle)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:url" content="${escAttr(canonical)}">
<meta property="og:site_name" content="${escAttr(SITE_NAME)}">
<meta property="og:image" content="${escAttr(ogImage)}">
<meta property="og:image:secure_url" content="${escAttr(ogImage)}">
<meta property="og:image:alt" content="${escAttr(titleKo)} — Editorial Cover">
<!-- QA #187 + B-4 (2026-07) — Explicit OG image dimensions.
     실측 결과 콘텐츠 커버는 일관되게 IG 표준 4:5 세로(1080×1350, 2000×2500)인데
     기존 1200×800(가로) 선언은 실물과 달라 FB/카카오 첫 공유 시 잘못된 크롭
     힌트를 줬다. 스크레이퍼는 이 값을 비율 힌트로 쓰므로 4:5로 선언한다.
     기본 폴백 이미지만 가로형(2000×1125)이라 분기. -->
<meta property="og:image:width" content="${ogImage === DEFAULT_OG_IMAGE ? '2000' : /img\.youtube\.com/.test(ogImage) ? '1280' : '1080'}">
<meta property="og:image:height" content="${ogImage === DEFAULT_OG_IMAGE ? '1125' : /img\.youtube\.com/.test(ogImage) ? '720' : '1350'}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:locale" content="${LANG_META[lang].og}">
<meta property="og:locale:alternate" content="${lang === 'ko' ? 'en_US' : 'ko_KR'}">
<meta property="article:author" content="${escAttr(SITE_NAME)}">
<meta property="article:section" content="${escAttr(record.issue || record.category || cfg.sectionFallback)}">
<meta property="article:published_time" content="${escAttr(published)}">
<meta property="article:modified_time" content="${escAttr(modified)}">
${tags.map(t => `<meta property="article:tag" content="${escAttr(t)}">`).join('\n')}

<!-- 2026-07-16: 영상도 summary_large_image 로 통일. player 카드는
     twitter:player(iframe URL)·width·height 가 필수인데 미제공 상태라
     카드 검증 자체가 실패하고 있었다 — 큰 썸네일 카드가 항상 안전하다. -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@papmagazine_">
<meta name="twitter:creator" content="@papmagazine_">
<meta name="twitter:title" content="${escAttr(seoTitle)}">
<meta name="twitter:description" content="${escAttr(desc)}">
<meta name="twitter:image" content="${escAttr(ogImage)}">
<meta name="twitter:image:alt" content="${escAttr(titleKo)} — Editorial Cover">

<script type="application/ld+json">${escJson(primarySchema)}</script>
<script type="application/ld+json">${escJson(breadcrumbSchema)}</script>
${faqSchema ? `<script type="application/ld+json">${escJson(faqSchema)}</script>` : ''}

<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#000000">

<!-- QA #187 — LCP preload. The largest paint element on every editorial /
     article page is the hero cover image. Preloading it (with explicit
     fetchpriority=high) gives Lighthouse a tangible LCP boost — usually
     -300~800ms on cold cache. We DON'T preload for VideoObject pages
     because the LCP element there is the YouTube iframe, not an image. -->
${cfg.schemaType !== 'VideoObject' && ogImage ? (canOptimizeImg(ogImage)
  ? `<link rel="preload" as="image" fetchpriority="high" href="${escAttr(ogImage)}" imagesrcset="${escAttr(IMG_OPT_WIDTHS.map(w => vercelImgUrl(ogImage, w) + ' ' + w + 'w').join(', '))}" imagesizes="(max-width:1200px) 100vw, 1200px">`
  : `<link rel="preload" as="image" fetchpriority="high" href="${escAttr(ogImage)}">`) : ''}

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com">
<link rel="preconnect" href="https://igcazquhkwxtqsaqpznx.supabase.co">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600;700;800;900&family=Montserrat:wght@700&display=swap" rel="stylesheet">
${/* ── pap-styles.css 를 렌더 차단에서 뺀다 (2026-08-22) ────────────────
     [측정] 코어 웹 바이탈 모바일 13,207쪽 전부 'LCP 4초 초과', '좋음' 0.
     이 파일은 **108KB** 이고 head 에서 렌더를 막는다.

     [확인] SSR 페이지가 이걸 실제로 얼마나 쓰나 — 세어 봤다.
       · SSR 이 쓰는 클래스 44개 중 **38개가 아래 인라인 <style> 에 이미 있다.**
       · 남은 6개(seo-content·seo-copyright·seo-downloads·seo-shop·
         seo-brandlinks·pap-engage)는 pap-styles.css 에**도** 없다
         (style= 속성으로 직접 그린다).
       · body 바탕·글자색·폰트도 인라인의 `body.seo-loading` 이 준다.
         그 클래스는 제거되지 않으므로 계속 유효하다.
       · 헤더는 pap-header.js 가 **자체 <style> 을 주입**한다(6곳). 의존 없음.
     ⇒ 이 파일은 SSR 본문의 첫 페인트에 사실상 기여하지 않는다.
        SPA 화면(index/articles/…)은 종전대로 동기 로드다 — 여긴 안 건드린다.

     [방식] preload → onload 에서 stylesheet 로 승격. JS 없는 환경은 noscript.
     되돌리려면 이 블록을 원래 한 줄로 되돌리면 된다. */ ''}
<link rel="preload" href="/pap-styles.css?v=${PAP_STYLES_VERSION}" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="/pap-styles.css?v=${PAP_STYLES_VERSION}"></noscript>
${/* ── LCP 히어로 preload (2026-08-22) ─────────────────────────────────
     [측정] Search Console 코어 웹 바이탈(2026-08-21 기준):
       모바일 느림 13,207쪽 / 좋음 0 — 'LCP 4초 초과' 전 페이지.
       데스크톱은 13,207쪽 전부 '개선 필요'.
     [왜 preload 인가] 히어로 img 에는 이미 loading=eager·fetchpriority=high 가
     있다. 그런데 브라우저가 그 태그를 **만나기 전에** 렌더 차단 자원 세 개를
     먼저 받는다 — 구글폰트 CSS(외부), pap-styles.css(108KB),
     pap-geo-lang.js(언어 깜빡임 방지용이라 defer 불가). 그동안 LCP 이미지는
     요청조차 시작되지 않는다. head 의 preload 는 그 대기를 없앤다.
     [주의] img 와 **똑같은** srcset/sizes 를 줘야 한다. 다르면 브라우저가
     다른 후보를 받아 두 번 내려받는다(= 오히려 손해). 그래서 같은 헬퍼를 쓴다. */ ''}
${ogImage && !(cfg.schemaType === 'VideoObject' && isValidYtId)
  ? `<link rel="preload" as="image" href="${escAttr(ogImage)}"${srcsetAttrs(ogImage, '(max-width:1200px) 100vw, 1200px').replace(' srcset=', ' imagesrcset=').replace(' sizes=', ' imagesizes=')} fetchpriority="high">`
  : ''}

<style>
  body.seo-loading{background:#000;color:#fff;font-family:Inter,-apple-system,sans-serif;margin:0;padding:0}
  .seo-hero,.seo-video{display:block;width:100%;max-width:1200px;margin:0 auto}
  .seo-hero img{display:block;width:100%;height:auto}
  .seo-video{aspect-ratio:16/9;background:#111}
  .seo-video iframe{width:100%;height:100%;display:block;border:0}
  /* QA(2026-07) #9 — 타이틀 그룹(제목·부제·발행일)은 밀착시키고, 발행일은
     보조 정보로 축소, 그 아래 본문과는 여백을 벌려 위계·리듬을 명확히 한다.
     (제목→부제 12→4, 부제→발행일 24→4, 발행일 13→11px, 발행일→본문 여백 확대) */
  .seo-meta{max-width:800px;margin:32px auto;padding:0 24px;line-height:1.6}
  .seo-meta h1{font-family:'Playfair Display',serif;font-size:clamp(28px,5vw,56px);margin:0 0 4px}
  .seo-meta .alt{opacity:.65;font-style:italic;margin:0 0 4px}
  .seo-meta time{opacity:.5;font-size:11px;letter-spacing:.1em;text-transform:uppercase;display:block;margin-bottom:0}
  .seo-meta .seo-tldr-label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.5;margin:32px 0 -24px}
  .seo-meta .seo-desc-primary{font-size:15px;line-height:1.8;margin:32px 0 12px;white-space:pre-line}
  .seo-meta .seo-desc-en{font-size:13px;line-height:1.75;margin:0 0 12px;opacity:.6;white-space:pre-line;padding-top:14px;border-top:1px dashed rgba(255,255,255,.12)}
  /* 2026-08-22 — 가운데 정렬이 빠져 있었다. <article> 직계 자식인데 형제들(.seo-meta·
     .seo-body·.seo-faq…)과 달리 max-width/auto 마진이 없어서, 주소로 직접 들어간
     SSR 페이지에서만 태그 줄이 화면 왼쪽 끝까지 붙어 본문과 어긋났다.
     (홈에서 클릭해 들어오면 SPA 가 그리므로 이 클래스 자체가 안 쓰인다 —
      그래서 '주소로 들어갈 때만' 이상해 보였다) */
  .seo-tags{max-width:800px;margin:24px auto;padding:0 24px;display:flex;flex-wrap:wrap;gap:8px;list-style:none}
  .seo-tags li{padding:4px 10px;border:1px solid rgba(255,255,255,.2);font-size:12px}
  /* QA #177 — structured credits / fashion / per-image credits to match SPA overlay */
  .seo-byline{font-size:13px;opacity:.75;margin:6px 0 0;letter-spacing:.02em}
  .seo-credits{max-width:800px;margin:48px auto;padding:0 24px}
  .seo-credits h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:16px}
  .seo-credits ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:16px}
  .seo-credits ul li{font-size:13px;opacity:.8}
  .ed-cred-row{display:grid;grid-template-columns:160px 1fr;gap:16px;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13.5px;line-height:1.7}
  .ed-cred-row:last-child{border-bottom:none}
  .ed-cred-role{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.55)}
  .ed-cred-val{color:rgba(255,255,255,.92);word-break:break-word}
  .seo-fashion{max-width:800px;margin:32px auto;padding:0 24px}
  .seo-fashion h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:14px}
  .ed-fashion-chips{display:flex;flex-wrap:wrap;gap:8px}
  .ed-fashion-chip{display:inline-block;padding:6px 12px;border:1px solid rgba(255,255,255,.18);font-size:12px;color:rgba(255,255,255,.85);text-decoration:none;transition:background .2s}
  .ed-fashion-chip:hover{background:rgba(255,255,255,.06)}
  .ed-fashion-pair{display:inline-flex}
  .ed-buy-chip{display:inline-block;padding:6px 10px;border:1px solid rgba(255,255,255,.18);border-left:none;font-size:11px;color:#000;background:#fff;text-decoration:none;font-weight:700}
  .ed-buy-chip:hover{opacity:.85}
  /* 브랜드 페이지 내부 링크 (2026-07-28, orphan 해소) — 기존 칩과 같은 톤 */
  .ed-brand-links{display:flex;flex-wrap:wrap;gap:8px}
  .ed-brand-link{display:inline-block;padding:6px 12px;border:1px solid rgba(255,255,255,.18);font-size:12px;color:rgba(255,255,255,.85);text-decoration:none;transition:background .2s}
  .ed-brand-link:hover{background:rgba(255,255,255,.06)}
  .seo-video-section{max-width:1200px;margin:48px auto;padding:0 16px}
  .seo-embed{position:relative;width:100%;aspect-ratio:16/9;background:#111}
  .seo-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
  .seo-embed-link{display:inline-block;padding:14px 28px;border:1px solid rgba(255,255,255,.3);color:#fff;text-decoration:none;font-size:12px;letter-spacing:.12em;text-transform:uppercase}
  .seo-embed-link:hover{background:rgba(255,255,255,.06)}
  .ed-img-credits{margin:8px 0 0;font-size:11px;letter-spacing:.04em;color:rgba(255,255,255,.55);line-height:1.6;font-family:Inter,-apple-system,sans-serif}
  /* Related editorial / films cards — QA #162 + #163 */
  .seo-related{max-width:800px;margin:36px auto;padding:0 24px}
  .seo-related h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:14px}
  .seo-related-card{display:flex;align-items:center;gap:16px;padding:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.02);text-decoration:none;color:inherit;transition:background .2s;margin-bottom:10px}
  .seo-related-card:hover{background:rgba(255,255,255,.05)}
  .seo-related-card img{width:120px;height:80px;object-fit:cover;background:#222;flex-shrink:0}
  .seo-related-meta{flex:1;min-width:0}
  .seo-related-tagline{font-size:9px;font-weight:700;letter-spacing:.2em;color:rgba(201,169,110,.9);text-transform:uppercase;margin-bottom:6px}
  .seo-related-title{font-size:15px;font-weight:600;letter-spacing:.02em;line-height:1.4}
  .seo-related-films{display:flex;flex-direction:column;gap:0}
  .seo-gallery{max-width:1200px;margin:48px auto;padding:0 16px;display:grid;grid-template-columns:1fr;gap:24px}
  .seo-gallery figure{margin:0}
  .seo-gallery-locked{max-width:1200px;margin:0 auto 48px;padding:56px 24px;text-align:center;
    border:1px solid rgba(255,255,255,.14)}
  .sgl-count{font-size:12px;letter-spacing:.12em;opacity:.55;margin-bottom:18px}
  .sgl-head{font-size:17px;font-weight:600;margin-bottom:8px}
  .sgl-sub{font-size:13px;opacity:.62;margin-bottom:24px;line-height:1.6}
  .sgl-cta{display:inline-block;padding:13px 30px;border:1px solid currentColor;
    font-size:12px;letter-spacing:.14em;text-decoration:none;color:inherit}
  /* 로딩 스켈레톤 (2026-07-20, QA 공백 페이지 대응) — 이미지가 로딩되는 동안
     검은 배경과 구분되는 은은한 셔머를 보여줘 "빈 블록"으로 보이지 않게 한다.
     로딩 완료 후에는 이미지가 배경을 덮어 보이지 않는다. */
  @keyframes papSkel{0%{background-position:200% 0}100%{background-position:-200% 0}}
  .seo-gallery img{display:block;width:100%;height:auto;min-height:240px;
    background:linear-gradient(110deg,#101010 35%,#1e1e1e 50%,#101010 65%);
    background-size:200% 100%;animation:papSkel 1.6s linear infinite}
  @media(min-width:900px){.seo-gallery{grid-template-columns:1fr 1fr;gap:32px}}
  .seo-body{max-width:800px;margin:32px auto;padding:0 24px;line-height:1.7;font-size:16px}
  .seo-body p{margin:0 0 1.2em}
  .seo-body img{max-width:100%;height:auto;display:block;margin:24px auto}
  /* AEO FAQ (2026-07-16) — details/summary 는 JS 없이 크롤러에 원문 노출 */
  .seo-faq{max-width:800px;margin:48px auto;padding:0 24px}
  .seo-faq h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:16px}
  .seo-faq details{border-bottom:1px solid rgba(255,255,255,.1);padding:12px 0}
  .seo-faq summary{font-size:14.5px;font-weight:600;cursor:pointer;line-height:1.6}
  .seo-faq p{margin:10px 0 4px;font-size:13.5px;line-height:1.75;color:rgba(255,255,255,.75)}
  .seo-back{max-width:800px;margin:48px auto 80px;padding:24px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;letter-spacing:.06em;text-transform:uppercase;opacity:.7}
  .seo-back a{color:#fff;text-decoration:none;margin-right:8px}
  .seo-back a:hover{opacity:.7}
  /* 검색 유입 → 인스타그램 전환 모듈 (2026-07). 구글/네이버에서 기사로
     들어온 방문자에게 팔로우 CTA 노출 — 스트릿/셀럽/패션위크 주제 검색
     트래픽을 IG 팔로워로 전환하는 깔때기의 착지점. */
  /* 2026-08-22 상단 IG 진입점 — 인라인 크리티컬 CSS 에 둔다.
   pap-styles.css 는 preload→onload 로 늦게 오므로(098be3b), 여기 없으면
   첫 화면에서 모양이 무너진다. 본문을 가리지 않는 얇은 한 줄이다
   (구글 침입형 인터스티셜 규정을 건드리지 않는 크기). */
  .ig-top{display:flex;align-items:center;gap:10px;max-width:800px;margin:18px auto 0;padding:12px 16px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.03);color:#fff;text-decoration:none;font-size:12.5px;letter-spacing:.02em;line-height:1.4;transition:background .25s,border-color .25s}
  .ig-top:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.4)}
  .ig-top-mark{flex:0 0 auto;font-size:15px;opacity:.9}
  .ig-top-txt{flex:1 1 auto;min-width:0}
  .ig-top-go{flex:0 0 auto;opacity:.6;font-size:13px}
  @media(max-width:600px){.ig-top{margin:14px 16px 0;padding:11px 13px;font-size:12px}}
  @media(prefers-reduced-motion:reduce){.ig-top{transition:none}}
  .ig-funnel{max-width:800px;margin:56px auto 0;padding:36px 28px;border:1px solid rgba(255,255,255,.16);text-align:center}
  .ig-funnel .igf-kicker{font-size:10px;letter-spacing:.32em;text-transform:uppercase;opacity:.55;margin-bottom:14px}
  .ig-funnel .igf-copy{font-size:15px;line-height:1.75;margin-bottom:22px}
  .ig-funnel .igf-copy b{font-weight:600}
  .ig-funnel .igf-btn{display:inline-block;background:#fff;color:#000;padding:13px 34px;font-size:11.5px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;text-decoration:none;transition:opacity .3s}
  .ig-funnel .igf-btn:hover{opacity:.82}
  .ig-funnel .igf-sub{margin-top:14px;font-size:11px;opacity:.5;letter-spacing:.04em}
  .ig-funnel .pin-btn{display:inline-block;margin-left:10px;background:#E60023;color:#fff;padding:13px 30px;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-decoration:none;transition:opacity .3s}
  .ig-funnel .pin-btn:hover{opacity:.85}
  /* 카카오 공유 (2026-08-07). 한국에서 콘텐츠가 퍼지는 1번 경로인데
     지금까지 저장소 전체에 카카오 공유 코드가 한 줄도 없었다.
     핀터레스트 버튼과 같은 자리에 같은 모양으로 둔다 — 브랜드 컬러만 다르다. */
  .ig-funnel .kko-btn{display:inline-block;margin-left:10px;background:#FEE500;color:#191600;padding:13px 30px;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-decoration:none;border:0;cursor:pointer;font-family:inherit;transition:opacity .3s}
  .ig-funnel .kko-btn:hover{opacity:.85}
  /* 참여 블록 CSS 는 이제 부품(pap-engage.js)이 직접 주입한다 (2026-08-08).
     여기 두면 SSR 만 옷을 입고 SPA(index/articles.html)는 맨몸 버튼이 떴다 —
     부품은 합쳤는데 스타일이 두 벌 규칙으로 남아 있던 것. 배치 이유는 그대로:
     기사에서 할 수 있는 온사이트 액션이 스크랩 하나뿐이었고(커뮤니티
     좋아요·댓글 역대 0건), IG 퍼널 **위**에 둔다 — 아래면 아무도 안 본다. */
  /* ── 2026-07-22 (도메니코 지시) — 기사(article) SSR 을 SPA 오버레이(artDetail) 룩과 통일.
     "링크 직접 진입 시 이미지가 크게 나오고 정렬이 뒤죽박죽" 보고의 실체는 두 렌더러의
     디자인 불일치였다(frontend/rules 'SSR·SPA 불일치 금지'). 기준은 SPA:
     articles.html #artDetail* 인라인 스타일 실측값을 그대로 옮긴다.
     editorial/film SSR 은 건드리지 않도록 .seo-kind-article 로 스코프. */
  .seo-kind-article .seo-hero{max-width:800px;margin:40px auto 0;padding:0 20px}
  .seo-kind-article .seo-hero img{width:auto;max-width:100%;max-height:75vh;height:auto;margin:0 auto;background:#111}
  .seo-kind-article .seo-meta{max-width:800px;padding:0 20px}
  .seo-kind-article .seo-tags{max-width:800px;padding:0 20px}
  .seo-kind-article .seo-meta h1{font-family:'Montserrat',sans-serif;font-size:26px;font-weight:700;letter-spacing:.04em;line-height:1.35;margin:0}
  .seo-kind-article .seo-meta .alt{font-style:normal;font-size:14px;color:#aaa;opacity:1;margin:12px 0 0;line-height:1.6}
  .seo-kind-article .seo-meta time{font-size:11px;color:#888;letter-spacing:.12em;margin-top:14px;opacity:1}
  .seo-kind-article .seo-meta .seo-desc-primary{font-size:16px;line-height:1.9;letter-spacing:.02em;color:#ccc;margin-top:36px}
  .seo-kind-article .seo-gallery{max-width:800px;margin:24px auto;padding:0 20px;gap:4px}
  .seo-kind-article .seo-gallery img{min-height:0}
  @media(min-width:900px){.seo-kind-article .seo-gallery{grid-template-columns:1fr 1fr;gap:4px}}
  .seo-kind-article .seo-video-section{max-width:800px;padding:0 20px}
  .seo-kind-article .seo-body{font-size:16px;line-height:1.9;letter-spacing:.02em}
  @media(max-width:768px){
    .seo-kind-article .seo-meta h1{font-size:22px}
    .seo-kind-article .seo-meta .seo-desc-primary{font-size:15px;line-height:1.85}
  }
</style>
</head>
<body class="seo-loading seo-kind-${kind}">
${(kind === 'editorial' || kind === 'film' || kind === 'article') ? `<!-- QA #178 / #233 — Real-browser redirect bridge.
     The SSR HTML above + meta tags is what crawlers / social-preview
     scrapers consume (they don't run JS). Real users instead get sent to
     the SPA homepage with the kind-specific deep-link, which renders the
     EXACT same overlay as clicking a card from the menu — no parallel
     templates to keep in sync.
     Editorial → ?ed=<slug>   → /editorial/<slug> (final URL)
     Film      → ?film=<slug> → /film/<slug>      (final URL — QA #233)
     Article   → ?art=<slug>  → /article/<slug>   (2026-08-08 — 도메니코가
       "주소로 직접 들어갈 때와 홈에서 타고 들어갈 때 화면이 다르다" 고
       계속 지적한 바로 그 갈래. 기사만 다리가 없어서 직접 진입자는 SSR
       디자인을, 사이트 내 진입자는 SPA 디자인을 봤다. FAQ·MORE ARTICLES
       를 SPA 로 옮겨 심었으므로 이제 기사도 다리를 건넌다. artid=<uuid>
       를 같이 실어, SPA 의 전량 목록 동기화(451편·수 초)가 늦어도 단건
       fetch 로 바로 열 수 있게 한다.)
     ?raw=1 escape hatch leaves the user on the SSR view for debugging /
     archival snapshots.
     Shorts still skip the redirect (slug deep-link 미구현). -->
<style>
  /* Hide the SSR body the instant we know we'll be redirecting so the
     user doesn't see a flash of the simplified SSR layout. Crawlers
     without JS keep seeing the body normally. */
  html.js-redirecting body{opacity:0!important;transition:none!important}
</style>
<script>
  (function(){
    try {
      var qs = (window.location.search || '').toLowerCase();
      if (qs.indexOf('raw=1') !== -1 || qs.indexOf('no-spa=1') !== -1) return;
      // 2026-08-04 — GSC "리디렉션이 포함된 페이지"(3,588건) 근본 원인 제거.
      // 이 브릿지는 "실제 사용자"를 SPA 오버레이로 보내려는 것인데, JS 를
      // 실행하는 크롤러(Googlebot WRS 등)까지 그대로 따라가 버려서 모든
      // 에디토리얼/필름 URL 이 "리디렉션이 있는 페이지"로 분류되고 색인에서
      // 빠졌다. 서버 HTML 은 누구에게나 동일하게 내려보내고(=클로킹 아님,
      // CDN 캐시도 그대로) 스크립트 안에서만 크롤러를 걸러 SSR 페이지에
      // 머무르게 한다. SSR 페이지가 곧 색인 대상 본문이다.
      var _ua = (navigator.userAgent || '');
      if (/bot|crawler|spider|crawling|slurp|mediapartners|inspectiontool|lighthouse|facebookexternalhit|embedly|quora link preview|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegram|discord|applebot|yeti|duckduck|baidu|yandex|petal|ia_archiver/i.test(_ua)) return;
      // 리다이렉트 루프 가드 (2026-07 교체) — 예전 영구 boolean 플래그
      // (_pap_ssr_redirect_done)는 세션당 1회만 리다이렉트해서, 다이렉트
      // 진입/새로고침이 SSR 에 갇히는 버그가 있었다. 이제 (kind/slug)별 +
      // 15초 창 + 최대 4회로 좁힌다: 정상 재방문·새로고침은 항상 SPA 로 넘기고
      // (SPA 오픈 성공 시 pap-content-seo.js 가 이 레코드를 즉시 삭제),
      // SPA 오픈이 짧은 시간에 반복 실패할 때만 SSR 에 안착시킨다(무한 루프 차단).
      var _KEY = '_pap_ssr_bounce', _WINDOW_MS = 15000, _MAX = 4;
      var _id = ${JSON.stringify(kind)} + '/' + ${JSON.stringify(slug)};
      var _now = Date.now();
      try {
        var _rec = null;
        try { _rec = JSON.parse(sessionStorage.getItem(_KEY) || 'null'); } catch(_){}
        if (_rec && _rec.id === _id && (_now - _rec.first) < _WINDOW_MS) {
          if (_rec.n >= _MAX) {
            // 짧은 시간에 MAX회 반복 진입 = SPA 가 못 잡는 상황. 레코드를 그대로
            // 두고 리다이렉트 없이 SSR 에 머문다(정상 폴백). 지우지 않기 때문에
            // 창(15초)이 지날 때까지 계속 머물러 루프가 실제로 끊긴다. 창이
            // 만료되면 아래 else 로 리셋되어 이후 정상 재방문은 다시 재시도된다.
            return;
          }
          _rec.n++;
        } else {
          _rec = { id: _id, n: 1, first: _now };
        }
        try { sessionStorage.setItem(_KEY, JSON.stringify(_rec)); } catch(_){}
      } catch(_){}
      document.documentElement.classList.add('js-redirecting');
      // SPA homepage picks up the right query param via deep-link IIFEs
      // in pap-content-seo.js, opens the matching overlay, and pushes
      // /<kind>/<slug> as the final URL.
      var paramName = ${JSON.stringify(kind === 'film' ? 'film' : (kind === 'article' ? 'art' : 'ed'))};
      // 2026-08-04 — 언어 접두어 보존. 예전엔 /en/editorial/x 로 들어와도
      // SPA 최종 URL 이 /editorial/x (한국어)로 바뀌어 canonical·hreflang 과
      // 어긋났다. 언어를 쿼리로 넘기고 표시 언어도 미리 맞춰둔다.
      var _lang = ${JSON.stringify(lang)};
      if (_lang && _lang !== 'ko') { try { localStorage.setItem('pap-lang', _lang); } catch (_) {} }
      var target = '/?' + paramName + '=' + encodeURIComponent(${JSON.stringify(slug)})
        + (_lang && _lang !== 'ko' ? '&lang=' + encodeURIComponent(_lang) : '')
        // 기사 전용 — 목록 동기화보다 먼저 도착해도 단건으로 열 수 있는 안전핀.
        + ${JSON.stringify(kind === 'article' && UUID_RE.test(String(record.id || '')) ? '&artid=' + String(record.id) : '')};
      window.location.replace(target);
    } catch(_){ /* on any error, leave the SSR page visible */ }
  })();
</script>` : ''}

${(kind === 'article' || kind === 'editorial') && UUID_RE.test(String(record.id || '')) ? `<script>
  /* ── SSR 조회 비콘 (2026-08-22) ────────────────────────────────────
     [왜] 웹→IG 아웃클릭 30일 1,950건 중 SSR 화면이 3/4 를 만든다
          (ssr_article→post 833 · 7일 679 / 전체 928).
          같은 기사를 SPA 로 보면 68건이다. 12배 차이.
          그런데 **그건 절대량이지 전환율이 아니다** — SSR 페이지는 지금까지
          조회 비콘을 아예 쏘지 않아서 분모가 없다. 분모 없이 구조를 갈아엎으면
          추측 위에 추측을 쌓는다.

     [무엇을 세나] '리다이렉트하지 않고 SSR 에 남은 사람' 만 센다.
          그게 ssr_* 아웃클릭을 만드는 바로 그 모집단이다.
          리다이렉트로 SPA 에 넘어간 사람은 SPA 쪽 비콘이 센다(surface=spa).
          → 두 화면이 겹치지 않고 한 번씩만 세어진다.

     [비용] 남은 사람 수만큼만 함수가 돈다. 봇은 서버가 UA 로 걸러 204 로 끝낸다.
     [안전] 실패해도 조용히. 계측이 화면을 막지 않는다. */
  (function(){
    try {
      if (document.documentElement.classList.contains('js-redirecting')) return;
      var _p = ${JSON.stringify(kind === 'article' ? '/api/articles/' : '/api/editorials/')}
             + ${JSON.stringify(String(record.id))} + '/view?surface=ssr';
      var _go = function(){
        try {
          fetch(_p, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' }, keepalive: true })
            .catch(function(){});
        } catch(_){}
      };
      /* 리다이렉트 판단은 위 스크립트가 동기로 끝낸다. 그래도 한 틱 늦춰
         '넘어갈 사람'을 세지 않는다 — 중복 집계가 제일 나쁜 계측이다. */
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _go, { once: true });
      } else { setTimeout(_go, 0); }
    } catch(_){}
  })();
</script>` : ''}

<main class="seo-content">
  <article>
    ${heroHtml}
    <!-- 2026-08-05 — 비한국어 페이지에는 한국어 제목(.alt)·한국어 설명(.seo-desc-en)을
         노출하지 않는다. 두 줄이 en/it/es 판에 그대로 실려 구글이 /en/article/* 를
         /article/* 의 중복으로 보고 한국어판을 표준으로 선택했다(GSC 41건).
         한국어 페이지에서 영문 제목·설명을 보조로 보여주는 기존 동작은 유지. -->
    <div class="seo-meta">
      <h1>${escText(titleMain)}</h1>
      ${!isEn && titleAlt !== titleMain ? `<p class="alt">${escText(titleAlt)}</p>` : ''}
      <time datetime="${escAttr(published)}">${(() => {
        // 2026-07-20 QA 표기통일 — 메인홈/목록/상세 SPA와 동일 포맷:
        //   "Title,Case - DD Mon YYYY" (카테고리 먼저, Title-case, ' - ' 구분).
        //   기존엔 "DD Mon YYYY · CATEGORY(대문자)" 라 다른 페이지와 순서·대소문자가 달랐다.
        const _label = record.issue ? String(record.issue) : fmtTitleCat(record.category);
        const _date = fmtDisplayDate(record.published_date) || published.slice(0, 10);
        return escText((_label ? _label + ' - ' : '') + _date);
      })()}</time>
      ${/* 2026-08-17 — 눈에 보이는 byline (GEO).
           JSON-LD 의 author 는 이미 있었지만 그건 기계용이다. 생성 엔진
           (ChatGPT·Perplexity)은 **본문 텍스트**에서 신뢰 신호를 읽는다.
           작성자·날짜·출처가 화면에 보이는 문서는 인용률이 눈에 띄게 높다는
           것이 2026 GEO 자료들의 공통 보고다. 날짜는 위 <time> 에 이미 있으니
           빠진 것은 작성자 한 줄뿐이었다.
           기여자가 있으면 실명, 없으면 매체 편집부. 링크는 걸지 않는다
           (기여자 프로필 페이지가 아직 없어 죽은 링크가 된다). */ ''}
      <p class="seo-byline">By ${escText(contributors.length ? contributors.join(', ') : SITE_NAME + ' Editorial')}</p>
      ${descDisplay ? `<div class="seo-tldr-label" aria-hidden="true">${escText(TLDR_LABEL[lang] || 'TL;DR')}</div>` : ''}
      <p class="seo-desc-primary">${escText(descDisplay)}</p>
      ${!isEn && descAltDisplay && descAltDisplay !== descDisplay ? `<p class="seo-desc-en">${escText(descAltDisplay)}</p>` : ''}
    </div>
    ${/* ── 상단 IG 진입점 (2026-08-22, 도메니코: "인스타그램 유입 최우선") ──
        [왜 여기] 지금 IG 진입점은 **페이지 맨 아래**에 있다 — 갤러리·크레딧·
        별점·참여·SHOP·다운로드·브랜드·관련글·태그·FAQ 를 전부 지나야 나온다.
        모바일에서 수천 픽셀 아래다. 그런데도 웹→IG 아웃클릭의 3/4 를 만든다.
        위로 올리면 어떻게 되는지는 **아무도 모른다.** 그래서 재게 만든다.

        [무엇을 근거로 게시물 링크인가] 같은 페이지·같은 방문자로 이미 비교돼 있다.
            게시물(to=post)    30일 약 1,394
            프로필(to=profile) 30일 약  421
        3.3 대 1 이다. 노출이 같은 두 CTA 라 이건 공정한 비교다.
        그래서 상단은 게시물을 앞세우고, 원본이 없을 때만 프로필로 떨어진다.
        (원본 보유율 실측: 화보 95.0% · 기사 87.7%)

        [왜 얇게] 구글의 침입형 인터스티셜 규정을 건드리지 않는 크기로 둔다.
        본문을 가리면 순위를 잃고, 순위를 잃으면 IG 로 보낼 사람 자체가 준다.

        [계측] src 를 ssr_top 으로 따로 둔다. 7일 뒤 ssr_top 대 ssr_article 을
        비교하면 '위가 나은가'가 추측이 아니라 숫자로 판정된다. */ ''}
    ${/* ── 목적지 반반 나누기 (2026-08-22) ─────────────────────────────
        [왜 나누나] 어제 이 CTA 를 만들 때 '게시물(post)' 을 골랐다. 근거는
        클릭 수였다 — 게시물 1,394 대 프로필 421, 3.3배.
        그런데 도메니코가 원하는 건 클릭이 아니라 **팔로워**다.
        오늘 실측이 그 둘을 가른다 (31일, 일별 상관):
            프로필 클릭 ↔ 일일 팔로워 증가   r = **+0.323**
            게시물 클릭 ↔ 일일 팔로워 증가   r = **-0.191**
        n=31 이라 통계적으로 확정은 아니다(p≈0.08). **그래서 확정하러 간다.**
        방향이 반대라는 것만으로도 "클릭 3.3배" 를 근거로 게시물을 고정할 수는 없다.
        팔로우 버튼은 프로필에 있다. 게시물에는 없다.

        [어떻게] 기사 id 로 결정적 반반. 같은 글은 늘 같은 쪽이라 새로고침해도
        화면이 안 흔들리고, 전체로는 절반씩 나뉜다. 라벨(src)은 같고 to_type 만
        갈리므로 **같은 자리·같은 기간·같은 방문자층**에서 공정하게 비교된다.
        7일 뒤 to_type 별 클릭과 그날의 팔로워 증가를 나란히 놓으면 답이 나온다.

        [왜 랜덤이 아닌가] 매 요청 랜덤이면 CDN 캐시가 한쪽으로 굳고, 같은 글을
        두 번 본 사람이 다른 화면을 본다. id 해시는 캐시와 무관하게 안정적이다. */ ''}
    ${(() => {
      const igUrl = String(record.source_instagram_url || '');
      const hasPost = /instagram\.com/.test(igUrl);
      /* 결정적 반반 — id 문자 코드 합의 홀짝. 암호학적일 필요가 없다.
         원본이 없으면 선택지가 프로필뿐이라 나눌 것도 없다. */
      let bucketPost = hasPost;
      if (hasPost) {
        let h = 0;
        const key = String(record.id || record.slug || '');
        for (let i = 0; i < key.length; i++) h = (h + key.charCodeAt(i)) % 1000;
        bucketPost = (h % 2) === 0;
      }
      const href = bucketPost
        ? `/api/ig-out?src=ssr_top&to=post&url=${encodeURIComponent(igUrl.split('?')[0])}`
        : `/api/ig-out?src=ssr_top&to=profile&url=https%3A%2F%2Fwww.instagram.com%2Fpap_magazine%2F`;
      // 화보/기사에 따라 문구가 갈린다. 없는 언어는 topPost 로 폴백한다.
      const topLabel = bucketPost
        ? ((kind === 'editorial' && FT.topPostEditorial) || FT.topPost)
        : FT.topProfile;
      return `<a class="ig-top" href="${href}" target="_blank" rel="noopener">
      <span class="ig-top-mark" aria-hidden="true">◎</span>
      <span class="ig-top-txt">${escText(topLabel)}</span>
      <span class="ig-top-go" aria-hidden="true">↗</span>
    </a>`;
    })()}
    ${bodyHtml}
    ${galleryHtml}
    ${galleryLockHtml}
    ${videoHtml}
    ${/* 2026-08-09 도메니코: 크레딧은 사진과 별점 사이 · SHOP 은 다운로드 위.
        기사·필름은 종전 순서 유지. */ ''}
    ${kind === 'editorial' ? creditsHtml : ''}
    ${kind === 'editorial' ? '<div id="papRatingMount"></div>' : ''}
    ${kind === 'editorial' && UUID_RE.test(String(record.id || '')) ? '<div class="pap-engage" id="papEngageMount"></div>' : ''}
    ${kind !== 'editorial' ? creditsHtml : ''}
    ${kind === 'editorial' ? fashionHtml : ''}
    ${kind === 'editorial' ? shopHtml : ''}
    ${/* 2026-08-22 — 에디토리얼에서만 낸다.
        네이버 웹문서 실측: /article/* 과 /film/* 의 검색 스니펫이 이 블록 문구로
        나온다. 예) '해밀턴 오디세이 영케이' 9위 /film/0419c3ba… 의 설명이
          "DOWNLOADS 커버 및 로고 이미지 다운로드는 스탠다드 멤버십 전용입니다."
        기사·필름에는 애초에 내려받을 커버·로고가 없다. 팔 것이 없는데 결제
        문구만 검색 결과에 실렸고, 그것도 '멤버십 전용'이라는 거절 문구였다.
        성장 헌법 7항(첫 방문 결제 강요 UI 금지)에도 어긋난다.
        에디토리얼은 실제로 커버·로고를 내려받으므로 그대로 둔다. */ ''}
    ${kind === 'editorial' ? downloadsHtml : ''}
    ${kind !== 'editorial' ? fashionHtml : ''}
    ${brandLinksHtml}
    ${relatedEditorialHtml}
    ${relatedFilmsHtml}
    <!-- QA(2026-07) #5 — 해시태그 노출 위치 통일. record.tags 로 오는 해시태그는
         기존에 seo-meta(본문 설명 바로 아래·상단)에 렌더돼, 본문 블록 안에
         해시태그를 배치하는 관리자 등록 기사(최하단)와 위치가 어긋났다. IG
         연동/기존 데이터 기사도 콘텐츠가 모두 끝난 최하단(참여 CTA 직전)에
         해시태그를 노출하도록 tagHtml 을 이 위치로 이동한다. -->
    ${tagHtml}

    ${faqItems.length ? `
    <section class="seo-faq">
      <h2>${escText(FAQ_HEADING[lang] || 'FAQ')}</h2>
      ${faqItems.map(f => `<details open>
        <summary>${escText(f.q)}</summary>
        <p>${escText(f.a)}</p>
      </details>`).join('\n')}
    </section>` : ''}

    ${/* 2026-08-09 도메니코: "댓글도 별점 아래에" — 에디토리얼 참여 블록은
        위(별점 직후)로 옮겼다. 기사·필름은 종전 위치 유지. */ ''}
    ${ENGAGE_KINDS.has(kind) && kind !== 'editorial' && UUID_RE.test(String(record.id || '')) ? `
    <div class="pap-engage" id="papEngageMount"></div>` : ''}

    ${record.source_instagram_url && /instagram\.com/.test(String(record.source_instagram_url)) ? `
    <aside class="ig-funnel" style="margin-bottom:0">
      <div class="igf-kicker">On Instagram</div>
      <p class="igf-copy">${FT.srcCopy}</p>
      <a class="igf-btn" href="/api/ig-out?src=${IG_SRC}&to=post&url=${encodeURIComponent(String(record.source_instagram_url).split('?')[0])}" target="_blank" rel="noopener">${FT.srcBtn}</a>
    </aside>` : ''}

    <aside class="ig-funnel">
      <div class="igf-kicker">PAP Magazine — Instagram</div>
      ${(() => {
        const nm = nicheMeta(record.category);
        // 카테고리 매칭 시: 해당 니치 채널을 주 CTA 로 앞세우고 문구도 맞춤.
        if (nm) return `<p class="igf-copy">${FT.niche(nm)}</p>
      <a class="igf-btn" href="/api/ig-out?src=ssr_niche&to=profile&url=${encodeURIComponent('https://www.instagram.com/' + nm.acct + '/')}" target="_blank" rel="noopener">Follow @${nm.acct}</a>
      <a class="igf-btn" style="background:transparent;color:#bbb;border:1px solid rgba(255,255,255,.25)" href="/api/ig-out?src=${IG_SRC}&to=profile&url=https%3A%2F%2Fwww.instagram.com%2Fpap_magazine%2F" target="_blank" rel="noopener">+ @pap_magazine</a>`;
        // 매칭 없으면 기존 메인 채널 CTA.
        return `<p class="igf-copy">${FT.main}</p>
      <a class="igf-btn" href="/api/ig-out?src=${IG_SRC}&to=profile&url=https%3A%2F%2Fwww.instagram.com%2Fpap_magazine%2F" target="_blank" rel="noopener">Follow @pap_magazine</a>`;
      })()}
      ${ogImage ? `<a class="pin-btn" href="https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(canonical)}&media=${encodeURIComponent(ogImage)}&description=${encodeURIComponent(titleMain + ' — PAP Magazine editorial')}" target="_blank" rel="noopener" data-pin-do="none">${FT.pin}</a>` : ''}
      <!-- 카카오 공유 버튼은 2026-08-07 부터 참여 블록(pap-engage.js)이 그린다.
           여기 두면 SSR 에만 있고 SPA 에는 없어서 화면이 갈라진다. -->
      <div class="igf-sub">${FT.sub}</div>
    </aside>

    <!-- 2026-08-08 도메니코 지시 — More Articles/Editorials 는 페이지 제일
         아래. SPA(#artMoreArticles)와 같은 위치라 두 화면 순서가 일치한다. -->
    ${moreEditorialsHtml}
  </article>
</main>

<nav class="seo-back" aria-label="Site navigation">
  <a href="${SITE}/">← ${escText(SITE_NAME)}</a> ·
  <a href="${SITE}/magazine">Magazine</a> ·
  <a href="${SITE}/articles">Articles</a> ·
  <a href="${SITE}/films">Films</a> ·
  <!-- 2026-07-29: /studio 는 사이트 어디에서도 링크되지 않아 고아였다(내부링크 0).
       pap-studios.com 을 접고 /studio 로 일원화하는 이상, 모든 SSR 페이지에서
       한 번은 링크되어야 크롤·권위 전달이 된다. -->
  <a href="${SITE}/studio">Studio</a> ·
  <!-- 2026-08-17: /digital-magazine — /studio 와 같은 이유. 카테고리 정의 페이지
       (GEO 핵심)의 내부 링크가 about 한 곳뿐이라 크롤·권위 전달이 안 됐다. -->
  <a href="${SITE}/digital-magazine">Digital Magazine</a>
  <a href="${SITE}/instagram-magazine">Instagram Magazine</a>
  <a href="${SITE}/submissions">Submissions</a>
</nav>
<!-- 2026-08-17 도메니코 지시 — '팝매거진' 구글 검색 대응. 메타가 아니라 **보이는
     본문 텍스트**로 브랜드 한글 표기를 전 SSR 페이지에 싣는다. 저작권 줄은
     어느 매체나 있는 자연스러운 자리다 (제목 반복 = 스팸, 이건 아님). -->
<p class="seo-copyright" style="text-align:center;font-size:11px;color:#888;margin:28px 0 20px">© PAP MAGAZINE${lang === 'ko' ? ' 팝매거진' : ''} · <a href="${SITE}" style="color:#888">pap-magazine.com</a></p>

<script>
  window._papServerRendered = true;
  window._papInitialContent = ${JSON.stringify({ kind, slug })};
</script>
<script src="/pap-geo-lang.js?v=2"></script>
<script src="/cookie-consent.js" defer></script>
<!-- QA(2026-07) #11 — 공통 헤더/햄버거 nav 통일. pap-header.js 는 자체 CSS·함수를
     주입하는 self-contained 스크립트라 이 SSR 페이지에서도 SPA 와 동일한 헤더를
     보여준다. (에디토리얼/필름 SSR 은 위 브릿지로 SPA 리다이렉트되지만, 기사 SSR 은
     리다이렉트하지 않으므로 직접 진입 시 헤더 일치가 특히 중요.) _navGo 는
     navigateWithInterstitial 부재 시 location.href 로 폴백한다. -->
<script src="/pap-header.js?v=${PAP_HEADER_VERSION}" defer></script>
${ENGAGE_KINDS.has(kind) && UUID_RE.test(String(record.id || '')) ? `
<script>
/* 참여 블록은 이제 공용 부품이다 (2026-08-07).
 *
 * 예전엔 이 자리에 인라인 스크립트가 통째로 있었다. 그런데 우리 사이트에는
 * 기사 화면이 두 벌이다 — 주소로 직접 들어오면 이 SSR, 사이트 안에서
 * 클릭하면 SPA. 인라인으로 두니 **SPA 화면에는 좋아요·댓글이 아예 없었다.**
 * 도메니코가 "MORE ARTICLES, 자주 묻는 질문이 안 뜬다" 고 한 게 같은 뿌리다.
 * 규칙이 두 벌이면 한쪽만 고쳐진다 — 그래서 /pap-engage.js 로 합쳤다. */
window.__PAP_KAKAO_JS_KEY = ${JSON.stringify(KAKAO_JS_KEY || '')};
window.__PAP_ENGAGE = ${JSON.stringify({
  kind, id: String(record.id || ''), lang,
  title: String(titleMain || '').slice(0, 80),
  desc: String(desc || '').slice(0, 110),
  image: ogImage || '',
})};
</script>
<script src="/pap-engage.js?v=8" defer></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var host = document.getElementById('papEngageMount');
  if (host && window.PapEngage) window.PapEngage.mount(host, window.__PAP_ENGAGE);
  /* 별점은 사진 바로 아래 (2026-08-09 도메니코) — mountRating 은 editorial 이 아니면 스스로 침묵 */
  var rateHost = document.getElementById('papRatingMount');
  if (rateHost && window.PapEngage && window.PapEngage.mountRating) window.PapEngage.mountRating(rateHost, window.__PAP_ENGAGE);
});
window.addEventListener('load', function () {
  var host = document.getElementById('papEngageMount');
  if (host && !host.firstChild && window.PapEngage) window.PapEngage.mount(host, window.__PAP_ENGAGE);
});
</script>` : ''}

${NAVER_ANALYTICS_ID ? `
<script src="//wcs.naver.net/wcslog.js" defer></script>
<script>
/* 네이버 애널리틱스. wcslog 가 defer 라 로드를 기다린다.
   쿠키 동의 전이라도 네이버는 개인식별 없는 집계라 기존 GA 처리와 같은 층에
   두지 않았다 — 동의 연동이 필요해지면 cookie-consent.js 로 옮길 것. */
(function () {
  function go() {
    if (!window.wcs) return setTimeout(go, 300);
    if (!window.wcs_add) window.wcs_add = {};
    window.wcs_add.wa = ${JSON.stringify(NAVER_ANALYTICS_ID)};
    if (window.wcs.inflow) window.wcs.inflow('pap-magazine.com');
    window.wcs_do();
  }
  go();
})();
</script>` : ''}
</body>
</html>`;
}

/* ── 404 page ───────────────────────────────────────── */
function renderNotFoundHtml(kind, slug) {
  const cfg = KIND[kind] || KIND.editorial;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Not Found | PAP Magazine</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${cfg.breadcrumb.url}">
<style>body{background:#000;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}a{color:#fff}</style>
</head><body>
<main>
  <h1>404 — Not Found</h1>
  <p>The ${kind} you're looking for may have been removed or renamed.</p>
  <p><a href="${cfg.breadcrumb.url}">Browse ${cfg.breadcrumb.name} →</a></p>
</main></body></html>`;
}

// 2026-07-21 QA(표기 재발) — fmtDisplayDate/fmtTitleCat 을 내보낸다.
// api/seo/listing.js 가 자체 ISO 포맷(dateStr)을 쓰고 있어 목록 SSR 만
// "2025-01-05" 로 갈렸다. 서버측 표기도 이 두 함수 하나로 모은다.
/* ORG_PUBLISHER 를 내보내는 이유 (2026-08-28): 브랜드 별칭(alternateName)이
   여기 하나뿐이어야 한다. AI 답변 점유율 프로브(aiVisibility.js)가 "답변에
   우리가 나왔나"를 이 별칭 목록으로 판정하는데, 목록을 거기 다시 적으면
   '팹매거진' 같은 표기를 한쪽만 추가하는 날이 반드시 온다 (교훈 2). */
module.exports = { renderSeoHtml, renderNotFoundHtml, descFromBody, KIND, SITE, SITE_NAME, fmtDisplayDate, fmtTitleCat, ORG_PUBLISHER };
