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

const { reportAiFailure } = require('../_lib/aiCreditWatch');   // AI 장애 알림 (2026-07-30)
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');

const SITES = {
  pap: { table: 'articles', site: 'https://www.pap-magazine.com', name: 'PAP MAGAZINE', ig: '@pap_magazine' },
  pepperit: { table: 'pepperit_articles', site: 'https://www.pepperitmag.com', name: 'PEPPERIT', ig: '@pepperitmag' },
};

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ─── 2026-08-05 — JSON 파싱 실패 수정 ────────────────────────────────
 *
 * 사건: naver-draft-sweep 이 36시간 9회 실행 중 6회 실패했다. 에러는 전부
 *   `Expected ',' or '}' after property value in JSON at position 509`
 * 였다. 원인은 모델 탓이 아니라 **요구한 형식 탓**이다. 우리는 HTML 을
 * JSON 문자열 안에 넣어 달라고 했는데, HTML 은 속성값에 큰따옴표를 쓴다
 * (`<p style="text-align:center">`). 모델이 그 따옴표를 이스케이프하지 않으면
 * 문자열이 거기서 끊기고 JSON 이 통째로 깨진다. position 509 = body_html
 * 안쪽이라는 것도 이 설명과 맞는다. 프롬프트로 "이스케이프하라"고 더 세게
 * 말해봐야 확률만 조금 바뀐다 — 형식을 바꿔야 원인이 사라진다.
 *
 * 그래서 두 겹으로 고친다.
 *   ① 구조화 출력(tool_use)로 받는다 — 모델이 문자열을 직접 조립하지 않으므로
 *      따옴표로 깨질 수가 없다. API 가 이미 파싱된 객체를 준다.
 *   ② 그래도 텍스트로 오면(모델·API 버전 문제) 필드 경계로 건져낸다.
 *      깨진 JSON 을 추측해 고치는 게 아니라, "title/body_html/tags 의 경계는
 *      어디인가" 라는 사실만 쓴다 — _lib/seoTranslateBackfill.js 의
 *      salvageObjects 와 같은 원칙이다.
 */
/* ─── 2026-08-14 — 홈판 전환 (도메니코 지시: "C로 가자") ──────────────────
 *
 * 실측이 이 개편의 근거다. 발행 213편의 성적:
 *   · 블로그 전체 일 조회수 20~85 (게시물당 1~3회)
 *   · 웹 유입 0명 — utm 링크가 붙은 50편이 7일간 살아 있었는데 0
 *   · 인스타 유입 하루 2.4클릭 (웹 SSR 은 하루 181클릭 — 75배)
 *   · **발행량과 조회수가 무상관**: 39편 올린 8/11 이 최저(28), 6편 올린 8/12 가 최고(85)
 *
 * "많이 올리면 유입이 는다" 가설은 우리 데이터로 반증됐다. 그래서 반대로 간다 —
 * 적게, 좋게, 한 주제로. 이 파일의 변경은 전부 그 결정의 구현이다.
 *
 * 왜 제목이 2개인가: 네이버의 두 관문은 요구가 정반대다.
 *   검색 = 키워드를 앞에 (정확성)  /  홈판 = 궁금해서 누르게 (호기심)
 * 지금까지 title 하나로 둘 다 노리다 둘 다 어정쩡했다. 갈라서 둘 다 주고,
 * 도메니코가 그 글에 맞는 쪽을 고른다.
 * ────────────────────────────────────────────────────────────────────────── */

/* 네이버 블로그 '주제' 중 PAP 가 쓰는 것만. 32종 전체를 주지 않는 게 핵심이다.
 *
 * 213편 전수 분류 결과 우리 콘텐츠는 패션·미용 40% / 스타·연예인 29% /
 * 미술·디자인 23% 로 세 갈래였다. 세 갈래로 흩으면 C-Rank 가 보는 주제
 * 일관성이 안 잡힌다. 그래서 목록 자체를 좁혀 모델이 흩을 수 없게 만든다.
 * (프롬프트로 "몰아라" 라고 부탁하는 것보다 고를 수 없게 하는 쪽이 확실하다.)
 *
 * ⚠ 이 문자열은 네이버 글쓰기 화면의 '주제' 드롭다운과 **글자까지 같아야**
 *   도메니코가 그대로 고를 수 있다. 화면에서 미확인 상태 — 다르면 여기를 고친다.
 */
const NAVER_TOPICS = ['패션·미용', '미술·디자인', '공연·전시', '스타·연예인', '음악'];

