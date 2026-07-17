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

// B-5 (2026-07) — 모든 초안 하단 IG 유도 블록.
// 링크는 /api/ig-out?src=naverblog 경유(절대 URL — 블로그 본문은 상대경로 불가)로
// 유입을 계측한다. 네이버는 외부링크에 관대하지 않으므로 이 블록의 링크는
// 2개 이내(원본 게시물 + 프로필)로 유지한다.
const IG_OUT = 'https://www.pap-magazine.com/api/ig-out';
function igCtaBlock(sourceIgUrl, igHandle, kindWord) {
  const handle = String(igHandle || '@pap_magazine');
  const profileOut = IG_OUT + '?src=naverblog&to=profile&url='
    + encodeURIComponent('https://www.instagram.com/' + handle.replace('@', '') + '/');
  let html = '';
  if (sourceIgUrl && /instagram\.com/.test(String(sourceIgUrl))) {
    const postOut = IG_OUT + '?src=naverblog&to=post&url='
      + encodeURIComponent(String(sourceIgUrl).split('?')[0]);
    html += '<p>이 ' + kindWord + '의 원본 게시물과 비하인드는 <a href="' + postOut
      + '">인스타그램에서</a> 보실 수 있어요.</p>';
  }
  html += '<p>매일 업데이트되는 에디토리얼과 셀럽 소식은 인스타그램 <a href="' + profileOut
    + '">' + handle + '</a>에서 가장 먼저 만나보세요 💌</p>';
  return html;
}

