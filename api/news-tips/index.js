/**
 * POST /api/news-tips  — 제보 접수 (회원, 로그인 필수)
 * GET  /api/news-tips  — 목록 (관리자, ?status=&page=&limit=)
 *
 * 도메니코 2026-11-11:
 *   가 — 로그인 필수
 *   나 — 보상: 채택 시 기사 크레딧 + 프리미엄 1개월 (수동 처리)
 *   다 — 받을 항목 모두 동의. 다만 **직접 목격한 것만** 제보 가능
 *   라 — 제보는 전부 긴급제보만 받고 **텔레그램으로 알림**
 *
 * ■ 미디어가 없으면 제보가 아니다
 * 이 트랙의 본체는 글이 아니라 증거다. 미디어 0건은 400 이다.
 *
 * ■ 자동으로 기사가 되는 경로가 없다
 * 이 파일에는 `articles` 를 건드리는 코드가 한 줄도 없다. 도메니코가 제보를
 * 보고 확인하고 직접 기사를 쓴다. 증거가 있어도 확인은 여전히 필요하다 —
 * 영상 속 인물이 정말 그 사람인지, 언제 찍힌 것인지, 맥락이 맞는지.
 *
 * ■ 미디어 경로만 저장한다 (공개 URL 아님)
 * 버킷 news-tips 는 비공개다. 확인 전에 경로만 아는 사람이 볼 수 있으면
 * 초상권이 걸린 영상에서는 그 자체가 사고다. 관리자 화면이 그때그때 서명
 * URL 을 만들어 본다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { cleanText, stripControl, hasDangerousHtml } = require('../_lib/userHtml');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const T = require('../_lib/newsTip');

/* 400 은 반드시 code 와 함께, 그리고 서버 로그에 이유를 남긴다. */
function _reject(res, user, code, message, extra) {
  try {
    console.warn('[news-tips] 400 %s user=%s %s', code, user && user.id,
      extra ? JSON.stringify(extra).slice(0, 300) : '');
  } catch (_) { /* 로깅 실패는 무시 */ }
  return res.status(400).json(Object.assign({ code, message }, extra || {}));
}