const DRAFT_TOOL = {
  name: 'emit_draft',
  description: '네이버 블로그 초안 한 건을 구조화된 형태로 제출한다.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '검색용 제목 1개 (25~35자). 핵심 키워드를 문장 맨 앞에 둔다.' },
      title_feed: { type: 'string', description: '홈판용 제목 1개 (25~35자). 검색어가 아니라 호기심으로 누르게 만든다. 낚시성 허위는 금지 — 본문이 실제로 답하는 궁금증만.' },
      body_html: { type: 'string', description: '본문 HTML. 태그 안에 큰따옴표를 써도 된다.' },
      tags: { type: 'array', items: { type: 'string' }, description: '태그 18개 (# 없이)' },
      naver_topic: { type: 'string', enum: NAVER_TOPICS, description: '네이버 블로그 주제. 목록에서 정확히 하나.' },
      thumb_caption: { type: 'string', description: '대표 이미지에 얹을 문구 15자 이내. 제목을 반복하지 말고 궁금증을 한 겹 더한다.' },
    },
    required: ['title', 'title_feed', 'body_html', 'tags', 'naver_topic', 'thumb_caption'],
  },
};

/* 깨진 JSON 에서 세 필드를 경계로 건져낸다. 못 건지면 null. */
function salvageDraft(text) {
  const s = String(text || '');
  const cut = (key, nextKey) => {
    const k = s.indexOf('"' + key + '"');
    if (k === -1) return null;
    const open = s.indexOf('"', s.indexOf(':', k) + 1);
    if (open === -1) return null;
    // 다음 필드의 시작 직전까지가 이 값의 범위다. 그 안의 마지막 따옴표가 끝.
    const nk = nextKey ? s.indexOf('"' + nextKey + '"', open + 1) : -1;
    const region = s.slice(open + 1, nk === -1 ? s.length : nk);
    const end = region.lastIndexOf('"');
    if (end <= 0) return null;
    return region.slice(0, end)
      .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
      .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  };
  const title = cut('title', 'body_html');
  const body_html = cut('body_html', 'tags');
  if (!title || !body_html) return null;
  let tags = [];
  const ti = s.indexOf('"tags"');
  if (ti !== -1) {
    const a = s.indexOf('[', ti), b = s.indexOf(']', a);
    if (a !== -1 && b !== -1) {
      try { tags = JSON.parse(s.slice(a, b + 1)); } catch (_) { tags = []; }
    }
  }
  return { title, body_html, tags: Array.isArray(tags) ? tags : [] };
}

/* 초안 1건을 모델에서 받아온다. 실패 시 throw (호출자가 문구를 붙인다). */
async function requestDraft(prompt, maxTokens, label) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!apiRes.ok) {
    const t = await apiRes.text().catch(() => '');
    await reportAiFailure(apiRes.status, t, label);
    throw new Error('Claude API ' + apiRes.status + ': ' + t.slice(0, 200));
  }
  const j = await apiRes.json();
  const parts = Array.isArray(j.content) ? j.content : [];

  // ① 구조화 출력 — 정상 경로. 따옴표로 깨질 수 없다.
  const tu = parts.find(c => c && c.type === 'tool_use' && c.name === DRAFT_TOOL.name);
  if (tu && tu.input && tu.input.title && tu.input.body_html) return tu.input;

  // ② 텍스트로 왔을 때 — 예전 경로 + 건져내기
  const text = parts.filter(c => c && c.type === 'text').map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (_) { /* 아래에서 건져낸다 */ }
  }
  const salvaged = salvageDraft(text);
  if (salvaged) {
    console.warn('[' + label + '] 구조화 출력 없음 — 텍스트에서 건져냄');
    return salvaged;
  }
  if (j.stop_reason === 'max_tokens') {
    throw new Error('Claude 응답이 max_tokens 에서 잘렸습니다 (' + label + ').');
  }
  throw new Error('Claude 응답에서 초안을 얻지 못함 (' + label + ').');
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
  '1) 제목 2종 — 후보를 각각 5개씩 만들어보고 최고 1개씩만 반환.',
  '   ① title (검색용): 25~35자. 핵심 키워드(브랜드·인물·작가명)를 문장 맨 앞에.',
  '      사람들이 실제로 검색창에 칠 말이어야 한다. 과장 금지.',
  '   ② title_feed (홈판용): 25~35자. 검색어가 아니라 **호기심**으로 누르게.',
  '      "왜", "진짜 이유", "~한 이유", 통념 뒤집기, 숫자 구체화가 잘 먹힌다.',
  '      단 본문이 실제로 답하지 않는 궁금증은 만들지 말 것 — 낚시는 이탈을 부른다.',
  '   • 감정 트리거 4종 중 택1: 놀라움 · 공감 · 불안 · 욕망',
  '     패션·미술은 놀라움 · 욕망 · 공감. 뉴스성은 놀라움 · 불안.',
  '',
  '2) 도입부 훅 (body_html 첫 문단): 후보 5개를 만들어보고 최고 3문장을 첫 <p>에 배치.',
  '   • 첫 문장에서 승부. 스크롤 이탈을 막는 구체적인 장면·수치·질문으로 시작.',
  '   • "여러분", "혹시" 같은 대화 시작어 활용 가능',
  '',
  '3) 본문 흐름 (body_html): 공감 → 정보 → 사례 → 정리 4구간.',
  '   • **본문 실제 글자 수 1,800~2,500자** (HTML 태그 제외). 이게 체류시간을 만든다.',
  '     짧게 쓰지 마라 — 1,000자짜리는 40초 만에 닫힌다. 대신 문단은 짧게 끊는다.',
  '   • h3 소제목 4~6개, 각 문단 1~3문장',
  '   • 분량을 채우려고 같은 말을 늘리지 말 것. 배경·맥락·비교·작가의 다른 작업·',
  '     보는 법 같은 **새 정보**로 채운다. 모르는 사실을 지어내는 것은 절대 금지.',
  '   • [IMG1] [IMG2] ... 마커를 자연스러운 위치에 (사용 가능한 이미지 수만큼)',
  '   • 이모지는 전체 최대 3개',
  '',
  '4) 마무리 체크리스트 (body_html 끝부분에 <h3>오늘의 체크리스트</h3><ul>...): 5개 항목.',
  '   • 각 30자 이내, 오늘 바로 실행할 수 있는 문장',
  '',
  '5) 댓글 유도 질문 (체크리스트 아래 <p><em>...</em></p> 한 줄).',
  '   • **반드시 물음표로 끝나는 질문 1개.** 홈판은 댓글을 강한 신호로 본다.',
  '   • "여러분은 어느 쪽이세요?" 처럼 둘 중 하나를 고르게 하는 질문이 답이 잘 달린다.',
  '   • "궁금한 점 있으면 댓글 주세요" 같은 열린 문장은 답이 안 달린다 — 쓰지 말 것.',
  '',
  '6) naver_topic: 주어진 목록에서 이 글에 가장 맞는 것 하나.',
  '   thumb_caption: 대표 이미지에 얹을 15자 이내 문구. 제목을 반복하지 말 것.',
  '',
  '7) 태그 18개 (# 없이) — 두 종류를 섞는다.',
  '   • 광의 6개: 주제판이 이 글을 분류할 수 있게 하는 큰 말 (패션, 아트, 화보 등)',
  '   • 롱테일 12개: 고유명사·작품명·기법명 등 경쟁 적은 말',
  '',
  '※ 시스템이 자동으로 뒤에 원문 링크 + 인스타 CTA + 저작권 라인을 붙이므로',
  '  body_html에는 URL을 직접 넣지 말 것.',
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '',
].join('\n');


