/**
 * PAP Magazine — 레거시 IG 에디토리얼 대량 임포트 (보류 — 크론 미등록)
 *
 * ⚠️ 2026-07-06: 이전 웹사이트 정적 JSON(2,371편, 갤러리·크레딧 완비)이
 * frontend/data/ 에 존재함이 확인되어 api/admin/legacy-import-json.js 가
 * 정식 임포트 경로가 됐다. 이 IG 스캔 방식은 제목·데이터 품질이 낮고
 * slug 체계가 달라 중복을 만들 수 있으므로 vercel.json 크론에서 제외.
 * (JSON에 없는 IG 전용 게시물 회수가 필요해질 때만 관리자 수동 실행.)
 *
 * Route: /api/cron/legacy-import  (관리자 수동 전용)
 *
 * 목적: 웹사이트 오픈 이전 인스타그램에만 존재하는 에디토리얼 ~2,000편을
 * editorials 레코드(legacy=true)로 생성 → 아카이브·사이트맵·검색 인덱스에
 * 개별 페이지로 편입. 페이지 비주얼은 기존 IG 임베드 인프라(source_instagram_url)
 * 를 그대로 사용하므로 이미지 재호스팅 불필요 (IG CDN 만료와 무관).
 *
 * 흐름 (회당):
 *   1. legacy_import_state 커서 로드 (done이면 즉시 종료)
 *   2. Graph API /media 페이지네이션 (limit 50/페이지, 최대 2페이지)
 *   3. 필터: IMAGE·CAROUSEL + 에디토리얼 캡션 휴리스틱 + 중복(slug/permalink) 제외
 *   4. 제목 추출 (캡션 1행 휴리스틱) → INSERT (legacy=true, published)
 *   5. 커서·집계 저장. 다음 페이지 없으면 done=true
 *
 * 진행 확인: GET ?status=1 (관리자) → state 반환.
 * 수동 트리거: 관리자 토큰 POST/GET.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');

const IG_API = 'https://graph.facebook.com/v21.0';
const PAGE_LIMIT = 50;      // Graph API 페이지 크기
const MAX_PAGES = 2;        // 회당 최대 스캔 100편
const MAX_IMPORT = 60;      // 회당 최대 생성 (인서트 부하 제한)

// ── 에디토리얼 판별 휴리스틱 ─────────────────────────────────
// 크레딧 구조(직군 단어)나 화보 키워드가 있으면 에디토리얼로 간주.
// 릴스/단순 셀럽 밈은 제외. 과소포함보다 과대포함이 낫다(어드민에서 정리 가능).
const ED_RE = /photograph|photographer|model|styl(ist|ing)|editorial|starring|makeup|make-up|hair|direct(or|ion)|화보|에디토리얼|촬영|포토그래퍼|모델|스타일리스트/i;
function looksEditorial(caption, mediaType) {
  if (mediaType === 'VIDEO') return false; // 릴스·필름은 별도 체계
  const c = String(caption || '');
  if (ED_RE.test(c)) return true;
  const mentions = (c.match(/@[a-zA-Z0-9._]+/g) || []).length;
  return mentions >= 3; // 크레딧 태그가 3개 이상이면 화보일 확률 높음
}

// ── 캡션 → 제목 추출 ─────────────────────────────────────────
function extractTitle(caption, timestamp) {
  const first = String(caption || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  // 'Title' — ... / "Title" ... / 홑따옴표 패턴 우선
  const q = first.match(/['"‘“]([^'"’”]{2,80})['"’”]/);
  let t = q ? q[1] : first;
  // 구분자 앞부분만, 해시태그·핸들·이모지 제거
  t = t.split(/[—|·|]/)[0]
    .replace(/#[^\s#]+/g, '').replace(/@[a-zA-Z0-9._]+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s{2,}/g, ' ').trim();
  if (t.length > 80) t = t.slice(0, 77) + '…';
  if (t.length < 2) {
    const d = new Date(timestamp);
    t = 'PAP Editorial ' + d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0');
  }
  return t;
}

function shortcodeOf(permalink) {
  const m = String(permalink || '').match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    return res.status(503).json({ error: 'IG_ACCESS_TOKEN/IG_USER_ID 미설정' });
  }

  try {
    const { data: stateRow } = await supabaseAdmin
      .from('legacy_import_state').select('*').eq('id', 1).single();
    const state = stateRow || { cursor_after: null, scanned: 0, imported: 0, skipped: 0, done: false };

    if (req.query.status === '1') return res.status(200).json({ state });
    if (state.done) return res.status(200).json({ ok: true, done: true, state });

    let cursor = state.cursor_after;
    let scanned = 0, imported = 0, skipped = 0, done = false;

    for (let page = 0; page < MAX_PAGES && imported < MAX_IMPORT; page++) {
      const fields = 'id,caption,media_type,permalink,timestamp';
      let url = IG_API + '/' + process.env.IG_USER_ID + '/media?fields=' + fields
        + '&limit=' + PAGE_LIMIT + '&access_token=' + encodeURIComponent(process.env.IG_ACCESS_TOKEN);
      if (cursor) url += '&after=' + encodeURIComponent(cursor);

      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('Graph API ' + r.status + ': ' + (await r.text()).slice(0, 200));
      const j = await r.json();
      const media = Array.isArray(j.data) ? j.data : [];
      if (!media.length) { done = true; break; }

      // 이번 페이지 중복 일괄 검사 — permalink(기존 92편 연결분) + slug(이미 임포트분).
      // slug 유니크 제약에 의존하지 않는 insert 를 쓰므로 사전 검사가 필수.
      const permalinks = media.map((m) => m.permalink).filter(Boolean);
      const slugs = media.map((m) => { const s = shortcodeOf(m.permalink); return s ? 'ig-' + s.toLowerCase() : null; }).filter(Boolean);
      const [{ data: dupRows }, { data: dupSlugRows }] = await Promise.all([
        supabaseAdmin.from('editorials').select('source_instagram_url').in('source_instagram_url', permalinks),
        supabaseAdmin.from('editorials').select('slug').in('slug', slugs),
      ]);
      const dupSet = new Set((dupRows || []).map((d) => String(d.source_instagram_url).replace(/\/$/, '')));
      const dupSlugSet = new Set((dupSlugRows || []).map((d) => d.slug));

      const rows = [];
      for (const m of media) {
        scanned++;
        const sc = shortcodeOf(m.permalink);
        if (!sc) { skipped++; continue; }
        if (dupSet.has(String(m.permalink).replace(/\/$/, ''))) { skipped++; continue; }
        if (dupSlugSet.has('ig-' + sc.toLowerCase())) { skipped++; continue; }
        if (!looksEditorial(m.caption, m.media_type)) { skipped++; continue; }
        if (imported + rows.length >= MAX_IMPORT) break;
        rows.push({
          title: extractTitle(m.caption, m.timestamp),
          slug: 'ig-' + sc.toLowerCase(),
          status: 'published',
          legacy: true,
          published_date: String(m.timestamp || '').slice(0, 10) || null,
          source_instagram_url: m.permalink,
          description: String(m.caption || '').slice(0, 600) || null,
        });
      }

      if (rows.length) {
        const { error } = await supabaseAdmin.from('editorials').insert(rows);
        if (error) throw error;
        imported += rows.length;
      }

      const next = j.paging && j.paging.cursors && j.paging.cursors.after;
      const hasNext = j.paging && j.paging.next;
      cursor = next || cursor;
      if (!hasNext) { done = true; break; }
    }

    await supabaseAdmin.from('legacy_import_state').upsert({
      id: 1, cursor_after: cursor,
      scanned: (state.scanned || 0) + scanned,
      imported: (state.imported || 0) + imported,
      skipped: (state.skipped || 0) + skipped,
      done, updated_at: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true, run: { scanned, imported, skipped }, done,
      total: { scanned: (state.scanned || 0) + scanned, imported: (state.imported || 0) + imported },
    });
  } catch (err) {
    console.error('[legacy-import] error:', err);
    return res.status(500).json({ error: 'legacy import failed', detail: String(err && err.message || err).slice(0, 200) });
  }
};
