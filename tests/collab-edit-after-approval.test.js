/**
 * 승인 뒤 · 게시 전 공동작업자 수정 (2026-11-15)
 * ─────────────────────────────────────────────────────────────────────
 * 실측(도메니코): 승인이 끝난 뒤 연간 프리미엄으로 올린 회원이 공동작업자를 적을
 * 곳이 없어 사람에게 물어 왔다("리스트를 어디에 적나요"). 전체 수정은 pending·
 * revision 에서만 열리는데 — 그 잠금은 심사한 것과 실린 것이 달라지는 걸 막는
 * 장치라 그대로 둬야 한다 — 공동작업자는 심사 판단과 무관하다. 진짜 기한은
 * '심사 종료' 가 아니라 '인스타그램 게시 전' 이다.
 *
 * 그래서 공동작업자 한 칸만 받는 문을 따로 냈다. 이 파일은 그 문을 **실제로 호출해**
 * 열리는 조건과 닫히는 조건을 확인한다. grep 은 "그 코드가 있다" 까지만 말하고,
 * 조건이 반대로 쓰인 것은 돌려 봐야 나온다.
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = (f) => path.join(ROOT, f);

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'x';
process.env.SUPABASE_SERVICE_KEY = 'x';
process.env.JWT_SECRET = 'x';

const OWNER = { id: '11111111-1111-1111-1111-111111111111', email: 'owner@example.com' };
const OTHER = { id: '22222222-2222-2222-2222-222222222222', email: 'other@example.com' };
const SUB_ID = '33333333-3333-3333-3333-333333333333';

/* 시나리오 손잡이 — 각 테스트가 이것만 바꾼다 */
const S = {
  user: OWNER,
  status: 'approved',
  editorials: [{ id: 'e1', status: 'draft' }],
  yearly: true,                       // 제출자의 연간 프리미엄 구독
  members: { friend: 'u-friend', pal: 'u-pal' },   // 인스타 아이디 → userId (등록된 PAP 회원)
  stored: [],                         // 현재 저장된 공동작업자
};
let saved = null;          // 마지막으로 저장된 description
let telegram = [];         // 보낸 알림
let images = [];           // 이미지 워커 호출

require.cache[require.resolve(P('api/_lib/auth.js'))] = {
  id: require.resolve(P('api/_lib/auth.js')), loaded: true,
  exports: { requireAuth: () => S.user, requireAdmin: async () => S.user },
};
require.cache[require.resolve(P('api/_lib/cors.js'))] = {
  id: require.resolve(P('api/_lib/cors.js')), loaded: true,
  exports: { handleCors: () => false },
};
require.cache[require.resolve(P('api/_lib/rateLimit.js'))] = {
  id: require.resolve(P('api/_lib/rateLimit.js')), loaded: true,
  exports: { rateLimit: () => false, RATE_LIMITS: { api: {} } },
};
require.cache[require.resolve(P('api/_lib/telegram.js'))] = {
  id: require.resolve(P('api/_lib/telegram.js')), loaded: true,
  exports: { sendTextToTelegramSafe: async (m) => { telegram.push(String(m)); return true; } },
};
require.cache[require.resolve(P('api/_lib/collabTelegram.js'))] = {
  id: require.resolve(P('api/_lib/collabTelegram.js')), loaded: true,
  exports: {
    collabCreditText: () => '크레딧',
    dispatchCollabImages: async (id, kind) => { images.push(id + ':' + kind); },
    /* 바뀜 판정은 진짜 규칙을 쓴다 — 여기서 가짜로 true 를 주면
       "안 바뀌었는데 알림이 간다" 를 못 잡는다. */
    collaboratorsChanged: require(P('api/_lib/collabTelegram.js')).collaboratorsChanged,
  },
};

/* supabase 스텁 — 표 이름으로 갈라 준다. collaborators.js / premiumFeeWaiver.js 의
   진짜 코드가 이 위에서 돈다(자격 판정을 가짜로 만들지 않는다). */
