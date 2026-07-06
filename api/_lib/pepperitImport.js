/**
 * PEPPERIT(@pepperitmag) — Instagram → 기사 변환 공유 라이브러리
 *
 * PAP 과 달리 페퍼릿 IG 계정은 자체 토큰이 없다 — PAP 비즈니스 계정의
 * business_discovery(공개 조회)로 캡션·이미지·캐러셀 전체를 가져온다
 * (2026-07-06 실측: children{media_url,media_type} 지원 확인).
 *
 * 브랜드 분리 원칙: 페퍼릿 콘텐츠는 pepperit_articles 테이블 + Storage
 * 'media/ig-pepperit/' 경로 + pepperitmag.com 도메인으로 PAP 과 완전 분리.
 *
 * 소비자: api/cron/sync-pepperit.js
 */

const _IG_API = 'https://graph.facebook.com/v25.0';
const PEPPERIT_USERNAME = process.env.PEPPERIT_IG_USERNAME || 'pepperitmag';

/**
 * business_discovery 로 @pepperitmag 최근 미디어 조회 (커서 페이지네이션).
 * @param {{maxCount?: number, sinceDays?: number}} opts
 */
async function listPepperitMedia(opts) {
  const maxCount = (opts && opts.maxCount) || 12;
  const sinceDays = (opts && opts.sinceDays) || 0;
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    throw new Error('IG_ACCESS_TOKEN/IG_USER_ID 환경변수가 설정되어 있지 않습니다.');
  }
  const cutoff = sinceDays > 0 ? Date.now() - sinceDays * 86400000 : 0;
  const out = [];
  let after = '';
  let guard = 0;
  while (out.length < maxCount && guard < 10) {
    guard++;
    const mediaSpec = 'media.limit(25)' + (after ? '.after(' + after + ')' : '') +
      '{caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_url,media_type}}';
    const fields = 'business_discovery.username(' + PEPPERIT_USERNAME + '){' + mediaSpec + '}';
    const url = _IG_API + '/' + process.env.IG_USER_ID +
      '?fields=' + encodeURIComponent(fields) + '&access_token=' + process.env.IG_ACCESS_TOKEN;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('business_discovery 실패 (' + res.status + '): ' + body.slice(0, 300));
    }
    const j = await res.json();
    const media = j.business_discovery && j.business_discovery.media;
    const rows = (media && media.data) || [];
    let reachedCutoff = false;
    for (const m of rows) {
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      if (cutoff && ts && ts < cutoff) { reachedCutoff = true; break; }
      out.push(m);
      if (out.length >= maxCount) break;
    }
    const next = media && media.paging && media.paging.cursors && media.paging.cursors.after;
    if (reachedCutoff || !next || rows.length === 0) break;
    after = next;
  }
  return out;
}

// raw media row → generator 입력 shape (이미지/영상 분리 수집)
function normalizePepperitMedia(m) {
  const mediaUrls = [];
  const videoUrls = []; // 릴스/영상 원본 — 아카이브 후 기사에서 직접 재생
  if (m.media_type === 'CAROUSEL_ALBUM' && m.children && Array.isArray(m.children.data)) {
    m.children.data.forEach((c) => {
      if (!c) return;
      if (c.media_type === 'IMAGE' && c.media_url) mediaUrls.push(c.media_url);
      else if (c.media_type === 'VIDEO' && c.media_url) videoUrls.push(c.media_url);
    });
    // 캐러셀이 전부 영상인 극단 케이스 — 앨범 커버라도 확보
    if (!mediaUrls.length && m.media_url) mediaUrls.push(m.media_url);
  } else if (m.media_type === 'VIDEO') {
    if (m.thumbnail_url) mediaUrls.push(m.thumbnail_url);
    if (m.media_url) videoUrls.push(m.media_url);
  } else if (m.media_url) {
    mediaUrls.push(m.media_url);
  }
  return {
    id: m.id,
    caption: m.caption || '',
    mediaUrls,
    videoUrls,
    permalink: m.permalink || null,
    timestamp: m.timestamp || null,
    author: PEPPERIT_USERNAME,
  };
}