// QA #351 — 체류형 포스팅 프레임워크(내부 지침).
// Claude가 프롬프트 안에서 5개 후보를 저울질한 뒤 "반응이 가장 좋을" 하나만
// 최종 응답에 담도록 지시하는 지침 문자열. 응답 스키마는 title/body_html/tags 만.
// 심리 트리거 4종(놀라움/공감/불안/욕망), 훅 3문장, 공감→정보→사례→정리 흐름,
// 체크리스트, 부드러운 CTA는 모두 body_html 안에 자연스럽게 녹여넣는다.
const FRAMEWORK_BLOCK = [
  '',
  '━ 체류형 포스팅 프레임워크 (내부 저울질 후 최고 1개만 응답) ━',
  '너는 최종 응답에 담기 전에 아래 5가지를 머릿속으로 각각 5개씩 만들어보고,',
  '"네이버 검색 상위 노출 + 체류시간"이 가장 잘 나올 조합 1개만 골라 반환한다.',
  '',
  '1) 제목 (title): 후보 5개를 만들어보고 그 중 최고 1개만 반환.',
  '   • 25~35자, 핵심 키워드(브랜드·인물·이슈) 앞배치',
  '   • 감정 트리거 4종 중 콘텐츠에 가장 맞는 것 선택: 놀라움 · 공감 · 불안 · 욕망',
  '   • 패션·에디토리얼은 놀라움 · 욕망 · 공감이 반응 좋음. 뉴스는 놀라움 · 불안이 좋음.',
  '   • 낚시성 과장 금지, 자연스러운 한국어',
  '',
  '2) 도입부 훅 (body_html 첫 문단): 후보 5개를 만들어보고 최고 3문장을 첫 <p>에 배치.',
  '   • "여러분", "혹시" 같은 대화 시작어 활용 가능',
  '   • 스크롤 이탈을 막는 강한 첫 문장',
  '',
  '3) 본문 흐름 (body_html): 공감 → 정보 → 사례 → 정리 4구간.',
  '   • h3 소제목 2~4개, 각 문단 1~3문장으로 짧게',
  '   • [IMG1] [IMG2] ... 마커를 자연스러운 위치에 (사용 가능한 이미지 수만큼)',
  '   • 이모지는 전체 최대 3개',
  '',
  '4) 마무리 체크리스트 (body_html 끝부분에 <h3>오늘의 체크리스트</h3><ul>...): 5개 항목.',
  '   • 각 30자 이내, 오늘 바로 실행할 수 있는 문장',
  '',
  '5) 부드러운 CTA (체크리스트 아래 <p><em>...</em></p> 한 줄): 댓글 유도 톤.',
  '   • "궁금한 점이 있다면 댓글로 남겨주세요" 같은 결. 강매·과장 X.',
  '',
  '※ 시스템이 자동으로 뒤에 원문 링크 + 인스타 CTA + 저작권 라인을 붙이므로',
  '  body_html에는 URL을 직접 넣지 말 것.',
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '',
].join('\n');

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
    '너는 ' + b.name + ' 의 네이버 블로그 에디터다. 아래 웹사이트 기사를 네이버 블로그 상위 노출 + 체류형 포스팅으로 재구성하라.',
    '',
    '기본 원칙:',
    '1) 원문 복사 금지 — 네이버 저품질(중복 콘텐츠) 방지를 위해 문장·구성을 새로 쓸 것.',
    '2) 톤: ' + toneGuide,
    '3) 상위 노출 상위 글 패턴을 반영: 검색 친화 키워드 앞배치, 감정 트리거 활용, 스크롤 이탈을 막는 짧은 문단.',
    '4) 본문 전체 길이 600~1000자. 사용 가능한 이미지 ' + gallery.length + '장. [IMGn] 마커 순서대로.',
    '5) 태그 10개 (# 없이). 기사 태그 재활용 + 검색량 큰 확장 키워드.',
    '6) 마지막 원문 링크·인스타 CTA는 시스템이 자동 삽입하므로 body_html 안에 URL을 넣지 말 것.',
    FRAMEWORK_BLOCK,
    '기사 제목: ' + art.title,
    '기사 본문: ' + stripHtml(art.content).slice(0, 3000),
    '기사 태그: ' + JSON.stringify(art.tags || []),
    '',
    '아래 JSON 스키마로만 응답하라. 마크다운 fence 금지. 반드시 이 3개 필드만:',
    '{',
    '  "title": "내부 저울질을 거쳐 최종 선택한 제목 1개 (25~35자)",',
    '  "body_html": "<p>훅 3문장</p><h3>공감/정보</h3><p>...[IMG1]...</p><h3>사례</h3><p>...[IMG2]...</p><h3>정리</h3><p>...</p><h3>오늘의 체크리스트</h3><ul><li>...</li> × 5</ul><p><em>부드러운 CTA 한 줄</em></p>",',
    '  "tags": ["...", ... 총 10개]',
    '}',
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
  // QA #351 — 체크리스트 + CTA는 프롬프트가 body_html 안에 직접 넣도록 지시했음.
  // 시스템은 원문 링크 + 인스타 CTA 블록만 뒤에 붙인다.
  body += '<p>&nbsp;</p><p>전체 기사와 더 많은 이미지는 <a href="' + artUrl + '">' + b.name +
    ' 원문</a>에서 보실 수 있어요.</p>' +
    igCtaBlock(art.source_instagram_url, b.ig, '소식');

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
    '아래 PAP매거진 에디토리얼(패션 화보)을 네이버 블로그 상위 노출 + 체류형 포스팅으로 재구성하라.',
    '',
    '기본 원칙:',
    '1) 원문 description 그대로 복사 금지 — 문장·구성을 새로 쓸 것.',
    '2) 톤: 패션·아트에 관심 있는 20-30대 독자에게 말하듯 세련되고 친근한 해요체. 매거진의 격은 유지.',
    '3) 본문 구조는 다음 3개 h3 소제목 순서를 유지: "무드와 컨셉" → "룩과 스타일링" → "크레딧".',
    '   "크레딧" 아래에는 아래 crediting 라인을 그대로 리스트(<ul><li>)로 넣을 것 (변형 금지, 인스타 @핸들 유지).',
    '4) 본문 전체 600~1000자. 사용 가능한 이미지 ' + gallery.length + '장. [IMGn] 마커 순서대로. 첫 이미지는 인트로 아래.',
    '5) 태그 10개 (# 없이). 필수 포함: PAP매거진, 패션에디토리얼, 패션화보. 나머지는 검색량 큰 확장 키워드.',
    '6) 원문 링크·인스타 CTA·저작권 라인은 시스템이 자동 삽입하므로 body_html에 URL을 넣지 말 것.',
    '7) 패션 에디토리얼 특성상 심리 트리거는 놀라움 · 욕망 · 공감이 잘 먹힘 (불안 최소화).',
    FRAMEWORK_BLOCK,
    '에디토리얼 제목: ' + ed.title + (ed.title_en ? ' / ' + ed.title_en : ''),
    '발행호: ' + (ed.issue || '-'),
    '에디토리얼 설명(원문): ' + descKo.slice(0, 2000),
    '크레딧 라인:',
    creditLines.length ? creditLines.map(l => '  - ' + l).join('\n') : '  - (없음)',
    '기존 태그: ' + JSON.stringify(ed.tags || []),
    '',
    '아래 JSON 스키마로만 응답하라. 마크다운 fence 금지. 반드시 이 3개 필드만:',
    '{',
    '  "title": "내부 저울질을 거쳐 최종 선택한 제목 1개 (25~35자, 브랜드·컨셉 키워드 앞배치)",',
    '  "body_html": "<p>인트로 훅 3문장</p>[IMG1]<h3>무드와 컨셉</h3><p>...[IMG2]...</p><h3>룩과 스타일링</h3><p>...[IMG3]...</p><h3>크레딧</h3><ul><li>...</li></ul><h3>오늘의 체크리스트</h3><ul><li>...</li> × 5</ul><p><em>부드러운 CTA 한 줄</em></p>",',
    '  "tags": ["PAP매거진", "패션에디토리얼", "패션화보", ... 총 10개]',
    '}',
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
  // QA #351 — 체크리스트 + CTA는 프롬프트가 body_html 안에 직접 포함하도록 지시.
  // 시스템은 원문 링크 + 인스타 CTA + 저작권 라인만 뒤에 붙인다.
  body += '<p>&nbsp;</p><p>전체 화보와 더 많은 컷은 <a href="' + url + '">' + b.name +
    ' 웹사이트</a>에서 만나보실 수 있어요.</p>' +
    igCtaBlock(ed.source_instagram_url, b.ig, '화보') +
    '<p style="color:#888;font-size:12px">ⓒ PAP MAGAZINE (PAP매거진) — 무단 전재 및 재배포 금지</p>';

  return {
    title: draft.title || ed.title,
    tags: Array.isArray(draft.tags) ? draft.tags.slice(0, 10) : [],
    body_html: body,
    images: gallery,
    article_url: url,
  };
}

