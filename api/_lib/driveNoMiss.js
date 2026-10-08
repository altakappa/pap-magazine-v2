'use strict';
/**
 * 드라이브 영상이 유튜브·틱톡에 **빠짐없이** 올라가게 하는 규칙 한 벌 (2026-10-08)
 *
 * 도메니코: "틱톡과 유튜브에 빠짐없이 올라가게해줘"
 * 그 전 지시: "다 임의로 맞춰서라도 올려줘" (2026-10-03)
 *
 * ── 실측으로 본 누락 원인 넷 (10/02 ~ 10/08) ─────────────────
 *  ① 같은 행사 기사가 여럿 → koMatch 가 동점으로 거부 ("사람이 골라야")
 *     지효×루부탱 3편, 아크네 쟈니 3편, 샤넬 건호 2편. 사람이 파일명을 고칠 때까지
 *     10분마다 이름만 찍히고 며칠씩 멈췄다.
 *  ② 붙일 기사가 없음 / 기사 제목 오타 → "닮은 기사 없음" 으로 영구 대기
 *     (질 샌더 쇼 영상, "샤넷 앞에 선 원희").
 *  ③ 압축 전 원본(.mov)을 크론이 먼저 집어 올림 → 중복
 *     (몽클레르 Re/Icons 2번, 분크 2번).
 *  ④ 영상 파일이 드라이브에 아예 안 들어옴 → 크론은 "올릴 영상 없음" 만 남김
 *     (니요, 리모와 2편, 샤넬 2편). 이건 기계가 못 올린다. **알려야** 한다.
 *
 * ── 여기서 하는 일 ─────────────────────────────────────────
 *  ① matchOrTieBreak : 동점이면 거부 대신 고른다.
 *       1순위 이 채널에 아직 영상이 없는 기사 (이미 있는 기사는 빼면 남는 게 정답일 확률이 높다)
 *       2순위 파일명 날짜(MMDD)와 발행일이 가까운 기사
 *       3순위 먼저 발행된 기사
 *     동점 기사가 **전부** 이미 영상이 있으면 그 파일은 중복이라 올리지 않는다.
 *  ② pickFallback : 기사를 못 찾은 파일은 FALLBACK_HOURS 를 기다린 뒤
 *     파일명을 제목으로 올린다 (스토리쇼츠와 같은 방식, article_id = null).
 *     기다리는 이유: 영상이 기사보다 먼저 들어오는 날이 있다. 기사가 뜨면 기사에 붙는다.
 *     파일명이 copy_UUID·IMG_1234 처럼 사람이 지은 이름이 아니면 올리지 않는다
 *     (그 이름이 공개 제목이 된다).
 *  ③ settlingReason : 방금 들어온 파일, 압축 대기 중인 .mov 는 잠깐 기다린다.
 *  ④ judgeMissingSources : 영상 기사인데 어느 채널에도 영상이 없는 것 → 알림 재료.
 *
 * 순수 함수만 둔다 (네트워크 없음) — tests/drive-no-miss.test.js 가 직접 부른다.
 */

const { matchArticle, captionMatches, THRESHOLD, MARGIN } = require('./koMatch');

const FALLBACK_HOURS = Number(process.env.DRIVE_NOARTICLE_FALLBACK_H || 6);
const SETTLE_MIN = Number(process.env.DRIVE_SETTLE_MIN || 3);          // 동기화 중일 수 있는 시간
const RAW_MOV_WAIT_MIN = Number(process.env.DRIVE_RAW_MOV_WAIT_MIN || 30); // 압축기가 mp4 로 바꿀 시간

/** 파일명 앞 MMDD → {m, d}. 날짜로 말이 안 되면 null. */
function fileMonthDay(name) {
  const m = String(name || '').match(/^(\d{2})(\d{2})(?=[\s._-]|[가-힣]|$)/);
  if (!m) return null;
  const mm = Number(m[1]); const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return { m: mm, d: dd };
}

