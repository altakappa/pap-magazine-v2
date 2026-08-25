/**
 * 풀레터 자동 발급 (2026-08-24 신설, 도메니코 지시)
 *
 * "어드민에서 발급을 누르면 포토그래퍼·스타일리스트 이름과 발급일이
 *  자동으로 들어간 풀레터 PDF 가 만들어져 신청자가 다운받을 수 있어야 한다."
 *
 * 지키는 것:
 *  ① 발급 경로 — PDF 미첨부 발급 시 자동 생성이 돌고, 수동 첨부는 그대로 산다
 *  ② 정직성 — 이름이 없으면 만들지 않고 사람에게 알린다, 실패를 issued 로 덮지 않는다
 *  ③ 생성기 — 실제로 유효한 PDF 를 만든다 (스모크: %PDF 헤더·xref·EOF)
 *  ④ 발행 원칙 — 자동 발급은 관리자의 'issued' 클릭 안에서만 돈다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, fn) {
  try { fn(); pass++; console.log('  ✓', n); }
  catch (e) { fail++; console.log('  ✗', n, '—', e.message); }
}

const REV = R('api/pullletters/[id]/review.js');
const GEN = R('api/_lib/pullLetterPdf.js');
const ADMIN = R('frontend/pap-admin.js');

console.log('\n[1] 발급 경로');
t('issued + 미첨부 → 자동 생성 경로가 존재한다', () => {
  assert.ok(/generatePullLetterPdf/.test(REV), '자동 생성 호출이 없다');
});
t('수동 첨부(_plPath)가 우선한다 — 특수 공문의 탈출구', () => {
  assert.ok(/if \(_plPath\) update\.pull_letter_url = _plPath;\s*\n\s*else \{/.test(REV));
});
t('자동 발급은 status===issued 분기 안에서만 돈다 (발행 판단은 사람)', () => {
  const idx = REV.indexOf('generatePullLetterPdf');
  const issuedIdx = REV.indexOf("if (status === 'issued')");
  assert.ok(issuedIdx >= 0 && idx > issuedIdx, 'issued 분기 밖에서 생성한다');
});
t('생성 PDF 는 비공개 pull-letters 버킷으로 간다', () => {
  assert.ok(/from\('pull-letters'\)\s*\n?\s*\.upload\(autoPath/.test(REV.replace(/\r/g,'')) || /storage\s*\n\s*\.from\('pull-letters'\)/.test(REV));
});

console.log('\n[2] 정직성');
t('이름이 없으면 400 — 빈 공문을 조용히 내보내지 않는다', () => {
  assert.ok(/auto_issue_missing_names/.test(REV));
});
t('생성 실패는 500 — issued 로 덮지 않는다', () => {
  assert.ok(/auto_issue_failed/.test(REV));
  const failIdx = REV.indexOf('auto_issue_failed');
  const updateIdx = REV.indexOf(".update(update)");
  assert.ok(failIdx < updateIdx, '실패 반환이 DB update 뒤에 있다');
});

console.log('\n[3] 생성기 스모크 (실제 PDF)');
t('유효한 PDF 를 만든다 — 헤더·xref·EOF·이미지 스트림', () => {
  const { jpegToPdf } = require(path.join(ROOT, 'api/_lib/pullLetterPdf'));
  // sharp 없이도 돌게 최소 JPEG(1x1) 로 래퍼만 검증 — 조판은 celebThumb 스택이 이미 검증
  const tinyJpeg = Buffer.from('ffd8ffdb004300ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc00b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f00ffd9','hex');
  const pdf = jpegToPdf(tinyJpeg, 1, 1);
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'), 'PDF 헤더 없음');
  assert.ok(s.includes('xref'), 'xref 없음');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'EOF 없음');
  const m = s.match(/startxref\n(\d+)/);
  assert.ok(m && s.slice(Number(m[1]), Number(m[1]) + 4) === 'xref', 'startxref 오프셋이 어긋난다');
  assert.ok(s.includes('/DCTDecode'), '이미지 스트림 없음');
});
t('이름이 비면 생성기가 던진다', () => {
  const gen = require(path.join(ROOT, 'api/_lib/pullLetterPdf'));
  assert.rejects === undefined; // node 구버전 호환 — 아래 수동 검사
  let threw = false;
  return gen.generatePullLetterPdf({ photographer: '', stylist: 'x', docNo: 'a', issueDateText: 'b' })
    .catch(() => { threw = true; })
    .then(() => assert.ok(threw, '빈 이름인데 안 던졌다'));
});
t('문서번호는 재현 가능하다 (발급일+id)', () => {
  const { docNoFor } = require(path.join(ROOT, 'api/_lib/pullLetterPdf'));
  const d = new Date('2026-08-24T00:00:00Z');
  assert.strictEqual(docNoFor('9ff69ad7-15e3-46c6', d), 'PL-20260824-9FF69AD7');
});

console.log('\n[4] 발급 전 미리보기 (2026-08-25)');
t('미리보기 API 가 존재하고 관리자 전용이다', () => {
  const PREV = R('api/pullletters/[id]/preview.js');
  assert.ok(/requireAdmin/.test(PREV), '누구나 남의 신청 미리보기를 보면 안 된다');
  assert.ok(/letterSvg/.test(PREV), '발급과 같은 렌더러를 써야 미리보기가 거짓말하지 않는다');
  assert.ok(/no-store/.test(PREV), '이름·날짜가 실시간이라 캐시하면 옛 그림을 보여준다');
});
t('어드민 모달이 미리보기를 자동으로 싣는다', () => {
  assert.ok(/_loadPullLetterPreview/.test(ADMIN), '미리보기 로드가 없다');
  assert.ok(/plrPreviewBox/.test(ADMIN), '미리보기 자리가 없다');
});

console.log('\n[5] 어드민 안내');
t('미첨부 발급이 자동 생성임을 화면이 말해준다', () => {
  assert.ok(/자동 생성/.test(ADMIN), '안내가 없으면 관리자는 파일을 매번 만들어야 하는 줄 안다');
});

Promise.resolve().then(() => {
  setTimeout(() => {
    console.log('\n풀레터 자동 발급: ' + pass + '건 통과' + (fail ? ' · ' + fail + '건 실패' : ''));
    if (fail) process.exit(1);
  }, 100);
});
