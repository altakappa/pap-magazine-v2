'use strict';
/**
 * 크레딧 수정 → 인스타그램 캡션 크레딧 줄 동기화 (2026-10-15 도메니코
 * "인스타용 크레딧 어떻게 바꿔야하는지 텔레그램으로 보내줘").
 *
 * 사고: 회원이 크레딧을 고쳐도(api/editorials/[id]/credits.js) editorials.instagram_caption
 * 은 승인 때 만든 그대로였다. 텔레그램엔 "무엇이 바뀌었다"는 알림만 오고, 인스타에 붙일
 * 캡션은 옛 역할(Stylist·Agency)을 그대로 들고 있었다. 실측 'Her Name Is Regina' 1회차.
 *
 * 원칙 — 캡션은 사람이 손본 글일 수 있다. 통째로 다시 만들지 않는다.
 *   바뀐 사람의 줄만 고친다. 줄은 "역할 @핸들" 꼴이고 핸들(마지막 토큰)로 찾는다.
 *     · 역할이 바뀐 사람  → 그 줄의 역할만 교체
 *     · 새로 들어온 사람  → 크레딧 블록 마지막 줄 다음에 추가
 *     · 빠진 사람         → 그 줄 삭제
 *   핸들이 바뀌면(옛 핸들 삭제 + 새 핸들 추가) 위 두 규칙으로 처리된다.
 *   Fashion by 줄은 브랜드 목록이 바뀌었을 때만 새 목록으로 교체.
 *   찾지 못한 변경은 unresolved 로 돌려준다 — 조용히 빼먹지 않는다.
 */
const { joinRoles } = require('./igCaption');
const { normalizeRole } = require('./creditRoles');

function _h(s) {
  let h = String(s == null ? '' : s).trim();
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@+/, '');
  return h ? '@' + h : '';
}
function _roles(row) {
  const rs = Array.isArray(row && row.roles) ? row.roles : (row && row.role ? [row.role] : []);
  const out = [];
  rs.forEach((r) => {
    const s = String(r || '').trim();
    if (!s) return;
    const n = normalizeRole(s) || s;
    if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  });
  return out;
}
/** 크레딧 배열 → Map(lower handle → { handle, label }) — 핸들 없는 행은 캡션에 줄이 없으므로 건너뛴다 */
function _byHandle(credits) {
  const m = new Map();
  (Array.isArray(credits) ? credits : []).forEach((row) => {
    const handle = _h(row && row.instagram);
    if (!handle) return;
    const k = handle.toLowerCase();
    const prev = m.get(k);
    const roles = _roles(row);
    const raw = (Array.isArray(row && row.roles) ? row.roles : (row && row.role ? [row.role] : [])).map((r) => String(r || '').trim()).filter(Boolean);
    if (prev) {
      roles.forEach((r) => { if (!prev.roles.some((x) => x.toLowerCase() === r.toLowerCase())) prev.roles.push(r); });
      prev.raw = prev.raw.concat(raw);
    } else m.set(k, { handle, roles, raw });
  });
  /* 바뀜 판정은 회원이 적은 원문 역할로 한다. 정규화 뒤 값으로 비교하면 'Agency'→'Talent Agency'
     처럼 정규화표가 같은 값으로 묶는 수정이 "안 바뀜" 으로 사라진다 (실측 Her Name Is Regina). */
  m.forEach((v) => { v.rawKey = v.raw.map((x) => x.toLowerCase()).join('|'); });
  m.forEach((v) => { v.label = joinRoles(v.roles) || 'Credit'; });
  return m;
}
function _lineHandle(line) {
  const m = String(line).trim().match(/^(.+?)\s+(@[A-Za-z0-9._]{1,30})$/);
  return m ? { role: m[1], handle: m[2] } : null;
}
function _brandHandles(brands) {
  const out = []; const seen = new Set();
  (Array.isArray(brands) ? brands : []).forEach((b) => {
    const h = _h(b && b.instagram);
    if (!h || seen.has(h.toLowerCase())) return;
    seen.add(h.toLowerCase()); out.push(h);
  });
  return out;
}

/**
 * @returns {{ caption:string, changed:Array<{from:string,to:string}>, unresolved:string[] }}
 */
