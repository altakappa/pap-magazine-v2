/**
 * 풀레터 업로드 UI 통일 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🐛): 무드보드와 촬영시안이 같은 "파일 업로드"인데 완료 후 화면이 서로
 * 달라 UI 가 붕괴돼 보인다.
 *
 * ── 원인: 표기 방식이 두 가지였다 ───────────────────────────────────
 *   무드보드  renderFileList() → 박스는 그대로 두고 아래에 .file-item 바
 *             (파일명 · 용량 · 삭제 ×)
 *   촬영시안  _onProposalSelected() → 박스 "안의 안내 문구"를 파일명으로
 *             갈아끼움. 삭제 버튼 없음
 *
 * 삭제 버튼이 있고 다중 파일에도 맞는 무드보드 쪽을 표준으로 삼고 촬영시안을
 * 맞췄다. 마크업은 _papFileItemHtml() 한 곳에서만 만든다 — 두 곳에서 각자
 * 문자열을 조립하면 시간이 지나며 다시 갈라진다(이번 사고가 정확히 그것).
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 업로드 완료 표기를 공용 함수 하나로만 만들 것
 *  2. 두 영역 모두 그 함수를 쓸 것 (한쪽만 직접 조립 금지)
 *  3. 두 영역 모두 삭제 수단을 가질 것
 *  4. 촬영시안이 다시 "박스 안 문구 교체" 방식으로 돌아가지 않을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const pl = fs.readFileSync(path.join(ROOT, 'frontend/pullletter.html'), 'utf8');

console.log('\n=== 1. 완료 표기 마크업이 한 곳에서만 만들어지는가 ===');
t('공용 렌더러 _papFileItemHtml 이 있다', /function _papFileItemHtml\(/.test(pl));
/* .file-item 을 문자열로 직접 조립하는 곳이 공용 함수 말고 또 있으면 안 된다. */
const inlineBuilds = (pl.match(/'<div class="file-item"/g) || []).length;
t(`.file-item 을 조립하는 곳이 1군데뿐 (발견 ${inlineBuilds})`, inlineBuilds === 1,
  '두 곳에서 각자 만들면 다시 갈라진다');

console.log('\n=== 2. 촬영시안이 공용 렌더러를 쓰는가 ===');
/* 2026-07-22 갱신 — 무드보드란 폐지(시안 PDF 통합)로 업로드 영역은 촬영시안
   하나가 됐다. 무드보드 관련 어서션은 tests/pullletter-moodboard-format.test.js
   (통합 구조 회귀)로 이관. 공용 렌더러 원칙은 그대로 지킨다. */
t('촬영시안이 공용 렌더러 사용',
  /_onProposalSelected[\s\S]{0,1500}_papFileItemHtml\(/.test(pl));
t('촬영시안에도 목록 컨테이너가 있다', /id="proposalFileList"/.test(pl));
t('목록 컨테이너가 표준 클래스(.file-list)를 쓴다',
  (pl.match(/class="file-list"/g) || []).length >= 1);

console.log('\n=== 3. 삭제 수단이 있는가 ===');
t('촬영시안 삭제 함수', /function removeProposalFile\(/.test(pl));
t('촬영시안 삭제가 input 값도 비운다',
  /function removeProposalFile\(\)[\s\S]{0,400}proposalInput[\s\S]{0,120}value\s*=\s*''/.test(pl),
  'input 을 안 비우면 지운 뒤에도 파일이 함께 제출된다');

console.log('\n=== 4. 옛 방식(박스 안 문구 교체)으로 돌아가지 않았는가 ===');
const propBody = (pl.match(/function _onProposalSelected\([\s\S]*?\n\}/) || [''])[0];
t('_onProposalSelected 를 찾았다', propBody.length > 0);
t('안내 문구(proposalDropText)를 더 이상 덮어쓰지 않는다',
  !/proposalDropText[\s\S]{0,200}innerHTML\s*=/.test(propBody),
  '문구를 갈아끼우면 무드보드와 완료 화면이 다시 달라진다');
t('용량 초과 시 목록을 비운다 (잘못된 파일이 남지 않게)',
  /PROPOSAL_MAX_BYTES[\s\S]{0,400}list\.innerHTML\s*=\s*''/.test(propBody));
t('용량 상한은 서버와 같은 25MB 유지 (무드보드와 통일)',
  /PROPOSAL_MAX_BYTES\s*=\s*25\*1024\*1024/.test(pl));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ pullletter-upload-ui tests FAILED'); process.exit(1); }
console.log('✅ pullletter-upload-ui tests passed');
