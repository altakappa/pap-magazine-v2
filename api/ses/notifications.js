'use strict';
/**
 * POST /api/ses/notifications  (2026-09-25, Amazon SES 반송·스팸 신고 받기)
 *
 * 흐름: SES 가 반송/신고를 알게 됨 → SNS 주제(topic)로 알림 → SNS 가 이 주소로 POST.
 * 여기서 하는 일:
 *   1. 진짜 아마존이 보낸 건지 서명으로 확인한다 (가짜 알림으로 회원 수신을 끊지 못하게).
 *      - 인증서 주소는 https://sns.<지역>.amazonaws.com/...pem 만 믿는다.
 *      - 주제(TopicArn)는 우리 AWS 계정(396881795178) 것만 받는다.
 *      - 24시간 넘은 알림은 버린다 (재전송 공격 방지).
 *   2. 구독 확인(SubscriptionConfirmation) → SubscribeURL 을 한 번 열어 연결을 승인한다.
 *   3. 알림(Notification)
 *      - 영구 반송(Permanent)  → 금지 목록 bounce, 최근 3일 email_log 'sent' → 'bounced'
 *      - 일시 반송(Transient 등) → 금지 목록 soft_bounce (3번 쌓이면 금지)
 *      - 스팸 신고(Complaint)   → 금지 목록 complaint + 수신거부 처리
 *          (회원: profiles.email_consent=false + consent_history 기록 / 비회원: newsletter_signups unsubscribed)
 *        단 신고 종류가 'not-spam' 이면 무시한다.
 *      - 배달 성공(Delivery) 등 → 무시
 * DB 저장이 실패하면 500 을 돌려 SNS 가 다시 보내게 한다.
 */

const crypto = require('crypto');

const ACCOUNT_ID = '396881795178';          // papkorea.com AWS 계정 (SES 서울)
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CERT_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

const certCache = new Map();                  // 인증서 주소 → PEM

function getRawBody(req) {
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 256 * 1024) { reject(new Error('too large')); req.destroy && req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isAwsSnsUrl(u, wantPem) {
  try {
    const x = new URL(String(u || ''));
    if (x.protocol !== 'https:' || !CERT_HOST_RE.test(x.hostname) || x.port) return false;
    return wantPem ? /\.pem$/.test(x.pathname) : true;
  } catch (_) { return false; }
}

function topicAllowed(arn) {
  const p = String(arn || '').split(':');   // arn:aws:sns:<region>:<account>:<name>
  return p.length === 6 && p[0] === 'arn' && p[1] === 'aws' && p[2] === 'sns' && p[4] === ACCOUNT_ID && !!p[5];
}

function stringToSign(m) {
  const keys = m.Type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  let out = '';
  for (const k of keys) {
    if (k === 'Subject' && (m.Subject == null)) continue;
    out += k + '\n' + m[k] + '\n';
  }
  return out;
}

async function defaultFetchCert(url) {
  if (certCache.has(url)) return certCache.get(url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('cert http ' + r.status);
    const pem = await r.text();
    if (certCache.size > 20) certCache.clear();
    certCache.set(url, pem);
    return pem;
  } finally { clearTimeout(timer); }
}

/** 서명 확인. 통과하면 { ok:true }, 아니면 { ok:false, why } */
async function verifySnsMessage(m, opts) {
  const o = opts || {};
  if (!m || typeof m !== 'object') return { ok: false, why: 'not_json' };
  if (!['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'].includes(m.Type)) return { ok: false, why: 'type' };
  if (!topicAllowed(m.TopicArn)) return { ok: false, why: 'topic' };
  if (!isAwsSnsUrl(m.SigningCertURL || m.SigningCertUrl, true)) return { ok: false, why: 'cert_url' };
  const ts = Date.parse(m.Timestamp);
  const now = o.now ? o.now() : Date.now();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_AGE_MS) return { ok: false, why: 'stale' };
  const algo = String(m.SignatureVersion) === '2' ? 'RSA-SHA256' : String(m.SignatureVersion) === '1' ? 'RSA-SHA1' : null;
  if (!algo || !m.Signature) return { ok: false, why: 'sig_version' };
  let pem;
  try { pem = await (o.fetchCert || defaultFetchCert)(m.SigningCertURL || m.SigningCertUrl); }
  catch (e) { return { ok: false, why: 'cert_fetch' }; }
  try {
    const v = crypto.createVerify(algo);
    v.update(stringToSign(m), 'utf8');
    return v.verify(pem, String(m.Signature), 'base64') ? { ok: true } : { ok: false, why: 'signature' };
  } catch (_) { return { ok: false, why: 'signature' }; }
}

function likeSafe(e) { return String(e).replace(/[\\%_]/g, (c) => '\\' + c); }

