/**
 * SSR·SPA 화면 통일 — tests/spa-parity.test.js (2026-08-08 신설)
 *
 * 왜 만들었나 ────────────────────────────────────────────────────────
 * 도메니코 (반복 지적, 오래된 미해결):
 *   "주소경로로 바로 들어가서 보는 거랑 홈에서부터 타고 들어가는 거랑
 *    에디토리얼과 기사페이지의 디자인과 구성이 달라. 일치시켜 달라고
 *    지속적으로 얘기했었어."
 *
 * 실측한 갈래 (2026-08-08):
 *   ① 기사만 SSR→SPA 브릿지가 없었다 — 직접 진입자는 SSR 디자인,
 *      사이트 내 진입자는 SPA 디자인을 봤다 (에디토리얼·필름은 브릿지 有)
 *   ② FAQ·MORE ARTICLES 는 SSR 에만 있었다 — SPA 에 그릴 코드 자체가 없음
 *   ③ 에디토리얼 IG 임베드: 코드는 있는데 ig 를 채우는 상세 GET 이
 *      "이미지·크레딧·설명 전부 없을 때"만 나가서 사실상 안 떴다
 *   ④ 참여 블록 CSS 가 SSR 인라인에만 있어 SPA 에선 맨몸으로 떴다
 *   ⑤ 에디토리얼·필름 SPA 에는 참여 블록 마운트가 아예 없었다
 *      (실사용자는 전원 SPA 브릿지 → 아무도 못 봤다)
 *   ⑥ 기사 SPA 에 댓글창이 두 개 (구 커뮤니티 + 새 참여 블록)
 *
 * 여기서 지키는 것: 위 여섯 갈래가 다시 벌어지지 않는다.
 * 원칙: 규칙이 두 벌이면 한쪽만 고쳐진다 — 화면·데이터·스타일 전부 한 벌로.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const seo = R('api/_lib/seoRenderer.js');
const seoJs = R('frontend/pap-content-seo.js');
const artJs = R('frontend/pap-content-article.js');
const edJs = R('frontend/pap-content-editorial.js');
const filmJs = R('frontend/pap-content-film.js');
const sync = R('frontend/pap-content-api-sync.js');
const eng = R('frontend/pap-engage.js');
const idx = R('frontend/index.html');
const arts = R('frontend/articles.html');
const films = R('frontend/films.html');
const moreLib = R('api/_lib/moreArticles.js');
const artDetail = R('api/articles/[id].js');
const slugSsr = R('api/seo/article/[slug].js');

console.log('\n[1] 기사 브릿지 — 직접 진입도 사이트 내 클릭과 같은 화면');
{
  t('브릿지가 article 을 포함한다',
    /kind === 'editorial' \|\| kind === 'film' \|\| kind === 'article'/.test(seo));
  t("기사 파람은 'art'", /kind === 'article' \? 'art' : 'ed'/.test(seo));
  t('artid(uuid) 안전핀을 싣는다 — 전량 동기화(수 초)보다 빨리 열기 위해',
    /'&artid=' \+ String\(record\.id\)/.test(seo));
  t('크롤러 UA 필터 유지 (GSC 리디렉션-페이지 3,588건 재발 방지)',
    /bot\|crawler\|spider/.test(seo));
  t('루프 가드(_pap_ssr_bounce) 유지', /_pap_ssr_bounce/.test(seo));
  t('숏폼은 여전히 브릿지 없음 (딥링크 미구현 — 알고 뺀 것)',
    /Shorts still skip the redirect/.test(seo));
}

console.log('\n[2] ?art= 딥링크 — SPA 가 받아서 오버레이로 연다');
{
  t('?art= IIFE 가 있다', /params\.get\('art'\)/.test(seoJs));
  t('artData 를 폴링한다 (동기화가 비동기라 즉시는 없을 수 있다)',
    /typeof artData === 'undefined'/.test(seoJs));
  t('slug 뿐 아니라 제목 하이픈 변환으로도 찾는다 (레거시 기사)',
    /_articleTitleToSlug\(String\(\(artData\[j\] \|\| \{\}\)\.t/.test(seoJs));
  t('2.5초에 uuid 단건 fetch 로 폴백한다', /elapsed >= 2500/.test(seoJs)
    && /_papFetchArticleById/.test(seoJs));
  t('열리면 루프 가드를 지운다 (안 지우면 새로고침이 SSR 에 갇힌다)',
    /artDetailOverlay[\s\S]{0,120}removeItem\('_pap_ssr_bounce'\)/.test(seoJs));
  t('언어 파람을 기억한다 (ed·film 과 동일)', /_dlLangA/.test(seoJs));
  t('단건 fetch 훅이 api-sync 에 있다', /window\._papFetchArticleById = function/.test(sync));
  t('딥링크 커버가 art·film 도 가린다 (홈 플래시 방지)',
    /params\.get\('ed'\)\|\|params\.get\('film'\)\|\|params\.get\('art'\)/.test(idx));
}

console.log('\n[3] FAQ·MORE ARTICLES — SSR 에만 있던 섹션이 SPA 에도');
{
  t('SPA 에 FAQ 렌더러가 있다', /function _renderArticleFaq/.test(artJs));
  t('SPA 에 MORE ARTICLES 렌더러가 있다', /function _renderMoreArticles/.test(artJs));
  t('상세 열 때 둘 다 그린다', /_renderArticleFaq\(a\)/.test(artJs)
    && /_renderMoreArticles\(a\)/.test(artJs));
  t('상세 GET 이 faq·more 를 병합한다', /fullA\.faq !== undefined/.test(artJs)
    && /fullA\.more_articles/.test(artJs));
  t('한 번 확인한 기사는 다시 안 묻는다 (_extrasChecked)',
    /_extrasChecked/.test(artJs));
  t('index.html 에 두 마운트가 있다', /id="artMoreArticles"/.test(idx) && /id="artFaq"/.test(idx));
  t('articles.html 에도 두 마운트가 있다', /id="artMoreArticles"/.test(arts) && /id="artFaq"/.test(arts));
  /* 순서 (2026-08-08 도메니코 지시로 변경): 태그 → FAQ → 참여 → IG →
     MORE ARTICLES **제일 아래**. SSR 도 같은 위치라 두 화면이 일치한다. */
  t('index: 태그 < FAQ < 참여, MORE 는 제일 아래',
    idx.indexOf('artDetailTags') < idx.indexOf('id="artFaq"')
    && idx.indexOf('id="artFaq"') < idx.indexOf('papEngageMount')
    && idx.indexOf('artMoreArticles') > idx.indexOf('artSocialSlot'));
  t('articles: 태그 < FAQ < 참여, MORE 는 제일 아래',
    arts.indexOf('artDetailTags') < arts.indexOf('id="artFaq"')
    && arts.indexOf('id="artFaq"') < arts.indexOf('papEngageMount')
    && arts.indexOf('artMoreArticles') > arts.indexOf('artSocialSlot'));
  t('SSR 도 MORE 가 마지막 IG 퍼널 뒤 (두 화면 순서 일치)',
    seo.indexOf('${moreEditorialsHtml}') > seo.indexOf('${FT.sub}'));
}

