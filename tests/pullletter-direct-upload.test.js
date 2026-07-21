/**
 * 풀레터 2단계 직접 업로드 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🚨 결함): 3.0MB PDF 를 올렸는데 화면엔 정상 업로드처럼 보이다가,
 * "PULL-LETTER 신청" 버튼을 누른 뒤에야 영문 오류가 떴다 —
 * "Request payload too large."
 *
 * ── 원인 ────────────────────────────────────────────────────────────
 * 개별 파일 문제가 아니라 요청 전체 용량 문제였다. 풀레터는 무드보드
 * 이미지와 촬영시안 PDF 를 multipart 로 한 요청에 통째로 실어 보냈는데,
 * Vercel 서버리스 함수의 요청 본문 한계는 4.5MB 다. 안내는 "무드보드
 * 25MB · 시안 20MB" 였으니 안내를 믿은 사용자는 반드시 실패했다.
 *
 * 그리고 파일은 신청 버튼을 누를 때까지 아예 전송되지 않았다. 화면의
 * "3.0MB" 표시는 로컬 File 객체 정보였을 뿐이다 — QA 가 짚은 "업로드
 * 완료로 보이나 실제로는 실패"가 정확히 이것이다.
 *
 * 서브미션은 이미 같은 문제를 겪고 2단계 직접 업로드로 해결해 뒀는데
 * (pap-api.js 주석: "bypass Vercel's 4.5 MB body limit") 풀레터만
 * 옛 방식에 남아 있었다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 풀레터가 다시 multipart 한방 전송으로 되돌아가지 않을 것
 *  2. 서명 URL 엔드포인트의 용량·타입 검증이 살아 있을 것
 *  3. 촬영시안이 비공개 버킷으로 갈 것 (기획서가 공개 URL 로 새면 안 된다)
 *  4. 영문 시스템 메시지가 사용자에게 그대로 노출되지 않을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const api = fs.readFileSync(path.join(ROOT, 'frontend/pap-api.js'), 'utf8');
const front = fs.readFileSync(path.join(ROOT, 'frontend/pullletter.html'), 'utf8');
const signSrc = fs.readFileSync(path.join(ROOT, 'api/pullletters/upload-url.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'api/pullletters/index.js'), 'utf8');

// pullLetters.create 본문만 잘라낸다
const createBody = (api.match(/async create\(data, moodboardFiles, proposalPdf[\s\S]*?\n    \},/) || [''])[0];

console.log('\n=== 1. 클라이언트가 2단계 직접 업로드를 쓴다 ===');
t('create() 를 찾았다', createBody.length > 0);
t('서명 URL 엔드포인트를 호출한다', /\/pullletters\/upload-url/.test(createBody));
t('스토리지로 직접 PUT 한다', /method:\s*'PUT'/.test(createBody));
t('파일을 요청 본문에 싣지 않는다 (FormData 미사용)',
  !/new FormData\(\)/.test(createBody));
t('메타데이터만 JSON 으로 보낸다 (moodboardUrls/proposalPath)',
  /moodboardUrls/.test(createBody) && /proposalPath/.test(createBody));
t('진행률 콜백을 지원한다', /onProgress/.test(createBody));

console.log('\n=== 2. 서명 URL 엔드포인트 검증 ===');
t('로그인 필요', /requireAuth/.test(signSrc));
t('레이트리밋 적용', /rateLimit/.test(signSrc));
t('카테고리 화이트리스트 (moodboard|proposal)',
  /category !== 'moodboard' && category !== 'proposal'/.test(signSrc));
t('촬영시안은 PDF 만 허용', /proposal must be application\/pdf/i.test(signSrc));
t('무드보드 25MB 상한', /MAX_MOODBOARD_SIZE = 25 \* 1024 \* 1024/.test(signSrc));
t('촬영시안 20MB 상한 (프론트와 동일)', /MAX_PROPOSAL_SIZE = 20 \* 1024 \* 1024/.test(signSrc));
t('시안은 1개만', /Only one proposal PDF is allowed/.test(signSrc));
t('스토리지 경로 화이트리스트 검사', /Refusing unsafe storage path/.test(signSrc));

console.log('\n=== 3. 촬영시안은 비공개 버킷 (기획서 유출 방지) ===');
t("시안 버킷은 'pull-letters'(비공개)", /isProposal \? 'pull-letters' : 'pullletters'/.test(signSrc));
t('비공개 파일엔 publicUrl 을 주지 않는다', /if \(!isProposal\) \{[\s\S]{0,200}getPublicUrl/.test(signSrc));
t('시안 경로는 proposals/{userId}/ 아래', /proposals\/\$\{safeUserId\}\//.test(signSrc));

console.log('\n=== 4. 서버 수신 (JSON 경로) ===');
t('JSON 요청을 받는다', /application\/json/.test(server));
t('경로 위조 방지 — 본인 폴더인지 확인',
  /proposals\/\$\{safeUid\}\//.test(server));
t('.pdf 확장자 확인', /\\.pdf\$\/i\.test\(pPath\)/.test(server));
t('레거시 multipart 도 당분간 함께 받는다 (배포 중 캐시 대비)',
  /if \(!isJson\)/.test(server) && /_legacyFiles/.test(server));

console.log('\n=== 5. 오류 문구 — 영문 시스템 메시지 노출 금지 ===');
t('payload 초과를 한국어 안내로 변환', /payload too large\|413\|entity too large/.test(front));
t('업로드 실패 안내 분기', /uploadFailed/.test(front));
t('네트워크 오류 안내 분기', /networkError/.test(front));
const dictKeys = ['uploading', 'uploadTooLarge', 'uploadFailed', 'networkError', 'submitFailed'];
dictKeys.forEach((k) => {
  const block = (front.match(new RegExp(k + ':\\{[^}]*\\}')) || [''])[0];
  t(`  ${k} 8개 언어`, ['ko','en','it','fr','es','ja','zh','ru'].every((l) => new RegExp(l + ":'").test(block)));
});
t('한국어 안내에 구체적 용량이 적혀 있다 (무엇을 어떻게 줄일지)',
  /무드보드는 25MB, 촬영시안 PDF는 20MB 이하로/.test(front));

console.log('\n=== 6. 업로드 중 상태 표시 ===');
t('제출 버튼 선택자가 실제 DOM 과 맞는다 (.btn-submit)',
  /querySelector\('#flForm \.btn-submit'\)/.test(front) && /class="btn-submit"/.test(front));
t('업로드 중 버튼 잠금', /_setBtn\(_getValText\('uploading'\), true\)/.test(front));
t('진행률 표시 (done/total)', /done \+ '\/' \+ total/.test(front));
t('실패 시 버튼 복구', /_setBtn\(_btnLabel, false\)/.test(front));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ pullletter-direct-upload tests FAILED'); process.exit(1); }
console.log('✅ pullletter-direct-upload tests passed');
