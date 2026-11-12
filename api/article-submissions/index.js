/**
 * POST /api/article-submissions  — 아티클 기고 접수 (회원)
 * GET  /api/article-submissions  — 목록 (관리자, ?status=&page=&limit=)
 *
 * 도메니코 2026-11-11: "아티클 서브미션은 기사보다 좀더 전문화된 긴글을 쓰는거지."
 *
 * ■ 이미지는 에디토리얼과 같은 길을 쓴다
 * POST /api/submissions/upload-url 로 서명 URL 을 받아 브라우저가 스토리지에 직접
 * PUT 하고, 여기에는 그 결과 URL 만 보낸다. 새 버킷을 만들지 않은 이유가 있다 —
 * 앱 화이트리스트와 버킷 allowed_mime_types 가 어긋나면 '앱은 통과시켰는데
 * 스토리지가 거부하는' 조용한 실패가 된다(.claude/rules/api.md). 이미 맞춰진
 * 버킷을 쓰는 쪽이 어긋날 구석이 없다. 서버는 모든 URL 이 **자기 폴더 아래**인지
 * 다시 확인한다.
 *
 * ■ 게재료 — 제출은 무료로 받는다
 * 도메니코 결정(2026-11-12, '추천대로'): 홍보성이면 €790 이지만 **심사 후에**
 * 안내한다. 그래서 여기서는 fee_type='free', payment_status='none' 으로만 넣는다.
 * 관리자가 심사에서 branded 로 바꾸는 순간 안내 메일이 나간다.
 *
 * ■ AI 홍보성 분석
 * 접수 직후 한 번 분석해 promo_ai 에 넣는다. 다만 **예산을 짧게(12초)** 준다 —
 * 회원이 기다리는 요청이기 때문이다. 못 끝내면 promo_ai 를 비워 두고,
 * 관리자가 심사 화면에서 재분석을 호출한다(api/article-submissions/[id]/analyze.js).
 * 분석 실패가 접수를 막는 일은 구조적으로 없다: INSERT 가 먼저 끝난다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth, requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { hasDangerousHtml, cleanText, safeHttpUrl, stripControl } = require('../_lib/userHtml');
const A = require('../_lib/articleSubmission');
const { analyzePromo } = require('../_lib/articlePromoAi');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');

const BUCKET = 'submissions';

/* 접수 요청 안에서 AI 에게 줄 예산. 회원이 기다리는 요청이므로 짧다.
   함수 상한은 vercel.json 의 api 전체 와일드카드(maxDuration 120)가 준다 —
   전용 항목을 두지 않는 이유는 ① 와일드카드가 이미 넉넉하고 ② 더 구체적인 키를
   쓰면 오히려 120 을 깎게 되며 ③ [id] 가 든 글롭 키는 minimatch 가 문자 클래스로
   읽어 아무것도 안 맞고 빌드가 깨진다(tests/telegram-editorial-dispatch.test.js 가
   지키는 규칙, 2026-09-20 사고). 예산을 늘릴 일이 생기면 그 테스트를 먼저 읽는다. */
const INTAKE_AI_BUDGET_MS = 12000;

function userPathPrefix(userId) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const safeId = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'anon';
  return `${base}/storage/v1/object/public/${BUCKET}/${safeId}/`;
}

function isOwnedUrl(url, prefix) {
  if (typeof url !== 'string' || !url) return false;
  if (!url.startsWith(prefix)) return false;
  if (url.indexOf('..') !== -1) return false;
  return true;
}

/* 400 은 반드시 code 와 함께, 그리고 서버 로그에 이유를 남긴다.
   (에디토리얼 쪽 교훈 — 로그에 "POST 400" 한 줄만 남으면 어느 검증에 걸렸는지
   알 수 없고, 회원 화면도 code 가 없으면 일반 문구만 뜬다.) */
