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

// QA #350 — 체류형 포스팅 프레임워크 공유 블록.
// 5개 프롬프트(주제 검증 / 제목·훅 / 글 구조 / 자동화 / CTA)를
// 아티클·에디토리얼 두 프롬프트가 공통으로 참조한다.
// 심리 트리거 4종: 놀라움, 공감, 불안, 욕망.
const FRAMEWORK_BLOCK = [
  '',
  '━ 체류형 포스팅 프레임워크 ━',
  'A) 제목 5개 후보 (title_candidates)',
  '   • 각 후보에 감정 트리거 라벨(놀라움 / 공감 / 불안 / 욕망) 하나 지정',
  '   • 클릭을 부르는 상위 글 패턴 반영: 핵심 키워드 앞배치, 숫자·물음표·역설 활용',
  '   • 25~35자, 한국어 자연스러움 우선',
  'B) 도입부 훅 5개 (hook_candidates)',
  '   • 각 후보는 첫 3문장 (스크롤 이탈 방지가 목적)',
  '   • 각 후보에 감정 트리거(놀라움/공감/불안/욕망) 라벨',
  '   • "여러분", "혹시" 같은 대화 시작어 활용 가능',
  'C) 본문 흐름 (body_html) — 공감 → 정보 → 사례 → 정리 4구간',
  '   • 문단은 1~3문장으로 짧게. 소제목(h3) 2~4개 사용',
  '   • 스크롤이 끊기지 않게 리듬감 있게. 이모지는 최대 3개',
  '   • [IMG1] [IMG2] ... 마커를 자연스러운 위치에 (사용 가능한 이미지 수만큼)',
  'D) 마무리 체크리스트 5개 (checklist)',
  '   • 독자가 오늘 바로 실행할 수 있는 짧은 문장 (~30자)',
  'E) 부드러운 CTA (cta) — 1~2문장',
  '   • "궁금한 점이 있다면 댓글로 남겨주세요" 톤. 강매 X.',
  'F) 썸네일 문구 후보 5개 (thumbnail_texts)',
  '   • 각 8~14자, 시선을 잡는 짧은 카피',
  '━━━━━━━━━━━━━━━━━━━━━━━━',
  '',
].join('\n');

// 응답에 추가된 후보 필드들을 안전하게 정규화한다.
// 옛 스키마(title/body_html/tags만) 응답도 무리 없이 통과되도록 fallback 채움.
function _normalizeExtras(draft, defaults) {
  var out = {
    title_candidates: [],
    hook_candidates: [],
    checklist: [],
    thumbnail_texts: [],
    cta: '',
  };
  var toStr = function(v) { return typeof v === 'string' ? v.trim() : ''; };
  var pickLabel = function(v) {
    var s = toStr(v).toLowerCase();
    if (!s) return null;
    if (/놀라|surprise/.test(s)) return '놀라움';
    if (/공감|empath/.test(s)) return '공감';
    if (/불안|anx|fear/.test(s)) return '불안';
    if (/욕망|desire|want/.test(s)) return '욕망';
    return v;
  };
  // title_candidates 정규화
  if (Array.isArray(draft.title_candidates)) {
    out.title_candidates = draft.title_candidates.slice(0, 5).map(function(t) {
      if (typeof t === 'string') return { title: t, trigger: '' };
      return {
        title: toStr(t && (t.title || t.text)),
        trigger: pickLabel(t && (t.trigger || t.emotion || t.label)) || '',
      };
    }).filter(function(x) { return !!x.title; });
  }
  if (!out.title_candidates.length && defaults.title) {
    out.title_candidates = [{ title: defaults.title, trigger: '' }];
  }
  // hook_candidates 정규화
  if (Array.isArray(draft.hook_candidates)) {
    out.hook_candidates = draft.hook_candidates.slice(0, 5).map(function(h) {
      if (typeof h === 'string') return { hook: h, trigger: '' };
      return {
        hook: toStr(h && (h.hook || h.text)),
        trigger: pickLabel(h && (h.trigger || h.emotion || h.label)) || '',
      };
    }).filter(function(x) { return !!x.hook; });
  }
  // checklist 정규화
  if (Array.isArray(draft.checklist)) {
    out.checklist = draft.checklist.slice(0, 5)
      .map(toStr).filter(Boolean);
  }
  // thumbnail_texts 정규화
  if (Array.isArray(draft.thumbnail_texts)) {
    out.thumbnail_texts = draft.thumbnail_texts.slice(0, 5)
      .map(toStr).filter(Boolean);
  }
  // cta 정규화
  out.cta = toStr(draft.cta) || '';
  return out;
}

