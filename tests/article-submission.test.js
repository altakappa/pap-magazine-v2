/**
 * 아티클 기고 회귀 테스트 (2026-11-12)
 * ─────────────────────────────────────────────────────────────────────
 * 설계안 §7 의 아티클 항목을 그대로 옮긴 것이다. 되돌아가면 여기서 잡힌다.
 *
 * 특히 지키려는 것 네 가지:
 *  ① **AI 가 요금을 매기지 않는다.** 점수·근거·인용·브랜드 목록만 올린다.
 *     (2026-11-08: AI 가 캡션에 없는 사실을 지어내 19개 기사를 고쳤다.)
 *  ② **분석 실패가 접수를 막지 않는다.** analyzePromo 는 절대 throw 하지 않는다.
 *  ③ **발행은 사람이 한다.** 승인은 articles 에 status='draft' 를 만드는 데까지.
 *  ④ **본문은 평문이다.** articles.content 는 공개 상세에서 innerHTML 로 들어간다
 *     (frontend/pap-content-article.js). 태그를 받으면 저장형 XSS 가 된다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
/* 주석을 떼고 코드만 본다. "이 파일에는 published 경로가 없다" 를 설명하는
   주석 자체가 'published' 를 포함하므로, 주석을 남기면 설명이 검사에 걸린다. */
const CODE = (f) => R(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^\n]*$/gm, '');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const A = require('../api/_lib/articleSubmission');
const AI = require('../api/_lib/articlePromoAi');

// ── 1. 분류 화이트리스트와 카테고리 매핑 ──
console.log('=== 1. 분류 화이트리스트 ===');
t('7개 분류가 전부 매핑된다', A.TOPICS.length === 7 && A.TOPICS.every((x) => !!A.categoryForTopic(x)), A.TOPICS.join(','));
t('화이트리스트 밖은 받지 않는다', A.normalizeTopic('politics') === null && A.normalizeTopic('') === null && A.normalizeTopic(null) === null);
t('자동번역·표기 흔들림을 흡수한다 (IT→tech, sports→sport)',
  A.normalizeTopic('IT') === 'tech' && A.normalizeTopic('Sports') === 'sport' && A.normalizeTopic(' Life ') === 'lifestyle');
t('트렌드·테크·스포츠는 Culture 로 모인다',
  A.categoryForTopic('trend') === 'Culture' && A.categoryForTopic('tech') === 'Culture' && A.categoryForTopic('sport') === 'Culture');
t('패션·뷰티·라이프스타일·아트 매핑',
  A.categoryForTopic('fashion') === 'Fashion' && A.categoryForTopic('beauty') === 'Beauty'
  && A.categoryForTopic('lifestyle') === 'Life' && A.categoryForTopic('art') === 'Art');

// ── 2. 작성 언어와 본문 하한 ──
console.log('\n=== 2. 본문 하한 (영문 800단어 / 국문 1,600자) ===');
t('작성 언어는 ko·en 만', A.normalizeBodyLang('en') === 'en' && A.normalizeBodyLang('KO') === 'ko'
  && A.normalizeBodyLang('ja') === null && A.normalizeBodyLang('') === null);
{
  const en799 = Array(799).fill('word').join(' ');
  const en800 = Array(800).fill('word').join(' ');
  t('영문 799단어는 탈락, 800단어는 통과',
    A.measureBody(en799, 'en').ok === false && A.measureBody(en800, 'en').ok === true,
    '799→' + A.measureBody(en799, 'en').count + ' 800→' + A.measureBody(en800, 'en').count);
  t('영문 단위는 words, 하한 800', A.measureBody(en800, 'en').unit === 'words' && A.measureBody(en800, 'en').min === 800);
}
{
  const ko1599 = '가'.repeat(1599);
  const ko1600 = '가'.repeat(1600);
  t('국문 1,599자는 탈락, 1,600자는 통과',
    A.measureBody(ko1599, 'ko').ok === false && A.measureBody(ko1600, 'ko').ok === true);
  t('국문 단위는 chars, 하한 1,600', A.measureBody(ko1600, 'ko').unit === 'chars' && A.measureBody(ko1600, 'ko').min === 1600);
  // 공백을 포함해 세면 줄바꿈이 많은 글이 유리해진다 — 그래서 공백은 빼고 센다.
  t('국문은 공백을 빼고 센다 (줄바꿈으로 분량을 채울 수 없다)',
    A.countChars('가 나\n다\t라') === 4);
}
t('작성 언어가 비어 있으면 영문 규칙으로 센다 (기본값이 느슨해지지 않게)',
  A.measureBody('word '.repeat(10), '').unit === 'words');