console.log('\n[4] MORE ARTICLES 데이터 — 한 빌더, 두 소비자');
{
  t('공용 빌더가 존재한다', /function buildMoreArticles/.test(moreLib));
  t('SSR([slug].js)이 빌더를 쓴다', /require\('\.\.\/\.\.\/_lib\/moreArticles'\)/.test(slugSsr)
    && /await buildMoreArticles\(data\)/.test(slugSsr));
  t('SSR 에 인라인 복사본이 안 남았다', !/relPrevR/.test(slugSsr));
  t('SPA 상세 API 도 빌더를 쓴다', /require\('\.\.\/_lib\/moreArticles'\)/.test(artDetail)
    && /await buildMoreArticles\(data\)/.test(artDetail));
  t('공개 기사에만 붙인다 (draft 관리자 조회는 쿼리 절약)',
    /status === 'published'[\s\S]{0,120}buildMoreArticles/.test(artDetail));
  t('규칙: prev/next 발행일 체인 + 카테고리 인접 (2026-07-27 확정)',
    /published_date\.lt\./.test(moreLib) && /ascending: true \}\)\.limit\(2\)/.test(moreLib));
}

console.log('\n[5] 에디토리얼 IG 임베드 — 코드가 아니라 데이터가 문제였다');
{
  t('ig 없으면 상세 GET 을 나가는 조건이 있다', /_edNeedIg/.test(edJs));
  t('응답 받으면 _igChecked 로 재요청 방지', /_igChecked = true/.test(edJs));
  t('임베드 blockquote 는 그대로 (있던 코드)', /instagram-media/.test(edJs));
  t('병합 후 재렌더 경로 유지 (_openEditorialInner_noPush)',
    /_openEditorialInner_noPush\(title, thumb\)/.test(edJs));
}

