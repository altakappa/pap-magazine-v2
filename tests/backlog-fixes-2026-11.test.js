/**
 * 밀린 건 정리 회귀 테스트 (2026-11-13)
 * ─────────────────────────────────────────────────────────────────────
 * 세 가지를 지킨다. 셋 다 "한쪽만 고쳐서 남아 있던" 종류다.
 *
 *  ① 정지 계정이 로그인된다
 *     subscription_status='suspended' 는 관리자 화면에서 설정할 수 있는데
 *     로그인 핸들러가 그 칸을 보지 않았다. 정지가 아무것도 막지 못했다.
 *     (2026-11-10 Serena 계정 정리 때 발견 — 그때는 banned_until 로 우회)
 *
 *  ② 커뮤니티 열람 기록이 공개로 읽혔다
 *     community_post_views 는 viewer_id 를 담는다. 11-07 감사는 **쓰기**
 *     구멍만 닫았고, 읽기 쪽 정책(USING true) + anon SELECT 그랜트가 남아
 *     누가 어떤 글을 봤는지 통째로 읽혔다.
 *
 *  ③ YouTube 설명의 < > 필터가 제목 줄에만 있었다
 *     2026-07-19 '<오디세이>' 로 400 을 맞고 제목만 고쳤다. 설명은 기사 본문
 *     첫 문장도 싣는데 그 경로는 열려 있었고 11-10 에 같은 400 이 재발했다.
 *     덤으로 DB 쪽: 중복 가드는 (article_id + video_id NOT NULL) 을 보는데
 *     제약은 article_id 하나만 본다 — 열쇠가 달라서 가드를 통과한 기록이
 *     유니크 위반으로 죽었다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 주석을 떼고 코드만 본다 — 사고 경위를 적은 주석이 검사에 걸리면 설명을
   지우게 된다. 설명은 남기고 코드만 본다. */
const CODE = (f) => R(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');
const SQL_CODE = (f) => R(f).replace(/--[^\n]*/g, '');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

// ── ① 정지 계정 ──
console.log('=== 1. 정지된 계정은 로그인하지 못한다 ===');
{
  const L = CODE('api/auth/login.js');
  t('로그인 핸들러가 subscription_status 를 본다', /subscription_status/.test(L));
  t("'suspended' 면 토큰을 발급하지 않는다",
    /=== 'suspended'/.test(L) && /ACCOUNT_SUSPENDED/.test(L));
  /* 검사가 토큰 발급보다 **앞**이어야 한다. 뒤에 있으면 토큰이 이미 만들어진다. */
  t('검사가 generateToken 보다 앞에 있다',
    L.indexOf('ACCOUNT_SUSPENDED') < L.indexOf('generateToken(user)'),
    String(L.indexOf('ACCOUNT_SUSPENDED')) + ' < ' + String(L.indexOf('generateToken(user)')));
  /* cancelled·inactive 는 막지 않는다 — 구독이 끝난 사람은 무료 회원으로
     계속 들어와야 한다. 그걸 막으면 해지가 곧 탈퇴가 된다. */
  t("cancelled·inactive 는 막지 않는다",
    !/=== 'cancelled'/.test(L) && !/=== 'inactive'/.test(L));
  t('응답에 분류용 code 가 있다 (프런트가 9개 언어 문구를 고른다)',
    /code: 'ACCOUNT_SUSPENDED'/.test(L));
  t('매핑이 빠져도 읽을 수 있는 영어 문장이 남는다',
    /This account is suspended/.test(L) && /contact@pap-magazine\.com/.test(L));

  const A = R('frontend/auth.html');
  t('프런트가 정지를 따로 가른다', /ACCOUNT_SUSPENDED/.test(A) && /msgs\.loginSuspended/.test(A));
  /* 비밀번호 오류와 섞이면 "비번이 틀렸나" 하고 계속 시도하게 된다 */
  t('정지 분기가 비밀번호 분기보다 앞에 있다',
    A.indexOf('ACCOUNT_SUSPENDED') < A.indexOf("msg.includes('password')"));
  t('9개 언어 + 중복 ru 까지 전부 문구가 있다',
    (A.match(/loginSuspended:/g) || []).length === (A.match(/\n\s*loginFail:/g) || []).length,
    'suspended=' + (A.match(/loginSuspended:/g) || []).length
      + ' fail=' + (A.match(/\n\s*loginFail:/g) || []).length);

  const MU = CODE('api/admin/member-update.js');
  /* 로그인만 막으면 이미 로그인해 있는 사람의 JWT 는 그대로다. 토큰이 만료될
     때까지 정지가 아무 효과도 없으면 '정지' 버튼이 거짓말을 하는 셈이다. */
  t('정지로 바꿀 때 기존 토큰을 끊는다', /suspendedNow/.test(MU)
    && /roleChanged \|\| suspendedNow/.test(MU) && /invalidateTokens\(memberId\)/.test(MU));
  t('정지 판정이 선언된 변수를 쓴다 (status 가 아니라 subscriptionStatus)',
    /subscriptionStatus !== undefined/.test(MU) && !/(^|[^.\w])status !== undefined/.test(MU));
  t('이미 정지된 계정을 다시 저장할 때는 끊지 않는다 (무관한 저장으로 쫓아내지 않는다)',
    /profile\.subscription_status \|\| ''\)\.toLowerCase\(\) !== 'suspended'/.test(MU));
}