function dayDistance(md, publishedDate) {
  if (!md || !publishedDate) return 999;
  const p = String(publishedDate).slice(0, 10).split('-');
  if (p.length < 3) return 999;
  const a = md.m * 31 + md.d;
  const b = Number(p[1]) * 31 + Number(p[2]);
  const diff = Math.abs(a - b);
  return Math.min(diff, 372 - diff);   // 12월↔1월 넘어가는 경우
}

/** matchArticle 이 동점으로 거부한 경우, 동점 기사 목록을 다시 꺼낸다. */
function tiedArticles(filename, articles, m, opts) {
  const o = opts || {};
  const margin = o.margin != null ? o.margin : MARGIN;
  const threshold = o.threshold != null ? o.threshold : THRESHOLD;
  if (!m || m.matched) return [];
  if (m.viaCaption) return captionMatches(filename, articles).hits || [];
  const ranked = Array.isArray(m.ranked) ? m.ranked : [];
  if (!ranked.length) return [];
  const best = ranked[0].score;
  if (best < threshold) return [];
  return ranked.filter((r) => best - r.score < margin).map((r) => r.art).filter(Boolean);
}

/**
 * matchArticle + 동점 해소.
 * @param {Set<string>} takenIds 이 채널에 이미 영상이 올라간 기사 id
 */
function matchOrTieBreak(filename, articles, takenIds, opts) {
  /* 매칭 함수는 부르는 쪽이 넘길 수 있다 — 크론 테스트가 koMatch 를 가짜로 바꿔 끼운다.
     넘기지 않으면 진짜 koMatch. 규칙은 그대로 한 벌이다. */
  const match = (opts && opts.matchArticle) || matchArticle;
  const m = match(filename, articles, opts);
  if (m.matched) return m;
  if (!/사람이 골라야/.test(String(m.reason || ''))) return m;

  const tied = tiedArticles(filename, articles, m, opts);
  if (tied.length < 2) return m;
  const taken = takenIds || new Set();
  const open = tied.filter((a) => a && a.id && !taken.has(a.id));
  if (!open.length) {
    return { ...m, matched: null, allTaken: true,
      reason: '같은 사건 기사 ' + tied.length + '편이 전부 이미 영상 있음 — 중복 의심, 올리지 않음' };
  }
  const md = fileMonthDay(filename);
  open.sort((x, y) => {
    const dx = dayDistance(md, x.published_date); const dy = dayDistance(md, y.published_date);
    if (dx !== dy) return dx - dy;
    const px = String(x.published_date || ''); const py = String(y.published_date || '');
    if (px !== py) return px < py ? -1 : 1;
    return String(x.id) < String(y.id) ? -1 : 1;
  });
  return { ...m, matched: open[0], tieBreak: true,
    reason: '동점 ' + tied.length + '편 중 자동 선택 (아직 영상 없는 기사 · 파일 날짜와 가까운 순): ' + (open[0].title || '') };
}

/** 지금 집으면 안 되는 파일인가. 이유 문자열 또는 null. */
function settlingReason(file, nowMs) {
  if (!file || !file.modifiedAt) return null;            // 시각을 모르면 막지 않는다
  const ageMin = ((nowMs || Date.now()) - Date.parse(file.modifiedAt)) / 60000;
  if (!Number.isFinite(ageMin)) return null;
  if (ageMin < SETTLE_MIN) return '방금 들어온 파일 (' + Math.max(0, Math.round(ageMin)) + '분) — 동기화 대기';
  if (/\.mov$/i.test(String(file.name || '')) && ageMin < RAW_MOV_WAIT_MIN) {
    return '압축 전 원본 .mov (' + Math.round(ageMin) + '분) — 압축기가 mp4 로 바꿀 때까지 대기';
  }
  return null;
}

/** 사람이 지은 이름인가 (공개 제목으로 써도 되는가). */
function isHumanTitle(title) {
  const t = String(title || '').trim();
  if (t.length < 4) return false;
  if (/^(copy|img|mov|vid|video|dsc|pxl|trim|rpreplay|screenrecording)[\s._-]*[0-9a-f-]{4,}/i.test(t)) return false;
  if (/^[0-9a-f-]{8,}$/i.test(t)) return false;
  if (!/[가-힣a-z]/i.test(t)) return false;
  return true;
}

