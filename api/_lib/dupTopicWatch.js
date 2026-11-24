/**
 * PAP Magazine — 같은 뉴스 중복 기사 경고 (2026-11-24 신설, 도메니코 "경고만")
 *
 * 왜 ───────────────────────────────────────────────────────────────
 * 인스타에 같은 뉴스를 피드·릴스로 여러 번 올리면 sync-instagram 이 게시물마다
 * 웹 기사를 따로 만든다. 실측(GSC 2026-08-23~11-22):
 *   · 송지오×에곤랩·성화 기사 3편 × 9개 언어 = 26개 주소에 클릭 63회가 흩어짐.
 *   · 로제×조니워커 10/26 같은 날 11시간 간격 2편.
 * 같은 내용이 구글에서 서로 자리를 뺏는다. 그런데 '같은 행사, 다른 셀럽'
 * (로에베×팀버튼 송강·우영·이세영)은 검색어가 달라 따로 두는 게 맞다.
 * 그래서 막지 않고 **알리기만** 한다. 합칠지는 사람이 정한다.
 *
 * 규칙 ─────────────────────────────────────────────────────────────
 * X 연속 트윗 억제(xTopicGuard)와 같은 주제 지문을 쓴다: 태그 앞 3개(범용 제외)
 * 중 2개 이상 겹치면 같은 주제. 창은 48시간(DUP_TOPIC_WINDOW_HOURS).
 * 9~11월 실측으로 하루 평균 1.8쌍이 걸린다. 진짜 중복(성화×2, 로제×2)은 잡고,
 * 다른 셀럽(송강 vs 우영 로에베)은 1개만 겹쳐 안 잡힌다.
 * 한계: 한 편은 한글 태그, 한 편은 영문 태그면 못 잡는다(혜리 베이시아 사례).
 *
 * 실패 방침: 조회가 실패하면 조용히 빈 결과. 경고 장치가 발행을 멈추면 안 된다.
 */

'use strict';

const { tagKey, overlaps } = require('./xTopicGuard');

const WINDOW_HOURS_DEFAULT = 48;

function windowHours() {
  const n = Number(process.env.DUP_TOPIC_WINDOW_HOURS);
  return Number.isFinite(n) && n >= 6 && n <= 168 ? n : WINDOW_HOURS_DEFAULT;
}

/** 순수 함수: 새 기사 태그와 후보들 중 같은 주제인 것. 자기 자신은 뺀다. */
function matchSameTopic(article, candidates) {
  const key = tagKey(article && article.tags);
  if (key.length < 2) return [];
  const out = [];
  for (const c of (candidates || [])) {
    if (!c || (article.id != null && c.id === article.id)) continue;
    if (overlaps(key, tagKey(c.tags))) out.push(c);
  }
  return out;
}

/**
 * DB 에서 창 안의 발행 기사를 읽어 같은 주제를 찾는다.
 * @param {{id:any, tags:string[]}} article
 * @param {{db?:object, hours?:number}} [opts] db 는 테스트용 주입
 * @returns {Promise<Array<{id:any, slug:string, title:string}>>}
 */
async function findRecentSameTopic(article, opts) {
  const o = opts || {};
  if (tagKey(article && article.tags).length < 2) return [];
  try {
    const db = o.db || require('./supabase').supabaseAdmin;
    const since = new Date(Date.now() - (o.hours || windowHours()) * 3600000).toISOString();
    const { data } = await db.from('articles')
      .select('id, slug, title, tags')
      .eq('status', 'published')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    return matchSameTopic(article, data || []).map((c) => ({ id: c.id, slug: c.slug, title: c.title }));
  } catch (e) {
    console.warn('[dup-topic] 조회 실패(경고 생략): ' + String((e && e.message) || e).slice(0, 160));
    return [];
  }
}

/** 한 회차의 적발 목록 → 텔레그램 한 통. 없으면 ''. */
function formatAlert(hits, site) {
  const list = (hits || []).filter((h) => h && h.matches && h.matches.length);
  if (!list.length) return '';
  const base = String(site || 'https://www.pap-magazine.com').replace(/\/$/, '');
  const url = (s) => base + '/article/' + encodeURIComponent(s);
  const lines = ['⚠️ 같은 뉴스 중복 기사 의심 ' + list.length + '건 (48시간 안, 발행은 그대로 됨)'];
  for (const h of list.slice(0, 5)) {
    lines.push('');
    lines.push('새 기사: ' + (h.title || h.slug));
    lines.push(url(h.slug));
    for (const m of h.matches.slice(0, 3)) {
      lines.push('  겹침: ' + (m.title || m.slug));
      lines.push('  ' + url(m.slug));
    }
  }
  lines.push('');
  lines.push('같은 인물·같은 행사면 한 편으로 합치는 게 검색에 유리합니다. 다른 인물이면 무시하세요.');
  return lines.join('\n');
}

module.exports = { matchSameTopic, findRecentSameTopic, formatAlert, windowHours, WINDOW_HOURS_DEFAULT };
