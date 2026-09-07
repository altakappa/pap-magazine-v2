'use strict';
/**
 * 사진 화보용 FAQ — 모델을 부르지 않고, 우리가 이미 가진 사실만 조립한다.
 *
 * 배경 (2026-09-07):
 *   발행된 기사 26건이 FAQ 없이 남아 있었다. 전부 사진 화보다 (스트릿 스타일,
 *   백스테이지, 애프터파티 포토월). 본문이 53~76자라 faqBackfill 의
 *   MIN_BODY_CHARS=80 문턱에 걸려 영원히 대상이 아니었다.
 *
 *   그 판단 자체는 옳았다. 60자짜리 캡션을 모델에 던지면 지어낼 수밖에 없다.
 *   하지만 우리는 본문 말고도 사실을 갖고 있었다.
 *     tags     → 시즌(FW26) · 도시(밀란) · 종류(스트릿 스타일) · 브랜드
 *     gallery  → 사진 수
 *     content  → 촬영자 (Photographer. CLAUDIO K)
 *     published_date → 공개일
 *
 *   그래서 모델이 아니라 규칙으로 만든다. 모델 호출 0회, 지어내기 0회.
 *
 * 넘지 않는 선 (도메니코와 2026-09-07 합의):
 *   "밀란 패션 위크는 언제 열리나요" 같은 일반 상식은 넣지 않는다.
 *   그건 우리가 취재한 게 아니고, AI 는 그 답을 다른 수천 곳에서 얻는다.
 *   AI 가 우리를 인용할 이유는 우리만 가진 사실 때문이다.
 *   그리고 이 FAQ 는 JSON-LD 뿐 아니라 페이지에 실제로 보인다(seo-faq 섹션).
 *   독자가 읽는 글이므로 모르는 것은 비운다.
 *
 * 확신이 서는 사실이 2개 미만이면 null 을 낸다. 억지로 채우지 않는다.
 */

/* ── 시즌 ──────────────────────────────────────────────
 * FW26 / AW25 / SS26 / FW2026 형태. 두 자리는 20xx 로 편다. */
const SEASON_RE = /\b(FW|AW|SS|RS|PF)\s?(\d{2}|\d{4})\b/i;
const SEASON_KO = { FW: '가을겨울', AW: '가을겨울', SS: '봄여름', RS: '리조트', PF: '프리폴' };

function parseSeason(text) {
  const m = SEASON_RE.exec(String(text || ''));
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const yy = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (!(yy >= 2000 && yy <= 2100)) return null;
  return { code: kind + m[2], year: yy, ko: yy + ' ' + SEASON_KO[kind] };
}

/* ── 도시 ──────────────────────────────────────────────
 * 태그·제목에 실제로 쓰는 표기만 넣는다. 추측 확장 금지. */
const CITIES = [
  { re: /(밀란|밀라노|milan|milano|\bmfw\b)/i, ko: '밀란', country: '이탈리아' },
  { re: /(파리|paris|\bpfw\b)/i,               ko: '파리', country: '프랑스' },
  { re: /(런던|london|\blfw\b)/i,              ko: '런던', country: '영국' },
  { re: /(뉴욕|new\s?york|\bnyfw\b)/i,         ko: '뉴욕', country: '미국' },
  { re: /(서울|seoul|\bsfw\b)/i,               ko: '서울', country: '한국' },
  { re: /(도쿄|동경|tokyo)/i,                  ko: '도쿄', country: '일본' },
];

function parseCity(text) {
  const s = String(text || '');
  for (const c of CITIES) if (c.re.test(s)) return c;
  return null;
}

/* ── 화보 종류 ─────────────────────────────────────────── */
const KINDS = [
  { re: /(백스테이지|backstage)/i,                 ko: '백스테이지' },
  { re: /(스트릿\s?스타일|street\s?style)/i,        ko: '스트릿 스타일' },
  { re: /(포토월|photowall|photo\s?wall)/i,        ko: '포토월' },
  { re: /(애프터파티|afterparty|after\s?party)/i,   ko: '애프터파티' },
];

function parseKind(text) {
  const s = String(text || '');
  for (const k of KINDS) if (k.re.test(s)) return k.ko;
  return null;
}

/* ── 촬영자 ────────────────────────────────────────────
 * "Photographer. CLAUDIO K" / "Photographer: NATASHA" / "사진. 홍길동"
 * 줄 끝까지 먹지 않게 길이를 제한한다. 이름이 아닌 문장이 딸려오면 버린다. */