// slug 하나로 원본 조회 → 초안 생성 (기사/에디토리얼 자동 분기).
// ?slug= 단건 경로와 generate_next 일괄 경로가 공유한다.
async function generateBySlug(brand, kind, slug) {
  const b = SITES[brand];
  if (kind === 'editorial') {
    const { data: ed, error } = await supabaseAdmin
      .from('editorials')
      .select('id, title, title_en, slug, description, description_en, cover_image, gallery, credits, issue, published_date, tags, source_instagram_url')
      .eq('slug', slug).eq('status', 'published')
      .limit(1).maybeSingle();
    if (error || !ed) throw new Error('에디토리얼을 찾지 못함: ' + slug);
    const draft = await generateEditorialDraft(ed, brand);
    return { draft, sourceId: ed.id };
  }
  let sel = supabaseAdmin.from(b.table)
    .select('id, title, slug' + (brand === 'pap' ? ', custom_url' : '') + ', content, tags, gallery, thumbnail_url, source_instagram_url')
    .eq('status', 'published');
  sel = brand === 'pap'
    ? sel.or('custom_url.eq.' + slug + ',slug.eq.' + slug)
    : sel.eq('slug', slug);
  const { data: art, error } = await sel.limit(1).single();
  if (error || !art) throw new Error('기사를 찾지 못함: ' + slug);
  const draft = await generateDraft(art, brand);
  return { draft, sourceId: art.id };
}

// 최근 발행 콘텐츠 중 아직 초안이 없는 첫 건의 slug 를 찾는다.
// recent = [{ slug, id }] 최신순, doneSet = 이미 초안 있는 slug 집합.
async function _recentPublished(brand, kind, limit) {
  const b = SITES[brand];
  if (kind === 'editorial') {
    const { data } = await supabaseAdmin.from('editorials')
      .select('id, slug').eq('status', 'published').not('slug', 'is', null)
      .order('published_date', { ascending: false }).limit(limit);
    return (data || []).map((r) => ({ slug: r.slug, id: r.id })).filter((r) => r.slug);
  }
  const { data } = await supabaseAdmin.from(b.table)
    .select('id, slug' + (brand === 'pap' ? ', custom_url' : ''))
    .eq('status', 'published').order('published_date', { ascending: false }).limit(limit);
  return (data || [])
    .map((r) => ({ slug: brand === 'pap' ? (r.custom_url || r.slug) : r.slug, id: r.id }))
    .filter((r) => r.slug);
}

