/**
 * FAQ 백필 정체 판정 (2026-08-04 신설) — 의존 없는 순수 규칙.
 *
 * 왜 필요했나:
 *   backfill-faq 는 10분마다 성실히 돌면서 매번 `ok=true` 를 남겼다. 그런데
 *   실제 생산은 0건이었다. 잔여 260건의 맨 앞 12건이 전부 본문이 짧은 사진
 *   게시물이었고, 옛 fetchPending 이 LIMIT 을 먼저 걸고 나중에 걸렀기 때문에
 *   매 실행이 그 12건에 걸려 빈손으로 돌아왔다. 뒤에 밀린 234건은 손도 못
 *   댄 채 방치됐고, 크론은 그걸 '대상 없음 — 완주' 라고 보고했다.
 *
 *   같은 교훈을 서술문(_lib/backfillHealth.js)과 번역(_lib/translateHealth.js)
 *   에서 이미 두 번 배웠다. "돌았다 ≠ 생산했다." FAQ 에만 그 감시가 없어서
 *   세 번째로 같은 침묵을 겪었다. 이번엔 붙인다.
 *
 * 무엇을 세나 — cron_runs.note 를 읽는다. 크론이 남기는 요약 한 줄이
 * 곧 생산량 기록이다(별도 도장 컬럼을 추가하지 않아도 되는 이유).
 *   'FAQ 7/10 · 잔여 227'  → 이번 실행에 7건 생산
 *   'FAQ 0 · 완주'          → 더 할 일이 없다 (정상)
 *   'FAQ 0 · 대상 없음 …'   → 할 일은 있는데 앞이 막혔다 (고장)
 *
 * 이 파일은 아무것도 require 하지 않는다 — DB·네트워크 없이 규칙만 검증하기
 * 위해서다 (2026-07-30 에 테스트가 supabase 클라이언트를 만들어 CI 를 깨뜨린 교훈).
 */
'use strict';

/* 이 횟수 이상 돌았을 때만 '생산 0' 을 장애로 부른다. 표본이 적으면 우연히
   0일 수 있고(배치가 마침 다 실패), 그걸 장애로 부르면 헛알림이 된다.
   크론은 10분 간격이므로 3시간 창이면 보통 18회가 쌓인다. */
const MIN_RUNS_TO_JUDGE = 6;

/** cron_runs.note 한 줄 → 그 실행의 의미. */
function parseFaqNote(note) {
  const s = String(note == null ? '' : note).trim();
  const m = s.match(/^FAQ (\d+)\/(\d+)/);
  if (m) return { parsed: true, produced: Number(m[1]), batch: Number(m[2]), kind: 'produced' };
  if (/^FAQ 0 · 완주/.test(s)) return { parsed: true, produced: 0, batch: 0, kind: 'done' };
  if (/^FAQ 0 · 대상 없음/.test(s)) return { parsed: true, produced: 0, batch: 0, kind: 'wall' };
  return { parsed: false, produced: 0, batch: 0, kind: null };
}

/** 창 안의 note 배열 → 합계. 읽지 못한 줄(parsed=false)은 분모에서 뺀다. */
function summarizeFaqRuns(notes) {
  const list = notes || [];
  const out = { total: list.length, parsed: 0, produced: 0, done: 0, wall: 0 };
  for (const n of list) {
    const p = parseFaqNote(n);
    if (!p.parsed) continue;
    out.parsed++;
    out.produced += p.produced;
    if (p.kind === 'done') out.done++;
    if (p.kind === 'wall') out.wall++;
  }
  return out;
}

/**
 * @param {object}  o
 * @param {number}  o.remaining         FAQ 없는 발행 기사 수
 * @param {number}  o.producedInWindow  창 안에 실제로 채운 건수
 * @param {number}  o.windowHours       창 길이(시간)
 * @param {number} [o.runsInWindow]     창 안 크론 실행 수
 * @param {number} [o.parsedRuns]       그중 요약을 읽어낸 수
 * @param {number} [o.wallRuns]         '앞이 막혔다' 로 끝난 실행 수
 * @param {number} [o.doneRuns]         '완주' 로 끝난 실행 수
 * @returns {{status:string, healthy:boolean, cause:(string|null), reason:string}}
 */
