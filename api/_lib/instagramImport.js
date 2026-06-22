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
  const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username,children{media_url,media_type}';
  const url = `${_IG_API}/${process.env.IG_USER_ID}/media?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${process.env.IG_ACCESS_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error('Graph API media list 실패 (' + res.status + '): ' + body.slice(0, 300));
  }
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
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
    permalink: m.permalink,
    timestamp: m.timestamp || null,
    author: m.username || 'pap_magazine',
  };
  // 단일 / 캐러셀 / 비디오 케이스 처리.
  if (m.media_type === 'CAROUSEL_ALBUM' && m.children && Array.isArray(m.children.data)){
    m.children.data.forEach((c) => {
      if (c.media_url) out.mediaUrls.push(c.media_url);
    });
  } else if (m.media_url){
    out.mediaUrls.push(m.media_url);
  } else if (m.thumbnail_url){
    out.mediaUrls.push(m.thumbnail_url);
  }
  return out;
}

// Claude API로 IG 게시물을 PAP 매거진 톤의 바이링구얼 기사로 변환.
//   입력: { caption, mediaUrls, author, permalink }
//   출력: { title_ko, title_en, body_ko, body_en, category, tags, slug }
async function generateArticleFromPost(post){
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수 누락.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const visionBlocks = [];
  // 최대 3장의 이미지만 비전 컨텍스트로 사용 (Claude 비용/속도 고려).
  (post.mediaUrls || []).slice(0, 3).forEach((u) => {
    visionBlocks.push({ type: 'image', source: { type: 'url', url: u } });
  });

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
    '  "tags": ["5-10 lowercase keyword tags"],',
    '  "slug": "english-url-friendly-slug-from-title"',
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
  };
}

// articles INSERT용 row 구성 (DB 컬럼 명에 맞춰서).
function buildArticleRow(post, generated, opts){
  opts = opts || {};
  return {
    title: generated.title_ko || generated.title_en || ('Instagram post ' + post.id),
    title_en: generated.title_en || null,
    content: generated.body_ko || '',
    content_en: generated.body_en || null,
    category: generated.category || 'News',
    tags: generated.tags || [],
    slug: generated.slug || null,
    thumbnail: (post.mediaUrls && post.mediaUrls[0]) || null,
    status: opts.status || 'draft',
    // QA #275 — Instagram 소스 메타.
    source_instagram_url:     post.permalink || null,
    source_instagram_post_id: post.id || null,
    instagram_imported_at:    new Date().toISOString(),
  };
}

module.exports = {
  listRecentMedia,
  fetchInstagramPost,
  generateArticleFromPost,
  buildArticleRow,
  _extractShortcode,
};
