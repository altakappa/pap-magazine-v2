/**
 * 텍스트·보더 대비(WCAG) 회귀 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA: 서브미션·풀레터 제출 페이지의 텍스트와 보더가 낮은 투명도로
 * 처리돼 어두운 배경 대비 가독성이 떨어짐.
 *
 * ── 측정 ────────────────────────────────────────────────────────────
 * 두 페이지 배경은 순수 검정(#000)이라 흰색 알파값이 곧 대비율을 정한다:
 *   α0.15 → 1.39:1   α0.30 → 2.45:1   α0.40 → 3.66:1
 *   α0.50 → 5.32:1(AA 하한)   α0.55 → 6.27:1   α0.60 → 7.37:1(AAA)
 *
 * 수정 전 submission.html 은 텍스트 선언 83개 중 36개가 AA 미달이었고
 * 최저는 α0.15 = 1.39:1 로 사실상 읽을 수 없는 수준이었다.
 *
 * ── 기준 (도메니코 결정) ────────────────────────────────────────────
 *   · 텍스트 하한 α0.55 (6.27:1) — AA(4.5:1)를 여유있게 넘기면서
 *     에디토리얼한 절제된 톤을 유지하는 지점.
 *   · UI 보더(입력란·버튼 경계) 하한 α0.35 (3.0:1) — WCAG 1.4.11.
 *   · 장식용 구분선(divider/::after/progress 등)은 예외. UI 경계가
 *     아니라 WCAG 대상이 아니고, 여기까지 올리면 와이어프레임처럼
 *     보여 다크 테마의 톤앤매너가 무너진다.
 *
 * 이 테스트는 위 하한이 다시 내려가는 것을 막는다. 색상 값은 디자인
 * 조정 중에 슬금슬금 낮아지기 쉽고, 낮아져도 개발자 눈엔 잘 안 띈다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const TEXT_MIN = 0.55;   // 6.27:1
const BORDER_MIN = 0.35; // 3.00:1
const TARGETS = ['frontend/submission.html', 'frontend/pullletter.html'];

// UI 경계가 아닌 장식 요소 — 보더 하한 예외
const SKIP_BORDER = /divider|::after|::before|-line\b|progress|track|hr\b|separator/i;

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

// 흰색 알파를 검정 배경에 합성했을 때의 WCAG 대비율
function contrast(alpha) {
  const v = 255 * alpha / 255;
  const l = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return (l + 0.05) / 0.05;
}

console.log('\n=== 대비율 계산 검증 (기준선) ===');
t('α0.55 는 AA(4.5:1) 통과', contrast(0.55) >= 4.5, contrast(0.55).toFixed(2) + ':1');
t('α0.35 는 UI 경계(3:1) 통과', contrast(0.35) >= 2.99, contrast(0.35).toFixed(2) + ':1');
t('α0.40 은 본문 AA 미달 (기준이 유효함을 확인)', contrast(0.40) < 4.5);

for (const rel of TARGETS) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const css = (src.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || [])
    .map((b) => b.replace(/<\/?style[^>]*>/g, '')).join('\n');

  console.log(`\n=== ${path.basename(rel)} ===`);
  t('인라인 <style> 을 찾았다', css.length > 0);

  // ⚠ 2026-07-21 범위 확대 — 처음엔 <style> 블록만 검사했는데, 그건 내가
  // 고친 범위와 똑같아서 "미달 0개"가 나와도 실제 화면은 그대로였다.
  // 서브미션 페이지는 HTML 인라인 style="" 속성과 JS 로 만드는 요소에도
  // 색상이 58곳 박혀 있었고 QA 스크린샷의 흐린 부분이 전부 거기였다.
  // 검증 범위를 수정 범위에 맞추면 테스트가 아무것도 못 막는다 —
  // 이제 파일 전체를 본다.
  const texts = [...src.matchAll(/color:\s*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/g)]
    .map((m) => parseFloat(m[1]));
  const lowText = texts.filter((a) => a < TEXT_MIN);
  t(`텍스트 ${texts.length}개 전부 α≥${TEXT_MIN} (파일 전체 — style+인라인+JS)`,
    lowText.length === 0,
    lowText.length ? '미달: ' + [...new Set(lowText)].sort().join(', ') : '');

  // 보더 — 장식 요소 제외
  const lowBorder = [];
  for (const rm of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = rm[1].trim(), body = rm[2];
    if (SKIP_BORDER.test(sel)) continue;
    for (const bm of body.matchAll(/border[a-z-]*:\s*(?:[^;]*?\s)?rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/g)) {
      const a = parseFloat(bm[1]);
      if (a < BORDER_MIN) lowBorder.push(`α${a} ${sel.slice(0, 30)}`);
    }
  }
  t(`UI 보더 전부 α≥${BORDER_MIN} (3:1 이상)`, lowBorder.length === 0,
    lowBorder.slice(0, 3).join(' / '));

  // 톤앤매너 보호: 전부 흰색으로 밀어버리지 않았는지.
  // 대비만 좇아 α1.0 으로 다 올리면 위계가 사라지고 화면이 평평해진다.
  const solidRatio = texts.filter((a) => a >= 0.95).length / (texts.length || 1);
  t('전부 불투명 흰색으로 밀지 않았다 (위계 유지)', solidRatio < 0.5,
    '불투명 비율 ' + Math.round(solidRatio * 100) + '%');
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ contrast tests FAILED'); process.exit(1); }
console.log('✅ contrast tests passed');