/* 2026-08-17 도메니코 지시 — '팝매거진' 검색에서 pop magazine 에 밀리지 않게.
   네이버 검색은 네이버 블로그 문서를 우선하므로, 우리가 매일 쌓는 블로그
   글 전부에 브랜드 한글 표기를 심는 것이 가장 확실한 지렛대다.
   푸터 표기 + 태그 두 개(팝매거진·PAP매거진). pepperit 에는 적용하지 않는다. */
function brandTags(brand, tags) {
  const base = Array.isArray(tags) ? tags : [];
  if (brand !== 'pap') return base.slice(0, 18);
  const mine = ['팝매거진', 'PAP매거진'];
  return [...mine, ...base.filter(t => !mine.includes(t))].slice(0, 18);
}
function brandLabel(brand, name) {
  return brand === 'pap' ? name + '(팝매거진)' : name;
}

async function generateDraft(art, brand) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수 누락.');
  const b = SITES[brand];
  /* 백링크에 utm 을 붙인다 (2026-08-07).
     지금까지 이 링크에는 파라미터가 없었다. socialInclick 은 utm_source 가
     있을 때만 기록하므로, 네이버 블로그에서 사이트로 들어온 사람이 **전부
     집계에서 사라지고 있었다** — 화이트리스트에 'naver' 자리를 만들어 두고도
     그 소스를 만들어 줄 링크가 코드에 없었다.
     IG 링크는 이미 ?src=naverblog 로 재고 있었는데(naver-blog-kit.js:31)
     정작 우리 사이트로 오는 길만 안 재고 있었다. */
  const artUrl = b.site + '/article/' + encodeURIComponent(art.custom_url || art.slug || art.id)
    + '?utm_source=naver&utm_medium=blog&utm_campaign=naver-blog';
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
    '4) 본문 실제 글자 수 1,800~2,500자 (HTML 태그 제외). 사용 가능한 이미지 ' + gallery.length + '장. [IMGn] 마커 순서대로.',
    '5) 태그 18개 (# 없이). 기사 태그 재활용 + 광의 6 / 롱테일 12.',
    '6) 마지막 원문 링크·인스타 CTA는 시스템이 자동 삽입하므로 body_html 안에 URL을 넣지 말 것.',
    '7) naver_topic 은 다음 중 하나: ' + NAVER_TOPICS.join(' / '),
    /* 자체 취재면 그 사실을 쓰게 한다 (2026-08-14).
       홈판에서 우리를 남과 가르는 건 '우리만 가진 사진' 이다. 그런데 지금까지
       초안은 그 사실을 한 번도 말하지 않았다 — 현장에서 직접 찍은 글과
       보도자료를 옮긴 글이 똑같은 톤으로 나갔다. 다만 없는 취재를 지어내면
       안 되므로, 캡션 크레딧이 실제로 PAP 인 건에만 이 문장을 붙인다. */
    isOwnCoverage(art.instagram_caption)
      ? '8) 이 콘텐츠는 PAP가 현장에서 직접 촬영한 자체 취재다. 본문 어딘가에 '
        + '"PAP가 현장에서 직접 담았다"는 사실을 자연스럽게 한 번 밝혀라 '
        + '(자랑조 금지, 사실 전달). 없는 취재 정황을 지어내지는 말 것.'
      : '8) 이 콘텐츠는 자체 취재가 아니다. 현장에 있었던 것처럼 쓰지 말 것.',
    FRAMEWORK_BLOCK,
    '기사 제목: ' + art.title,
    '기사 본문: ' + stripHtml(art.content).slice(0, 3000),
    '기사 태그: ' + JSON.stringify(art.tags || []),
    '',
    'emit_draft 도구로 제출하라. body_html 은 다음 구조를 따른다:',
    '<p>훅 3문장</p><h3>소제목</h3><p>...[IMG1]...</p><h3>소제목</h3><p>...[IMG2]...</p>',
    '<h3>소제목</h3><p>...</p><h3>정리</h3><p>...</p><h3>오늘의 체크리스트</h3><ul><li>...</li> × 5</ul>',
    '<p><em>물음표로 끝나는 댓글 유도 질문 한 줄</em></p>',
    'title / title_feed 는 각 25~35자 1개, tags 는 # 없이 18개.',
  ].join('\n');

  /* max_tokens 2500 → 7000 (2026-08-14).
     본문 목표를 1,000자에서 2,500자로 올렸다. 한국어는 대략 글자당 1토큰이 넘고
     여기에 HTML 태그 + 제목 2종 + 태그 18개가 더 붙는다. 2500 으로 두면
     stop_reason=max_tokens 로 잘려서 초안이 통째로 버려진다(기존 코드가 그때
     throw 한다). 늘린 만큼 생성 시간도 늘어나므로 크론은 1회 1건으로 줄였다
     (naver-draft-sweep.js 의 DAILY_MAX 기본값). */
  const draft = await requestDraft(prompt, 7000, 'naver-blog-draft');

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
  body += '<p>&nbsp;</p><p>전체 기사와 더 많은 이미지는 <a href="' + artUrl + '">' + brandLabel(brand, b.name) +
    ' 원문</a>에서 보실 수 있어요.</p>' +
    igCtaBlock(art.source_instagram_url, b.ig, '소식');

  return Object.assign({
    title: draft.title || art.title,
    tags: brandTags(brand, draft.tags),
    body_html: body,
    images: gallery,
    article_url: artUrl,
  }, draftExtras(draft));
}

