/**
 * PAP Magazine — 레거시 화보 이미지 회수 크론
 * Route: /api/cron/legacy-image-recover  (vercel.json crons 에 등록, 10분 주기)
 *
 * 스캔이 matched 로 판정한 화보 161편에 IG 원본 이미지를 붙인다.
 * 로직은 _lib/legacyImageApply.js — 관리자 수동 엔드포인트와 공용이다.
 *
 * 왜 크론인가 (2026-07-31, 도메니코 "자동화해줘"):
 *   161편 × (IG 조회 + 이미지 최대 12장 Storage 복사)는 한 번의 함수 실행으로
 *   못 끝낸다. 사람이 엔드포인트를 반복 호출하는 방식은 그 사람이 자리를
 *   비우면 멈춘다 — 오늘 하루 종일 고친 문제가 정확히 그런 종류였다.
 *
 * 완주 후에도 끌 필요 없다: matched 잔여가 0이면 IG 호출 없이 즉시 반환한다.
 * 나중에 스캔을 다시 돌려 새 matched 가 생기면 10분 안에 자동으로 붙는다.
 *
 * 안전 규약은 _lib 쪽 주석 참고. 요약:
 *   matched 만 건드린다(ambiguous 10편은 사람이 볼 때까지 손대지 않음) ·
 *   IG CDN URL 대신 Storage 사본을 저장한다(원본 URL 은 수일 내 만료) ·
 *   이미지 0장이면 그 화보는 건드리지 않는다(빈 값이 플레이스홀더보다 나쁘다).
 *
 * 환경변수: IG_ACCESS_TOKEN / IG_USER_ID (없으면 503), CRON_SECRET (선택)
 */
'use strict';

const { withCronGuard } = require('../_lib/cronGuard');
const { applyLegacyImages } = require('../_lib/legacyImageApply');

/* 함수 상한 120s 대비 여유. 화보 1편이 이미지 12장을 받아 올리는 데 시간이
   걸려 편차가 크므로 예산을 넉넉히 남긴다 — 상한에 걸려 죽으면 cronGuard
   기록조차 안 남는다(오늘 실제로 겪었다). */
const BUDGET_MS = 70000;
/* 실행당 처리 편수. 잔량 161편이라 8편 × 6회/시 = 약 3.5시간이면 완주한다.
   더 올려도 예산에 걸려 어차피 못 쓴다. */
const PER_RUN = Number(process.env.LEGACY_IMAGE_PER_RUN || 8);

module.exports = withCronGuard('legacy-image-recover', async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const out = await applyLegacyImages({ limit: PER_RUN, budgetMs: BUDGET_MS });

  /* 실행 요약을 cron_runs.note 에 남긴다.
     'ok' 는 함수가 안 죽었다는 뜻이지 일을 했다는 뜻이 아니다 — 이 구분이
     없어서 번역 백필이 열흘간 0건인 걸 아무도 몰랐다. */
  res.locals = res.locals || {};
  res.locals.cronNote = out.done && !out.applied
    ? '완료 — matched 잔여 0'
    : `적용 ${out.applied} · 건너뜀 ${out.skipped} · 잔여 ${out.remaining}`
      + (out.results || [])
        .filter(r => r.error || r.skipped)
        .slice(0, 2)
        .map(r => ' · ' + String(r.title || '').slice(0, 20) + ': ' + String(r.error || r.skipped).slice(0, 40))
        .join('');

  return res.status(200).json(out);
}, { silenceTransient: true });
