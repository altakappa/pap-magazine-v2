/**
 * 네이버 초안 홈판 전환 (2026-08-14 신설)
 *
 * 왜 이 하네스가 필요한가 — 이 개편은 "감이 좋아서" 가 아니라 실측을 뒤집어
 * 나온 것이라, 나중에 누가 되돌릴 때 **근거 없이** 되돌리는 걸 막아야 한다.
 * 실측: 발행 213편 / 웹 유입 0명(utm 링크 50편 7일) / 인스타 하루 2.4클릭 /
 * 블로그 일 조회수 20~85 / **발행량과 조회수 무상관**(39편 날 최저, 6편 날 최고).
 *
 * 여기서 지키는 것:
 *   ① 주제 목록이 좁다 — 32종 전체를 주면 모델이 흩고, 흩으면 C-Rank 가 깎인다
 *   ② 제목이 2종이다 — 검색과 홈판은 요구가 정반대라 하나로는 둘 다 못 잡는다
 *   ③ 깨진 응답에서도 새 필드가 'undefined' 로 새지 않는다
 *   ④ 목록 밖 주제는 버린다 — 네이버 드롭다운에 없는 값은 고를 수가 없다
 *   ⑤ News 카테고리는 기본으로 제외된다 (43편 중 38편이 통신사 재탕이었다)
 *   ⑥ 본문 목표가 1,800~2,500자다 — 이걸 되돌리면 체류시간이 죽는다
 *   ⑦ max_tokens 가 본문 목표를 감당한다 — 모자라면 초안이 통째로 버려진다
 *   ⑧ 크론이 1회 1건 / 큐 5건이고, 시간 예산 가드가 있다
 *   ⑨ 화면이 새 값들을 실제로 렌더한다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('aiCreditWatch.js', { reportAiFailure: async () => ({}) });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const DRAFT_PATH = path.join(ROOT, 'api', 'admin', 'naver-blog-draft.js');
const SWEEP_PATH = path.join(ROOT, 'api', 'cron', 'naver-draft-sweep.js');
const mod = require(DRAFT_PATH);
const draftSrc = fs.readFileSync(DRAFT_PATH, 'utf8');
const sweepSrc = fs.readFileSync(SWEEP_PATH, 'utf8');

const TOPICS = mod._NAVER_TOPICS;
const extras = mod._draftExtras;
const TOOL = mod._DRAFT_TOOL;

console.log('\n=== ① 주제 목록은 좁다 ===');
{
  t('배열로 export 된다', Array.isArray(TOPICS), TOPICS);
  t('3~8개로 좁혀져 있다 (32종 전체 금지)',
    TOPICS.length >= 3 && TOPICS.length <= 8, TOPICS.length);
  t('패션·미용 포함 (전수분류 40%)', TOPICS.indexOf('패션·미용') >= 0, TOPICS);
  t('미술·디자인 포함 (홈판 공략 축)', TOPICS.indexOf('미술·디자인') >= 0, TOPICS);
  t('중복 없음', new Set(TOPICS).size === TOPICS.length, TOPICS);
  t('빈 문자열 없음', TOPICS.every((s) => typeof s === 'string' && s.trim().length > 0), TOPICS);
}

console.log('\n=== ② 도구 스키마 — 제목 2종 + 주제 + 썸네일 ===');
{
  const props = TOOL.input_schema.properties;
  const req = TOOL.input_schema.required;
  ['title', 'title_feed', 'body_html', 'tags', 'naver_topic', 'thumb_caption'].forEach((k) => {
    t('properties 에 ' + k, !!props[k], Object.keys(props));
    t('required 에 ' + k, req.indexOf(k) >= 0, req);
  });
  t('naver_topic 이 enum 으로 잠겨 있다',
    Array.isArray(props.naver_topic.enum) && props.naver_topic.enum.length === TOPICS.length,
    props.naver_topic.enum);
  t('enum 이 NAVER_TOPICS 와 같다',
    JSON.stringify(props.naver_topic.enum) === JSON.stringify(TOPICS),
    props.naver_topic.enum);
  t('title 설명은 검색용(키워드 앞배치)', /키워드/.test(props.title.description), props.title.description);
  t('title_feed 설명은 홈판/호기심', /호기심/.test(props.title_feed.description), props.title_feed.description);
}

console.log('\n=== ③ 깨진 응답에서도 undefined 가 안 샌다 ===');
{
  // salvageDraft 경로는 title/body_html/tags 만 복구한다 → 나머지가 undefined
  const e = extras({ title: 'x', body_html: 'y', tags: [] });
  t('title_feed 는 null', e.title_feed === null, e);
  t('naver_topic 은 null', e.naver_topic === null, e);
  t('thumb_caption 은 null', e.thumb_caption === null, e);
  t('undefined 이 하나도 없다',
    Object.keys(e).every((k) => e[k] !== undefined), e);

  const e2 = extras(null);
  t('draft 자체가 null 이어도 안 터진다', e2 && e2.title_feed === null, e2);

  const e3 = extras({ title_feed: '   ' });
  t('공백만 있는 제목은 null', e3.title_feed === null, e3);
}

console.log('\n=== ④ 목록 밖 주제는 버린다 ===');
{
  t('목록 안 주제는 통과', extras({ naver_topic: TOPICS[0] }).naver_topic === TOPICS[0]);
  t('목록 밖 주제는 null (네이버에서 고를 수 없는 값)',
    extras({ naver_topic: '요리·레시피' }).naver_topic === null);
  t('비슷하지만 다른 문자열도 null',
    extras({ naver_topic: '패션 미용' }).naver_topic === null);
  t('앞뒤 공백은 다듬어서 통과',
    extras({ naver_topic: '  ' + TOPICS[0] + '  ' }).naver_topic === TOPICS[0]);
  const long = extras({ thumb_caption: 'ㄱ'.repeat(200) });
  t('썸네일 문구는 잘린다', long.thumb_caption.length === 40, long.thumb_caption.length);
}

console.log('\n=== ⑤ News 는 기본 제외 ===');
{
  const before = process.env.NAVER_DRAFT_SKIP_CATEGORIES;

  delete process.env.NAVER_DRAFT_SKIP_CATEGORIES;
  const d = mod._skipCategories();
  t('기본값이 News 를 막는다', d.has('news'), Array.from(d));
  t('Fashion 은 안 막는다', !d.has('fashion'), Array.from(d));
  t('Culture 는 안 막는다 (자체 취재 연예는 여기로 들어온다)', !d.has('culture'), Array.from(d));

  process.env.NAVER_DRAFT_SKIP_CATEGORIES = '';
  t('빈 문자열이면 전부 허용', mod._skipCategories().size === 0);

  process.env.NAVER_DRAFT_SKIP_CATEGORIES = 'News, Beauty';
  const two = mod._skipCategories();
  t('쉼표 목록이 먹는다', two.has('news') && two.has('beauty'), Array.from(two));

  if (before === undefined) delete process.env.NAVER_DRAFT_SKIP_CATEGORIES;
  else process.env.NAVER_DRAFT_SKIP_CATEGORIES = before;

  // 컬럼이 더 붙어도 안 깨지게 'category 를 읽는가' 만 본다 (⑩ 이 캡션을 더 붙였다).
  // select 문자열이 + 로 이어붙여지므로 닫는 따옴표까지 잠그면 안 된다.
  t('기사 조회가 category 를 실제로 읽어온다',
    /\.select\('[^']*\bcategory\b[^']*'/.test(draftSrc));
  t('조회 결과에 skip 필터가 걸려 있다',
    /const skip = skipCategories\(\)[\s\S]{0,200}!skip\.has\(String\(r\.category/.test(draftSrc));
}

console.log('\n=== ⑥ 본문 목표 1,800~2,500자 ===');
{
  const fb = mod._FRAMEWORK_BLOCK;
  t('프레임워크에 1,800~2,500자가 박혀 있다', /1,800~2,500자/.test(fb), fb.slice(0, 80));
  t('짧게 쓰지 말라는 근거가 남아 있다', /1,000자짜리는/.test(fb));
  t('분량 채우려 늘리지 말라는 제동이 있다', /같은 말을 늘리지/.test(fb));
  t('없는 사실 지어내기 금지가 있다', /지어내는 것은 절대 금지/.test(fb));
  t('옛 목표(600~1000자)가 남아 있지 않다', !/600~1000자/.test(draftSrc), '600~1000자 잔존');

  t('제목 2종 지시가 있다', /title_feed \(홈판용\)/.test(fb));
  t('댓글 유도는 물음표 강제', /반드시 물음표로 끝나는 질문/.test(fb));
  t('열린 질문 금지 근거가 있다', /답이 안 달린다/.test(fb));
  t('태그 18개', /태그 18개/.test(fb), 'FRAMEWORK_BLOCK');
}

console.log('\n=== ⑦ max_tokens 가 본문 목표를 감당한다 ===');
{
  // 2,500자 한국어 + HTML + 제목 2종 + 태그 18 → 2500 토큰으로는 확실히 잘린다.
  // 잘리면 기존 코드가 throw 해서 초안이 통째로 버려진다(비용만 나감).
  const calls = draftSrc.match(/requestDraft\(prompt,\s*(\d+),/g) || [];
  t('requestDraft 호출이 2곳 (기사 · 에디토리얼)', calls.length === 2, calls);
  const nums = calls.map((s) => parseInt(s.match(/(\d+)/)[1], 10));
  t('둘 다 6000 이상', nums.every((n) => n >= 6000), nums);
  /* 2026-08-17: 태그 조립이 brandTags() 로 이사 (팝매거진·PAP매거진 브랜드 태그
     주입 — 도메니코 지시). 상한 18 이라는 뜻은 그대로다. */
  t('태그 상한 18 유지 (brandTags 경유)', /brandTags\(/.test(draftSrc) && /slice\(0, 18\)/.test(draftSrc));
  t('브랜드 태그가 pap 에만 주입된다', /brand !== 'pap'\) return base\.slice\(0, 18\)/.test(draftSrc)
    && /'팝매거진', 'PAP매거진'/.test(draftSrc));
  t('slice(0, 10) 태그 상한이 남아 있지 않다', !/draft\.tags\.slice\(0, 10\)/.test(draftSrc));
}

