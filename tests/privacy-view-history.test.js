/*
 * privacy-view-history.test.js  (2026-08-08)
 *
 * 조회 이력(개인화 재료)은 고지 없이 켜면 안 된다. 이 테스트는 코드와
 * 고지문이 서로 어긋나지 않게 묶는다 — 한쪽만 고치면 여기서 터진다.
 *
 * 지키는 약속 (privacy.html 에 적힌 그대로):
 *   1) 로그인 회원의 조회만 회원과 연결한다. 비회원은 익명.
 *   2) 회원 탈퇴 시 연결 정보는 즉시 익명화된다 (DB FK ON DELETE SET NULL —
 *      코드 경로가 아니라 제약이라 어떤 삭제 경로든 빠뜨릴 수 없다).
 *   3) 탈퇴한 계정의 잔여 토큰으로 조회해도 기록을 잃지 않는다 — 익명 강등.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

console.log('\n=== 1. 고지문(privacy.html)에 조회 이력이 명시돼 있다 ===');
const pv = fs.readFileSync(path.join(ROOT, 'frontend/privacy.html'), 'utf8');
ok(/콘텐츠 조회 이력/.test(pv), '수집 항목에 조회 이력이 있다');
ok(/로그인 회원/.test(pv), '로그인 회원에 한정됨을 밝힌다');
ok(/맞춤 콘텐츠 추천/.test(pv), '이용 목적(맞춤 추천)을 밝힌다');
ok(/개인을 식별하지 않는 형태로만 집계/.test(pv), '비회원은 익명 집계임을 밝힌다');
ok(/회원 탈퇴 시 즉시 익명화/.test(pv), '탈퇴 시 처리를 밝힌다');
ok(/최종 수정일: 2026년 8월/.test(pv), '최종 수정일이 갱신됐다');

console.log('\n=== 2. 코드가 고지문과 같은 약속을 지킨다 ===');
const vw = fs.readFileSync(path.join(ROOT, 'api/editorials/[id]/view.js'), 'utf8');
ok(/verifyToken/.test(vw) && /let viewerId = null/.test(vw),
   '로그인일 때만 user_id — 기본값은 익명(null)');
ok(/error\.code === '23503' && viewerId/.test(vw),
   '탈퇴 토큰(FK 위반)이면 익명으로 강등해 재기록한다');
ok(/user_id: null \}\)/.test(vw), '강등 재시도가 실제로 익명 insert 다');
ok(vw.indexOf("error.code === '23503' && viewerId") < vw.indexOf("if (error) {"),
   '강등 처리가 일반 오류 처리보다 먼저다 (조회를 잃지 않는다)');

console.log('\n=== 3. 탈퇴 익명화는 코드가 아니라 DB 제약이다 ===');
/* member-delete.js 에 정리 코드를 넣는 방식은 다음 삭제 경로가 생기면
   빠뜨린다. FK ON DELETE SET NULL 은 경로와 무관하게 작동한다.
   여기서는 마이그레이션 의도가 문서화돼 있는지만 확인한다 —
   (제약 자체는 운영 DB 에 적용됨: editorial_views_user_id_fkey) */
ok(/ON DELETE SET NULL|on delete set null/i.test(vw) || /SET NULL/.test(vw),
   'view.js 주석이 FK(SET NULL) 전제를 설명한다 — 다음 사람이 지우지 않게');

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ privacy-view-history tests passed');
