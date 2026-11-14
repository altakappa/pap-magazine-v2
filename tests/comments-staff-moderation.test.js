/**
 * 익명 댓글의 안전장치 3종 (2026-11-15)
 *
 * 11/14 에 익명 댓글을 열면서 빠뜨린 것:
 *   ① 지울 수 있는 사람이 글쓴이뿐 → 셀럽 기사에 악플이 달려도 PAP 가 못 내렸다
 *   ② 댓글이 달려도 아무도 모른다 → 답이 안 달리는 방에는 두 번째 글이 안 온다
 *   ③ 닉네임이 자유 입력 → 누구나 'PAP 에디터' 를 자칭할 수 있었다
 * 지키는 것: 운영진만 남의 댓글을 내린다 · 운영진 표시는 서버가 로그인 계정에만 붙인다 ·
 *            운영진처럼 보이는 닉네임은 익명에게 안 준다 · 알림 실패가 댓글을 막지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p); require.cache[p].exports = exports; require.cache[p].loaded = true;
}

const ROLES = { 'u-admin': 'admin', 'u-staff': 'staff', 'u-member': 'member' };
let listRows = [];
let inserted = [];
let delOps = null;
let roleLookupFails = false;
function chain(table) {
  const o = { _t: table, _ops: [] };
  const rec = (m) => (...a) => { o._ops.push([m, ...a]); return o; };
  for (const m of ['select', 'eq', 'order', 'limit', 'update', 'insert']) o[m] = rec(m);
  o.maybeSingle = async () => {
    if (table === 'profiles') {
      if (roleLookupFails) throw new Error('db down');
      const id = (o._ops.find((x) => x[0] === 'eq' && x[1] === 'id') || [])[2];
      return { data: ROLES[id] ? { role: ROLES[id] } : null };
    }
    if (table === 'articles') return { data: { title: '테스트 기사', slug: 'test-slug', tags: [] } };
    return { data: null };
  };
  o.single = async () => { const ins = o._ops.find((x) => x[0] === 'insert'); inserted.push(ins && ins[1]); return { data: { id: 'c1', ...(ins ? ins[1] : {}) }, error: null }; };
  o.then = (resolve) => {
    if (o._ops.some((x) => x[0] === 'update')) { delOps = o._ops.map((x) => x.join(':')); return resolve({ data: [{ id: 'x' }], error: null }); }
    resolve({ data: listRows, error: null, count: listRows.length });
  };
  return o;
}
stub('supabase.js', { supabaseAdmin: { from: (t) => chain(t) } });
let loggedIn = null;
stub('auth.js', { verifyToken: () => loggedIn });
stub('cors.js', { handleCors: () => false });
stub('rateLimit.js', { rateLimit: () => false, RATE_LIMITS: { api: {} } });
stub('clickGuard.js', { extractClientIp: () => '1.2.3.4', hashIp: (ip) => 'h(' + ip + ')', isLikelyBot: () => false });
const sent = [];
let tgThrows = false;
stub('telegram.js', { sendTextToTelegramPersonalSafe: async (text) => { if (tgThrows) throw new Error('telegram down'); sent.push(text); return { ok: true }; } });

const C = require(path.join(ROOT, 'api', 'content', 'comments.js'));
const src = R('api/content/comments.js');
const fe = R('frontend/pap-engage.js');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', typeof d === 'string' ? d : JSON.stringify(d)); } }
function res() { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; }
const ART = '11111111-1111-4111-8111-111111111111';
const req = (method, body) => ({ method, headers: { 'user-agent': 'Mozilla/5.0' }, body, query: method === 'POST' ? {} : body });

(async () => {
  console.log('\n[1] 닉네임 사칭 차단');
  for (const bad of ['PAP 에디터', 'pap_magazine', 'ＰＡＰ', 'P.A.P', 'p a p', '관리자', '운영자입니다', '공식계정', 'Editor', 'ADMIN', 'official']) {
    t('막는다: ' + bad, C.safeNickname(bad) === null, C.safeNickname(bad));
  }
  for (const ok of ['패션덕후', '윤호사랑', 'milan_girl', '지나가던 사람']) t('받는다: ' + ok, C.safeNickname(ok) === ok, C.safeNickname(ok));
  t('빈 값은 null', C.safeNickname('') === null && C.safeNickname(null) === null);
  loggedIn = null; inserted = []; sent.length = 0;
  let r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, body: '공식 입장입니다', nickname: 'PAP 에디터' }), r);
  t('사칭 닉네임이어도 댓글은 받되 닉네임은 버린다 (익명 표시)', r.code === 201 && inserted[0] && inserted[0].nickname === null, inserted[0]);

  console.log('[2] 새 댓글 알림');
  t('익명 댓글은 개인방으로 알린다', sent.length === 1 && /새 댓글/.test(sent[0]) && /익명/.test(sent[0]), sent);
  t('알림에 글 제목·본문·링크', /테스트 기사/.test(sent[0]) && /공식 입장입니다/.test(sent[0]) && /pap-magazine\.com\/article\/test-slug/.test(sent[0]), sent[0]);
  sent.length = 0; loggedIn = { id: 'u-member' }; r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, body: '회원 댓글' }), r);
  t('회원 댓글도 알린다', r.code === 201 && sent.length === 1 && /회원/.test(sent[0]));
  sent.length = 0; loggedIn = { id: 'u-admin' }; r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, body: '에디터의 질문' }), r);
  t('운영진이 쓴 글은 알리지 않는다', r.code === 201 && sent.length === 0, sent);
  tgThrows = true; loggedIn = null; r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, body: '알림이 죽어도' }), r);
  t('알림 실패가 댓글을 막지 않는다 (201)', r.code === 201, r.body);
  tgThrows = false;
  t('알림은 await 한다 (서버리스에서 응답 뒤 작업은 잘린다)', /await alertNewComment\(/.test(src) && /await sendTextToTelegramPersonalSafe\(/.test(src));
  t('알림은 그룹방이 아니라 개인방', /sendTextToTelegramPersonalSafe/.test(src) && !/sendTextToTelegramSafe\(/.test(src));

  console.log('[3] 운영진 삭제');
  loggedIn = { id: 'u-admin' }; delOps = null; r = res();
  await C(req('DELETE', { id: ART }), r);
  t('admin 은 주인 조건 없이 내린다', r.code === 200 && delOps && !delOps.some((s) => s.startsWith('eq:user_id') || s.startsWith('eq:anon_key')), delOps);
  loggedIn = { id: 'u-staff' }; delOps = null; r = res();
  await C(req('DELETE', { id: ART }), r);
  t('staff 도 내린다', r.code === 200 && delOps && !delOps.some((s) => s.startsWith('eq:user_id')), delOps);
  loggedIn = { id: 'u-member' }; delOps = null; r = res();
  await C(req('DELETE', { id: ART }), r);
  t('일반 회원은 자기 글만 (user_id 조건)', delOps && delOps.some((s) => s === 'eq:user_id:u-member'), delOps);
  loggedIn = null; delOps = null; r = res();
  await C(req('DELETE', { id: ART }), r);
  t('비로그인은 자기 글만 (anon_key 조건)', delOps && delOps.some((s) => s === 'eq:anon_key:ip:h(1.2.3.4)'), delOps);
  roleLookupFails = true; loggedIn = { id: 'u-admin' }; delOps = null; r = res();
  await C(req('DELETE', { id: ART }), r);
  t('권한 확인이 실패하면 닫힌 쪽으로 (주인 조건이 붙는다)', delOps && delOps.some((s) => s === 'eq:user_id:u-admin'), delOps);
  roleLookupFails = false;
  t('삭제는 여전히 행을 지우지 않고 내린다', delOps && delOps.some((s) => /^update:/.test(s)) && /status: 'deleted'/.test(src));

  console.log('[4] 운영진 표시');
  listRows = [
    { id: 'a', body: '에디터의 질문', created_at: '2026-11-15T00:00:00Z', user_id: 'u-admin', anon_key: null, nickname: null, kind: 'text', profiles: { name: 'Domenico', avatar_url: null, role: 'admin' } },
    { id: 'b', body: '회원 글', created_at: '2026-11-15T00:00:00Z', user_id: 'u-member', anon_key: null, nickname: null, kind: 'text', profiles: { name: '회원', avatar_url: null, role: 'member' } },
    { id: 'c', body: '익명 글', created_at: '2026-11-15T00:00:00Z', user_id: null, anon_key: 'ip:h(9.9.9.9)', nickname: '지나가던', kind: 'text', profiles: null },
  ];
  loggedIn = null; r = res();
  await C(req('GET', { target_type: 'article', target_id: ART }), r);
  const it = (r.body && r.body.items) || [];
  t('운영진 계정 댓글만 official', it.length === 3 && it[0].official === true && it[1].official === false && it[2].official === false, it);
  t('role 은 응답에 내보내지 않는다', !/"role"/.test(JSON.stringify(r.body)));
  t('남이 보면 can_delete 는 전부 false', it.every((i) => i.can_delete === false), it);
  loggedIn = { id: 'u-staff' }; r = res();
  await C(req('GET', { target_type: 'article', target_id: ART }), r);
  t('운영진이 보면 전부 can_delete', ((r.body && r.body.items) || []).every((i) => i.can_delete === true));
  loggedIn = { id: 'u-member' }; r = res();
  await C(req('GET', { target_type: 'article', target_id: ART }), r);
  const im = (r.body && r.body.items) || [];
  t('회원이 보면 자기 글만 can_delete', im[1].can_delete === true && im[0].can_delete === false && im[2].can_delete === false, im);

  console.log('[5] 프런트');
  t('PAP 표시는 서버가 준 official 로만 그린다', /c\.official \? '<em class="pe-pap">PAP<\/em>' : ''/.test(fe));
  t('삭제 버튼은 mine 또는 can_delete', /\(c\.mine \|\| c\.can_delete\) \?/.test(fe));
  t('표시 색은 글자색을 따른다 (테마 무관)', /\.pe-pap\{[^}]*border:1px solid currentColor/.test(fe));
  const bumped = ['frontend/index.html', 'frontend/articles.html', 'frontend/films.html', 'api/_lib/seoRenderer.js'].every((f) => { const m = R(f).match(/pap-engage\.js\?v=(\d+)/); return !!m && Number(m[1]) >= 12; });
  t('캐시버스트: 4곳 전부 pap-engage.js?v=12 이상', bumped);

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 실행 오류', e && e.stack || e); process.exit(1); });
