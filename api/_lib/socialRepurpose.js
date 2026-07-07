/**
 * PAP Magazine — 소셜 재가공(반자동) 생성기.
 *
 * 샤오홍슈(小红书)·카카오톡 채널은 유튜브/Threads 처럼 공개 자동 게시 API가
 * 없다. 그래서 "자동 생성 + 수동 게시" 방식으로, 기사/에디토리얼을 각 플랫폼
 * 톤에 맞는 제목·본문·해시태그로 변환해 두고 관리자가 복사해 올린다.
 *
 *   generateRepurpose({ platform, title, subtitle, contentText, imageUrls, credits, tags })
 *     → { title, body, hashtags: string[], image_urls: string[], lang }
 *
 * LLM 은 기존 editorialAi.js 와 동일하게 Anthropic Claude 를 쓴다.
 *   env: ANTHROPIC_API_KEY, ANTHROPIC_MODEL(기본 claude-sonnet-4-5)
 * 키가 없거나 호출이 실패하면 원문 기반의 안전한 폴백을 돌려준다(빈 값 아님).
 */

const PLATFORMS = {
  xiaohongshu: {
    lang: 'zh',
    maxImages: 9,
    titleMax: 20,
    hashtagCount: 8,
  },
  kakao: {
    lang: 'ko',
    maxImages: 3,
    titleMax: 40,
    hashtagCount: 5,
  },
};

// gallery 는 URL 문자열 배열이거나 {url:...} 객체 배열일 수 있다. 둘 다 지원.
function extractImageUrls(gallery, limit) {
  const out = [];
  const arr = Array.isArray(gallery) ? gallery : [];
  for (const item of arr) {
    let u = '';
    if (typeof item === 'string') u = item;
    else if (item && typeof item === 'object') u = item.url || item.src || item.image_url || '';
    u = String(u || '').trim();
    if (/^https?:\/\//.test(u) && !out.includes(u)) out.push(u);
    if (limit && out.length >= limit) break;
  }
  return out;
}

// HTML 본문 → 사람이 읽는 평문(모델 입력용). 태그 제거 + 공백 정리 + 길이 제한.
function htmlToText(html, maxLen) {
  let s = String(html || '');
  s = s.replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
       .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const cap = maxLen || 2200;
  return s.length > cap ? s.slice(0, cap) + '…' : s;
}

function creditLine(credits) {
  const arr = Array.isArray(credits) ? credits : [];
  const parts = [];
  for (const c of arr) {
    if (!c) continue;
    const role = String(c.role || '').replace(/_/g, ' ').trim();
    const name = String(c.name || '').trim();
    if (name) parts.push(role ? role + ': ' + name : name);
  }
  return parts.slice(0, 12).join(', ');
}

function _pickText(result) {
  if (!result || !Array.isArray(result.content)) return '';
  const block = result.content.find((b) => b && typeof b.text === 'string');
  return block ? block.text.trim() : '';
}

function _parseJson(text) {
  if (!text) return null;
  const stripped = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(stripped); } catch (_) { return null; }
}

function _cleanTags(tags, count) {
  const out = [];
  const arr = Array.isArray(tags) ? tags : [];
  for (let t of arr) {
    t = String(t || '').trim().replace(/^#+/, '').replace(/\s+/g, '');
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= (count || 8)) break;
  }
  return out;
}