/* 새 필드(2026-08-14)의 안전한 기본값.
 *
 * salvageDraft 경로(깨진 JSON 건져내기)는 title/body_html/tags 셋만 복구한다.
 * 그 경로로 들어오면 새 필드가 undefined 인데, 그대로 DB 에 넣으면 NOT NULL 이
 * 아니어도 화면에 'undefined' 가 뜬다. 여기서 한 번에 막는다.
 *
 * naver_topic 은 목록 밖 값이면 버린다 — 네이버 드롭다운에 없는 주제를
 * 화면에 띄우면 도메니코가 못 고르고, 못 고르면 홈판 후보군에 못 들어간다.
 * 비워 두는 편이 틀린 값을 주는 것보다 낫다(그때는 본인이 고른다).
 */
function draftExtras(draft) {
  const topic = String((draft && draft.naver_topic) || '').trim();
  return {
    title_feed: String((draft && draft.title_feed) || '').trim() || null,
    naver_topic: NAVER_TOPICS.includes(topic) ? topic : null,
    thumb_caption: String((draft && draft.thumb_caption) || '').trim().slice(0, 40) || null,
  };
}

// QA #346 — 에디토리얼 초안 생성기 (PAP 전용).
// 아티클과 스키마가 달라(description/gallery/credits 중심, content HTML 없음)
// 별도 프롬프트로 처리한다.
async function generateEditorialDraft(ed, brand) {
  if (brand !== 'pap') throw new Error('에디토리얼은 PAP만 지원합니다.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수 누락.');
  const b = SITES.pap;
  /* 2026-08-12 — 기사 경로(artUrl)는 8/7 에 utm 을 붙였는데 **에디토리얼 경로만
     빠져 있었다.** 규칙이 두 벌이면 한쪽만 고쳐진다(GROWTH-LEDGER 교훈 2)의 재발.
     화보 포스팅에서 사이트로 넘어온 사람은 그동안 전부 집계 밖이었다. */
  const url = b.site + '/editorial/' + encodeURIComponent(ed.slug)
    + '?utm_source=naver&utm_medium=blog&utm_campaign=naver-blog';
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
    '4) 본문 실제 글자 수 1,800~2,500자 (HTML 태그 제외). 사용 가능한 이미지 ' + gallery.length + '장. [IMGn] 마커 순서대로. 첫 이미지는 인트로 아래.',
    '5) 태그 18개 (# 없이). 필수 포함: PAP매거진, 패션에디토리얼, 패션화보. 나머지는 광의 3 / 롱테일 12.',
    '6) 원문 링크·인스타 CTA·저작권 라인은 시스템이 자동 삽입하므로 body_html에 URL을 넣지 말 것.',
    '7) 패션 에디토리얼 특성상 심리 트리거는 놀라움 · 욕망 · 공감이 잘 먹힘 (불안 최소화).',
    '8) naver_topic 은 다음 중 하나: ' + NAVER_TOPICS.join(' / ') + ' (화보는 보통 패션·미용)',
    FRAMEWORK_BLOCK,
    '에디토리얼 제목: ' + ed.title + (ed.title_en ? ' / ' + ed.title_en : ''),
    '발행호: ' + (ed.issue || '-'),
    '에디토리얼 설명(원문): ' + descKo.slice(0, 2000),
    '크레딧 라인:',
    creditLines.length ? creditLines.map(l => '  - ' + l).join('\n') : '  - (없음)',
    '기존 태그: ' + JSON.stringify(ed.tags || []),
    '',
    'emit_draft 도구로 제출하라. body_html 은 다음 구조를 따른다:',
    '<p>인트로 훅 3문장</p>[IMG1]<h3>무드와 컨셉</h3><p>...[IMG2]...</p>',
    '<h3>룩과 스타일링</h3><p>...[IMG3]...</p><h3>크레딧</h3><ul><li>...</li></ul>',
    '<h3>오늘의 체크리스트</h3><ul><li>...</li> × 5</ul><p><em>물음표로 끝나는 댓글 유도 질문 한 줄</em></p>',
    'title 은 25~35자(브랜드·컨셉 키워드 앞배치), title_feed 는 25~35자(호기심형),',
    'tags 는 # 없이 18개이며 PAP매거진 · 패션에디토리얼 · 패션화보를 반드시 포함한다.',
  ].join('\n');

  // max_tokens 2800 → 7000 — 본문 목표 상향에 따른 조정. generateDraft 의 주석 참조.
  const draft = await requestDraft(prompt, 7000, 'naver-blog-draft-editorial');

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
  body += '<p>&nbsp;</p><p>전체 화보와 더 많은 컷은 <a href="' + url + '">' + brandLabel('pap', b.name) +
    ' 웹사이트</a>에서 만나보실 수 있어요.</p>' +
    igCtaBlock(ed.source_instagram_url, b.ig, '화보') +
    '<p style="color:#888;font-size:12px">ⓒ PAP MAGAZINE (PAP매거진) — 무단 전재 및 재배포 금지</p>';

  return Object.assign({
    title: draft.title || ed.title,
    tags: brandTags('pap', draft.tags),
    body_html: body,
    images: gallery,
    article_url: url,
  }, draftExtras(draft));
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
    .select('id, title, slug' + (brand === 'pap' ? ', custom_url' : '') + ', content, tags, gallery, thumbnail_url, source_instagram_url, instagram_caption')
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
// pending = 발행순(오름차순) 미전환 목록, doneSet = 이미 초안 있는 slug 집합.
// 최근 발행 콘텐츠 목록 — 발행 순서(오래된→최신) 오름차순으로 반환.
// opt.lookbackDays 가 있으면 그 기간 내 발행분만(오래된 누락 백필 방지).
// published_date 는 날짜 단위라 같은 날 순서는 created_at 로 확정한다.
async function _recentPublished(brand, kind, opt) {
  opt = (typeof opt === 'number') ? { limit: opt } : (opt || {});
  const limit = opt.limit || 60;
  const since = opt.lookbackDays
    ? new Date(Date.now() - opt.lookbackDays * 86400000).toISOString().slice(0, 10)
    : null;
  const b = SITES[brand];
  if (kind === 'editorial') {
    let qy = supabaseAdmin.from('editorials')
      .select('id, slug, published_date, created_at').eq('status', 'published').not('slug', 'is', null);
    if (since) qy = qy.gte('published_date', since);
    const { data } = await qy.order('published_date', { ascending: true }).order('created_at', { ascending: true }).limit(limit);
    return (data || []).map((r) => ({ slug: r.slug, id: r.id, published_date: r.published_date, created_at: r.created_at })).filter((r) => r.slug);
  }
  let qy = supabaseAdmin.from(b.table)
    .select('id, slug, title, category, instagram_caption, published_date, created_at' + (brand === 'pap' ? ', custom_url' : ''))
    .eq('status', 'published');
  if (since) qy = qy.gte('published_date', since);
  const { data } = await qy.order('published_date', { ascending: true }).order('created_at', { ascending: true }).limit(limit);
  const skip = skipCategories();
  return (data || [])
    .filter((r) => !skip.has(String(r.category || '').toLowerCase()))
    .map((r) => ({
      slug: brand === 'pap' ? (r.custom_url || r.slug) : r.slug,
      id: r.id, category: r.category,
      own: isOwnCoverage(r.instagram_caption),
      art: isArtArticle(r.title, r.instagram_caption),
      published_date: r.published_date, created_at: r.created_at,
    }))
    .filter((r) => r.slug);
}