function judgeFaqHealth(o) {
  const remaining = Math.max(0, Number(o && o.remaining) || 0);
  const produced = Math.max(0, Number(o && o.producedInWindow) || 0);
  const hours = Math.max(0.25, Number(o && o.windowHours) || 3);
  const runs = (o && o.runsInWindow == null) ? null : Number(o.runsInWindow);
  const parsed = (o && o.parsedRuns == null) ? null : Number(o.parsedRuns);
  const wall = Math.max(0, Number(o && o.wallRuns) || 0);
  const done = Math.max(0, Number(o && o.doneRuns) || 0);

  const perHour = Math.round((produced / hours) * 10) / 10;
  const etaHours = perHour > 0 ? Math.ceil(remaining / perHour) : null;
  const base = {
    remaining, produced, perHour, etaHours, windowHours: hours,
    runsInWindow: runs, parsedRuns: parsed, wallRuns: wall, doneRuns: done, cause: null,
  };

  // 할 일이 없으면 항상 정상 — 완주 후 30분마다 알림이 오면 재앙이다.
  if (remaining === 0) {
    return { ...base, status: 'done', healthy: true, reason: '발행 기사 전부 FAQ 보유 — 완주.' };
  }

  // 남은 게 있는데 실행 자체가 없다 → 크론 등록·배포 문제. 볼 곳이 다르다.
  if (runs === 0) {
    return {
      ...base, status: 'stalled', healthy: false, cause: 'no-runs',
      reason: `최근 ${hours}시간 backfill-faq 실행 기록이 없다. 크론 등록·배포를 먼저 본다.`,
    };
  }

  /* 실행은 했는데 요약을 한 줄도 못 읽었다 = 아직 새 note 형식이 배포되기
     전이다. 여기서 울리면 배포 직후마다 헛알림이 된다. */
  if (parsed != null && parsed === 0) {
    return {
      ...base, status: 'unknown', healthy: true,
      reason: `최근 ${hours}시간 ${runs}회 실행했으나 요약(note)이 없어 판정 보류.`,
    };
  }

  /* 이게 2026-08-04 에 놓쳤던 바로 그 모양이다 — 잔여는 있는데 선별이 앞에서
     막혀 매 실행이 빈손으로 돌아온다. 다른 어떤 신호보다 먼저 잡는다. */
  if (wall > 0) {
    return {
      ...base, status: 'stalled', healthy: false, cause: 'selector-wall',
      reason: `잔여 ${remaining}건이 있는데 최근 ${hours}시간 ${wall}회 실행이 '대상 없음' 으로 끝났다 — 선별이 앞에서 막혔다.`,
    };
  }

  /* 잔여가 남았는데 '완주' 로 끝난다 = 남은 기사는 전부 본문이 짧아 FAQ 를
     만들 근거가 없는 것들이다. 일부러 남긴 바닥이지 정체가 아니다.
     (fetchPending 이 마지막 페이지까지 훑고도 대상이 없을 때 남기는 모양.) */
  if (done > 0 && produced === 0) {
    return {
      ...base, status: 'floor', healthy: true,
      reason: `잔여 ${remaining}건은 본문이 짧아 FAQ 대상이 아니다 — 실질 완주.`,
    };
  }

  if (produced === 0) {
    /* 표본이 적으면 판정 보류. 오탐이 알림 신뢰를 깎는다. */
    if (runs != null && runs < MIN_RUNS_TO_JUDGE) {
      return { ...base, status: 'ok', healthy: true, reason: `표본 부족(${runs}회) — 판정 보류.` };
    }
    return {
      ...base, status: 'stalled', healthy: false, cause: 'no-output',
      reason: `최근 ${hours}시간 ${runs}회 실행에 저장 0건. 잔량 ${remaining}건.`,
    };
  }

  /* 생산은 있으나 일주일 안에 못 끝나면 '느림'. 알림은 보내지 않는다 —
     느린 건 장애가 아니라 배치 설정 문제이고, 매번 울리면 진짜 정체가 묻힌다. */
  if (etaHours != null && etaHours > 24 * 7) {
    return {
      ...base, status: 'slow', healthy: true,
      reason: `시간당 ${perHour}건 · 잔량 ${remaining}건 → 완주까지 약 ${Math.ceil(etaHours / 24)}일.`,
    };
  }

  return {
    ...base, status: 'ok', healthy: true,
    reason: `시간당 ${perHour}건 · 잔량 ${remaining}건 → 약 ${etaHours}시간 남음.`,
  };
}

