/**
 * PAP Magazine — 셀럽/아트 2차 판정 크론 (2026-08-07 신설)
 * Route: /api/cron/celeb-classify   (10분 주기)
 *
 * 1차(태그 마커, api/_lib/celebClassify.js)가 못 가른 기사를 AI 가 판정해
 * articles.is_celeb 에 남긴다. 다이제스트는 그 값을 읽기만 한다.
 *
 * 왜 AI 가 필요한가 ──────────────────────────────────────────────────
 * 마커는 '분야' 를 본다(kpop, korean actor, comeback …). 그런데 실측 반례:
 *
 *   '페라가모 플래그십이 영화제 포토콜로 변한 순간'
 *   tags: [ferragamo, nana, kim hee-ae, yoon seung-ah, kim moo-yul, cara bag, …]
 *
 * 나나·김희애·윤승아·김무열 — 전부 셀럽인데 분야 마커가 하나도 없다.
 * 사람 이름은 끝이 없어서 명단으로 못 막는다. 반대로 이름만 보고 판정하면
 * 작가·디자이너(존 갈리아노, 릭 오웬스, 마리나 뢰노 오노레)까지 셀럽이 된다.
 * '유명인이냐' 가 아니라 '연예인이냐' 를 물어야 하는데, 그 구분은 규칙보다
 * 판단에 가깝다.
 *
 * 비용 설계 ─────────────────────────────────────────────────────────
 * 기사 하나에 한 번만 묻는다(is_celeb 이 채워지면 다시 안 묻는다).
 * 한 번에 BATCH 건을 묶어 한 콜로 처리하고, 본문은 안 보낸다 — 제목과
 * 태그면 충분하고 토큰이 20배 싸다. 모델도 하이쿠 기본값.
 *
 * 안전 설계 ─────────────────────────────────────────────────────────
 *   · celeb_by='manual' 은 절대 안 건드린다 (도메니코가 손으로 고친 값)
 *   · 응답이 깨지면 그 배치는 통째로 버리고 다음 실행에 다시 시도한다.
 *     반만 저장해 두면 어디까지 됐는지 알 수 없다.
 *   · AI 미설정이면 조용히 넘어간다 — 마커 판정만으로도 다이제스트는 돈다.
 *   · 돌았는데 아무것도 안 했으면 note 에 그렇게 적는다 ('돌았다 ≠ 했다').
 *
 * 환경변수:
 *   ANTHROPIC_API_KEY          필수 (없으면 건너뜀)
 *   CELEB_CLASSIFY_MODEL       기본 claude-haiku-4-5-20251001
 *   CELEB_CLASSIFY_BATCH       기본 25 (한 콜에 묶는 기사 수)
 *   CELEB_CLASSIFY_MAX_BATCHES 기본 4  (한 실행 최대 콜 수)
 *   CELEB_CLASSIFY_DAYS        기본 0 = 전체. 값을 주면 그 일수 내 기사만.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { markerVerdict, tagList } = require('../_lib/celebClassify');
const { reportAiResponse } = require('../_lib/aiCreditWatch');

const MODEL = process.env.CELEB_CLASSIFY_MODEL || 'claude-haiku-4-5-20251001';
const BATCH = Math.max(1, Math.min(50, Number(process.env.CELEB_CLASSIFY_BATCH) || 25));
const MAX_BATCHES = Math.max(1, Math.min(10, Number(process.env.CELEB_CLASSIFY_MAX_BATCHES) || 4));

function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

const SYSTEM = [
  '너는 PAP 매거진(아트 기반 패션·뷰티·컬처 매거진)의 기사 분류기다.',
  '기사 목록을 받아 각 기사가 "셀럽 소식"인지 아닌지만 판정한다.',
  '',
  '셀럽 소식 = 연예인이 주인공인 기사.',
  '  · 아이돌·가수·배우·모델 등 대중 연예인의 활동, 착장, 화보, 광고, 컴백,',
  '    공항 패션, 브랜드 앰배서더 선정, 팬 이벤트, 시상식·포토콜 참석 등',
  '  · 브랜드 이야기라도 그 자리의 주인공이 연예인이면 셀럽이다',
  '    (예: "정국이 전하는 샤넬 향수" → 셀럽)',
  '',
  '셀럽 소식이 아님 = 사람이 나와도 그 사람이 연예인이 아닌 경우.',
  '  · 디자이너·아티스트·크리에이티브 디렉터·사진가·공예가가 주인공',
  '    (존 갈리아노 회고전, 릭 오웬스 컬렉션, 신진 작가 소개 → 셀럽 아님)',
  '  · 브랜드·제품·전시·팝업·컬렉션·산업 뉴스가 주인공',
  '  · 날씨·사회 일반 뉴스',
  '',
  '판단이 애매하면 false 로 둔다. 셀럽 모음에 아트 기사가 섞이는 쪽이',
  '아트 모음에 셀럽이 하나 남는 쪽보다 나쁘다.',
  '',
  '출력은 JSON 배열 하나만. 설명·코드펜스 금지.',
  '형식: [{"i":0,"celeb":true},{"i":1,"celeb":false}]',
  'i 는 입력에 붙은 번호 그대로. 빠뜨리지 말 것.',
].join('\n');

function buildUserPrompt(rows) {
  return rows.map((r, i) => {
    const tags = tagList(r.tags).slice(0, 12).join(', ');
    return [
      'i=' + i,
      '제목: ' + String(r.title || '').slice(0, 120),
      '카테고리: ' + String(r.category || ''),
      '태그: ' + (tags || '(없음)'),
    ].join('\n');
  }).join('\n---\n');
}

/* 코드펜스·서두 설명을 걷어내고 배열만 취한다. 번역 백필에서 같은 일을
   겪어 만든 방식(seoTranslateBackfill.parseJsonArray)과 같은 사고다 —
   모델은 "펜스 쓰지 마"라고 해도 가끔 붙인다. */