console.log('\n=== ⑧ 크론 — 1회 1건 / 큐 5건 / 시간 예산 ===');
{
  t('DAILY_MAX 기본값 1', /NAVER_DRAFT_DAILY_MAX \|\| '1'/.test(sweepSrc));
  t('QUEUE_MAX 기본값 5', /NAVER_DRAFT_QUEUE_MAX \|\| '5'/.test(sweepSrc));
  t('시간 예산 상수가 있다', /SWEEP_BUDGET_MS/.test(sweepSrc));
  t('다음 한 건의 최악을 예약해 둔다 (sync-instagram 교훈)',
    /SWEEP_BUDGET_MS - PER_DRAFT_RESERVE_MS/.test(sweepSrc));
  // 예약분이 requestDraft 의 90s 타임아웃 이상이어야 의미가 있다
  const reserve = parseInt((sweepSrc.match(/PER_DRAFT_RESERVE_MS = (\d+)/) || [])[1], 10);
  t('예약분이 90s API 타임아웃 이상', reserve >= 90000, reserve);
  const budget = parseInt((sweepSrc.match(/NAVER_DRAFT_BUDGET_MS \|\| (\d+)/) || [])[1], 10);
  t('예산이 Vercel 120s 상한보다 작다', budget > 0 && budget < 120000, budget);
  t('첫 건은 예산 검사로 건너뛰지 않는다 (i > 0)',
    /if \(i > 0 && Date\.now\(\) - SWEEP_STARTED/.test(sweepSrc));
  t('이월 건수를 보고한다', /다음 회차 이월/.test(sweepSrc));
  t('응답에 deferred 가 실린다', /expired, deferred, queueDraftCount/.test(sweepSrc));
}

console.log('\n=== ⑨ 저장·조회·화면 배선 ===');
{
  t('upsert 가 새 컬럼 3개를 쓴다',
    /title_feed: draft\.title_feed[\s\S]{0,120}naver_topic: draft\.naver_topic[\s\S]{0,120}thumb_caption: draft\.thumb_caption/.test(draftSrc));
  t('stored 조회가 새 컬럼 3개를 돌려준다',
    /title_feed: data\.title_feed[\s\S]{0,120}naver_topic: data\.naver_topic[\s\S]{0,120}thumb_caption: data\.thumb_caption/.test(draftSrc));

  const mig = path.join(ROOT, 'supabase_migrations', '123_naver_draft_homefeed_fields.sql');
  t('마이그레이션 파일이 있다', fs.existsSync(mig), mig);
  if (fs.existsSync(mig)) {
    const sql = fs.readFileSync(mig, 'utf8');
    ['title_feed', 'naver_topic', 'thumb_caption'].forEach((c) => {
      t('마이그레이션이 ' + c + ' 를 추가한다',
        new RegExp('ADD COLUMN IF NOT EXISTS\\s+' + c).test(sql));
    });
    t('재실행 안전 (IF NOT EXISTS)', !/ADD COLUMN\s+(?!IF NOT EXISTS)/.test(sql));
  }

  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'naver-blog.html'), 'utf8');
  t('화면에 검색용 제목 라벨', /제목 — 검색용/.test(html));
  t('화면에 홈판용 제목 라벨', /제목 — 홈판용/.test(html));
  t('홈판 제목은 값이 있을 때만 렌더', /feed\s*\?/.test(html));
  t('주제 칩이 렌더된다', /주제: '/.test(html) || /주제: /.test(html));
  t('썸네일 문구 칩이 렌더된다', /썸네일 문구/.test(html));
  t('사용법에 주제 지정 단계가 추가됐다', /주제<\/b>를 위 값으로 지정/.test(html));
  // 값이 없는 옛 초안(268행)을 열어도 깨지지 않아야 한다
  t('naver_topic/thumb_caption 없으면 블록 자체를 안 만든다',
    /if \(j\.naver_topic \|\| j\.thumb_caption\)/.test(html));
}

