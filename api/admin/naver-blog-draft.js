/**
 * GET /api/admin/naver-blog-draft — 네이버 블로그 초안 생성기 (관리자 전용)
 *
 * 네이버는 2020년 5월 글쓰기 API를 종료해 자동 발행이 불가능하다.
 * 대신 발행 직전까지를 자동화한다: 기사 → 네이버 블로그 톤으로 재작성
 * (중복 콘텐츠 저품질 방지를 위해 원문과 다른 구성·문장) → 관리자가
 * /naver-blog 페이지에서 복사 → 블로그 에디터에 붙여넣기 → 발행.
 *
 *   ?list=1&brand=pap|pepperit&kind=article|editorial   최근 발행 30건 목록
 *   ?slug=<slug>&brand=pap|pepperit&kind=article|editorial   해당 콘텐츠 초안 생성
 *
 * kind:
 *   article    (기본) articles 테이블 (PAP) 또는 pepperit_articles (페퍼릿)
 *   editorial  editorials 테이블 (PAP만 지원, 페퍼릿 요청 시 오류)
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

// QA #346 — 에디토리얼 초안 생성기 (PAP 전용).
// 아티클과 스키마가 달라(description/gallery/credits 중심, content HTML 없음)
// 별도 프롬프트로 처리한다.
async function generateEditorialDraft(ed, brand) {
  if (brand !== 'pap') throw new Error('에디토리얼은 PAP만 지원합니다.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수 누락.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const b = SITES.pap;
  const url = b.site + '/editorial/' + encodeURIComponent(ed.slug);
  // 커버 + 갤러리 병합 후 최대 6장. 이후 프롬프트 [IMGn] 마커로 치환.
  const galleryRaw = Array.isArray(ed.gallery) ? ed.gallery.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)) : [];
  const cover = ed.cover_image && /^https?:\/\//.test(ed.cover_image) ? ed.cover_image : (galleryRaw[0] || '');
  const gallery = [cover, ...galleryRaw.filter(g => g !== cover)].filter(Boolean).slice(0, 6);

  // 크레딧 텍스트 정리 (naver-blog-kit.js와 동일 형태)
  let creditLines = [];
  try {
    const cr = ed.credits;
    if (Array.isArray(cr)) {
      creditLines = cr.map(c => {
        const roles = Array.isArray(c.roles) ? c.roles.join(' & ') : (c.role || '');
        const who = c.name || c.instagram || '';
        return roles && who ? roles + ' — ' + who : (who || roles);
      }).filter(Boolean);
    } else if (cr && typeof cr === 'object') {
      creditLines = Object.keys(cr).map(k => {
        const v = cr[k];
        const who = typeof v === 'string' ? v : (v && (v.name || v.instagram)) || '';
        return who ? k + ' — ' + who : '';
      }).filter(Boolean);
    }
  } catch (_) {}

  const descKo = stripHtml(ed.description) || stripHtml(ed.description_en) || '';

  const prompt = [
    '너는 ' + b.name + '(PAP매거진) 의 네이버 블로그 에디터다.',
    '아래 PAP매거진 에디토리얼(패션 화보)을 네이버 블로그 글로 재구성하라.',
    '',
    '중요 원칙:',
    '1) 원문 description을 그대로 복사하지 말 것 — 네이버 저품질(중복 콘텐츠) 방지를 위해 문장·구성을 새로 쓸 것.',
    '2) 톤: 패션·아트에 관심 있는 20-30대 독자에게 말하듯 세련되고 친근한 해요체. 매거진의 격은 유지.',
    '3) 제목: 네이버 검색 친화 — "브랜드/모델/컨셉 키워드 + 매거진 에디토리얼" 조합, 25~35자.',
    '4) 본문 구조: 훅 인트로(2~3문장) → 소제목(h3) "무드와 컨셉" / "룩과 스타일링" / "크레딧" 3개 → 마무리 문장. 전체 600~1000자.',
    '5) 본문 중간 [IMG1] [IMG2] ... 마커를 자연스러운 위치에 배치 (사용 가능한 이미지 ' + gallery.length + '장). 첫 이미지는 인트로 아래.',
    '6) "크레딧" 소제목 아래에는 아래 crediting 라인을 그대로 리스트로 넣을 것 (변형 금지, 인스타 계정은 살릴 것).',
    '7) 마지막에 원문 링크 안내와 인스타그램 팔로우 유도 문장을 각 1문장 포함. 링크 URL 자체는 넣지 말 것(코드가 삽입).',
    '8) 태그: 네이버 검색용 태그 10개 (# 없이). 필수 포함: PAP매거진, 패션에디토리얼, 패션화보.',
    '',
    '에디토리얼 제목: ' + ed.title + (ed.title_en ? ' / ' + ed.title_en : ''),
    '발행호: ' + (ed.issue || '-'),
    '에디토리얼 설명(원문): ' + descKo.slice(0, 2000),
    '크레딧 라인:',
    creditLines.length ? creditLines.map(l => '  - ' + l).join('\n') : '  - (없음)',
    '기존 태그: ' + JSON.stringify(ed.tags || []),
    '',
    '아래 JSON 형식으로만 응답하라:',
    '{"title": "...", "body_html": "<p>...</p><h3>무드와 컨셉</h3><p>...[IMG1]...</p>...", "tags": ["...", ...]}',
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
      max_tokens: 2800,
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
  gallery.forEach((imgUrl, i) => {
    body = body.replace('[IMG' + (i + 1) + ']',
      '</p><p style="text-align:center"><img src="' + imgUrl + '" style="max-width:100%" alt="' +
      String(ed.title).replace(/"/g, '') + ' 화보 ' + (i + 1) + ' — PAP매거진"></p><p>');
  });
  body = body.replace(/\[IMG\d+\]/g, '');
  // 원문 링크 + 인스타 CTA + 저작권 라인
  body += '<p>&nbsp;</p><p>전체 화보와 더 많은 컷은 <a href="' + url + '">' + b.name +
    ' 웹사이트</a>에서 만나보실 수 있어요.</p>' +
    '<p>매일 업데이트되는 에디토리얼과 셀럽 소식은 인스타그램 <a href="https://www.instagram.com/' +
    b.ig.replace('@', '') + '/">' + b.ig + '</a>에서 가장 먼저 확인하세요 💌</p>' +
    '<p style="color:#888;font-size:12px">ⓒ PAP MAGAZINE (PAP매거진) — 무단 전재 및 재배포 금지</p>';

  return {
    title: draft.title || ed.title,
    tags: Array.isArray(draft.tags) ? draft.tags.slice(0, 10) : [],
    body_html: body,
    images: gallery,
    article_url: url,
  };
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const q = req.query || {};
  const brand = q.brand === 'pepperit' ? 'pepperit' : 'pap';
  const kind = q.kind === 'editorial' ? 'editorial' : 'article';
  const b = SITES[brand];

  try {
    // QA #346 — 에디토리얼 모드는 PAP 전용
    if (kind === 'editorial' && brand !== 'pap') {
      return res.status(400).json({ error: '페퍼릿은 에디토리얼을 지원하지 않습니다.' });
    }

    if (q.list === '1') {
      if (kind === 'editorial') {
        // 에디토리얼 리스트
        const { data, error } = await supabaseAdmin
          .from('editorials')
          .select('id, title, slug, cover_image, published_date, issue')
          .eq('status', 'published')
          .not('slug', 'is', null)
          .order('published_date', { ascending: false })
          .limit(30);
        if (error) throw error;
        // 프론트 UI 호환 위해 articles 배열 키 유지 (thumbnail_url/category 필드로 매핑)
        const articles = (data || []).map(e => ({
          id: e.id, title: e.title, slug: e.slug,
          thumbnail_url: e.cover_image || '',
          published_date: e.published_date,
          category: e.issue ? String(e.issue) : 'Editorial',
        }));
        return res.status(200).json({ brand, kind, articles });
      }
      const { data, error } = await supabaseAdmin
        .from(b.table)
        .select('id, title, slug' + (brand === 'pap' ? ', custom_url' : '') + ', thumbnail_url, published_date, category')
        .eq('status', 'published')
        .order('published_date', { ascending: false })
        .limit(30);
      if (error) throw error;
      return res.status(200).json({ brand, kind, articles: data || [] });
    }

    if (!q.slug) return res.status(400).json({ error: '?slug= 또는 ?list=1 필요' });

    if (kind === 'editorial') {
      // 에디토리얼 단건 → 초안
      const { data: ed, error } = await supabaseAdmin
        .from('editorials')
        .select('id, title, title_en, slug, description, description_en, cover_image, gallery, credits, issue, published_date, tags')
        .eq('slug', q.slug).eq('status', 'published')
        .limit(1).maybeSingle();
      if (error || !ed) return res.status(404).json({ error: '에디토리얼을 찾지 못함: ' + q.slug });
      const draft = await generateEditorialDraft(ed, brand);
      return res.status(200).json({ brand, kind, ...draft });
    }

    let sel = supabaseAdmin.from(b.table)
      .select('id, title, slug' + (brand === 'pap' ? ', custom_url' : '') + ', content, tags, gallery, thumbnail_url')
      .eq('status', 'published');
    sel = brand === 'pap'
      ? sel.or('custom_url.eq.' + q.slug + ',slug.eq.' + q.slug)
      : sel.eq('slug', q.slug);
    const { data: art, error } = await sel.limit(1).single();
    if (error || !art) return res.status(404).json({ error: '기사를 찾지 못함: ' + q.slug });

    const draft = await generateDraft(art, brand);
    return res.status(200).json({ brand, kind, ...draft });
  } catch (e) {
    console.error('[naver-blog-draft] error:', e);
    return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) });
  }
};
