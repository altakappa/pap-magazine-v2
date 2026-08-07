/**
 * PAP Magazine — Threads API 공유 라이브러리 (@pap_magazine · @pepperitmag)
 *
 * 의존 env: THREADS_APP_ID, THREADS_APP_SECRET
 * 토큰 저장: threads_auth 테이블 (071) — 장기 토큰 60일, 만료 임박 시 자동 연장.
 *
 * 소비자:
 *   api/threads/oauth.js    — 인증 시작 (관리자 1회, 해당 계정 로그인 상태)
 *   api/threads/callback.js — 코드 교환 → 장기 토큰 저장
 *   api/cron/threads-post.js — 신규 기사 자동 게시 (TEXT + 링크 프리뷰)
 *   api/cron/social-digest.js — 모아보기 다이제스트 (PAP=1, 페퍼릿=2)
 *
 * 앱은 개발 모드 + @pap_magazine 이 Threads 테스터 — 본 계정 게시는 심사 없이
 * 즉시 실사용 가능 (테스터 계정의 게시물은 실제 공개 게시물이다).
 *
 * ── 계정 다중화 (2026-08-05, 도메니코 지시) ─────────────────────────
 * threads_auth 는 원래 한 행짜리 표였다 (071 — `id INT PRIMARY KEY DEFAULT 1
 * CHECK (id = 1)`). 페퍼릿(@pepperitmag)이 자기 다이제스트를 따로 내보내게
 * 되면서 계정이 둘이 됐고, 행을 id 로 가른다. **1 = PAP · 2 = 페퍼릿.**
 * `CHECK (id = 1)` 은 마이그레이션 099 에서 푼다 — 그게 안 돌면 id=2 저장이
 * 코드가 아니라 DB 에서 막힌다. (표 구조는 이미 있었지만 제약이 남아 있었다.)
 *
 * 모든 함수의 accountId 는 기본값 1 이다. 기존 호출부(threadsAutopost,
 * threads-post, threads-metrics)는 인자 없이 그대로 부르면 예전과 완전히 같은
 * 동작을 한다 — 페퍼릿은 순수 추가지 PAP 경로 변경이 아니다.
 *
 * REDIRECT_URI 는 계정이 늘어도 늘리지 않는다. 콜백 도메인을 하나 더 만들면
 * Meta 앱 콘솔의 리디렉션 URL 목록까지 같이 바꿔야 하는데, 그건 저장소 밖의
 * 설정이라 배포로 되돌릴 수가 없다. 대신 "어느 계정을 인증하는 중인가"를
 * OAuth state 에 실어 보내고 콜백에서 되읽는다. state 는 원래 승인 화면을
 * 왕복하는 자유 문자열이라 이런 용도로 쓰라고 있는 자리다.
 */

const { supabaseAdmin } = require('./supabase');
const { pushAlert } = require('./pushAlert');

const AUTH_BASE = 'https://threads.net/oauth/authorize';
const GRAPH = 'https://graph.threads.net';

/* 스레드 캐러셀 상한은 20장이다. 우리 기사 갤러리는 최대 12장이라 실제로는
   거의 안 걸리지만, 상한을 코드에 적어 두면 나중에 인스타가 더 많이 허용해도
   조용히 깨지지 않는다. */
const MAX_CAROUSEL = 20;
/* 스레드가 받는 이미지 형식은 JPEG·PNG 뿐이다. webp 를 보내면 컨테이너가
   ERROR 로 떨어진다. 우리 갤러리는 실측 전부 .jpg 였지만 필터는 남겨 둔다 —
   instagramImport 의 archiveImagesToStorage 가 webp 도 저장할 수 있다. */
const IMAGE_EXT = /\.(jpe?g|png)(\?|$)/i;
// 2026-08-03 — threads_manage_insights 추가. 성과 지표(views/likes/replies/
// reposts/quotes) 조회에 필요하다. 기존 토큰에는 이 권한이 없으므로
// /api/threads/oauth 재인증 1회가 있어야 threads-metrics 크론이 동작한다.
// (토큰 자체가 2026-09-05 만료라 어차피 재인증이 필요한 시점이다.)
const SCOPES = 'threads_basic,threads_content_publish,threads_manage_insights';
const REDIRECT_URI = 'https://www.pap-magazine.com/api/threads/callback';