// ── 3. 본문은 평문 — articles.content 가 innerHTML 로 들어간다 ──
console.log('\n=== 3. 본문 태그 금지 + 안전 HTML 변환 ===');
t('태그를 잡는다', A.hasHtmlTag('<script>x</script>') && A.hasHtmlTag('<img src=x onerror=1>')
  && A.hasHtmlTag('글 <b>강조</b>') && A.hasHtmlTag('</div>'));
t('평문은 통과한다', !A.hasHtmlTag('a < b 이고 c > d 인 경우') && !A.hasHtmlTag('plain text') && !A.hasHtmlTag(''));
// 거부 목록을 넓게 치면 IT·테크 글이 막힌다. 태그가 없으면 실행도 안 된다.
t('IT 글이 javascript: 를 써도 막히지 않는다 (태그가 없으면 실행 경로가 없다)',
  !A.hasHtmlTag('브라우저는 javascript: 스킴을 더 이상 신뢰하지 않는다'));
{
  const html = A.bodyToSafeHtml('first <b>para</b> & more\n\nsecond\nline');
  t('문단마다 <p> 로 감싸고 안쪽은 이스케이프한다',
    html.indexOf('<p>') === 0 && html.indexOf('&lt;b&gt;') !== -1 && html.indexOf('&amp;') !== -1
    && html.indexOf('<b>') === -1, html.slice(0, 160));
  t('문단 안 줄바꿈은 <br> 로, 문단 사이는 새 <p> 로',
    (html.match(/<p>/g) || []).length === 2 && html.indexOf('<br>') !== -1);
  t('따옴표도 이스케이프한다 (속성에 들어가도 안전)',
    A.escapeHtml('a"b\'c') === 'a&quot;b&#39;c');
}

// ── 4. AI 홍보성 분석 — 판정이 아니라 의견 ──
console.log('\n=== 4. AI 홍보성 분석 ===');
t('점수를 0~100 으로 묶는다', AI.parseVerdict('{"score":500}').score === 100
  && AI.parseVerdict('{"score":-20}').score === 0 && AI.parseVerdict('{"score":63}').score === 63);
t('점수가 없으면 결과가 아니다 (null)', AI.parseVerdict('{"reasons":["x"]}') === null
  && AI.parseVerdict('쓰레기') === null && AI.parseVerdict('') === null);
t('근거·인용·브랜드를 배열로 돌려준다', (function () {
  const v = AI.parseVerdict('{"score":80,"reasons":["a","b"],"quotes":["q"],"brands":["X","Y"],"primary_subject":"X"}');
  return v && v.reasons.length === 2 && v.quotes.length === 1 && v.brands.length === 2 && v.primarySubject === 'X';
})());
// 지어낸 인용을 걸러내기 위한 관문 — 버리지 않고 verified:false 로 남긴다
// (지어냈다는 사실 자체가 그 분석 전체를 의심할 근거다).
{
  const body = '조용한 럭셔리는 끝났다. 소비자는 다시 로고를 원한다.';
  const q = AI.verifyQuotes(['소비자는 다시 로고를 원한다.', '이 브랜드는 최고다.'], body);
  t('본문에 있는 인용은 verified:true', q[0].verified === true);
  t('본문에 없는 인용은 verified:false 로 표시해서 남긴다 (조용히 버리지 않는다)',
    q[1].verified === false && q.length === 2);
  t('따옴표·공백 차이는 흡수한다',
    AI.verifyQuotes(['“소비자는  다시 로고를 원한다.”'.replace(/[“”]/g, '')], body)[0].verified === true);
}
t('프롬프트가 "브랜드 수가 아니라 목적" 을 기준으로 삼는다',
  /PURPOSE, not brand count/.test(AI.SYSTEM) && /press release/i.test(AI.SYSTEM));
