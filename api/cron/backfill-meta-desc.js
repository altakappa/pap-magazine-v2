/**
 * PAP Magazine — 에디토리얼 메타 설명 AI 백필 크론 (2026-07-23 신설, 도메니코 승인)
 * Route: /api/cron/backfill-meta-desc   (vercel.json: 10분마다, 완주 후 무해 공회전)
 *
 * 왜: Ahrefs 감사 "Meta description too short" 3,261건. DB 실측 — published
 * 에디토리얼 2,450편 중 2,359편이 설명 <120자(대부분 인스타 초기 대량 임포트라
 * 설명·브랜드·태그·캡션 전무). seoRenderer 의 렌더 시점 보강(커밋 4f62f54)이
 * "too short" 는 즉시 막지만 bare 레거시엔 템플릿 서명이라 고유성이 낮다.
 * 예산 제약이 풀려(도메니코) 실제 이미지를 보고 고유·정확한 설명을 생성해
 * description(+_en/_it)·seo_description 을 채운다 — 검증된 비전 인프라
 * (api/_lib/editorialAi.js generateEditorialDescriptions) 재사용.
 *
 * 동작:
 *  - short_desc_editorials(lim) SQL 함수로 배치 선별 (설명<120자 + 이미지 보유 +
 *    meta_desc_attempted_at IS NULL). gallery text[] 라 DB 함수(migration
 *    editorials_meta_desc_backfill).
 *  - 행별 비전 생성(커버+갤러리 최대 3장) → kr/en/it 획득.
 *    · description 이 비었으면 kr, description_en 비었으면 en, description_it
 *      비었으면 it 로 채움(기존 텍스트는 보존).
 *    · seo_description = kr(155자 컷) — 렌더러가 최우선으로 읽는 필드.
 *  - 성공/실패 무관 meta_desc_attempted_at 스탬프 + meta_desc_attempts 증가.
 *    비전이 빈 결과(이미지 접근 불가 등)면 스탬프만 남기고 넘어가되, 최대 3회까지
 *    재시도한다(무한 재시도는 여전히 금지 — 선별 함수가 attempts<3 으로 막는다).
 *
 * 2026-07-28 선별 조건 수정 (GEO 감사에서 '가짜 완주' 발견):
 *   기존 선별에 `seo_description < 110` 이 AND 로 걸려 있어, seo_description 만
 *   채워진 행이 본문 description 은 빈 채로 대상에서 빠졌다. 그래서 남은 건수가
 *   16건으로 보였지만 실제로는 본문 텍스트가 없는 발행 에디토리얼이 2,224건
 *   (전체 2,490 중 89%) 남아 있었다. AI 검색엔진이 인용하는 것은 meta 태그가
 *   아니라 본문이므로 이 구멍이 GEO 성과를 통째로 막고 있었다 —
 *   실측(Ahrefs 2026-07-28) AI 인용 16건 vs W Korea 303건 / Dazed 7,303건.
 *   판단 기준을 본문 description 하나로 단일화했다(migration
 *   fix_short_desc_editorials_selector). 재선별 대상 1,851건.
 *  - 시간 예산 90s: 초과 시 그 시점까지 저장하고 종료(다음 실행이 이어감).
 *  - 채워진 행은 description ≥120 이 되어 선별에서 자연히 빠지므로 멱등.
 *
 * 페이스: 동시 3 워커 × 10분 주기 → 실행당 9~12건, 일 ~1,500건. 비전 호출 비용
 * 발생(도메니코 승인).
 *
 * 2026-07-29 라이브 실측 후속 2건:
 *  · 선별을 '본문이 완전히 빈 행'으로 좁혔다. 짧지만 비어있지 않은 12건이
 *    published_date 정렬 맨 앞에 있어 매 실행을 통째로 소모했는데, 쓰기 규칙이
 *    기존 텍스트를 보존하므로 비전을 호출하고도 아무것도 쓰지 못하는 행이었다.
 *  · longForm 비전 호출이 건당 ~28초로 늘어 직렬로는 90초에 3건이 한계였다
 *    (1,851건 = 4일 초과). 동시 3 워커로 전환.
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { generateEditorialDescriptions } = require('../_lib/editorialAi');
const { sendTextToTelegramPersonalSafe } = require('../_lib/telegram');

const TIME_BUDGET_MS = 90000;

function _clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1).replace(/[\s,.;:—-]+$/, '') + '…';
}

module.exports = withCronGuard('backfill-meta-desc', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({ ok: true, note: 'ANTHROPIC_API_KEY 미설정 — 비전 백필 대기' });
  }

  const started = Date.now();
  // 배치 12 — 동시 3 워커 × 90s 예산, longForm 건당 ~28s 실측 기준 9~12건 소화.
  // 워커가 놀지 않도록 예산으로 소화 가능한 양보다 살짝 넉넉히 잡는다(남으면 다음 실행).
  const lim = Math.max(1, Math.min(30, parseInt((req.query && req.query.limit) || '12', 10) || 12));

  const { data: rows, error } = await supabaseAdmin.rpc('short_desc_editorials', { lim });
  if (error) throw new Error('selector failed: ' + error.message);
  if (!rows || rows.length === 0) {
    return res.status(200).json({ ok: true, done: true, filled: 0, note: 'no short-desc editorials left' });
  }

  let filled = 0, empty = 0;

  /* 동시 3건 워커풀 (2026-07-29 실측 후속).
   * longForm 비전 호출이 건당 ~28초라 직렬로는 90초 예산에 3건밖에 못 넣는다
   * (실측 12:40 실행 = 3건). 1,851건이면 4일 넘게 걸린다. 호출끼리 의존이 없고
   * DB 업데이트도 행 단위라 동시 실행이 안전하다. 3 으로 둔 것은 Anthropic
   * 레이트리밋과 120초 강제종료 사이의 여유를 남기기 위함. */
  const CONCURRENCY = 3;
  let cursor = 0;
  async function _worker() {
    for (;;) {
      if (Date.now() - started > TIME_BUDGET_MS) return;
      const i = cursor++;
      if (i >= rows.length) return;
      await processOne(rows[i]);
    }
  }

  async function processOne(row) {
    const imageUrls = [row.cover_image, ...(Array.isArray(row.gallery) ? row.gallery : [])]
      .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
      .slice(0, 3);

    let gen = { kr: '', en: '', it: '' };
    try {
      // artistStatement 비움 → 비전 모드(이미지 기반 생성)
      // longForm: 본문으로 쓸 300자+ 서술을 요청 (기본 3-4문장은 80~110자라
      //   AI 검색엔진이 인용할 분량이 안 나오고, 120자 기준도 계속 미달했다)
      // credits: 지어낸 고유명사 대신 DB 의 실제 브랜드·태그를 본문에 넣게 한다
      gen = await generateEditorialDescriptions({
        title: row.title,
        artistStatement: '',
        imageUrls,
        longForm: true,
        credits: { brands: (row.fashion && row.fashion.brands) || [], tags: row.tags || [] },
      });
    } catch (e) {
      console.error('[backfill-meta-desc] gen 실패', row.slug, e && e.message);
    }

    // attempts 증가 — 선별 함수가 attempts<3 으로 재시도를 3회로 묶는다.
    // (row 는 RPC 결과라 현재 attempts 를 들고 있지 않으므로 DB 쪽에서 +1 한다)
    const patch = {
      meta_desc_attempted_at: new Date().toISOString(),
      meta_desc_attempts: (row.meta_desc_attempts || 0) + 1,
    };
    // 기존 텍스트 보존 — 빈 칸만 채운다
    if (gen.kr && !String(row.description || '').trim()) {
      patch.description = gen.kr;
      /* 실제로 본문을 채운 순간만 도장을 찍는다 (2026-07-30 추가).
       *
       * 왜 updated_at 이 아니라 별도 컬럼인가: updated_at 은 '사람이 편집한 시각'
       * 이라 자동 백필이 덮으면 의미가 오염된다. 그래서 백필은 updated_at 을
       * 건드리지 않는데, 그 결과 "이 행이 이번 시도로 채워졌는지" 를 DB 만 보고
       * 알 수 없었다. 감시가 successes 를 "창 안에 시도 + 지금 설명 있음" 이라는
       * 간접 정의로 셀 수밖에 없었고, 24시간 창에서 실제 커버리지 증가(+102)와
       * 크게 어긋난 값(699)이 나왔다 — 감시가 실제보다 좋게 말한다.
       * 이 도장이 실제 생산량의 유일한 정직한 근거다. */
      patch.description_filled_at = patch.meta_desc_attempted_at;
    }
    if (gen.en && !String(row.description_en || '').trim()) patch.description_en = gen.en;
    if (gen.it && !String(row.description_it || '').trim()) patch.description_it = gen.it;
    // 렌더러가 최우선으로 읽는 seo_description — kr(없으면 en) 155자 컷
    const seoBase = gen.kr || gen.en || '';
    if (seoBase) patch.seo_description = _clip(seoBase, 155);

    if (patch.description || patch.seo_description) filled++; else empty++;

    const { error: upErr } = await supabaseAdmin.from('editorials').update(patch).eq('id', row.id);
    if (upErr) console.error('[backfill-meta-desc] update 실패', row.slug, upErr.message);
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => _worker()));

  // 완주 통보 — 이번 배치가 실제로 일했고(batch>0) 남은 게 0 이면 개인
  // 텔레그램으로 1회 알린다. idle 런은 위에서 early-return 하므로 여기 안 옴 → 중복 없음.
  let remaining = null;
  try {
    const { count } = await supabaseAdmin.rpc('short_desc_editorials', { lim: 100000 })
      .then(r => ({ count: (r.data || []).length }), () => ({ count: null }));
    remaining = count;
  } catch (_) {}
  if (remaining === 0) {
    sendTextToTelegramPersonalSafe(
      '✅ 에디토리얼 본문 설명 AI 백필 완주 — 발행 에디토리얼의 본문 텍스트 보강이 끝났습니다. '
      + 'AI 검색엔진(ChatGPT·Perplexity·AI Overviews)이 인용할 문장이 생겼습니다. 다음 크롤에 반영됩니다.'
    ).catch(() => {});
  }

  console.log('[backfill-meta-desc]', { filled, empty, batch: rows.length, remaining, ms: Date.now() - started });
  return res.status(200).json({ ok: true, filled, empty, batch: rows.length, remaining });
});