/** 텔레그램 알림 문안. 원인별로 볼 곳이 다르므로 문장을 나눈다. */
function buildFaqAlert(d, site) {
  const S = site || 'https://www.pap-magazine.com';
  const lines = [d.reason, ''];
  if (d.cause === 'no-runs') {
    lines.push('볼 곳: vercel.json 의 crons 등록 · 최신 배포 · CRON_SECRET');
  } else if (d.cause === 'selector-wall') {
    lines.push('볼 곳: faqBackfill.fetchPending — 거르기 전에 자르면 앞줄의 짧은 기사가 큐를 막는다.');
    lines.push('  select ran_at, note from cron_runs where cron_name=\'backfill-faq\' order by ran_at desc limit 5;');
    lines.push('수동 확인: /api/admin/backfill-faq?batch=3');
  } else {
    lines.push('먼저 볼 것: Anthropic 크레딧 잔액 · ANTHROPIC_API_KEY');
    lines.push('그다음: cron_runs.note 의 실패 수 · Vercel 로그의 [backfill-faq]');
  }
  lines.push('');
  lines.push('FAQ 는 AI 검색(ChatGPT·Perplexity·AI Overviews)이 인용하는 구조라, 멈추면 그만큼 노출 기회를 잃습니다.');
  return {
    title: d.cause === 'selector-wall'
      ? '🧱 FAQ 백필 정체 — 선별이 막혀 매번 빈손'
      : '🚨 FAQ 백필 정체 — 저장 0건',
    lines,
    url: `${S}/admin`,
    urlLabel: '어드민',
  };
}

/* ══════════════════════════════════════════════════════════════════════
   백필 '차선' 감시 (2026-09-02 신설)

   ■ 왜 필요했나 — 위 감시에 구멍이 있었다

   judgeFaqHealth 는 **기사 ko 원본(articles.faq)** 하나만 본다. 그래서
   같은 크론이 이어서 도는 두 차선에는 감시가 아예 없었다:

     영문FAQ (faq_en)                 잔여 4,381
     화보FAQ 언어판 (seo_translations) 잔여 16,000+

   그 둘이 8월 28일부터 9월 2일까지 **생산 0건**이었다. 크론은 매번
   ok=true 를 남겼고 pipeline-watch 도 조용했다. 원본 FAQ 는 완주 상태라
   기존 감시가 계속 '정상' 이라고 답했기 때문이다.
   드러난 계기는 도메니코의 "너무 느리지 않나" 한마디였다. 사람이 물어봐야
   알 수 있는 상태는 감시가 아니다.

   "돌았다 ≠ 했다" 를 이 파일 머리말이 이미 적어 뒀는데, 정작 **한 크론이
   여러 일을 하면 그중 하나만 감시된다**는 건 못 적어 뒀다. 이번에 적는다.

   ■ 무엇을 새로 보나 (전부 cron_runs.note 한 줄에서 읽는다)

     · 생산 0건이 이어지는가        ← 종전과 같은 판정
     · 회전(파도) 수가 1에 붙어 있는가  ← 예산을 버리고 있다는 신호
     · 특정 언어만 계속 0 인가        ← 회전이 죽었다 (2026-09-02 에 겪은 그 모양)
     · ':실패' 가 절반을 넘는가       ← 동시 호출의 429 를 의심할 자리
   ══════════════════════════════════════════════════════════════════════ */

/* 한 파트(표·언어)가 이만큼 실패하면 '망가지는 중' 으로 본다.
   절반을 넘으면 우연이 아니다. */
const FAIL_RATIO_ALERT = 0.5;

/** 'FAQ 0 · 완주 | 영문FAQ 12 · 잔여 4381 · 2회전 · 기사:4 화보:8' 한 줄 읽기 */
function parseFaqEnNote(note) {
  return parseLane(note, '영문FAQ');
}

/** '화보FAQ 0 · 완주 | 화보FAQ 언어판 17 · 잔여 550(3/7개 언어, fr부터) · 2회전 · fr:5 es:6' */
function parseFaqI18nNote(note) {
  return parseLane(note, '화보FAQ 언어판');
}

/* 두 차선의 문장 구조가 같아서 한 함수로 읽는다.
   라벨 뒤부터 잘라서 보므로 앞쪽 원본 FAQ 요약과 섞이지 않는다 —
   'FAQ 0 · 완주' 의 0 을 생산량으로 읽는 사고를 막는다. */
function parseLane(note, label) {
  const empty = { parsed: false, produced: 0, remaining: null, waves: null, parts: {}, fails: 0 };
  const s = String(note == null ? '' : note);
  const i = s.indexOf(label);
  if (i < 0) return empty;
  const seg = s.slice(i + label.length);

  const mProd = seg.match(/^\s*(\d+)/);
  if (!mProd) return empty;

  const mRem = seg.match(/잔여 (\d+)/);
  const mWav = seg.match(/(\d+)회전/);

  /* 파트별 결과: '기사:4' '화보:8/20' 'it:6(block)' 'fr:실패'
     콜론 앞은 표 이름(한글)이거나 언어 코드다. */
  const parts = {};
  let fails = 0;
  const re = /([가-힣A-Za-z]{2,6}):(실패|잘림|\d+)/g;
  let m;
  while ((m = re.exec(seg))) {
    const key = m[1];
    if (key === '잔여' || key === '회전') continue;
    if (m[2] === '실패' || m[2] === '잘림') { parts[key] = null; fails++; }
    else parts[key] = Number(m[2]);
  }

  return {
    parsed: true,
    produced: Number(mProd[1]),
    remaining: mRem ? Number(mRem[1]) : null,
    waves: mWav ? Number(mWav[1]) : null,
    parts, fails,
  };
}

