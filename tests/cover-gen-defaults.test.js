/**
 * 매거진 커버 생성기 — 기본값과 사진 조절 (2026-11-02)
 * ═══════════════════════════════════════════════════════════════════
 * 도메니코: "커버설정시, 로고크기는 22% 그리고 로고 상단위치는 2.5%를 기본값으로.
 *            그리고 커버에 들어갈 이미지의 크기조절과 위치조절이 가능하게."
 *
 * [기본값] 종전 27% / 6% 는 QA #269 가 6월호 샘플에서 뽑아 고정한 값이었다.
 *   값이 세 군데에 흩어져 있어(슬라이더 value · 라벨 텍스트 · JS 폴백 · 리셋 버튼)
 *   한 곳만 고치면 조용히 어긋난다. 네 곳을 한꺼번에 지킨다.
 *
 * [사진 조절] 종전엔 소스 사진을 가운데 cover-fit 으로 꽉 채우기만 했다.
 *   확대(imgScale)와 이동(imgX/imgY)을 얹되, **캔버스가 비지 않게 가둔다** —
 *   사진이 캔버스보다 큰 만큼만 밀리고 여백이 생기는 방향으론 안 간다.
 *   그래서 확대 100%(= 딱 맞음)에서는 위치 슬라이더가 제자리인 게 정상이다.
 *   100/0/0 은 종전과 픽셀 단위로 같은 그림이어야 한다 — 기존 커버가 바뀌면 안 된다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

/* ── 로고 기본값 22% / 2.5% — 네 군데가 전부 같아야 한다 ── */
t('슬라이더 value 가 22 / 2.5',
  /id="coverLogoSize"[^>]*value="22"/.test(HTML) && /id="coverLogoTop"[^>]*value="2\.5"/.test(HTML));
t('화면에 보이는 라벨도 22% / 2.5%',
  /id="coverLogoSizeLabel"[^>]*>22%</.test(HTML) && /id="coverLogoTopLabel"[^>]*>2\.5%</.test(HTML));
t('JS 폴백(슬라이더가 없을 때)도 22 / 2.5',
  /_num\('coverLogoSize', 22\)/.test(JS) && /_num\('coverLogoTop', 2\.5\)/.test(JS));
t('리셋 버튼도 22 / 2.5 로 되돌린다',
  /\['coverLogoSize',\s*22, '%'\]/.test(JS) && /\['coverLogoTop',\s*2\.5, '%'\]/.test(JS));
t('2.5 가 슬라이더 범위 안이다 (min 이 2.5 보다 크면 브라우저가 올려버린다)',
  /id="coverLogoTop"[^>]*min="1"/.test(HTML));

/* ── 사진 크기·위치 ── */
t('사진 크기·가로·세로 슬라이더가 생겼다',
  /id="coverImgScale"/.test(HTML) && /id="coverImgX"/.test(HTML) && /id="coverImgY"/.test(HTML));
t('세 슬라이더가 커버 생성기 섹션 안에 있다 (델리게이션이 실시간 미리보기를 건다)',
  (() => {
    const i = HTML.indexOf('id="coverGenSection"');
    const j = HTML.indexOf('id="coverImgScale"');
    const k = HTML.indexOf('id="coverLogoSize"');
    return i > -1 && j > i && k > i;
  })());
t('기본값은 100 / 0 / 0 — 종전 그림과 같다',
  /id="coverImgScale"[^>]*value="100"/.test(HTML) &&
  /id="coverImgX"[^>]*value="0"/.test(HTML) &&
  /id="coverImgY"[^>]*value="0"/.test(HTML));
t('축소는 허용하지 않는다 (min 100) — 캔버스에 빈 자리가 생긴다',
  /id="coverImgScale"[^>]*min="100"/.test(HTML));
t('JS 가 세 값을 읽는다', /_num\('coverImgScale', 100\)/.test(JS) && /_num\('coverImgX', 0\)/.test(JS) && /_num\('coverImgY', 0\)/.test(JS));
t('리셋 버튼이 세 값도 되돌린다',
  /\['coverImgScale',\s*100, '%'\]/.test(JS) && /\['coverImgX',\s*0, '%'\]/.test(JS) && /\['coverImgY',\s*0, '%'\]/.test(JS));