const PEPPERIT_CATEGORIES = ['NEWS', 'LOOK', 'MOMENT', 'SCHEDULE', 'COUPLE', 'NEW FACE', 'PHOTO', 'FAVORITE'];

// Claude 로 페퍼릿 톤 기사 생성 (Z세대 케이팝 데일리 — PAP 과 톤 완전 분리)
async function generatePepperitArticle(post) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수 누락.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const blocks = [];
  for (const u of (post.mediaUrls || []).slice(0, 1)) {
    try {
      const imgRes = await fetch(u, { signal: AbortSignal.timeout(15000) });
      if (!imgRes.ok) continue;
      const mediaType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!/^image\//.test(mediaType)) continue;
      const base64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
    } catch (_) {}
  }

  const prompt = [
    'You are an editor at PEPPERIT (페퍼릿, @pepperitmag) — a Korean daily culture magazine',
    'covering K-POP first, plus fashion·beauty·culture moments, for 잘파세대 (Gen Z + Gen Alpha).',
    'Slogan: "케이팝 · 패션 · 뷰티 · 컬쳐의 모든 순간, 가장 가볍게."',
    'Tone: 발랄하고 가볍고 트렌디한 한국어 존댓말, 친구가 톡으로 전해주는 감각, 팬心 자극,',
    '이모지 아주 절제해서 0~2개. PAP Magazine 과는 완전히 다른 브랜드 — 진지한 아트 비평 톤 금지.',
    '',
    'Convert this Instagram post into a short web article.',
    '',
    'Output ONLY a JSON object (no markdown fences):',
    '{',
    '  "title": "(짧고 후킹한 한국어 제목, 35자 이내, 마침표 없이)",',
    '  "body": "(한국어 2~4단락, 단락당 2~4문장. <br><br> 로 단락 구분. HTML 인라인 태그만.',
    '           캡션 내용을 정리·확장하되 없는 사실은 지어내지 말 것.',
    '           기사 끝에 Let\\u2019s Pepperit. 시그니처 한 줄.)",',
    '  "category": "' + PEPPERIT_CATEGORIES.join(' | ') + '",  // 가장 적합한 것 1개',
    '  "tags": ["5-10 lowercase tags — 아티스트 영문명 포함 (검색 SEO 용)"],',
    '  "slug": "english-url-friendly-slug"',
    '}',
    '',
    'Category guide: NEWS(컴백·발매·수상 소식), LOOK(패션·공항룩·오늘의 룩), MOMENT(무대·예능·일상 순간),',
    'SCHEDULE(일정·예고), COUPLE(케미·조합), NEW FACE(신인), PHOTO(화보·비주얼), FAVORITE(추천·인기).',
    '',
    'Instagram caption: """',
    String(post.caption || '(no caption)').slice(0, 3000),
    '"""',
  ].join('\n');
  blocks.push({ type: 'text', text: prompt });

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 2500, messages: [{ role: 'user', content: blocks }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!apiRes.ok) {
    const body = await apiRes.text().catch(() => '');
    throw new Error('Claude API 실패 (' + apiRes.status + '): ' + body.slice(0, 300));
  }
  const j = await apiRes.json();
  let raw = '';
  try { raw = String(j.content[0].text || '').trim(); } catch (_) { throw new Error('Claude 응답 형식 이상.'); }
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (_) {} }
    if (!parsed) throw new Error('Claude 응답 JSON 파싱 실패.');
  }
  const cat = String(parsed.category || 'NEWS').toUpperCase().trim();
  return {
    title: String(parsed.title || '').trim(),
    body: String(parsed.body || '').trim(),
    category: PEPPERIT_CATEGORIES.includes(cat) ? cat : 'NEWS',
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).toLowerCase().replace(/^#+/, '').trim()).filter(Boolean).slice(0, 10) : [],
    slug: String(parsed.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || null,
  };
}

module.exports = { listPepperitMedia, normalizePepperitMedia, generatePepperitArticle, PEPPERIT_USERNAME };
