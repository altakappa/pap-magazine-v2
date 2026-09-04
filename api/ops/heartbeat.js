/**
 * GET|POST /api/ops/heartbeat — 우리 서버 밖에서 도는 작업의 생존 신호 수집
 *
 * 왜 필요한가 (2026-08-07):
 *   맥미니의 영상 압축기는 우리 서버 밖에서 돈다. 조용히 멈춰도 cron_runs 에
 *   아무 흔적이 안 남는다 — 대시보드는 평화롭고, 유튜브만 조용히 마른다.
 *   오늘 하루에만 같은 모양의 침묵을 네 번 봤다(틱톡 21일·네이버 이틀·번역
 *   열흘·FAQ). 밖에서 도는 작업에는 '죽은사람 스위치'가 필요하다:
 *   살아 있으면 신호를 보내고, **신호가 끊기면 그게 곧 경보**다.
 *
 * 저장: ops_alert_state 테이블 재사용 (key = 'hb:<source>').
 *   새 테이블/마이그레이션 없음. upsert 라 행이 무한히 늘지 않는다.
 *
 * 감시: api/cron/pipeline-watch.js 의 checkHeartbeats 가 침묵을 판정한다.
 *
 * 사용 (맥미니 압축기):
 *   curl -fsS "https://www.pap-magazine.com/api/ops/heartbeat\
 *     ?source=video-compress&ok=1&note=2건%20압축"
 *
 * 보안:
 *   HEARTBEAT_SECRET 이 설정돼 있으면 token 이 일치해야 받는다.
 *   미설정이면 인증 없이 받는다 — 이 엔드포인트가 할 수 있는 일이
 *   '허용된 이름 하나의 마지막 신호 시각을 갱신'뿐이라서다. 행이 늘지도
 *   않고(upsert), 읽기도 없다. 유일한 악용은 '경보 잠재우기'인데, 그러려면
 *   이 경로를 알고 그럴 이유가 있어야 한다. 조여야 하면 env 하나면 된다.
 *   (여기서 인증을 강제하면 맥미니에 비밀값을 심어야 하고, 그게 더 나쁘다)
 */

const { safeEqual } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');

// 아는 이름만 받는다. 임의 키로 테이블이 오염되는 것을 막는다.
const ALLOWED = new Set(['video-compress']);

// IP당 분당 카운터 (인메모리 — 콜드스타트 리셋 OK, 목적은 폭주 억제뿐)
const _hits = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

function rateLimited(ip) {
  const now = Date.now();
  const rec = _hits.get(ip);
  if (!rec || now - rec.t > WINDOW_MS) {
    _hits.set(ip, { t: now, n: 1 });
    if (_hits.size > 2000) {
      for (const [k, v] of _hits) { if (now - v.t > WINDOW_MS) _hits.delete(k); }
    }
    return false;
  }
  rec.n++;
  return rec.n > MAX_PER_WINDOW;
}

/** 입력 정규화 — 순수 함수, 테스트 대상. 잘못된 입력은 null 을 돌려준다. */
function parseBeat(input) {
  const q = input || {};
  const source = String(q.source || '').trim().toLowerCase();
  if (!ALLOWED.has(source)) return null;
  // ok 는 '명시적으로 실패라고 말했을 때만' false. 빠지면 성공으로 본다
  // (셸에서 값 하나 빠뜨렸다고 경보가 울리면 아무도 안 믿게 된다)
  const raw = q.ok === undefined || q.ok === null ? '1' : String(q.ok).toLowerCase();
  const ok = !(raw === '0' || raw === 'false' || raw === 'no');
  const num = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 100000) : 0;
  };
  return {
    source,
    ok,
    note: String(q.note || '').slice(0, 300),
    host: String(q.host || '').slice(0, 80),
    done: num(q.done),
    failed: num(q.failed),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'too many' });

  const secret = process.env.HEARTBEAT_SECRET;
  const src = { ...(req.query || {}), ...(typeof req.body === 'object' && req.body ? req.body : {}) };
  if (secret && !safeEqual(String(src.token || ''), secret)) { // 2026-09-04 timing-safe
    return res.status(401).json({ error: 'bad token' });
  }

  const beat = parseBeat(src);
  if (!beat) return res.status(400).json({ error: 'unknown source' });

  try {
    const now = new Date().toISOString();
    await supabaseAdmin.from('ops_alert_state').upsert({
      key: 'hb:' + beat.source,
      last_payload: {
        beat_at: now,
        ok: beat.ok,
        note: beat.note,
        host: beat.host,
        done: beat.done,
        failed: beat.failed,
      },
      updated_at: now,
    }, { onConflict: 'key' });
    return res.status(200).json({ ok: true, source: beat.source, at: now });
  } catch (err) {
    console.error('[heartbeat] 저장 실패:', err && err.message);
    // 수집 실패가 맥미니 쪽 스크립트를 죽이면 안 된다 — 삼킨다.
    return res.status(200).json({ ok: false, error: 'store failed' });
  }
};

module.exports.parseBeat = parseBeat;
module.exports.ALLOWED = ALLOWED;
