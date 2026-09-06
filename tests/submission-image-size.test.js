/**
 * 제출 이미지 권장 크기 — 세 숫자가 어긋나지 않는다 (2026-09-06 신설)
 *
 * ■ 무슨 일이 있었나
 * GSC AMP 경고("이미지 크기가 권장 크기보다 작음")를 파다가, 우리가 제출자에게
 * **서로 다른 세 숫자**를 주고 있는 걸 찾았다.
 *
 *   uploadHint (9개 언어)        권장 1080×1350px   ← 긴 변 1350
 *   toastImgLongestPx (9개 언어)  권장 긴 변 1500px 이상
 *   checkImageDimensions (코드)   if (longest < 1500) 경고
 *
 * **우리가 권장한 크기를 그대로 올리면 우리 경고가 떴다** (1350 < 1500).
 * 그리고 1080 폭으로 저장되니 AMP 리포트의 구형 1200px 규칙에도 계속 걸렸다.
 *
 * ■ 왜 하네스가 필요한가
 * 이 숫자는 9개 언어 × 3종류 = 서른 몇 군데에 흩어져 있다. 한 곳만 고치면
 * 다시 어긋나고, 어긋나도 아무도 모른다 (제출자만 안다).
 * 이 저장소가 오늘만 세 번 겪은 "규칙이 두 벌이면 한쪽만 고쳐진다" 그대로다.
 *
 * ■ 무엇을 지키나
 *   ① 안내 문구의 권장 크기가 9개 언어에서 전부 같다
 *   ② 코드의 경고 기준 = 권장의 긴 변 (권장대로 올리면 경고가 안 뜬다)
 *   ③ 권장 크기가 리사이즈 상한(MAX_DIM) 안에 있다 (안 그러면 저장 때 줄어든다)
 *   ④ 권장 폭이 1200px 이상 (AMP 리포트가 쓰는 구형 기준)
 *   ⑤ 어드민의 인스타그램 출력 규격 1080×1350 은 **그대로 둔다** (다른 목적이다)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SUB = fs.readFileSync(path.join(ROOT, 'frontend/submission.html'), 'utf8');
const SUBS = fs.readFileSync(path.join(ROOT, 'frontend/submissions.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}

/* 권장값은 코드에서 읽는다. 여기에 숫자를 적으면 그것도 네 번째 벌이 된다. */
const hints = (SUB.match(/uploadHint:'[^']*'/g) || []);
const sizes = hints.map((h) => { const m = /(\d{3,4})×(\d{3,4})px/.exec(h); return m ? m[1] + 'x' + m[2] : null; });

console.log('\n=== ① 9개 언어가 같은 숫자를 말한다 ===');
{
  t('uploadHint 를 9개 언어에서 찾았다', hints.length === 9, hints.length);
  t('전부 크기를 담고 있다', sizes.every(Boolean), JSON.stringify(sizes));
  t('아홉 개가 전부 같다', new Set(sizes).size === 1, JSON.stringify([...new Set(sizes)]));
}

const [W, H] = (sizes[0] || '0x0').split('x').map(Number);
const LONGEST = Math.max(W, H);

console.log('\n=== ② 권장대로 올리면 우리 경고가 뜨지 않는다 ===');
{
  const m = /if\(longest<(\d+)\)/.exec(SUB);
  const 기준 = m ? Number(m[1]) : 0;
  t('경고 기준을 코드에서 읽었다', 기준 > 0, 기준);
  t('권장의 긴 변 >= 경고 기준  ← 이게 어긋나 있었다',
    LONGEST >= 기준, '권장 ' + W + '×' + H + ' (긴 변 ' + LONGEST + ') · 경고 기준 ' + 기준);
  const toasts = (SUB.match(/toastImgLongestPx:'[^']*'/g) || []);
  t('토스트 문구를 9개 언어에서 찾았다', toasts.length === 9, toasts.length);
  const nums = toasts.map((x) => { const mm = /(\d{3,4})\s*px/.exec(x); return mm ? Number(mm[1]) : 0; });
  t('토스트가 말하는 숫자 = 코드 기준', nums.every((v) => v === 기준), JSON.stringify(nums));
}

console.log('\n=== ③ 리사이즈 상한 안에 있다 ===');
{
  const m = /var MAX_DIM = opts\.maxDim \|\| (\d+);/.exec(SUB);
  const cap = m ? Number(m[1]) : 0;
  t('MAX_DIM 을 코드에서 읽었다', cap > 0, cap);
  t('권장의 긴 변 <= MAX_DIM (안 그러면 저장 때 줄어든다)', LONGEST <= cap,
    '긴 변 ' + LONGEST + ' · 상한 ' + cap);
}

console.log('\n=== ④ 권장 폭이 AMP 구형 기준을 넘는다 ===');
{
  /* GSC AMP 리포트는 폭 1200px 이상을 본다. 비심각 경고지만, 앞으로 올라올
     화보까지 계속 걸리게 둘 이유는 없다. 과거 화보는 못 고친다. */
  t('권장 폭 >= 1200px', Math.min(W, H) >= 1200, '폭 ' + Math.min(W, H));
  t('4:5 비율을 유지한다 (인스타그램 피드)', Math.abs((W / H) - 0.8) < 0.01, W + '×' + H);
}

console.log('\n=== ⑤ 공개 안내 페이지도 같은 숫자다 ===');
{
  t('submissions.html 본문이 같은 크기를 말한다',
    SUBS.indexOf(W + '×' + H + 'px') !== -1, '찾는 값: ' + W + '×' + H + 'px');
  t('FAQ 구조화 데이터도 같다 (구글이 읽는 표면)',
    (SUBS.match(new RegExp(W + '×' + H + 'px', 'g')) || []).length >= 2);
  t('옛 숫자가 남아 있지 않다', !/1500px\+|longest side 1500px/.test(SUBS));
}

console.log('\n=== ⑥ 인스타그램 출력 규격은 건드리지 않았다 ===');
{
  /* 1080×1350 은 **인스타그램 피드 출력** 규격으로는 맞다. 문제는 그걸
     원본 업로드 권장으로도 쓴 것이었다. 어드민의 IG 생성 규격은 그대로 둔다. */
  t('어드민의 IG 이미지 생성 규격 1080×1350 유지',
    (ADMIN.match(/1080×1350/g) || []).length >= 4,
    '이 값은 인스타그램 피드 4:5 규격이다. 원본 업로드 권장과 다른 물건이다.');
  t('제출 페이지에는 옛 권장이 안 남아 있다',
    !/권장 1080×1350px|1080×1350px recommended/.test(SUB));
}

console.log('\n' + (fail ? '✗' : '✓') + ' submission-image-size: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
