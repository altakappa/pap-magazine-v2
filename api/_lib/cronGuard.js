/**
 * cronGuard — 크론 wrapper. 조용한 실패 방지.
 *
 * 각 크론 핸들러를 감싸서:
 *   1) 실행 결과를 cron_runs 테이블에 기록 (성공/실패 · 소요시간 · note/error)
 *   2) 실패 시 관리자 이메일 즉시 발송
 *   3) admin 대시보드에서 최근 24시간 상태를 볼 수 있게 함
 *
 * 사용법:
 *   const { withCronGuard } = require('../_lib/cronGuard');
 *   async function handler(req, res) { ... }
 *   module.exports = withCronGuard('sync-instagram', handler);
 *
 * 요약 메시지를 남기려면 res.locals.cronNote 에 문자열 저장:
 *   res.locals = res.locals || {};
 *   res.locals.cronNote = '1건 임포트: xxx';
 *
 * 옵션 (3번째 인자):
 *   { silenceTransient: true }
 *     — 네트워크·타임아웃 류 '일시성' 실패는 cron_runs 에 기록은 하되
 *       텔레그램/이메일 알림은 보내지 않는다. (2026-07-27 신설)
 *       왜: sync-instagram 의 backfill 변형은 대량 조회라 20초 타임아웃이
 *       '정상 동작의 일부'다 — 실패해도 다음 10분 크론이 이어받고, 신규 유입은
 *       끊기지 않는다. 그런데 매 실행 실패로 기록돼 6시간마다 "🚨 크론 실패"가
 *       울렸다(24h 469회 실패 실측). 이건 노이즈다.
 *       진짜 '유입 정지'(크레딧 소진·토큰 만료로 아무것도 안 들어옴)는 이미
 *       pipeline-watch(신규 0건 감지)가 잡는다. 역할을 나눈다:
 *         cronGuard = 예상외 크래시(스키마·토큰 401·코드 버그)만 알림
 *         pipeline-watch = 결과(유입) 기반 정체 감지
 *       그래서 일시성 에러는 여기서 조용히 로그만 남긴다. 로그는 대시보드·DB 에
 *       그대로 있어 진단 가능하다.
 */

// 일시성(재시도로 자연 복구되는) 실패 패턴 — 알림에서 제외 대상.
// abort/timeout = fetch 20~45초 초과, 나머지는 소켓·DNS·순간 네트워크.
const TRANSIENT_RE = /aborted|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network|fetch failed|und_err/i;

const { supabaseAdmin } = require('./supabase');
const { sendEmail } = require('./email');
const { sendTextToTelegramPersonalSafe } = require('./telegram');

// 관리자 이메일 (env 로 오버라이드 가능)
const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'contact@pap-magazine.com';

// 같은 크론이 짧은 시간에 여러 번 실패 시 이메일 스팸 방지.
// 최근 6시간 내에 같은 크론에서 이미 실패 알림을 보냈으면 스킵.
const ALERT_COOLDOWN_HOURS = 6;

async function _hasRecentAlert(cronName) {
  const cutoff = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from('cron_runs')
    .select('id')
    .eq('cron_name', cronName)
    .eq('ok', false)
    /* 시작 행(아직 안 끝난 실행)은 ok=false 지만 '실패 알림을 이미 보냈다'는
       뜻이 아니다. duration_ms 가 채워진 = 끝난 실패만 쿨다운에 센다.
       (2026-08-10 — 시작 기록 도입과 함께) */
    .not('duration_ms', 'is', null)
    .gte('ran_at', cutoff)
    .limit(1);
  return !!(data && data.length);
}

