/**
 * 공개 노출 표 잠금 (2026-08-11, Supabase 보안 경보 CRITICAL).
 *
 * ■ 무슨 일이 있었나
 * 2026-08-07~08 에 만든 표 6개가 RLS 없이 public 스키마에 있었다.
 * public 스키마는 PostgREST 로 그대로 열려 있으므로, **웹사이트에 박혀 있는
 * 공개 anon 키만 있으면 누구나** 읽고 고치고 지울 수 있는 상태였다.
 * 실측(조치 전): 6개 표 전부 RLS off · anon 에 SELECT/INSERT/UPDATE/DELETE 전부 true · 정책 0개.
 *
 * 가장 위험했던 것:
 *   push_subscriptions — 회원 브라우저의 푸시 엔드포인트와 암호키.
 *                        가져가면 우리 회원 기기로 아무 알림이나 보낼 수 있다.
 *   content_comments   — 회원이 쓴 댓글을 누구나 고치거나 지울 수 있었다.
 *
 * ■ 이 테스트가 지키는 것
 * RLS 자체는 DB 상태라 여기서 못 잰다(마이그레이션 122 로 적용·검증 완료).
 * 대신 **깨지기 쉬운 전제**를 지킨다: 이 표들은 서버(service_role)만 만진다.
 * 프런트가 anon 키로 직접 부르는 코드가 생기는 순간, RLS 가 그걸 조용히 막아서
 * "왜 댓글이 안 보이지?" 로 돌아온다. 그때는 RLS 를 끄지 말고 정책을 추가할 것.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const LOCKED = ['content_comments','content_reactions','ig_boosts','algo_coach','push_subscriptions','push_broadcasts'];

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

console.log('\n=== 마이그레이션 122 ===');
const sql = R('supabase_migrations/122_rls_lockdown_public_tables.sql');
t('122 마이그레이션이 있다', sql.length > 0);
for (const tb of LOCKED) {
  t(tb + ' 에 RLS 를 켠다',
    new RegExp('alter table public\\.' + tb + '\\s+enable row level security').test(sql));
}

console.log('=== 프런트는 이 표들을 직접 만지지 않는다 (RLS 전제) ===');
const frontFiles = walk(path.join(ROOT, 'frontend'));
for (const tb of LOCKED) {
  const hits = frontFiles.filter(f => new RegExp("['\"`]" + tb + "['\"`]").test(fs.readFileSync(f, 'utf8')))
                         .map(f => path.relative(ROOT, f));
  t('frontend 에 ' + tb + ' 직접 접근 없음', hits.length === 0,
    hits.join(', ') + ' — anon 키로는 RLS 에 막힌다. 서버 경유로 바꾸거나 정책을 추가할 것');
}

console.log('=== 서버 경유 경로는 살아 있다 ===');
t('댓글은 api/content/comments.js 가 담당', fs.existsSync(path.join(ROOT, 'api/content/comments.js')));
t('리액션은 api/content/react.js 가 담당', fs.existsSync(path.join(ROOT, 'api/content/react.js')));
t('푸시는 api/_lib/webPush.js 가 담당', fs.existsSync(path.join(ROOT, 'api/_lib/webPush.js')));
t('서버는 service_role 클라이언트를 쓴다 (RLS 우회)',
  /SUPABASE_SERVICE_KEY/.test(R('api/_lib/supabase.js')),
  'anon 클라이언트로 바꾸면 RLS 에 막혀 전부 빈 결과가 된다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ rls-public-lockdown tests FAILED'); process.exit(1); }
console.log('✅ rls-public-lockdown tests passed');