const SHOOTER_RE = /(?:photographer|photography|사진|촬영)\s*[.:·]?\s*([A-Za-z가-힣][A-Za-z가-힣0-9 .&'\-]{1,38})/i;

function parseShooter(text) {
  const m = SHOOTER_RE.exec(String(text || ''));
  if (!m) return null;
  const name = m[1].replace(/\s+/g, ' ').trim().replace(/[.,]+$/, '');
  if (name.length < 2 || name.length > 40) return null;
  // 이름 자리에 문장이 들어온 경우를 막는다 (조사·서술어가 보이면 이름이 아니다)
  if (/(입니다|이다|담았다|했다|있다|합니다|이며|에서|으로)/.test(name)) return null;
  return name;
}

/* ── 브랜드 (백스테이지 전용) ──────────────────────────────
 * 제목이 "루이사 베카리아 FW26 백스테이지 with 밀란 패션 위크" 꼴이다.
 * 시즌 코드 앞부분이 브랜드다. 태그에서 같은 브랜드의 영문 표기를 찾아 붙인다. */
const TAG_NOISE = /(fashion\s?week|패션\s?위크|백스테이지|backstage|street\s?style|스트릿|포토월|photowall|afterparty|애프터파티|밀란|밀라노|milan|파리|paris|런던|london|뉴욕|new\s?york|서울|seoul|mfw|pfw|lfw|nyfw|sfw|pap\s?magazine|팝\s?매거진|party|파티|클럽|trend|fashion)/i;

function parseBrand(title, tags) {
  const t = String(title || '');
  const m = SEASON_RE.exec(t);
  if (!m || m.index <= 0) return null;
  const head = t.slice(0, m.index).trim().replace(/[-–—·,]+$/, '').trim();
  if (!head || head.length > 30) return null;
  if (TAG_NOISE.test(head)) return null;          // "밀란 패션 위크 FW26 ..." 은 브랜드가 아니다
  const list = Array.isArray(tags) ? tags.map(String) : [];
  /* 영문 표기 고르기.
   * À-ÿ 만으로는 KIMHĒKIM 의 Ē(U+0112)가 빠진다 — 라틴 확장 A 까지 넣는다.
   * 후보가 여럿이면 대문자가 많은 쪽을 고른다: 태그에 avavav 와 AVAVAV 가
   * 섞여 들어오는데 브랜드 표기는 대문자 쪽이다. 배열 순서에 기대면
   * 같은 브랜드가 글마다 다르게 찍힌다. */
  const cands = list.filter((x) => /^[A-Za-zÀ-ÿĀ-ſ0-9 .&'’\-]+$/.test(x) && !TAG_NOISE.test(x)
    && !SEASON_RE.test(x) && x.trim().length >= 3 && x.trim() !== head);
  const upper = (x) => (x.match(/[A-ZÀ-ÞĀ-Ž]/g) || []).length;
  cands.sort((a, b) => (upper(b) - upper(a)) || (b.length - a.length));
  /* 대문자가 하나도 없는 후보는 쓰지 않는다. 같은 브랜드인데 어떤 글에는
   * AVAVAV, 어떤 글에는 avavav 로 태그돼 있다. 소문자 태그를 공식 표기인 양
   * 괄호에 넣느니 한글 이름만 쓰는 게 낫다. 모르면 비운다. */
  const en = cands.find((x) => /[A-ZÀ-ÞĀ-Ž]/.test(x));
  return { ko: head, en: en ? en.trim() : null };
}

function photoCount(gallery) {
  if (!Array.isArray(gallery)) return 0;
  return gallery.length;
}

/**
 * 사진 화보 FAQ 생성.
 * @returns {Array<{q:string,a:string}>|null} 사실이 2개 미만이면 null
 */
function buildGalleryFaq(row) {
  if (!row || !row.title) return null;
  const title = String(row.title);
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  const hay = [title, tags.join(' ')].join(' ');

  const season = parseSeason(hay);
  const city = parseCity(hay);
  const kind = parseKind(hay);
  const shooter = parseShooter(row.content);
  const brand = kind === '백스테이지' ? parseBrand(title, tags) : null;
  const n = photoCount(row.gallery);

  const faq = [];

  /* 1) 무엇을 담은 화보인가.
   *    문장을 짧게 유지한다. 예전 판은 "밀란 패션 위크"를 한 답 안에서 두 번
   *    말했다. 그리고 애프터파티·포토월을 "패션 위크의 포토월"이라고 적었는데
   *    그건 사실이 아니다 — PAP x VIPERRR 파티지 패션위크 공식 행사가 아니다.
   *    기간만 말하고 주최를 단정하지 않는다. */
  const label = brand
    ? `${brand.ko}${brand.en ? '(' + brand.en + ')' : ''}`
    : null;
  const week = city ? `${city.ko} 패션 위크` : null;

  if (season && week && kind === '백스테이지' && label) {
    faq.push({
      q: '이 화보는 무엇을 담았나요?',
      a: `${label}의 ${season.ko}(${season.code}) 컬렉션 백스테이지입니다. ${country(city)} ${city.ko}에서 열린 ${week} 기간에 촬영했습니다.`,
    });
  } else if (season && week && (kind === '애프터파티' || kind === '포토월')) {
    faq.push({
      q: '이 화보는 무엇을 담았나요?',
      a: `${season.ko}(${season.code}) ${week} 기간에 ${country(city)} ${city.ko}에서 열린 ${kind} 현장입니다.`,
    });
  } else if (season && week && kind) {
    faq.push({
      q: '이 화보는 무엇을 담았나요?',
      a: `${season.ko}(${season.code}) ${week}의 ${kind}입니다. ${country(city)} ${city.ko}에서 촬영했습니다.`,
    });
  } else if (season && kind) {
    faq.push({
      q: '이 화보는 무엇을 담았나요?',
      a: `${season.ko}(${season.code}) 시즌의 ${kind} 화보입니다.`,
    });
  }

  // 2) 사진 수 — 갤러리에 실제로 들어 있는 값
  if (n >= 3) {
    faq.push({
      q: `이 화보에는 사진이 몇 장 실렸나요?`,
      a: `${n}장입니다.`,
    });
  }

  // 3) 촬영자
  if (shooter) {
    faq.push({
      q: `이 화보는 누가 촬영했나요?`,
      a: `${shooter}가 촬영했습니다.`,
    });
  }

  // 4) 브랜드 (백스테이지인데 1번이 못 만들어진 경우의 보완)
  if (brand && faq.length < 3 && !faq.some((f) => f.a.includes(brand.ko))) {
    faq.push({
      q: `어느 브랜드의 백스테이지인가요?`,
      a: `${brand.ko}${brand.en ? '(' + brand.en + ')' : ''}입니다.`,
    });
  }

  return faq.length >= 2 ? faq.slice(0, 3) : null;
}

function country(city) {
  return city && city.country ? city.country : '';
}

module.exports = { buildGalleryFaq, parseSeason, parseCity, parseKind, parseShooter, parseBrand, photoCount, SEASON_RE };