/* 자체 취재인가 — 인스타 캡션의 크레딧 줄로 판별한다 (2026-08-14, 도메니코 제보).
 *
 *   🎥 PAP  ·  📸 PAP  → 우리가 직접 찍었다        ← 이것만 true
 *   🎥 @jamiroquaihq   → 남의 영상
 *   🎥 YouTube | KATSEYE → 남의 영상
 *   📸 @esdevlin @futuraseoul , PAP → 외부가 주, PAP 는 보조. 자체 취재 아니다.
 *     (이모지 '바로 뒤' 를 요구하므로 이런 혼합은 자연히 빠진다)
 *
 * 2026-08-17 정정 — 처음엔 🎥 만 봤다. 캡션 백필 첫 회차 57건을 실측하니
 * 📸 PAP 가 2건 있었다. 영상은 🎥, 사진은 📸 를 쓰는데 둘 다 자체 취재다.
 * 8건(🎥) 만 잡고 2건을 놓치고 있었다. 이모지를 둘 다 본다.
 *
 * 왜 캡션이어야 하나: DB 의 다른 컬럼으로는 안 갈린다. 실측했다 —
 * 자체 취재(맨시티 성수·워터밤 라이즈)와 통신사 재탕(뷔 앰버서더·그래미)이
 * credits(둘 다 []) · is_celeb(둘 다 true) · digest_kind(둘 다 celeb) ·
 * source_instagram_url(둘 다 있음) · 태그에서 전부 동일했다.
 * source_media_type 이 VIDEO 면 현장인가 싶었는데 News 61편 중 18편이
 * VIDEO 라 우연이었다. 캡션 크레딧만이 유일한 신호다.
 *
 * 왜 이게 중요한가: 홈판은 클릭률로 뽑고, 클릭을 만드는 건 '남에게 없는
 * 사진' 이다. 자체 취재는 유일하고, 통신사 재탕은 수천 개 중 하나다.
 *
 * 표기가 바뀌면 NAVER_DRAFT_OWN_MARK 로 배포 없이 고칠 수 있다.
 * 캡션이 없는 옛 기사(2026-08-14 이전 수집분)는 전부 false 가 된다 —
 * 그래서 호출부는 '자체 취재가 없으면 전체에서 고른다' 로 폴백한다.
 */
