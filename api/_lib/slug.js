/**
 * PAP Magazine — URL 슬러그 생성 유틸 (QA 2026-07 #7)
 *
 * 배경: 기존 generateArticleSlug 는 "한글/CJK 는 그대로 둔다"는 정책이라
 * 관리자·시드 기사 URL 이 퍼센트 인코딩(%EA%B2%90%EC%A1%B0…)으로 노출됐다.
 * 인스타그램 연동 기사는 영문 슬러그라 유형별로 URL 형식이 혼재 → 공유·SEO·
 * 가독성 모두 불리. 이 모듈은 모든 기사에 대해 일관된 ASCII 슬러그를 만든다.
 *
 * 우선순위:
 *   1) 영문 제목(title_en)이 있으면 그것으로 슬러그 생성 (가장 깔끔)
 *   2) 없으면 한글 제목을 국어의 로마자 표기법으로 음역 후 슬러그화
 *   3) 그래도 비면 'article' 폴백
 *
 * 기존에 한글 슬러그로 발행된 기사는 건드리지 않는다(공유 링크·색인 보존).
 * SSR(/article/:slug)은 slug·custom_url·title 폴백 체인을 갖고 있어 옛 링크는
 * 계속 해석된다. 신규 기사부터 ASCII 슬러그로 통일된다.
 */

/* 국어의 로마자 표기법(Revised Romanization) — 음절 단위 매핑.
   한글 음절(U+AC00–U+D7A3)은 초성19 × 중성21 × 종성28 로 분해된다. */
const INITIALS = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const MEDIALS  = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const FINALS   = ['','k','k','k','n','n','n','t','l','k','m','l','l','l','p','l','m','p','p','t','t','ng','t','t','k','t','p','t'];

function romanizeKorean(input) {
  let out = '';
  for (const ch of String(input || '')) {
    const code = ch.codePointAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const s = code - 0xAC00;
      out += INITIALS[Math.floor(s / 588)]
           + MEDIALS[Math.floor((s % 588) / 28)]
           + FINALS[s % 28];
    } else {
      out += ch;
    }
  }
  return out;
}

/* 임의 문자열 → 소문자 ASCII 슬러그.
   악센트 분해(NFD) 후 결합문자 제거 → 라틴 확장(é→e) 처리. 남은 비-ASCII 는
   버리고, 공백/기호는 하이픈으로 접는다. */
function toAsciiSlug(input, maxLen = 80) {
  const s = String(input || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // 결합 악센트 제거
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // 영숫자 외 전부 하이픈
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .replace(/-$/, '');                // 자르면서 생긴 꼬리 하이픈 제거
  return s;
}

/**
 * 기사 슬러그 생성. title_en 우선, 없으면 한글 제목을 로마자 음역.
 * @param {string} title    원 제목(한글일 수 있음)
 * @param {string} [titleEn] 영문 제목(있으면 우선 사용)
 * @returns {string} ASCII 슬러그 (항상 비어있지 않음)
 */
function generateAsciiSlug(title, titleEn) {
  const fromEn = toAsciiSlug(titleEn);
  if (fromEn) return fromEn;
  const fromKo = toAsciiSlug(romanizeKorean(title));
  if (fromKo) return fromKo;
  return 'article';
}

/**
 * 같은 슬러그가 이미 있으면 -2, -3 … 을 붙여 유일하게 만든다.
 * @param {object} supabase  supabaseAdmin 클라이언트
 * @param {string} table     'articles' 등
 * @param {string} base      generateAsciiSlug 결과
 * @param {string} [excludeId] 수정 시 자기 자신 제외
 */
async function ensureUniqueSlug(supabase, table, base, excludeId) {
  let candidate = base;
  for (let n = 2; n <= 50; n++) {
    let q = supabase.from(table).select('id').eq('slug', candidate).limit(1);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) return candidate;          // 조회 실패 시 후보 그대로 (저장은 진행)
    if (!data || !data.length) return candidate;
    candidate = base + '-' + n;
  }
  return candidate;
}

module.exports = { romanizeKorean, toAsciiSlug, generateAsciiSlug, ensureUniqueSlug };
