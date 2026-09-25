'use strict';
/**
 * SES 반송·스팸 신고 처리 (2026-09-25, 도메니코 "2번을 만들어줘").
 * SES 정식 발송 신청서에 "반송·신고 주소는 자동으로 발송 중단" 이라고 적었다. 그 약속의 실제 구현.
 *
 *  1. 금지 목록 모듈: 주소 정리 · 막는 규칙 · 기록/우선순위 · 조회 실패 시 막지 않음 · 1,000행 넘게 읽기
 *  2. sendEmail: 금지 주소는 안 보냄 · 신고 주소도 인증/결제(transactional)는 보냄
 *  3. SNS 서명 확인: 진짜만 통과 (v1·v2) · 바꾼 글 · 남의 계정 · 가짜 인증서 주소 · 오래된 알림 거절
 *  4. 받는 주소(핸들러): 구독 승인 · 가짜 승인 주소 거절 · POST 만
 *  5. 알림 처리: 영구 반송 · 일시 반송 · 신고 → 수신거부 · not-spam 무시 · 배달 알림 무시
 *  6. 발송기·호출부·DB 설계 (소스 확인)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

// ── 메모리 DB ──
function makeDb(tables, opts) {
  const o = opts || {};
  const db = { tables, log: [] };
  db.from = (name) => {
    const st = { name, op: 'select', filters: [], payload: null, range: null, limit: null };
    const rows = () => (db.tables[name] = db.tables[name] || []);
    const unesc = (v) => String(v).replace(/\\(.)/g, '$1').toLowerCase();
    const match = (r) => st.filters.every(([op, k, v]) => (
      op === 'eq' ? r[k] === v
        : op === 'neq' ? r[k] !== v
          : op === 'ilike' ? String(r[k] || '').toLowerCase() === unesc(v)
            : op === 'gte' ? String(r[k] || '') >= String(v) : true));
    const run = () => {
      db.log.push({ name, op: st.op, payload: st.payload, filters: st.filters.slice() });
      if (o.failOn === name) return { data: null, error: { message: 'boom' } };
      if (st.op === 'insert') { rows().push(Object.assign({}, st.payload)); return { data: [st.payload], error: null }; }
      if (st.op === 'update') { const hit = rows().filter(match); hit.forEach((r) => Object.assign(r, st.payload)); return { data: hit, error: null }; }
      let all = rows().filter(match);
      if (st.range) all = all.slice(st.range[0], st.range[1] + 1);
      if (st.limit != null) all = all.slice(0, st.limit);
      return { data: all, error: null };
    };
    const b = {
      select() { return b; },
      eq(k, v) { st.filters.push(['eq', k, v]); return b; },
      neq(k, v) { st.filters.push(['neq', k, v]); return b; },
      ilike(k, v) { st.filters.push(['ilike', k, v]); return b; },
      gte(k, v) { st.filters.push(['gte', k, v]); return b; },
      order() { return b; },
      limit(n) { st.limit = n; return b; },
      range(a, z) { st.range = [a, z]; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.error ? null : (r.data || [])[0] || null, error: r.error }); },
      then(ok, bad) { return Promise.resolve(run()).then(ok, bad); },
    };
    return b;
  };
  return db;
}
const stub = (rel, exp) => { const p = require.resolve(rel.startsWith('.') || rel.startsWith('/') || rel.startsWith('api') ? path.join(ROOT, rel) : rel); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
const fresh = (rel) => { const p = require.resolve(path.join(ROOT, rel)); delete require.cache[p]; return require(p); };
function mkRes() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

(async () => {
  console.log('=== 1. 금지 목록 모듈 ===');
  const sup = fresh('api/_lib/emailSuppression.js');
  t('주소 정리: 공백·대문자·"이름 <주소>"', sup.normEmail(' Kim <A.B@Mail.COM> ') === 'a.b@mail.com' && sup.normEmail('x') === '' && sup.normEmail(null) === '');
  t('bounce 는 transactional 이어도 막는다', sup.blockReason({ reason: 'bounce' }, true) === 'bounce');
  t('complaint 는 소식 메일만 막고 인증·결제는 보낸다', sup.blockReason({ reason: 'complaint' }, false) === 'complaint' && sup.blockReason({ reason: 'complaint' }, true) === null);
  t('soft_bounce 2회는 보내고 3회부터 막는다', sup.blockReason({ reason: 'soft_bounce', count: 2 }, false) === null && sup.blockReason({ reason: 'soft_bounce', count: 3 }, false) === 'soft_bounce' && sup.SOFT_LIMIT === 3);
  t('목록에 없으면 막지 않는다', sup.blockReason(undefined, false) === null);
  {
    const db = makeDb({ email_suppressions: [] });
    await sup.recordSuppression({ email: 'X@Y.com', reason: 'soft_bounce', bounceType: 'Transient' }, { db });
    let row = db.tables.email_suppressions[0];
    t('첫 기록: 소문자·횟수 1·출처 ses', row && row.email === 'x@y.com' && row.reason === 'soft_bounce' && row.event_count === 1 && row.source === 'ses');
    await sup.recordSuppression({ email: 'x@y.com', reason: 'complaint' }, { db });
    t('더 센 이유가 오면 올린다 (soft → complaint), 횟수 +1', row.reason === 'complaint' && row.event_count === 2);
    await sup.recordSuppression({ email: 'x@y.com', reason: 'bounce', bounceType: 'Permanent' }, { db });
    t('complaint → bounce 로 올린다', row.reason === 'bounce' && row.bounce_type === 'Permanent');
    await sup.recordSuppression({ email: 'x@y.com', reason: 'soft_bounce' }, { db });
    t('약한 이유가 와도 bounce 는 그대로 (횟수만 +1)', row.reason === 'bounce' && row.event_count === 4 && db.tables.email_suppressions.length === 1);
    const bad = await sup.recordSuppression({ email: 'nope', reason: 'bounce' }, { db });
    const bad2 = await sup.recordSuppression({ email: 'a@b.com', reason: 'whatever' }, { db });
    t('잘못된 주소·이유는 저장 안 함', bad.skipped && bad2.skipped && db.tables.email_suppressions.length === 1);
    const long = await sup.recordSuppression({ email: 'd@e.com', reason: 'bounce', diagnostic: 'z'.repeat(2000) }, { db });
    t('진단 문구는 500자로 자른다', long.ok && db.tables.email_suppressions[1].diagnostic.length === 500);
  }
  {
    const big = [];
    for (let i = 0; i < 1203; i++) big.push({ email: 'u' + i + '@m.com', reason: 'bounce', event_count: 1 });
    const db = makeDb({ email_suppressions: big });
    sup._resetCache();
    const map = await sup.getSuppressionMap({ db, force: true });
    t('1,000행 넘어도 전부 읽는다 (1,203)', map.size === 1203 && map.has('u1202@m.com'));
    const db2 = makeDb({ email_suppressions: [] }, { failOn: 'email_suppressions' });
    sup._resetCache();
    const origErr = console.error; console.error = () => {};
    const m2 = await sup.getSuppressionMap({ db: db2, force: true });
    const why = await sup.suppressionFor('u1@m.com', { db: db2, force: true });
    console.error = origErr;
    t('조회 실패 → 빈 목록, 발송 막지 않음 (fail open)', m2.size === 0 && why === null);
    sup._resetCache();
    const db3 = makeDb({ email_suppressions: [{ email: 'c@d.com', reason: 'complaint', event_count: 1 }] });
    t('suppressionFor: 신고 주소 · 소식=막음 / transactional=보냄',
      (await sup.suppressionFor('C@D.com', { db: db3, force: true })) === 'complaint'
      && (await sup.suppressionFor('c@d.com', { db: db3, force: true, transactional: true })) === null);
    sup._resetCache();
  }

  console.log('\n=== 2. sendEmail ===');
  {
    const sent = [];
    stub('nodemailer', { createTransport: () => ({ sendMail: async (m) => { sent.push(m); return { messageId: 'm1' }; } }) });
    let verdict = null; const seenOpts = [];
    stub('api/_lib/emailSuppression.js', { suppressionFor: async (to, o) => { seenOpts.push(o); return verdict; } });
    const oldU = process.env.SMTP_USER, oldP = process.env.SMTP_PASS;
    process.env.SMTP_USER = 'u'; process.env.SMTP_PASS = 'p';
    const origLog = console.log, origWarn = console.warn; console.log = () => {}; console.warn = () => {};
    const email = fresh('api/_lib/email.js');
    let r = await email.sendEmail('a@b.com', { subject: 's', html: 'h' });
    const okNormal = r.sent === true && sent.length === 1;
    verdict = 'bounce';
    r = await email.sendEmail('a@b.com', { subject: 's', html: 'h' });
    const okBlocked = r.skipped === true && r.suppressed === 'bounce' && /suppressed: bounce/.test(r.error) && sent.length === 1;
    verdict = null;
    await email.sendEmail('a@b.com', { subject: 's', html: 'h' }, { transactional: true });
    console.log = origLog; console.warn = origWarn;
    t('금지 아님 → 정상 발송', okNormal);
    t('금지 주소 → 안 보내고 {skipped, suppressed} (재시도 대상 아님)', okBlocked && !/\b421\b|4\.[0-9]\.[0-9]|try again|temporar/i.test(r.error || ''));
    t('transactional 옵션이 금지 확인까지 전달된다', seenOpts[seenOpts.length - 1].transactional === true && seenOpts[0].transactional === false);
    stub('api/_lib/emailSuppression.js', { suppressionFor: async () => { throw new Error('db down'); } });
    const origE = console.error; console.error = () => {}; console.log = () => {};
    const email2 = fresh('api/_lib/email.js');
    r = await email2.sendEmail('a@b.com', { subject: 's', html: 'h' });
    console.error = origE; console.log = origLog;
    t('금지 확인이 터져도 메일은 나간다', r.sent === true);
    process.env.SMTP_USER = oldU || ''; process.env.SMTP_PASS = oldP || '';
    if (oldU === undefined) delete process.env.SMTP_USER; if (oldP === undefined) delete process.env.SMTP_PASS;
    delete require.cache[require.resolve('nodemailer')];
    delete require.cache[require.resolve(path.join(ROOT, 'api/_lib/emailSuppression.js'))];
    delete require.cache[require.resolve(path.join(ROOT, 'api/_lib/email.js'))];
  }

  console.log('\n=== 3. SNS 서명 확인 ===');
  const H = fresh('api/ses/notifications.js');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const PUB = publicKey.export({ type: 'spki', format: 'pem' });
  const CERT = 'https://sns.ap-northeast-2.amazonaws.com/SimpleNotificationService-abc.pem';
  const TOPIC = 'arn:aws:sns:ap-northeast-2:396881795178:pap-ses-feedback';
  const NOW = Date.parse('2026-09-25T13:00:00Z');
  function sign(m, ver) {
    const v = ver || '2';
    const out = Object.assign({ SignatureVersion: v, SigningCertURL: CERT }, m);
    const s = crypto.createSign(v === '2' ? 'RSA-SHA256' : 'RSA-SHA1'); s.update(H.stringToSign(out), 'utf8');
    out.Signature = s.sign(privateKey, 'base64');
    return out;
  }
  const certCalls = [];
  const opts = { fetchCert: async (u) => { certCalls.push(u); return PUB; }, now: () => NOW };
  const note = (message, extra) => sign(Object.assign({ Type: 'Notification', MessageId: 'mid', TopicArn: TOPIC, Message: JSON.stringify(message), Timestamp: '2026-09-25T12:59:00.000Z' }, extra || {}));
  t('진짜 알림 (v2 SHA256) 통과', (await H.verifySnsMessage(note({ a: 1 }), opts)).ok === true);
  t('진짜 알림 (v1 SHA1) 통과', (await H.verifySnsMessage(sign({ Type: 'Notification', MessageId: 'm', TopicArn: TOPIC, Message: 'x', Timestamp: '2026-09-25T12:59:00Z' }, '1'), opts)).ok === true);
  t('Subject 가 있어도 서명 문자열에 넣어 통과', (await H.verifySnsMessage(note({ a: 1 }, { Subject: 'Amazon SES Email Event Notification' }), opts)).ok === true);
  { const m = note({ bounce: 1 }); m.Message = JSON.stringify({ complaint: 1 });
    t('글을 바꾸면 거절 (signature)', (await H.verifySnsMessage(m, opts)).why === 'signature'); }
  t('남의 AWS 계정 주제 → 거절', (await H.verifySnsMessage(note({}, { TopicArn: 'arn:aws:sns:ap-northeast-2:111122223333:x' }), opts)).why === 'topic');
  { const n0 = certCalls.length;
    const bad = [ 'http://sns.ap-northeast-2.amazonaws.com/a.pem', 'https://sns.ap-northeast-2.amazonaws.com.evil.io/a.pem', 'https://evil.io/sns.amazonaws.com/a.pem', 'https://sns.ap-northeast-2.amazonaws.com/a.txt', 'https://sns.ap-northeast-2.amazonaws.com:8443/a.pem' ];
    let all = true;
    for (const u of bad) { const r = await H.verifySnsMessage(Object.assign(note({}), { SigningCertURL: u }), opts); if (r.why !== 'cert_url') all = false; }
    t('가짜 인증서 주소 5종 거절 + 내려받지도 않음', all && certCalls.length === n0); }
  t('24시간 넘은 알림 거절', (await H.verifySnsMessage(note({}, { Timestamp: '2026-09-24T12:00:00Z' }), opts)).why === 'stale');
  t('서명 버전 모름 → 거절', (await H.verifySnsMessage(Object.assign(note({}), { SignatureVersion: '3' }), opts)).why === 'sig_version');
  t('모르는 Type 거절', (await H.verifySnsMessage(Object.assign(note({}), { Type: 'Hello' }), opts)).why === 'type');

  console.log('\n=== 4. 받는 주소 (핸들러) ===');
  {
    const opened = [];
    H._opts = Object.assign({}, opts, { confirmFetch: async (u) => { opened.push(u); return { ok: true, status: 200 }; } });
    const origLog = console.log, origWarn = console.warn;
    const call = async (body, method) => {
      console.log = () => {}; console.warn = () => {};
      try { const res = mkRes(); await H({ method: method || 'POST', headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) }, res); return res; }
      finally { console.log = origLog; console.warn = origWarn; }
    };
    const SUBURL = 'https://sns.ap-northeast-2.amazonaws.com/?Action=ConfirmSubscription&TopicArn=' + TOPIC + '&Token=abc';
    let r = await call(sign({ Type: 'SubscriptionConfirmation', MessageId: 'm', Token: 'abc', TopicArn: TOPIC, Message: 'confirm', SubscribeURL: SUBURL, Timestamp: '2026-09-25T12:59:00Z' }));
    t('구독 확인 → SubscribeURL 한 번 열고 200', r.code === 200 && r.body.confirmed === true && opened.length === 1 && opened[0] === SUBURL);
    r = await call(sign({ Type: 'SubscriptionConfirmation', MessageId: 'm', Token: 'abc', TopicArn: TOPIC, Message: 'confirm', SubscribeURL: 'https://evil.io/steal', Timestamp: '2026-09-25T12:59:00Z' }));
    t('서명은 맞아도 승인 주소가 아마존이 아니면 403, 안 연다', r.code === 403 && opened.length === 1);
    const forged = note({ notificationType: 'Complaint' }); forged.Signature = 'AAAA';
    r = await call(forged);
    t('서명 가짜 → 403', r.code === 403);
    r = await call('not json');
    t('JSON 아님 → 400', r.code === 400);
    r = await call({}, 'GET');
    t('GET → 405', r.code === 405);
    H._opts = null;
    t('본문을 직접 읽는다 (bodyParser 끔 · SNS 는 text/plain 으로 보냄)', H.config && H.config.api && H.config.api.bodyParser === false);
  }

  console.log('\n=== 5. 알림 처리 ===');
  {
    const sup2 = fresh('api/_lib/emailSuppression.js');
    const now = new Date().toISOString();
    const db = makeDb({
      email_suppressions: [],
      email_log: [
        { email: 'Hard@X.com', status: 'sent', sent_at: now },
        { email: 'hard@x.com', status: 'sent', sent_at: '2020-01-01T00:00:00Z' },
        { email: 'other@x.com', status: 'sent', sent_at: now },
      ],
      profiles: [ { id: 'p1', email: 'Angry@X.com', email_consent: true }, { id: 'p2', email: 'calm@x.com', email_consent: true } ],
      consent_history: [],
      newsletter_signups: [ { email: 'nm@x.com', status: 'confirmed' } ],
    });
    const deps = { db, record: sup2.recordSuppression, normEmail: sup2.normEmail };
    let n = await H.handleSesEvent({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bounceSubType: 'NoEmail', feedbackId: 'f1', bouncedRecipients: [ { emailAddress: 'Hard@X.com', diagnosticCode: 'smtp; 550 5.1.1 user unknown' } ] } }, deps);
    const hr = db.tables.email_suppressions.find((x) => x.email === 'hard@x.com');
    t('영구 반송 → bounce 기록 (진단 문구 포함)', n === 1 && hr && hr.reason === 'bounce' && /550/.test(hr.diagnostic) && hr.bounce_sub_type === 'NoEmail');
    t('최근 3일 발송 기록만 bounced 로, 옛 기록·다른 주소는 그대로',
      db.tables.email_log[0].status === 'bounced' && db.tables.email_log[1].status === 'sent' && db.tables.email_log[2].status === 'sent');
    n = await H.handleSesEvent({ eventType: 'Bounce', bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull', bouncedRecipients: [ { emailAddress: 'full@x.com' } ] } }, deps);
    t('일시 반송 (eventType 형식도) → soft_bounce', n === 1 && db.tables.email_suppressions.find((x) => x.email === 'full@x.com').reason === 'soft_bounce');
    n = await H.handleSesEvent({ notificationType: 'Complaint', complaint: { complaintFeedbackType: 'abuse', feedbackId: 'f2', complainedRecipients: [ { emailAddress: 'angry@x.com' }, { emailAddress: 'nm@x.com' } ] } }, deps);
    t('신고 → complaint 기록 2건', n === 2 && db.tables.email_suppressions.filter((x) => x.reason === 'complaint').length === 2);
    t('신고한 회원 → 수신동의 끔 + 동의 기록(granted=false, ses_complaint)',
      db.tables.profiles[0].email_consent === false && db.tables.consent_history.length === 1
      && db.tables.consent_history[0].user_id === 'p1' && db.tables.consent_history[0].granted === false && db.tables.consent_history[0].source === 'ses_complaint');
    t('다른 회원은 그대로', db.tables.profiles[1].email_consent === true);
    t('신고한 비회원 구독자 → unsubscribed', db.tables.newsletter_signups[0].status === 'unsubscribed');
    await H.handleSesEvent({ notificationType: 'Complaint', complaint: { complainedRecipients: [ { emailAddress: 'angry@x.com' } ] } }, deps);
    t('같은 사람이 또 신고 → 동의 기록 중복 안 쌓임', db.tables.consent_history.length === 1);
    n = await H.handleSesEvent({ notificationType: 'Complaint', complaint: { complaintFeedbackType: 'not-spam', complainedRecipients: [ { emailAddress: 'calm@x.com' } ] } }, deps);
    t("신고 종류 'not-spam' → 무시", n === 0 && db.tables.profiles[1].email_consent === true);
    const before = db.tables.email_suppressions.length;
    n = await H.handleSesEvent({ notificationType: 'Delivery', delivery: { recipients: ['a@b.com'] } }, deps);
    t('배달 성공 알림 → 아무것도 안 함', n === 0 && db.tables.email_suppressions.length === before);
    n = await H.handleSesEvent({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [ { emailAddress: 'garbage' }, {} ] } }, deps);
    t('주소가 이상하면 건너뜀', n === 0);
    const failDb = makeDb({ email_suppressions: [] }, { failOn: 'email_suppressions' });
    let threw = false;
    try { await H.handleSesEvent({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [ { emailAddress: 'z@z.com' } ] } }, { db: failDb, record: sup2.recordSuppression, normEmail: sup2.normEmail }); } catch (_) { threw = true; }
    t('DB 저장 실패 → 에러를 올려 500 (SNS 가 다시 보냄)', threw && /status\(500\)/.test(R('api/ses/notifications.js')));
  }

  console.log('\n=== 6. 발송기 · 호출부 · DB ===');
  {
    const c = R('api/cron/send-due-campaigns.js');
    t('주간 발송기: 보내기 전에 금지 주소를 뺀다 (소식 메일 = transactional 아님)',
      /getSuppressionMap\(\)/.test(c) && /blockReason\(supMap\.get\([\s\S]{0,80}?\),\s*false\)/.test(c)
      && c.indexOf('getSuppressionMap()') < c.indexOf('for (const batch of chunk(recipientList'));
    t('발송 결과에 제외 수를 남긴다', /suppressed: suppressedCount/.test(c));
    t('인증번호 메일은 transactional', /buildVerificationEmail\(code, codeLang\), \{ transactional: true \}/.test(R('api/auth/send-code.js')));
    t('결제 확인 메일(Paddle·PortOne)은 transactional',
      /subscriptionConfirmed\([^;]*\{ transactional: true \}\)/.test(R('api/paddle-webhook.js'))
      && /resolveEmailLang\(profile\)\s*\), \{ transactional: true \}\)/.test(R('api/portone-webhook.js')));
    const mig = R('supabase_migrations/169_email_suppressions.sql');
    t('DB: 이유 3종 제한 · 소문자 강제 · RLS 켬', /reason in \('bounce', 'complaint', 'soft_bounce'\)/.test(mig) && /email = lower\(email\)/.test(mig) && /enable row level security/.test(mig));
    t('우리 AWS 계정만', H.ACCOUNT_ID === '396881795178');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