async function _sendAlert(cronName, error, durationMs) {
  try {
    // 2026-07-23 (도메니코 지시) — 크론 실패 알림은 이메일 대신 개인
    // 텔레그램으로. TELEGRAM_PERSONAL_CHAT_ID 미설정/전송 실패 시에만
    // 기존 이메일로 폴백해 알림이 유실되지 않게 한다.
    const tg = await sendTextToTelegramPersonalSafe(
      '🚨 [PAP 크론 실패] ' + cronName + '\n' +
      '시각: ' + new Date().toISOString() + ' · 소요 ' + durationMs + 'ms\n\n' +
      '에러: ' + String(error || '').slice(0, 800) + '\n\n' +
      '다음 스텝: Vercel Function Logs 상세 확인 · 이 알림은 6시간에 1회'
    );
    if (tg && tg.ok) return;

    const subject = `[PAP 크론 실패] ${cronName}`;
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:600px;padding:20px">
        <h2 style="color:#c00">🚨 크론 실행 실패</h2>
        <p><strong>크론:</strong> ${cronName}</p>
        <p><strong>시각:</strong> ${new Date().toISOString()}</p>
        <p><strong>소요:</strong> ${durationMs}ms</p>
        <h3>에러</h3>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-word">${_escapeHtml(error)}</pre>
        <h3>다음 스텝</h3>
        <ul>
          <li>Vercel Function Logs 에서 상세 스택 확인</li>
          <li>스키마 캐시 오류라면 supabase_migrations/ 최신 파일이 Supabase 에 적용됐는지 확인</li>
          <li>Graph API 401 이라면 IG_ACCESS_TOKEN 갱신 필요 (60일 만료)</li>
          <li>이 알림은 6시간에 한 번만 옴 — 근본 원인 해결 안 하면 계속 실패 중</li>
        </ul>
        <hr>
        <p style="color:#888;font-size:12px">PAP Magazine 자동 알림 · cronGuard</p>
      </div>`;
    await sendEmail(ADMIN_EMAIL, { subject, html });
  } catch (e) {
    console.error('[cronGuard] alert email 발송 실패:', e && e.message);
  }
}

function _escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ─── 시작을 먼저 적는다 (2026-08-10 신설) ────────────────────────────
 *
 * 왜 필요했나 — 실측:
 *   weekly-news 는 2026-07-06 등록 이후 **34일간 한 번도 cron_runs 에 기록이
 *   없었다.** 안 돈 게 아니었다. Vercel 런타임 로그를 보면 매주 호출됐고
 *   매번 이렇게 끝났다:
 *       GET /api/cron/weekly-news 504
 *       Vercel Runtime Timeout Error: Task timed out after 120 seconds
 *   기록은 finally 의 INSERT 한 번뿐이라, **함수가 상한에서 죽으면 그 INSERT
 *   자체가 실행되지 않는다.** 그래서 아무 흔적도 안 남았다.
 *   trend-scout 도 같다(월·목, 34일간 0건).
 *
 * 더 나쁜 건 감시까지 눈이 멀었다는 점이다. 크론 실행시간 감시는 cron_runs 의
 * duration 을 읽는데, **행이 없는 크론은 볼 수가 없다.** 죽은 크론일수록
 * 안 보이는 구조였다.
 *
 * 그래서 순서를 바꾼다: 시작할 때 한 줄 먼저 넣고(ok=false · duration_ms=null),
 * 끝나면 그 줄을 갱신한다.
 *   · 정상 종료  → 갱신되어 평소와 같은 한 줄
 *   · 도중 사망  → ok=false · duration_ms=null 인 줄이 그대로 남는다 = 증거
 * 행 수는 그대로다(INSERT 1 + UPDATE 1). 실행당 왕복 한 번이 늘지만,
 * '보이지 않는 죽음'을 없애는 값으로 싸다.
 *
 * 시작 기록에 실패해도 크론은 그대로 돈다 — 감시가 본업을 막으면 안 된다.
 * 그때는 startId 가 null 이라 종료 시 예전처럼 INSERT 로 떨어진다. */
const RUNNING_MARK = '⏳ 실행 중 — 아직 끝나지 않음';

async function _logStart(cronName) {
  try {
    const { data, error } = await supabaseAdmin.from('cron_runs').insert({
      cron_name: cronName,
      ok: false,          // 끝나야 true 로 바뀐다. 안 바뀌면 그게 사망 증거다.
      duration_ms: null,  // null = 아직 안 끝남 (쿨다운·통계가 이걸로 구분한다)
      error: RUNNING_MARK,
    }).select('id').single();
    if (error) throw error;
    return data && data.id ? data.id : null;
  } catch (e) {
    console.error('[cronGuard] 시작 기록 실패(무시하고 진행):', e && e.message);
    return null;
  }
}

async function _logFinish(rowId, ok, durationMs, note, error) {
  try {
    const { error: upErr } = await supabaseAdmin.from('cron_runs').update({
      ok,
      duration_ms: durationMs,
      note: note ? String(note).slice(0, 500) : null,
      error: error ? String(error).slice(0, 800) : null,
    }).eq('id', rowId);
    if (upErr) throw upErr;
    return true;
  } catch (e) {
    console.error('[cronGuard] 종료 갱신 실패:', e && e.message);
    return false;
  }
}

async function _logRun(cronName, ok, durationMs, note, error) {
  try {
    await supabaseAdmin.from('cron_runs').insert({
      cron_name: cronName,
      ok,
      duration_ms: durationMs,
      note: note ? String(note).slice(0, 500) : null,
      error: error ? String(error).slice(0, 800) : null,
    });
  } catch (e) {
    console.error('[cronGuard] cron_runs INSERT 실패:', e && e.message);
  }
}

/* 2026-08-18 — 핸들러가 스스로 5xx 를 반환할 때, 원인은 응답 본문에 있다.
 *
 * 그동안 가드는 'HTTP 500 (핸들러가 예외를 자체 처리하고 5xx 반환)' 한 문장만
 * 남겼다. 상태코드는 알려주는데 **무엇이 죽였는지는 안 알려준다.** 실측:
 * drive-youtube-post 가 2026-08-15~08-18 에 38회 연속 이 문장만 남기고 죽어
 * 있었다. 로그 어디에도 사유가 없어 사흘을 눈먼 채로 보냈다.
 *
 * 그런데 사유는 이미 손에 있었다. 핸들러는 res.status(500).json({ error,
 * detail }) 로 원인을 적어 보내고, 가드는 그 본문을 heldBody 로 붙잡고 있다.
 * 붙잡아 놓고 버렸다. 여기서 꺼내 쓴다 — 새로 수집하는 게 아니라, 이미 있는
 * 것을 안 버리는 것이다.
 *
 * 4xx 도 같다. 종전엔 '인증 거부일 가능성' 이라는 **추측**뿐이었다. 본문에
 * 진짜 사유가 있으면 그 뒤에 붙여, 추측과 사실을 둘 다 보이게 한다. */
function _bodyCause(body) {
  if (typeof body === 'string') return body.trim() ? body.trim().slice(0, 300) : null;
  if (!body || typeof body !== 'object') return null;

  const parts = [];
  const push = (v) => {
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
    else if (v && typeof v === 'object') { try { parts.push(JSON.stringify(v).slice(0, 300)); } catch (_) {} }
  };
  // 이 저장소 크론들이 실제로 쓰는 키 (error + detail 짝이 가장 흔하다)
  for (const k of ['error', 'message', 'detail', 'reason']) push(body[k]);

  // 아는 키가 하나도 없으면 본문을 통째로 — 그래도 없는 것보다 낫다
  if (!parts.length) {
    try { const s = JSON.stringify(body); if (s && s !== '{}' && s !== 'null') parts.push(s.slice(0, 300)); } catch (_) {}
  }
  if (!parts.length) return null;

  // error 와 message 에 같은 문장이 들어오는 경우가 흔하다 — 중복 제거
  const out = [];
  for (const p of parts) if (!out.includes(p)) out.push(p);
  return out.join(' \u00b7 ').slice(0, 300);
}

/* 2026-09-01 — 성공 경로의 백지를 없앤다. ('돌았다 ≠ 했다' 의 나머지 절반)
 *
 * 2026-08-18 에 고친 건 **실패** 경로였다. 성공 경로는 그대로 백지로 남았다.
 * 실측(7일): 크론 실행 17,839회 중 4,741회(26.6%)가 ok=true 인데 note 빈칸.
 * 크론 50개 중 15개는 100% 백지 — 한 번도 뭘 했는지 안 남겼다. 백지의 99%가
 * 상위 8개(sync-pepperit 1,006 · release-due-scheduled 1,008 · threads-post
 * 1,008 · celeb-watch 503 · celeb-account-watch 503 · pipeline-watch 336 ·
 * ig-snapshot 168 · send-due-campaigns 168)에 몰려 있다.
 *
 * 실제로 뭔가 숨어 있었다 — sync-pepperit 은 1,007회 중 1회 죽었는데 사유가
 * 'business_discovery 실패 (500): Please reduce the amount of data...' 였다.
 * 나머지 1,006회가 백지라 아무도 그 1회를 못 봤다.
 *
 * 고치는 방법은 5xx 때와 같다: **새로 수집하지 않고, 이미 손에 쥔 것을 안
 * 버린다.** 크론들은 이미 res.json({ imported: 0, message: '게시물 없음' })
 * 처럼 결과를 적어 보내고 있다. 가드는 그걸 heldBody 로 붙잡고도 버렸다.
 *
 * 크론 8개를 각각 고치는 대신 공용 부품 한 곳만 고친다 (교훈 2번: 규칙이 두
 * 벌이면 한쪽만 고쳐진다). 핸들러가 res.locals.cronNote 를 직접 쓰면 그쪽이
 * 언제나 우선이다 — 이건 어디까지나 **빈칸일 때의 대타**다.
 *
 * 앞에 '자동요약 · ' 을 붙인다. 나중에 cron_runs 에서 이 표식을 세면 대타가
 * 실제로 일했는지, 아니면 핸들러가 제 note 를 갖게 됐는지 구분할 수 있다. */
const SUMMARY_MARK = '자동요약 \u00b7 ';
// 값이 뻔해서 적어봐야 정보가 0 인 키 (ok:true 는 어차피 성공 기록에 이미 있다)
const _NOISE_KEYS = new Set(['ok', 'success', 'status', 'statusCode', 'cached']);
/* 비밀이 로그로 새지 않게 — 본문에 토큰·키가 섞여 나오는 크론이 언젠가 생긴다.
   cron_runs 는 관리자만 보지만, 로그는 한번 새면 되돌릴 수 없다. 미리 막는다. */
const _SECRET_RE = /(token|secret|password|passwd|credential|api[_-]?key|authorization|cookie|session|signature)/i;
// 이 키의 문자열은 길어도 사람이 읽을 문장이라 살린다
const _PROSE_KEYS = new Set(['note', 'message', 'summary', 'reason', 'detail', 'skipped']);

function _bodySummary(body) {
  if (body == null) return null;

  // 본문이 통째로 배열인 크론 (sync-pepperit 의 results 등)
  if (Array.isArray(body)) return body.length + '건';

  if (typeof body === 'string') {
    const s = body.trim();
    return s ? s.slice(0, 200) : null;
  }
  if (typeof body !== 'object') return null;

  /* 핸들러가 본문에 note 를 적어 보내는 경우가 이미 있다 (threads-post).
     그건 사람이 쓴 문장이니 가공하지 말고 그대로 쓴다. */
  if (typeof body.note === 'string' && body.note.trim()) {
    return body.note.trim().slice(0, 300);
  }

  const parts = [];
  for (const [k, v] of Object.entries(body)) {
    if (parts.length >= 8) break;
    if (_NOISE_KEYS.has(k)) continue;
    if (_SECRET_RE.test(k)) continue;
    if (v == null) continue;

    if (typeof v === 'number') {
      parts.push(k + ' ' + v);
    } else if (typeof v === 'string') {
      const s = v.trim();
      if (!s) continue;
      // 긴 문자열은 산문 키에서만 — 그 외는 id·url 류라 길면 소음이다
      if (_PROSE_KEYS.has(k)) parts.push(s.slice(0, 120));
      else if (s.length <= 60) parts.push(k + ' ' + s);
    } else if (Array.isArray(v)) {
      parts.push(k + ' ' + v.length + '건');
    } else if (typeof v === 'boolean') {
      // true 만 적는다 — false 는 '안 했다' 라서 굳이 자리를 안 준다
      if (v) parts.push(k);
    }
    /* 중첩 객체는 통째로 적으면 JSON 덩어리가 되어 오히려 안 읽힌다 — 건너뛴다.
       (본문이 온통 중첩 객체면 parts 가 비고, 그때는 null 을 돌려 빈칸을 유지한다 —
        없는 정보를 지어내는 것보다 비우는 편이 정직하다.) */
  }
  if (!parts.length) return null;

  const out = [];
  for (const p of parts) if (!out.includes(p)) out.push(p);
  return out.join(' \u00b7 ').slice(0, 300);
}

/**
 * 크론 핸들러를 감싸서 로깅·알림을 추가.
 * @param {string} cronName - 로그·이메일에 표시할 크론 이름
 * @param {function} handler - 원래 크론 핸들러 (req, res) => any
 * @returns {function} wrapped handler
 */
function withCronGuard(cronName, handler, opts) {
  const silenceTransient = !!(opts && opts.silenceTransient);
  return async function guarded(req, res) {
    const start = Date.now();
    let error = null;
    let ok = true;
    // 시작을 먼저 남긴다 — 함수가 상한에서 죽어도 흔적이 남게 (위 _logStart 주석)
    const startId = await _logStart(cronName);

    /* 응답을 먼저 보내면 기록이 유실될 수 있다 (2026-07-31 실측).
     *
     * backfill-translations 가 HTTP 200 을 돌려주는데 cron_runs 에는 아무
     * 기록이 없었다(02:42·02:47 두 번 모두). 같은 시각 짧은 크론들은 정상
     * 기록됐다 — 차이는 실행 길이다. 응답이 나간 뒤 서버리스 인스턴스가
     * 얼면 뒤따르는 INSERT 가 끝나지 못한다.
     *
     * 그래서 json 본문을 붙잡아 뒀다가 **기록을 남긴 뒤 마지막에 보낸다.**
     * 기록이 남지 않으면 '조용한 실패' 를 감지할 방법 자체가 사라지므로,
     * 응답이 몇십 ms 늦는 것보다 기록이 확실한 쪽이 낫다.
     * (res.send/res.end 를 쓰는 크론은 붙잡지 않으니 동작이 그대로다.) */
    let heldBody = null;
    let held = false;
    const realJson = typeof res.json === 'function' ? res.json.bind(res) : null;
    if (realJson) {
      res.json = function (body) { heldBody = body; held = true; return res; };
    }
    const flush = () => {
      if (!held || !realJson) return;
      held = false;
      try { realJson(heldBody); } catch (e) {
        console.error('[cronGuard] 응답 전송 실패:', e && e.message);
      }
    };

    try {
      await handler(req, res);
    } catch (e) {
      ok = false;
      error = String(e && e.message || e);
      console.error(`[cronGuard:${cronName}] uncaught:`, e);
      if (!res.headersSent) {
        try { res.status(500).json({ error: 'cron failed', detail: error.slice(0, 300) }); } catch (_) {}
      }
    } finally {
      const duration = Date.now() - start;
      const note = (res.locals && res.locals.cronNote) ? res.locals.cronNote : null;

      // 2026-07-21 — 자체 try/catch 로 에러를 삼키고 res.status(500) 만 반환하는
      // 핸들러(브리핑 3종이 이 방식)를 '성공'으로 기록하던 구멍을 막는다.
      // 예외가 밖으로 안 나와도 5xx 응답이면 실패다.
      if (ok && res && typeof res.statusCode === 'number' && res.statusCode >= 500) {
        ok = false;
        // 본문에 적힌 진짜 사유까지 같이 남긴다 (위 _bodyCause 주석)
        const cause = _bodyCause(heldBody);
        error = 'HTTP ' + res.statusCode + ' (핸들러가 예외를 자체 처리하고 5xx 반환)'
              + (cause ? ' — ' + cause : '');
      }

      /* 2026-08-07 — 4xx 로 끝난 실행에 반드시 note 를 남긴다.
       *
       * 왜 —  예약 실행이 인증에 막히면 핸들러는 401 을 주고 조용히 끝난다.
       * 그러면 cron_runs 에는 ok=true / note 빈칸으로 남아, 겉보기엔 매번
       * 성공한 것처럼 보인다. '돌았다 ≠ 했다' 가 그대로 재현되는 구멍이다.
       * (celeb-classify 가 신설 첫날 정확히 이걸로 당했다 — 버셀이
       *  x-vercel-cron 헤더를 안 보내는 걸 몰라 전부 401 로 끝났다.)
       *
       * 4xx 를 '실패' 로 올리지는 않는다. /api/cron/* 는 외부 스캐너도
       * 두드리는 공개 경로라, 그것까지 텔레그램 알림이 되면 노이즈가 된다.
       * 알림은 그대로 두고 **로그에는 보이게** 한다 — 진단은 로그로 한다. */
      let noteOut = note;
      if (ok && !noteOut && res && typeof res.statusCode === 'number'
          && res.statusCode >= 400 && res.statusCode < 500) {
        /* 본문에 진짜 사유가 있으면 뒤에 붙인다. 앞 문장('인증 거부일 가능성')은
           추측이지만 그대로 둔다 — 2026-08-07 계약이고, 본문이 빈 4xx 가 더 흔하다. */
        const cause4 = _bodyCause(heldBody);
        noteOut = 'HTTP ' + res.statusCode + ' — 아무 일도 안 하고 끝남 (인증 거부일 가능성)'
                + (cause4 ? ' — ' + cause4 : '');
      }

      /* 2026-09-01 — 2xx 인데 note 가 비면 응답 본문에서 요약을 만들어 채운다.
         (위 _bodySummary 주석: 성공 경로의 백지 26.6% 를 없애는 대타) */
      if (ok && !noteOut && heldBody != null
          && (!res || typeof res.statusCode !== 'number' || res.statusCode < 400)) {
        const summary = _bodySummary(heldBody);
        if (summary) noteOut = SUMMARY_MARK + summary;
      }

      /* 로그는 항상 남긴다 (일시성 실패도 진단용).
         시작 행이 있으면 그 줄을 갱신하고, 없으면(시작 기록 실패) 예전처럼 새로 넣는다. */
      let logged = false;
      if (startId) logged = await _logFinish(startId, ok, duration, noteOut, error);
      if (!logged) await _logRun(cronName, ok, duration, noteOut, error);

      /* 기록이 끝난 뒤에 응답을 내보낸다 — 이 순서가 핵심이다.
         반대로 하면 긴 실행에서 인스턴스가 얼어 기록이 통째로 사라진다. */
      flush();

      // 실패 알림 (쿨다운 있음). 단, silenceTransient 크론의 일시성 실패는
      // 로그만 남기고 알림하지 않는다 — 재시도로 자연 복구되는 노이즈.
      if (!ok) {
        const transient = silenceTransient && TRANSIENT_RE.test(error || '');
        if (!transient) {
          try {
            const skip = await _hasRecentAlert(cronName);
            if (!skip) await _sendAlert(cronName, error, duration);
          } catch (e) {
            console.error('[cronGuard] alert check 실패:', e && e.message);
          }
        }
      }
    }
  };
}

module.exports = { withCronGuard, RUNNING_MARK };