async function optOut(db, email, now) {
  // 회원이면 수신동의 끄기 + 기록. 비회원 구독이면 수신거부.
  // 같은 주소가 대소문자만 달리 두 줄일 수도 있어서 maybeSingle 대신 전부 본다 (maybeSingle 은 2줄이면 에러 → 무한 재전송).
  const { data: profs, error: pErr } = await db.from('profiles')
    .select('id, email_consent').ilike('email', likeSafe(email)).limit(5);
  if (pErr) throw pErr;
  for (const prof of (profs || [])) {
    if (!prof.email_consent) continue;
    const u = await db.from('profiles').update({ email_consent: false, email_consent_at: now }).eq('id', prof.id);
    if (u && u.error) throw u.error;
    const h = await db.from('consent_history').insert({
      user_id: prof.id, consent_type: 'email', granted: false, granted_at: now, source: 'ses_complaint',
    });
    if (h && h.error) throw h.error;
  }
  const s = await db.from('newsletter_signups').update({ status: 'unsubscribed', updated_at: now })
    .eq('email', email).neq('status', 'unsubscribed');
  if (s && s.error) throw s.error;
}

async function markLogBounced(db, email, now) {
  const since = new Date(Date.parse(now) - 3 * 24 * 60 * 60 * 1000).toISOString();
  const r = await db.from('email_log').update({ status: 'bounced' })
    .ilike('email', likeSafe(email)).eq('status', 'sent').gte('sent_at', since);
  if (r && r.error) console.warn('[ses/notifications] email_log bounced 표시 실패:', r.error.message);
}

/** SES 알림(JSON) 한 건 처리. 처리한 주소 수를 돌려준다. */
async function handleSesEvent(msg, deps) {
  const { db, record, normEmail } = deps;
  const kind = msg && (msg.notificationType || msg.eventType);
  const now = new Date().toISOString();
  let n = 0;
  if (kind === 'Bounce' && msg.bounce) {
    const b = msg.bounce;
    const hard = b.bounceType === 'Permanent';
    for (const r of (b.bouncedRecipients || [])) {
      const email = normEmail(r && r.emailAddress);
      if (!email) continue;
      await record({ email, reason: hard ? 'bounce' : 'soft_bounce', bounceType: b.bounceType, bounceSubType: b.bounceSubType,
        diagnostic: r.diagnosticCode || r.status || null, feedbackId: b.feedbackId, source: 'ses' }, { db });
      if (hard) await markLogBounced(db, email, now);
      n++;
    }
  } else if (kind === 'Complaint' && msg.complaint) {
    const c = msg.complaint;
    if (String(c.complaintFeedbackType || '').toLowerCase() === 'not-spam') return 0;
    for (const r of (c.complainedRecipients || [])) {
      const email = normEmail(r && r.emailAddress);
      if (!email) continue;
      await record({ email, reason: 'complaint', diagnostic: c.complaintFeedbackType || null, feedbackId: c.feedbackId, source: 'ses' }, { db });
      await optOut(db, email, now);
      n++;
    }
  }
  return n;
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  let raw, m;
  try { raw = await getRawBody(req); m = JSON.parse(raw); }
  catch (_) { return res.status(400).json({ error: 'bad body' }); }

  const v = await verifySnsMessage(m, handler._opts);
  if (!v.ok) {
    console.warn('[ses/notifications] 거절:', v.why);
    return res.status(403).json({ error: 'forbidden' });
  }

  if (m.Type === 'SubscriptionConfirmation') {
    if (!isAwsSnsUrl(m.SubscribeURL, false)) return res.status(403).json({ error: 'forbidden' });
    try {
      const r = await (handler._opts && handler._opts.confirmFetch ? handler._opts.confirmFetch(m.SubscribeURL) : fetch(m.SubscribeURL));
      if (!r || !r.ok) throw new Error('subscribe http ' + (r && r.status));
      console.log('[ses/notifications] SNS 구독 승인:', m.TopicArn);
      return res.status(200).json({ ok: true, confirmed: true });
    } catch (e) {
      console.error('[ses/notifications] 구독 승인 실패:', e && e.message);
      return res.status(502).json({ error: 'confirm failed' });
    }
  }
  if (m.Type === 'UnsubscribeConfirmation') return res.status(200).json({ ok: true });

  let msg;
  try { msg = JSON.parse(m.Message); } catch (_) { return res.status(200).json({ ok: true, ignored: 'not_json' }); }
  try {
    const { supabaseAdmin } = require('../_lib/supabase');
    const sup = require('../_lib/emailSuppression');
    const n = await handleSesEvent(msg, { db: supabaseAdmin, record: sup.recordSuppression, normEmail: sup.normEmail });
    return res.status(200).json({ ok: true, processed: n });
  } catch (e) {
    console.error('[ses/notifications] 처리 실패 — SNS 가 다시 보낸다:', (e && e.message) || e);
    return res.status(500).json({ error: 'processing failed' });
  }
}

handler._opts = null;   // 테스트용 주입 (fetchCert, now, confirmFetch)
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.verifySnsMessage = verifySnsMessage;
module.exports.stringToSign = stringToSign;
module.exports.handleSesEvent = handleSesEvent;
module.exports.topicAllowed = topicAllowed;
module.exports.isAwsSnsUrl = isAwsSnsUrl;
module.exports.ACCOUNT_ID = ACCOUNT_ID;