console.log('\n=== ⑩ 자체 취재 판별 (🎥 PAP) ===');
{
  const own = mod._isOwnCoverage;

  // 실제 캡션에서 뽑은 문자열 (legacy_image_recovery 실측)
  t('🎥 PAP → 자체 취재',
    own('...legendary Waterbomb performance.\n\n🎥 PAP') === true);
  t('🎥 @jamiroquaihq → 남의 것',
    own('...first full-length release in nine years.\n\n🎥 @jamiroquaihq') === false);
  t('🎥 YouTube | KATSEYE → 남의 것',
    own('...what [ANIMAL] has in store.\n\n🎥 YouTube | KATSEYE') === false);
  t('한국어 캡션에서도 잡힌다',
    own('당신의 생각은 어떤가. \n\n🎥 PAP') === true);
  t('크레딧 목록 뒤에 붙어도 잡힌다',
    own('Director: @daniel.kim.official\n\n🎥 PAP') === true);

  t('캡션 없음(옛 기사) → false', own(null) === false && own(undefined) === false && own('') === false);
  t('🎥 없이 PAP 만 있으면 false (본문에 흔히 나온다)',
    own('PAP MAGAZINE 원문에서 보실 수 있어요') === false);
  t('이모지만 있고 크레딧이 없으면 false', own('🎥 촬영 현장 스케치') === false);
  t('PAPARAZZI 는 오탐 아님 (단어 경계)', own('🎥 PAPARAZZI') === false);
  t('🎥 PAP MAGAZINE 은 우리 것', own('🎥 PAP MAGAZINE') === true);
  t('@pap_magazine 크레딧도 우리 것', own('🎥 @pap_magazine') === true);

  /* 2026-08-17 정정 — 캡션 백필 첫 회차 57건 실측에서 나온 것.
     영상은 🎥, 사진은 📸 를 쓴다. 둘 다 자체 취재인데 🎥 만 보고 있어서
     📸 PAP 2건을 놓치고 있었다(8건만 잡힘). 실제 캡션 문자열로 고정한다. */
  t('📸 PAP → 자체 취재 (사진 기사)', own('📸 PAP') === true);
  t('📸 @pap_magazine → 자체 취재', own('📸 @pap_magazine') === true);
  t('📸 @jennierubyjane → 남의 것', own('📸 @jennierubyjane') === false);
  t('📸 PAPARAZZI 는 오탐 아님', own('📸 PAPARAZZI') === false);
  // 외부가 주고 PAP 가 보조인 혼합은 자체 취재가 아니다.
  // 이모지 '바로 뒤' 를 요구하는 규칙이라 자연히 빠진다.
  t('📸 @esdevlin @futuraseoul , PAP → 자체 취재 아님',
    own('📸 @esdevlin @futuraseoul , PAP') === false);
  t('🎥 각 셀럽 인스타그램, PAP → 자체 취재 아님',
    own('🎥 각 셀럽 인스타그램, PAP') === false);

  {
    const before = process.env.NAVER_DRAFT_OWN_MARK;
    process.env.NAVER_DRAFT_OWN_MARK = '📷\\s*PAP';
    t('env 로 표기를 바꿀 수 있다 (배포 없이)',
      own('📷 PAP') === true && own('🎥 PAP') === false);
    process.env.NAVER_DRAFT_OWN_MARK = '((((';   // 깨진 정규식
    t('깨진 정규식이어도 안 터지고 기본값으로 돈다', own('🎥 PAP') === true);
    if (before === undefined) delete process.env.NAVER_DRAFT_OWN_MARK;
    else process.env.NAVER_DRAFT_OWN_MARK = before;
  }

  t('조회가 instagram_caption 을 읽어온다',
    /\.select\('id, slug[^']*instagram_caption[^']*published_date/.test(draftSrc));
  t('단건 조회도 instagram_caption 을 읽어온다',
    /source_instagram_url, instagram_caption'/.test(draftSrc));
  t('선정이 자체 취재를 먼저 고른다',
    /const own = \w+\.filter\(\(r\) => r\.own\)/.test(draftSrc));
  // 폴백이 없으면 캡션이 없는 3일 동안 초안 생성이 통째로 멈춘다
  t('자체 취재가 없으면 전체에서 고른다 (폴백)',
    /const pool = own\.length \? own : \w+/.test(draftSrc));
  t('프롬프트가 자체 취재 여부를 알려준다',
    /PAP가 현장에서 직접 촬영한 자체 취재다/.test(draftSrc));
  t('자체 취재가 아니면 현장에 있었던 척 금지',
    /현장에 있었던 것처럼 쓰지 말 것/.test(draftSrc));

  const imp = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'instagramImport.js'), 'utf8');
  t('수집 시 캡션을 실제로 저장한다',
    /instagram_caption:\s*post\.caption \|\| null/.test(imp));

  const mig = path.join(ROOT, 'supabase_migrations', '124_articles_instagram_caption.sql');
  t('마이그레이션 124 가 있다', fs.existsSync(mig));
  if (fs.existsSync(mig)) {
    const sql = fs.readFileSync(mig, 'utf8');
    t('articles 에 instagram_caption 을 추가한다',
      /ALTER TABLE public\.articles[\s\S]{0,80}ADD COLUMN IF NOT EXISTS instagram_caption/.test(sql));
  }
}

console.log('\n' + (fail ? '✗' : '✓') + ' naver-draft-homefeed: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