console.log('\n[6] 참여 블록 — 세 콘텐츠 전부, 한 부품, 옷도 한 벌');
{
  t('부품이 CSS 를 직접 주입한다', /pap-engage-css/.test(eng) && /injectCss\(\)/.test(eng));
  t('SSR 인라인 CSS 는 제거됐다 (두 벌 금지)', !/\.pap-engage \.pe-bar\{/.test(seo));
  t('카카오 버튼(.pe-kko)도 이제 옷이 있다', /\.pe-kko\{background:#FEE500/.test(eng));
  t('에디토리얼 SPA 가 마운트한다', /edEngageMount/.test(edJs)
    && (edJs.match(/PapEngage\.mount\(_edEng/g) || []).length >= 2);
  t('필름 SPA 가 마운트한다', /filmEngageMount/.test(filmJs));
  t('index.html 에 에디토리얼·필름 마운트', /id="edEngageMount"/.test(idx) && /id="filmEngageMount"/.test(idx));
  t('films.html 에도 필름 마운트 + 부품 로드', /id="filmEngageMount"/.test(films) && /pap-engage\.js/.test(films));
  t('마운트 id 가 서로 다르다 (한 문서에 오버레이가 공존한다)',
    idx.indexOf('id="edEngageMount"') !== idx.indexOf('id="papEngageMount"'));
}

console.log('\n[7] 댓글창은 하나 — 구 커뮤니티 렌더 중단');
{
  /* 주석 언급은 허용 — 실제 호출(PAPSocial.xxx( )만 금지 */
  t('기사 SPA 가 renderArticleSocial 을 더는 안 부른다', !/PAPSocial\.renderArticleSocial\(/.test(artJs));
  t('에디토리얼 SPA 가 renderEditorialSocial 을 더는 안 부른다', !/PAPSocial\.renderEditorialSocial\(/.test(edJs));
  t('별점 CTA 는 제거됨 (2026-08-09 좋아요로 통일 — 중복 평가 장치 금지)', !/renderEditorialRatingCta/.test(edJs));
  t('유사도 추천(RelatedEditorials)도 유지', /renderRelatedEditorials/.test(edJs));
}

console.log('\n[8] 캐시버스트 — 바뀐 스크립트는 전부 판을 올렸다');
{
  const pages = { 'index.html': idx, 'articles.html': arts, 'films.html': films,
    'community.html': R('frontend/community.html'), 'about.html': R('frontend/about.html'),
    'contact.html': R('frontend/contact.html'), 'submission.html': R('frontend/submission.html'),
    'pullletter.html': R('frontend/pullletter.html'), 'subscribe.html': R('frontend/subscribe.html'),
    'business.html': R('frontend/business.html') };
  const olds = ['pap-content-article.js?v=45', 'pap-content-editorial.js?v=51',
    'pap-content-seo.js?v=8"', 'pap-content-api-sync.js?v=120', 'pap-content-film.js?v=13',
    'pap-engage.js?v=1"'];
  let stale = [];
  for (const [n, h] of Object.entries(pages)) {
    for (const o of olds) if (h.indexOf(o) >= 0) stale.push(n + ':' + o);
  }
  t('옛 버전 참조가 한 곳도 없다', stale.length === 0, stale.join(', '));
  t('SSR 도 pap-engage v5 를 부른다 (별점 위치 이동 캐시버스트)', /pap-engage\.js\?v=5/.test(seo));
  /* index 와 articles 가 같은 스크립트를 다른 판으로 부르면 한쪽만 고쳐진다 */
  const ver = (h, name) => { const m = h.match(new RegExp(name.replace(/[.?]/g, '\\$&') + 'v=(\\d+)')); return m ? m[1] : null; };
  ['pap-content-article.js?', 'pap-content-editorial.js?', 'pap-content-api-sync.js?', 'pap-content-seo.js?'].forEach((n) => {
    t(n + ' 판이 index·articles 동일 (' + ver(idx, n) + ')', ver(idx, n) === ver(arts, n),
      ver(idx, n) + ' vs ' + ver(arts, n));
  });
}

console.log('\n[9] IG 링크 자동화 — "임베드 코드는 살았는데 데이터가 안 들어온다"의 뿌리');
{
  /* 실측(2026-08-08): 8월 발행 화보 5편 전부 source_instagram_url NULL.
     연결 도구(backfill-ig)가 관리자 수동 전용이라 아무도 안 돌렸다.
     → 6시간마다 최근 게시물을 스캔해 자동 연결하는 크론으로. */
  const bf = R('api/editorials/backfill-ig.js');
  const vj = R('vercel.json');
  t('크론 인증은 Bearer CRON_SECRET (x-vercel-cron 헤더 읽기 금지 — celeb-classify 사고)',
    /auth === 'Bearer ' \+ process\.env\.CRON_SECRET/.test(bf)
    && !/headers\[['"]x-vercel-cron/.test(bf));
  t('withCronGuard 로 감싼다 (기록 없는 크론 금지 — 뉴스레터 3주 침묵 교훈)',
    /module\.exports = withCronGuard\('editorial-ig-link', handler\)/.test(bf));
  t('모든 종료 지점이 note 를 남긴다', (bf.match(/note\(/g) || []).length >= 5);
  t('크론 모드는 자동 apply + 최근 2페이지', /isCron \? req\.query\.apply !== '0'/.test(bf)
    && /isCron \? '2' : '10'/.test(bf));
  t('수동(관리자)은 여전히 dry-run 기본', /req\.query\.apply === '1'/.test(bf));
  t('vercel.json 에 스케줄이 있다', /"path": "\/api\/editorials\/backfill-ig"/.test(vj));
  t('이미 채워진 링크는 안 건드린다 (경합 이중 확인)',
    /\.is\('source_instagram_url', null\); \/\/ 경합 대비 이중 확인/.test(bf));
  /* 실측: 'BOYS'(4자)가 최소 길이 5에 걸려 유일하게 연결 실패.
     짧은 제목은 따옴표 감싼 정확 매칭으로만 — 부분문자열 오매칭 금지. */
  t('짧은 제목(3~4자)은 따옴표 정확 매칭으로 구제한다', /shortRx/.test(bf)
    && /t\.length < 3 \|\| t\.length >= 5/.test(bf));
  t('짧은 제목도 모호(중복)하면 스킵', /shortRx\.delete\(t\); ambiguousTitles\.add\(t\)/.test(bf));
}


console.log('\n[별점 통합] 평가 장치는 한 화면에 하나 (2026-08-09 도메니코 결정)');
{
  const rat = R('api/social/ratings.js');
  t('별점은 공용 부품 mountRating (사진 바로 아래)', /mountRating/.test(eng)
    && /pe-rate/.test(eng) && /pe-star/.test(eng));
  t('참여 바에서는 에디토리얼 평가를 뺀다 (중복 금지)', /useRating\s*\?\s*''/.test(eng));
  t('SSR 도 사진 아래에 별점 마운트', /papRatingMount/.test(seo) && seo.indexOf('${videoHtml}') < seo.indexOf('papRatingMount'));
  t('SPA 도 같은 부품을 부른다', /mountRating\(document\.getElementById\('edRatingCta'\)/.test(edJs)
    && /id="edRatingCta"/.test(idx));
  t('SPA 순서: 설명·크레딧 → 별점 → 댓글 (2026-08-09 도메니코 확정)',
    idx.indexOf('id="edDetailDesc"') < idx.indexOf('id="edRatingCta"')
    && idx.indexOf('id="edRatingCta"') < idx.indexOf('id="edEngageMount"'));
  t('SPA 순서: SHOP 은 다운로드 위', idx.indexOf('id="edShopRow"') < idx.indexOf('id="edDetailDownloads"'));
  t('티어시트 PDF 는 별도 다운로드 버튼 (2026-08-09 도메니코 최종)',
    /_papDownloadTearsheet/.test(edJs) && /_papMakeTearsheetPdf/.test(edJs)
    && /edTearsheetBtn/.test(edJs) && /editorial-tearsheet/.test(edJs));
  t('티어시트는 ZIP 에 동봉하지 않는다 (별도 버튼안 확정)', !/zip\.file\(safeTitle \+ '-tearsheet/.test(edJs));
  t('버튼 순서: 티어시트 → 커버 → 로고 (2026-08-09 도메니코)',
    /tearsheetBtnHtml \+ coverHtml \+ logoBtnHtml/.test(edJs));
  t('티어시트 메타는 호출부에서 만들어 넘긴다 (스코프 버그 재발 금지)',
    /tsMeta\)/.test(edJs) && (function(){
      const fn = edJs.slice(edJs.indexOf('function _renderEditorialDownloadButtons'), edJs.indexOf('// QA #284 Phase 2 — 다운로드 권한 조회 헬퍼'));
      return !/det\b/.test(fn.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''));
    })());
  t('커버 버튼 폴백 — 커버 없으면 갤러리 1번', /coverUrl = gallery\[0\]/.test(edJs));
  t('커버 = 관리자 cover_image(d.hero) 최우선 (필드 개명 함정 재발 금지)',
    /coverUrl = \(d && d\.hero\)/.test(edJs));
  t('티어시트 = 다중 페이지 (표지·설명글·크레딧·로고 이미지들)',
    /ts\.gallery/.test(edJs) && /ts\.desc/.test(edJs) && /doc\.addPage\(\)/.test(edJs)
    && /wrapText/.test(edJs));
  t('갤러리 페이지는 4장씩 2×2 (2026-08-09 도메니코)', /perPage = 4/.test(edJs)
    && /drawCell/.test(edJs));
  {
    const chk = R('api/downloads/check.js');
    const cellFn = edJs.slice(edJs.indexOf('function drawCell'), edJs.indexOf('var caps ='));
    t('티어시트 이미지는 무로고 원본 + 크레딧 전부(오버레이 여러 줄)',
      !/globalAlpha/.test(cellFn) && /imageCredits/.test(edJs) && /caps\[k\]/.test(edJs)
      && /rgba\(0,0,0,\.55\)/.test(cellFn));
    t('티어시트 표지 = 확정 커버 디자인 단독, 잘림 없음·덧그림 없음 (2026-08-10)', (function(){
      const p1 = edJs.slice(edJs.indexOf('1p 표지 — 확정 커버 디자인 단독'), edJs.indexOf('2p 타이틀'));
      return p1.length > 0 && !/drawImage\(logo/.test(p1) && !/fillText\(titleTxt/.test(p1)
        && /Math\.min\(cAreaW/.test(p1);
    })());
    t('[object Object] 가 PDF 에 못 들어간다 — 문자열만 통과', /_str = function/.test(edJs)
      && /indexOf\('\[object'\) < 0/.test(edJs));
    t('비회원도 다운로드 버튼 3종을 본다 — 클릭 시 유료 전용 팝업 (2026-08-10)',
      /_papDlPaywall/.test(edJs) && /locked \? '_papDlPaywall\(\)'/.test(edJs)
      && !/CTA — 회원가입 유도/.test(edJs));
    t('참여 크리에이터 무료 다운로드 폐지 — 유료 회원만 (2026-08-10 도메니코)',
      !/reason: 'owner'/.test(chk) && /subscription_plan/.test(chk)
      && !/무료로 다운로드할 수 있어요/.test(edJs) && !/무료로 받을 수 있어요/.test(edJs));
  }
  t('중간 IG 창 — 옆 사진(4:5 칸) 높이에 실측 축소로 맞춘다',
    /_papFitMidIg/.test(edJs) && /transform/.test(edJs) && /max-width:400px/.test(edJs)
    && !/aspect-ratio:auto;height:auto;overflow:visible/.test(edJs));
  t('jsPDF 는 CDN defer — 로드 실패 시 안내 후 중단 (ZIP 본체 무관)', /jspdf\.umd\.min\.js/.test(idx)
    && /PDF 라이브러리 로드 실패/.test(edJs));
  {
    const midFn = edJs.slice(edJs.indexOf('function _papMidIgCtaHtml'), edJs.indexOf('function _papRenderEdIg'));
    const bottomFn = edJs.slice(edJs.indexOf('function _papRenderEdIg'), edJs.indexOf('function _renderEditorialTags'));
    t('갤러리 중간 = IG 임베드 창, 상한 2개 — 1/3(왼쪽 칸)·2/3(오른쪽 칸)',
      /instagram-media/.test(midFn) && /_papMidSlots\[0\] \|\| idx === _papMidSlots\[1\]/.test(edJs)
      && /odd\(n \/ 3\)/.test(edJs));
    t('중간 폴백(원본 없음)은 editorial_mid 계측 유지', /src=editorial_mid/.test(midFn));
    t('하단은 임베드를 접고 퍼널만 (같은 창 중복 금지)', !/instagram-media/.test(bottomFn)
      && /_papLoadIgEmbed/.test(bottomFn));
  }
  t('SSR 순서: 크레딧 → 별점, SHOP → 다운로드 (에디토리얼)',
    seo.indexOf("kind === 'editorial' ? creditsHtml") < seo.indexOf('papRatingMount')
    && seo.indexOf("kind === 'editorial' ? fashionHtml") < seo.indexOf('${downloadsHtml}'));
  t('댓글(참여 블록)은 별점 바로 아래 — SSR (에디토리얼)', seo.indexOf('papRatingMount') < seo.indexOf("kind !== 'editorial'"));
  t('기사·필름 좋아요는 유지 (중복 아님)', /pe-like/.test(eng) && /if \(likeBtn\)/.test(eng));
  t('별점 키는 제목 80자 — SSR 절단과 일치 (두 화면 같은 키)',
    /slice\(0, 80\)/.test(eng) && /titleMain \|\| ''\)\.slice\(0, 80\)/.test(seo));
  t('별점 통계 GET 은 로그인 불필요', rat.indexOf("req.method === 'GET'") < rat.indexOf('requireAuth(req, res)'));
  t('쓰기는 여전히 로그인 필요 (보안 감사 A-2)', /requireAuth\(req, res\)/.test(rat));
  t('401 이면 로그인 유인으로 전환 (사다리 2계단)', /pe-rate-login/.test(eng) && /\/auth\?next=/.test(eng));
  t('통계 응답에 user_id 목록이 없다', !/user_id/.test(rat.slice(rat.indexOf('res.status(200).json({'), rat.indexOf('stats error'))));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ spa-parity tests FAILED'); process.exit(1); }
console.log('✅ spa-parity tests passed');
