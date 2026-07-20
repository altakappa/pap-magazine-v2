/**
 * 커스텀 select 화살표 렌더링 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA: 서브미션 제출 페이지 팀 크레딧의 "@ 인스타그램" select 화살표가
 * 다른 요소와 겹쳐 보임.
 *
 * ── 원인 ────────────────────────────────────────────────────────────
 * 화살표 SVG 를 data URI 배경으로 넣으면서 `width`/`height` 를 빼먹고
 * viewBox 만 준 것. SVG 는 viewBox 만 있으면 "고유 크기 없음 + 비율만
 * 있음" 상태가 되고, CSS 배경 이미지의 기본값 background-size:auto 는
 * 이런 이미지를 배경 영역(= select 높이 약 37px)에 맞춰 늘린다.
 * 12px 짜리 갈매기 화살표가 37px 로 부풀어 텍스트 위를 덮었다.
 * (브라우저 기본 화살표와의 중복이 아니다 — appearance:none 은 정상
 *  적용돼 있었다. QA 가 추정한 원인과 실제 원인이 달랐던 케이스.)
 *
 * 사이트의 다른 화살표들은 전부 width='12' height='12' 를 갖고 있었고,
 * 이 한 곳만 빠져 있었다.
 *
 * ── 이 테스트가 막는 것 ────────────────────────────────────────────
 * appearance:none 으로 기본 화살표를 지운 select 에 SVG 배경 화살표를
 * 넣을 때, 크기를 명시하지 않으면 실패시킨다. 눈으로 봐야만 알 수 있는
 * 종류의 버그라 사람이 놓치기 쉽다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

// select 관련 CSS 규칙을 긁어온다 (인라인 <style> 과 .css 파일 모두).
function collectSelectRules() {
  const files = []
    .concat(fs.readdirSync(path.join(ROOT, 'frontend'))
      .filter((f) => /\.(html|css)$/.test(f))
      .map((f) => path.join(ROOT, 'frontend', f)));
  const rules = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /([.#]?[a-zA-Z0-9_-]*select[a-zA-Z0-9_-]*[^{}]*)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      rules.push({ file: path.basename(file), selector: m[1].trim().slice(0, 40), body: m[2] });
    }
  }
  return rules;
}

const rules = collectSelectRules();

console.log('\n=== select 규칙 수집 ===');
t('frontend 에서 select 규칙을 찾았다 (' + rules.length + '개)', rules.length > 0);

console.log('\n=== SVG 배경 화살표는 반드시 크기가 명시돼야 한다 ===');
// 위반 = appearance:none + SVG data URI 배경인데, background-size 도 없고
//        SVG 자체에 width/height 도 없는 경우 → 배경 영역만큼 부풀어 겹친다.
const offenders = rules.filter((r) => {
  // SVG data URI 는 두 가지 형태로 쓰인다: 원문 그대로(<svg …>)와
  // 퍼센트 인코딩(%3Csvg …%3E). 둘 다 잡아야 오탐/누락이 없다.
  // (실제로 pullletter.html 은 인코딩형이라 처음 만든 정규식이 오탐을 냈다)
  const b = r.body.replace(/%3C/gi, '<').replace(/%3E/gi, '>');
  if (!/appearance\s*:\s*none/.test(b)) return false;
  if (!/background-image\s*:\s*url\(["']?data:image\/svg\+xml/.test(b)) return false;
  const hasSize = /background-size\s*:/.test(b);
  const hasWH = /<svg[^>]*\swidth=/.test(b) && /<svg[^>]*\sheight=/.test(b);
  return !hasSize && !hasWH;
});
t('크기 미지정 SVG 화살표가 없다', offenders.length === 0,
  offenders.map((o) => o.file + ' — ' + o.selector).join('\n       '));

console.log('\n=== 서브미션 팀 크레딧 select (QA 신고 대상) ===');
const sub = fs.readFileSync(path.join(ROOT, 'frontend/submission.html'), 'utf8');
const m = sub.match(/\.team-link-type\s*\{([^}]*)\}/);
t('.team-link-type 규칙이 있다', !!m);
if (m) {
  const b = m[1];
  t('기본 화살표 제거 (appearance:none)', /(-webkit-)?appearance\s*:\s*none/.test(b));
  t('커스텀 화살표 배경 있음', /background-image\s*:\s*url/.test(b));
  t('SVG 에 width 지정', /<svg[^>]*\swidth='12'/.test(b));
  t('SVG 에 height 지정', /<svg[^>]*\sheight='12'/.test(b));
  t('background-size 명시 (이중 안전장치)', /background-size\s*:\s*12px\s+12px/.test(b));
  t('화살표 자리 확보 (padding-right)', /padding-right\s*:\s*24px/.test(b));
  // data URI 안의 rgba( 는 괄호·쉼표 때문에 파서에 따라 취약하다.
  // 사이트의 다른 화살표들과 동일하게 hex + stroke-opacity 를 쓴다.
  t('stroke 에 rgba() 미사용 (data URI 안전)', !/stroke='rgba\(/.test(b));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ select-arrow tests FAILED'); process.exit(1); }
console.log('✅ select-arrow tests passed');