/* threads_auth.id → 계정. 번호는 DB 행 번호 그 자체다 (1=PAP, 2=페퍼릿).
   oauthUrl 이 둘 다 pap-magazine.com 인 것은 오타가 아니다 — 위 머리말대로
   콜백 도메인을 하나로 묶었으므로 인증 시작점도 한 도메인에 둔다. */
const ACCOUNTS = {
  1: { handle: '@pap_magazine', brand: 'PAP',
       oauthUrl: 'https://www.pap-magazine.com/api/threads/oauth' },
  2: { handle: '@pepperitmag', brand: 'PEPPERIT',
       oauthUrl: 'https://www.pap-magazine.com/api/threads/oauth?account=2' },
};
const DEFAULT_ACCOUNT_ID = 1;

/**
 * 계정 번호 정규화. 모르는 값·빈 값은 조용히 1(PAP)로 떨어뜨린다.
 * 여기서 던지지 않는 이유: 이 값은 크론 쿼리스트링과 OAuth state 처럼 바깥에서
 * 들어온다. 오타 하나로 PAP 자동 게시가 통째로 멎는 것보다, 기본 계정으로
 * 떨어뜨리고 넘어가는 쪽이 덜 위험하다.
 */
function normalizeAccountId(accountId) {
  const n = Number(accountId);
  return ACCOUNTS[n] ? n : DEFAULT_ACCOUNT_ID;
}

/** 계정 메타 (handle / brand / oauthUrl). 알림 문구가 계정을 밝히는 데 쓴다. */
function accountInfo(accountId) {
  return ACCOUNTS[normalizeAccountId(accountId)];
}

/**
 * OAuth state 에 계정 번호를 싣는다 — 'acct2.<타임스탬프>' 꼴.
 * 콜백이 이 값만 보고 어느 행에 토큰을 넣을지 정한다.
 */
function buildState(accountId) {
  return 'acct' + normalizeAccountId(accountId) + '.' + Date.now();
}

/**
 * state 에서 계정 번호를 되읽는다.
 * 형식이 안 맞거나 아예 없으면 1 이다 — 예전에 나간 'pap-<ts>' 형식 state 로
 * 돌아오는 승인 화면이 있어도 PAP 토큰으로 정상 저장된다(하위 호환).
 */
function accountIdFromState(state) {
  const m = String(state || '').match(/^acct(\d+)\./);
  return m ? normalizeAccountId(m[1]) : DEFAULT_ACCOUNT_ID;
}

/**
 * 승인 화면 URL.
 * state 를 직접 주면 그대로 쓰고(기존 호출부 호환), 안 주면 accountId 로 만든다.
 */
function authorizeUrl(state, accountId) {
  const p = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_type: 'code',
    state: state || buildState(accountId),
  });
  return AUTH_BASE + '?' + p.toString();
}

// 코드 → 단기 토큰 → 장기 토큰(60일) 교환 후 저장
async function exchangeCode(code, accountId) {
  const acct = normalizeAccountId(accountId);
  const body = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID,
    client_secret: process.env.THREADS_APP_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  });
  const r = await fetch(GRAPH + '/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('token exchange 실패: ' + JSON.stringify(j).slice(0, 200));

  const lr = await fetch(GRAPH + '/access_token?grant_type=th_exchange_token&client_secret='
    + encodeURIComponent(process.env.THREADS_APP_SECRET) + '&access_token=' + encodeURIComponent(j.access_token), {
    signal: AbortSignal.timeout(15000),
  });
  const lj = await lr.json();
  if (!lr.ok || lj.error) throw new Error('장기 토큰 교환 실패: ' + JSON.stringify(lj).slice(0, 200));

  await saveToken({ user_id: String(j.user_id || ''), access_token: lj.access_token, expires_in: lj.expires_in }, acct);
  return { user_id: j.user_id, expires_in: lj.expires_in, account_id: acct, handle: ACCOUNTS[acct].handle };
}

