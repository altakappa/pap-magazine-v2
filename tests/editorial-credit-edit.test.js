/**
 * 프리미엄 회원 크레딧 수정 가드 (2026-08-26 스펙 5절)
 * 원본: PAP-Vault/45_Business/스펙-에디토리얼-크레딧-수정-프리미엄-2026-08-26.md
 *
 * 이 기능은 돈이 걸려 있다. 무료 게재 자격의 근거가 "서로 다른 의상 브랜드
 * 4종 이상"인데, 게재 후 크레딧을 자유롭게 고칠 수 있게 되면 제출 때만 4종을
 * 맞춰 놓고 게재 후 되돌리는 우회가 열린다. 아래 테스트가 그 문을 잠근다.
 *
 * 핸들러는 supabase·auth·telegram 을 가짜로 갈아 끼워 실제로 호출한다.
 * 소스 문자열만 검사하면 "코드가 있다"는 것만 알 뿐 "동작한다"는 걸 모른다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service';

// ── 가짜 DB ───────────────────────────────────────────────────────────────
const DB = { editorials: [], submissions: [], profiles: [] };

function matches(row, filters) {
  return filters.every((f) => {
    if (f.op === 'eq') return row[f.col] === f.val;
    if (f.op === 'in') return f.val.indexOf(row[f.col]) !== -1;
    return true;
  });
}

function builder(table) {
  const st = { op: 'select', filters: [], patch: null };
  const api = {
    select() { return api; },
    eq(col, val) { st.filters.push({ op: 'eq', col, val }); return api; },
    in(col, val) { st.filters.push({ op: 'in', col, val }); return api; },
    order() { return api; },
    update(patch) { st.op = 'update'; st.patch = patch; return api; },
    run() {
      const rows = (DB[table] || []).filter((r) => matches(r, st.filters));
      if (st.op === 'update') {
        rows.forEach((r) => Object.assign(r, st.patch));
      }
      return { data: rows, error: null };
    },
    single() {
      const r = api.run();
      if (!r.data.length) return Promise.resolve({ data: null, error: { message: 'not found' } });
      return Promise.resolve({ data: r.data[0], error: null });
    },
    then(resolve, reject) { return Promise.resolve(api.run()).then(resolve, reject); },
  };
  return api;
}

const SUPA = path.join(ROOT, 'api/_lib/supabase.js');
require.cache[SUPA] = { id: SUPA, filename: SUPA, loaded: true, exports: { supabaseAdmin: { from: builder } } };

// ── 가짜 인증 ─────────────────────────────────────────────────────────────
let CURRENT_USER = null;
const AUTH = path.join(ROOT, 'api/_lib/auth.js');
require.cache[AUTH] = {
  id: AUTH, filename: AUTH, loaded: true,
  exports: {
    verifyToken: () => CURRENT_USER,
    requireAuth: (req, res) => { if (!CURRENT_USER) { res.status(401).json({ message: 'auth' }); return null; } return CURRENT_USER; },
    requireAuthStrict: async (req, res) => { if (!CURRENT_USER) { res.status(401).json({ message: 'auth' }); return null; } return CURRENT_USER; },
    requireAdmin: () => null,
  },
};

// ── 가짜 텔레그램 (await 여부까지 본다) ──────────────────────────────────
const TG = path.join(ROOT, 'api/_lib/telegram.js');
const tgSent = [];
let tgResolved = false;
require.cache[TG] = {
  id: TG, filename: TG, loaded: true,
  exports: {
    sendTextToTelegramSafe: (text) => new Promise((resolve) => setTimeout(() => {
      tgSent.push(text); tgResolved = true; resolve({ ok: true });
    }, 5)),
  },
};

// ── 가짜 감사 로그·레이트리밋·CORS ───────────────────────────────────────
const AUDIT = path.join(ROOT, 'api/_lib/audit.js');
const auditRows = [];
require.cache[AUDIT] = {
  id: AUDIT, filename: AUDIT, loaded: true,
  exports: { recordContentChange: async (o) => { auditRows.push(o); }, diffFields: () => ({}), attachAuthorship: async (r) => r, ACTION_LABEL: {} },
};
const RL = path.join(ROOT, 'api/_lib/rateLimit.js');
require.cache[RL] = { id: RL, filename: RL, loaded: true, exports: { rateLimit: () => false, RATE_LIMITS: { api: {}, auth: {} } } };
const CORS = path.join(ROOT, 'api/_lib/cors.js');
require.cache[CORS] = { id: CORS, filename: CORS, loaded: true, exports: { handleCors: () => false, setCorsHeaders: () => {} } };

const handler = require(path.join(ROOT, 'api/editorials/[id]/credits.js'));
const mine = require(path.join(ROOT, 'api/editorials/mine.js'));
const ce = require(path.join(ROOT, 'api/_lib/creditEdit.js'));

function mkRes() {
  const out = { code: 0, body: null, headers: {} };
  return {
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; },
    end() { return this; },
    _out: out,
  };
}

const TEAM = [{ name: 'Jane Doe', roles: ['Photographer'], instagram: '@jane', website: '' }];
const FOUR = [
  { name: 'Gucci', instagram: '@gucci' },
  { name: 'Prada', instagram: '@prada' },
  { name: 'Loewe', instagram: '@loewe' },
  { name: 'Miu Miu', instagram: '@miumiu' },
];

function reset(opts) {
  const o = opts || {};
  DB.editorials = [{
    id: 'ed-1',
    title: 'Test Editorial',
    slug: 'test-editorial',
    status: o.status || 'published',
    source_submission_id: o.orphan ? null : 'sub-1',
    credits: JSON.parse(JSON.stringify(TEAM)),
    fashion: { brands: JSON.parse(JSON.stringify(o.brands || FOUR)), imageCredits: { img_1: '@gucci Dress, @prada Shoes' } },
    credits_edit_count: o.used || 0,
    credits_history: [],
  }];
  DB.submissions = [{ id: 'sub-1', user_id: 'user-1', payment_status: o.pay || 'none', created_at: '2026-09-10T00:00:00Z' }];
  DB.profiles = [{
    id: 'user-1', email: 'jane@example.com', display_name: 'Jane Doe',
    subscription_plan: o.plan || 'premium', subscription_status: o.subStatus || 'active',
  }];
  CURRENT_USER = { id: o.actor || 'user-1', email: 'jane@example.com' };
  tgSent.length = 0; auditRows.length = 0; tgResolved = false;
}

async function patch(body) {
  const res = mkRes();
  await handler({ method: 'PATCH', query: { id: 'ed-1' }, body, headers: {} }, res);
  return res._out;
}

(async function run() {
  console.log('=== ① 접근 가드 ===');
  reset({ plan: 'standard' });
  let r = await patch({ credits: TEAM, brands: FOUR });
  ok('무료(비프리미엄) 회원은 403', r.code === 403 && r.body.reason === 'not_premium',
    '프론트 게이트만으로는 API 직접 호출을 못 막는다. 받은 코드=' + r.code);

  reset({ actor: 'user-2' });
  r = await patch({ credits: TEAM, brands: FOUR });
  ok('남의 에디토리얼은 404', r.code === 404, '받은 코드=' + r.code);

  reset({ orphan: true });
  r = await patch({ credits: TEAM, brands: FOUR });
  ok('source_submission_id 없는 행(인스타 임포트·legacy)은 404', r.code === 404, '받은 코드=' + r.code);

  reset({ status: 'draft' });
  r = await patch({ credits: TEAM, brands: FOUR });
  ok('게재 전(draft) 건은 거부', r.code === 409, '받은 코드=' + r.code);

  reset();
  CURRENT_USER = null;
  r = await patch({ credits: TEAM, brands: FOUR });
  ok('비로그인은 401', r.code === 401, '받은 코드=' + r.code);

  console.log('\n=== ② 브랜드 종류 수 감소 금지 (스펙 0-2) ===');
  reset();
  r = await patch({ brands: FOUR.slice(0, 3) });
  ok('행 삭제로 4종 → 3종: 거부', r.code === 400 && r.body.reason === 'brand_count_decreased',
    '무료 자격의 근거가 사라진다. 받은 코드=' + r.code);
  ok('  → 무엇이 문제인지 응답에 담긴다', !!r.body && /4종에서 3종/.test(r.body.message || ''), r.body && r.body.message);

  reset();
  r = await patch({ brands: [{ name: 'Gucci' }, { name: 'Gucci' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('같은 이름으로 개명해 4종 → 3종: 거부', r.code === 400 && r.body.reason === 'brand_count_decreased', '받은 코드=' + r.code);

  reset();
  r = await patch({ brands: [{ name: "Stylist's Own" }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('관용 표기로 개명해 4종 → 3종: 거부', r.code === 400 && r.body.reason === 'brand_count_decreased', '받은 코드=' + r.code);

  reset({ brands: [{ name: 'Guccii' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  r = await patch({ brands: [{ name: 'Gucci' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('순수 오타 수정(Guccii → Gucci)은 통과', r.code === 200, '정상 사용자의 진짜 정정을 막으면 안 된다. 받은 코드=' + r.code);

  reset();
  r = await patch({ brands: FOUR.concat([{ name: 'Ferragamo' }]) });
  ok('브랜드를 늘리는 것은 통과', r.code === 200, '받은 코드=' + r.code);

  console.log('\n=== ③ 전면 교체는 허용한다 (스펙 0-2-b) ===');
  reset({ pay: 'none' });
  r = await patch({ brands: [{ name: 'Balenciaga' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('무료 건에서 브랜드 전면 교체 성공 (Gucci → Balenciaga)', r.code === 200, '받은 코드=' + r.code + ' ' + JSON.stringify(r.body));
  reset({ pay: 'paid' });
  r = await patch({ brands: [{ name: 'Balenciaga' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('유료 건에서도 전면 교체 성공', r.code === 200, '받은 코드=' + r.code);

  // SPA 는 브랜드로 세지 않는다(2026-08-26 지시). 따라서 세어지던 브랜드를
  // SPA 로 바꾸면 종류 수가 줄어 거부된다. 막는 것 자체는 옳지만, 왜 줄었는지
  // 안 알려 주면 "이름만 바꿨는데 왜?" 문의가 그대로 들어온다.
  reset({ pay: 'paid' });
  r = await patch({ brands: [{ name: 'Zara' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('세어지던 브랜드를 SPA 로 바꾸면 거부', r.code === 400 && r.body.reason === 'brand_count_decreased', '받은 코드=' + r.code);
  ok('  → 세지 않는 항목이 무엇인지 응답에 담긴다',
    !!r.body && Array.isArray(r.body.uncounted) && r.body.uncounted.indexOf('Zara') !== -1
    && /SPA/.test(r.body.message || ''), JSON.stringify(r.body));

  const SRC = read('api/editorials/[id]/credits.js');
  ok('편집거리 차단 코드가 되살아나지 않았다',
    !/looksLikeTypo|editDistance/.test(SRC),
    '한번 넣었다 뺀 규칙이다. 차단 용도로 다시 들어오면 정상 정정이 막힌다');

  console.log('\n=== ④ 결제 게이트 (스펙 0-2-c) ===');
  for (const st of ['awaiting_payment', 'awaiting_authorization']) {
    reset({ pay: st });
    r = await patch({ brands: FOUR });
    ok(st + ' 는 403', r.code === 403 && r.body.reason === 'payment_pending', '받은 코드=' + r.code);
  }
  for (const st of ['none', 'paid']) {
    reset({ pay: st });
    r = await patch({ brands: FOUR });
    ok(st + ' 는 통과', r.code === 200, '받은 코드=' + r.code);
  }
  reset({ pay: 'some_new_status_2027' });
  r = await patch({ brands: FOUR });
  ok('모르는 새 상태값은 기본 거부 (화이트리스트)', r.code === 403,
    '블랙리스트로 짜면 상태값이 하나 늘 때 조용히 구멍이 생긴다. 받은 코드=' + r.code);
  ok('  → 소스가 화이트리스트를 쓴다', /PAYMENT_EDITABLE\.includes\(pay\)/.test(SRC));

  console.log('\n=== ⑤ 라틴 전용 (2026-08-26 지시) ===');
  reset();
  r = await patch({ brands: [{ name: '자라' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('한글 브랜드명은 400', r.code === 400 && r.body.reason === 'non_latin_brand', '받은 코드=' + r.code);
  reset();
  r = await patch({ brands: [{ name: 'Hermès' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('악센트 라틴(Hermès)은 허용', r.code === 200, '받은 코드=' + r.code);

  console.log('\n=== ⑥ 횟수 (스펙 0-3) ===');
  reset({ used: 2 });
  r = await patch({ brands: FOUR });
  ok('3회차는 성공', r.code === 200 && r.body.editsUsed === 3 && r.body.editsLeft === 0, JSON.stringify(r.body));
  reset({ used: 3 });
  r = await patch({ brands: FOUR });
  ok('4회차는 거부', r.code === 403 && r.body.reason === 'limit_reached', '받은 코드=' + r.code);
  reset({ used: 1 });
  r = await patch({ brands: FOUR.slice(0, 2) });
  ok('검증 실패는 횟수를 차감하지 않는다', r.code === 400 && DB.editorials[0].credits_edit_count === 1,
    '실패한 시도가 횟수를 먹으면 회원이 손해를 본다. 남은 카운트=' + DB.editorials[0].credits_edit_count);

  console.log('\n=== ⑦ 저장 결과 ===');
  reset();
  r = await patch({ credits: [{ name: 'Jane Doe', roles: ['Photographer', 'Retouching'], instagram: 'jane' }], brands: FOUR });
  ok('팀 크레딧은 자유롭게 바뀐다 (브랜드 가드가 오적용되지 않는다)', r.code === 200, '받은 코드=' + r.code);
  ok('  → 핸들에 @ 가 붙어 저장된다', DB.editorials[0].credits[0].instagram === '@jane');
  ok('credits_history 에 before/after 가 쌓인다',
    DB.editorials[0].credits_history.length === 1
    && !!DB.editorials[0].credits_history[0].before
    && !!DB.editorials[0].credits_history[0].after,
    '분쟁이 나면 이 이력이 유일한 근거다');
  ok('회원 수정만 세는 카운터가 오른다', DB.editorials[0].credits_edit_count === 1);
  ok('감사 로그가 남는다', auditRows.length === 1 && auditRows[0].content_id === 'ed-1');

  reset();
  r = await patch({ brands: [{ name: 'Gucci', instagram: '@gucci.official' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('브랜드 핸들이 바뀌면 이미지 크레딧의 @토큰도 같이 바뀐다',
    r.code === 200 && /@gucci\.official Dress/.test(DB.editorials[0].fashion.imageCredits.img_1),
    '안 바꾸면 브랜드 목록만 고쳐지고 사진 밑 크레딧은 옛 이름으로 남는다: '
    + JSON.stringify(DB.editorials[0].fashion.imageCredits));

  console.log('\n=== ⑧ 텔레그램 알림 (스펙 3-D) ===');
  reset();
  r = await patch({ brands: FOUR.concat([{ name: 'Ferragamo' }]) });
  ok('알림이 await 된다 (응답 전에 전송이 끝나 있다)', tgResolved && tgSent.length === 1,
    'fire-and-forget 은 서버리스에서 유실된다. 2026-08-26 실측 전례');
  const msg = tgSent[0] || '';
  ok('  → 제목이 들어 있다', msg.indexOf('Test Editorial') !== -1);
  ok('  → 수정자와 이메일이 들어 있다', msg.indexOf('Jane Doe') !== -1 && msg.indexOf('jane@example.com') !== -1);
  ok('  → 회차가 들어 있다', /수정 1\/3회차/.test(msg));
  ok('  → 변경 전 → 변경 후 대조가 들어 있다', /→/.test(msg) && /의상 브랜드 \(4종 → 5종\)/.test(msg));
  ok('  → 링크가 들어 있다', /\/editorial\/test-editorial/.test(msg));
  ok('  → 정상 건에는 의심 표시가 없다', msg.indexOf('확인 필요') === -1, msg);

  reset();
  r = await patch({ brands: [{ name: 'Gucci' }, { name: 'Gucci Milano' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('첫 토큰을 공유하면 ⚠️ 확인 필요', r.code === 200 && /확인 필요/.test(tgSent[0] || ''), tgSent[0]);
  ok('  → 무료 건이라는 사실이 사유에 적힌다', /무료 게재 건/.test(tgSent[0] || ''));

  reset();
  r = await patch({ brands: [{ name: 'Balenciaga' }, { name: 'Rick Owens' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('오타 수준을 넘는 교체 2건이면 ⚠️ 확인 필요', r.code === 200 && /확인 필요/.test(tgSent[0] || ''), tgSent[0]);

  reset({ brands: [{ name: 'Guccii' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  r = await patch({ brands: [{ name: 'Gucci' }, { name: 'Prada' }, { name: 'Loewe' }, { name: 'Miu Miu' }] });
  ok('정상 오타 수정 1건에는 붙지 않는다 (오탐 방지)', (tgSent[0] || '').indexOf('확인 필요') === -1, tgSent[0]);

  console.log('\n=== ⑨ 계산기 단일 출처 ===');
  const CE = read('api/_lib/creditEdit.js');
  ok('브랜드 종류 수를 submissionType 의 함수로 센다',
    /require\('\.\/submissionType'\)/.test(CE) && /isGenericCredit/.test(CE) && /isSpaBrand/.test(CE) && /normBrand/.test(CE),
    '여기서 새로 세면 무료 게재 자격 판정과 어긋난다');
  ok('SPA 브랜드는 종류 수에 세지 않는다',
    ce.countRealBrands([{ name: 'Zara' }, { name: 'Mango' }, { name: 'Gucci' }]) === 1,
    '2026-08-26 지시: SPA·빈티지는 브랜드로 카운트하지 않는다');
  ok('상수는 한 곳에서만 정의된다',
    (read('api/editorials/mine.js').indexOf('MAX_CREDIT_EDITS = 3') === -1)
    && (SRC.indexOf('MAX_CREDIT_EDITS = 3') === -1)
    && /const MAX_CREDIT_EDITS = 3;/.test(CE),
    '두 벌이 되면 화면의 남은 횟수와 서버 판정이 갈린다');

  console.log('\n=== ⑩ 목록 API ===');
  reset({ plan: 'standard' });
  {
    const res = mkRes();
    await mine({ method: 'GET', query: {}, headers: {} }, res);
    ok('무료 회원 목록은 canEditCredits=false', res._out.code === 200
      && res._out.body.editorials.length === 1
      && res._out.body.editorials[0].canEditCredits === false
      && res._out.body.editorials[0].blockedReason === 'not_premium', JSON.stringify(res._out.body));
  }
  reset();
  {
    const res = mkRes();
    await mine({ method: 'GET', query: {}, headers: {} }, res);
    ok('프리미엄 회원 목록은 canEditCredits=true', res._out.body.editorials[0].canEditCredits === true);
    ok('  → 남은 횟수를 내려준다', res._out.body.editorials[0].editsLeft === 3 && res._out.body.maxEdits === 3);
    ok('  → 목록 응답은 캐시하지 않는다', res._out.headers['Cache-Control'] === 'private, no-store');
  }

  console.log('\n=== ⑪ 마이페이지 화면 ===');
  const MP = read('frontend/mypage.html');
  ok('기존 #mp-contributions 를 재사용한다 (새 섹션을 만들지 않았다)',
    /id="mp-contributions"/.test(MP) && (MP.match(/id="mpContributionsList"/g) || []).length === 1);
  ok('목록 로더가 /api/editorials/mine 을 부른다', /fetch\('\/api\/editorials\/mine'/.test(MP));
  ok('수정 버튼은 서버가 준 canEditCredits 로만 그린다',
    /if\(e\.canEditCredits\)/.test(MP) && /mpOpenCreditEdit/.test(MP));
  ok('무료 회원에게는 버튼 대신 한 줄 안내가 나간다',
    /not_premium/.test(MP) && /utm_source=mypage_credit_edit/.test(MP),
    '판매 문구를 전면에 세우지 않되, 왜 못 고치는지는 알려야 한다');
  ok('저장은 PATCH /api/editorials/:id/credits 로 간다',
    /method: 'PATCH'/.test(MP) && /\/credits'/.test(MP));
  ok('화면이 SPA·관용 표기 목록을 복사하지 않았다',
    !/_PAP_SPA|SPA_BRANDS/.test(MP) && !/_PAP_GENERIC_CREDITS/.test(MP),
    '목록을 복사하면 서버와 갈라져 화면은 되는데 저장이 안 되는 상태가 된다');
  ok('라틴 전용 검사는 서브미션 폼과 같은 검사기를 쓴다',
    /pap-name-validator\.js/.test(MP) && /_papValidateLatinOnly/.test(MP));
  ok('저장 전 변경 요약을 확인받는다', /_mpDiffSummary/.test(MP) && /confirm\(summary/.test(MP));
  ok('모달 문구 i18n 키가 ko·en 양쪽에 있다',
    (MP.match(/mpcBrandNote:/g) || []).length >= 2 && (MP.match(/mpcTeam:/g) || []).length >= 2);
  ok('안내 문구에 3개 제약(횟수·종류 수·SPA)이 함께 적혀 있다',
    /브랜드 종류 수를 줄일 수는 없습니다/.test(MP) && /SPA/.test(MP) && /남은 수정 횟수/.test(MP),
    '셋을 함께 안 쓰면 "왜 수정이 안 되냐"는 문의가 그대로 들어온다');
  ok('"곧 출시" 안내가 남아 있지 않다', !/contribComing"/.test(MP),
    '기능이 나왔는데 준비 중이라고 적혀 있으면 아무도 안 쓴다');

  console.log('\n크레딧 수정 가드: ' + pass + '건 통과' + (fails.length ? ' · ' + fails.length + '건 실패' : ''));
  if (fails.length) { console.log('\n실패:\n - ' + fails.join('\n - ')); process.exit(1); }
})();
