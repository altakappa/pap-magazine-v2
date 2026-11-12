/**
 * 아티클 접수 핸들러 실행 테스트 (2026-11-12)
 * ─────────────────────────────────────────────────────────────────────
 * article-submission.test.js 는 **정적**으로 본다(소스에 그 코드가 있나).
 * 이 파일은 핸들러를 **실제로 호출한다**. 둘 다 필요한 이유:
 *
   정적 grep 은 "그 코드가 있다" 까지만 말한다. 검증 순서가 뒤바뀌었거나
 * 조건이 반대로 쓰인 것(!== 를 === 로 쓴 것 같은)은 돌려 봐야 나온다.
 * 그래서 requireAuth 와
 * supabaseAdmin 을 require 캐시에 스텁으로 밀어넣고 핸들러를 호출한다
 * (저장소에 이미 쓰는 방식 — tests/telegram-editorial-dispatch.test.js 참조).
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = (f) => path.join(ROOT, f);

const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'writer@example.com' };
const PREFIX = 'https://example.supabase.co/storage/v1/object/public/submissions/' + USER.id + '/';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'x';
process.env.SUPABASE_SERVICE_KEY = 'x';
process.env.JWT_SECRET = 'x';
process.env.ARTICLE_PROMO_AI = 'off';   // 외부 콜 금지

let inserted = null;

/* ── 스텁 ─────────────────────────────────────────────────────────── */
require.cache[require.resolve(P('api/_lib/auth.js'))] = {
  id: require.resolve(P('api/_lib/auth.js')), loaded: true,
  exports: { requireAuth: () => USER, requireAdmin: async () => ({ id: 'admin' }) },
};
require.cache[require.resolve(P('api/_lib/cors.js'))] = {
  id: require.resolve(P('api/_lib/cors.js')), loaded: true,
  exports: { handleCors: () => false },
};
require.cache[require.resolve(P('api/_lib/rateLimit.js'))] = {
  id: require.resolve(P('api/_lib/rateLimit.js')), loaded: true,
  exports: { rateLimit: () => false, RATE_LIMITS: { api: {}, upload: {} } },
};
require.cache[require.resolve(P('api/_lib/telegram.js'))] = {
  id: require.resolve(P('api/_lib/telegram.js')), loaded: true,
  exports: { sendTextToTelegramSafe: async () => true },
};
require.cache[require.resolve(P('api/_lib/email.js'))] = {
  id: require.resolve(P('api/_lib/email.js')), loaded: true,
  exports: { sendEmail: async () => true, templates: { articleSubmissionReceived: () => ({ subject: '', html: '' }) } },
};
function table(name) {
  return {
    insert(row) {
      inserted = { table: name, row };
      return { select: () => ({ single: async () => ({ data: Object.assign({ id: 'new-id', created_at: 'now' }, row), error: null }) }) };
    },
    select() { return this; },
    eq() { return this; },
    single: async () => ({ data: { email: 'writer@example.com', display_name: 'W', language: 'en', country: 'IT' }, error: null }),
    update() { return { eq: async () => ({ error: null }) }; },
  };
}
require.cache[require.resolve(P('api/_lib/supabase.js'))] = {
  id: require.resolve(P('api/_lib/supabase.js')), loaded: true,
  exports: { supabaseAdmin: { from: table } },
};

const handler = require(P('api/article-submissions/index.js'));

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function base(over) {
  return Object.assign({
    title: 'Why quiet luxury ended',
    subtitle: 'A shift in what status looks like',
    topic: 'fashion',
    bodyLang: 'en',
    body: Array(820).fill('word').join(' '),
    authorBio: 'Writes about fashion from Milan.',
    authorName: 'A. Writer',
    coverUrl: PREFIX + 'cover.jpg',
    imageUrls: [PREFIX + 'a.jpg', PREFIX + 'b.jpg'],
    promoSelfDeclared: false,
    socialConsent: true,
    termsAgreed: true,
  }, over || {});
}
async function run(data) {
  inserted = null;
  const res = mkRes();
  await handler({ method: 'POST', headers: {}, body: { data }, query: {} }, res);
  return res;
}

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