t('합성이 확대를 cover-fit 배율에 곱한다',
  /var scale = Math\.max\(W \/ iw, H \/ ih\) \* \(sty\.imgScale \/ 100\);/.test(JS));
t('합성이 캔버스 밖으로 밀리지 않게 가둔다',
  /dx = Math\.min\(0, Math\.max\(W - dw, dx\)\);/.test(JS) &&
  /dy = Math\.min\(0, Math\.max\(H - dh, dy\)\);/.test(JS));
t('스타일 값을 한 번만 읽는다 (합성 중 슬라이더 값이 갈리지 않게)',
  (JS.match(/var sty = _papCoverReadStyleOpts\(\);/g) || []).length === 1);
t('브라우저 캐시 버전을 올렸다 (안 올리면 옛 JS 가 그대로 돈다)',
  /pap-admin\.js\?v=(17[1-9]|1[89]\d|[2-9]\d\d)/.test(HTML));

/* ── 실제로 계산해 본다: 가두기 규칙이 맞는지 ──────────────────
   합성 함수는 모듈이 아니라 꺼낼 수 없으므로, 같은 식을 세워 경계를 확인한다.
   (위 정규식이 소스에 이 식이 실제로 있다는 것을 보장한다.) */
function place(W, H, iw, ih, imgScale, imgX, imgY) {
  const scale = Math.max(W / iw, H / ih) * (imgScale / 100);
  const dw = iw * scale, dh = ih * scale;
  let dx = (W - dw) / 2 + W * (imgX / 100);
  let dy = (H - dh) / 2 + H * (imgY / 100);
  dx = Math.min(0, Math.max(W - dw, dx));
  dy = Math.min(0, Math.max(H - dh, dy));
  return { dx, dy, dw, dh };
}
{
  const r = place(1080, 1350, 1080, 1350, 100, 0, 0);
  t('딱 맞는 사진 · 기본값이면 (0,0) 에 원본 크기', r.dx === 0 && r.dy === 0 && r.dw === 1080 && r.dh === 1350);
}
{
  const r = place(1080, 1350, 1080, 1350, 100, 40, -40);
  t('확대 100% 에서는 위치를 밀어도 제자리 (밀 여유가 없다)', r.dx === 0 && r.dy === 0);
}
{
  const r = place(1080, 1350, 1080, 1350, 200, 0, 0);
  t('확대 200% 는 가운데 정렬로 절반씩 넘친다', r.dw === 2160 && r.dh === 2700 && r.dx === -540 && r.dy === -675);
}
{
  /* +100 = 오른쪽/아래로 끝까지 → 사진의 왼쪽·위 모서리가 캔버스 모서리에 붙는다. */
  const r = place(1080, 1350, 1080, 1350, 200, 100, 100);
  t('한쪽 끝까지 밀면 모서리에 붙고 더 가지 않는다', r.dx === 0 && r.dy === 0);
}
{
  /* -100 = 왼쪽/위로 끝까지 → 사진의 오른쪽·아래 모서리가 캔버스 모서리에 붙는다. */
  const r = place(1080, 1350, 1080, 1350, 200, -100, -100);
  t('반대쪽 끝도 마찬가지 — 빈 자리가 생기지 않는다',
    r.dx === -1080 && r.dy === -1350 && r.dx + r.dw === 1080 && r.dy + r.dh === 1350);
}
{
  /* 어떤 값을 넣어도 네 변이 캔버스를 덮는다 — 빈 자리 0. */
  let worst = true;
  for (const sc of [100, 101, 150, 200, 300]) {
    for (const px of [-100, -37, 0, 37, 100]) {
      for (const py of [-100, -37, 0, 37, 100]) {
        const r = place(1080, 1350, 1600, 900, sc, px, py);
        if (!(r.dx <= 0 && r.dy <= 0 && r.dx + r.dw >= 1080 - 1e-9 && r.dy + r.dh >= 1350 - 1e-9)) worst = false;
      }
    }
  }
  t('75개 조합 어디서도 캔버스에 빈 자리가 생기지 않는다', worst);
}
{
  const r = place(1080, 1350, 4000, 1000, 100, 0, 0);
  t('가로로 긴 사진도 세로를 꽉 채우고 좌우만 잘린다', Math.round(r.dh) === 1350 && r.dw > 1080 && r.dy === 0);
}

t('테스트 스크립트 등록', /cover-gen-defaults\.test\.js/.test(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
