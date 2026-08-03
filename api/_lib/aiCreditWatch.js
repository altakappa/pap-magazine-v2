/**
 * Anthropic API 장애를 원인 단계에서 잡아 텔레그램으로 알린다 (2026-07-30 신설).
 *
 * 왜 필요했나:
 *   2026-07-30 05:00, 크레딧이 바닥나 서술문 생성이 4시간 동안 0건이었다. 그런데
 *   크론은 개별 실패를 삼키고 ok=true 로 기록해 아무 알림이 없었다. 결과 지표
 *   (성공률) 감시는 같은 날 붙였지만 그건 "이미 수십 건 실패한 뒤" 울린다.
 *   크레딧·키 문제는 원인이 명확하고 조치도 명확하니(충전·재발급) 즉시 알리는 게 맞다.
 *
 * 무엇을 구분하나 — 조치가 다르기 때문이다:
 *   credit  잔액 소진   → 콘솔에서 충전 (자동충전 켜두면 재발 안 함)
 *   auth    키 무효/만료 → 키 재발급 후 Vercel env 교체
 *   rate    레이트리밋   → 보통 자동 회복. 반복되면 동시성을 낮춰야 한다
 *   기타는 알리지 않는다 — 일시적 5xx 까지 알리면 알림이 소음이 된다.
 *
 * 설계 원칙:
 *   - 절대 throw 하지 않는다. 감시가 호출부를 죽이면 본말전도다.
 *   - 쿨다운(기본 3시간)으로 같은 장애의 반복 알림을 막는다. 크레딧이 빈 동안
 *     10분마다 크론이 돌므로 이게 없으면 수십 통이 온다.
 *   - 비밀값(API 키)은 절대 알림에 싣지 않는다. 응답 본문도 200자로 자른다.
 */

/* supabase·pushAlert 를 함수 안에서 늦게 불러온다 (2026-07-30 CI 실패 후 수정).
 *
 * _lib/supabase 는 모듈 로드 시점에 createClient 를 호출하므로 env 가 없으면
 * "supabaseUrl is required." 로 즉시 던진다. 이 파일을 editorialAi 가 require 하고
 * editorialAi 를 테스트가 require 하는 순간, env 없는 환경(CI)에서 테스트 스위트가
 * 통째로 죽었다. 감시 도구가 감시 대상의 import 가능성을 깨뜨리는 건 본말전도다.
 * → 실제 알림을 보낼 때만 로드한다. 판별 함수(classifyAiFailure)는 순수하게 남는다. */
function _deps() {
  return {
    supabaseAdmin: require('./supabase').supabaseAdmin,
    pushAlert: require('./pushAlert').pushAlert,
  };
}

const ALERT_KEY = 'anthropic-api-health';
const COOLDOWN_H = Number(process.env.AI_ALERT_COOLDOWN_H || 3);
const SITE = 'https://www.pap-magazine.com';

/** 응답에서 장애 유형을 판별한다. 알릴 필요 없으면 null. */
function classifyAiFailure(status, bodyText) {
  const body = String(bodyText || '');
  const s = Number(status);
  // 크레딧 소진은 400 + 특정 문구로 온다 (Anthropic 실측 문구)
  if (/credit balance is too low/i.test(body)) return 'credit';
  if (/billing|payment.?required/i.test(body) && s !== 429) return 'credit';
  if (s === 401 || s === 403 || /invalid[_ ]?api[_ ]?key|authentication/i.test(body)) return 'auth';
  if (s === 429 || /rate[_ ]?limit/i.test(body)) return 'rate';
  return null;
}

const MESSAGES = {
  credit: {
    title: '🛑 Anthropic 크레딧 소진 — AI 자동화 전면 정지',
    lines: [
      '서술문 생성·번역·소셜 문안·네이버 초안이 모두 멈춥니다.',
      '조치: Anthropic 콘솔 → Plans & Billing 에서 충전',
      '재발 방지: 같은 화면에서 자동 충전(auto-reload) 활성화',
    ],
  },
  auth: {
    title: '🔑 Anthropic API 키 오류 — 인증 실패',
    lines: [
      'AI 자동화가 전면 정지됩니다.',
      '조치: 콘솔에서 키 재발급 → Vercel env ANTHROPIC_API_KEY 교체 → 재배포',
    ],
  },
  rate: {
    title: '⏳ Anthropic 레이트리밋 — AI 호출이 밀리고 있습니다',
    lines: [
      '보통 자동 회복됩니다. 반복되면 크론 동시성을 낮춰야 합니다.',
      '확인: backfill-meta-desc 의 CONCURRENCY · 크론 간격',
    ],
  },
};

