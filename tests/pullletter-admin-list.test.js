/**
 * 풀레터 "접수 완료인데 목록 미표시" 근본수정 회귀 (QA 2026-07-22, 4차).
 *
 * [실측 확정] 저장은 정상(DB 2건, user_id 정확) · mine 200 정상.
 * 죽어 있던 건 관리자 GET /api/pullletters 하나 — `profiles!inner` PostgREST
 * 임베드가 pullletters→profiles FK 부재로 PGRST200 → 500 → 관리자 화면 "0건".
 * 수정: 임베드 제거, profiles 별도 조회·매핑(관리자 서브미션 목록 패턴).
 * + 마이페이지가 서버 오류를 '요청 없음'으로 위장하던 것 → 실패 문구 표시.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'pullletters', 'index.js'), 'utf8');
const mp  = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'mypage.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 풀레터 관리자 목록 500 근본수정 ===');
// 주석 속 인용은 허용 — 실제 select 호출에서의 임베드만 금지한다.
t('profiles!inner 임베드 제거됨 (FK 없어 항상 PGRST200)', !/select\('[^']*profiles!inner/.test(api),
  '임베드가 돌아오면 관리자 목록이 다시 전건 500 이 된다');
t('profiles 별도 조회(.in(id, userIds)) 사용', /from\('profiles'\)[\s\S]{0,120}\.in\('id', userIds\)/.test(api));
t('requester 필드가 매핑에서 채워짐', /profilesById\[pl\.user_id\]/.test(api));
t('profiles 없는 행도 목록에 남음(email 폴백)', /prof\.email \|\| pl\.email/.test(api));
console.log('--- 마이페이지 오류 표시 ---');
t('mine 실패(!r.ok)를 throw 로 표면화', /pullletters\/mine[\s\S]{0,400}if\(!r\.ok\) throw new Error/.test(mp));
t('catch 가 실패 문구 표시(빈 목록 위장 아님)', /loadPullletterRequests[\s\S]*?catch\(function\(\)\{\s*box\.innerHTML/.test(mp));


console.log('--- 마이페이지 로드 체인 독립성 ---');
// QA(2026-07-22 추가) — initSupabase 실패의 조기 return 이 loadPullletterRequests
// 호출을 삼키던 구조 회귀 방지: loadActivityStats 안에 통계용 조기 return 금지.
const statsFn = (mp.match(/function loadActivityStats\([\s\S]*?loadPullletterRequests\(\);/) || [''])[0];
// if(!sb){...} 블록 '내부'만 추출해 return 검사 (블록 밖 코드는 무관)
const sbBlock = (statsFn.match(/if \(!sb\) \{[^{}]*\}/) || [''])[0];
t('loadActivityStats 의 sb-실패 블록에 return 없음', sbBlock !== '' && !/return/.test(sbBlock),
  'initSupabase 실패가 풀레터 로드를 다시 삼키게 된다');
t('loadPullletterRequests 호출이 loadActivityStats 안에 존재', /loadPullletterRequests\(\);/.test(statsFn));


console.log('--- 마이페이지 풀레터 카드 (2026-07-22 컨셉제목·상세·다운로드) ---');
const plFn = (mp.match(/function loadPullletterRequests[\s\S]*?function mpTogglePlDetail[\s\S]*?\n\}/) || [''])[0];
t('발급 PDF 다운로드는 상태 무관(서명 URL 존재 조건)', /if\(r\.pullLetterSignedUrl\)\{/.test(plFn) && !/status === 'issued' && r\.pullLetterSignedUrl/.test(plFn),
  "approved+PDF 건이 다시 숨겨진다 (status==='issued' 게이트 금지)");
t('컨셉 제목(r.title) 최우선 표시', /var title = r\.title\s*\|\| r\.moodBoardTitle/.test(plFn));
t('클릭 인라인 상세(mpTogglePlDetail) 존재', /function mpTogglePlDetail/.test(mp));
t('상세에 무드보드·시안 PDF 렌더', /file_urls/.test(plFn) && /proposalPdfSignedUrl/.test(plFn));
const plApi = require('fs').readFileSync(require('path').join(__dirname,'..','api','pullletters','index.js'),'utf8');
t('서버 insert 에 title 저장(80자 제한·누락 허용)', /title: \(typeof data\.title === 'string'/.test(plApi));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ pullletter-admin-list tests FAILED'); process.exit(1); }
console.log('✅ pullletter-admin-list tests passed');
