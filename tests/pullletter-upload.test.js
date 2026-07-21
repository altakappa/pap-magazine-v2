/**
 * 풀레터 촬영시안 PDF 업로드 제한 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * 도메니코 지시: 풀레터 PDF 첨부는 20MB 이하로 제한.
 *
 * ── 손대기 전 상태 (실측) ──────────────────────────────────────────
 *   · 화면 안내: "PDF only · max 50MB"
 *   · 촬영시안 PDF 검증: 타입만 확인, 용량 검증 자체가 없었음
 *   · 서버(api/pullletters/index.js): maxFileSize 50MB
 *   → 안내는 50MB, 실제 상한도 50MB, 그런데 프론트는 아무 검증도 안 해서
 *     큰 파일이 업로드 단계까지 갔다가 서버에서 잘렸다.
 *
 * 참고: 같은 페이지의 "참고 이미지" 업로더(addFiles)는 이미 20MB 였다.
 * 즉 한 페이지 안에서 두 업로더의 상한이 20/50 으로 갈려 있었다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 * 프론트 상수 · 화면 문구 · 서버 상한 세 곳이 전부 20MB 로 일치해야 한다.
 * 하나만 바꾸면 실패한다 — 예전에 안내(50MB)와 실제 동작이 어긋났던
 * 것과 같은 상황을 다시 만들지 않기 위해서다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const LIMIT_MB = 20;
let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const front = fs.readFileSync(path.join(ROOT, 'frontend/pullletter.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'api/pullletters/index.js'), 'utf8');

console.log('\n=== 프론트 상한 ===');
const m = front.match(/var PROPOSAL_MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
t('PROPOSAL_MAX_BYTES 상수가 선언돼 있다', !!m);
t(`상수가 ${LIMIT_MB}MB`, m && parseInt(m[1], 10) === LIMIT_MB, m ? m[1] + 'MB' : '');

console.log('\n=== 검증 위치 (두 군데 다 있어야) ===');
t('파일 선택 즉시 용량 검증', /_onProposalSelected[\s\S]{0,600}?f\.size\s*>\s*PROPOSAL_MAX_BYTES/.test(front));
t('제출 직전에도 재검증 (input 조작 방어)',
  /proposalFile\.size\s*>\s*PROPOSAL_MAX_BYTES/.test(front));

console.log('\n=== 화면 문구 (실제 동작과 일치) ===');
t('영문 안내가 20MB', /PDF only · max 20MB/.test(front));
t('한글 안내가 20MB', /PDF 전용 · 최대 20MB/.test(front));
t('50MB 표기가 남아있지 않다', !/max 50MB|최대 50MB/.test(front),
  (front.match(/[^\n]*50MB[^\n]*/g) || []).slice(0, 2).join(' / '));

console.log('\n=== 용량 초과 안내 문구 (다국어) ===');
const langs = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
const block = (front.match(/proposalTooLarge:\{[^}]*\}/) || [''])[0];
t('proposalTooLarge 문구가 있다', block.length > 0);
langs.forEach((l) => t(`  ${l} 번역 있음`, new RegExp(l + ":'").test(block)));

console.log('\n=== 서버 상한 (최종 방어선) ===');
const sm = server.match(/maxFileSize:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
t('maxFileSize 가 설정돼 있다', !!sm);
t(`서버도 ${LIMIT_MB}MB`, sm && parseInt(sm[1], 10) === LIMIT_MB, sm ? sm[1] + 'MB' : '');

console.log('\n=== 프론트 ↔ 서버 일치 ===');
t('두 상한이 같다 (어긋나면 사용자가 혼란)',
  m && sm && parseInt(m[1], 10) === parseInt(sm[1], 10));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ pullletter-upload tests FAILED'); process.exit(1); }
console.log('✅ pullletter-upload tests passed');