async function saveToken(t, accountId) {
  const patch = {
    id: normalizeAccountId(accountId),
    access_token: t.access_token,
    expires_at: new Date(Date.now() + (t.expires_in || 5184000) * 1000).toISOString(),
    scope: SCOPES,
    updated_at: new Date().toISOString(),
  };
  if (t.user_id) patch.user_id = t.user_id;
  const { error } = await supabaseAdmin.from('threads_auth').upsert(patch);
  if (error) throw error;
}

// 토큰 이상 알림 — 같은 알림이 10분마다 울리지 않도록 6시간 쿨다운.
// 마지막 발송 시각은 threads_auth.alerted_at 에 기록한다 (마이그레이션 097).
const TOKEN_ALERT_COOLDOWN_MS = 6 * 3600 * 1000;

async function alertTokenTrouble(kind, msLeft, row, detail, accountId) {
  try {
    const acct = normalizeAccountId(accountId);
    const info = ACCOUNTS[acct];
    const last = row && row.alerted_at ? new Date(row.alerted_at).getTime() : 0;
    if (Date.now() - last < TOKEN_ALERT_COOLDOWN_MS) return;
    const days = Math.max(0, Math.floor(msLeft / 86400000));
    const expired = kind === 'expired';
    /* 알림에 계정을 밝힌다. 계정이 둘이 된 뒤로 '토큰 만료' 한 줄만 봐서는
       어느 쪽을 재인증해야 하는지 알 수가 없다 — 재인증 링크도 계정별이다. */
    await pushAlert({
      title: expired
        ? '\uD83D\uDD11 [' + info.brand + '] Threads 토큰 만료 — 자동 게시 중단'
        : '\uD83D\uDD11 [' + info.brand + '] Threads 토큰 연장 실패 — ' + days + '일 남음',
      lines: [
        expired
          ? '토큰이 만료돼 Threads 자동 게시가 멈췄다.'
          : '자동 연장이 실패했다. 남은 기간 동안은 기존 토큰으로 계속 게시되지만, ' + days + '일 뒤 멈춘다.',
        '조치: ' + info.handle + ' 로그인 상태에서 아래 링크 1회 방문 → 재인증',
        '사유: ' + String(detail || '').slice(0, 200),
      ],
      url: info.oauthUrl,
      urlLabel: 'Threads 재인증 (' + info.handle + ')',
      personalOnly: true,
    });
    await supabaseAdmin.from('threads_auth')
      .update({ alerted_at: new Date().toISOString() }).eq('id', acct);
  } catch (e) {
    // 알림 실패가 게시를 막으면 안 된다 — 로그만 남기고 통과.
    console.error('[threads] 토큰 알림 실패:', e && e.message);
  }
}