function ownMarkRe() {
  const src = process.env.NAVER_DRAFT_OWN_MARK || '(🎥|📸)\\s*(PAP\\b|@pap)';
  try { return new RegExp(src, 'i'); } catch (_) { return /(🎥|📸)\s*(PAP\b|@pap)/i; }
}
function isOwnCoverage(caption) {
  return ownMarkRe().test(String(caption || ''));
}

/* 어떤 카테고리를 네이버에 안 올릴 것인가 (2026-08-14).
 *
 * 기본값 News. 근거는 감이 아니라 전수 분류다 — 발행 213편 중 News 43편은
 * 38편이 연예 단신(앰버서더 발탁·컴백 예고·신곡 공개)이었다. 그 판은 언론사와
 * 네이버뉴스가 이미 차지하고 있어 블로그 글이 낄 자리가 없고, 우리가 더할
 * 정보도 없다(통신사 자료 재구성이다). 안 떠서 한 번 손해, 블로그의 주제
 * 일관성을 깎아서 또 한 번 손해다.
 *
 * PAP 가 직접 취재·촬영한 연예 콘텐츠(워터밤 현장 등)는 Culture 로 들어와
 * 여기 안 걸린다 — 자체 취재는 계속 올라간다.
 *
 * NAVER_DRAFT_SKIP_CATEGORIES 로 바꿀 수 있다. 빈 문자열이면 전부 올린다.
 */