// 본문 HTML 뒤에 체크리스트 블록 + CTA 라인을 붙인다.
// 원문 링크 + 인스타 CTA 앞에 삽입 (사용자 경험상 자연스러운 순서).
function _renderChecklistHtml(checklist, cta) {
  var parts = [];
  if (Array.isArray(checklist) && checklist.length) {
    parts.push('<p>&nbsp;</p><h3>오늘의 체크리스트</h3>');
    parts.push('<ul>');
    checklist.forEach(function(item) {
      parts.push('<li>' + String(item).replace(/</g, '&lt;') + '</li>');
    });
    parts.push('</ul>');
  }
  if (cta) {
    parts.push('<p><em>' + String(cta).replace(/</g, '&lt;') + '</em></p>');
  }
  return parts.join('');
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
    '아래 JSON 스키마로만 응답하라. 어떤 필드도 누락 금지, 마크다운 fence 금지:',
    '{',
    '  "title": "가장 추천하는 제목 1개 (25~35자)",',
    '  "title_candidates": [ {"title": "...", "trigger": "놀라움|공감|불안|욕망"}, ... 총 5개 ],',
    '  "hook_candidates":  [ {"hook": "첫 3문장(2~3문장). 문장 사이 개행", "trigger": "..."}, ... 총 5개 ],',
    '  "body_html": "<p>공감 도입 3문장</p><h3>정보</h3><p>...[IMG1]...</p><h3>사례</h3><p>...[IMG2]...</p><h3>정리</h3><p>...</p>",',
    '  "checklist": ["오늘 실행 가능한 짧은 문장", ... 5개],',
    '  "thumbnail_texts": ["8~14자 카피", ... 5개],',
    '  "cta": "부드러운 CTA 1~2문장",',
    '  "tags": ["...", ... 10개]',
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
  // QA #350 — 체크리스트 + 부드러운 CTA 블록 (원문 링크보다 앞)
  var extras = _normalizeExtras(draft, { title: draft.title || art.title });
  body += _renderChecklistHtml(extras.checklist, extras.cta);
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
    // QA #350 — 체류형 포스팅 프레임워크 필드 (프론트가 후보 카드 UI로 표시)
    title_candidates: extras.title_candidates,
    hook_candidates: extras.hook_candidates,
    checklist: extras.checklist,
    thumbnail_texts: extras.thumbnail_texts,
    cta: extras.cta,
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
    '아래 JSON 스키마로만 응답하라. 어떤 필드도 누락 금지, 마크다운 fence 금지:',
    '{',
    '  "title": "가장 추천하는 제목 1개 (25~35자, 브랜드·컨셉 키워드 앞배치)",',
    '  "title_candidates": [ {"title": "...", "trigger": "놀라움|욕망|공감"}, ... 총 5개 ],',
    '  "hook_candidates":  [ {"hook": "첫 3문장(2~3문장). 화보 무드를 감각적으로 전달", "trigger": "..."}, ... 총 5개 ],',
    '  "body_html": "<p>인트로 훅</p>[IMG1]<h3>무드와 컨셉</h3><p>...[IMG2]...</p><h3>룩과 스타일링</h3><p>...[IMG3]...</p><h3>크레딧</h3><ul><li>...</li></ul>",',
    '  "checklist": ["오늘 시도해볼 스타일링 팁 등 짧은 문장", ... 5개],',
    '  "thumbnail_texts": ["8~14자 카피 (컨셉·브랜드 감성)", ... 5개],',
    '  "cta": "부드러운 CTA 1~2문장 (댓글 유도)",',
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
  // QA #350 — 체크리스트 + 부드러운 CTA 블록 (원문 링크보다 앞)
  var extras = _normalizeExtras(draft, { title: draft.title || ed.title });
  body += _renderChecklistHtml(extras.checklist, extras.cta);
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
    // QA #350 — 체류형 포스팅 프레임워크 필드 (프론트가 후보 카드 UI로 표시)
    title_candidates: extras.title_candidates,
    hook_candidates: extras.hook_candidates,
    checklist: extras.checklist,
    thumbnail_texts: extras.thumbnail_texts,
    cta: extras.cta,
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