function syncCaptionCredits(caption, beforeCredits, afterCredits, opts) {
  const o = opts || {};
  const text = String(caption || '');
  const changed = [];
  const unresolved = [];
  if (!text.trim()) return { caption: text, changed, unresolved };
  const lines = text.split('\n');
  const before = _byHandle(beforeCredits);
  const after = _byHandle(afterCredits);

  // 크레딧 블록 = "역할 @핸들" 꼴 줄들. Starring·Fashion by·FOR MORE 는 크레딧 줄이 아니다.
  const isCreditLine = (ln) => {
    const p = _lineHandle(ln);
    if (!p) return false;
    return !/^(starring|fashion by|for more editorials|published by|collaborators)\b/i.test(p.role.trim());
  };
  const findLine = (k) => lines.findIndex((ln) => { const p = _lineHandle(ln); return p && p.handle.toLowerCase() === k && isCreditLine(ln); });

  // ① 역할 변경 · 삭제
  before.forEach((b, k) => {
    const a = after.get(k);
    const i = findLine(k);
    if (!a) {
      if (i >= 0) { changed.push({ from: lines[i], to: '' }); lines.splice(i, 1); }
      return;
    }
    if (a.rawKey === b.rawKey) return;   // 회원이 이 사람의 역할을 안 바꿨다 — 캡션 줄도 건드리지 않는다
    const next = a.label + ' ' + a.handle;
    if (i < 0) { unresolved.push(next); return; }
    if (lines[i].trim() !== next) { changed.push({ from: lines[i], to: next }); lines[i] = next; }
  });
  // ② 새로 들어온 사람 — 크레딧 블록 마지막 줄 다음
  after.forEach((a, k) => {
    if (before.has(k)) return;
    const next = a.label + ' ' + a.handle;
    if (findLine(k) >= 0) return;   // 이미 있다(사람이 먼저 넣었다)
    let last = -1;
    lines.forEach((ln, idx) => { if (isCreditLine(ln)) last = idx; });
    if (last < 0) { unresolved.push(next); return; }
    lines.splice(last + 1, 0, next);
    changed.push({ from: '', to: next });
  });
  // ③ Fashion by — 브랜드 목록이 바뀌었을 때만
  if (o.beforeBrands || o.afterBrands) {
    const bb = _brandHandles(o.beforeBrands).map((x) => x.toLowerCase()).join(' ');
    const ab = _brandHandles(o.afterBrands);
    if (bb !== ab.map((x) => x.toLowerCase()).join(' ')) {
      const i = lines.findIndex((ln) => /^fashion by\b/i.test(ln.trim()));
      const next = ab.length ? 'Fashion by ' + ab.join(' ') : '';
      if (i >= 0) {
        changed.push({ from: lines[i], to: next });
        if (next) lines[i] = next; else lines.splice(i, 1);
      } else if (next) unresolved.push(next);
    }
  }
  return { caption: lines.join('\n'), changed, unresolved };
}

/** 텔레그램 머리말 — 바뀐 줄만. 캡션 원문은 별도 메시지로 보낸다(복사할 때 머리말이 딸려오지 않게). */
function captionSyncAlert(title, sync, link) {
  const out = ['🔁 인스타 캡션 크레딧 갱신 · "' + String(title || '').slice(0, 80) + '"'];
  if (!sync.changed.length && !sync.unresolved.length) { out.push('바뀐 크레딧 줄 없음'); return out.join('\n'); }
  sync.changed.forEach((c) => {
    if (c.from && c.to) out.push('  ' + c.from.trim() + ' → ' + c.to);
    else if (c.to) out.push('  + ' + c.to);
    else out.push('  − ' + c.from.trim());
  });
  if (sync.unresolved.length) {
    out.push('');
    out.push('⚠️ 캡션에서 자리를 못 찾음 (직접 넣어야 함):');
    sync.unresolved.forEach((u) => out.push('  ' + u));
  }
  out.push('');
  out.push('다음 메시지 = 고친 캡션 전문 (그대로 복사)');
  if (link) out.push(link);
  return out.join('\n');
}

module.exports = { syncCaptionCredits, captionSyncAlert };
