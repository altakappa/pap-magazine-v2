/**
 * PAP Magazine — Instagram → Article 변환 공유 라이브러리.
 *
 * QA #275. 두 가지 소비자:
 *   • POST /api/admin/articles/from-instagram (어드민 수동 URL 붙여넣기)
 *   • GET  /api/cron/sync-instagram         (매시간 자동 동기화)
 *
 * 핵심 함수:
 *   fetchInstagramPost(urlOrId)  → { id, caption, mediaUrls, permalink, timestamp }
 *   generateArticleFromPost(post) → { title_ko, title_en, body_ko, body_en, category, tags, slug }
 *   buildArticleRow(post, generated) → articles INSERT용 row 객체
 *
 * Instagram Graph API 호출은 IG_ACCESS_TOKEN + IG_USER_ID 환경변수에 의존.
 * 둘 다 없으면 oEmbed fallback (제한적 — caption + media url 정도만)을 시도.
 */

const _IG_API = 'https://graph.facebook.com/v18.0';

// URL/shortcode/media-id 등 입력을 통합해서 항상 shortcode를 반환.
function _extractShortcode(input){
  if (!input) return null;
  const s = String(input).trim();
  // 이미 shortcode 모양 ("Czxy1234abc") 그대로 받기
  if (/^[A-Za-z0-9_-]{6,20}$/.test(s) && !s.includes('/')) return s;
  const m = s.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Graph API로 IG Business Account 소속 미디어 목록 가져오기.
// limit: 최대 25 (Graph API 기본값).
async function listRecentMedia(opts){
  const limit = (opts && opts.limit) || 25;
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID){
    throw new Error('IG_ACCESS_TOKEN/IG_USER_ID 환경변수가 설정되어 있지 않습니다.');
  }
  const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username,like_count,comments_count,children{media_url,media_type,thumbnail_url}';
  const url = `${_IG_API}/${process.env.IG_USER_ID}/media?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${process.env.IG_ACCESS_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error('Graph API media list 실패 (' + res.status + '): ' + body.slice(0, 300));
  }
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

// 기간 기반 페이지네이션 수집 — sinceDays 이내 게시물을 최대 maxCount 개까지.
// Graph API paging.next 커서를 따라가며, 게시 시각이 컷오프보다 오래되면 중단.
async function listMediaPaged(opts){
  const sinceDays = (opts && opts.sinceDays) || 30;
  const maxCount = (opts && opts.maxCount) || 200;
  // 2026-07-23 — 최근 1년 전량 백필 대응. 페이지 상한을 maxCount 에 맞춰
  // 동적 계산(50개/페이지). 기존 하드코딩 10페이지(=500개)는 1년치를 다
  // 못 훑었다. cutoff(sinceDays) 가 먼저 걸리면 조기 종료되므로 안전.
  const pageGuard = (opts && opts.pageGuard) || Math.max(10, Math.ceil(maxCount / 50) + 2);
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID){
    throw new Error('IG_ACCESS_TOKEN/IG_USER_ID 환경변수가 설정되어 있지 않습니다.');
  }
  const cutoff = Date.now() - sinceDays * 86400000;
  const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username,like_count,comments_count,children{media_url,media_type,thumbnail_url}';
  let url = `${_IG_API}/${process.env.IG_USER_ID}/media?fields=${encodeURIComponent(fields)}&limit=50&access_token=${process.env.IG_ACCESS_TOKEN}`;
  const out = [];
  let guard = 0;
  while (url && out.length < maxCount && guard < pageGuard){
    guard++;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok){
      const body = await res.text().catch(() => '');
      throw new Error('Graph API media list 실패 (' + res.status + '): ' + body.slice(0, 300));
    }
    const json = await res.json();
    const rows = Array.isArray(json.data) ? json.data : [];
    let reachedCutoff = false;
    for (const m of rows){
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      if (ts && ts < cutoff){ reachedCutoff = true; break; }
      out.push(m);
      if (out.length >= maxCount) break;
    }
    if (reachedCutoff) break;
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return out;
}

// 단일 게시물 fetch.
//   shortcode 또는 media id 입력 → Graph API로 미디어 정보 가져옴.
//   Note: oEmbed는 Facebook이 2021년부터 앱 검수를 요구해서 일반 앱은 사용 불가.
//         그래서 Graph API만 사용 (자신의 Business 계정 미디어만 조회 가능).
async function fetchInstagramPost(input){
  const shortcode = _extractShortcode(input);
  if (!shortcode) throw new Error('유효한 Instagram URL/ID가 아닙니다.');

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID){
    throw new Error('IG_ACCESS_TOKEN/IG_USER_ID 환경변수가 설정되어 있지 않습니다.');
  }

  // Graph API는 자기 Business 계정 미디어만 직접 조회 가능. shortcode → id 변환을
  // 위해 최근 미디어 50개를 검색해서 매칭.
  const media = await listRecentMedia({ limit: 50 });
  const hit = media.find((m) =>
    m.permalink && m.permalink.includes('/' + shortcode + '/')
  );
  if (hit){
    return _normalizeMedia(hit);
  }
  throw new Error(
    '해당 게시물(' + shortcode + ')을 최근 50개 게시물에서 찾지 못했습니다. ' +
    '더 최근 게시물을 사용해 주세요. ' +
    '(IG_USER_ID가 올바른 계정인지도 확인하세요.)'
  );
}

function _normalizeMedia(m){
  const out = {
    id: m.id,
    caption: m.caption || '',
    mediaUrls: [],
    videoUrls: [], // 릴스/영상 원본 mp4 — 아카이브 후 기사에서 직접 재생
    permalink: m.permalink,
    timestamp: m.timestamp || null,
    author: m.username || 'pap_magazine',
    isVideo: m.media_type === 'VIDEO',
    likeCount: typeof m.like_count === 'number' ? m.like_count : null,
    commentsCount: typeof m.comments_count === 'number' ? m.comments_count : null,
    // 원본 IG media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'.
    // articles.source_media_type 으로 저장 → YouTube Shorts 크론이 VIDEO(릴스)만 필터링.
    mediaType: m.media_type || null,
  };
  // 단일 / 캐러셀 / 비디오 케이스 처리.
  // mediaUrls 에는 "이미지 URL만" 넣는다 — 비전 분석(base64 image block)과
  // 기사 썸네일 모두 이미지를 기대하므로 VIDEO 는 포스터(thumbnail_url)로 대체.
  // 영상 원본은 videoUrls 로 별도 수집 (Storage 영구 보관 → <video> 재생).
  if (m.media_type === 'CAROUSEL_ALBUM' && m.children && Array.isArray(m.children.data)){
    m.children.data.forEach((c) => {
      if (!c) return;
      if (c.media_type === 'VIDEO'){
        if (c.thumbnail_url) out.mediaUrls.push(c.thumbnail_url);
        if (c.media_url) out.videoUrls.push(c.media_url);
      } else if (c.media_url){
        out.mediaUrls.push(c.media_url);
      }
    });
  } else if (m.media_type === 'VIDEO'){
    if (m.thumbnail_url) out.mediaUrls.push(m.thumbnail_url);
    if (m.media_url) out.videoUrls.push(m.media_url);
  } else if (m.media_url){
    out.mediaUrls.push(m.media_url);
  } else if (m.thumbnail_url){
    out.mediaUrls.push(m.thumbnail_url);
  }
  return out;
}

// 캡션이 "에디토리얼 크레딧 게시물"인지 휴리스틱 판별.
// 에디토리얼은 사용자가 웹사이트에 사전 업로드하므로 기사 수집에서 제외해야 한다.
//
// QA #347 — 임계값 상향. 이전 (roles>=2 && handles>=3)에서는 뉴스 캡션이
// 브랜드 @handle 2-3개 + 이벤트에 관여한 스타일리스트/포토그래퍼 언급을 하는
// 정도로도 걸려 "샤넬이 그린 또 하나의 히바로", "쿠튀르는 못 갔어도, 베뉴는
// 봐야겠지" 같은 일반 뉴스 게시물이 잘못 스킵되는 문제 발생.
// 신호:
//   ① 자사 에디토리얼 페이지 링크 (강력한 신호 유지)
//   ② 진짜 크레딧 게시물의 특징 — role 라벨과 @handle이 모두 다수 (>= 4/5)
//   ③ 'editorial' 명시 + 강한 크레딧 형태(role 3, handle 3 이상)
function isLikelyEditorialCaption(caption){
  const c = String(caption || '');
  if (!c) return false;
  if (/pap-magazine\.com\/editorial\//i.test(c)) return true;
  const roleRe = /(photograph(?:er|y)|stylist|styling|starring|model|make.?up|mua|hair|retouch|art director|set design|videograph)/gi;
  const roles = (c.match(roleRe) || []).length;
  const handles = (c.match(/@[A-Za-z0-9._]{2,}/g) || []).length;
  // 진짜 크레딧 게시물은 role 라벨 4개 이상 + @핸들 5개 이상이 일반적.
  if (roles >= 4 && handles >= 5) return true;
  // 'editorial' 단어가 있더라도 뉴스 캡션에도 등장 가능하므로 강한 크레딧 조합 필요.
  if (/editorial/i.test(c) && roles >= 3 && handles >= 3) return true;
  return false;
}

// Claude API로 IG 게시물을 PAP 매거진 톤의 바이링구얼 기사로 변환.
//   입력: { caption, mediaUrls, author, permalink }
//   출력: { title_ko, title_en, body_ko, body_en, category, tags, slug }
async function generateArticleFromPost(post){
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수 누락.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const visionBlocks = [];
  // 1장만 비전 컨텍스트로 사용 (Vercel function timeout 60초 제한 + 이미지 다운로드 시간 고려).
  // Instagram CDN이 Anthropic의 robots.txt 차단하므로 직접 fetch해서 base64로 전달.
  for (const u of (post.mediaUrls || []).slice(0, 1)){
    try {
      const imgRes = await fetch(u);
      if (!imgRes.ok){
        console.warn('[ig] image fetch failed:', imgRes.status, u);
        continue;
      }
      const mediaType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
      // 안전장치: 이미지가 아니면(예: 비디오 mp4) 비전 블록에서 제외 —
      // Claude image block 에 비 이미지 타입을 넣으면 API 400 으로 전체 실패.
      if (!/^image\//.test(mediaType)){
        console.warn('[ig] 비 이미지 타입 제외:', mediaType, u);
        continue;
      }
      const arrayBuf = await imgRes.arrayBuffer();
      const base64 = Buffer.from(arrayBuf).toString('base64');
      visionBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      });
    } catch (e){
      console.warn('[ig] image fetch error:', (e && e.message) || e);
    }
  }

  const prompt = [
    'You are a Korean fashion magazine editor at PAP Magazine.',
    'Convert the following Instagram post into a published-quality bilingual (Korean + English) article.',
    '',
    'Output format (ONLY a JSON object, no markdown fences, no prose):',
    '{',
    '  "title_ko": "(짧고 강렬한 한국어 제목, 30자 이내, 마침표 없이)",',
    '  "title_en": "Short impactful English title, no period",',
    '  "body_ko": "(존댓말, 3~5단락 4~6문장. 각 단락은 두 줄 빈 줄로 구분. <br><br>로 단락 구분. HTML 인라인 태그만 사용 가능.)",',
    '  "body_en": "Same structure as body_ko in English. 3-5 paragraphs separated by <br><br>.",',
    '  "category": "Fashion | Beauty | Culture | News | Editorial",  // 가장 적합한 것 1개',
    '',
    'IMPORTANT — category "Editorial" is reserved for fashion-editorial CREDIT posts:',
    'a photo spread announcement whose caption is mostly a credits list',
    '(Photographer/Stylist/Starring/@handles) rather than news content.',
    'If this post is such an editorial credit post, set category to "Editorial"',
    '(the system will skip importing it — editorials are uploaded separately).',
    'Otherwise NEVER use "Editorial".',
    '  "tags": ["5-10 lowercase keyword tags"],',
    '  "slug": "english-url-friendly-slug-from-title",',
    '  "faq": [  // AEO: 독자가 검색엔진/AI에 실제로 물어볼 자연어 질문 3개 (한국어)',
    '    {"q": "자연어 질문 (예: 발렌시아가 2026 쿠튀르 쇼는 어디서 열렸나요?)",',
    '     "a": "질문에 대한 자기완결형 직접 답변 20~60단어. 답을 먼저 말하고 근거를 붙일 것. 기사 본문에 없는 사실 금지."}',
    '  ]',
    '}',
    '',
    'Article rules:',
    '- DO NOT just translate the caption. Expand it into a proper magazine article.',
    '- Body must read as standalone journalism — no "this Instagram post" references.',
    '- Body should be 400~800 characters (KR) / 250~500 words (EN).',
    '- Cite brand/designer names when visible in the images.',
    '- Stay neutral-positive editorial tone, not promotional.',
    '',
    'Instagram post metadata:',
    '- Author: @' + (post.author || 'pap_magazine'),
    '- Permalink: ' + (post.permalink || '(none)'),
    '- Original caption: """',
    String(post.caption || '(no caption)').slice(0, 4000),
    '"""',
  ].join('\n');

  visionBlocks.push({ type: 'text', text: prompt });

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 3000,
      messages: [{ role: 'user', content: visionBlocks }],
    }),
  });
  if (!apiRes.ok){
    const body = await apiRes.text().catch(() => '');
    throw new Error('Claude API 실패 (' + apiRes.status + '): ' + body.slice(0, 300));
  }
  const j = await apiRes.json();
  let raw = '';
  try { raw = String(j.content[0].text || '').trim(); }
  catch (_) { throw new Error('Claude 응답 형식 이상.'); }
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_){
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (_) {} }
    if (!parsed) throw new Error('Claude 응답 JSON 파싱 실패.');
  }
  return {
    title_ko: String(parsed.title_ko || '').trim(),
    title_en: String(parsed.title_en || '').trim(),
    body_ko:  String(parsed.body_ko  || '').trim(),
    body_en:  String(parsed.body_en  || '').trim(),
    category: String(parsed.category || 'News').trim(),
    tags:     Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).toLowerCase().replace(/^#+/, '').trim()).filter(Boolean).slice(0, 10) : [],
    slug:     String(parsed.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || null,
    // AEO FAQ (2026-07-16) — {q,a} 검증 후 최대 5개
    faq: Array.isArray(parsed.faq)
      ? parsed.faq
          .filter((f) => f && typeof f.q === 'string' && typeof f.a === 'string' && f.q.trim() && f.a.trim())
          .map((f) => ({ q: String(f.q).trim().slice(0, 200), a: String(f.a).trim().slice(0, 600) }))
          .slice(0, 5)
      : [],
  };
}

// IG CDN 이미지를 Supabase Storage('media' 버킷)로 복사해 영구 URL 배열 반환.
// IG CDN URL 은 수일 내 만료되므로 웹사이트 썸네일·틱톡 게시 모두 영구본 필수.
// 개별 실패는 건너뛰고 성공분만 반환 — 전량 실패 시 빈 배열 (호출부 fallback).
async function archiveImagesToStorage(post, max, prefix){
  const { supabaseAdmin } = require('./supabase');
  const out = [];
  const dir = prefix || 'ig-articles'; // 페퍼릿 등 브랜드별 분리 저장 가능
  const urls = (post.mediaUrls || []).slice(0, max || 10);
  for (let i = 0; i < urls.length; i++){
    try {
      const r = await fetch(urls[i], { signal: AbortSignal.timeout(20000) });
      if (!r.ok){ console.warn('[ig-archive] fetch ' + r.status + ':', urls[i]); continue; }
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!/^image\//.test(ct)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = ct === 'image/png' ? 'png' : (ct === 'image/webp' ? 'webp' : 'jpg');
      const path = dir + '/' + String(post.id || 'unknown') + '/' + i + '.' + ext;
      const { error } = await supabaseAdmin.storage.from('media')
        .upload(path, buf, { contentType: ct, upsert: true });
      if (error){ console.warn('[ig-archive] upload 실패:', error.message); continue; }
      const { data } = supabaseAdmin.storage.from('media').getPublicUrl(path);
      if (data && data.publicUrl) out.push(data.publicUrl);
    } catch (e){
      console.warn('[ig-archive] error:', (e && e.message) || e);
    }
  }
  return out;
}

// 릴스/영상 원본을 Storage 로 영구 복사 (IG CDN 영상 URL 도 수일 내 만료).
// 60MB 초과 파일은 서버리스 메모리·시간 한도 보호를 위해 건너뛴다.
async function archiveVideosToStorage(post, max, prefix){
  const { supabaseAdmin } = require('./supabase');
  const out = [];
  const dir = prefix || 'ig-articles';
  const urls = (post.videoUrls || []).slice(0, max || 2);
  for (let i = 0; i < urls.length; i++){
    try {
      const r = await fetch(urls[i], { signal: AbortSignal.timeout(45000) });
      if (!r.ok){ console.warn('[ig-video] fetch ' + r.status); continue; }
      const ct = (r.headers.get('content-type') || 'video/mp4').split(';')[0];
      if (!/^video\//.test(ct) && !/octet-stream/.test(ct)) continue;
      const len = parseInt(r.headers.get('content-length') || '0', 10);
      if (len > 60 * 1024 * 1024){ console.warn('[ig-video] 60MB 초과 스킵'); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 60 * 1024 * 1024) continue;
      const path = dir + '/' + String(post.id || 'unknown') + '/v' + i + '.mp4';
      const { error } = await supabaseAdmin.storage.from('media')
        .upload(path, buf, { contentType: 'video/mp4', upsert: true });
      if (error){ console.warn('[ig-video] upload 실패:', error.message); continue; }
      const { data } = supabaseAdmin.storage.from('media').getPublicUrl(path);
      if (data && data.publicUrl) out.push(data.publicUrl);
    } catch (e){
      console.warn('[ig-video] error:', (e && e.message) || e);
    }
  }
  return out;
}

// articles INSERT용 row 구성 (DB 컬럼 명에 맞춰서).
function buildArticleRow(post, generated, opts){
  opts = opts || {};
  const status = opts.status || 'draft';
  // 영구 저장본(archiveImagesToStorage) 우선, 실패 시 IG CDN 원본 fallback.
  const archived = Array.isArray(opts.archivedUrls) ? opts.archivedUrls : [];
  const imgs = archived.length ? archived : (post.mediaUrls || []);
  return {
    // published 로 바로 내보낼 때는 게시일 필수 (목록·RSS·사이트맵이 published_date 정렬)
    published_date: status === 'published'
      ? (post.timestamp || new Date().toISOString())
      : null,
    gallery: imgs,
    videos: Array.isArray(opts.videoUrls) ? opts.videoUrls : [],
    title: generated.title_ko || generated.title_en || ('Instagram post ' + post.id),
    title_en: generated.title_en || null,
    content: generated.body_ko || '',
    content_en: generated.body_en || null,
    category: generated.category || 'News',
    tags: generated.tags || [],
    slug: generated.slug || null,
    // AEO FAQ (083) — 빈 배열이면 null (스키마 미노출)
    faq: (Array.isArray(generated.faq) && generated.faq.length) ? generated.faq : null,
    thumbnail_url: imgs[0] || null,
    status: status,
    // QA #275 — Instagram 소스 메타.
    source_instagram_url:     post.permalink || null,
    source_instagram_post_id: post.id || null,
    // 원본 IG media_type — YouTube Shorts 크론이 VIDEO(릴스)만 골라내는 데 사용.
    source_media_type:        post.mediaType || null,
    instagram_imported_at:    new Date().toISOString(),
  };
}

module.exports = {
  listRecentMedia,
  listMediaPaged,
  fetchInstagramPost,
  generateArticleFromPost,
  buildArticleRow,
  archiveImagesToStorage,
  archiveVideosToStorage,
  isLikelyEditorialCaption,
  normalizeMedia: _normalizeMedia,
  _extractShortcode,
};
