/**
 * 댓글 익명 개방 + 착장 식별 (2026-11-14, 마이그레이션 188)
 *
 * 실측 3개월: 기사 조회 월 약 17만, 로그인 조회 주 0~6건, 댓글 0건. 도메니코 결정 "익명 허용".
 * 지키는 것: 주인은 서버가 정한다(ip 해시) · 비로그인은 봇 차단 + 분당 5건 ·
 *            착장 식별은 브랜드 필수, 태그와 맞으면 verified · 비로그인도 자기 댓글만 지운다.
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

/* ── supabase 흉내: 체인 호출을 기록하고 미리 넣은 응답을 돌려준다 ── */
const calls = [];
let inserted = [];
let tagsForArticle = [];
function chain(table) {
  const o = { _t: table, _ops: [] };
  const rec = (m) => (...a) => { o._ops.push([m, ...a]); return o; };
  for (const m of ['select', 'eq', 'order', 'limit', 'update', 'insert']) o[m] = rec(m);
  o.maybeSingle = async () => { calls.push(o); return { data: table === 'articles' ? { tags: tagsForArticle } : null }; };
  o.single = async () => { calls.push(o); const ins = o._ops.find((x) => x[0] === 'insert'); inserted.push(ins && ins[1]); return { data: { id: 'c1', ...(ins ? ins[1] : {}) }, error: null }; };
  o.then = (resolve) => { calls.push(o); resolve({ data: [], error: null, count: 0 }); };
  return o;
}
stub('supabase.js', { supabaseAdmin: { from: (t) => chain(t) } });
let loggedIn = null;
stub('auth.js', { verifyToken: () => loggedIn, requireAuth: () => { throw new Error('requireAuth 를 쓰면 안 된다'); } });
stub('cors.js', { handleCors: () => false });
let limited = 0;
stub('rateLimit.js', { rateLimit: (_r, _s, cfg) => { if (cfg && cfg.limit === 5) limited++; return false; }, RATE_LIMITS: { api: { limit: 60, windowMs: 60000 } } });
stub('clickGuard.js', { extractClientIp: (req) => req.headers['x-ip'] || '1.2.3.4', hashIp: (ip) => 'h(' + ip + ')', isLikelyBot: (ua) => !ua || /bot/i.test(ua) });

const C = require(path.join(ROOT, 'api', 'content', 'comments.js'));

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', typeof d === 'string' ? d : JSON.stringify(d)); } }
function res() { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; }
const ART = '11111111-1111-4111-8111-111111111111';
const req = (method, body, h) => ({ method, headers: { 'user-agent': 'Mozilla/5.0', ...(h || {}) }, body, query: method === 'DELETE' ? body : {} });

