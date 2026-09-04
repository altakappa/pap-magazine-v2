/**
 * GET /api/cron/brand-sync — 발행 기사의 Fashion 크레딧 → brands 자동 등록.
 *
 * 배경(2026-07-28): 브랜드 페이지(/brand/<id>)는 brands 테이블에 행이 있어야만
 * 200 을 준다. 그런데 brands 를 채우는 자동 장치가 없었다 —
 * api/admin/extract-brand-aliases.js 는 '분석해서 보여주기'만 하고 DB 에 쓰지
 * 않는다(관리자가 수동으로 넣던 구조). 그래서 5월 이후 신규 브랜드가 등록되지
 * 않았고, 기사의 브랜드 내부 링크도 등록된 것만 걸려 성기게 붙었다.
 * 실측: 발행 기사 크레딧의 브랜드 289개 중 143개가 brands 에 없음.
 *
 * 하는 일: 발행 기사의 fashion.brands[] 에서 인스타 핸들을 정규화해
 * brands 에 없는 것만 status='pending' 으로 insert 한다.
 *   · pending = '노출은 되지만 제휴 승인 전' — 기존 행들과 같은 기본값이다.
 *   · 이미 있는 brand_id 는 건드리지 않는다(수동으로 손본 tier·제휴 URL 보존).
 *   · display_name 은 크레딧의 표기(name)를 우선, 없으면 핸들 대문자.
 *
 * 보안: CRON_SECRET Bearer 또는 관리자 토큰(다른 크론과 동일 관문).
 */
const { bearerOk } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');

const PAGE = 500;
const MAX_INSERT_PER_RUN = 300; // 한 번에 과도한 쓰기 방지 — 남으면 다음 실행이 이어감

/* 최소 등장 편수 (2026-07-29 신설).
 * 구형 크레딧까지 읽게 되면서 미등록 브랜드가 1,475개로 늘었는데, 그중 1,246개가
 * 딱 한 편에만 등장한다(실측). 그대로 등록하면 항목 1개짜리 얇은 페이지를 1,246개
 * 한꺼번에 만드는 셈이고, 이는 구글의 scaled content abuse 정책이 겨냥하는 형태다
 * (Ahrefs 도 기존 /brand/* 1,359건을 orphan 으로 잡고 있었다).
 * 2편 이상 등장한 브랜드만 등록한다 → 이번 대상 229개.
 * 나중에 한 편 더 실리면 다음 실행에서 자동으로 기준을 넘어 등록된다.
 * 한 편짜리 브랜드도 기사 안의 Fashion 칩(인스타·구매 링크)으로는 계속 노출된다. */
const MIN_EDITORIALS = 2;

/* 2026-07-29 — 크레딧 파싱을 공용 parseBrandCredits 로 교체.
   기존 parseFashion 은 신형 { brands:[...] } 만 읽었는데 DB 다수는 구형 배열
   [{ n, id }] 이었다(실측 2,373건). 그래서 실제 크레딧이 있는 발행 기사 788건,
   고유 브랜드 4,970개(미등록 1,475개)가 등록 대상에서 통째로 빠져 있었다.
   더미 크레딧 [{n:'Brand',id:'@brand'}](1,559건)도 공용 파서가 걸러낸다 —
   안 걸렀으면 /brand/brand 라는 가짜 페이지가 생겼다. */
const { parseBrandCredits } = require('../_lib/fashionCredits');

module.exports = withCronGuard('brand-sync', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) { const u = await requireAdmin(req, res); if (!u) return; }

  // 1) 발행 기사의 fashion 크레딧 수집 (페이지네이션)
  //    등장 편수도 함께 센다 — 얇은 페이지 방지 게이트(MIN_EDITORIALS)에 쓴다.
  const candidates = new Map(); // brand_id → { name, count }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('editorials')
      .select('fashion')
      .eq('status', 'published')
      .not('fashion', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    data.forEach((row) => {
      // parseBrandCredits 가 두 형태·더미·핸들 규격 검사를 모두 처리한다.
      // 표기명(name)에서 핸들을 지어내지 않는 원칙도 그 안에 있다 —
      // 2026-07-28 실측으로 vintage·via·edition·whistler 같은 크레딧 상용어가
      // 브랜드 페이지가 되던 문제를 막기 위한 것.
      // parseBrandCredits 는 한 기사 안에서 이미 중복을 제거하므로,
      // 여기서 세는 건 '몇 편에 등장했는가'가 된다.
      parseBrandCredits(row.fashion).forEach((b) => {
        const cur = candidates.get(b.id);
        if (cur) cur.count += 1;
        else candidates.set(b.id, { name: b.name, count: 1 });
      });
    });
    if (data.length < PAGE) break;
  }

  // 얇은 페이지 방지 — 2편 이상 등장한 브랜드만 등록 대상으로 삼는다.
  const scanned = candidates.size;
  const ids = [...candidates.entries()]
    .filter(([, v]) => v.count >= MIN_EDITORIALS)
    .map(([id]) => id);
  if (!ids.length) {
    return res.status(200).json({ scanned, eligible: 0, inserted: 0, done: true });
  }

  // 2) 이미 있는 것 제외 (in 절은 청크로 — URL 길이 한계 회피)
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('brands').select('brand_id').in('brand_id', ids.slice(i, i + 200));
    if (error) throw error;
    (data || []).forEach((r) => existing.add(r.brand_id));
  }

  const missing = ids.filter((id) => !existing.has(id)).slice(0, MAX_INSERT_PER_RUN);
  if (!missing.length) {
    return res.status(200).json({ scanned, eligible: ids.length, existing: existing.size, inserted: 0, done: true });
  }

  // 3) 신규만 insert — 기존 행은 절대 덮어쓰지 않는다(수동 편집분 보존)
  const rows = missing.map((id) => ({
    brand_id: id,
    display_name: (candidates.get(id) && candidates.get(id).name) || id.toUpperCase(),
    category: 'fashion',      // NOT NULL — 기본 분류. 관리자가 나중에 정정.
    status: 'pending',
    instagram_handle: id,
    note: 'auto: editorial fashion credits',
  }));
  const { error: insErr } = await supabaseAdmin.from('brands').insert(rows);
  if (insErr) throw insErr;

  const remaining = ids.filter((id) => !existing.has(id)).length - missing.length;
  return res.status(200).json({
    scanned,
    eligible: ids.length,
    existing: existing.size,
    inserted: rows.length,
    remaining,
    done: remaining <= 0,
  });
});