function table(name) {
  const q = {
    _name: name, _filters: {},
    select() { return q; },
    eq(col, val) { q._filters[col] = val; return q; },
    in(col, vals) { q._filters[col] = vals; return q; },
    not() { return q; },
    order() { return q; },
    limit() { return q; },
    maybeSingle: async () => ({ data: rows(name, q._filters)[0] || null, error: null }),
    single: async () => {
      const r = rows(name, q._filters)[0];
      return r ? { data: r, error: null } : { data: null, error: { message: 'not found' } };
    },
    update(patch) {
      return { eq: async () => { if (name === 'submissions') saved = patch.description; return { error: null }; } };
    },
    then(res) { return Promise.resolve({ data: rows(name, q._filters), error: null }).then(res); },
  };
  return q;
}
function rows(name) {
  if (name === 'submissions') {
    return [{
      id: SUB_ID, user_id: OWNER.id, title: 'The carrier', status: S.status,
      file_urls: ['a.jpg'],
      description: JSON.stringify({ team: [], looks: [], collaborators: S.stored }),
    }];
  }
  if (name === 'editorials') return S.editorials.slice();
  if (name === 'subscriptions') {
    return S.yearly
      ? [{ id: 's1', plan: 'premium_yearly', status: 'active', billing_cycle: 'yearly',
           current_period_start: '2026-11-14T00:00:00Z', current_period_end: '2027-11-15T00:00:00Z' }]
      : [{ id: 's1', plan: 'premium_monthly', status: 'active', billing_cycle: 'monthly',
           current_period_start: '2026-11-01T00:00:00Z', current_period_end: '2026-12-01T00:00:00Z' }];
  }
  if (name === 'profiles') {
    return Object.keys(S.members).map((h) => ({ id: S.members[h], instagram: h }));
  }
  return [];
}
require.cache[require.resolve(P('api/_lib/supabase.js'))] = {
  id: require.resolve(P('api/_lib/supabase.js')), loaded: true,
  exports: { supabaseAdmin: { from: table } },
};

const handler = require(P('api/submissions/[id]/collaborators.js'));

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function call(collaborators, over) {
  saved = null; telegram = []; images = [];
  const res = mkRes();
  await handler(Object.assign({
    method: 'PUT', headers: {}, query: { id: SUB_ID }, body: { collaborators },
  }, over || {}), res);
  return res;
}
function reset() {
  S.user = OWNER; S.status = 'approved';
  S.editorials = [{ id: 'e1', status: 'draft' }];
  S.yearly = true; S.stored = [];
  S.members = { friend: 'u-friend', pal: 'u-pal' };
}

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); } }

