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
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');

const PAGE = 500;
const MAX_INSERT_PER_RUN = 300; // 한 번에 과도한 쓰기 방지 — 남으면 다음 실행이 이어감

/* 인스타 핸들/이름 → brand_id (소문자, URL·@·후행슬래시 제거).
   브랜드 페이지 라우트가 소문자 id 로 조회하므로 그 규칙에 맞춘다. */
function toBrandId(raw) {
  if (!raw) return '';
  const s = String(raw).trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  // 계정 핸들로 성립하는 문자만 — 한글 브랜드명·공백 표기는 페이지가 없으므로 제외
  return /^[a-z0-9._-]{2,60}$/.test(s) ? s : '';
}

function parseFashion(f) {
  let o = f;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (_) { return []; } }
  return o && Array.isArray(o.brands) ? o.brands : [];
}

module.exports = withCronGuard('brand-sync', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) { const u = await requireAdmin(req, res); if (!u) return; }

  // 1) 발행 기사의 fashion 크레딧 수집 (페이지네이션)
  const candidates = new Map(); // brand_id → display_name
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
      parseFashion(row.fashion).forEach((b) => {
        if (!b) return;
        // 인스타 핸들만 사용 — 표기명(name) 폴백 금지.
        // brand_id 는 핸들 규격(instagram_handle 로도 저장)이라 이름으로 지어내면
        // 크레딧에 "VINTAGE"·"VIA"·"EDITION" 이라고만 적힌 건이 브랜드 페이지가 된다
        // (2026-07-28 실측 8건: vintage·via·edition·whistler·aflame·humanhu·
        //  sangyexianke·sixdo). 핸들이 없는 브랜드는 등록하지 않는다.
        const id = toBrandId(b.instagram);
        if (!id || candidates.has(id)) return;
        const label = String((b.name || '') || id).trim().replace(/^@/, '');
        candidates.set(id, (label || id).toUpperCase().slice(0, 120));
      });
    });
    if (data.length < PAGE) break;
  }

  const ids = [...candidates.keys()];
  if (!ids.length) return res.status(200).json({ scanned: 0, inserted: 0, done: true });

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
    return res.status(200).json({ scanned: ids.length, existing: existing.size, inserted: 0, done: true });
  }

  // 3) 신규만 insert — 기존 행은 절대 덮어쓰지 않는다(수동 편집분 보존)
  const rows = missing.map((id) => ({
    brand_id: id,
    display_name: candidates.get(id) || id.toUpperCase(),
    category: 'fashion',      // NOT NULL — 기본 분류. 관리자가 나중에 정정.
    status: 'pending',
    instagram_handle: id,
    note: 'auto: editorial fashion credits',
  }));
  const { error: insErr } = await supabaseAdmin.from('brands').insert(rows);
  if (insErr) throw insErr;

  const remaining = ids.filter((id) => !existing.has(id)).length - missing.length;
  return res.status(200).json({
    scanned: ids.length,
    existing: existing.size,
    inserted: rows.length,
    remaining,
    done: remaining <= 0,
  });
});