t('인용은 그대로 베끼라고 못 박는다 (지어내기 금지)',
  /COPIED VERBATIM/.test(AI.SYSTEM) && /never invent/i.test(AI.SYSTEM));
t('AI 는 결과·요금을 정하지 않는다고 프롬프트에 적혀 있다',
  /do not decide fees or outcomes/i.test(AI.SYSTEM));

// 요금 관련 키를 아예 내보내지 않는다 — 관리자 화면이 실수로 집어 쓸 수 없게.
(async function () {
  const okAi = await AI.analyzePromo(
    { title: 'T', body: 'b', body_lang: 'en' },
    { ask: async () => ({ text: '{"score":91,"reasons":["press release tone"],"quotes":["b"],"brands":["Z"]}', model: 'test' }) });
  t('성공 결과에 요금·판정 키가 없다 (fee/feeType/verdict/branded)',
    okAi.ok === true && !('fee' in okAi) && !('feeType' in okAi) && !('verdict' in okAi) && !('branded' in okAi),
    Object.keys(okAi).join(','));
  t('성공 결과는 점수·근거·인용·브랜드만 담는다',
    okAi.score === 91 && Array.isArray(okAi.reasons) && Array.isArray(okAi.quotes) && Array.isArray(okAi.brands));

  const thrown = await AI.analyzePromo({ title: 'T', body: 'b' }, { ask: async () => { throw new Error('boom'); } });
  t('ask 가 터져도 throw 하지 않고 ok:false 로 돌려준다 (접수를 막지 않는다)',
    thrown && thrown.ok === false && !!thrown.error);
  const noText = await AI.analyzePromo({ title: 'T', body: 'b' }, { ask: async () => ({ error: 'http_529' }) });
  t('AI 가 안 되면 ok:false + error', noText.ok === false && noText.error === 'http_529');
  const unparsed = await AI.analyzePromo({ title: 'T', body: 'b' }, { ask: async () => ({ text: 'not json' }) });
  t('파싱 실패도 ok:false (점수를 추측하지 않는다)', unparsed.ok === false && unparsed.error === 'parse_failed');

  // ── 5. 접수 API 의 검증 ──
  console.log('\n=== 5. 접수 API ===');
  const IDX = CODE('api/article-submissions/index.js');
  t('동의 없으면 400 — 소셜 게재 동의', /SOCIAL_CONSENT_REQUIRED/.test(IDX));
  t('동의 없으면 400 — 약관', /TERMS_REQUIRED/.test(IDX));
  t('홍보성 자진신고를 고르지 않으면 400', /PROMO_DECLARATION_REQUIRED/.test(IDX));
  t('본문 하한 미달이면 400', /BODY_TOO_SHORT/.test(IDX));
  t('본문에 태그가 있으면 400 (평문만)', /A\.hasHtmlTag\(articleBody\)/.test(IDX) && /BODY_HTML_REJECTED/.test(IDX));
  t('분류 화이트리스트 밖이면 400', /TOPIC_INVALID/.test(IDX) && /A\.normalizeTopic/.test(IDX));
  t('이미지 상한을 서버가 막는다', /TOO_MANY_IMAGES/.test(IDX) && /A\.MAX_BODY_IMAGES/.test(IDX));
  t('모든 이미지 URL 이 자기 폴더 아래인지 확인한다', /isOwnedUrl\(coverUrl, prefix\)/.test(IDX) && /URL_NOT_OWNED/.test(IDX));
  t('웹사이트는 스킴을 검증한다 (safeHttpUrl)', /safeHttpUrl\(d\.authorWebsite/.test(IDX) && /WEBSITE_INVALID/.test(IDX));
  t('제출 단계에서는 청구가 없다 (fee_type=free · payment_status=none)',
    /fee_type: 'free'/.test(IDX) && /payment_status: 'none'/.test(IDX));
  t('소셜 동의를 기록한다 (social_consent)', /social_consent: true/.test(IDX));
  t('자진신고를 기록한다 (promo_self_declared)', /promo_self_declared: promoSelfDeclared/.test(IDX));
  t('접수는 pending 으로만 들어간다', /status: 'pending'/.test(IDX) && !/status: 'approved'/.test(IDX));
  t('INSERT 가 분석보다 먼저다 (분석 실패가 접수를 못 막는 구조)',
    IDX.indexOf(".from('article_submissions')") < IDX.indexOf('analyzePromo('));
  t('오류 응답에 원문을 싣지 않는다 (code 만)',
    /code: 'create_failed'/.test(IDX) && !/error\.message/.test(IDX.split('return res.status(500)')[1] || ''));
  t('메일·텔레그램은 await (서버리스 프리즈로 fire-and-forget 은 안 나간다)',
    /await sendEmail\(/.test(IDX) && /await sendTextToTelegramSafe\(/.test(IDX));

  // ── 6. 심사 — 발행은 사람이 한다 ──
  console.log('\n=== 6. 심사 (관리자) ===');
  const RV = CODE('api/article-submissions/[id]/review.js');
  t("articles INSERT 는 status='draft' 로만 (절대 규칙 4)", /status: 'draft'/.test(RV));
  t("소스에 published 로 넣거나 바꾸는 경로가 없다",
    !/status: 'published'/.test(RV) && !/'published'/.test(RV));
  t('기고 출처를 남긴다 (source_article_submission_id)', /source_article_submission_id: sub\.id/.test(RV));
  t('credits 는 배열로 넣는다 (렌더러가 배열을 돈다)', /credits: bylineName\s*\n?\s*\?\s*\[\{/.test(RV) || /\? \[\{ role: 'Words'/.test(RV));
  t('본문은 안전한 HTML 로 바꿔 넣는다 (bodyToSafeHtml)', /A\.bodyToSafeHtml\(sub\.body\)/.test(RV));
  t('홍보성(€790) 인데 미결제면 승인하지 않는다 (409 fee_unpaid)',
    /fee_unpaid/.test(RV) && /PAID_OK\.indexOf\(String\(sub\.payment_status\)\) === -1/.test(RV));
  t('€790 금액을 따로 적지 않고 공용 상수를 쓴다 (두 벌이면 한쪽만 올라간다)',
    /SUBMISSION_FEE_CENTS\.branded/.test(RV) && !/79000/.test(RV));
  t('branded 판정 시 payment_status 를 awaiting_authorization 으로',
    /payment_status: 'awaiting_authorization'/.test(RV) && /fee_notified_at: now/.test(RV));
  t('€790 안내 메일을 보낸다', /templates\.articleSubmissionFee/.test(RV));
  t('이미 결제된 건을 free 로 되돌리지 않는다 (환불은 코드로 하지 않는다)', /already_settled/.test(RV));
  t('승인·거절 메일이 있다',
    /templates\.articleSubmissionApproved/.test(RV) && /templates\.articleSubmissionRejected/.test(RV));
  t('심사 응답에도 원문 에러를 싣지 않는다', /code: 'review_failed'/.test(RV));

  // ── 7. 재분석 엔드포인트는 요금을 건드리지 않는다 ──
  console.log('\n=== 7. 재분석 (관리자) ===');
  const AN = CODE('api/article-submissions/[id]/analyze.js');
  t('관리자만', /requireAdmin/.test(AN));
  t('promo_ai 만 쓴다 — fee_type·payment_status 를 건드리지 않는다',
    /promo_ai: ai/.test(AN) && !/fee_type/.test(AN) && !/payment_status/.test(AN));

  // ── 8. 내 목록은 관리자 칸을 내려주지 않는다 ──
  console.log('\n=== 8. 마이페이지 목록 ===');
  const MN = CODE('api/article-submissions/mine.js');
  t('본인 것만 조회한다', /\.eq\('user_id', user\.id\)/.test(MN));
  const sel = (MN.match(/\.select\('([^']+)'\)/) || [])[1] || '';
  t('AI 점수와 관리자 메모는 내려가지 않는다 (제출자에게 보일 값이 아니다)',
    sel.indexOf('promo_ai') === -1 && sel.indexOf('admin_notes') === -1, sel);
  t('본문 전체를 목록에 싣지 않는다', /\bbody\b/.test(sel) === false, sel);

  // ── 9. 새 표는 service_role 전용 ──
  console.log('\n=== 9. 마이그레이션 183 ===');
  const M = R('supabase_migrations/183_article_submissions.sql');
  t('RLS 를 켠다', /ENABLE ROW LEVEL SECURITY/.test(M));
  t('정책을 만들지 않는다 (= 전면 거부)', !/CREATE POLICY/i.test(M));
  t('anon·authenticated 그랜트를 회수한다 (정책과 그랜트 두 겹)',
    /REVOKE ALL ON public\.article_submissions FROM anon, authenticated/.test(M));
  t('기고 출처 컬럼을 articles 에 더한다', /ADD COLUMN IF NOT EXISTS source_article_submission_id/.test(M));
  t('결제 컬럼이 에디토리얼과 같은 이름이다 (결제 배선 재사용)',
    /payment_status/.test(M) && /paypal_authorization_id/.test(M) && /authorization_expires_at/.test(M));

  // ── 10. 폼과 서버가 같은 규칙을 본다 ──
  console.log('\n=== 10. 폼 ↔ 서버 규칙 정합 ===');
  const F = R('frontend/submission-article.html');
  t('폼의 하한 숫자가 서버와 같다',
    new RegExp('MIN_EN_WORDS = ' + A.MIN_EN_WORDS).test(F) && new RegExp('MIN_KO_CHARS = ' + A.MIN_KO_CHARS).test(F));
  t('폼의 이미지 상한이 서버와 같다', new RegExp('MAX_IMAGES = ' + A.MAX_BODY_IMAGES).test(F));
  t('폼이 7개 분류를 모두 내놓고, 값이 서버 화이트리스트와 같다',
    A.TOPICS.every((x) => F.indexOf('data-topic="' + x + '"') !== -1),
    A.TOPICS.filter((x) => F.indexOf('data-topic="' + x + '"') === -1).join(','));
  t('폼도 본문 태그를 먼저 막는다 (서버까지 가기 전에 알려준다)', /errBodyHtml/.test(F));
  t('폼이 서버 code 를 화면 문구로 매핑한다 (api 규칙)',
    /BODY_TOO_SHORT: 'errShort'/.test(F) && /SOCIAL_CONSENT_REQUIRED: 'errSocial'/.test(F));
  t('동의·자진신고 없이 제출 버튼이 통과하지 않는다',
    /if \(!\$\('social'\)\.checked\)/.test(F) && /if \(!\$\('terms'\)\.checked\)/.test(F) && /if \(!promoEl\)/.test(F));
  t('이미지는 기존 버킷의 2단계 직접 업로드를 쓴다 (버킷 MIME 어긋남을 안 만든다)',
    /\/api\/submissions\/upload-url/.test(F) && /u\.contentType \|\| files\[i\]\.type/.test(F));
  t('홍보성 €790 안내가 폼에도 적혀 있다', /glPaidTitle/.test(F) && /790/.test(F));

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ article-submission tests FAILED'); process.exit(1); }
  console.log('✅ article-submission tests passed');
})();