(async () => {
  console.log('=== 접수 핸들러 실행 ===');
  {
    const r = await run(base());
    t('정상 payload 는 201', r.code === 201, r.code + ' ' + JSON.stringify(r.body).slice(0, 200));
    t('article_submissions 로 INSERT 된다', inserted && inserted.table === 'article_submissions');
    const row = (inserted && inserted.row) || {};
    t('카테고리가 매핑된다 (fashion → Fashion)', row.category === 'Fashion', String(row.category));
    t('분량이 기록된다', row.word_count === 820, String(row.word_count));
    t('접수는 pending · free · none', row.status === 'pending' && row.fee_type === 'free' && row.payment_status === 'none');
    t('소셜 동의가 기록된다', row.social_consent === true);
    t('자진신고가 기록된다', row.promo_self_declared === false);
    t('이미지는 커버 1 + 본문 2', row.cover_url === PREFIX + 'cover.jpg' && row.image_urls.length === 2);
    t('응답에 본문을 되돌려 주지 않는다 (불필요한 왕복 금지)',
      r.body && r.body.submission && !('body' in r.body.submission), JSON.stringify(r.body));
  }
  const cases = [
    ['제목 없음', { title: '   ' }, 'TITLE_REQUIRED'],
    ['분류가 화이트리스트 밖', { topic: 'politics' }, 'TOPIC_INVALID'],
    ['작성 언어가 ko/en 이 아님', { bodyLang: 'ja' }, 'BODY_LANG_INVALID'],
    ['본문 없음', { body: '  ' }, 'BODY_REQUIRED'],
    ['본문에 태그', { body: Array(820).fill('word').join(' ') + ' <script>x</script>' }, 'BODY_HTML_REJECTED'],
    ['영문 799단어', { body: Array(799).fill('word').join(' ') }, 'BODY_TOO_SHORT'],
    ['국문 1,599자', { bodyLang: 'ko', body: '가'.repeat(1599) }, 'BODY_TOO_SHORT'],
    ['필자 소개 없음', { authorBio: '' }, 'AUTHOR_BIO_REQUIRED'],
    ['커버 없음', { coverUrl: '' }, 'COVER_REQUIRED'],
    ['남의 폴더 커버', { coverUrl: 'https://example.supabase.co/storage/v1/object/public/submissions/other/x.jpg' }, 'URL_NOT_OWNED'],
    ['본문 이미지 10장', { imageUrls: Array(10).fill(PREFIX + 'a.jpg') }, 'TOO_MANY_IMAGES'],
    ['남의 폴더 본문 이미지', { imageUrls: ['https://evil.example/x.jpg'] }, 'URL_NOT_OWNED'],
    ['인스타 아이디 이상', { authorInstagram: 'bad handle!' }, 'INSTAGRAM_INVALID'],
    ['웹사이트가 http(s) 아님', { authorWebsite: 'javascript:alert(1)' }, 'WEBSITE_INVALID'],
    ['소셜 동의 없음', { socialConsent: false }, 'SOCIAL_CONSENT_REQUIRED'],
    ['약관 동의 없음', { termsAgreed: false }, 'TERMS_REQUIRED'],
    ['자진신고를 고르지 않음', { promoSelfDeclared: undefined }, 'PROMO_DECLARATION_REQUIRED'],
  ];
  for (const [name, over, code] of cases) {
    const r = await run(base(over));
    t(name + ' → 400 ' + code,
      r.code === 400 && r.body && r.body.code === code,
      r.code + ' ' + (r.body && r.body.code));
    if (r.code === 400) t('  ' + name + ': 저장되지 않았다', inserted === null);
  }
  {
    const r = await run(base({ bodyLang: 'ko', body: '가'.repeat(1600) }));
    t('국문 1,600자는 통과', r.code === 201, String(r.code));
    t('국문 분량은 글자 수로 센다', inserted && inserted.row.word_count === 1600, String(inserted && inserted.row.word_count));
  }
  {
    const r = await run(base({ promoSelfDeclared: true }));
    t('자진신고 예도 접수된다 (거절이 아니다 — 심사에서 판정)', r.code === 201, String(r.code));
    t('자진신고 예가 기록된다', inserted && inserted.row.promo_self_declared === true);
    t('자진신고 예여도 제출 단계에서는 청구가 없다',
      inserted && inserted.row.fee_type === 'free' && inserted.row.payment_status === 'none');
  }
  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ article-submission-handler FAILED'); process.exit(1); }
  console.log('✅ article-submission-handler passed');
})();
