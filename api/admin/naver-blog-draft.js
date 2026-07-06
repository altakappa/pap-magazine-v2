/**
 * GET /api/admin/naver-blog-draft — 네이버 블로그 초안 생성기 (관리자 전용)
 *
 * 네이버는 2020년 5월 글쓰기 API를 종료해 자동 발행이 불가능하다.
 * 대신 발행 직전까지를 자동화한다: 기사 → 네이버 블로그 톤으로 재작성
 * (중복 콘텐츠 저품질 방지를 위해 원문과 다른 구성·문장) → 관리자가
 * /naver-blog 페이지에서 복사 → 블로그 에디터에 붙여넣기 → 발행.
 *
 *   ?list=1&brand=pap|pepperit   최근 발행 기사 30건 목록
 *   ?slug=<slug>&brand=pap|pepperit   해당 기사 초안 생성
 *
 * 소비자: frontend/naver-blog.html (관리자 도구 페이지)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');

const SITES = {
  pap: { table: 'articles', site: 'https://www.pap-magazine.com', name: 'PAP MAGAZINE', ig: '@pap_magazine' },
  pepperit: { table: 'pepperit_articles', site: 'https://www.pepperitmag.com', name: 'PEPPERIT', ig: '@pepperitmag' },
};

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function generateDraft(art, brand) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수 누락.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const b = SITES[brand];
  const artUrl = b.site + '/article/' + encodeURIComponent(art.custom_url || art.slug || art.id);
  const gallery = (art.gallery || []).slice(0, 6);

  const toneGuide = brand === 'pepperit'
    ? '잘파세대 케이팝 팬에게 말하듯 가볍고 발랄한 해요체. 팬 커뮤니티 감성이지만 과한 인터넷 은어는 자제.'
    : '패션·아트에 관심 있는 20-30대 독자에게 말하듯 세련되고 친근한 해요체. 매거진의 격은 유지.';

  const prompt = [
    '너는 ' + b.name + ' 의 네이버 블로그 에디터다. 아래 웹사이트 기사를 네이버 블로그 글로 재작성하라.',
    '',
    '중요 원칙:',
    '1) 원문을 그대로 복사하지 말 것 — 네이버 저품질(중복 콘텐츠) 방지를 위해 문장·구성·제목을 새로 쓸 것.',
    '2) 톤: ' + toneGuide,
    '3) 제목: 네이버 검색 친화 — 핵심 키워드(인물·브랜드·이벤트명)를 앞쪽에, 20~30자.',
    '4) 본문: 훅 인트로(1~2문장) → 소제목(h3) 2~3개로 나눈 본문 → 마무리 문장. 전체 500~900자.',
    '5) 본문 중간에 [IMG1] [IMG2] ... 마커를 자연스러운 위치에 배치 (제공된 이미지 수만큼, 최대 ' + gallery.length + '개).',
    '6) 마지막에 원문 링크 안내와 인스타그램 팔로우 유도 문장을 각 1문장 포함. 링크 URL 자체는 넣지 말 것(코드가 삽입).',
    '7) 태그: 네이버 검색용 태그 10개 (기사 태그 재활용 + 확장, # 없이).',
    '',
    '기사 제목: ' + art.title,
    '기사 본문: ' + stripHtml(art.content).slice(0, 3000),
    '기사 태그: ' + JSON.stringify(art.tags || []),
    '',
    '아래 JSON 형식으로만 응답하라:',
    '{"title": "...", "body_html": "<p>...</p><h3>...</h3><p>...[IMG1]...</p>", "tags": ["...", ...]}',
  ].join('\n');

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!apiRes.ok) {
    const t = await apiRes.text().catch(() => '');
    throw new Error('Claude API ' + apiRes.status + ': ' + t.slice(0, 200));
  }
  const j = await apiRes.json();
  const text = (j.content && j.content[0] && j.content[0].text) || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude 응답에서 JSON을 찾지 못함.');
  const draft = JSON.parse(m[0]);

  // [IMGn] 마커 → 실제 <img> 치환 + 남는 마커 제거
  let body = String(draft.body_html || '');
  gallery.forEach((url, i) => {
    body = body.replace('[IMG' + (i + 1) + ']',
      '</p><p style="text-align:center"><img src="' + url + '" style="max-width:100%" alt="' +
      String(art.title).replace(/"/g, '') + ' ' + (i + 1) + '"></p><p>');
  });
  body = body.replace(/\[IMG\d+\]/g, '');
  // 원문 링크 + 인스타 CTA 블록
  body += '<p>&nbsp;</p><p>전체 기사와 더 많은 이미지는 <a href="' + artUrl + '">' + b.name +
    ' 원문</a>에서 보실 수 있어요.</p>' +
    '<p>매일 업데이트되는 소식은 인스타그램 <a href="https://www.instagram.com/' +
    b.ig.replace('@', '') + '/">' + b.ig + '</a>에서 가장 먼저 만나보세요 💌</p>';

  return {
    title: draft.title || art.title,
    tags: Array.isArray(draft.tags) ? draft.tags.slice(0, 10) : [],
    body_html: body,
    images: gallery,
    article_url: artUrl,
  };
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const q = req.query || {};
  const brand = q.brand === 'pepperit' ? 'pepperit' : 'pap';
  const b = SITES[brand];

  try {
    if (q.list === '1') {
      const { data, error } = await supabaseAdmin
        .from(b.table)
        .select('id, title, slug' + (brand === 'pap' ? ', custom_url' : '') + ', thumbnail_url, published_date, category')
        .eq('status', 'published')
        .order('published_date', { ascending: false })
        .limit(30);
      if (error) throw error;
      return res.status(200).json({ brand, articles: data || [] });
    }

    if (!q.slug) return res.status(400).json({ error: '?slug= 또는 ?list=1 필요' });
    let sel = supabaseAdmin.from(b.table)
      .select('id, title, slug' + (brand === 'pap' ? ', custom_url' : '') + ', content, tags, gallery, thumbnail_url')
      .eq('status', 'published');
    sel = brand === 'pap'
      ? sel.or('custom_url.eq.' + q.slug + ',slug.eq.' + q.slug)
      : sel.eq('slug', q.slug);
    const { data: art, error } = await sel.limit(1).single();
    if (error || !art) return res.status(404).json({ error: '기사를 찾지 못함: ' + q.slug });

    const draft = await generateDraft(art, brand);
    return res.status(200).json({ brand, ...draft });
  } catch (e) {
    console.error('[naver-blog-draft] error:', e);
    return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) });
  }
};