// 재사용 함수 — "다음 미전환 콘텐츠 1건을 네이버 초안으로 생성·저장".
// 관리자 generate_next 경로와 크론(naver-draft-sweep)이 공유한다.
// 반환: { done, remaining, draft, slug } — done=true 면 미전환 콘텐츠 없음.
async function generateNext(brand, kind) {
  const recent = await _recentPublished(brand, kind, 40);
  const { data: done } = await supabaseAdmin.from('naver_blog_drafts')
    .select('source_slug').eq('brand', brand).eq('kind', kind);
  const doneSet = new Set((done || []).map((d) => d.source_slug));
  const pending = recent.filter((r) => !doneSet.has(r.slug));
  if (!pending.length) return { done: true, remaining: 0, draft: null, slug: null };
  const next = pending[0];
  const { draft, sourceId } = await generateBySlug(brand, kind, next.slug);
  const { data: saved, error: sErr } = await supabaseAdmin.from('naver_blog_drafts')
    .upsert({
      brand, kind, source_slug: next.slug, source_id: String(sourceId || ''),
      title: draft.title, body_html: draft.body_html,
      tags: draft.tags || [], image_urls: draft.images || [],
      article_url: draft.article_url, status: 'draft',
    }, { onConflict: 'brand,kind,source_slug' })
    .select('id').single();
  if (sErr) throw sErr;
  return { done: false, remaining: pending.length - 1, draft: { id: saved.id, ...draft }, slug: next.slug };
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

    // ── 큐 조회: 미발행(draft) 초안 목록 ──
    if (q.queue === '1') {
      const { data, error } = await supabaseAdmin.from('naver_blog_drafts')
        .select('id, title, source_slug, article_url, tags, status, created_at')
        .eq('brand', brand).eq('kind', kind).eq('status', 'draft')
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return res.status(200).json({ brand, kind, queue: data || [] });
    }

    // ── 저장된 초안 단건 조회 (큐에서 열기) ──
    if (q.stored === '1' && q.id) {
      const { data, error } = await supabaseAdmin.from('naver_blog_drafts')
        .select('*').eq('id', String(q.id)).maybeSingle();
      if (error || !data) return res.status(404).json({ error: '저장된 초안을 찾지 못함' });
      return res.status(200).json({
        brand: data.brand, kind: data.kind, id: data.id, title: data.title,
        tags: data.tags || [], body_html: data.body_html,
        images: data.image_urls || [], article_url: data.article_url,
      });
    }

    // ── 상태 변경: 발행 완료(posted) / 건너뛰기(skipped) ──
    if (q.set_status && q.id) {
      const st = q.set_status === 'posted' ? 'posted' : q.set_status === 'skipped' ? 'skipped' : null;
      if (!st) return res.status(400).json({ error: 'set_status 는 posted|skipped' });
      const { error } = await supabaseAdmin.from('naver_blog_drafts')
        .update({ status: st, posted_at: st === 'posted' ? new Date().toISOString() : null })
        .eq('id', String(q.id));
      if (error) throw error;
      return res.status(200).json({ ok: true, id: q.id, status: st });
    }

    // ── 일괄: 아직 초안 없는 최신 발행 1건을 생성·저장 (1요청 1건, 120s 내) ──
    if (q.generate_next === '1') {
      const r = await generateNext(brand, kind);
      if (r.done) {
        return res.status(200).json({ brand, kind, done: true, remaining: 0, message: '미전환 콘텐츠가 없습니다. 최근 발행분 모두 초안 생성 완료.' });
      }
      return res.status(200).json({ brand, kind, generated: true, remaining: r.remaining, draft: r.draft });
    }

    if (!q.slug) return res.status(400).json({ error: '?slug= / ?list=1 / ?queue=1 / ?generate_next=1 필요' });

    // ── 단건 온디맨드 생성 (?slug=) ──
    const { draft } = await generateBySlug(brand, kind, q.slug);
    return res.status(200).json({ brand, kind, ...draft });
  } catch (e) {
    console.error('[naver-blog-draft] error:', e);
    return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) });
  }
};

// 크론 재사용을 위한 export (핸들러 함수 객체에 속성으로 부착)
module.exports.generateNext = generateNext;
