/**
 * QA #301 — 크레딧 정규화 공유 헬퍼
 *
 * 출처: 본래 review.js (서브미션 → 에디토리얼 변환) 의 _normalizeCreditFields
 * 만 가지고 있던 정규화 로직을, editorials / films POST·PUT 에서도 동일
 * 하게 적용할 수 있도록 공유 lib 로 추출.
 *
 * 다루는 변형:
 *   1. name 칸에 @handle 만 들어간 케이스 → instagram 으로 swap
 *   2. name 칸에 https://... 만 들어간 케이스 → website 로 swap
 *   3. instagram 칸에 https://... 가 들어간 케이스 → website 로 swap
 *   4. instagram 이 @ 없이 들어온 경우 → @ 자동 보강
 *
 * 진단 결과 (QA #301):
 *   - submission 폼 / submission POST·PUT 은 정규화 0 → 입력 그대로 저장
 *   - review.js 만 _normalizeCreditFields 호출 → editorial 생성 시 @ 강제
 *   - editorial POST·PUT 은 정규화 0 → admin 이 직접 편집·저장하면
 *     @ 없는 데이터가 그대로 들어감 (운영자 보고의 실제 깨짐 지점)
 *   - film POST·PUT 도 동일 패턴
 *
 * 해결: 모든 저장 경로가 본 헬퍼를 호출 → DB 에 들어가는 instagram 값은
 *       항상 `@xxx` 또는 빈 문자열. 출력 측은 별도 변환 없이 그대로 쓰면 일관.
 */

function normalizeCreditFields(rawName, rawInstagram, rawWebsite) {
  let name      = String(rawName      == null ? '' : rawName).trim();
  let instagram = String(rawInstagram == null ? '' : rawInstagram).trim();
  let website   = String(rawWebsite   == null ? '' : rawWebsite).trim();

  // 이름 자리에 @handle 이 들어있고 instagram 이 비어있으면 swap.
  if (!instagram && /^@\S+$/.test(name)) {
    instagram = name;
    name = '';
  }
  // 이름 자리에 https URL 이 들어있고 website 가 비어있으면 swap.
  if (!website && /^https?:\/\//i.test(name)) {
    website = name;
    name = '';
  }
  // instagram 자리에 https URL 이 들어있고 website 가 비어있으면 swap.
  if (!website && /^https?:\/\//i.test(instagram)) {
    website = instagram;
    instagram = '';
  }
  // instagram 이 @ 없이 들어있으면 보강. URL 형태는 건드리지 않음.
  if (instagram && !/^@/.test(instagram) && !/^https?:\/\//i.test(instagram)) {
    instagram = '@' + instagram.replace(/^@+/, '');
  }

  return { name, instagram, website };
}

/**
 * Credits 배열을 통째로 정규화. credit row 의 기존 필드 (roles, role, …)
 * 는 그대로 보존하면서 name / instagram / website 만 재계산.
 *
 * editorials 의 credits 는 보통 [{roles:['Photographer'], name, instagram, website}, …]
 * films 의 credits 는 신/구 스키마 혼재 — 양쪽 모두 안전하게 통과.
 */
function normalizeCreditsArray(credits) {
  if (!Array.isArray(credits)) return credits;
  return credits.map(function (c) {
    if (!c || typeof c !== 'object') return c;
    const fixed = normalizeCreditFields(c.name, c.instagram, c.website);
    return Object.assign({}, c, fixed);
  });
}

module.exports = {
  normalizeCreditFields,
  normalizeCreditsArray,
};