// 유효 토큰 반환 — 만료 7일 전부터 th_refresh_token 으로 60일 연장
// accountId 기본값 1(PAP). 계정마다 토큰·만료·알림 쿨다운이 따로 돈다.
async function getAccessToken(accountId) {
  const acct = normalizeAccountId(accountId);
  const info = ACCOUNTS[acct];
  const { data: row, error } = await supabaseAdmin.from('threads_auth').select('*').eq('id', acct).single();
  if (error || !row || !row.access_token) throw new Error('Threads 미인증 (' + info.handle + ') — ' + info.oauthUrl + ' 로 1회 인증 필요');
  const msLeft = new Date(row.expires_at || 0).getTime() - Date.now();
  if (msLeft > 7 * 86400000) return { token: row.access_token, userId: row.user_id };
  const r = await fetch(GRAPH + '/refresh_access_token?grant_type=th_refresh_token&access_token='
    + encodeURIComponent(row.access_token), { signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (!r.ok || j.error) {
    // 연장 실패 — 남은 기간 내면 기존 토큰으로 계속, 완전 만료면 재인증 요구.
    // 2026-08-03 — 예전엔 여기서 조용히 기존 토큰을 돌려줬다. 연장이 계속
    // 실패해도 아무도 모르다가 7일 뒤 전 채널이 갑자기 멎는 구조였다.
    // 이제 알림을 보낸다 (6시간 쿨다운 — 10분 크론 스팸 방지).
    const why = JSON.stringify(j && j.error ? j.error : j).slice(0, 200);
    if (msLeft > 0) {
      await alertTokenTrouble('refresh', msLeft, row, why, acct);
      return { token: row.access_token, userId: row.user_id };
    }
    await alertTokenTrouble('expired', msLeft, row, why, acct);
    throw new Error('token refresh 실패 (만료) — /api/threads/oauth 재인증 필요: ' + JSON.stringify(j).slice(0, 150));
  }
  await saveToken({ access_token: j.access_token, expires_in: j.expires_in }, acct);
  return { token: j.access_token, userId: row.user_id };
}

/**
 * TEXT 스레드 게시 (본문 내 첫 URL이 링크 프리뷰 카드가 된다).
 * 2단계: 컨테이너 생성 → 게시.
 *
 * 엔드포인트: `/v1.0/me/threads` — 저장된 user_id 로 요청하면 Threads API 가
 * Instagram user ID 를 Threads user ID 로 오인하여 code 100 subcode 33
 * ('Object does not exist / missing permissions') 반환한다. `me` 사용 시
 * 토큰 소유자로 자동 매핑되어 안전.
 *
 * @param {string} text ≤500자
 * @param {number} [accountId=1] threads_auth.id — 1=PAP, 2=페퍼릿
 * @returns {Promise<string>} thread id
 */
/* 컨테이너가 FINISHED 될 때까지 기다린다.
 *
 * 2026-07-23 — 생성 직후 바로 발행하면 컨테이너 처리(텍스트에 링크가 있으면
 * 미리보기 페치, 이미지면 다운로드·검증 포함)가 안 끝나 "Media Not Found"
 * (code 24) 가 난다. 텍스트 글에서 겪은 사고인데 이미지 글은 더 오래 걸린다 —
 * 메타가 우리 URL 로 이미지를 실제로 받아 가기 때문이다. 그래서 대기 횟수를
 * 인자로 받는다.
 *
 * postText 가 쓰던 로직을 그대로 뽑은 것이라 텍스트 경로의 동작은 안 변한다. */
async function waitContainer(id, token, tries) {
  const n = tries || 6;
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 3000 : 4000));
    const st = await fetch(GRAPH + '/v1.0/' + id + '?fields=status,error_message&access_token=' + encodeURIComponent(token), {
      signal: AbortSignal.timeout(10000),
    });
    const sj = await st.json().catch(() => ({}));
    if (sj.status === 'FINISHED') return true;
    if (sj.status === 'ERROR') throw new Error('컨테이너 처리 실패: ' + (sj.error_message || JSON.stringify(sj).slice(0, 200)));
    if (i === n - 1) throw new Error('컨테이너 처리 대기 초과 (status=' + (sj.status || '?') + ')');
  }
  return false;
}

async function publishContainer(id, token) {
  const pub = await fetch(GRAPH + '/v1.0/me/threads_publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: id, access_token: token }),
    signal: AbortSignal.timeout(20000),
  });
  const pj = await pub.json();
  if (!pub.ok || !pj.id) throw new Error('게시 실패: ' + JSON.stringify(pj).slice(0, 300));
  return pj.id;
}

/**
 * 이미지·영상과 함께 게시한다 (2026-08-07, 도메니코 요청).
 *
 * 왜 만들었나 ────────────────────────────────────────────────────────
 * 그동안 스레드에 이미지가 실린 건 우리 코드가 아니라 **인스타 앱의
 * '스레드에도 공유'** 기능이었다. 그건 인스타 캡션을 글자 그대로 복사한다.
 * 도메니코: "캡션은 인스타그램과 동일하게 올리지 않고 웹사이트 링크 태그해서
 * 지금 자동으로 올라가는 것처럼 캡션을 써서 올리는걸로 하고싶어."
 *
 * 그래서 이미지도 우리가 올린다. 인스타 크로스포스트는 도메니코가 앱에서 끈다.
 *
 * ⚠️ 링크 미리보기 카드는 포기하는 것이다. 스레드는 이미지가 붙은 글에
 *    카드를 안 만들어 준다 — 링크는 본문 안에 글자로 남는다. 도메니코가
 *    알고 고른 거래다("이미지 여러 장 + 링크(텍스트)").
 *
 * 한 장이면 IMAGE, 두 장 이상이면 CAROUSEL 이다. 캐러셀은 자식 컨테이너를
 * 먼저 만들고(is_carousel_item=true) 그 id 들을 children 으로 묶는다.
 * 자식에는 text 를 넣지 않는다 — 캡션은 부모에만 붙는다.
 *
 * 영상도 같은 문으로 받는다. 도메니코: "내가 인스타에 올리는 영상이나
 * 이미지들을 그대로 올려주면돼." 영상이 있으면 영상 한 편으로 나간다
 * (X 의 selectArticleMedia 와 같은 판단 — 릴스는 영상이 본체다).
 *
 * @param {{images?:string[], video?:string}} media
 * @param {string} text ≤500자
 * @param {number} [accountId=1]
 * @returns {Promise<{id:string, kind:'video'|'image'|'carousel', count:number}>}
 */
