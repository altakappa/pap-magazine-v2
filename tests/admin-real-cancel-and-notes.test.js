/**
 * 2026-08-12 — 어드민이 실제로 결제를 멈출 수 있는가, 그리고 결제 기록이 살아남는가.
 *
 * [1] '취소됨' 은 글자만 바꾸는 가짜 취소였다
 *     운영자가 회원 편집창에서 구독 상태를 '취소됨' 으로 저장하면
 *     api/admin/member-update.js 는 profiles.subscription_status 에 문자열을
 *     쓰는 것이 전부였다. 결제사는 우리 DB 를 모르므로 다음 달에도 계속 긁는다.
 *     실제 해지 헬퍼(cancelProviderSubscription)는 있었지만 호출부가 회원
 *     '삭제' 와 본인 '탈퇴' 뿐이었다 — 즉 결제를 멈추려면 회원을 통째로 지워야 했다.
 *     8/14 에 Paddle 고객 포털이라는 안전망까지 사라지면 남는 수단이 없다.
 *
 * [2] 심사 저장 한 번에 애드온 결제 기록이 지워졌다
 *     애드온(€110/€220)은 전용 컬럼이 없어 admin_notes 에 한 줄로만 남는다.
 *     api/submissions/[id]/review.js 는 admin_notes 를 통째로 덮어썼고,
 *     심사창의 메모 칸은 기존 값을 불러오지도 않았다(항상 빈칸).
 *     → 의견을 안 쓰고 저장만 해도 €220 기록이 빈 문자열로 덮여 사라졌다.
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

// ── [2a] admin_notes 분리 로직 — 실제로 호출해서 본다 ──────────────────
console.log('=== admin_notes — 결제 기록과 사람 메모를 가른다 ===');
const { splitAdminNotes, mergeAdminNotes, PAYMENT_LINE_RE } = require(path.join(ROOT, 'api/_lib/adminNotes.js'));
{
  const PAY1 = '[2026-08-12] PayPal 애드온 결제: ig_images_cover €220 (order 5AB123)';
  const PAY2 = '[2026-08-13] PayPal 애드온 결제: ig_collab €110 (order 9XY777)';
  const PADDLE = '[2026-07-02] Paddle 애드온 결제: posting_date €110 (txn_01)';

  ok('결제 줄을 알아본다 (PayPal)', PAYMENT_LINE_RE.test(PAY1));
  ok('결제 줄을 알아본다 (Paddle · 옛 건)', PAYMENT_LINE_RE.test(PADDLE));
  ok('사람 메모는 결제 줄이 아니다', !PAYMENT_LINE_RE.test('브랜드 크레딧 확인 필요'));
  ok('날짜 없는 줄은 결제 줄이 아니다', !PAYMENT_LINE_RE.test('PayPal 로 결제하라고 안내함'));

  const mixed = '크레딧 확인함\n' + PAY1 + '\n다시 확인 필요\n' + PAY2;
  const sp = splitAdminNotes(mixed);
  ok('결제 줄 2개를 뽑아낸다', sp.payments.length === 2 && sp.payments[0] === PAY1 && sp.payments[1] === PAY2);
  ok('사람 메모만 남긴다', sp.human === '크레딧 확인함\n다시 확인 필요');

  // 이게 실제로 일어난 사고다 — 심사자가 빈칸으로 저장
  const merged = mergeAdminNotes(mixed, '');
  ok('메모를 비워도 결제 기록은 남는다', merged.indexOf('€220') !== -1 && merged.indexOf('€110') !== -1,
    '이 한 줄이 안 되면 €220 이 심사 버튼 한 번에 사라진다');
  ok('  → 사람 메모는 실제로 지워진다', merged.indexOf('크레딧 확인함') === -1);

  const merged2 = mergeAdminNotes(mixed, '승인. 커버 2번으로.');
  ok('새 메모가 위, 결제 기록이 아래', merged2.indexOf('승인. 커버 2번으로.') === 0
    && merged2.indexOf(PAY1) > 0 && merged2.indexOf(PAY2) > merged2.indexOf(PAY1));

  ok('결제 기록이 없으면 메모만 남는다', mergeAdminNotes('옛 메모', '새 메모') === '새 메모');
  ok('null/undefined 를 견딘다', mergeAdminNotes(null, null) === '' && splitAdminNotes(undefined).payments.length === 0);
  ok('두 번 합쳐도 결제 줄이 늘어나지 않는다',
    (mergeAdminNotes(mergeAdminNotes(mixed, 'a'), 'b').match(/€220/g) || []).length === 1,
    '멱등하지 않으면 저장할 때마다 기록이 복제된다');
}

// ── [2b] review.js 가 실제로 그 로직을 쓰는가 ─────────────────────────
console.log('=== 심사 저장이 결제 기록을 지우지 않는다 ===');
{
  const src = read('api/submissions/[id]/review.js');
  ok('mergeAdminNotes 를 가져온다', /require\('\.\.\/\.\.\/_lib\/adminNotes'\)/.test(src));
  // 2026-08-12 — 같은 조회가 payment_status 도 함께 읽도록 넓어졌다(승인후결제
  // 게이트). 컬럼 목록을 문자 그대로 고정하면 이런 확장마다 깨진다. 의도는
  // "저장 전에 기존 admin_notes 를 읽는가" 이므로 그것만 본다.
  // 2026-08-13 — 또 넓어졌다(청구 선확인 게이트: id·paypal_authorization_id·description
  // 추가). 이번엔 admin_notes 가 첫 컬럼이 아니게 되면서 깨졌다 — 순서 의존까지
  // 없앤다. 이 단언이 봐야 하는 것은 컬럼 목록의 모양이 아니라 "읽는가" 뿐이다.
  ok('저장 전에 기존 admin_notes 를 읽는다',
    /select\('(?:[^']*,\s*)?admin_notes(?:\s*,[^']*)?'\)/.test(src) && /prevNotes\s*=/.test(src));
  // reviewPatch 리터럴 자체는 순수하게 둔다 — submission-review-audit 이 떼어
  // 실행하는 구간이다. 결제 기록 보존은 그 뒤 patchToWrite 에서 한다.
  ok('DB 에 쓰는 값은 reviewPatch 가 아니라 patchToWrite 다',
    /\.update\(patchToWrite\)/.test(src),
    'reviewPatch 를 그대로 쓰면 결제 기록이 다시 사라진다');
  ok('mergeAdminNotes 결과를 쓴다',
    /patchToWrite\.admin_notes = mergeAdminNotes\(prevNotes, reviewPatch\.admin_notes\)/.test(src));
  ok('기존 값을 못 읽으면 admin_notes 를 아예 빼고 저장한다',
    /delete patchToWrite\.admin_notes/.test(src),
    '읽기 실패 시 덮어쓰면 기록을 잃는다 — 메모가 안 바뀌는 편이 낫다');
}

// ── [2c] 어드민 화면 ──────────────────────────────────────────────────
console.log('=== 심사창이 기존 메모를 불러오고 결제 기록을 보여준다 ===');
{
  const js = read('frontend/pap-admin.js');
  ok('심사 메모 칸을 기존 값으로 채운다', /_rn\.value\s*=\s*_notes\.human/.test(js),
    '항상 빈칸이면 심사자가 무심코 기존 메모를 날린다');
  ok('결제 기록을 읽기 전용으로 보여준다', /reviewPaymentLog/.test(js));
  ok('수정 불가라고 명시한다', /결제 기록 \(자동 · 수정 불가\)/.test(js));
  ok('프론트 규칙이 서버와 같다 (PayPal|Paddle 접두 줄)',
    /_PAY_LINE_RE\s*=\s*\/\^\\\[\\d\{4\}-\\d\{2\}-\\d\{2\}\\\]\\s\+\(PayPal\|Paddle\)/.test(js));
  ok('주석의 "Paddle 웹훅이 갱신" 오기를 고쳤다', !/결제 확정은 Paddle 웹훅\(키퍼\)/.test(js));
}

// ── [1] 어드민 '취소됨' 이 실제로 결제를 끊는가 — 실행해서 본다 ────────
console.log('=== 어드민 취소가 결제사까지 간다 ===');

function loadMemberUpdate(stubs) {
  const p = (rel) => require.resolve(path.join(ROOT, rel));
  const set = (rel, exports) => { require.cache[p(rel)] = { id: p(rel), filename: p(rel), loaded: true, exports }; };
  set('api/_lib/cors.js', { handleCors: () => false });
  set('api/_lib/rateLimit.js', { rateLimit: () => false, RATE_LIMITS: { api: {} } });
  set('api/_lib/auth.js', {
    requireAdmin: async () => ({ id: 'ADMIN' }),
    requireMainAdmin: async () => ({ id: 'ADMIN' }),
    invalidateTokens: async () => true,
  });
  set('api/_lib/cancelProviderSubscription.js', {
    cancelProviderSubscription: async (db, uid) => { stubs.cancelCalls.push(uid); return stubs.cancelResult; },
  });
  const profile = { id: 'M1', email: 'a@b.c', role: 'member', subscription_plan: 'premium', subscription_status: 'active', updated_at: null };
  set('api/_lib/supabase.js', {
    supabaseAdmin: {
      from() {
        const q = {
          select() { return q; },
          eq() { return q; },
          single() { return Promise.resolve({ data: Object.assign({}, profile, stubs.lastUpdate || {}), error: null }); },
          update(patch) { stubs.updates.push(patch); stubs.lastUpdate = patch; return q; },
        };
        return q;
      },
    },
  });
  delete require.cache[p('api/admin/member-update.js')];
  return require(p('api/admin/member-update.js'));
}

function makeRes() {
  const out = { code: 0, body: null };
  return { out, status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
}

(async () => {
  {
    // 해지 성공 → 상태를 바꾼다
    const stubs = { cancelCalls: [], updates: [], cancelResult: { ok: true, action: 'canceled', provider: 'paypal' } };
    const h = loadMemberUpdate(stubs);
    const res = makeRes();
    await h({ method: 'PATCH', body: { memberId: 'M1', subscriptionStatus: 'cancelled' } }, res);
    ok('취소됨을 고르면 결제사 해지를 부른다', stubs.cancelCalls.length === 1 && stubs.cancelCalls[0] === 'M1',
      '이걸 안 부르면 화면만 취소되고 카드는 계속 긁힌다');
    ok('  → 성공하면 상태를 저장한다', res.out.code === 200 && stubs.updates.some((u) => u.subscription_status === 'cancelled'));
    ok('  → 무슨 일이 있었는지 화면에 돌려준다', res.out.body.subscriptionCancel === 'canceled' && res.out.body.subscriptionCancelProvider === 'paypal');
  }
  {
    // 해지 실패 → 아무것도 바꾸지 않는다
    const stubs = { cancelCalls: [], updates: [], cancelResult: { ok: false, action: 'failed', message: 'PayPal cancel failed (500)' } };
    const h = loadMemberUpdate(stubs);
    const res = makeRes();
    await h({ method: 'PATCH', body: { memberId: 'M1', subscriptionStatus: 'cancelled' } }, res);
    ok('해지에 실패하면 409 로 막는다', res.out.code === 409 && res.out.body.code === 'subscription_cancel_failed');
    ok('  → profiles 를 건드리지 않는다', stubs.updates.length === 0,
      '화면만 "취소됨" 이 되고 결제는 계속되는 상태가 원래 문제였다');
    ok('  → 실패 이유를 운영자에게 보여준다', /PayPal cancel failed/.test(res.out.body.message));
  }
  {
    // 취소가 아닌 변경은 결제사를 부르지 않는다
    const stubs = { cancelCalls: [], updates: [], cancelResult: { ok: true, action: 'canceled' } };
    const h = loadMemberUpdate(stubs);
    const res = makeRes();
    await h({ method: 'PATCH', body: { memberId: 'M1', subscriptionPlan: 'standard', subscriptionStatus: 'active' } }, res);
    ok('활성으로 바꿀 때는 결제사를 부르지 않는다', stubs.cancelCalls.length === 0 && res.out.code === 200);
  }

  console.log('=== 어드민 화면이 되돌릴 수 없는 동작임을 알린다 ===');
  {
    const js = read('frontend/pap-admin.js');
    const html = read('frontend/admin.html');
    ok('취소됨을 고르면 한 번 묻는다', /status === 'cancelled' && origStatus !== 'cancelled'/.test(js));
    ok('  → 환불하지 않는다고 말한다', /환불하지 않으며/.test(js));
    ok('  → 남은 기간은 쓸 수 있다고 말한다', /그 기간까지는 계속 이용할 수 있습니다/.test(js));
    ok('드롭다운 라벨이 실제 동작을 말한다', /취소됨 \(Cancelled · PayPal 구독도 실제로 해지\)/.test(html));
    ok('저장 후 결제사 처리 결과를 알린다', /결제사 구독을 해지했습니다/.test(js));
  }

  console.log('\n=== SUMMARY ===');
  if (fails.length) {
    console.error('passed: ' + pass + '   failed: ' + fails.length);
    fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
    process.exit(1);
  }
  console.log('passed: ' + pass + '   failed: 0');
  console.log('✓ admin-real-cancel-and-notes tests passed');
  process.exit(0);
})();
