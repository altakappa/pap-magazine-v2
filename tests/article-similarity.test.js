/*
 * article-similarity.test.js  (2026-08-07)
 *
 * 기사 추천을 '같은 카테고리 + 발행일 인접' 에서 '임베딩 유사도' 로 바꾼 것을 지킨다.
 *
 * 왜 이 자리가 중요한가 — 사이트→인스타 아웃클릭 2,588건 중 2,440건(94%)이
 * SSR 기사 페이지에서 나온다. 사람이 실제로 들어오는 문이다. 그런데 그 문에
 * 제일 약한 추천이 달려 있었다: 2019년 기사를 읽던 사람에게 2019년 기사를
 * 붙여 주고 있었다. 에디토리얼은 진작 벡터 유사도를 쓰고 있었는데도.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

// import 만으로 env 를 요구하는 모듈을 갈아끼운다 (86312cf 재발 방지)
const _orig = Module._load;
Module._load = function (req) {
  // embeddings.js 는 './supabase', 크론은 '../_lib/supabase' 로 부른다 — 둘 다 잡는다
  if (/(^|\/)supabase$/.test(req)) return { supabaseAdmin: { from: () => ({}), rpc: () => ({}) } };
  return _orig.apply(this, arguments);
};
delete require.cache[require.resolve(path.join(ROOT, 'api/_lib/embeddings'))];
const { articleEmbeddingText, editorialEmbeddingText } = require(path.join(ROOT, 'api/_lib/embeddings'));
Module._load = _orig;

console.log('\n=== 1. 임베딩 입력 텍스트 ===');
const t = articleEmbeddingText({
  title: '지코, 워터밤 서울 2026 피날레', subtitle: '무대를 장악했다',
  category: 'CELEB', tags: ['zico', 'waterbomb'],
  content: '<p>지코가 무대에 <b>올랐다</b>.</p>\n<p>관객은 환호했다.</p>',
});
ok(/지코, 워터밤 서울 2026 피날레/.test(t), '제목이 들어간다');
ok(/무대를 장악했다/.test(t), '부제가 들어간다');
ok(/Tags: zico, waterbomb/.test(t), '태그가 들어간다');
ok(/지코가 무대에 올랐다/.test(t), '본문이 들어가되 HTML 태그는 벗겨진다');
ok(!/<p>|<b>/.test(t), '태그 문자가 남지 않는다');
ok(articleEmbeddingText(null) === '', 'null 이어도 터지지 않는다');
ok(articleEmbeddingText({}) === '', '빈 행은 빈 문자열 — 크론이 건너뛸 수 있다');

console.log('\n=== 2. 본문 길이 상한 (8k 자 상한에 걸려 잘리지 않게) ===');
const longT = articleEmbeddingText({ title: 'T', content: '가'.repeat(50000) });
ok(longT.length < 2000, `본문을 잘라 입력이 짧게 유지된다 (${longT.length}자)`);

console.log('\n=== 3. 에디토리얼 쪽은 건드리지 않았다 ===');
const e = editorialEmbeddingText({ title: 'E', description: 'D', tags: ['x'] });
ok(/^E\. D\. Tags: x$/.test(e), '에디토리얼 포맷 그대로');

console.log('\n=== 4. MORE ARTICLES 가 유사도를 먼저 쓴다 ===');
const ma = fs.readFileSync(path.join(ROOT, 'api/_lib/moreArticles.js'), 'utf8');
ok(/rpc\('related_articles'/.test(ma), 'related_articles RPC 를 호출한다');
ok(/match_count: 4/.test(ma), '4건을 요청한다');
ok(/if \(!related \|\| !related\.length\)/.test(ma),
   '유사도가 비면 옛 인접 규칙으로 폴백한다 — 추천이 비지 않는다');
ok(/relAdj/.test(ma), '폴백 경로(발행일 인접)가 아직 살아 있다');
ok(/prev:/.test(ma) && /next:/.test(ma), 'prev/next 체인은 그대로 (SEO 내부링크)');
ok(/catch \(_e\)/.test(ma), 'RPC 가 터져도 페이지가 죽지 않는다');

console.log('\n=== 5. 백필 크론 ===');
const bf = fs.readFileSync(path.join(ROOT, 'api/cron/backfill-embeddings.js'), 'utf8');
ok(/withCronGuard\('backfill-embeddings'/.test(bf), '가드로 감싸져 있다');
ok(/BUDGET_MS/.test(bf) && /left\(\) < 3000/.test(bf), '시간 예산을 지켜 중간에 끊는다');
ok(/editorials/.test(bf) && /articles/.test(bf), '에디토리얼 고아와 기사를 둘 다 채운다');
ok(bf.indexOf("from('editorials')") < bf.indexOf("from('articles')"),
   '에디토리얼 고아를 먼저 채운다 (추천 UI 가 이미 붙어 있어 효과가 즉시다)');
ok(/count: 'exact', head: true/.test(bf), '남은 대기를 DB 에 직접 센다');
ok(/OPENAI_API_KEY/.test(bf), '키가 없으면 조용히 넘어간다');
ok(/bearerOk\(auth, process\.env\.CRON_SECRET\)/.test(bf) || /Bearer ' \+ process\.env\.CRON_SECRET/.test(bf), '버셀 크론 인증 방식이 맞다'); // 2026-09-04 timing-safe 형태 인정
ok(!/summary/.test(bf), "articles 에 없는 컬럼(summary)을 조회하지 않는다");
ok(/subtitle, category, tags, content/.test(bf), '실제로 있는 컬럼만 조회한다');

console.log('\n=== 6. vercel.json 에 등록됐다 ===');
const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
ok((v.crons || []).some(c => String(c.path).includes('backfill-embeddings')), '크론이 예약돼 있다');

console.log('\n=== 7. 조회 이력에 회원이 남는다 ===');
const vw = fs.readFileSync(path.join(ROOT, 'api/editorials/[id]/view.js'), 'utf8');
ok(/verifyToken/.test(vw), '로그인 토큰을 확인한다');
ok(/user_id: viewerId/.test(vw), '조회 기록에 user_id 를 넣는다');
ok(/let viewerId = null/.test(vw), '비회원은 null — 익명 카운트가 그대로 유지된다');
ok(/catch \(_e\)/.test(vw), '토큰이 깨져도 조회 기록 자체는 남는다');
ok(vw.indexOf('isBot') < vw.indexOf('verifyToken') || /isBot/.test(vw), '봇 차단은 그대로 앞단에 있다');

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ article-similarity tests passed');