/**
 * Anthropic 호출이 실패했을 때 부르면 된다. 알릴 사안이면 알린다.
 * @param {number} status  HTTP 상태
 * @param {string} bodyText 응답 본문(있으면)
 * @param {string} where   호출 지점 (예: 'editorialAi.vision')
 * @returns {Promise<{kind:string|null, alerted:boolean}>}
 */
async function reportAiFailure(status, bodyText, where) {
  const kind = classifyAiFailure(status, bodyText);
  if (!kind) return { kind: null, alerted: false };
  try {
    const { supabaseAdmin, pushAlert } = _deps();
    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const lastKind = st && st.last_payload && st.last_payload.kind;
    // 유형이 바뀌면 쿨다운을 무시한다 — 크레딧 문제와 키 문제는 다른 조치가 필요하다.
    const cooled = Date.now() - lastAt > COOLDOWN_H * 3600000 || lastKind !== kind;
    if (!cooled) return { kind, alerted: false };

    const m = MESSAGES[kind];
    await pushAlert({
      personalOnly: true,
      title: m.title,
      lines: m.lines.concat([`발생 위치: ${where || 'unknown'} (HTTP ${status})`]),
      url: `${SITE}/admin`, urlLabel: '어드민',
    });
    await supabaseAdmin.from('ops_alert_state').upsert({
      key: ALERT_KEY,
      last_alert_at: new Date().toISOString(),
      last_payload: { kind, status: Number(status) || null, where: String(where || '').slice(0, 60) },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    return { kind, alerted: true };
  } catch (e) {
    // 감시 실패가 호출부를 죽이면 안 된다.
    console.error('[aiCreditWatch] 알림 실패', e && e.message);
    return { kind, alerted: false };
  }
}

/** fetch 응답을 그대로 넘기면 본문까지 읽어 판정한다(본문은 200자만 사용). */
async function reportAiResponse(resp, where) {
  try {
    let body = '';
    try { body = (await resp.clone().text()).slice(0, 200); } catch (_) {}
    return await reportAiFailure(resp.status, body, where);
  } catch (_) {
    return { kind: null, alerted: false };
  }
}

const PARSE_ALERT_KEY = 'anthropic-json-parse';

/**
 * Claude 가 200 을 돌려줬는데 응답을 JSON 으로 읽지 못한 경우 (2026-08-03 신설).
 *
 * classifyAiFailure 로는 안 잡힌다 — HTTP 는 200 이기 때문이다. 그런데 결과는
 * 크레딧 소진보다 고약하다: 호출부가 '성공'으로 알고 빈 값을 저장해버려
 * 사람이 눈치채기 전까지 그대로 발행된다. 실제로 2026-07-30·08-03 두 에디토리얼이
 * 이탈리아어 없이·훅 없이·한국어 칸에 영어가 들어간 채로 만들어졌다.
 *
 * 유형 구분 없이 하나의 키로 묶고 같은 쿨다운을 쓴다 — 조치가 하나이기 때문이다
 * (해당 에디토리얼에서 🤖 AI 자동 생성 다시 누르기).
 */
async function reportAiParseFailure(where, headText) {
  try {
    const { supabaseAdmin, pushAlert } = _deps();
    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at').eq('key', PARSE_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    if (Date.now() - lastAt <= COOLDOWN_H * 3600000) return { kind: 'parse', alerted: false };

    await pushAlert({
      personalOnly: true,
      title: '⚠️ AI 응답 JSON 파싱 실패 — 번역·캡션이 비어 저장됩니다',
      lines: [
        '증상: 이탈리아어(IT) 누락 · 인스타 캡션에 훅/한국어 단락 없음.',
        '조치: 해당 에디토리얼에서 🤖 AI 자동 생성을 다시 누르면 복구됩니다.',
        `발생 위치: ${where || 'unknown'}`,
        `응답 앞부분: ${String(headText || '').replace(/\s+/g, ' ').slice(0, 160)}`,
      ],
      url: `${SITE}/admin`, urlLabel: '어드민',
    });
    await supabaseAdmin.from('ops_alert_state').upsert({
      key: PARSE_ALERT_KEY,
      last_alert_at: new Date().toISOString(),
      last_payload: { kind: 'parse', where: String(where || '').slice(0, 60) },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    return { kind: 'parse', alerted: true };
  } catch (e) {
    // 감시 실패가 호출부를 죽이면 안 된다.
    console.error('[aiCreditWatch] 파싱실패 알림 실패', e && e.message);
    return { kind: 'parse', alerted: false };
  }
}

module.exports = { reportAiFailure, reportAiResponse, reportAiParseFailure, classifyAiFailure, ALERT_KEY, PARSE_ALERT_KEY };