/** 제출된 미디어 목록을 정리한다. 자기 폴더 아래의 경로만 남긴다. */
function sanitizeMedia(list, userId) {
  const prefix = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '') + '/';
  const out = [];
  for (const m of (Array.isArray(list) ? list : [])) {
    if (!m || typeof m !== 'object') continue;
    const p = String(m.path || '');
    // 자기 폴더 아래 · 상위 탈출 금지 · 허용 문자만
    if (!p.startsWith(prefix)) continue;
    if (p.indexOf('..') !== -1) continue;
    if (!/^[A-Za-z0-9/_.-]+$/.test(p)) continue;
    const type = T.canonicalMime(m.type);
    if (!T.ALLOWED_MIME.has(type)) continue;
    const size = Number(m.size) || 0;
    if (size <= 0 || size > T.maxBytesFor(type)) continue;
    out.push({
      path: p,
      type,
      size,
      name: cleanText(m.name, 120),
      kind: T.isVideo(type) ? 'video' : 'image',
    });
    if (out.length >= T.MAX_FILES) break;
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // ── POST: 접수 ──
  if (req.method === 'POST') {
    if (rateLimit(req, res, RATE_LIMITS.upload)) return;
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      let body = req.body;
      if (!body || typeof body === 'string') {
        try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
      }
      const d = body.data || body || {};

      const title = cleanText(d.title, T.MAX.title);
      if (!title) return _reject(res, user, 'TITLE_REQUIRED', 'A one-line summary is required');
      const tipBody = stripControl(d.body).slice(0, T.MAX.body);
      if (!tipBody.trim()) return _reject(res, user, 'BODY_REQUIRED', 'Describe what you saw');
      const location = cleanText(d.location, T.MAX.location);
      if (!location) return _reject(res, user, 'LOCATION_REQUIRED', 'Where did this happen?');
      for (const f of [title, location]) {
        if (hasDangerousHtml(f)) return _reject(res, user, 'FIELD_HTML_REJECTED', 'One of the fields contains markup that is not allowed.');
      }

      /* 발생 시각 — 제출자가 적은 원문을 그대로 남기고, 파싱되면 타임스탬프도 같이
         남긴다. 제보는 "어제 밤쯤" 처럼 애매할 수 있고, 그걸 버리면 확인에 쓸
         단서를 잃는다. 둘 다 둔다. */
      const happenedText = cleanText(d.happenedAt || d.happened_at, T.MAX.happenedAtText);
      if (!happenedText) return _reject(res, user, 'HAPPENED_AT_REQUIRED', 'When did this happen?');
      const parsed = Date.parse(happenedText);
      const happenedAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;

      // ── 미디어가 본체다 ──
      const media = sanitizeMedia(d.media, user.id);
      const sentCount = Array.isArray(d.media) ? d.media.length : 0;
      if (media.length === 0) {
        return _reject(res, user, 'MEDIA_REQUIRED',
          'A tip needs your own photo or video. Without it we cannot verify or publish anything.',
          { sent: sentCount });
      }
      if (media.length < sentCount) {
        // 걸러진 게 있으면 조용히 넘기지 않는다 — 클라이언트는 이런 걸 보내지 않는다.
        return _reject(res, user, 'MEDIA_NOT_OWNED', 'One or more files do not belong to this user',
          { sent: sentCount, accepted: media.length });
      }

      // ── 동의 ──
      // 도메니코 '다': 모두 동의. 다만 **직접 목격한 것만**.
      if (d.witnessedConfirmed !== true && d.witnessed_confirmed !== true) {
        return _reject(res, user, 'WITNESS_REQUIRED', 'Only tips you witnessed and filmed yourself are accepted');
      }
      if (d.mediaRightsConsent !== true && d.media_rights_consent !== true) {
        return _reject(res, user, 'MEDIA_RIGHTS_REQUIRED', 'Permission to use your footage is required');
      }
      if (d.socialConsent !== true && d.social_consent !== true) {
        return _reject(res, user, 'SOCIAL_CONSENT_REQUIRED', 'Consent to publication on PAP social channels is required');
      }
      const contactable = (d.contactable === true || d.contactable === 'true');

      /* 계정당 하루 상한. 모든 접수가 즉시 텔레그램으로 가므로, 남용 방지가
         알림 폭주 방지이기도 하다. IP 레이트리밋은 위 rateLimit 이 따로 본다. */
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count: recent, error: cErr } = await supabaseAdmin
        .from('news_tips')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', since);
      if (!cErr && typeof recent === 'number' && recent >= T.DAILY_LIMIT_PER_USER) {
        return res.status(429).json({
          code: 'DAILY_LIMIT',
          message: 'You have reached today\'s limit of ' + T.DAILY_LIMIT_PER_USER + ' tips. Please try again tomorrow.',
          limit: T.DAILY_LIMIT_PER_USER,
        });
      }

      const { data: tip, error } = await supabaseAdmin
        .from('news_tips')
        .insert({
          user_id: user.id,
          title,
          body: tipBody,
          happened_at: happenedAt,
          happened_at_text: happenedText,
          location,
          media,
          witnessed_confirmed: true,
          media_rights_consent: true,
          social_consent: true,
          contactable,
          status: 'new',
        })
        .select('id, title, created_at, status')
        .single();
      if (error) {
        console.error('[news-tips] insert failed:', error);
        throw error;
      }

      /* 도메니코 '라' — 전부 긴급이다. 즉시 알린다.
         ★ await: 서버리스는 응답 반환 후 함수를 얼려 전송을 잃는다. 다만 알림
         실패가 접수를 막지는 않는다(증거는 이미 저장됐다). */
      try {
        const vids = media.filter((m) => m.kind === 'video').length;
        const imgs = media.length - vids;
        await sendTextToTelegramSafe('🚨 제보 접수 (긴급)'
          + '\n제목: ' + String(title).slice(0, 100)
          + '\n장소: ' + String(location).slice(0, 80)
          + '\n발생: ' + String(happenedText).slice(0, 60)
          + '\n미디어: 영상 ' + vids + ' · 사진 ' + imgs
          + '\n연락 가능: ' + (contactable ? '예' : '아니오')
          + '\n제보자: ' + (user.email || user.id)
          + '\ntip=' + tip.id
          + '\n관리자 화면 → 제보에서 미디어를 바로 보실 수 있습니다.'
          + '\n⚠️ 미디어는 ' + T.PURGE_AFTER_DAYS + '일 뒤 삭제됩니다. 쓸 거면 그 전에 채택 표시를 하세요.');
      } catch (_) { /* 알림 실패가 접수를 막지 않는다 */ }

      return res.status(201).json({ tip: { id: tip.id, title: tip.title, status: tip.status, created_at: tip.created_at } });
    } catch (error) {
      try {
        console.error('[news-tips] create error:', {
          name: error && error.name, message: error && error.message,
          code: error && error.code, details: error && error.details, hint: error && error.hint,
        });
      } catch (_) { console.error('[news-tips] create error (raw):', error); }
      try {
        await sendTextToTelegramSafe('🚨 제보 저장 실패\nuser=' + (user && user.id || '')
          + '\ncode=' + (error && error.code || '')
          + '\nmsg=' + String((error && error.message) || '').slice(0, 300));
      } catch (_) {}
      // 원문 노출 금지 — 일반 안내 + 분류용 code (.claude/rules/api.md A-3)
      return res.status(500).json({
        message: 'Failed to submit your tip. If this keeps happening, contact contact@pap-magazine.com',
        code: 'create_failed',
      });
    }
  }

  // ── GET: 목록 (관리자) ──
  if (req.method === 'GET') {
    if (rateLimit(req, res, RATE_LIMITS.api)) return;
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    try {
      const { status, page = 1, limit: rawLimit } = req.query;
      const perPage = Math.min(Math.max(1, parseInt(rawLimit, 10) || 50), 200);
      const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * perPage;

      let q = supabaseAdmin
        .from('news_tips')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + perPage - 1);
      if (status) q = q.eq('status', String(status));

      const { data: rows, count, error } = await q;
      if (error) throw error;

      // 제보자 정보 (user_id 는 auth.users 를 가리켜 embed 가 추론되지 않는다)
      const ids = Array.from(new Set((rows || []).map((r) => r.user_id).filter(Boolean)));
      const byId = {};
      if (ids.length) {
        const { data: profs } = await supabaseAdmin
          .from('profiles').select('id, email, display_name, country').in('id', ids);
        for (const p of (profs || [])) byId[p.id] = p;
      }

      /* 미디어는 비공개 버킷이므로 **그때그때** 서명 URL 을 만들어 내려준다.
         DB 에 공개 URL 을 심어 두지 않는 이유가 이것이다 — 유효기간이 짧은
         링크여야 하고, 지워진 뒤에는 링크도 죽어야 한다. */
      const tips = [];
      for (const r of (rows || [])) {
        const media = Array.isArray(r.media) ? r.media : [];
        const signed = [];
        for (const m of media) {
          let url = '';
          if (!r.media_purged_at) {
            try {
              const { data } = await supabaseAdmin.storage.from(T.BUCKET)
                .createSignedUrl(m.path, 60 * 60);   // 1시간
              url = (data && data.signedUrl) || '';
            } catch (_) { url = ''; }
          }
          signed.push(Object.assign({}, m, { url }));
        }
        tips.push(Object.assign({}, r, { media: signed, reporter: byId[r.user_id] || null }));
      }

      return res.status(200).json({ tips, total: count || 0, page: Math.max(1, parseInt(page, 10) || 1), perPage });
    } catch (error) {
      console.error('[news-tips] list error:', error);
      return res.status(500).json({ message: 'Failed to load tips.', code: 'list_failed' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