// ── ② 커뮤니티 열람 기록 ──
console.log('\n=== 2. 커뮤니티 열람 기록은 비공개다 ===');
{
  const M = SQL_CODE('supabase_migrations/187_community_view_privacy.sql');
  t('열람 기록의 공개 읽기 정책을 지운다',
    /DROP POLICY IF EXISTS "Anyone can view post view records" ON public\.community_post_views/.test(M));
  t('그랜트도 회수한다 (정책과 그랜트 두 겹)',
    /REVOKE ALL ON public\.community_post_views FROM anon, authenticated/.test(M));
  t('181 의 남은 껍데기 정책 5개도 같은 자리에서 지운다',
    (M.match(/DROP POLICY IF EXISTS/g) || []).length === 6,
    String((M.match(/DROP POLICY IF EXISTS/g) || []).length));
  /* 쓰기는 service_role 로 돈다 — 그랜트 회수가 조회수 기록을 깨면 안 된다 */
  const V = CODE('api/community/posts/[id]/view.js');
  t('조회 기록은 service_role 로 쓴다 (그랜트 회수가 쓰기를 깨지 않는다)',
    /supabaseAdmin/.test(V) && /from\('community_post_views'\)/.test(V));
  t('프런트가 이 표를 직접 읽지 않는다',
    !/from\(['"]community_post_views['"]\)/.test(CODE('frontend/community.html')));
}

// ── ③ YouTube 설명 ──
console.log('\n=== 3. YouTube 가 거부하는 글자를 한 곳에서 거른다 ===');
{
  const Y = CODE('api/_lib/youtubeMeta.js');
  t('공용 필터가 있다', /function ytSafeText/.test(Y) && /replace\(\/\[<>\]\/g, ''\)/.test(Y));
  t('내보낸다', /ytSafeText,/.test(Y));
  const { ytSafeText, buildTitle } = require('../api/_lib/youtubeMeta');
  t('꺾쇠를 지운다', ytSafeText('a <오디세이> b > c') === 'a 오디세이 b  c');
  t('null·undefined 에도 안전하다', ytSafeText(null) === '' && ytSafeText(undefined) === '');
  t('제목에도 여전히 적용돼 있다 (2026-07-19 수정이 살아 있다)',
    buildTitle({ title: '<오디세이> 리뷰' }).indexOf('<') === -1);

  /* 설명을 만드는 세 곳이 모두 반환 직전에 통과시켜야 한다. 줄마다 거르는
     방식은 새 줄이 추가될 때 빠진다 — 그래서 7/19 에 고치고 11/10 에 재발했다. */
  const BUILDERS = [
    'api/cron/drive-youtube-post.js',
    'api/cron/youtube-post.js',
    'api/cron/drive-story-shorts.js',
  ];
  for (const f of BUILDERS) {
    const c = CODE(f);
    t(f.split('/').pop() + ' 가 ytSafeText 를 가져온다', /ytSafeText/.test(c.split('\n').slice(0, 60).join('\n')));
    t(f.split('/').pop() + ' 의 설명 반환이 ytSafeText 를 통과한다',
      /return ytSafeText\(lines\.join\('\\n'\)\)/.test(c));
  }
}

console.log('\n=== 4. 중복 가드와 DB 제약이 같은 열쇠를 본다 ===');
{
  const D = CODE('api/cron/drive-youtube-post.js');
  /* 제약은 youtube_posts_article_id_key — article_id 하나만 보는 (부분 아닌)
     유니크 인덱스다. 가드가 video_id 까지 요구하면 둘의 열쇠가 어긋난다. */
  /* 같은 파일에 또 하나의 질의(takenRows)가 있고 그쪽은 video_id NOT NULL 이
     **맞다** — '이미 영상이 있는 기사' 집합을 만드는 용도다. 파일 전체에서
     찾으면 그 정당한 질의에 걸린다. 가드 문장만 떼어 내서 본다. */
  const GUARD = (D.match(/from\('youtube_posts'\)\s*\n?\s*\.select\('id, video_id[^;]*?;/) || [''])[0];
  t('중복 가드 문장을 찾았다', GUARD.length > 0);
  t('가드가 video_id 를 조건에서 빼고 그 기사를 점유한 행을 본다',
    /\.eq\('article_id', art\.id\)/.test(GUARD) && !/\.not\('video_id', 'is', null\)/.test(GUARD),
    GUARD.slice(0, 200));
  t('영상이 있는 점유는 업로드하지 않고 건너뛴다',
    /already\.drive_file_id !== file\.id && already\.video_id/.test(D));
  t('영상 없는 껍데기 점유는 풀어 주고 진행한다 (그 기사가 영영 영상을 못 갖는 걸 막는다)',
    /already\.drive_file_id !== file\.id && !already\.video_id/.test(D)
    && /article_id: null,/.test(D));
  t('해제에 쓸 detail 을 함께 조회한다 (기존 메모를 지우지 않는다)',
    /select\('id, video_id, status, drive_file_id, detail'\)/.test(D));
  /* 업로드가 실패하면 채널에 아무것도 없으므로 '이 기사의 영상' 연결은 뜻이
     없다. 그걸 쓰는 순간 제약과 부딪혀 기록 자체가 죽고 거짓 경보가 나간다. */
  t('업로드 실패 시에는 기사 연결을 쓰지 않는다',
    /article_id: videoId \? art\.id : null/.test(D));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ backlog-fixes-2026-11 tests FAILED'); process.exit(1); }
console.log('✅ backlog-fixes-2026-11 tests passed');