/* 아트 기사인가 — 제목·캡션의 어휘로 판별한다 (2026-08-26, 도메니코 지시:
 * "네이버 초안은 아트 기사 위주로만"). 카테고리만으로는 못 가른다 — 아트는
 * Culture 안에 셀럽·음악과 섞여 있다. 휴리스틱이므로 경계 사례(네일아트 등)는
 * 일부 섞일 수 있고, 그건 관리자가 게시 단계에서 거른다. */
const ART_TERMS = [
  '전시', '개인전', '갤러리', '작가', '아티스트', '조각', '회화', '일러스트',
  '미술', '아트', '사진집', '포토그래퍼', '설치미술', '비엔날레', '공예', '도예',
  'artist', 'exhibition', 'gallery', 'sculpture', 'photobook', 'installation',
];
function isArtArticle(title, caption) {
  const hay = (String(title || '') + ' ' + String(caption || '')).toLowerCase();
  return ART_TERMS.some((t) => hay.includes(t.toLowerCase()));
}
/* 아트 전용 모드 스위치 — 선정(generateNext)과 크론 기본값(naver-draft-sweep)이
 * 같은 판단을 공유해야 해서 함수로 뺐다. NAVER_DRAFT_ART_ONLY=false 로 끈다. */
function artOnlyEnabled() {
  return String(process.env.NAVER_DRAFT_ART_ONLY || 'true').toLowerCase() !== 'false';
}

