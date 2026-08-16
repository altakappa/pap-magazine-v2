/**
 * 상위 노출 기사 본문 보강 (2026-08-17 신설)
 *
 * 이 도구는 신규 발행이 아니라 **이미 구글에 색인된 본문을 바꾼다**.
 * 그래서 이 하네스가 지키는 것은 "잘 만드는가" 보다 "함부로 안 바꾸는가" 다.
 *
 *   ① 생성과 적용이 분리돼 있다 (자동으로 라이브 본문이 안 바뀐다)
 *   ② 적용 전 원본을 보관하고, 되돌릴 수 있다
 *   ③ draft 가 아닌 것은 적용되지 않는다
 *   ④ 지어내기 금지가 프롬프트에 명시돼 있다
 *   ⑤ 검수기가 '안 늘어남·너무 짧음·규격 위반'을 잡는다
 *   ⑥ 검수 실패가 결과를 자동 폐기하지 않는다 (사람이 판단할 값이다)
 *   ⑦ 에러 응답에 원문 에러를 싣지 않는다 (감사 A-3)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('aiCreditWatch.js', { reportAiFailure: async () => ({}) });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const P = path.join(ROOT, 'api', 'admin', 'article-body-backfill.js');
const mod = require(P);
const src = fs.readFileSync(P, 'utf8');

console.log('\n=== ① 생성과 적용이 분리돼 있다 ===');
{
  // 생성 경로가 articles 를 건드리면 안 된다
  const genBlock = src.slice(src.indexOf("q.generate_next === '1'"), src.indexOf("q.apply === '1'"));
  t('생성 경로는 articles 를 update 하지 않는다',
    !/from\('articles'\)[\s\S]{0,200}\.update\(/.test(genBlock), '생성 경로에 articles update 있음');
  t('생성 결과는 draft 로만 저장된다', /status: 'draft'/.test(genBlock));

  // 적용은 별도 경로여야 한다
  t('적용 경로가 따로 있다', /q\.apply === '1' && q\.id/.test(src));
  t('적용 경로만 articles.content 를 쓴다',
    (src.match(/from\('articles'\)\s*\n?\s*\.update\(\{ content:/g) || []).length === 2, 'apply + revert 두 곳이어야 한다');
  t('크론이 자동으로 적용하지 않는다 (이 파일에 크론 export 없음)',
    !/withCronGuard/.test(src));
}

console.log('\n=== ② 원본 보관과 되돌리기 ===');
{
  t('적용 전 원본을 old_body 에 담는다', /old_body: art\.content/.test(src));
  t('revert 경로가 있다', /q\.revert === '1'/.test(src));
  t('revert 는 old_body 로 복원한다', /content: row\.old_body/.test(src));
  t('revert 후 상태가 draft 로 돌아간다', /status: 'draft', applied_at: null/.test(src));
  t('old_body 가 없으면 되돌리기를 거부한다', /원본이 없어 되돌릴 수 없습니다/.test(src));
}

console.log('\n=== ③ 적용 가드 ===');
{
  t("draft 아니면 적용 거부", /draft 상태만 적용할 수 있습니다/.test(src));
  t('빈 초안은 적용 거부', /초안이 비어 있습니다/.test(src));
  t('applied 아니면 되돌리기 거부', /applied 상태만 되돌릴 수 있습니다/.test(src));
  t('관리자 인증이 최상단에 있다',
    src.indexOf('requireAdmin(req, res)') < src.indexOf('req.query'));
}

console.log('\n=== ④ 지어내기 금지 ===');
{
  t('없는 사실 지어내기 금지', /없는 사실을 지어내지 마라/.test(src));
  t('근거를 두 가지로 못 박는다', /기존 본문에 이미 있는 내용, 그리고 함께 준 사진/.test(src));
  t('날짜·수치·인용 날조 금지', /날짜·수치·인용·장소를 새로 만들어내는 것은 절대 금지/.test(src));
  t('기존 사실 변경 금지', /기존 본문의 사실을 하나도 바꾸지 마라/.test(src));
  t('짧아도 된다는 탈출구', /지어내는 것보다 짧은 게 낫다/.test(src));
  t('무엇을 더했는지 보고하게 한다', /added/.test(src) && /required.*added|'added'/.test(src));
  t('브랜드 문체 규격을 주입한다', /papVoice\.ARTICLE_VOICE/.test(src));
}

console.log('\n=== ⑤ 검수기 ===');
{
  const c = mod._checkBody;
  const short = '가'.repeat(500) + '다.';
  const long = ('가'.repeat(300) + '다.\n\n' + '나'.repeat(300) + '다.\n\n' + '다'.repeat(300) + '다.');

  t('보강이 안 되면 잡는다',
    c(short, '가'.repeat(100) + '다.').some((i) => /보강 안 됨/.test(i)),
    c(short, '가'.repeat(100) + '다.'));
  t('800자 미만이면 잡는다',
    c('짧다.', '가'.repeat(500) + '다.').some((i) => /800자 미만/.test(i)));
  t('제대로 늘어나면 통과', c(short, long).length === 0, c(short, long));

  // 문체 규격 위반도 같이 잡아야 한다
  t('존댓말을 잡는다',
    c(short, long.replace('다.', '입니다.')).some((i) => /존댓말/.test(i)));
  t('대시를 잡는다',
    c(short, long + '\n\n무대 위 — 가면이다.').some((i) => /대시/.test(i)));
  t('기사 한도(4단락)를 넘기면 잡는다',
    c(short, long + '\n\n라다.\n\n마다.').some((i) => /단락/.test(i)));
  t('기사 한도 안에서는 600자를 안 잡는다',
    !c('짧다.', long).some((i) => /권장 상한/.test(i)), c('짧다.', long));
}

console.log('\n=== ⑥ 검수 실패가 자동 폐기로 이어지지 않는다 ===');
{
  // 오탐 하나로 큐가 멎으면 안 된다. 이슈는 note 에 남기고 draft 로 저장한다.
  const genBlock = src.slice(src.indexOf("q.generate_next === '1'"), src.indexOf("q.apply === '1'"));
  t('이슈가 있어도 status 는 draft', /const issues = checkBody[\s\S]{0,400}status: 'draft'/.test(genBlock));
  t('이슈를 note 에 남긴다', /issues\.join\(', '\)/.test(genBlock));
  t('응답으로 이슈를 돌려준다', /issues,/.test(genBlock));
  t('생성 실패는 failed 로 표시한다', /status: 'failed'/.test(src));
}

console.log('\n=== ⑦ 안전 규칙 ===');
{
  t('에러 응답에 원문 에러를 싣지 않는다 (감사 A-3)',
    /code: 'backfill_failed'/.test(src) && !/error: String\(e/.test(src));
  t('상세는 console.error 로만', /console\.error\('\[article-body-backfill\]', e\)/.test(src));
  t('비 이미지 타입을 비전 블록에서 제외한다', /\!\/\^image\\\//.test(src) || /image\\\//.test(src));
  t('이미지는 3장까지만 (함수 시간 보호)', /slice\(0, 3\)/.test(src));
  t('이미지 fetch 에 타임아웃이 있다', /AbortSignal\.timeout\(15000\)/.test(src));
  t('API 호출에 타임아웃이 있다', /AbortSignal\.timeout\(90000\)/.test(src));
  t('_lib 경로가 ../_lib (api/admin 규칙)', /require\('\.\.\/_lib\//.test(src));

  const mig = path.join(ROOT, 'supabase_migrations', '125_article_body_backfill.sql');
  t('마이그레이션 파일이 있다', fs.existsSync(mig), mig);
  if (fs.existsSync(mig)) {
    const sql = fs.readFileSync(mig, 'utf8');
    t('old_body 컬럼이 있다', /old_body\s+TEXT/.test(sql));
    t('RLS 를 켠다', /ENABLE ROW LEVEL SECURITY/.test(sql));
    t('재실행 안전', /CREATE TABLE IF NOT EXISTS/.test(sql));
  }
}

console.log('\n' + (fail ? '✗' : '✓') + ' article-body-backfill: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