async function postMedia(media, text, accountId) {
  const m = media || {};
  const video = String(m.video || '').trim();
  const urls = (Array.isArray(m.images) ? m.images : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https:\/\//i.test(u) && IMAGE_EXT.test(u))
    .slice(0, MAX_CAROUSEL);

  const { token } = await getAccessToken(accountId);
  const caption = String(text || '').slice(0, 500);

  if (video && /^https:\/\//i.test(video)) {
    const create = await fetch(GRAPH + '/v1.0/me/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        media_type: 'VIDEO', video_url: video, text: caption, access_token: token,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const cj = await create.json();
    if (!create.ok || !cj.id) throw new Error('영상 컨테이너 생성 실패: ' + JSON.stringify(cj).slice(0, 300));
    /* 영상은 메타가 받아서 트랜스코딩까지 한다 — 이미지보다 훨씬 오래 걸린다. */
    await waitContainer(cj.id, token, 20);
    return { id: await publishContainer(cj.id, token), kind: 'video', count: 1 };
  }

  if (!urls.length) throw new Error('쓸 수 있는 이미지·영상 URL 이 없다');

  if (urls.length === 1) {
    const create = await fetch(GRAPH + '/v1.0/me/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        media_type: 'IMAGE', image_url: urls[0], text: caption, access_token: token,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const cj = await create.json();
    if (!create.ok || !cj.id) throw new Error('이미지 컨테이너 생성 실패: ' + JSON.stringify(cj).slice(0, 300));
    await waitContainer(cj.id, token, 10);
    return { id: await publishContainer(cj.id, token), kind: 'image', count: 1 };
  }

  /* 자식 컨테이너를 순서대로 만든다. 병렬로 하면 빠르지만 순서가 흐트러질 수
     있고, 한 장이 실패했을 때 어느 장인지 알기 어렵다. 게시 순서는 매거진
     콘텐츠에서 의미가 있으므로(첫 컷이 표지다) 순차로 간다. */
  const children = [];
  for (let i = 0; i < urls.length; i++) {
    const r = await fetch(GRAPH + '/v1.0/me/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        media_type: 'IMAGE', image_url: urls[i], is_carousel_item: 'true', access_token: token,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (!r.ok || !j.id) throw new Error('캐러셀 ' + (i + 1) + '번째 컨테이너 실패: ' + JSON.stringify(j).slice(0, 200));
    children.push(j.id);
  }

  const create = await fetch(GRAPH + '/v1.0/me/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      media_type: 'CAROUSEL', children: children.join(','), text: caption, access_token: token,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const cj = await create.json();
  if (!create.ok || !cj.id) throw new Error('캐러셀 컨테이너 생성 실패: ' + JSON.stringify(cj).slice(0, 300));
  /* 장수만큼 처리 시간이 는다 — 대기를 넉넉히 준다(장당 2회, 최소 12회). */
  await waitContainer(cj.id, token, Math.max(12, urls.length * 2));
  return { id: await publishContainer(cj.id, token), kind: 'carousel', count: urls.length };
}

/**
 * 기사 한 건에서 스레드에 올릴 미디어를 고른다.
 * X 의 selectArticleMedia 와 **같은 판단**이어야 한다 — 두 채널이 서로 다른
 * 그림을 올리면 어느 쪽이 맞는지 아무도 모르게 된다.
 */
function selectArticleMedia(article) {
  const a = article || {};
  const videos = Array.isArray(a.videos) ? a.videos.filter(Boolean) : [];
  const gallery = Array.isArray(a.gallery) ? a.gallery.filter(Boolean) : [];
  const src = String(a.source_media_type || '').toUpperCase();
  if (src === 'VIDEO' && videos.length) return { video: videos[0], images: [] };
  if (gallery.length) return { images: gallery.slice(0, MAX_CAROUSEL), video: '' };
  if (videos.length) return { video: videos[0], images: [] };
  return { images: [], video: '' };
}

async function postText(text, accountId) {
  const { token } = await getAccessToken(accountId);
  const create = await fetch(GRAPH + '/v1.0/me/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ media_type: 'TEXT', text: String(text || '').slice(0, 500), access_token: token }),
    signal: AbortSignal.timeout(20000),
  });
  const cj = await create.json();
  if (!create.ok || !cj.id) throw new Error('컨테이너 생성 실패: ' + JSON.stringify(cj).slice(0, 300));
  // 2026-07-23 — 생성 직후 즉시 발행하면 컨테이너 처리(텍스트에 링크가
  // 있으면 미리보기 페치 포함)가 안 끝난 상태라 "Media Not Found"(code 24)
  // 가 난다 (제니 기사 무한 재시도 사고 실측). Meta 권고대로 상태를
  // 폴링해 FINISHED 확인 후 발행하고, ERROR 면 사유를 그대로 표면화한다.
  await waitContainer(cj.id, token, 6);
  return publishContainer(cj.id, token);
}

/**
 * 게시물 1건의 성과 지표 조회 (Threads Insights).
 *
 * 엔드포인트: GET /v1.0/{thread-id}/insights?metric=views,likes,replies,reposts,quotes
 * 필요 권한: threads_manage_insights — 2026-08-03 SCOPES 에 추가했으므로
 * 재인증 전 토큰으로 호출하면 권한 오류가 난다. 그 경우 err.needsReauth=true
 * 로 표시해 호출부가 '실패'가 아니라 '대기'로 처리할 수 있게 한다.
 *
 * 응답 형태가 지표마다 다르다 — 단일값은 values[0].value, 총계형은
 * total_value.value 로 온다. 둘 다 받아 정규화한다.
 *
 * @param {string} threadId
 * @param {number} [accountId=1] threads_auth.id — 지표는 게시한 계정의 토큰으로만 읽힌다
 * @returns {Promise<{views:number|null, likes:number|null, replies:number|null, reposts:number|null, quotes:number|null}>}
 */
const INSIGHT_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes'];

async function getThreadInsights(threadId, accountId) {
  if (!threadId) throw new Error('thread_id 없음');
  const { token } = await getAccessToken(accountId);
  const u = GRAPH + '/v1.0/' + encodeURIComponent(threadId) + '/insights'
    + '?metric=' + INSIGHT_METRICS.join(',')
    + '&access_token=' + encodeURIComponent(token);
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const errObj = j && j.error ? j.error : j;
    const e = new Error('insights 조회 실패: ' + JSON.stringify(errObj).slice(0, 200));
    const code = Number(errObj && errObj.code);
    // code 10 = permission denied, 190 = 토큰 무효, 200 = 권한 부족.
    e.needsReauth = code === 10 || code === 190 || code === 200
      || /permission|scope|insights/i.test(String(errObj && errObj.message || ''));
    throw e;
  }
  const out = {};
  for (const m of INSIGHT_METRICS) out[m] = null;
  for (const row of (j.data || [])) {
    const name = String(row && row.name || '').toLowerCase();
    if (!INSIGHT_METRICS.includes(name)) continue;
    let v = null;
    if (row.total_value && row.total_value.value != null) v = Number(row.total_value.value);
    else if (Array.isArray(row.values) && row.values.length) v = Number(row.values[0].value);
    out[name] = Number.isFinite(v) ? v : null;
  }
  return out;
}

module.exports = {
  authorizeUrl, exchangeCode, getAccessToken, postText, postMedia, selectArticleMedia, getThreadInsights,
  MAX_CAROUSEL,
  INSIGHT_METRICS, REDIRECT_URI,
  /* 계정 다중화 (2026-08-05) — 호출부는 accountId 를 안 주면 예전대로 1(PAP)이다. */
  ACCOUNTS, DEFAULT_ACCOUNT_ID, normalizeAccountId, accountInfo, buildState, accountIdFromState,
};
