/**
 * PAP Magazine — Instagram → Article 변환 공유 라이브러리.
 *
 * QA #275. 두 가지 소비자:
 *   • POST /api/admin/articles/from-instagram (어드민 수동 URL 붙여넣기)
 *   • GET  /api/cron/sync-instagram         (매시간 자동 동기화)
 *
 * 핵심 함수:
 *   fetchInstagramPost(urlOrId)  → { id, caption, mediaUrls, permalink, timestamp }
 *   generateArticleFromPost(post) → { title_ko, title_en, body_ko, body_en, category, tags, slug }
 *   buildArticleRow(post, generated) → articles INSERT용 row 객체
 *
 * Instagram Graph API 호출은 IG_ACCESS_TOKEN + IG_USER_ID 환경변수에 의존.
 * 둘 다 없으면 oEmbed fallback (제한적 — caption + media url 정도만)을 시도.
 */

const papVoice = require('./papVoice');
const { parseJsonObject } = require('./jsonRepair');

const _IG_API = 'https://graph.facebook.com/v18.0';

// URL/shortcode/media-id 등 입력을 통합해서 항상 shortcode를 반환.
function _extractShortcode(input){
  if (!input) return null;
  const s = String(input).trim();
  // 이미 shortcode 모양 ("Czxy1234abc") 그대로 받기
  if (/^[A-Za-z0-9_-]{6,20}$/.test(s) && !s.includes('/')) return s;
  const m = s.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Graph API로 IG Business Account 소속 미디어 목록 가져오기.
// limit: 최대 25 (Graph API 기본값).
// 2026-07-23 — 다계정 지원. opts.userId/opts.token 이 오면 그 계정, 없으면
// 기본 env(IG_USER_ID/IG_ACCESS_TOKEN = @pap_magazine). 하위 계정 백필용.
// 2026-07-26 — 자격증명 위생 처리 + 본계정 토큰 폴백.
// 배경: Vercel env 에 저장된 하위 5계정 IG_*_ACCESS_TOKEN 이 파싱 불가 상태여서
// 24시간 719회 OAuthException 190 'Cannot parse access token' 이 났다. 원본 토큰은
// 멀쩡했고 붙여넣기 과정(끝 줄바꿈·따옴표·공백)에서 깨진 것으로 보인다.
// 대응 두 가지: ① 쓰기 직전에 공백·따옴표를 제거한다 ② 하위 계정 토큰이 비었거나
// 토큰 형식이 아니면 본계정 토큰(IG_ACCESS_TOKEN)으로 폴백한다.
// ②가 안전한 이유: 5계정 토큰은 애초에 본계정과 같은 유저 토큰 하나다
// (도메니코 유저가 6계정 전부 접근권 보유 — 45_Business/2026-07-24 세팅 기록).
const _TOKEN_SHAPE = /^[A-Za-z0-9_.-]{50,}$/;

function sanitizeCredential(v){
  return String(v == null ? '' : v).replace(/[\s"'`]/g, '');
}

// 하위 계정 토큰과 본계정 토큰을 받아 실제로 쓸 토큰을 고른다.
// 반환 source 는 진단·로그용 라벨일 뿐 토큰 값 자체는 절대 노출하지 않는다.
function pickAccountToken(accountToken, mainToken){
  const acct = sanitizeCredential(accountToken);
  if (_TOKEN_SHAPE.test(acct)) return { token: acct, source: 'account' };
  const main = sanitizeCredential(mainToken);
  const why = acct ? '계정 토큰 형식 불량' : '계정 토큰 없음';
  if (!_TOKEN_SHAPE.test(main)) return { token: '', source: 'none (' + why + ' + 본계정 토큰도 사용 불가)' };
  return { token: main, source: 'main (' + why + ')' };
}

function _creds(opts){
  const userId = sanitizeCredential((opts && opts.userId) || process.env.IG_USER_ID);
  const token = sanitizeCredential((opts && opts.token) || process.env.IG_ACCESS_TOKEN);
  if (!userId || !token){
    throw new Error('IG_ACCESS_TOKEN/IG_USER_ID 환경변수가 설정되어 있지 않습니다.');
  }
  return { userId, token };
}

async function listRecentMedia(opts){
  const limit = (opts && opts.limit) || 25;
  const { userId, token } = _creds(opts);
  const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username,like_count,comments_count';
  const url = `${_IG_API}/${userId}/media?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error('Graph API media list 실패 (' + res.status + '): ' + body.slice(0, 300));
  }
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

// 기간 기반 페이지네이션 수집 — sinceDays 이내 게시물을 최대 maxCount 개까지.
// Graph API paging.next 커서를 따라가며, 게시 시각이 컷오프보다 오래되면 중단.
async function listMediaPaged(opts){
  const sinceDays = (opts && opts.sinceDays) || 30;
  const maxCount = (opts && opts.maxCount) || 200;
  // 2026-07-23 — 최근 1년 전량 백필 대응. 페이지 상한을 maxCount 에 맞춰
  // 동적 계산(50개/페이지). 기존 하드코딩 10페이지(=500개)는 1년치를 다
  // 못 훑었다. cutoff(sinceDays) 가 먼저 걸리면 조기 종료되므로 안전.
  const pageGuard = (opts && opts.pageGuard) || Math.max(10, Math.ceil(maxCount / 50) + 2);
  const { userId, token } = _creds(opts);
  const cutoff = Date.now() - sinceDays * 86400000;
  const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username,like_count,comments_count';
  let url = `${_IG_API}/${userId}/media?fields=${encodeURIComponent(fields)}&limit=50&access_token=${token}`;
  const out = [];
  let guard = 0;
  while (url && out.length < maxCount && guard < pageGuard){
    guard++;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok){
      const body = await res.text().catch(() => '');
      throw new Error('Graph API media list 실패 (' + res.status + '): ' + body.slice(0, 300));
    }
    const json = await res.json();
    const rows = Array.isArray(json.data) ? json.data : [];
    let reachedCutoff = false;
    for (const m of rows){
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      if (ts && ts < cutoff){ reachedCutoff = true; break; }
      out.push(m);
      if (out.length >= maxCount) break;
    }
    if (reachedCutoff) break;
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return out;
}

// 커서 기반 단일 페이지 수집 — 전체 이력 백필 재개용.
// afterUrl(직전 실행이 저장한 paging.next) 있으면 그 지점부터, 없으면 최신부터
// 50개 한 페이지만 가져온다. 반환: { rows, next }.
//   next = 다음(더 오래된) 페이지 URL 또는 null(가장 오래된 게시물 도달).
// listMediaPaged 는 매 실행 최신부터 재-페이징(수천 개 백필 시 rate-limit·타임아웃
// 위험)하지만, 이 함수는 커서를 저장해 이어받으므로 실행당 API 호출 1회로 끝난다.
async function fetchMediaPage(opts){
  const { userId, token } = _creds(opts);
  const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username,like_count,comments_count';
  // 커서는 불투명 after 값만 저장·전달한다. Graph 의 paging.next 전체 URL 에는
  // access_token 이 박혀 있어 DB(ops_alert_state)에 저장하면 비밀값이 유출된다.
  // → after 파라미터만 넘기고 URL 은 매 호출 재구성(토큰은 DB 에 안 남는다).
  const base = `${_IG_API}/${userId}/media?fields=${encodeURIComponent(fields)}&limit=50&access_token=${token}`;
  const url = (opts && opts.afterCursor)
    ? (base + '&after=' + encodeURIComponent(opts.afterCursor))
    : base;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error('Graph API media list 실패 (' + res.status + '): ' + body.slice(0, 300));
  }
  const json = await res.json();
  const rows = Array.isArray(json.data) ? json.data : [];
  // 다음(더 오래된) 페이지가 있을 때만 after 커서 반환, 없으면 null(가장 오래된 도달).
  const nextCursor = (json.paging && json.paging.next && json.paging.cursors)
    ? (json.paging.cursors.after || null) : null;
  return { rows, nextCursor };
}

// media id 로 곧장 단건 조회한다.
//
// fetchInstagramPost() 는 shortcode → id 변환을 위해 "최근 50개"를 훑는데,
// 레거시 회수(2019~2023 화보)는 그 범위 밖이라 항상 실패한다. 스캔이 이미
// media id 를 확보해 뒀으므로 검색 없이 바로 가져온다.
// 캐러셀이면 자식까지 펼쳐 정규화된 형태로 돌려준다.
/* 캡션만 가져오는 가벼운 조회 (2026-08-17).
 *
 * fetchMediaById 를 쓰지 않는 이유: 그건 hydrateChildren 으로 캐러셀 자식까지
 * 다 받아온다. 우리가 필요한 건 caption 한 줄뿐인데 그러면 게시물 하나당
 * API 호출이 여러 번 나가고 시간도 그만큼 든다.
 *
 * 왜 필요한가: instagram_caption 은 2026-08-14 부터만 저장된다(마이그레이션 124).
 * 그 전 수집분은 캡션이 없어 두 가지를 못 한다.
 *   · 자체 취재 판별(🎥 PAP 크레딧) — 네이버 초안 선정이 이걸 쓴다
 *   · 본문 보강 — 근거가 없으면 형용사로 채우게 된다. 실측으로 확인했다:
 *     캡션 없이 워터밤 기사를 보강해보니 521자에서 589자밖에 못 늘었다.
 *
 * 반환: { id, caption } 또는 삭제·비공개면 null (호출자가 '시도했으나 없음'으로 표시).
 */
async function fetchCaptionById(mediaId, opts){
  const { token } = _creds(opts);
  const url = `${_IG_API}/${mediaId}?fields=id,caption&access_token=${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (res.status === 400 || res.status === 404){
    return null;                       // 삭제됐거나 접근 불가 — 재시도해도 같다
  }
  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error('Graph API caption 조회 실패 (' + res.status + '): ' + body.slice(0, 200));
  }
  const m = await res.json();
  return { id: String(m.id || mediaId), caption: String(m.caption || '') };
}

async function fetchMediaById(mediaId, opts){
  const { token } = _creds(opts);
  const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username';
  const url = `${_IG_API}/${mediaId}?fields=${encodeURIComponent(fields)}&access_token=${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error('Graph API media 조회 실패 (' + res.status + '): ' + body.slice(0, 200));
  }
  const m = await res.json();
  await hydrateChildren(m, opts);
  return _normalizeMedia(m);
}

// 단일 게시물 fetch.
//   shortcode 또는 media id 입력 → Graph API로 미디어 정보 가져옴.
//   Note: oEmbed는 Facebook이 2021년부터 앱 검수를 요구해서 일반 앱은 사용 불가.
//         그래서 Graph API만 사용 (자신의 Business 계정 미디어만 조회 가능).
async function fetchInstagramPost(input){
  const shortcode = _extractShortcode(input);
  if (!shortcode) throw new Error('유효한 Instagram URL/ID가 아닙니다.');

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID){
    throw new Error('IG_ACCESS_TOKEN/IG_USER_ID 환경변수가 설정되어 있지 않습니다.');
  }

  // Graph API는 자기 Business 계정 미디어만 직접 조회 가능. shortcode → id 변환을
  // 위해 최근 미디어 50개를 검색해서 매칭.
  const media = await listRecentMedia({ limit: 50 });
  const hit = media.find((m) =>
    m.permalink && m.permalink.includes('/' + shortcode + '/')
  );
  if (hit){
    await hydrateChildren(hit);
    return _normalizeMedia(hit);
  }
  throw new Error(
    '해당 게시물(' + shortcode + ')을 최근 50개 게시물에서 찾지 못했습니다. ' +
    '더 최근 게시물을 사용해 주세요. ' +
    '(IG_USER_ID가 올바른 계정인지도 확인하세요.)'
  );
}

// 캐러셀 자식 미디어를 단건 조회한다. 벌크 미디어 목록에서 children{} 중첩 확장을
// 제거(Graph API 500 "Please reduce the amount of data" 방지)한 뒤, 실제로 수집하는
// CAROUSEL_ALBUM 게시물에 대해서만 이 함수로 지연 조회한다. 반환: children.data 배열.
async function fetchMediaChildren(mediaId, opts){
  const { token } = _creds(opts);
  // id 를 반드시 포함한다 — 자식이 VIDEO 인데 media_url 이 누락돼 오는 경우
  // 그 자식 id 로 단건 재조회해야 mp4 를 건질 수 있다 (resolveVideoUrls 참고).
  const fields = 'children{id,media_url,media_type,thumbnail_url}';
  const url = `${_IG_API}/${mediaId}?fields=${encodeURIComponent(fields)}&access_token=${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error('Graph API children 조회 실패 (' + res.status + '): ' + body.slice(0, 200));
  }
  const json = await res.json();
  return (json.children && Array.isArray(json.children.data)) ? json.children.data : [];
}

// 캐러셀이면 children 을 지연 조회해 m.children.data 에 붙인다(이미 있으면 통과).
// 조회 실패는 치명적이지 않게 삼켜 대표 이미지/썸네일 폴백으로 기사화되게 둔다.
async function hydrateChildren(m, opts){
  if (!m || m.media_type !== 'CAROUSEL_ALBUM') return m;
  if (m.children && Array.isArray(m.children.data) && m.children.data.length) return m;
  try {
    const data = await fetchMediaChildren(m.id, opts);
    m.children = { data };
  } catch (e){
    console.error('[instagramImport] hydrateChildren ' + (m && m.id) + ' 실패:', (e && e.message) || e);
  }
  return m;
}

function _normalizeMedia(m){
  const out = {
    id: m.id,
    caption: m.caption || '',
    mediaUrls: [],
    videoUrls: [], // 릴스/영상 원본 mp4 — 아카이브 후 기사에서 직접 재생
    /* media_url 이 비어서 mp4 를 못 건진 VIDEO 항목의 media id.
       2026-07-31 부터 Graph API 목록 응답이 VIDEO 에 thumbnail_url 만 주고
       media_url 을 빼는 경우가 생겼다. 그 결과 videoUrls 가 빈 배열이 되고,
       archiveVideosToStorage 가 0회 반복하고 조용히 [] 를 돌려주고,
       기사에 videos:[] 로 저장돼 유튜브 쇼츠 후보에서 통째로 빠졌다.
       (실측: 07-31~08-04 릴스 기사 6건이 mp4 없이 발행됨)
       여기 담긴 id 로 resolveVideoUrls() 가 단건 재조회해 media_url 을 회수한다. */
    videoResolveIds: [],
    permalink: m.permalink,
    timestamp: m.timestamp || null,
    author: m.username || 'pap_magazine',
    isVideo: m.media_type === 'VIDEO',
    likeCount: typeof m.like_count === 'number' ? m.like_count : null,
    commentsCount: typeof m.comments_count === 'number' ? m.comments_count : null,
    // 원본 IG media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'.
    // articles.source_media_type 으로 저장 → YouTube Shorts 크론이 VIDEO(릴스)만 필터링.
    mediaType: m.media_type || null,
  };
  // 단일 / 캐러셀 / 비디오 케이스 처리.
  // mediaUrls 에는 "이미지 URL만" 넣는다 — 비전 분석(base64 image block)과
  // 기사 썸네일 모두 이미지를 기대하므로 VIDEO 는 포스터(thumbnail_url)로 대체.
  // 영상 원본은 videoUrls 로 별도 수집 (Storage 영구 보관 → <video> 재생).
  if (m.media_type === 'CAROUSEL_ALBUM' && m.children && Array.isArray(m.children.data)){
    m.children.data.forEach((c) => {
      if (!c) return;
      if (c.media_type === 'VIDEO'){
        if (c.thumbnail_url) out.mediaUrls.push(c.thumbnail_url);
        if (c.media_url) out.videoUrls.push(c.media_url);
        else if (c.id) out.videoResolveIds.push(String(c.id));
      } else if (c.media_url){
        out.mediaUrls.push(c.media_url);
      }
    });
  } else if (m.media_type === 'VIDEO'){
    if (m.thumbnail_url) out.mediaUrls.push(m.thumbnail_url);
    if (m.media_url) out.videoUrls.push(m.media_url);
    else if (m.id) out.videoResolveIds.push(String(m.id));
  } else if (m.media_url){
    out.mediaUrls.push(m.media_url);
  } else if (m.thumbnail_url){
    out.mediaUrls.push(m.thumbnail_url);
  }
  return out;
}

/**
 * media_url 이 빠진 VIDEO 항목을 단건 재조회해 videoUrls 를 채운다.
 * (2026-08-04 신설 — 유튜브 쇼츠 자동 업로드가 멈춘 근본 원인 수리)
 *
 * 왜 필요한가 — Graph API 목록 응답(`/media?fields=...`)은 VIDEO 항목에
 * thumbnail_url 만 주고 media_url 을 생략하는 경우가 있다(07-31 이후 실측).
 * 목록 응답만 믿으면 릴스의 mp4 를 영영 못 받고, 기사는 videos:[] 로 발행되며,
 * youtube-post 는 "업로드할 릴스 기사 없음" 이라고 ok=true 를 남긴다.
 * → 아무도 모르는 채로 쇼츠 업로드가 0건이 된다. 그래서 **목록에 없으면
 * 단건으로 다시 묻는다.** 단건 조회는 media_url 을 정상적으로 돌려준다.
 *
 * 실패해도 throw 하지 않는다 — 이미지/썸네일만으로도 기사는 성립한다.
 * 다만 조용히 넘어가지는 않는다: console.error 로 남겨 로그 검색이 가능하고,
 * 반환값의 resolved/failed 로 호출부가 판단할 수 있게 한다.
 *
 * @param {object} post - _normalizeMedia 결과 (videoResolveIds 를 소비, videoUrls 를 채움)
 * @param {object} [opts] - { token, userId } (미지정 시 env)
 * @returns {Promise<{attempted:number, resolved:number, failed:number}>}
 */
async function resolveVideoUrls(post, opts){
  const ids = (post && Array.isArray(post.videoResolveIds)) ? post.videoResolveIds : [];
  const stat = { attempted: ids.length, resolved: 0, failed: 0 };
  if (!ids.length) return stat;

  let token;
  try { token = _creds(opts).token; }
  catch (e){
    console.error('[ig-video] 재조회 불가 — 토큰 없음:', (e && e.message) || e);
    stat.failed = ids.length;
    return stat;
  }

  const fields = 'id,media_type,media_url,thumbnail_url';
  for (const id of ids){
    try {
      const url = `${_IG_API}/${id}?fields=${encodeURIComponent(fields)}&access_token=${token}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok){
        const body = await r.text().catch(() => '');
        console.error('[ig-video] media_url 재조회 실패 ' + id + ' (' + r.status + '): ' + body.slice(0, 200));
        stat.failed++;
        continue;
      }
      const j = await r.json();
      if (j && j.media_url){
        post.videoUrls.push(j.media_url);
        stat.resolved++;
      } else {
        console.error('[ig-video] 재조회에도 media_url 없음: ' + id);
        stat.failed++;
      }
    } catch (e){
      console.error('[ig-video] media_url 재조회 예외 ' + id + ':', (e && e.message) || e);
      stat.failed++;
    }
  }
  // 회수한 id 는 비워 둔다 — 같은 post 로 두 번 호출해도 중복 수집되지 않게.
  post.videoResolveIds = [];
  return stat;
}

// 캡션이 "에디토리얼 크레딧 게시물"인지 휴리스틱 판별.
// 에디토리얼은 사용자가 웹사이트에 사전 업로드하므로 기사 수집에서 제외해야 한다.
//
// QA #347 — 임계값 상향. 이전 (roles>=2 && handles>=3)에서는 뉴스 캡션이
// 브랜드 @handle 2-3개 + 이벤트에 관여한 스타일리스트/포토그래퍼 언급을 하는
// 정도로도 걸려 "샤넬이 그린 또 하나의 히바로", "쿠튀르는 못 갔어도, 베뉴는
// 봐야겠지" 같은 일반 뉴스 게시물이 잘못 스킵되는 문제 발생.
// 신호:
//   ① 자사 에디토리얼 페이지 링크 (강력한 신호 유지)
//   ② 진짜 크레딧 게시물의 특징 — role 라벨과 @handle이 모두 다수 (>= 4/5)
//   ③ 'editorial' 명시 + 강한 크레딧 형태(role 3, handle 3 이상)
function isLikelyEditorialCaption(caption){
  const c = String(caption || '');
  if (!c) return false;
  if (/pap-magazine\.com\/editorial\//i.test(c)) return true;
  const roleRe = /(photograph(?:er|y)|stylist|styling|starring|model|make.?up|mua|hair|retouch|art director|set design|videograph)/gi;
  const roles = (c.match(roleRe) || []).length;
  const handles = (c.match(/@[A-Za-z0-9._]{2,}/g) || []).length;
  // 진짜 크레딧 게시물은 role 라벨 4개 이상 + @핸들 5개 이상이 일반적.
  if (roles >= 4 && handles >= 5) return true;
  // 'editorial' 단어가 있더라도 뉴스 캡션에도 등장 가능하므로 강한 크레딧 조합 필요.
  if (/editorial/i.test(c) && roles >= 3 && handles >= 3) return true;
  return false;
}

// Claude API로 IG 게시물을 PAP 매거진 톤의 바이링구얼 기사로 변환.
//   입력: { caption, mediaUrls, author, permalink }
//   opts.strictEditorial=true → 백필 전용 엄격 모드: 뉴스가 아닌(에디토리얼·
//     룩북·화보·크레딧) 게시물은 반드시 Editorial 로 판정해 스킵. 애매하면 Editorial.
//   출력: { title_ko, title_en, body_ko, body_en, category, tags, slug }
async function generateArticleFromPost(post, opts){
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수 누락.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  /* ── 비전 컨텍스트: 캐러셀 앞 VISION_MAX 장 (2026-08-20, 1장 → 4장) ──
   *
   * (2026-08-22 후기: 이 진단은 틀렸다. 병목은 이미지가 아니었다 — papVoice
   *  LENGTH_ARTICLE 주석 참조. 4장 자체는 슬라이드에 찍힌 사실을 살리므로 유지한다.)
   * 왜 늘리나. 웹 본문 목표는 2026-08-17 에 800~1,200자로 올렸는데 실제 결과는
   * 이랬다 (2026-08-12~20 임포트 53편):
   *     800자 달성 1편. 중앙값 약 480자. 상향 전 400자에서 100자 오르고 멈췄다.
   * 프롬프트가 무시된 게 아니다 — **재료가 없었다.** 프롬프트는 "캡션·이미지에서
   * 확인되는 것만 쓴다 / 없으면 800자에 못 미쳐도 된다"고 못박고 있고(그게 맞다),
   * 모델은 매번 그 안전한 쪽을 골랐다.
   *
   * 실측(최근 14일 130편): 갤러리 이미지 평균 7장, 3장 이상 캐러셀이 101건(78%).
   * 그런데 모델에게 준 건 1장뿐이었다. 슬라이드에 제품명·날짜·가격·라인업이
   * 찍혀 있는데 보지 않고 있었다. 결과 본문 438자 ≈ 캡션의 한국어 절반 —
   * 사실상 캡션 재조판이었다.
   *
   * 시간 예산은 건드리지 않는다. 순차로 받으면 4배가 되므로 **병렬로 받고**,
   * 장당 타임아웃(IMG_TIMEOUT_MS)을 걸고, 실패한 장은 조용히 버린다.
   * 벽시계로는 여전히 '가장 느린 1장' 이다. 한 장도 못 받아도 캡션만으로 진행한다
   * (이미지 실패가 기사 유실이 되면 안 된다).
   *
   * Instagram CDN 은 Anthropic 의 robots.txt 를 차단하므로 직접 fetch 해서 base64 로 넘긴다.
   */
  const VISION_MAX = Number(process.env.IG_VISION_IMAGES || 4);
  const IMG_TIMEOUT_MS = Number(process.env.IG_VISION_TIMEOUT_MS || 8000);
  const IMG_MAX_BYTES = 4 * 1024 * 1024;   // Claude image block 상한 여유분

  async function fetchVisionImage(u){
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), IMG_TIMEOUT_MS);
    try {
      const imgRes = await fetch(u, { signal: ac.signal });
      if (!imgRes.ok){
        console.warn('[ig] image fetch failed:', imgRes.status, u);
        return null;
      }
      const mediaType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
      /* 안전장치: 이미지가 아니면(예: 비디오 mp4) 비전 블록에서 제외 —
         Claude image block 에 비 이미지 타입을 넣으면 API 400 으로 전체 실패. */
      if (!/^image\//.test(mediaType)){
        console.warn('[ig] 비 이미지 타입 제외:', mediaType, u);
        return null;
      }
      const arrayBuf = await imgRes.arrayBuffer();
      if (arrayBuf.byteLength > IMG_MAX_BYTES){
        console.warn('[ig] 이미지 과대 제외:', arrayBuf.byteLength, u);
        return null;
      }
      return {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: Buffer.from(arrayBuf).toString('base64') },
      };
    } catch (e){
      console.warn('[ig] image fetch error:', (e && e.message) || e);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const visionUrls = (post.mediaUrls || []).slice(0, VISION_MAX);
  const visionBlocks = (await Promise.all(visionUrls.map(fetchVisionImage))).filter(Boolean);

  const promptLines = [
    'You are a Korean fashion magazine editor at PAP Magazine.',
    'Convert the following Instagram post into a published-quality bilingual (Korean + English) article.',
    '',
    'Output format (ONLY a JSON object, no markdown fences, no prose):',
    '{',
    '  "title_ko": "(PAP 후킹 한 줄. 10~26자, 마침표 없이. 아래 후킹 규격을 따를 것)",',
    '  "title_en": "Short impactful English title, no period",',
    /* 2026-08-17 — 본문 250~450자 → 800~1,200자 (도메니코 결정, 안 '나').
       2026-08-22 — 800~1,200 → 600~800 으로 현실화. 한국어 재료가 평균 350자뿐이라
       800자는 지어내기 없이 도달 불가였다. 정본은 papVoice.LENGTH_ARTICLE.
       근거: GSC 30일 실측에서 노출의 89.6%가 4~10위에 갇혀 있었고, 발행 기사
       본문 평균이 545자였다. 250~450자는 구글이 thin content 로 본다.
       길이 규격의 정본은 papVoice.ARTICLE_VOICE 다 — 여기 숫자는 그 요약이라
       바꿀 때 반드시 같이 바꾼다(어긋나면 모델이 짧은 쪽으로 회귀한다). */
    /* 2026-08-17 — 첫 단락은 '리드'다 (GEO).
       근거: ChatGPT·Perplexity 유입이 8/10 부터 하루 10~20건으로 붙기 시작했고
       (고유 IP 87, 서로 다른 페이지 68 — 봇 아님), 인용된 페이지는 전부
       고유명사·시점·장소가 있는 사실형 기사였다. 생성 엔진은 문서를 통째로
       읽지 않고 **문단 단위로 뽑아** 인용한다. 첫 문장이 분위기 문장이면
       그 문단은 인용 후보에서 밀린다. 그래서 첫 두 문장에 육하원칙을 박는다.
       이건 문체를 바꾸라는 말이 아니다 — PAP 리듬은 둘째 단락부터 그대로다. */
    /* 2026-08-18 — 주류 과음 경고는 국민건강증진법이 문안까지 정해 둔 문장이라
       평서체로 고치면 법정 문구가 아니게 된다. '존댓말 절대 금지' 의 유일한 예외다. */
    '  "body_ko": "(평서체 ~다. 존댓말 절대 금지. 4~5단락, 각 단락 5문장 안팎, 총 600~800자. 단락은 <br><br>로 구분. HTML 인라인 태그만 사용 가능.)",',
    '  // 예외: 캡션에 법정 고지 문장(주류 과음·임신 중 음주 경고, 19세 미만 표기,',
    '  // 음주운전 경고)이 있으면 존댓말 그대로 한 글자도 바꾸지 말고 body_ko 에 옮긴다.',
    '  "body_en": "4 to 5 paragraphs in English, same paragraph count as body_ko, separated by <br><br>.",',
    '  "category": "Fashion | Beauty | Culture | News | Editorial",  // 가장 적합한 것 1개',
    '',
    'IMPORTANT — category "Editorial" is reserved for fashion-editorial CREDIT posts:',
    'a photo spread announcement whose caption is mostly a credits list',
    '(Photographer/Stylist/Starring/@handles) rather than news content.',
    'If this post is such an editorial credit post, set category to "Editorial"',
    '(the system will skip importing it — editorials are uploaded separately).',
    'Otherwise NEVER use "Editorial".',
    '  "tags": ["5-10 lowercase keyword tags"],',
    /* 2026-08-23 — 도메니코: "대댓글 해시태그는 인물이나 브랜드에 포커스 맞춰서."
       tags 는 일반 키워드라 #SPORTYCHIC #PINKSTYLING 같은 게 섞였다.
       주체만 따로 받는다. 인스타 해시태그는 한글·영문 검색이 갈리므로 둘 다 받는다. */
    '  "entities": [  // 이 기사의 주체. **인물 · 그룹 · 브랜드만.**',
    '    // 스타일/컬러/장소/분위기 키워드는 절대 넣지 말 것 (그건 tags 로 간다).',
    '    // 중요한 순서로 최대 4개. 한글 표기가 없는 브랜드는 ko 를 "" 로.',
    '    {"ko": "지수", "en": "JISOO"}, {"ko": "블랙핑크", "en": "BLACKPINK"}, {"ko": "알로", "en": "ALO"}',
    '  ],',
    /* 2026-08-23 — 첫 댓글은 우리가 직접 단다. 기사 마지막이 질문으로 끝나는 비율이
       실측 67% 뿐이라, 나머지 33% 는 댓글이 비고 그러면 대댓글 해시태그까지 통째로 못 달렸다.
       (브리프 9·10번이 실제로 그랬다) 그래서 질문을 따로 항상 받는다. */
    '  "comment_question": "(독자에게 던지는 질문 한 문장. 반드시 ? 로 끝낼 것. 기사 내용에 붙어 있어야 한다. 20~40자)",',
    '  "slug": "english-url-friendly-slug-from-title",',
    '  "faq": [  // AEO: 독자가 검색엔진/AI에 실제로 물어볼 자연어 질문 3개 (한국어)',
    '    {"q": "자연어 질문 (예: 발렌시아가 2026 쿠튀르 쇼는 어디서 열렸나요?)",',
    '     "a": "질문에 대한 자기완결형 직접 답변 20~60단어. 답을 먼저 말하고 근거를 붙일 것. 기사 본문에 없는 사실 금지."}',
    '  ]',
    '}',
    '',
    'Article rules:',
    '- DO NOT just translate the caption. Expand it into a proper magazine article.',
    '- Body must read as standalone journalism. Never reference "this Instagram post".',
    '- Cite brand/designer names when visible in the images.',
    /* 2026-08-20 — 캐러셀 앞 4장을 넘긴다. 슬라이드마다 다른 사실이 찍혀 있는
       경우가 많다(제품명·날짜·가격·라인업·장소). 첫 장만 보고 쓰면 그 사실들이
       통째로 버려지고, 그게 본문이 480자에서 멈추던 이유다. */
    '- You are given up to 4 images from this post (carousel slides), in order.',
    '  **Read every one of them.** Slides after the first often carry different facts —',
    '  product names, dates, prices, lineups, venues, spec lists, credits printed on the image.',
    '  Put those facts in the body. They are the main reason the body can reach 600 characters.',
    '  Text printed inside an image is a confirmed fact — it is not something you invented.',
    '  If the slides genuinely add nothing, a shorter body is still correct. Never invent.',
    /* 리드 규칙 (2026-08-17, GEO) */
    '- 첫 단락의 처음 두 문장은 **리드**다. 누가·무엇을·언제·어디서를 여기서 끝낸다.',
    '  브랜드명·인물명·제품명·날짜·장소 같은 고유명사를 원문 그대로 적는다.',
    '  분위기 묘사, 수사적 질문, "요즘 ~하다" 같은 일반론으로 시작하지 않는다.',
    '  읽는 사람이 첫 두 문장만 보고도 무슨 일인지 알아야 한다.',
    '- 둘째 단락부터는 PAP 리듬 그대로다. 리드 규칙은 첫 두 문장에만 적용된다.',
    '- 본문에 확인된 사실이 있으면 숫자·연도·컬렉션명을 그대로 쓴다. 뭉개지 않는다.',
    '- body_en 의 첫 두 문장도 같은 규칙을 따른다 (영어 페이지가 한국어와 동률로 인용된다).',
    '',
    '==================== PAP 에디터 말투 지문 (최우선 규격) ====================',
    'PAP 인스타그램 실게시물 50개를 역설계해 도출한 실제 에디터 문체다.',
    '일반적인 매거진 톤 직관보다 아래 규격이 항상 우선한다.',
    '',
    papVoice.ARTICLE_VOICE,
    '=========================================================================',
    '',
    'Instagram post metadata:',
    '- Author: @' + (post.author || 'pap_magazine'),
    '- Permalink: ' + (post.permalink || '(none)'),
    '- Original caption: """',
    String(post.caption || '(no caption)').slice(0, 4000),
    '"""',
  ];
  // 백필 전용 엄격 모드 — 에디토리얼 배제가 최우선. 애매하면 Editorial 로.
  if (opts && opts.strictEditorial){
    promptLines.push(
      '',
      'STRICT BACKFILL — editorial exclusion is the TOP priority:',
      'Collect NEWS ARTICLES ONLY. If this post is a fashion photo editorial,',
      'lookbook, campaign or photoshoot visual, photo spread, model/collection',
      'showcase, or a credits/collaborators post rather than a WRITTEN NEWS story,',
      'you MUST set "category":"Editorial" so it is skipped. When you are unsure',
      'whether it is news or editorial, you MUST choose "Editorial".'
    );
  }
  const prompt = promptLines.join('\n');

  visionBlocks.push({ type: 'text', text: prompt });

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model,
      /* 3000 → 6000 (2026-08-17). 목표가 600~800자로 내려간 뒤에도 여유는 그대로
         둔다 — 상한이 낮아 손해가 없고, 잘림 사고가 더 비싸다.
         본문 목표가 250~450자에서 800~1,200자로
         올라갔고, 출력은 한국어 본문 + 영어 본문 + 제목 2종 + 태그 + FAQ 3개를
         한 JSON 에 담는다. 3000 으로 두면 JSON 이 중간에서 잘려 파싱이 실패하고
         그 게시물은 통째로 유실된다(수집 크론은 실패분을 재시도하지 않는다). */
      max_tokens: 6000,
      messages: [{ role: 'user', content: visionBlocks }],
    }),
  });
  if (!apiRes.ok){
    const body = await apiRes.text().catch(() => '');
    throw new Error('Claude API 실패 (' + apiRes.status + '): ' + body.slice(0, 300));
  }
  const j = await apiRes.json();
  let raw = '';
  try { raw = String(j.content[0].text || '').trim(); }
  catch (_) { throw new Error('Claude 응답 형식 이상.'); }
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  /* 2026-08-18 — JSON.parse 두 번 시도가 전부였다. 실측 실패:
     sync-pepperit 2건 · sync-instagram 1건 ('Claude 응답 JSON 파싱 실패').
     생 개행·안 닫힌 따옴표 하나면 기사 한 편이 통째로 버려진다.
     번역·뉴스레터가 이미 만들어 둔 복구 계단을 여기서도 쓴다.
     복구했으면 조용히 넘기지 않는다 — 모델 출력이 나빠지는 신호일 수 있다. */
  let parsed;
  {
    const r = parseJsonObject(raw, 'IG 기사');
    if (r.repaired !== 'none') console.warn('[instagramImport] \u26a0\ufe0f JSON \ubcf5\uad6c\ud568(' + r.repaired + ')');
    parsed = r.value;
  }
  return {
    title_ko: String(parsed.title_ko || '').trim(),
    title_en: String(parsed.title_en || '').trim(),
    body_ko:  String(parsed.body_ko  || '').trim(),
    body_en:  String(parsed.body_en  || '').trim(),
    category: String(parsed.category || 'News').trim(),
    tags:     Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).toLowerCase().replace(/^#+/, '').trim()).filter(Boolean).slice(0, 10) : [],
    // 해시태그용 주체(인물·그룹·브랜드). ko/en 각각 없을 수 있다.
    entities: Array.isArray(parsed.entities)
      ? parsed.entities
          .map((e) => ({ ko: String((e && e.ko) || '').trim(), en: String((e && e.en) || '').trim() }))
          .filter((e) => e.ko || e.en)
          .slice(0, 4)
      : [],
    comment_question: String(parsed.comment_question || '').trim(),
    slug:     String(parsed.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || null,
    // AEO FAQ (2026-07-16) — {q,a} 검증 후 최대 5개
    faq: Array.isArray(parsed.faq)
      ? parsed.faq
          .filter((f) => f && typeof f.q === 'string' && typeof f.a === 'string' && f.q.trim() && f.a.trim())
          .map((f) => ({ q: String(f.q).trim().slice(0, 200), a: String(f.a).trim().slice(0, 600) }))
          .slice(0, 5)
      : [],
  };
}

// IG CDN 이미지를 Supabase Storage('media' 버킷)로 복사해 영구 URL 배열 반환.
// IG CDN URL 은 수일 내 만료되므로 웹사이트 썸네일·틱톡 게시 모두 영구본 필수.
// 개별 실패는 건너뛰고 성공분만 반환 — 전량 실패 시 빈 배열 (호출부 fallback).
async function archiveImagesToStorage(post, max, prefix){
  const { supabaseAdmin } = require('./supabase');
  const out = [];
  const dir = prefix || 'ig-articles'; // 페퍼릿 등 브랜드별 분리 저장 가능
  const urls = (post.mediaUrls || []).slice(0, max || 10);
  for (let i = 0; i < urls.length; i++){
    try {
      const r = await fetch(urls[i], { signal: AbortSignal.timeout(20000) });
      if (!r.ok){ console.warn('[ig-archive] fetch ' + r.status + ':', urls[i]); continue; }
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!/^image\//.test(ct)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = ct === 'image/png' ? 'png' : (ct === 'image/webp' ? 'webp' : 'jpg');
      const path = dir + '/' + String(post.id || 'unknown') + '/' + i + '.' + ext;
      const { error } = await supabaseAdmin.storage.from('media')
        .upload(path, buf, { contentType: ct, upsert: true });
      if (error){ console.warn('[ig-archive] upload 실패:', error.message); continue; }
      const { data } = supabaseAdmin.storage.from('media').getPublicUrl(path);
      if (data && data.publicUrl) out.push(data.publicUrl);
    } catch (e){
      console.warn('[ig-archive] error:', (e && e.message) || e);
    }
  }
  return out;
}

// 릴스/영상 원본을 Storage 로 영구 복사 (IG CDN 영상 URL 도 수일 내 만료).
// 60MB 초과 파일은 서버리스 메모리·시간 한도 보호를 위해 건너뛴다.
//
// 2026-08-04 — 4번째 인자 report 로 결과를 밖으로 흘린다.
//   기존에는 무슨 일이 있어도 배열 하나만 돌려줘서, "영상 URL 자체가 0개"인지
//   "받다가 실패"인지 구분할 수 없었다. 그 구분이 안 되니 videos:[] 인 기사가
//   정상처럼 발행됐다. 이제 호출부가 report.attempted / failures 로 판별한다.
//   console.warn → console.error 로 올린 것도 같은 이유다(Vercel 로그 검색용).
async function archiveVideosToStorage(post, max, prefix, report){
  const { supabaseAdmin } = require('./supabase');
  const out = [];
  const dir = prefix || 'ig-articles';
  const urls = (post.videoUrls || []).slice(0, max || 2);
  const rep = (report && typeof report === 'object') ? report : {};
  rep.attempted = urls.length;
  rep.succeeded = 0;
  rep.failures = [];
  const note = (url, reason) => {
    rep.failures.push({ url: String(url || '').slice(0, 120), reason: String(reason).slice(0, 200) });
    console.error('[ig-video] ' + reason);
  };
  for (let i = 0; i < urls.length; i++){
    try {
      const r = await fetch(urls[i], { signal: AbortSignal.timeout(45000) });
      if (!r.ok){ note(urls[i], 'fetch ' + r.status); continue; }
      const ct = (r.headers.get('content-type') || 'video/mp4').split(';')[0];
      if (!/^video\//.test(ct) && !/octet-stream/.test(ct)){ note(urls[i], 'content-type 불일치: ' + ct); continue; }
      const len = parseInt(r.headers.get('content-length') || '0', 10);
      if (len > 60 * 1024 * 1024){ note(urls[i], '60MB 초과 스킵 (' + len + 'B)'); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 60 * 1024 * 1024){ note(urls[i], '60MB 초과 스킵 (본문 ' + buf.length + 'B)'); continue; }
      const path = dir + '/' + String(post.id || 'unknown') + '/v' + i + '.mp4';
      const { error } = await supabaseAdmin.storage.from('media')
        .upload(path, buf, { contentType: 'video/mp4', upsert: true });
      if (error){ note(urls[i], 'upload 실패: ' + error.message); continue; }
      const { data } = supabaseAdmin.storage.from('media').getPublicUrl(path);
      if (data && data.publicUrl){ out.push(data.publicUrl); rep.succeeded++; }
      else note(urls[i], 'publicUrl 없음');
    } catch (e){
      note(urls[i], 'error: ' + ((e && e.message) || e));
    }
  }
  return out;
}

// articles INSERT용 row 구성 (DB 컬럼 명에 맞춰서).
function buildArticleRow(post, generated, opts){
  opts = opts || {};
  const status = opts.status || 'draft';
  // 영구 저장본(archiveImagesToStorage) 우선, 실패 시 IG CDN 원본 fallback.
  const archived = Array.isArray(opts.archivedUrls) ? opts.archivedUrls : [];
  const imgs = archived.length ? archived : (post.mediaUrls || []);
  return {
    // published 로 바로 내보낼 때는 게시일 필수 (목록·RSS·사이트맵이 published_date 정렬)
    published_date: status === 'published'
      ? (post.timestamp || new Date().toISOString())
      : null,
    gallery: imgs,
    videos: Array.isArray(opts.videoUrls) ? opts.videoUrls : [],
    title: generated.title_ko || generated.title_en || ('Instagram post ' + post.id),
    title_en: generated.title_en || null,
    content: generated.body_ko || '',
    content_en: generated.body_en || null,
    category: generated.category || 'News',
    tags: generated.tags || [],
    slug: generated.slug || null,
    // AEO FAQ (083) — 빈 배열이면 null (스키마 미노출)
    faq: (Array.isArray(generated.faq) && generated.faq.length) ? generated.faq : null,
    thumbnail_url: imgs[0] || null,
    status: status,
    // QA #275 — Instagram 소스 메타.
    source_instagram_url:     post.permalink || null,
    source_instagram_post_id: post.id || null,
    // 원본 IG media_type — YouTube Shorts 크론이 VIDEO(릴스)만 골라내는 데 사용.
    source_media_type:        post.mediaType || null,
    /* 캡션 원문 보관 (2026-08-14).
     *
     * 지금까지 캡션은 기사 생성에만 쓰고 버렸다. 그런데 캡션에는 우리가
     * 어디서도 복원할 수 없는 정보가 하나 들어 있다 — 크레딧 줄이다.
     *   🎥 PAP           → 우리가 직접 찍은 것
     *   🎥 @jamiroquaihq → 남의 소스
     * "자체 취재냐" 는 홈판 전략의 핵심 구분인데(유일한 사진 = 유일한 콘텐츠),
     * DB 의 다른 어떤 컬럼으로도 안 갈린다. 실측으로 확인했다:
     * credits·is_celeb·digest_kind·source_media_type·태그가 자체 취재와
     * 통신사 재탕에서 전부 동일했다.
     *
     * editorials.instagram_caption 과 같은 이름을 쓴다(규칙이 두 벌이면
     * 한쪽만 고쳐진다). 소비자: naver-blog-draft.js 의 초안 선정.
     */
    instagram_caption:        post.caption || null,
    instagram_imported_at:    new Date().toISOString(),
  };
}

module.exports = {
  listRecentMedia,
  listMediaPaged,
  fetchMediaPage,
  fetchInstagramPost,
  fetchMediaById,
  fetchCaptionById,
  generateArticleFromPost,
  buildArticleRow,
  archiveImagesToStorage,
  archiveVideosToStorage,
  resolveVideoUrls,
  isLikelyEditorialCaption,
  fetchMediaChildren,
  hydrateChildren,
  normalizeMedia: _normalizeMedia,
  _extractShortcode,
  sanitizeCredential,
  pickAccountToken,
};
