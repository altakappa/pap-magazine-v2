/**
 * 제보(특종) 회귀 테스트 (2026-11-12)
 * ─────────────────────────────────────────────────────────────────────
 * 설계안 §7 의 제보 항목을 그대로 옮긴 것이다.
 *
 * 지키려는 것:
 *  ① 미디어가 없으면 제보가 아니다 (400)
 *  ② 직접 목격 확인·사용 허락 없이는 접수되지 않는다
 *  ③ 소스에 `articles` INSERT 경로가 없다 — 기사는 사람이 쓴다
 *  ④ 1GB 상한과 버킷 MIME 목록이 앱 화이트리스트와 **정확히** 같다
 *  ⑤ 7일 퍼지가 '채택했지만 확보 안 한' 제보를 건드리지 않는다
 *     (그걸 지우면 발행된 기사가 깨진다)
 *  ⑥ 제보 미디어는 비공개다 — 공개 URL 을 저장하지 않는다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 주석을 떼고 코드만 본다 — "여기에는 articles 를 건드리는 코드가 없다" 는
   설명 주석이 검사에 걸리면 설명을 지우게 된다. */
const CODE = (f) => R(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');
/* SQL 주석(-- …)도 뗀다. 마이그레이션 주석은 "왜 그 칸을 두지 않았나" 를
   설명하므로, 주석을 남기면 설명 자체가 검사에 걸려 설명을 지우게 된다. */
const SQL_CODE = (f) => R(f).replace(/--[^\n]*/g, '');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const T = require('../api/_lib/newsTip');

console.log('=== 1. 용량·형식 규칙 ===');
t('영상 상한 1GiB (도메니코: "1기가 용량까지")', T.MAX_VIDEO_BYTES === 1024 * 1024 * 1024, String(T.MAX_VIDEO_BYTES));
t('사진 상한은 50MB (1GB 를 사진에 주면 실수로 올린 거대 파일을 못 걸러낸다)',
  T.MAX_IMAGE_BYTES === 50 * 1024 * 1024);
t('MIME 은 영상 2종 + 이미지 5종', T.ALLOWED_MIME.size === 7,
  Array.from(T.ALLOWED_MIME).join(','));
t('영상·사진 상한이 MIME 에 따라 갈린다',
  T.maxBytesFor('video/mp4') === T.MAX_VIDEO_BYTES && T.maxBytesFor('image/jpeg') === T.MAX_IMAGE_BYTES);
t('모르는 MIME 은 엄한 쪽(사진 상한)으로 떨어진다',
  T.maxBytesFor('application/zip') === T.MAX_IMAGE_BYTES);
t('비표준 별칭을 표준으로 되돌린다 (image/jpg · video/mov)',
  T.canonicalMime('image/jpg') === 'image/jpeg'
  && T.canonicalMime('VIDEO/MOV') === 'video/quicktime'
  && T.canonicalMime(' video/x-quicktime ') === 'video/quicktime');
t('허용 MIME 마다 확장자가 있다 (경로에 확장자가 없으면 내려받기가 깨진다)',
  Array.from(T.ALLOWED_MIME).every((m) => !!T.MIME_TO_EXT[m]),
  Array.from(T.ALLOWED_MIME).filter((m) => !T.MIME_TO_EXT[m]).join(','));
t('버킷은 비공개 news-tips', T.BUCKET === 'news-tips');

/* 앱 화이트리스트와 버킷 allowed_mime_types 가 어긋나면 앱은 통과시켰는데
   스토리지가 거부하는 '조용한 실패' 가 된다(.claude/rules/api.md).
   2단계 직접 업로드는 바이트가 서버를 거치지 않아 버킷이 유일한 관문이다. */
console.log('\n=== 2. 앱 화이트리스트 = 버킷 설정 ===');
{
  const M = R('supabase_migrations/186_news_tips_bucket.sql');
  t('버킷이 비공개다', /public\s*=\s*FALSE/i.test(M) && /'news-tips',\s*'news-tips',\s*FALSE/i.test(M));
  t('버킷 상한이 1GiB', /1073741824/.test(M));
  const inSql = (M.match(/'(video|image)\/[a-z0-9+.-]+'/g) || []).map((x) => x.replace(/'/g, ''));
  const uniq = Array.from(new Set(inSql)).sort();
  const app = Array.from(T.ALLOWED_MIME).sort();
  t('버킷 MIME 목록이 앱 화이트리스트와 정확히 같다',
    JSON.stringify(uniq) === JSON.stringify(app),
    'sql=' + uniq.join(',') + '\n        app=' + app.join(','));
}

console.log('\n=== 3. 업로드 서명 URL ===');
const UP = CODE('api/news-tips/upload-url.js');
t('공용 규칙 모듈을 쓴다 (숫자·목록을 두 벌로 두지 않는다)', /require\('\.\.\/_lib\/newsTip'\)/.test(UP));
t('MIME 화이트리스트 밖은 400', /T\.ALLOWED_MIME\.has\(type\)/.test(UP) && /unsupported_type/.test(UP));
t('크기 상한을 MIME 별로 본다', /T\.maxBytesFor\(type\)/.test(UP) && /file_too_large/.test(UP));
t('파일 수 상한', /T\.MAX_FILES/.test(UP) && /too_many_files/.test(UP));
t('경로는 자기 폴더 아래 + 화이트리스트 문자만',
  /safeUserId/.test(UP) && /\^\[A-Za-z0-9\/_\.-\]\+\$/.test(UP));
t('클라이언트가 PUT 할 contentType 을 정규화해 돌려준다 (버킷 거부 방지)',
  /contentType: type/.test(UP));
/* 비공개 버킷이므로 공개 URL 을 돌려주면 안 된다 — 확인 전 영상이 경로만
   아는 사람에게 열린다. */
t('공개 URL 을 돌려주지 않는다 (getPublicUrl 없음)', !/getPublicUrl/.test(UP));
t('원문 에러를 응답에 싣지 않는다', /code: 'upload_url_failed'/.test(UP));

console.log('\n=== 4. 접수 ===');
const IDX = CODE('api/news-tips/index.js');
t('로그인 필수', /requireAuth\(req, res\)/.test(IDX));
t('미디어가 없으면 400 (이 트랙의 본체는 미디어다)', /MEDIA_REQUIRED/.test(IDX));
t('남의 폴더 파일은 걸러내고, 걸러졌으면 400 으로 알린다',
  /MEDIA_NOT_OWNED/.test(IDX) && /p\.startsWith\(prefix\)/.test(IDX));
t('직접 목격 확인 없으면 400 (도메니코: "직접 목격한것만")', /WITNESS_REQUIRED/.test(IDX));
t('사용 허락 없으면 400', /MEDIA_RIGHTS_REQUIRED/.test(IDX));
t('소셜 게재 확인 없으면 400', /SOCIAL_CONSENT_REQUIRED/.test(IDX));
t('제목·내용·장소·시각이 필수', /TITLE_REQUIRED/.test(IDX) && /BODY_REQUIRED/.test(IDX)
  && /LOCATION_REQUIRED/.test(IDX) && /HAPPENED_AT_REQUIRED/.test(IDX));
t('계정당 하루 상한 (알림 폭주 방지이기도 하다)',
  /DAILY_LIMIT/.test(IDX) && /T\.DAILY_LIMIT_PER_USER/.test(IDX) && /status\(429\)/.test(IDX));
t('IP 레이트리밋도 함께 본다', /rateLimit\(req, res, RATE_LIMITS\.upload\)/.test(IDX));
t('접수 즉시 텔레그램 (도메니코 "라": 전부 긴급)',
  /await sendTextToTelegramSafe\(/.test(IDX) && /제보 접수/.test(R('api/news-tips/index.js')));
t('알림에 7일 삭제를 함께 적는다 (쓸 거면 그 전에 채택해야 한다)',
  /PURGE_AFTER_DAYS/.test(IDX));
t('접수는 new 로만 들어간다', /status: 'new'/.test(IDX));
t('동의 세 칸을 기록한다',
  /witnessed_confirmed: true/.test(IDX) && /media_rights_consent: true/.test(IDX) && /social_consent: true/.test(IDX));
/* ③ 기사로 자동 전환되는 경로가 없어야 한다 */
t("소스에 articles 를 건드리는 코드가 없다", !/from\('articles'\)/.test(IDX));
t('목록의 미디어 링크는 그때그때 만든 서명 URL 이다 (공개 URL 저장 안 함)',
  /createSignedUrl\(/.test(IDX) && !/getPublicUrl/.test(IDX));
t('지워진 제보에는 링크를 만들지 않는다', /!r\.media_purged_at/.test(IDX));
t('원문 에러를 응답에 싣지 않는다', /code: 'create_failed'/.test(IDX));

console.log('\n=== 5. 처리 (관리자) ===');
const RV = CODE('api/news-tips/[id]/review.js');
t('관리자만', /requireAdmin/.test(RV));
t("소스에 articles 를 건드리는 코드가 없다 — '기사로 전환' 버튼이 없는 이유",
  !/from\('articles'\)/.test(RV));
t('상태는 네 가지 화이트리스트', /STATUSES = \['new', 'checking', 'used', 'dropped'\]/.test(RV));
t('채택 시 미디어 확보가 남았다고 알린다', /미디어 확보가 남았습니다/.test(R('api/news-tips/[id]/review.js')));
t('확보는 공개 버킷으로 복사한다', /T\.ARCHIVE_BUCKET/.test(RV) && /T\.archivePathFor\(/.test(RV));
t('서버가 옮길 수 없는 크기는 manual 로 남긴다 (모르는 걸 안다고 하지 않는다)',
  /ARCHIVE_MAX_BYTES/.test(RV) && /manual\.push\(/.test(RV));
t('이미 지워진 제보는 확보할 수 없다', /already_purged/.test(RV));
t('보상은 시각만 기록한다 — 코드가 등급을 올리지 않는다',
  /rewarded_at: now/.test(RV) && !/subscription/.test(RV));
t('원문 에러를 응답에 싣지 않는다', /code: 'review_failed'/.test(RV));

console.log('\n=== 6. 7일 퍼지 ===');
const PG = CODE('api/cron/purge-news-tips.js');
const PGRAW = R('api/cron/purge-news-tips.js');
t('CRON_SECRET 으로 막혀 있다 (공개 URL 이다)',
  /process\.env\.CRON_SECRET/.test(PG) && /status\(401\)/.test(PG) && /safeEqual/.test(PG));
t('공책(res.locals)을 먼저 만든다 (없으면 마지막 줄에서 500)',
  /res\.locals = res\.locals \|\| \{\}/.test(PG));
t('cron_runs 에 한 줄 요약을 남긴다', /res\.locals\.cronNote = note/.test(PG));
t('7일 기준은 공용 상수', /T\.PURGE_AFTER_DAYS/.test(PG) && T.PURGE_AFTER_DAYS === 7);
t('아직 안 지운 것만 훑는다', /\.is\('media_purged_at', null\)/.test(PG));
/* ⑤ 이게 이 크론의 핵심 안전장치다 */
t("채택했지만 확보 안 한 제보는 건드리지 않는다 (기사가 깨지는 쪽이 더 비싸다)",
  /r\.status === 'used' && !r\.media_archived/.test(PG));
t('건너뛴 건은 텔레그램으로 조른다 (관측되지 않는 상태는 없는 것처럼 보인다)',
  /waiting\.length/.test(PG) && /sendTextToTelegramSafe/.test(PG));
t('스토리지 삭제가 실패하면 DB 도 바꾸지 않는다 (다음 회차가 다시 시도)',
  /if \(rmErr\) \{[\s\S]{0,400}continue;/.test(PG));
t('행은 남기고 미디어만 비운다 (무엇이 들어왔는지는 기록이어야 한다)',
  /media: \[\]/.test(PG) && /media_purged_at:/.test(PG) && !/\.delete\(\)/.test(PG));
t('한 회차 상한이 있다 (다음 회차가 맡는다)', /MAX_PER_RUN/.test(PG));
t('크론이 등록돼 있다', (function () {
  const v = JSON.parse(R('vercel.json'));
  return (v.crons || []).some((c) => c.path === '/api/cron/purge-news-tips');
})());

console.log('\n=== 7. 표는 service_role 전용 ===');
{
  const M = SQL_CODE('supabase_migrations/185_news_tips.sql');
  t('RLS 를 켠다', /ENABLE ROW LEVEL SECURITY/.test(M));
  t('정책을 만들지 않는다 (= 전면 거부)', !/CREATE POLICY/i.test(M));
  t('anon·authenticated 그랜트를 회수한다',
    /REVOKE ALL ON public\.news_tips FROM anon, authenticated/.test(M));
  t('미디어 수명 칸이 있다 (media_archived · media_purged_at)',
    /media_archived/.test(M) && /media_purged_at/.test(M));
  t('퍼지가 훑는 길에 인덱스가 있다', /news_tips_purge_idx/.test(M));
  t("published_article_id 같은 자동 연결 칸을 두지 않았다", !/published_article_id/.test(M));
}

console.log('\n=== 8. 폼 ↔ 서버 규칙 정합 ===');
const F = R('frontend/submission-tip.html');
t('폼의 상한 숫자가 서버와 같다',
  new RegExp('MAX_VIDEO_BYTES = 1024 \\* 1024 \\* 1024').test(F)
  && new RegExp('MAX_IMAGE_BYTES = 50 \\* 1024 \\* 1024').test(F)
  && new RegExp('MAX_FILES = ' + T.MAX_FILES).test(F));
t('폼의 MIME 목록이 서버와 같다',
  T.VIDEO_MIME.every((m) => F.indexOf("'" + m + "'") !== -1)
  && T.IMAGE_MIME.every((m) => F.indexOf("'" + m + "'") !== -1));
t('미디어 없이는 제출 버튼이 통과하지 않는다', /if \(!FILES\.length\) return showErr/.test(F));
t('동의 세 칸을 폼이 먼저 막는다',
  /\$\('witnessed'\)\.checked/.test(F) && /\$\('rights'\)\.checked/.test(F) && /\$\('social'\)\.checked/.test(F));
/* 1GB 업로드에 진행률이 없으면 사람들은 창을 닫는다. fetch 는 업로드 진행률을
   주지 않으므로 XHR 이어야 한다. */
t('1GB 업로드에 진행률이 있다 (XHR — fetch 는 업로드 progress 가 없다)',
  /new XMLHttpRequest\(\)/.test(F) && /xhr\.upload\.onprogress/.test(F));
t('7일 삭제를 폼에 명시한다 (나중 "내 영상 어디 갔냐" 를 미리 막는다)',
  /glDeleteTitle/.test(F) && /deleteReminder/.test(F) && /7/.test(F));
t('보상(크레딧 + 프리미엄 1개월)을 폼에 적는다', /glRewardBody/.test(F));
t('"게재를 보장하지 않는다" 를 적는다', /glCheckBody/.test(F));
t('서버 code 를 화면 문구로 매핑한다',
  /MEDIA_REQUIRED:'errMedia'/.test(F) && /WITNESS_REQUIRED:'errWitness'/.test(F));
t('라우팅이 있다', (function () {
  const v = JSON.parse(R('vercel.json'));
  return (v.rewrites || []).some((r) => r.source === '/submission/tip' && r.destination === '/submission-tip.html');
})());

console.log('\n=== 9. 관리자 화면 ===');
/* pap-admin.js 는 814KB 이고 다른 기능(뉴스 작성 등)에는 기사 생성 코드가 있다.
   그래서 전체를 보면 안 된다 — 제보 모듈 구간만 떼어 검사한다. */
const ADM_ALL = R('frontend/pap-admin.js');
const _tipStart = ADM_ALL.indexOf('제보(특종) 열람');
const ADM = _tipStart === -1 ? '' : ADM_ALL.slice(_tipStart);
const ADM_CODE = ADM.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
t('제보 모듈 구간을 찾았다', _tipStart !== -1, '구간을 못 찾으면 아래 검사가 아무것도 안 본다');
t('제보 탭이 있다', /t-newstips/.test(R('frontend/admin.html')) && /loadNewsTips/.test(ADM_ALL));
t("기사를 만드는 호출이 없다 ('기사로 전환' 버튼을 두지 않았다)",
  !/apiPost\('\/articles/.test(ADM_CODE) && !/from\('articles'\)/.test(ADM_CODE));
t('미디어 확보 버튼이 있다', /data-tiparchive/.test(ADM));
t('브라우저가 못 그리는 형식은 내려받기 링크를 준다 (검은 칸 금지)',
  /_tipPlayable/.test(ADM) && /_tipViewable/.test(ADM) && /내려받아 확인/.test(ADM));
t('버튼은 data-*(UUID) 위임 — 인라인 onclick 에 제보 글자를 넣지 않는다',
  /data-tipopen/.test(ADM_CODE) && !/onclick="openNewsTip\('/.test(ADM_CODE));
t('캐시버스트를 올렸다', /pap-admin\.js\?v=177/.test(R('frontend/admin.html')));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ news-tip tests FAILED'); process.exit(1); }
console.log('✅ news-tip tests passed');