(async () => {
  console.log('\n[1] 순수 함수');
  t('cleanShort: 제어문자 제거·공백 접기·상한', C.cleanShort('  Saint  Laurent\u0007 ', 40) === 'Saint Laurent' && C.cleanShort('a'.repeat(50), 20).length === 20);
  t('brandMatchesTags: 공백·대소문자 무시', C.brandMatchesTags('Saint Laurent', ['saintlaurent', 'jennie']) === true);
  t('brandMatchesTags: 부분 일치(adidas ⊂ adidas originals)', C.brandMatchesTags('adidas', ['adidas originals']) === true);
  t('brandMatchesTags: 두 글자는 안 맞춘다(ad)', C.brandMatchesTags('ad', ['adidas']) === false);
  t('brandMatchesTags: 다른 브랜드는 아니다', C.brandMatchesTags('Prada', ['chanel', 'wonhee']) === false);

  console.log('[2] 비로그인 쓰기');
  loggedIn = null; inserted = [];
  let r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, body: '어디 거예요?', nickname: ' 패션덕후 ' }), r);
  t('201 로 받는다 (로그인 없이)', r.code === 201, r.body);
  t('주인은 서버가 만든 ip 해시, user_id 는 null', inserted[0] && inserted[0].anon_key === 'ip:h(1.2.3.4)' && inserted[0].user_id === null, inserted[0]);
  t('닉네임은 다듬어 저장', inserted[0] && inserted[0].nickname === '패션덕후');
  t('응답에 anon 표시 (로그인 권유 신호)', r.body && r.body.item && r.body.item.anon === true);
  t('비로그인은 분당 5건 제한을 탄다', limited >= 1);

  r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, body: 'x' }, { 'user-agent': 'Googlebot/2.1' }), r);
  t('봇 UA 는 403', r.code === 403);

  console.log('[3] 착장 식별');
  tagsForArticle = ['jennie', 'adidas originals', 'superstar']; inserted = [];
  r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, kind: 'outfit', brand: 'adidas', item: 'Superstar 발레코어', nickname: 'a' }), r);
  t('본문 없이 브랜드·아이템만으로 쓸 수 있다', r.code === 201 && inserted[0] && inserted[0].body === 'adidas · Superstar 발레코어', inserted[0]);
  t('기사 태그와 맞으면 verified', inserted[0] && inserted[0].verified === true && inserted[0].kind === 'outfit');
  inserted = []; r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, kind: 'outfit', brand: 'Prada' }), r);
  t('태그와 다르면 verified=false (댓글은 들어간다)', r.code === 201 && inserted[0] && inserted[0].verified === false);
  r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, kind: 'outfit', brand: '' , body: 'x' }), r);
  t('착장 식별인데 브랜드가 없으면 400', r.code === 400);

  console.log('[4] 로그인 쓰기는 그대로');
  loggedIn = { id: '22222222-2222-4222-8222-222222222222' }; inserted = [];
  r = res();
  await C(req('POST', { target_type: 'article', target_id: ART, body: '회원 댓글', nickname: '무시돼야함' }), r);
  t('user_id 로 저장, anon_key·nickname 은 null', inserted[0] && inserted[0].user_id === loggedIn.id && inserted[0].anon_key === null && inserted[0].nickname === null, inserted[0]);

  console.log('[5] 삭제 권한');
  loggedIn = null; calls.length = 0;
  r = res();
  await C(req('DELETE', { id: ART }), r);
  const delOps = calls[calls.length - 1] && calls[calls.length - 1]._ops.map((x) => x.join(':'));
  t('비로그인 삭제는 anon_key 조건이 붙는다', delOps && delOps.some((s) => s === 'eq:anon_key:ip:h(1.2.3.4)') && !delOps.some((s) => s.startsWith('eq:user_id')), delOps);
  loggedIn = { id: '22222222-2222-4222-8222-222222222222' }; calls.length = 0;
  r = res();
  await C(req('DELETE', { id: ART }), r);
  const delOps2 = calls[calls.length - 1] && calls[calls.length - 1]._ops.map((x) => x.join(':'));
  t('로그인 삭제는 user_id 조건', delOps2 && delOps2.some((s) => s === 'eq:user_id:' + loggedIn.id), delOps2);

  console.log('[6] 목록');
  loggedIn = null; calls.length = 0;
  r = res();
  await C({ method: 'GET', headers: { 'user-agent': 'Mozilla/5.0' }, query: { target_type: 'article', target_id: ART } }, r);
  const sel = calls[0] && calls[0]._ops.find((x) => x[0] === 'select');
  t('profiles 는 left join (비로그인 댓글이 빠지지 않게)', sel && /profiles\(name, avatar_url\)/.test(sel[1]) && !/!inner/.test(sel[1]), sel && sel[1]);
  t('kind·brand·item·verified 를 읽는다', sel && /kind, brand, item, verified/.test(sel[1]));
  t('응답에 outfits 집계', r.code === 200 && typeof r.body.outfits === 'number');

  console.log('[7] 배선');
  const src = R('api/content/comments.js');
  t('requireAuth 를 더 쓰지 않는다', !/requireAuth\(/.test(src));
  const mig = R('supabase_migrations/188_comments_anon_outfit.sql');
  t('188: user_id NOT NULL 해제 + anon_key/nickname/kind/brand/item/verified', /DROP NOT NULL/.test(mig) && ['anon_key', 'nickname', 'kind', 'brand', 'item', 'verified'].every((c) => mig.includes(c)));
  t('188: 주인 체크(user_id 또는 anon_key)', /user_id IS NOT NULL OR anon_key IS NOT NULL/.test(mig));
  const fe = R('frontend/pap-engage.js');
  t('프런트: 닉네임 입력과 착장 식별 칸이 있다', /pe-nick/.test(fe) && /pe-brand/.test(fe) && /payload\.kind = 'outfit'/.test(fe));
  const cmtBlock = fe.slice(fe.indexOf("fetch('/api/content/comments', {"), fe.indexOf('setupPush('));
  t('프런트: 댓글 작성 경로에 401 로그인 벽이 없다 (별점 안전망은 별개)', cmtBlock.length > 0 && !/401/.test(cmtBlock) && !/pe-login/.test(cmtBlock));
  t('프런트: verified 표시', /verified/.test(fe));
  const bumped = ['frontend/index.html', 'frontend/articles.html', 'frontend/films.html', 'api/_lib/seoRenderer.js'].every((f) => /pap-engage\.js\?v=10/.test(R(f)));
  t('캐시버스트: 4곳 전부 pap-engage.js?v=10', bumped);

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ comments-anon-outfit tests FAILED'); process.exit(1); }
  console.log('✅ comments-anon-outfit tests passed'); process.exit(0);
})().catch((e) => { console.log('  ✗ 실행 오류', e && e.stack || e); process.exit(1); });