/** 창 안의 note 배열 → 차선 요약. */
function summarizeLaneRuns(notes, label) {
  const list = notes || [];
  const out = {
    total: list.length, parsed: 0, produced: 0, fails: 0, partRuns: 0,
    wavesMax: null, byPart: new Map(),
  };
  for (const n of list) {
    const p = parseLane(n, label);
    if (!p.parsed) continue;
    out.parsed++;
    out.produced += p.produced;
    out.fails += p.fails;
    if (p.waves != null) out.wavesMax = Math.max(out.wavesMax == null ? 0 : out.wavesMax, p.waves);
    for (const [k, v] of Object.entries(p.parts)) {
      out.partRuns++;
      const cur = out.byPart.get(k) || 0;
      out.byPart.set(k, cur + (v || 0));
    }
  }
  return out;
}

/**
 * 차선 하나의 건강 판정. judgeFaqHealth 와 같은 어휘를 쓴다
 * (status/healthy/cause/reason) — 알림 배선이 둘을 똑같이 다룰 수 있게.
 *
 * @param {object} o
 * @param {string} o.label            사람이 읽을 이름 ('영문FAQ' 등)
 * @param {number} o.remaining        아직 안 채운 칸 수
 * @param {number} o.produced         창 안 생산량
 * @param {number} o.windowHours      창 길이
 * @param {number} [o.runs]           창 안 실행 수
 * @param {number} [o.parsed]         그중 요약을 읽어낸 수
 * @param {number} [o.fails]          ':실패' 로 끝난 파트 수
 * @param {number} [o.partRuns]       파트 결과가 찍힌 총 횟수 (실패 비율의 분모)
 * @param {number} [o.wavesMax]       창 안 최대 회전 수 (null 이면 모름)
 * @param {string[]} [o.silentParts]  창 내내 0 이었던 파트 (다른 파트는 생산함)
 */
