/**
 * PAP Magazine — 에디토리얼 ↔ 원본 IG 게시물 연결 (백필 + 자동 크론)
 * Route: GET /api/editorials/backfill-ig   (관리자 · 크론)
 *
 * 무엇: source_instagram_url 이 비어 있는 에디토리얼을, IG 아카이브
 * 게시물 캡션에서 제목 매칭으로 찾아 permalink 를 채운다.
 * (에디토리얼 게시물 캡션은 관례적으로 'Title' exclusive for @pap_magazine
 *  형태라 제목 포함 매칭의 정확도가 높다.)
 *
 * 왜: 이 링크가 채워져야 SSR/SPA 의 "원본 게시물 임베드 + 좋아요·저장·
 * 보내기" 깔때기가 3천여 개 아카이브 전체에서 작동한다.
 *
 * 2026-08-08 — 크론화. 도메니코: "에디토리얼 페이지에 인스타그램창은 아직
 * 없어." 실측하니 8월 발행분 5편 전부 source_instagram_url 이 NULL 이었다
 * (7월 2편 포함). 임베드 코드·데이터 배선은 다 고쳐졌는데, 이 링크를 채우는
 * 도구가 **관리자 수동 실행 전용**이라 최근 관리자 업로드 화보들이 영영
 * 연결되지 않았던 것. 이제 Vercel 크론이 6시간마다 최근 2페이지(~200개
 * 게시물)를 스캔해 자동 연결한다 — 새 화보의 IG 게시물은 항상 최근에 있다.
 * 옛 구간 대량 스캔은 여전히 관리자 수동(?pages·?after)으로.
 *
 * 사용:
 *   크론(6시간마다): Authorization: Bearer CRON_SECRET → 자동 apply, 2페이지
 *   관리자 수동:
 *   GET /api/editorials/backfill-ig                → dry-run, 첫 10페이지(~1000개 게시물) 스캔
 *   GET /api/editorials/backfill-ig?apply=1        → 실제 저장
 *   GET /api/editorials/backfill-ig?after=<cursor> → 이어서 스캔 (응답의 next_after 사용)
 *   GET /api/editorials/backfill-ig?pages=5        → 스캔 페이지 수 조절 (기본 10, 최대 20)
 *
 * 안전장치:
 *   - 수동은 기본 dry-run — 확인 후 apply=1. (크론은 apply 가 목적이라 자동)
 *   - 정규화 제목 5자 미만 / 동일 제목 에디토리얼 2개 이상(모호) → 스킵.
 *   - 이미 채워진 에디토리얼은 건드리지 않음.
 *   - Graph API rate limit 대비 페이지 캡 + 커서 이어달리기.
 *
 * 필요 환경변수: IG_ACCESS_TOKEN, IG_USER_ID (sync-instagram 과 동일)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
// 2026-08-08 — 크론 실행 기록·실패 알림. 이게 없으면 "돌았는지"조차 알 수 없다
// (뉴스레터 3주 침묵 사고의 교훈 — 관측성 없는 크론 금지).
const { withCronGuard } = require('../_lib/cronGuard');

const IG_API = 'https://graph.facebook.com/v18.0';

function norm(s) {
  // 접기(folding) 매칭: 소문자 + 악센트 제거(Diagnóstico→diagnostico) +
  // 알파넘·한글만 남김 → 구두점/공백 차이("ATHLETE- THE" vs "ATHLETE - THE"),
  // 따옴표 스타일 차이에 강건해진다. 대신 최소 길이 기준을 5로 올려
  // 과매칭을 방지한다.
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9가-힣]/g, '');
}

async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).end(); }

  /* 크론 요약 메모 — 빈칸이면 대시보드에서 정상처럼 보인다 (weekly-news 교훈) */
  function note(msg) { res.locals = res.locals || {}; res.locals.cronNote = msg; }

  /* 크론 인증 — Vercel 은 Authorization: Bearer CRON_SECRET 을 보낸다.
     ⚠ x-vercel-cron 헤더는 오지 않는다 (celeb-classify 무한 401 사고). */
  const auth = req.headers.authorization || '';
  const isCron = !!process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!isCron) {
    const user = await requireAdmin(req, res);
    if (!user) { note('인증 거부 — 크론이면 CRON_SECRET 확인'); return; }
  }

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    note('IG_ACCESS_TOKEN / IG_USER_ID 미설정 — 아무것도 못 함');
    return res.status(503).json({ error: 'IG_ACCESS_TOKEN / IG_USER_ID 환경변수 미설정.' });
  }

  /* 크론 모드: 저장이 목적이므로 자동 apply, 최근 2페이지만 (새 화보의
     IG 게시물은 항상 최근에 있다 — 옛 구간은 관리자 수동의 몫). */
  const apply = isCron ? req.query.apply !== '0' : req.query.apply === '1';
  const maxPages = Math.max(1, Math.min(20, parseInt(req.query.pages || (isCron ? '2' : '10'), 10)));
  let after = req.query.after ? String(req.query.after) : null;
  // 페이지당 요청 개수 — 오래된 아카이브 구간에서 Graph API가
  // "Please reduce the amount of data" (code 1) 를 반환하면 자동으로 절반씩
  // 줄여 재시도한다 (최소 10). ?limit= 으로 시작값 지정 가능.
  let pageLimit = Math.max(10, Math.min(100, parseInt(req.query.limit || '100', 10) || 100));
  // Graph API 요청 타임아웃(ms). 딥 커서 페이지네이션(수천 개 뒤)은 limit=10
  // 에서도 15초를 넘길 수 있어 ?timeout= 으로 최대 50초까지 완화 가능.
  const fetchTimeout = Math.max(5000, Math.min(50000, parseInt(req.query.timeout || '15000', 10) || 15000));
  // 시간 필터 — 딥 커서를 따라가는 대신 옛 구간으로 바로 점프.
  // ?until=<unix초 또는 YYYY-MM-DD> → 해당 시각 이전 게시물부터 스캔.
  let until = null;
  if (req.query.until) {
    const raw = String(req.query.until);
    until = /^\d+$/.test(raw) ? raw : String(Math.floor(new Date(raw).getTime() / 1000) || '');
    if (!until || until === 'NaN') until = null;
  }

  try {
    // 1) 링크가 비어 있는 에디토리얼 (발행분만)
    const { data: eds, error } = await supabaseAdmin
      .from('editorials')
      .select('id, title, slug, published_date')
      .eq('status', 'published')
      .is('source_instagram_url', null)
      .limit(5000);
    if (error) throw error;

    // 제목 → 에디토리얼 매핑. 같은 정규화 제목이 2개 이상이면 모호 → 제외.
    const byTitle = new Map();
    const ambiguousTitles = new Set();
    (eds || []).forEach(e => {
      const t = norm(e.title);
      if (t.length < 5) return; // 너무 짧은 제목은 오매칭 위험 (접기 매칭이라 기준 상향)
      if (byTitle.has(t)) { ambiguousTitles.add(t); return; }
      byTitle.set(t, e);
    });
    ambiguousTitles.forEach(t => byTitle.delete(t));

    if (!byTitle.size) {
      note('연결할 화보 없음 (미연결 0 또는 전부 모호/짧은 제목)');
      return res.status(200).json({
        done: true, matched: 0,
        message: '링크가 비어 있는(그리고 매칭 가능한) 에디토리얼이 없습니다.',
      });
    }

    // 매칭 정확도를 위해 긴 제목부터 검사 (짧은 제목이 긴 제목의 부분문자열인 경우 대비)
    const titles = [...byTitle.keys()].sort((a, b) => b.length - a.length);

    // 2) IG 아카이브 페이지 순회 (caption + permalink 만 — 가벼운 필드)
    const fields = 'caption,permalink,timestamp';
    const matches = [];
    const matchedTitleSet = new Set();
    let scanned = 0, pages = 0, nextAfter = null;

    while (pages < maxPages) {
      const url = IG_API + '/' + process.env.IG_USER_ID + '/media'
        + '?fields=' + encodeURIComponent(fields)
        + '&limit=' + pageLimit
        + (until ? '&until=' + encodeURIComponent(until) : '')
        + (after ? '&after=' + encodeURIComponent(after) : '')
        + '&access_token=' + process.env.IG_ACCESS_TOKEN;
      const r = await fetch(url, { signal: AbortSignal.timeout(fetchTimeout) });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        // Graph API code 1: 응답 데이터가 너무 큼 (캡션이 긴 옛 게시물 구간에서
        // limit=100 이 초과) → 같은 커서에서 페이지 크기를 절반으로 줄여 재시도.
        if (body.indexOf('reduce the amount of data') !== -1 && pageLimit > 10) {
          pageLimit = Math.max(10, Math.floor(pageLimit / 2));
          continue;
        }
        throw new Error('Graph API 실패 (' + r.status + '): ' + body.slice(0, 200));
      }
      const j = await r.json();
      const media = Array.isArray(j.data) ? j.data : [];
      scanned += media.length;
      pages++;

      for (const m of media) {
        if (!m.permalink || !m.caption) continue;
        const cap = norm(m.caption);
        for (const t of titles) {
          if (matchedTitleSet.has(t)) continue; // 에디토리얼당 첫(최신) 게시물 1개만
          if (cap.indexOf(t) !== -1) {
            const e = byTitle.get(t);
            matches.push({
              editorial_id: e.id, title: e.title, slug: e.slug,
              permalink: m.permalink, post_time: m.timestamp || null,
            });
            matchedTitleSet.add(t);
            break; // 게시물 하나는 에디토리얼 하나에만
          }
        }
      }

      after = j.paging && j.paging.cursors && j.paging.cursors.after;
      const hasNext = j.paging && j.paging.next;
      if (!hasNext || !after) { nextAfter = null; after = null; break; }
      nextAfter = after;
      // 남은 미매칭 제목이 없으면 조기 종료
      if (matchedTitleSet.size >= titles.length) break;
    }

    // 3) 적용 (apply=1일 때만)
    let applied = 0;
    if (apply && matches.length) {
      for (const m of matches) {
        const { error: uerr } = await supabaseAdmin
          .from('editorials')
          .update({ source_instagram_url: m.permalink })
          .eq('id', m.editorial_id)
          .is('source_instagram_url', null); // 경합 대비 이중 확인
        if (!uerr) applied++;
      }
    }

    note((apply ? '연결 ' + applied + '건' : 'dry-run 매칭 ' + matches.length + '건')
      + ' · 미연결 ' + byTitle.size + ' · 게시물 ' + scanned + '개 스캔'
      + (matches.length ? ' — ' + matches.slice(0, 3).map(m => m.title).join(', ') : ''));
    return res.status(200).json({
      mode: apply ? 'apply' : 'dry-run',
      scanned_posts: scanned,
      pages_scanned: pages,
      page_limit: pageLimit, // code 1 축소 재시도 후 최종값 (시작 기본 100)

      unlinked_editorials: byTitle.size,
      ambiguous_titles_skipped: ambiguousTitles.size,
      matched: matches.length,
      applied,
      next_after: nextAfter, // null 이면 아카이브 끝까지 스캔 완료
      hint: nextAfter
        ? '아직 스캔할 게시물이 남았습니다. ?after=' + nextAfter + ' 로 이어서 실행하세요.'
        : '아카이브 전체 스캔 완료.',
      matches: matches.slice(0, 100),
    });
  } catch (err) {
    console.error('[backfill-ig] error:', err);
    note('실패: ' + String(err && err.message || err).slice(0, 180));
    return res.status(500).json({ error: 'backfill failed', detail: String(err && err.message || err) });
  }
}

module.exports = withCronGuard('editorial-ig-link', handler);