/** 대체 업로드(기사 없이 파일명 제목)를 해도 되는 실패 사유인가. */
function isNoArticleReason(reason) {
  const r = String(reason || '');
  if (/사람이 골라야|이미 영상 있음/.test(r)) return false;
  return /안 걸림|관련 없어 보임|닮은 게 없음|비교할 기사가 없음|쓸 만한 낱말/.test(r);
}

/**
 * 기사 없이라도 올릴 파일 하나를 고른다 (오래 기다린 것부터).
 * @param {Array<{name,reason}>} unmatched
 * @param {Array<{id,name,modifiedAt}>} files
 * @param {(name:string)=>string} titleOf 파일명 → 제목 (drive-story-shorts.titleFromFilename)
 */
function pickFallback(unmatched, files, nowMs, titleOf, opts) {
  const o = opts || {};
  const waitH = Number.isFinite(o.waitHours) ? o.waitHours : FALLBACK_HOURS;
  const now = nowMs || Date.now();
  const byName = new Map((files || []).map((f) => [f.name, f]));
  const out = [];
  for (const u of (unmatched || [])) {
    if (!isNoArticleReason(u.reason)) continue;
    const f = byName.get(u.name);
    if (!f) continue;
    const ageH = f.modifiedAt ? (now - Date.parse(f.modifiedAt)) / 3600000 : 0;
    if (!(ageH >= waitH)) continue;
    const title = titleOf ? titleOf(f.name) : f.name;
    if (!isHumanTitle(title)) continue;
    out.push({ file: f, title, ageH });
  }
  out.sort((a, b) => b.ageH - a.ageH);
  return out[0] || null;
}

/**
 * 영상 기사인데 채널에 영상이 없는 것 (원본이 드라이브에 안 들어온 것).
 * @param {Array<{id,title,published_date,created_at,instagram_caption}>} videoArticles
 * @param {Set<string>} ytIds 유튜브에 영상이 있는 기사 id
 * @param {Set<string>} ttIds 틱톡에 게시된 기사 id
 * @param {Set<string>} pendingIds 드라이브에 대기 중인 파일이 가리키는 기사 id
 */
function judgeMissingSources(videoArticles, ytIds, ttIds, pendingIds, opts) {
  const o = opts || {};
  const now = o.now ? new Date(o.now).getTime() : Date.now();
  const graceH = Number.isFinite(o.graceHours) ? o.graceHours : FALLBACK_HOURS;
  const missing = [];
  for (const a of (videoArticles || [])) {
    if (!a || !a.id) continue;
    const ageH = a.created_at ? (now - Date.parse(a.created_at)) / 3600000 : 999;
    if (ageH < graceH) continue;                         // 방금 나온 기사는 파일이 오는 중일 수 있다
    if (pendingIds && pendingIds.has(a.id)) continue;    // 파일은 왔고 차례를 기다리는 중
    const noYt = !(ytIds && ytIds.has(a.id));
    const noTt = !(ttIds && ttIds.has(a.id));
    if (!noYt && !noTt) continue;
    const cap1 = String(a.instagram_caption || '').split(/\r?\n/)[0].trim();
    missing.push({ id: a.id, title: a.title, hours: Math.round(ageH),
      channels: [noYt ? '유튜브' : null, noTt ? '틱톡' : null].filter(Boolean),
      fileName: cap1 || a.title });
  }
  missing.sort((x, y) => y.hours - x.hours);
  return { healthy: missing.length === 0, missing,
    reason: missing.length ? '영상 기사 ' + missing.length + '편의 원본이 드라이브에 없다' : '빠진 영상 기사 없음' };
}

module.exports = {
  FALLBACK_HOURS, SETTLE_MIN, RAW_MOV_WAIT_MIN,
  fileMonthDay, dayDistance, tiedArticles, matchOrTieBreak,
  settlingReason, isHumanTitle, isNoArticleReason, pickFallback, judgeMissingSources,
};