function skipCategories() {
  const raw = process.env.NAVER_DRAFT_SKIP_CATEGORIES;
  const src = raw === undefined ? 'News' : raw;
  return new Set(String(src).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// 재사용 함수 — "다음 미전환 콘텐츠 1건을 네이버 초안으로 생성·저장".
// 관리자 generate_next 경로와 크론(naver-draft-sweep)이 공유한다.
// 반환: { done, remaining, draft, slug } — done=true 면 미전환 콘텐츠 없음.
/**
 * 다음에 초안을 만들 기사 하나를 고른다.
 *
 * 2026-08-05 (도메니코 지시): 선정 순서를 '가장 오래된 미전환' → '최신'으로
 * 뒤집었다. 큐에 상한을 두기로 한 이상, 살아남는 초안이 최신이어야 네이버
 * 검색 유입에 유리하다. 예전에는 폐기될 운명의 옛 기사를 먼저 만들고 있었다.
 * NAVER_DRAFT_ORDER=oldest 로 옛 동작(발행 순서 유지)으로 되돌릴 수 있다.
 *
 * 주의 — 최신부터 고르면 조회 창(NAVER_DRAFT_LOOKBACK_DAYS, 기본 3일) 안에서
 * 가장 오래된 기사는 초안을 못 받고 창 밖으로 밀려날 수 있다. 그건 의도된
 * 트레이드오프다(신선도 우선). 전부 챙겨야 하면 창을 늘리거나 oldest 로 둘 것.
 */
async function generateNext(brand, kind) {
  /* 2026-08-26 (도메니코 지시 2차): "모든 아트 기사"가 초안을 받아야 한다.
   * 아트 모드 기본 룩백을 3일 → 14일로 넓혀 백로그까지 흡수한다.
   * (아트 기사 실측 하루 ~3.4건 vs 생성 능력 6건/일 — 수렴한다) */
  const _artDefaultLookback = artOnlyEnabled() && kind === 'article' ? 14 : 3;
  const lookbackDays = Math.max(1, parseInt(process.env.NAVER_DRAFT_LOOKBACK_DAYS || String(_artDefaultLookback), 10) || _artDefaultLookback);
  const oldestFirst = String(process.env.NAVER_DRAFT_ORDER || 'newest').toLowerCase() === 'oldest';
  const recent = await _recentPublished(brand, kind, { lookbackDays, limit: 120 });
  const { data: done } = await supabaseAdmin.from('naver_blog_drafts')
    .select('source_slug').eq('brand', brand).eq('kind', kind);
  const doneSet = new Set((done || []).map((d) => d.source_slug));
  const pending = recent.filter((r) => !doneSet.has(r.slug)); // 발행 오름차순 정렬됨
  if (!pending.length) return { done: true, remaining: 0, draft: null, slug: null };

  /* 자체 취재 우선 (2026-08-14).
   *
   * 홈판은 클릭률로 뽑고, 클릭을 만드는 건 '남에게 없는 사진' 이다.
   * 우리가 현장에서 찍은 것(워터밤·맨시티 성수·브랜드 런칭 나이트)은 유일하고,
   * 통신사 재탕(앰버서더 발탁·컴백 예고)은 수천 개 중 하나다. 같은 연예
   * 콘텐츠라도 이 둘은 완전히 다른 물건이라 선정에서 갈라야 한다.
   *
   * 폴백이 중요하다 — 자체 취재가 하나도 없으면 pending 전체에서 고른다.
   * 캡션은 2026-08-14부터 저장되므로 그 전 기사는 전부 own=false 다.
   * 폴백이 없으면 룩백 창(3일)이 채워질 때까지 초안 생성이 멈춘다.
   */
  /* 2026-08-26 (도메니코 지시): 네이버 초안은 아트 기사 위주로만 만든다.
   * 근거: 08-14 실측에서 발행량↔조회수 무상관이 확인됐고, 8/26 기준 만료 폐기가
   * 61건 — 양이 아니라 결이 문제다. 예술가·전시·작업 세계 기사만 초안화한다.
   * 아트 기사가 없으면 그 회차는 건너뛴다 — 큐를 비아트로 채우지 않는 것이
   * 목적이므로 의도된 동작이다. NAVER_DRAFT_ART_ONLY=false 로 종전 동작 복귀. */
  const artOnly = kind === 'article' && artOnlyEnabled();
  const base = artOnly ? pending.filter((r) => r.art) : pending;
  if (!base.length) return { done: true, remaining: 0, draft: null, slug: null };
  const own = base.filter((r) => r.own);
  const pool = own.length ? own : base;
  const next = oldestFirst ? pool[0] : pool[pool.length - 1];
  const { draft, sourceId } = await generateBySlug(brand, kind, next.slug);
  const { data: saved, error: sErr } = await supabaseAdmin.from('naver_blog_drafts')
    .upsert({
      brand, kind, source_slug: next.slug, source_id: String(sourceId || ''),
      title: draft.title, body_html: draft.body_html,
      tags: draft.tags || [], image_urls: draft.images || [],
      article_url: draft.article_url, status: 'draft',
      // 2026-08-14 홈판 전환 — 마이그레이션 123 에서 추가한 컬럼
      title_feed: draft.title_feed || null,
      naver_topic: draft.naver_topic || null,
      thumb_caption: draft.thumb_caption || null,
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
          .order('created_at', { ascending: false })
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
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return res.status(200).json({ brand, kind, articles: data || [] });
    }

    // ── 큐 조회: 미발행(draft) 초안 목록 ──
    if (q.queue === '1') {
      const { data, error } = await supabaseAdmin.from('naver_blog_drafts')
        .select('id, title, source_slug, article_url, tags, status, created_at')
        .eq('brand', brand).eq('kind', kind).eq('status', 'draft')
        .limit(200);
      if (error) throw error;
      const rows = data || [];
      // 실제 기사 발행 순서 기준 최신순(내림차순) 정렬 — 최신 발행 기사가 맨 위.
      // published_date(날짜)+created_at(시각) 으로 같은 날도 정확히. 조회 실패분은 맨 뒤.
      const pubKey = {};
      try {
        const b = SITES[brand];
        const table = kind === 'editorial' ? 'editorials' : (b && b.table);
        const useCustom = (brand === 'pap' && kind !== 'editorial');
        if (table) {
          const { data: arts } = await supabaseAdmin.from(table)
            .select('slug, published_date, created_at' + (useCustom ? ', custom_url' : ''))
            .eq('status', 'published');
          (arts || []).forEach((a) => {
            const key = useCustom ? (a.custom_url || a.slug) : a.slug;
            if (key) pubKey[key] = (a.published_date || '9999-12-31') + '|' + (a.created_at || '');
          });
        }
      } catch (_) { /* 정렬 보조 실패 시 created_at 로 대체 */ }
      rows.sort((x, y) => {
        // 2026-07-25 — 최신순(내림차순): 최신 발행 기사를 맨 위로. 발행일 미상은 맨 뒤.
        const kx = pubKey[x.source_slug] || ('0000-00-00|' + (x.created_at || ''));
        const ky = pubKey[y.source_slug] || ('0000-00-00|' + (y.created_at || ''));
        if (kx > ky) return -1;
        if (kx < ky) return 1;
        return (x.created_at || '') > (y.created_at || '') ? -1 : 1;
      });
      return res.status(200).json({ brand, kind, queue: rows });
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
        title_feed: data.title_feed || null,
        naver_topic: data.naver_topic || null,
        thumb_caption: data.thumb_caption || null,
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
// 테스트 전용 export — 2026-08-05 JSON 파싱 회귀를 DB·네트워크 없이 검증한다
// (tests/naver-draft-json.test.js). 다른 곳에서 쓰지 말 것.
module.exports._requestDraft = requestDraft;
module.exports._salvageDraft = salvageDraft;
module.exports._DRAFT_TOOL = DRAFT_TOOL;
// 2026-08-14 홈판 전환 — 순수 로직 검증용 (tests/naver-draft-homefeed.test.js)
module.exports._NAVER_TOPICS = NAVER_TOPICS;
module.exports._draftExtras = draftExtras;
module.exports._skipCategories = skipCategories;
module.exports._isOwnCoverage = isOwnCoverage;
module.exports._isArtArticle = isArtArticle;
module.exports.artOnlyEnabled = artOnlyEnabled;
module.exports._FRAMEWORK_BLOCK = FRAMEWORK_BLOCK;