function _systemPrompt(platform, cfg) {
  if (platform === 'xiaohongshu') {
    return [
      '你是 PAP Magazine（一本全球时尚 / 美妆 / 文化杂志）的小红书内容编辑。',
      '你会收到一篇杂志文章的标题、副标题、正文与制作团队名单。',
      '请把它改写成一篇地道的小红书图文笔记文案（简体中文）。',
      '',
      '要求：',
      '  1. "title"：一句抓人的小红书标题，' + cfg.titleMax + '字以内，可用 1-2 个 emoji，制造点击欲但不夸张、不做标题党。',
      '  2. "body"：小红书风格正文。用第一人称、亲切但有品味的编辑口吻；分段、适当换行、少量 emoji；',
      '     介绍这组内容的看点（造型、色调、氛围、概念），最后自然地引导「主页链接看完整故事」。避免空泛的赞美。',
      '  3. "hashtags"：' + cfg.hashtagCount + ' 个小红书用户真的会搜的中文话题词（不带 # 号），例如 "时尚大片" "编辑推荐" "穿搭灵感"。',
      '  4. 保留人名、品牌名、专有名词原样。',
      '',
      '只输出一个 JSON 对象：{"title":"...","body":"...","hashtags":["...","..."]}。不要多余文字，不要 markdown 代码块。',
    ].join('\n');
  }
  // kakao
  return [
    '너는 PAP 매거진(글로벌 패션·뷰티·컬처 매거진)의 카카오톡 채널 콘텐츠 에디터야.',
    '매거진 기사의 제목·부제·본문·제작 크레딧을 받게 돼. 이걸 카카오톡 채널 소식(포스트)용 글로 다시 써줘.',
    '',
    '요구사항:',
    '  1. "title": 카카오 채널 소식 제목 한 줄, ' + cfg.titleMax + '자 이내. 담백하고 매거진다운 톤. 낚시성·느낌표 남발 금지.',
    '  2. "body": 카카오톡 채널 구독자에게 보내는 소식 본문. 친근하지만 品格 있는 에디터 톤, 3~5문장 정도로 짧게.',
    '     이 콘텐츠의 볼거리(무드/스타일/컨셉)를 소개하고, 마지막에 자연스럽게 "프로필 링크에서 전체 보기"로 유도. 뻔한 미사여구 금지.',
    '  3. "hashtags": 한국 사용자가 실제로 검색할 한국어 해시태그 ' + cfg.hashtagCount + '개(# 없이). 예: "패션화보" "에디토리얼" "PAP매거진".',
    '  4. 사람 이름·브랜드명·고유명사는 원문 그대로 유지.',
    '',
    '오직 JSON 객체 하나만 출력: {"title":"...","body":"...","hashtags":["...","..."]}. 다른 말·마크다운 코드블록 금지.',
  ].join('\n');
}

// LLM 실패/미설정 시 폴백 — 원문으로라도 채워 준다.
function _fallback(platform, cfg, { title, subtitle, contentText, tags }) {
  const body = [subtitle, htmlToText(contentText, 500)].filter(Boolean).join('\n\n');
  return {
    title: String(title || '').slice(0, cfg.titleMax),
    body: body || String(title || ''),
    hashtags: _cleanTags(tags && tags.length ? tags
      : (platform === 'xiaohongshu' ? ['时尚大片', '编辑推荐', 'PAPMagazine'] : ['패션화보', '에디토리얼', 'PAP매거진']),
      cfg.hashtagCount),
    lang: cfg.lang,
    _fallback: true,
  };
}

async function generateRepurpose({ platform, title, subtitle, contentText, imageUrls, credits, tags }) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error('Unknown platform: ' + platform);

  const pickedImages = extractImageUrls(imageUrls, cfg.maxImages);

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...(_fallback(platform, cfg, { title, subtitle, contentText, tags })), image_urls: pickedImages };
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const userParts = [
    'Title: ' + String(title || '').trim(),
    subtitle ? 'Subtitle: ' + String(subtitle).trim() : '',
    'Body:\n' + htmlToText(contentText, 2200),
    credits ? 'Credits: ' + creditLine(credits) : '',
    (Array.isArray(tags) && tags.length) ? 'Existing tags: ' + tags.join(', ') : '',
  ].filter(Boolean).join('\n\n');

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system: _systemPrompt(platform, cfg),
        messages: [{ role: 'user', content: userParts }],
      }),
    });
    if (!resp.ok) throw new Error('Claude ' + resp.status);
    const parsed = _parseJson(_pickText(await resp.json())) || {};
    const out = {
      title: String(parsed.title || '').trim().slice(0, cfg.titleMax + 10),
      body: String(parsed.body || '').trim(),
      hashtags: _cleanTags(parsed.hashtags, cfg.hashtagCount),
      image_urls: pickedImages,
      lang: cfg.lang,
    };
    if (!out.title && !out.body) {
      return { ...(_fallback(platform, cfg, { title, subtitle, contentText, tags })), image_urls: pickedImages };
    }
    return out;
  } catch (err) {
    console.error('[socialRepurpose] ' + platform + ' failed:', err && err.message);
    return { ...(_fallback(platform, cfg, { title, subtitle, contentText, tags })), image_urls: pickedImages };
  }
}

module.exports = { generateRepurpose, extractImageUrls, htmlToText, PLATFORMS };
