/**
 * 텔레그램 재전송 버튼 (2026-11-06)
 * ═══════════════════════════════════════════════════════════════════
 * 2026-11-06 실측: 화보 전송 실패를 고쳐 배포한 뒤, 재전송 주소
 * (/api/editorials/telegram-send?id=…)를 도메니코에게 보냈는데 "도착 안 함" 이었다.
 * 그런데 런타임 로그를 45분치 훑어도 **그 경로의 호출 기록이 한 건도 없었다.**
 * 즉 함수가 실패한 게 아니라 아예 불리지 않았다.
 *
 * 주소를 직접 치는 방식의 문제가 그거다 — 관리자 세션이 안 실리면 조용히 끝나고,
 * 모바일에서는 애초에 칠 수가 없다. 화면도 아무 말을 안 해서 원인이 안 보인다.
 *
 * 그래서 어드민 화보 편집창에 버튼을 둔다. 같은 페이지의 쿠키를 그대로 들고 가고
 * (credentials:'include'), 성공하면 몇 장 갔는지, 실패하면 사유를 띄운다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

t('편집창 버튼 줄에 재전송 버튼이 있다',
  /id="tgResendBtn"[^>]*onclick="papResendTelegram\(\)"/.test(HTML));
t('버튼이 저장·임시저장과 같은 줄(pe-actions)에 있다', (() => {
  const i = HTML.indexOf('<div class="pe-actions">');
  const j = HTML.indexOf('id="tgResendBtn"');
  const k = HTML.indexOf('</div>', i);
  return i > -1 && j > i && j < k;
})());
t('type="button" — 폼을 제출하지 않는다', /id="tgResendBtn"[^>]*type="button"/.test(HTML));

t('핸들러가 있다', /async function papResendTelegram\(\)\{/.test(JS));
t('편집 중인 화보 id 를 쓴다', /papResendTelegram[\s\S]{0,400}editingEditorialId/.test(JS));
t('id 가 없으면 먼저 저장하라고 알린다', /if\(!editingEditorialId\)\{ alert\('먼저 화보를 저장한 뒤에 눌러주세요\.'\); return; \}/.test(JS));
t('쿠키를 실어 보낸다 (주소 직접 치기의 실패 원인)',
  /fetch\('\/api\/editorials\/telegram-send\?id='\+encodeURIComponent\(editingEditorialId\), \{ credentials:'include' \}\)/.test(JS));
t('id 를 URL 인코딩한다', /encodeURIComponent\(editingEditorialId\)/.test(JS));
t('성공하면 몇 장 갔는지 보여준다', /papResendTelegram[\s\S]{0,1200}이미지 '\+\(j\.sent/.test(JS));
t('실패하면 사유를 보여준다 (조용히 끝나지 않는다)',
  /papResendTelegram[\s\S]{0,1600}텔레그램 전송 실패/.test(JS) &&
  /로그인이 풀렸거나 발행 상태가 아닐 수 있습니다/.test(JS));
t('누르는 동안 버튼을 잠근다', /btn\.disabled=true; btn\.textContent='보내는 중…/.test(JS));
t('끝나면 성공·실패와 무관하게 버튼을 되돌린다', /finally\{\s*\n?\s*if\(btn\)\{ btn\.disabled=false; btn\.textContent=orig; \}/.test(JS));
t('브라우저 캐시 버전을 올렸다 (안 올리면 버튼이 안 보인다)',
  /pap-admin\.js\?v=(17[4-9]|1[89]\d|[2-9]\d\d)/.test(HTML));
t('테스트 스크립트 등록', /telegram-resend-button\.test\.js/.test(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
