/**
 * PAP Magazine — X 같은 주제 연속 트윗 억제 (2026-10-03 신설)
 *
 * 실측(2026-10-02): 지효 루부탱 트윗이 70분 안에 3건(18:51 / 19:31 / 20:00).
 * 인스타는 게시물 셋이 다 각자 살지만, X 타임라인에서 같은 얼굴·같은 쇼가
 * 세 번 연달아 뜨면 팬덤은 두 번째부터 스팸으로 본다. 도메니코: "전부 적용해줘".
 *
 * 규칙: 기사 **태그 앞 3개**(사람·그룹·브랜드가 거기 온다. 실측:
 *   ["jihyo","twice","christian louboutin", …]) 를 주제 지문으로 쓴다.
 *   창(기본 12시간, X_TOPIC_WINDOW_HOURS) 안에 나간 트윗의 기사와 **2개 이상**
 *   겹치면 같은 주제 → 건너뛴다. 범용 태그(kpop·fashion show·paris fashion
 *   week …)는 비교에서 뺀다 — 안 빼면 지효 루부탱과 현진 디올이 "파리 패션위크"
 *   로 묶인다.
 *
 * 순수 함수(tagKey · overlaps)와 DB 조회(recentClash)를 나눈다. 테스트는 순수
 * 함수를 본다. x_posts.article_id 가 있어야 돌아간다 — sync-instagram 이
 * postTweet 에 articleId 를 넘기지 않고 있었다(실측: 10/2 트윗 전부 null).
 * 같은 커밋에서 넘기도록 고쳤다. 지문이 없는 옛 행은 비교 대상이 아니다.
 *
 * 실패 방침: 조회가 실패하면 **막지 않는다**(clash=false). 가드 오류로 트윗이
 * 전부 멈추는 게 중복 한 건보다 나쁘다. 대신 로그.
 */

'use strict';

const GENERIC = new Set([
  'kpop', 'k-pop', 'kpop fashion', 'fashion', 'fashion show', 'fashion week', 'paris fashion week',
  'milan fashion week', 'seoul fashion week', 'new york fashion week', 'london fashion week',
  'luxury', 'celebrity style', 'celebrity', 'style', 'beauty', 'brand ambassador', 'global ambassador',
  'runway', 'collection', 'ss27', 'fw26', 'fw27', 'ss26', 'editorial', 'photoshoot', 'pictorial',
  'red carpet', 'airport fashion', 'street style', 'ootd', 'idol', 'korea', 'seoul', 'paris', 'milan',
]);

const WINDOW_HOURS_DEFAULT = 12;
const MIN_OVERLAP = 2;
const HEAD = 3;

function norm(t) {
  return String(t || '').toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** 기사 태그 → 주제 지문(앞 HEAD 개, 범용 제외). */
function tagKey(tags) {
  const out = [];
  for (const t of (Array.isArray(tags) ? tags : [])) {
    const n = norm(t);
    if (!n || GENERIC.has(n)) continue;
    if (!out.includes(n)) out.push(n);
    if (out.length >= HEAD) break;
  }
  return out;
}

/** 두 지문이 같은 주제인가. */
function overlaps(keyA, keyB, min) {
  const m = min || MIN_OVERLAP;
  const b = new Set(keyB || []);
  let n = 0;
  for (const k of (keyA || [])) if (b.has(k)) n++;
  return n >= m;
}

function windowHours() {
  const n = Number(process.env.X_TOPIC_WINDOW_HOURS);
  return Number.isFinite(n) && n >= 1 && n <= 72 ? n : WINDOW_HOURS_DEFAULT;
}

/**
 * 창 안에 같은 주제 트윗이 있었나.
 * @param {string[]} tags 새 기사의 태그
 * @param {{db?:object, hours?:number, account?:string}} [opts] db 는 테스트용 주입
 * @returns {Promise<{clash:boolean, with?:string, key:string[]}>}
 */
async function recentClash(tags, opts) {
  const o = opts || {};
  const key = tagKey(tags);
  if (key.length < MIN_OVERLAP) return { clash: false, key };
  try {
    const db = o.db || require('./supabase').supabaseAdmin;
    const since = new Date(Date.now() - (o.hours || windowHours()) * 3600000).toISOString();
    const { data: rows } = await db.from('x_posts')
      .select('article_id, created_at')
      .eq('ok', true).is('reply_to_id', null).not('article_id', 'is', null)
      .eq('account', o.account || 'magazine')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(60);
    const ids = [...new Set((rows || []).map((r) => r.article_id).filter(Boolean))];
    if (!ids.length) return { clash: false, key };
    const { data: arts } = await db.from('articles').select('id, slug, tags').in('id', ids);
    for (const a of (arts || [])) {
      if (overlaps(key, tagKey(a.tags))) return { clash: true, with: a.slug || String(a.id), key };
    }
    return { clash: false, key };
  } catch (e) {
    console.error('[x-topic] 조회 실패(막지 않음): ' + String((e && e.message) || e).slice(0, 160));
    return { clash: false, key };
  }
}

module.exports = { tagKey, overlaps, recentClash, GENERIC, WINDOW_HOURS_DEFAULT, MIN_OVERLAP, HEAD, windowHours };