function _reject(res, user, code, message, extra) {
  try {
    console.warn('[article-submissions] 400 %s user=%s %s', code, user && user.id,
      extra ? JSON.stringify(extra).slice(0, 300) : '');
  } catch (_) { /* 로깅 실패는 무시 */ }
  return res.status(400).json(Object.assign({ code, message }, extra || {}));
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
      const prefix = userPathPrefix(user.id);

      // ── 글 ──
      const title = cleanText(d.title, A.MAX.title);
      if (!title) return _reject(res, user, 'TITLE_REQUIRED', 'Title is required');
      const subtitle = cleanText(d.subtitle, A.MAX.subtitle);

      const topic = A.normalizeTopic(d.topic);
      if (!topic) return _reject(res, user, 'TOPIC_INVALID', 'Choose one of the listed topics', { received: String(d.topic || '').slice(0, 60) });
      const category = A.categoryForTopic(topic);

      const bodyLang = A.normalizeBodyLang(d.bodyLang || d.body_lang);
      if (!bodyLang) return _reject(res, user, 'BODY_LANG_INVALID', 'Articles are accepted in English or Korean', { received: String(d.bodyLang || d.body_lang || '').slice(0, 20) });

      // 본문은 줄바꿈을 보존해야 하므로 cleanText(공백 축약 없음) + 제어문자만 제거.
      const articleBody = stripControl(d.body).slice(0, A.MAX.body);
      if (!articleBody.trim()) return _reject(res, user, 'BODY_REQUIRED', 'Article body is required');
      // 본문은 평문만 받는다. 이 칸은 승인 시 articles.content 로 가고, 그 값은
      // 공개 상세에서 innerHTML 로 들어간다 — 태그를 받으면 저장형 XSS 다.
      // 넓은 거부 목록(hasDangerousHtml)을 쓰지 않는 이유는 articleSubmission.js
      // 주석에 적었다(IT·테크 글이 'javascript:' 를 쓰는 건 정상이다).
      if (A.hasHtmlTag(articleBody)) {
        return _reject(res, user, 'BODY_HTML_REJECTED', 'The body must be plain text — HTML tags are not accepted.');
      }
      const m = A.measureBody(articleBody, bodyLang);
      if (!m.ok) {
        return _reject(res, user, 'BODY_TOO_SHORT',
          'The article is too short. Minimum ' + m.min + ' ' + m.unit + ' (you have ' + m.count + ').',
          { unit: m.unit, count: m.count, min: m.min });
      }

      const authorBio = cleanText(d.authorBio || d.author_bio, A.MAX.authorBio);
      if (!authorBio) return _reject(res, user, 'AUTHOR_BIO_REQUIRED', 'A short author bio is required for the byline');
      const authorName = cleanText(d.authorName || d.author_name, A.MAX.authorName);
      const sources = stripControl(d.sources).slice(0, A.MAX.sources);
      if (hasDangerousHtml(sources)) {
        return _reject(res, user, 'SOURCES_HTML_REJECTED', 'The sources field contains markup that is not allowed.');
      }
      for (const f of [title, subtitle, authorBio, authorName]) {
        if (hasDangerousHtml(f)) return _reject(res, user, 'FIELD_HTML_REJECTED', 'One of the text fields contains markup that is not allowed.');
      }

      // 인스타 핸들은 글자 제한, 웹사이트는 스킴 검증(관리자 화면에서 <a href> 로 렌더된다).
      let authorInstagram = String(d.authorInstagram || d.author_instagram || '').trim().replace(/^@+/, '');
      if (authorInstagram && !/^[A-Za-z0-9._]{1,30}$/.test(authorInstagram)) {
        return _reject(res, user, 'INSTAGRAM_INVALID', 'Instagram handle may contain letters, numbers, dots and underscores only.');
      }
      const authorWebsite = safeHttpUrl(d.authorWebsite || d.author_website);
      if ((d.authorWebsite || d.author_website) && !authorWebsite) {
        return _reject(res, user, 'WEBSITE_INVALID', 'The website must be a valid http(s) address.');
      }

      // ── 이미지 ──
      const coverUrl = typeof d.coverUrl === 'string' ? d.coverUrl.trim() : (typeof d.cover_url === 'string' ? d.cover_url.trim() : '');
      if (!coverUrl) return _reject(res, user, 'COVER_REQUIRED', 'A cover image is required');
      if (!isOwnedUrl(coverUrl, prefix)) return _reject(res, user, 'URL_NOT_OWNED', 'The cover image URL does not belong to this user');

      const rawImages = Array.isArray(d.imageUrls) ? d.imageUrls : (Array.isArray(d.image_urls) ? d.image_urls : []);
      if (rawImages.length > A.MAX_BODY_IMAGES) {
        return _reject(res, user, 'TOO_MANY_IMAGES', 'Up to ' + A.MAX_BODY_IMAGES + ' body images (plus the cover).', { count: rawImages.length, max: A.MAX_BODY_IMAGES });
      }
      const imageUrls = rawImages.filter((u) => isOwnedUrl(u, prefix));
      if (imageUrls.length < rawImages.length) {
        return _reject(res, user, 'URL_NOT_OWNED', 'One or more image URLs do not belong to this user');
      }

      // ── 동의 ──
      // 소셜 게재는 선택이 아니다 (도메니코 2026-11-11: "셋다 게재시 소셜미디어에도 필수로 올라감").
      if (d.socialConsent !== true && d.social_consent !== true) {
        return _reject(res, user, 'SOCIAL_CONSENT_REQUIRED', 'Consent to publication on PAP social channels is required');
      }
      if (d.termsAgreed !== true && d.terms_agreed !== true) {
        return _reject(res, user, 'TERMS_REQUIRED', 'You must agree to the submission terms');
      }
      // 자진신고는 예/아니오 둘 다 유효하다 — 판정을 맡기려는 게 아니라
      // "몰랐다"를 없애기 위해 받는다. 다만 **고르지 않은 것**은 받지 않는다.
      const promoRaw = (d.promoSelfDeclared !== undefined) ? d.promoSelfDeclared : d.promo_self_declared;
      if (promoRaw !== true && promoRaw !== false) {
        return _reject(res, user, 'PROMO_DECLARATION_REQUIRED', 'Please state whether this piece promotes a specific brand or artist');
      }
      const promoSelfDeclared = promoRaw === true;

      const { data: sub, error } = await supabaseAdmin
        .from('article_submissions')
        .insert({
          user_id: user.id,
          title,
          subtitle: subtitle || null,
          category,
          topic,
          body_lang: bodyLang,
          body: articleBody,
          word_count: m.count,
          sources: sources || null,
          author_bio: authorBio,
          author_name: authorName || null,
          author_instagram: authorInstagram || null,
          author_website: authorWebsite || null,
          cover_url: coverUrl,
          image_urls: imageUrls,
          social_consent: true,
          promo_self_declared: promoSelfDeclared,
          terms_agreed: true,
          status: 'pending',
          fee_type: 'free',          // 판정은 관리자가 심사에서 한다
          payment_status: 'none',    // 제출 단계에서는 청구가 없다
        })
        .select()
        .single();

      if (error) {
        console.error('[article-submissions] insert failed:', error);
        throw error;
      }

      /* 접수 확인 메일. ★ 반드시 await — fire-and-forget 은 서버리스 프리즈로
         실제 발송이 안 된다(승인 메일 0/35 실측 전례). 실패해도 접수는 막지 않는다. */
      try {
        const { data: prof } = await supabaseAdmin
          .from('profiles')
          .select('email, display_name, language, email_language, country')
          .eq('id', user.id)
          .single();
        if (prof && prof.email) {
          await sendEmail(prof.email, templates.articleSubmissionReceived(
            { name: prof.display_name || '' }, { title: sub.title }, resolveEmailLang(prof)));
        }
      } catch (e) {
        console.error('[article-submissions] 접수 메일 실패(접수는 저장됨):', (e && e.message) || e);
      }

      /* AI 홍보성 분석 — INSERT 뒤에 돈다. 실패·시간초과는 promo_ai 를 비워 두고
         넘어간다(관리자가 심사 화면에서 재분석). 자진신고가 '예'면 어차피 사람이
         보게 되므로 분석을 건너뛰어 회원 대기시간을 줄인다. */
      if (!promoSelfDeclared) {
        try {
          const ai = await analyzePromo(
            { title, subtitle, topic, body_lang: bodyLang, body: articleBody, promo_self_declared: promoSelfDeclared },
            { timeoutMs: INTAKE_AI_BUDGET_MS });
          await supabaseAdmin.from('article_submissions')
            .update({ promo_ai: ai, updated_at: new Date().toISOString() })
            .eq('id', sub.id);
        } catch (e) {
          console.warn('[article-submissions] 분석 저장 실패(접수는 정상):', (e && e.message) || e);
        }
      }

      // 운영자 알림 — 자진신고가 '예'면 €790 안내가 필요한 건이므로 표시한다.
      try {
        await sendTextToTelegramSafe('📝 아티클 기고 접수'
          + '\n제목: ' + String(title).slice(0, 80)
          + '\n분류: ' + topic + ' → ' + category
          + '\n분량: ' + m.count + ' ' + m.unit + ' (' + bodyLang + ')'
          + '\n자진신고 홍보성: ' + (promoSelfDeclared ? '예 → €790 안내 대상' : '아니오')
          + '\n제출자: ' + (authorName || user.email || user.id)
          + '\nsubmission=' + sub.id);
      } catch (_) { /* 알림 실패는 접수를 막지 않는다 */ }

      return res.status(201).json({ submission: { id: sub.id, title: sub.title, status: sub.status, created_at: sub.created_at } });
    } catch (error) {
      try {
        console.error('[article-submissions] create error:', {
          name: error && error.name, message: error && error.message,
          code: error && error.code, details: error && error.details, hint: error && error.hint,
        });
      } catch (_) { console.error('[article-submissions] create error (raw):', error); }
      try {
        await sendTextToTelegramSafe('🚨 아티클 기고 저장 실패\nuser=' + (user && user.id || '')
          + '\ncode=' + (error && error.code || '')
          + '\nmsg=' + String((error && error.message) || '').slice(0, 300));
      } catch (_) {}
      // 회원 응답: 원문 노출 금지 — 일반 안내 + 분류용 code 만 (.claude/rules/api.md A-3).
      return res.status(500).json({
        message: 'Failed to submit your article. If this keeps happening, contact contact@pap-magazine.com',
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
        .from('article_submissions')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + perPage - 1);
      if (status) q = q.eq('status', String(status));

      const { data: rows, count, error } = await q;
      if (error) throw error;

      // 제출자 정보는 별도 조회로 붙인다 (user_id 는 auth.users 를 가리켜
      // PostgREST embed 가 항상 추론되지 않는다 — 에디토리얼 목록과 같은 이유).
      const ids = Array.from(new Set((rows || []).map((r) => r.user_id).filter(Boolean)));
      const byId = {};
      if (ids.length) {
        const { data: profs } = await supabaseAdmin
          .from('profiles').select('id, email, display_name, instagram_handle, country').in('id', ids);
        for (const p of (profs || [])) byId[p.id] = p;
      }
      const submissions = (rows || []).map((r) => Object.assign({}, r, { submitter: byId[r.user_id] || null }));

      return res.status(200).json({ submissions, total: count || 0, page: Math.max(1, parseInt(page, 10) || 1), perPage });
    } catch (error) {
      console.error('[article-submissions] list error:', error);
      return res.status(500).json({ message: 'Failed to load article submissions.', code: 'list_failed' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