function parseVerdicts(text) {
  const s = String(text || '');
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try {
    const arr = JSON.parse(s.slice(a, b + 1));
    if (!Array.isArray(arr)) return null;
    return arr.filter((o) => o && Number.isInteger(o.i) && typeof o.celeb === 'boolean');
  } catch (_e) {
    return null;
  }
}

async function askClaude(rows) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(rows) }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => ({}));
  try { reportAiResponse({ ok: r.ok, status: r.status, body: j, where: 'celeb-classify' }); } catch (_e) { /* 알림 실패가 분류를 막지 않는다 */ }
  if (!r.ok) throw new Error('AI 호출 실패 ' + r.status + ': ' + JSON.stringify(j).slice(0, 200));
  const text = (j.content || []).map((c) => c.text || '').join('');
  return parseVerdicts(text);
}

module.exports = withCronGuard('celeb-classify', async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!process.env.CRON_SECRET || req.headers['x-vercel-cron'] == null) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({ ok: true, note: note(res, 'ANTHROPIC_API_KEY 미설정 — 마커 판정만으로 진행') });
  }

  const days = Number(process.env.CELEB_CLASSIFY_DAYS) || 0;
  let q = supabaseAdmin.from('articles')
    .select('id, title, category, tags, is_celeb, celeb_by')
    .eq('status', 'published')
    .is('is_celeb', null)
    .order('published_date', { ascending: false })
    .limit(BATCH * MAX_BATCHES * 3);
  if (days > 0) q = q.gte('published_date', new Date(Date.now() - days * 86400000).toISOString());

  const { data, error } = await q;
  if (error) {
    note(res, '대기열 조회 실패: ' + error.message);
    return res.status(502).json({ ok: false, error: 'queue failed', detail: error.message });
  }

  /* 마커로 이미 셀럽인 건 AI 에 안 묻는다 — 대신 그 결과를 바로 저장해서
     대기열에서 빼 준다. 안 그러면 매 실행 같은 행이 앞자리를 차지한다
     (번역 백필에서 이미 겪은 poison-pill 모양). */
  const markerHits = [];
  const askRows = [];
  for (const r of (data || [])) {
    if (markerVerdict(r).celeb === true) markerHits.push(r);
    else askRows.push(r);
  }

  let savedMarker = 0;
  if (markerHits.length) {
    const { error: e1 } = await supabaseAdmin.from('articles')
      .upsert(markerHits.map((r) => ({ id: r.id, is_celeb: true, celeb_by: 'marker' })), { onConflict: 'id' });
    if (e1) {
      note(res, '마커 판정 저장 실패: ' + e1.message);
      return res.status(500).json({ ok: false, error: 'save marker failed', detail: e1.message });
    }
    savedMarker = markerHits.length;
  }

  let savedAi = 0; let batches = 0; const failures = [];
  for (let i = 0; i < askRows.length && batches < MAX_BATCHES; i += BATCH) {
    const chunk = askRows.slice(i, i + BATCH);
    batches += 1;
    let verdicts = null;
    try {
      verdicts = await askClaude(chunk);
    } catch (e) {
      failures.push(String((e && e.message) || e).slice(0, 120));
      break;                      // 한도·장애면 다음 실행에 재개한다
    }
    if (!verdicts || !verdicts.length) {
      failures.push('응답 파싱 실패 (배치 ' + batches + ')');
      continue;                   // 이 배치만 버린다 — 반만 저장하지 않는다
    }
    const rows = verdicts
      .filter((v) => chunk[v.i])
      .map((v) => ({ id: chunk[v.i].id, is_celeb: v.celeb, celeb_by: 'ai' }));
    if (!rows.length) continue;
    const { error: e2 } = await supabaseAdmin.from('articles').upsert(rows, { onConflict: 'id' });
    if (e2) {
      note(res, 'AI 판정 저장 실패: ' + e2.message);
      return res.status(500).json({ ok: false, error: 'save ai failed', detail: e2.message });
    }
    savedAi += rows.length;
  }

  const remaining = Math.max(0, askRows.length - savedAi);
  const msg = savedMarker + savedAi === 0
    ? (askRows.length === 0 && markerHits.length === 0
      ? '판정 대기 기사 없음 — 완주'
      : '판정 0건' + (failures.length ? ' — ' + failures[0] : ''))
    : '셀럽 판정 ' + (savedMarker + savedAi) + '건 저장 (마커 ' + savedMarker + ' · AI ' + savedAi
      + ') · 남은 대기 ' + remaining + '건' + (failures.length ? ' · 실패 ' + failures.length : '');

  return res.status(200).json({
    ok: true, savedMarker, savedAi, batches, remaining, failures: failures.slice(0, 3),
    note: note(res, msg),
  });
});

module.exports.SYSTEM = SYSTEM;
module.exports.parseVerdicts = parseVerdicts;
module.exports.buildUserPrompt = buildUserPrompt;
