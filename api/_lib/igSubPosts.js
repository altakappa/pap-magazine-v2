/**
 * 부계정 피드 참조 (2026-09-13) — 드라이브 영상이 무엇인지 알아내는 장치.
 *
 * 도메니코: "pap_magazine 의 스토리에만 올라간 영상이 부계정에서 피드로 올라가기
 * 때문에 그 피드들을 참고해도 돼."
 *
 * ■ 이 모듈이 하는 일
 * 부계정 4곳의 최근 게시물을 ig_sub_posts(154)에 모아 두고, 영상 파일명으로
 * "이건 @papfashion_ 의 8/28 게시물" 이라고 **알려준다.**
 *
 * ■ 하지 않는 일 — 기사를 만들지 않는다
 * articles 를 건드리지 않는다. 유튜브·틱톡 업로드는 붙일 웹 기사가 있어야
 * 성립하므로, 부계정에만 있는 소재는 이 표가 있어도 **여전히 못 올린다.**
 * 바뀌는 것은 알림의 내용이다:
 *   종전: "0828_엠포리오 아르마니.mp4 — 기사 없음"        (무엇인지 모름)
 *   이후: "0828_엠포리오 아르마니.mp4 — @papfashion_ 8/28" (판단할 재료가 생김)
 * 기사를 낼지 영상을 뺄지는 도메니코가 정한다.
 *
 * ■ 비용 — 새 크론을 만들지 않는다
 * 크론 호출 예산이 2,599/2,600 이라 새 크론 하나가 상한을 건드린다.
 * celeb-account-watch(하루 72회·평균 94ms)에 얹되 STALE_MS(2시간) 게이트로
 * 실제 수집은 하루 12회만 한다. 4계정이므로 Graph API 하루 48회.
 * 부계정 피드는 분 단위로 바뀌지 않는다.
 *
 * ■ 곁다리 일이 본 일을 망치지 않는다
 * 실패해도 celeb-account-watch 의 응답을 5xx 로 만들지 않는다 (postFormPass 와 같은 규약).
 */

'use strict';

const { discoverAccount } = require('./igDiscovery');
const { squash } = require('./koMatch');

/* 계정 목록. seoRenderer.ORG_SAMEAS 의 공식 계정군 중 **피드를 운영하는 4곳**이다
   (도메니코 2026-09-13 지정). pap_trends·papstudios_·pap_icons 는 지금 이 흐름에
   등장하지 않아 넣지 않았다 — 필요하면 여기 한 줄이다. */
const SUB_ACCOUNTS = ['papfashion_', 'papbeauty_', 'pap_celeb', 'pap_object'];

const MEDIA_PER_ACCOUNT = 25;
const STALE_MS = 2 * 3600 * 1000;      // 이만큼 지나야 다시 훑는다

/** permalink → shortcode. business_discovery 는 shortcode 필드를 안 준다. */
function shortcodeOf(permalink) {
  const m = /\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(String(permalink || ''));
  return m ? m[1] : null;
}

/** 캡션 첫 줄. \r 과 앞뒤 공백을 정리한다 (파일명과 같은 규칙). */
function firstLine(caption) {
  return String(caption || '').split(/\r?\n/)[0].trim();
}

/**
 * 마지막 수집이 STALE_MS 보다 오래됐나. 못 재면 true (한 번 훑는 편이 낫다).
 */
async function isStale(supabaseAdmin, nowMs) {
  try {
    const { data } = await supabaseAdmin.from('ig_sub_posts')
      .select('captured_at').order('captured_at', { ascending: false }).limit(1);
    const last = data && data[0] && data[0].captured_at;
    if (!last) return true;
    return (nowMs || Date.now()) - new Date(last).getTime() >= STALE_MS;
  } catch (_e) { return true; }
}

/**
 * 부계정 4곳을 훑어 ig_sub_posts 에 upsert 한다.
 * @returns {{saved:number, accounts:number, note:string, failures:string[], skipped?:boolean}}
 */
async function collectSubPosts(supabaseAdmin, opts) {
  const o = opts || {};
  const out = { saved: 0, accounts: 0, failures: [], note: '' };

  if (!o.force && !(await isStale(supabaseAdmin, o.now))) {
    out.skipped = true;
    out.note = '부계정 수집 건너뜀 (2시간 안 지남)';
    return out;
  }

  const rows = [];
  for (const acct of (o.accounts || SUB_ACCOUNTS)) {
    let d = null;
    try {
      d = await discoverAccount(acct, MEDIA_PER_ACCOUNT);
    } catch (e) {
      out.failures.push(acct + ': ' + String((e && e.message) || e).slice(0, 80));
      continue;
    }
    if (d && d.error) { out.failures.push(acct + ': ' + String(d.error).slice(0, 80)); continue; }
    out.accounts += 1;
    for (const m of (d && d.media) || []) {
      const sc = shortcodeOf(m.permalink);
      if (!sc) continue;
      const line1 = firstLine(m.caption_head);
      if (!line1) continue;              // 첫 줄이 없으면 매칭에 못 쓴다
      rows.push({
        account: d.username || acct,
        shortcode: sc,
        permalink: m.permalink || null,
        media_type: m.type || null,
        caption_line1: line1,
        caption_head: String(m.caption_head || '').slice(0, 200),
        posted_at: m.ts || null,
        captured_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length) {
    const { error } = await supabaseAdmin.from('ig_sub_posts')
      .upsert(rows, { onConflict: 'account,shortcode' });
    if (error) {
      out.failures.push('저장 실패: ' + error.message.slice(0, 80));
    } else {
      out.saved = rows.length;
    }
  }

  out.note = out.saved
    ? '부계정 ' + out.accounts + '곳 ' + out.saved + '건 갱신'
      + (out.failures.length ? ' · 실패 ' + out.failures.length : '')
    : (out.failures.length ? '부계정 수집 실패 — ' + out.failures[0] : '부계정 새 게시물 없음');
  return out;
}

/**
 * 파일명으로 부계정 게시물을 찾는다. 확신 없으면 null.
 * koMatch 의 캡션 매칭과 같은 규칙 — 정확 일치 우선, 없으면 접두(8자 이상).
 * @param {string} core  koMatch.fileCore(filename) 결과 (squash 된 문자열)
 */
function findSubPost(core, rows) {
  const c = String(core || '');
  if (c.length < 4) return null;
  const exact = [], prefix = [];
  for (const r of rows || []) {
    const head = squash(r && r.caption_line1);
    if (!head) continue;
    if (head === c) exact.push(r);
    else if (c.length >= 8 && head.indexOf(c) === 0) prefix.push(r);
  }
  const hits = exact.length ? exact : prefix;
  return hits.length === 1 ? hits[0] : null;   // 둘 이상이면 모르는 것으로 둔다
}

/** 최근 게시물을 조회 대상으로 읽어온다 (기본 60일). */
async function loadSubPosts(supabaseAdmin, days) {
  const since = new Date(Date.now() - (days || 60) * 86400000).toISOString();
  const { data, error } = await supabaseAdmin.from('ig_sub_posts')
    .select('account, shortcode, permalink, caption_line1, posted_at')
    .gte('posted_at', since)
    .order('posted_at', { ascending: false })
    .limit(500);
  if (error) return [];
  return data || [];
}

module.exports = {
  collectSubPosts, findSubPost, loadSubPosts,
  shortcodeOf, firstLine, isStale,
  SUB_ACCOUNTS, MEDIA_PER_ACCOUNT, STALE_MS,
};