function judgeLaneHealth(o) {
  const label = (o && o.label) || '백필';
  const remaining = Math.max(0, Number(o && o.remaining) || 0);
  const produced = Math.max(0, Number(o && o.produced) || 0);
  const hours = Math.max(0.25, Number(o && o.windowHours) || 3);
  const runs = (o && o.runs == null) ? null : Number(o.runs);
  const parsed = (o && o.parsed == null) ? null : Number(o.parsed);
  const fails = Math.max(0, Number(o && o.fails) || 0);
  const partRuns = Math.max(0, Number(o && o.partRuns) || 0);
  const wavesMax = (o && o.wavesMax == null) ? null : Number(o.wavesMax);
  const silent = (o && o.silentParts) || [];

  const perHour = Math.round((produced / hours) * 10) / 10;
  const etaHours = perHour > 0 ? Math.ceil(remaining / perHour) : null;
  const base = {
    label, remaining, produced, perHour, etaHours, windowHours: hours,
    runsInWindow: runs, parsedRuns: parsed, fails, partRuns, wavesMax,
    silentParts: silent, cause: null,
  };

  // 할 일이 없으면 정상. 완주 후 30분마다 울리면 재앙이다.
  if (remaining === 0) {
    return { ...base, status: 'done', healthy: true, reason: label + ' 완주 — 남은 칸 없음.' };
  }
  if (runs === 0) {
    return { ...base, status: 'stalled', healthy: false, cause: 'no-runs',
      reason: '최근 ' + hours + '시간 ' + label + ' 크론 실행 기록이 없다. 크론 등록·배포를 먼저 본다.' };
  }
  /* 요약을 한 줄도 못 읽었다 = 아직 새 note 형식이 배포되기 전이다.
     여기서 울리면 배포 직후마다 헛알림이 된다. */
  if (parsed != null && parsed === 0) {
    return { ...base, status: 'unknown', healthy: true,
      reason: '최근 ' + hours + '시간 ' + runs + '회 실행했으나 ' + label + ' 요약이 없어 판정 보류.' };
  }
  if (produced === 0) {
    if (runs != null && runs < MIN_RUNS_TO_JUDGE) {
      return { ...base, status: 'ok', healthy: true, reason: '표본 부족(' + runs + '회) — 판정 보류.' };
    }
    return { ...base, status: 'stalled', healthy: false, cause: 'no-output',
      reason: '최근 ' + hours + '시간 ' + runs + '회 실행에 ' + label + ' 저장 0건. 잔량 ' + remaining + '칸.' };
  }
  /* 다른 파트는 생산하는데 어떤 파트만 창 내내 0 이다.
     2026-09-02 에 겪은 모양 그대로다 — 회전이 죽으면 뒤쪽 언어가 굶는다.
     전체 생산량만 보면 정상으로 보이기 때문에 따로 잡아야 한다. */
  if (silent.length) {
    return { ...base, status: 'stalled', healthy: false, cause: 'part-starved',
      reason: label + ' 생산은 있으나 ' + silent.join('·') + ' 이(가) ' + hours + '시간 내내 0건 — 차례가 안 돌아온다.' };
  }
  if (partRuns > 0 && fails / partRuns >= FAIL_RATIO_ALERT) {
    return { ...base, status: 'degraded', healthy: false, cause: 'many-fails',
      reason: label + ' 파트 ' + partRuns + '회 중 ' + fails + '회가 실패로 끝났다 — 동시 호출의 429 를 의심한다.' };
  }
  /* 회전이 1 에 붙어 있으면 예산을 남기고 끝낸다는 뜻이다. 장애는 아니라서
     알리지 않지만, 완주까지 오래 걸리는 이유가 대개 여기다. */
  if (etaHours != null && etaHours > 24 * 7) {
    return { ...base, status: 'slow', healthy: true,
      reason: label + ' 시간당 ' + perHour + '칸 · 잔량 ' + remaining
        + ' → 완주까지 약 ' + Math.ceil(etaHours / 24) + '일'
        + (wavesMax != null && wavesMax <= 1 ? ' (회전이 1회에 머문다 — 예산을 남기고 끝낸다)' : '') + '.' };
  }
  return { ...base, status: 'ok', healthy: true,
    reason: label + ' 시간당 ' + perHour + '칸 · 잔량 ' + remaining
      + (etaHours != null ? ' → 약 ' + Math.ceil(etaHours / 24) + '일' : '') + '.' };
}

/** 창 내내 0 이었던 파트 고르기. 다른 파트가 생산했을 때만 의미가 있다. */
function findSilentParts(byPart, expected) {
  const map = byPart instanceof Map ? byPart : new Map(Object.entries(byPart || {}));
  let anyProduced = false;
  for (const v of map.values()) if (v > 0) { anyProduced = true; break; }
  if (!anyProduced) return [];            // 전부 0 이면 그건 no-output 이 잡는다
  const out = [];
  for (const k of (expected || Array.from(map.keys()))) {
    if (!(map.get(k) > 0)) out.push(k);
  }
  return out;
}

function buildLaneAlert(d, site) {
  const S = site || 'https://www.pap-magazine.com';
  const lines = [d.reason, ''];
  if (d.cause === 'no-runs') {
    lines.push('볼 곳: vercel.json 의 crons 등록 · 최신 배포 · CRON_SECRET');
  } else if (d.cause === 'part-starved') {
    lines.push('볼 곳: 회전(rotatedLangs)이 실제로 도는지 — cron_runs.note 의 "N개 언어, X부터".');
    lines.push('  같은 언어가 계속 선두면 회전이 죽은 것이다.');
  } else if (d.cause === 'many-fails') {
    lines.push('볼 곳: Vercel 런타임 로그의 [faq-en] / [faq-i18n] — 429 면 동시 호출을 줄이거나 백오프를 붙인다.');
  } else {
    lines.push('먼저 볼 것: Anthropic 크레딧 잔액 · ANTHROPIC_API_KEY');
    lines.push('그다음: cron_runs.note 의 실패 수 · Vercel 로그');
  }
  lines.push('');
  lines.push('영문·다국어 FAQ 는 AI 검색이 인용하는 표면입니다. 멈추면 그 언어권 노출을 잃습니다.');
  return {
    title: (d.cause === 'part-starved' ? '🔁 ' : '🚨 ') + d.label + ' 백필 이상 — ' + d.status,
    lines, url: S + '/admin', urlLabel: '어드민',
  };
}

module.exports = {
  judgeFaqHealth, buildFaqAlert, parseFaqNote, summarizeFaqRuns, MIN_RUNS_TO_JUDGE,
  parseLane, parseFaqEnNote, parseFaqI18nNote, summarizeLaneRuns,
  judgeLaneHealth, findSilentParts, buildLaneAlert, FAIL_RATIO_ALERT,
};
