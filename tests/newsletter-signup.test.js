'use strict';
/**
 * 비회원 뉴스레터 가입창 (2026-09-25, 도메니코 "회원가입 없이 이메일만으로 받는 가입창 만들기").
 * 실측: 회원 1,357 중 수신동의 172(13%). 이중 확인 → confirmed 만 발송.
 *
 *  1. 가입 API: 검증 · honeypot · 동의 문구 서버 사본 저장 · 확인 메일 · 같은 답(열거 방지) · 10분 재전송 제한 · 재가입 새 토큰
 *  2. 확인 API: pending→confirmed · 환영 메일 · 회원이면 회원 수신동의 켜기 · 두 번 눌러도 같은 답
 *  3. 수신거부 API
 *  4. 발송기: 주간 뉴스 전체 발송에만 · 회원 주소 제외 · 자기 토큰 · 비회원용 꼬리말
 *  5. 가입 화면: 9개 언어 · 동의 문구가 서버와 글자까지 같다 · 체크 기본값 없음 · /newsletter 주소
 * (가짜 DB · 가짜 메일로 실제 실행)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

// ── 메모리 DB ──
let uid = 0;
function makeDb(tables) {
  const db = { tables, log: [] };
  db.from = (name) => {
    const st = { name, op: 'select', filters: [], payload: null };
    const rows = () => (db.tables[name] = db.tables[name] || []);
    const match = (r) => st.filters.every(([op, k, v]) => (op === 'eq' ? r[k] === v : op === 'ilike' ? String(r[k] || '').toLowerCase() === String(v).toLowerCase() : true));
    const run = () => {
      db.log.push({ name, op: st.op, payload: st.payload, filters: st.filters.slice() });
      if (st.op === 'insert') {
        const row = Object.assign({ id: 'id' + (++uid), token: 'tok-' + uid }, st.payload);
        rows().push(row); return { data: [row], error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match); hit.forEach((r) => Object.assign(r, st.payload)); return { data: hit, error: null };
      }
      const all = rows().filter(match);
      return { data: st.range ? all.slice(st.range[0], st.range[1] + 1) : all, error: null };
    };
    const b = {
      select() { return b; },
      eq(k, v) { st.filters.push(['eq', k, v]); return b; },
      ilike(k, v) { st.filters.push(['ilike', k, v]); return b; },
      not() { return b; }, lte() { return b; }, order() { return b; }, limit() { return b; },
      range(a, z) { st.range = [a, z]; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data || [])[0] || null, error: null }); },
      single() { const r = run(); return Promise.resolve({ data: (r.data || [])[0] || null, error: null }); },
      then(ok, bad) { return Promise.resolve(run()).then(ok, bad); },
    };
    return b;
  };
  return db;
}
const stub = (rel, exp) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
const fresh = (rel) => { const p = require.resolve(path.join(ROOT, rel)); delete require.cache[p]; return require(p); };
function mkRes() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.send = (s) => { r.body = s; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

(async () => {
  const realEmail = fresh('api/_lib/email.js');
  const { NEWSLETTER_COPY } = require(path.join(ROOT, 'api/_lib/newsletterCopy.js'));
  const mails = [];
  let mailOk = true;
  function wire(db) {
    stub('api/_lib/supabase.js', { supabaseAdmin: db });
    stub('api/_lib/cors.js', { handleCors: () => false });
    stub('api/_lib/rateLimit.js', { rateLimitStrict: async () => false, RATE_LIMITS: { auth: {} } });
    stub('api/_lib/email.js', { sendEmail: async (to, tpl) => { mails.push({ to, tpl }); return mailOk ? { sent: true } : { sent: false, error: '421' }; }, templates: realEmail.templates });
  }
  const call = async (rel, req) => { const h = fresh(rel); const res = mkRes(); await h(Object.assign({ headers: {}, query: {} }, req), res); return res; };

  console.log('=== 1. 가입 API ===');
  {
    const db = makeDb({ newsletter_signups: [], profiles: [] }); wire(db); mails.length = 0;
    let r = await call('api/newsletter/subscribe.js', { method: 'POST', body: { email: 'nope', consent: true } });
    t('잘못된 이메일 → 400 invalid_email', r.code === 400 && r.body.code === 'invalid_email');
    r = await call('api/newsletter/subscribe.js', { method: 'POST', body: { email: 'a@b.com' } });
    t('동의 없으면 → 400 consent_required', r.code === 400 && r.body.code === 'consent_required');
    r = await call('api/newsletter/subscribe.js', { method: 'POST', body: { email: 'a@b.com', consent: true, website: 'x' } });
    t('honeypot → 200, 저장·메일 없음', r.code === 200 && db.tables.newsletter_signups.length === 0 && mails.length === 0);
    r = await call('api/newsletter/subscribe.js', { method: 'POST', body: { email: ' New@Mail.com ', consent: true, lang: 'ko', source: 'ig' } });
    const row = db.tables.newsletter_signups[0];
    t('신규 → 200 sent, pending 저장(소문자)', r.code === 200 && r.body.code === 'sent' && row && row.email === 'new@mail.com' && row.status === 'pending' && row.source === 'ig');
    t('동의 문구 = 서버 사본(ko)', row.consent_text === NEWSLETTER_COPY.ko.consent);
    t('확인 메일 1통, 확인 링크에 토큰', mails.length === 1 && mails[0].to === 'new@mail.com' && mails[0].tpl.html.includes('/api/newsletter/confirm?token=' + row.token) && mails[0].tpl.subject === NEWSLETTER_COPY.ko.confirmSubject);
    t('확인 메일 보낸 시각 기록', !!row.confirm_sent_at);
    r = await call('api/newsletter/subscribe.js', { method: 'POST', body: { email: 'new@mail.com', consent: true, lang: 'ko' } });
    t('10분 안에 다시 → 같은 답, 메일 안 보냄', r.body.code === 'sent' && mails.length === 1);
    row.status = 'confirmed';
    r = await call('api/newsletter/subscribe.js', { method: 'POST', body: { email: 'new@mail.com', consent: true } });
    t('이미 구독 중 → 같은 답(가입 여부 노출 안 함), 메일 없음', r.code === 200 && r.body.code === 'sent' && mails.length === 1);
    row.status = 'unsubscribed'; const oldTok = row.token;
    r = await call('api/newsletter/subscribe.js', { method: 'POST', body: { email: 'new@mail.com', consent: true, lang: 'en' } });
    t('수신거부 후 재가입 → pending + 새 토큰 + 확인 메일', row.status === 'pending' && row.token !== oldTok && mails.length === 2);
    mailOk = false;
    r = await call('api/newsletter/subscribe.js', { method: 'POST', body: { email: 'fail@mail.com', consent: true } });
    t('확인 메일 실패 → 502 mail_failed (원문 에러 없음)', r.code === 502 && r.body.code === 'mail_failed' && !/421/.test(JSON.stringify(r.body)));
    mailOk = true;
  }

  console.log('\n=== 2. 확인 API ===');
  {
    const db = makeDb({
      newsletter_signups: [
        { id: 's1', email: 'guest@mail.com', language: 'ja', status: 'pending', token: '11111111-1111-1111-1111-111111111111' },
        { id: 's2', email: 'member@mail.com', language: 'en', status: 'pending', token: '22222222-2222-2222-2222-222222222222' },
      ],
      profiles: [{ id: 'p1', email: 'Member@mail.com', email_consent: false }],
      consent_history: [],
    });
    wire(db); mails.length = 0;
    let r = await call('api/newsletter/confirm.js', { method: 'GET', query: { token: 'bad' } });
    t('형식 틀린 토큰 → 400 안내 페이지', r.code === 400 && /<html/.test(r.body));
    r = await call('api/newsletter/confirm.js', { method: 'GET', query: { token: '11111111-1111-1111-1111-111111111111' } });
    const g = db.tables.newsletter_signups[0];
    t('비회원: confirmed + 확인 시각', g.status === 'confirmed' && !!g.confirmed_at && r.code === 200);
    t('확인 페이지는 가입 언어(ja)', r.body.includes('lang="ja"') && r.body.includes(NEWSLETTER_COPY.ja.confirmedTitle));
    t('환영 메일 1통, 수신거부 링크는 자기 토큰', mails.length === 1 && mails[0].tpl.html.includes('/api/newsletter/unsubscribe?token=11111111-1111-1111-1111-111111111111'));
    r = await call('api/newsletter/confirm.js', { method: 'GET', query: { token: '11111111-1111-1111-1111-111111111111' } });
    t('두 번 눌러도 같은 페이지, 메일 추가 없음', r.code === 200 && mails.length === 1);
    await call('api/newsletter/confirm.js', { method: 'GET', query: { token: '22222222-2222-2222-2222-222222222222' } });
    const p = db.tables.profiles[0];
    t('회원 주소: 회원 수신동의 켬 + 동의 이력', p.email_consent === true && db.tables.consent_history.length === 1 && db.tables.consent_history[0].source === 'newsletter_confirm');
    t('회원 환영 메일의 수신거부는 마이페이지', mails[1] && mails[1].tpl.html.includes('/mypage#mp-preferences'));
  }

  console.log('\n=== 3. 수신거부 API ===');
  {
    const db = makeDb({ newsletter_signups: [{ id: 's1', email: 'g@m.com', language: 'fr', status: 'confirmed', token: '33333333-3333-3333-3333-333333333333' }] });
    wire(db);
    const r = await call('api/newsletter/unsubscribe.js', { method: 'GET', query: { token: '33333333-3333-3333-3333-333333333333' } });
    t('confirmed → unsubscribed, 프랑스어 페이지', db.tables.newsletter_signups[0].status === 'unsubscribed' && r.body.includes(NEWSLETTER_COPY.fr.unsubTitle));
  }

  console.log('\n=== 4. 발송기 ===');
  {
    const campaign = { id: 'c1', type: 'news-weekly', status: 'scheduled', payload: {}, name: 'news-weekly-x' };
    const db = makeDb({
      email_campaigns: [campaign],
      profiles: [{ id: 'u1', email: 'member@x.com', email_consent: true, email_language: 'en', subscription_plan: 'free', subscription_status: 'inactive' },
                 { id: 'u2', email: 'optout@x.com', email_consent: false }],
      newsletter_signups: [
        { email: 'guest@x.com', language: 'ko', token: 'gtok', status: 'confirmed' },
        { email: 'optout@x.com', language: 'en', token: 'otok', status: 'confirmed' },   // 회원(수신거부) → 제외
        { email: 'pend@x.com', language: 'en', token: 'ptok', status: 'pending' },      // 미확인 → 제외
      ],
      email_unsubscribe_tokens: [], email_log: [],
    });
    // 회원 조회(.eq email_consent true)가 동작하도록 profiles 필터는 메모리 DB 가 처리한다
    const sent = [];
    stub('api/_lib/supabase.js', { supabaseAdmin: db });
    stub('api/_lib/cors.js', { handleCors: () => false });
    stub('api/_lib/cronGuard.js', { withCronGuard: (_n, fn) => fn });
    stub('api/_lib/email.js', { sendEmail: async (to, tpl) => { sent.push({ to, tpl }); return { sent: true }; }, templates: realEmail.templates });
    process.env.CRON_SECRET = 'sek';
    const realST = global.setTimeout; global.setTimeout = (fn) => { fn(); return 0; };
    try { await call('api/cron/send-due-campaigns.js', { method: 'GET', headers: { authorization: 'Bearer sek' } }); }
    finally { global.setTimeout = realST; }
    const tos = sent.map((s) => s.to).sort();
    t('받는 사람: 수신동의 회원 + 확인된 비회원만', JSON.stringify(tos) === JSON.stringify(['guest@x.com', 'member@x.com']), JSON.stringify(tos));
    const g = sent.find((s) => s.to === 'guest@x.com');
    t('비회원: 자기 토큰 수신거부 링크 · 언어 바 없음 · 비회원 꼬리말', g && g.tpl.html.includes('/api/newsletter/unsubscribe?token=gtok') && !g.tpl.html.includes('/api/email/language') && g.tpl.html.includes(NEWSLETTER_COPY.ko.footerNotice));
    const m = sent.find((s) => s.to === 'member@x.com');
    t('회원: 기존 수신거부·언어 바 그대로', m && m.tpl.html.includes('/api/auth/unsubscribe?token=') && m.tpl.html.includes('/api/email/language'));
    t('비회원은 회원 토큰 표에 줄을 만들지 않는다', db.tables.email_unsubscribe_tokens.length === 1);
    const src0 = R('api/cron/send-due-campaigns.js');
    t('회원 주소는 1,000행씩 나눠 읽는다(상한에 잘리지 않게)', /\.range\(from, from \+ 999\)/.test(src0));
    t('확인 API: ilike 와일드카드 이스케이프', /replace\(\/\[\\\\%_\]\/g/.test(R('api/newsletter/confirm.js')));
    const src = R('api/cron/send-due-campaigns.js');
    t('주간 뉴스 전체 발송에만 붙는다', /if \(!audience && campaign\.type === 'news-weekly'\)/.test(src));
  }

  console.log('\n=== 5. 가입 화면 ===');
  {
    const html = R('frontend/newsletter.html');
    const ctx = {}; vm.runInNewContext(html.match(/var L = (\{[\s\S]*?\});\n/)[0].replace('var L', 'this.L'), ctx);
    const L = ctx.L;
    const langs = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];
    const keys = Object.keys(L.ko);
    t('9개 언어 · 키 전부', langs.every((l) => L[l] && keys.every((k) => L[l][k])), langs.filter((l) => !L[l] || keys.some((k) => !L[l][k])).join(','));
    t('동의 문구가 서버 사본과 글자까지 같다 (9개 언어)', langs.every((l) => L[l].consent === NEWSLETTER_COPY[l].consent));
    t('동의 문구에 "광고성 정보 포함"(ko)', /광고성 정보 포함/.test(L.ko.consent));
    t('동의 체크박스 기본값 없음', /<input type="checkbox" id="nlConsent">/.test(html) && !/nlConsent"[^>]*checked/.test(html));
    const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<option[^>]*>[^<]*<\/option>/g, '');
    t('마크업에 한글 문장 없음 (전부 data-i18n)', !/>[^<]*[가-힯][^<]*</.test(body));
    t('honeypot 칸', /name="website" class="hp"/.test(html));
    t('utm_source 를 source 로 보낸다 (IG 프로필 링크 측정)', /get\('utm_source'\)/.test(html) && /source:src/.test(html));
    const vj = JSON.parse(R('vercel.json'));
    t('/newsletter 주소', vj.rewrites.some((x) => x.source === '/newsletter' && x.destination === '/newsletter.html'));
    t('마이그레이션 168 파일', /create table if not exists public\.newsletter_signups/.test(R('supabase_migrations/168_newsletter_signups.sql')));
  }

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ newsletter-signup FAILED'); process.exit(1); }
  console.log('✅ newsletter-signup passed');
})().catch((e) => { console.error(e); process.exit(1); });