(async () => {
  console.log('=== 1. 승인됐지만 게시 전 — 열린다 ===');
  reset();
  {
    const r = await call(['@friend', 'pal']);
    t('200 으로 저장된다', r.code === 200 && r.body && r.body.ok === true, r.code + ' ' + JSON.stringify(r.body));
    t('아이디가 userId 와 함께 저장된다', /"collaborators":\[\{"handle":"friend","userId":"u-friend"\},\{"handle":"pal","userId":"u-pal"\}\]/.test(String(saved)), saved);
    t('심사 내용은 건드리지 않는다 (제목·룩이 그대로)', /"looks":\[\]/.test(String(saved)) && !/"title"/.test(String(saved)));
    t('고친 시각을 남긴다', /collaboratorsEditedAt/.test(String(saved)));
    /* 도메니코 2026-09-24 "반드시 인스타그램용 이미지와 크레딧과 함께 알려줘" */
    t('텔레그램 머리말 + 복사용 크레딧 둘 다 나간다', telegram.length === 2 && /공동작업자 수정/.test(telegram[0]));
    t('이미지 워커를 깨운다', images.length === 1 && images[0] === SUB_ID + ':resubmit', images.join(','));
  }

  console.log('\n=== 2. 닫히는 조건 ===');
  reset(); S.editorials = [{ id: 'e1', status: 'published' }];
  {
    const r = await call(['@friend']);
    /* 인스타그램은 이미 올라간 게시물에 공동작업자를 붙일 수 없다. "바꿀 수 있다" 고
       말하면 거짓이 되므로 여기서 닫는다. */
    t('발행된 에디토리얼 → 409 editorial_published', r.code === 409 && r.body.code === 'editorial_published', r.code + ' ' + JSON.stringify(r.body));
    t('저장하지 않는다', saved === null);
    t('알림도 보내지 않는다', telegram.length === 0 && images.length === 0);
  }
  reset(); S.status = 'rejected';
  {
    const r = await call(['@friend']);
    t('거절된 건 → 409 not_editable (실릴 것이 없으면 태그할 자리도 없다)',
      r.code === 409 && r.body.code === 'not_editable', r.code + ' ' + JSON.stringify(r.body));
  }
  reset(); S.user = OTHER;
  {
    const r = await call(['@friend']);
    t('남의 서브미션 → 403', r.code === 403 && r.body.code === 'not_owner', r.code);
    t('저장하지 않는다', saved === null);
  }
  reset(); S.yearly = false;
  {
    const r = await call(['@friend']);
    /* 자격은 폼·접수 메일·승인 재판정과 같은 canPickCollaborators 한 곳에서 나온다 */
    t('연간 프리미엄이 아니면 → 400 COLLAB_YEARLY_PREMIUM_ONLY',
      r.code === 400 && r.body.code === 'COLLAB_YEARLY_PREMIUM_ONLY', r.code + ' ' + JSON.stringify(r.body));
    t('저장하지 않는다', saved === null);
  }
  reset();
  {
    const r = await call(['@friend', '@stranger']);
    t('회원이 아닌 아이디가 섞이면 → 400 COLLAB_NOT_MEMBER + 어느 아이디인지',
      r.code === 400 && r.body.code === 'COLLAB_NOT_MEMBER'
      && (r.body.handles || []).indexOf('stranger') !== -1, JSON.stringify(r.body));
    /* 하나만 틀려도 전부 저장하지 않는다 — 반만 적용되면 사람이 더 혼란스럽다 */
    t('일부만 저장되지 않는다', saved === null);
  }
  reset();
  {
    const r = await call(['a', 'b', 'c', 'd', 'e', 'f']);
    t('6명 → 400 COLLAB_MAX', r.code === 400 && r.body.code === 'COLLAB_MAX', r.code + ' ' + JSON.stringify(r.body));
  }

  console.log('\n=== 3. 바뀐 게 없으면 조용히 ===');
  reset(); S.stored = [{ handle: 'friend', userId: 'u-friend' }];
  {
    const r = await call(['@friend']);
    t('200 unchanged', r.code === 200 && r.body.unchanged === true, JSON.stringify(r.body));
    /* 같은 알림이 두 번 오면 신호가 죽는다 */
    t('알림을 보내지 않는다', telegram.length === 0 && images.length === 0);
    t('쓰지도 않는다', saved === null);
  }

  console.log('\n=== 4. 전체 해제 ===');
  reset(); S.stored = [{ handle: 'friend', userId: 'u-friend' }];
  {
    const r = await call([]);
    t('빈 배열 → 저장되고 비워진다', r.code === 200 && /"collaborators":\[\]/.test(String(saved)), saved);
    t('해제도 알린다 (조용히 사라지지 않는다)', telegram.length === 1 && /해제/.test(telegram[0]), telegram.join(' | '));
    t('이미지 워커는 깨우지 않는다 (보낼 게 없다)', images.length === 0);
  }

  console.log('\n=== 5. 메서드·입력 ===');
  reset();
  {
    const r = await call(['@friend'], { method: 'GET' });
    t('GET → 405', r.code === 405);
    const r2 = await call(['@friend'], { query: { id: 'nope' } });
    t('엉뚱한 id → 400', r2.code === 400 && r2.body.code === 'bad_id');
    const r3 = await call('friend');
    t('배열이 아니면 → 400', r3.code === 400 && r3.body.code === 'bad_body');
  }

  console.log('\n=== 6. 화면 배선 ===');
  {
    const fs = require('fs');
    const R = (f) => fs.readFileSync(P(f), 'utf8');
    const mp = R('frontend/mypage.html');
    /* 발행된 건(uploaded)에는 버튼이 붙지 않아야 한다 — 서버가 막는 것을 화면도 말한다 */
    t('최종 승인 건에만 버튼을 붙인다', /ds === 'final_approved' && s\.canPickCollab/.test(mp));
    t('자격은 서버가 내려준 값으로만 판단한다 (프런트가 등급을 추측하지 않는다)',
      /canPickCollab/.test(mp) && /canPickCollab: _canPickCollab/.test(R('api/submissions/mine.js')));
    t('편집기가 서버 코드별로 9개 언어 답을 돌려준다',
      /COLLAB_NOT_MEMBER/.test(mp) && /editorial_published/.test(mp) && /COLLAB_YEARLY_PREMIUM_ONLY/.test(mp));
    t('인라인 onclick 에는 걸러낸 id 만 들어간다 (회원이 쓴 글자 금지)',
      /mpEditCollab\('" \+ id \+ "'\)/.test(mp));
    const dict = JSON.parse(R('frontend/i18n/ui/mypage.ja.json'));
    t('문구가 8개 언어 사전에 들어 있다', !!dict['공동작업자'] && !!dict['공동작업자를 저장했습니다.']);
  }

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ collab-edit-after-approval tests FAILED'); process.exit(1); }
  console.log('✅ collab-edit-after-approval tests passed');
})();
