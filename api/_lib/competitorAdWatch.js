'use strict';
/**
 * 경쟁사 광고주 알림 (2026-11-26, 도메니코 "3번 해줘")
 *
 * 왜: 경쟁 매체에 방금 돈을 낸 브랜드가 가장 따뜻한 영업 상대다(예산이 이미
 * 풀려 있다). 2026-09-21 에 아이디어로만 적어 두고 두 달 동안 안 만들었다.
 * 그 사이 셀패진은 한 달 42건, PAP 는 8건이었다
 * (볼트 45_Business/2026-11-26-광고수-따라잡기-단계별.md).
 *
 * 하는 일:
 *   1) competitor-watch 가 2시간마다 읽어 오는 7개 계정 게시물을
 *      competitor_watch_ig 에 쌓는다 (permalink 유니크, 중복은 건너뜀).
 *   2) 캡션에 #광고·#제작지원·#협찬·#유료광고·#AD 가 있으면 광고로 표시한다.
 *      캡션 앞 150자 안이면 'head'(확실), 그 뒤면 'tail'(확인 필요).
 *      '#광고디자인' 처럼 뒤에 글자가 붙은 주제 태그는 광고가 아니다.
 *   3) 하루 한 번(한국 9시 회차) 아직 안 알린 광고를 묶어 개인 텔레그램으로 보낸다.
 *      브랜드 이름은 Claude 가 뽑고, 못 뽑으면 캡션 앞머리를 그대로 보여 준다.
 *
 * 알림은 '누구에게 연락할지' 까지만 알려 준다. 메일·DM 발송은 사람이 한다.
 */

const { parseJsonArray } = require('./jsonRepair');

const WATCH_HANDLES = [
  'eyesmag', 'fastpapermag', 'dailyfashion_news', 'hipkr_', 'newsourcemag',
  'celeb_fashion_magazine', 'hypejackmag',
];

// 뒤에 한글·영문·숫자·밑줄이 붙으면 다른 태그다 (#광고디자인, #adidas, #ad_)
const AD_RE = /#(광고|제작지원|협찬|유료광고|sponsored|ad)(?![0-9A-Za-z가-힣_])/i;
const HEAD_CHARS = 150;
const PENDING_WINDOW_MS = 72 * 3600000;   // 3일 넘은 광고는 알리지 않는다 (예산이 식었다)
const CATCHUP_MS = 26 * 3600000;          // 9시 회차를 놓쳤으면 다음 회차가 대신 보낸다
const MAX_EXTRACT = 40;
const MAX_LINES = 20;

const CATEGORIES = [
  '패션', '뷰티', '주얼리·시계', '스포츠·아웃도어', '음악·엔터', '영화·드라마·OTT',
  '식음료', '테크·가전', '게임', '유통·플랫폼', '자동차', '공간·전시·행사', '리빙', '기타',
];

function detectAdTag(caption) {
  const s = String(caption || '');
  const m = AD_RE.exec(s);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  return { tag: raw === 'ad' ? '#AD' : '#' + raw, where: m.index < HEAD_CHARS ? 'head' : 'tail' };
}

function buildRows(handle, acc) {
  const out = [];
  ((acc && acc.media) || []).forEach((m) => {
    if (!m || !m.permalink || !m.ts) return;
    const t = new Date(m.ts).getTime();
    if (!isFinite(t)) return;
    // igDiscovery 가 캡션 전체로 판정한 값이 있으면 그것을 쓴다 (앞 200자만으로는 끝 태그를 놓친다)
    const ad = m.ad === undefined ? detectAdTag(m.caption_head) : m.ad;
    out.push({
      handle,
      permalink: m.permalink,
      caption_head: String(m.caption_head || '').slice(0, 200),
      likes: m.likes == null ? null : m.likes,
      comments: m.comments == null ? null : m.comments,
      followers: (acc && acc.followers) || null,
      posted_at: new Date(t).toISOString(),
      ad_tag: ad ? ad.tag : null,
      ad_where: ad ? ad.where : null,
    });
  });
  return out;
}

function kstHour(nowMs) { return new Date(nowMs + 9 * 3600000).getUTCHours(); }

function shouldSendDigest(nowMs, pending) {
  if (!pending || !pending.length) return false;
  if (kstHour(nowMs) === 9) return true;
  return pending.some((p) => p.created_at && nowMs - new Date(p.created_at).getTime() > CATCHUP_MS);
}

/* 브랜드 이름·업종 뽑기. 실패하면 {} 를 돌려주고, 알림은 캡션 앞머리로 대신한다. */
async function extractBrands(rows, opts) {
  const o = opts || {};
  const list = (rows || []).slice(0, MAX_EXTRACT);
  if (!o.apiKey || !list.length) return {};
  const f = o.fetchImpl || fetch;
  try {
    const prompt = [
      '아래는 한국 인스타그램 매거진들이 올린 유료 광고 게시물의 캡션 앞부분이다.',
      '각 항목에서 돈을 낸 브랜드(광고주) 이름과 업종을 뽑아라. 모델·앰배서더 이름은 브랜드가 아니다.',
      '브랜드를 알 수 없으면 brand 를 빈 문자열로 둔다. 추측하지 않는다.',
      '업종은 반드시 다음 중 하나: ' + CATEGORIES.join(', '),
      '',
      JSON.stringify(list.map((r, i) => ({ i, cap: String(r.caption_head || '').slice(0, 200) }))),
      '',
      '다음 JSON 배열로만 응답하라:',
      '[{"i":0,"brand":"브랜드 한글 표기","category":"업종"}]',
    ].join('\n');
    const r = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: o.model || 'claude-sonnet-4-5', max_tokens: 2500, messages: [{ role: 'user', content: prompt }] }),
      // 25초: api/** 한도가 120초이고 같은 크론이 90초짜리 Claude 호출을 이미 한다. 늦으면 캡션으로 대신한다.
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return {};
    const j = await r.json();
    const text = (j.content && j.content[0] && j.content[0].text) || '';
    if (text.indexOf('[') === -1) return {};
    const parsed = parseJsonArray(text, 'competitor-ad-watch');
    const map = {};
    (parsed.value || []).forEach((it) => {
      const row = it && list[it.i];
      if (!row) return;
      const brand = String(it.brand || '').trim().slice(0, 40);
      if (!brand) return;
      map[row.permalink] = { brand, category: CATEGORIES.indexOf(it.category) > -1 ? it.category : '기타' };
    });
    return map;
  } catch (e) {
    console.warn('[competitor-ad-watch] 브랜드 추출 실패 (알림은 캡션으로 대신):', e && e.message);
    return {};
  }
}

/* PAP 가 이 브랜드 광고를 실은 적이 있나. hay = PAP 유가 기사 제목·캡션을 이어 붙인 소문자 글.
   '게스' 가 '게스트' 에 걸리지 않게, 짧은 이름은 뒤 글자를 본다. */
const PARTICLES = '의가이와과는은를을에도로,.!? ·)(\n';
function papHasRun(brand, hay) {
  const b = String(brand || '').trim().toLowerCase();
  const h = String(hay || '');
  if (b.length < 2 || !h) return false;
  let from = 0;
  for (;;) {
    const i = h.indexOf(b, from);
    if (i === -1) return false;
    const prev = i === 0 ? ' ' : h[i - 1];
    const next = i + b.length >= h.length ? ' ' : h[i + b.length];
    const leftOk = !/[0-9a-z가-힣]/.test(prev);
    const rightOk = b.length > 2 || PARTICLES.indexOf(next) > -1 || !/[0-9a-z가-힣]/.test(next);
    if (leftOk && rightOk) return true;
    from = i + 1;
  }
}

function clip(s, n) {
  const t = String(s || '').replace(AD_RE, '').replace(/[|\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* rows: { handle, permalink, caption_head, ad_where, brand, ad_category, pap_history } */
function formatDigest(rows) {
  const list = rows || [];
  if (!list.length) return '';
  const groups = new Map();
  list.forEach((r) => {
    const key = r.brand ? 'b:' + r.brand.toLowerCase() : 'p:' + r.permalink;
    if (!groups.has(key)) groups.set(key, { brand: r.brand || '', category: r.ad_category || '', pap: r.pap_history, items: [] });
    groups.get(key).items.push(r);
  });
  const all = Array.from(groups.values());
  const fresh = all.filter((g) => g.brand && g.pap === false);
  const ours = all.filter((g) => g.brand && g.pap === true);
  const unknown = all.filter((g) => !g.brand || (g.pap !== true && g.pap !== false));
  const byWidth = (a, b) => new Set(b.items.map((x) => x.handle)).size - new Set(a.items.map((x) => x.handle)).size;
  fresh.sort(byWidth); ours.sort(byWidth);

  const out = [];
  out.push('경쟁사 새 광고 ' + list.length + '건');
  out.push('PAP 에 없던 브랜드 ' + fresh.length + '곳 · PAP 도 실은 브랜드 ' + ours.length + '곳'
    + (unknown.length ? ' · 브랜드 못 읽음 ' + unknown.length + '건' : ''));
  let shown = 0;
  function section(title, gs) {
    if (!gs.length || shown >= MAX_LINES) return;
    out.push('', '[' + title + ']');
    for (const g of gs) {
      if (shown >= MAX_LINES) break;
      const handles = Array.from(new Set(g.items.map((x) => x.handle)));
      const first = g.items[0];
      const head = (g.brand || clip(first.caption_head, 28)) + (g.category ? ' (' + g.category + ')' : '');
      out.push('· ' + head + ' / ' + handles.join(', ') + (g.items.length > 1 ? ' / ' + g.items.length + '건' : '')
        + (g.items.some((x) => x.ad_where === 'tail') ? ' / 끝 태그라 확인 필요' : ''));
      if (g.brand) out.push('  ' + clip(first.caption_head, 46));
      out.push('  ' + first.permalink);
      shown++;
    }
  }
  section('먼저 연락할 곳: PAP 에 없던 브랜드', fresh);
  section('PAP 도 실은 브랜드: 이번에도 받았는지 확인', ours);
  section('브랜드를 못 읽은 것', unknown);
  const rest = all.length - shown;
  if (rest > 0) out.push('', '외 ' + rest + '곳은 DB competitor_watch_ig 에 있음');
  out.push('', '연락은 사람이 직접 한다. 이 알림은 명단만 준다.');
  return out.join('\n');
}

async function loadPapPaidText(db, nowMs) {
  const since = new Date(nowMs - 365 * 86400000).toISOString();
  const parts = [];
  for (const tag of ['#광고', '#제작지원']) {
    try {
      const { data } = await db.from('articles').select('title, instagram_caption')
        .eq('status', 'published').gte('created_at', since)
        .ilike('instagram_caption', '%' + tag + '%').limit(400);
      (data || []).forEach((a) => parts.push((a.title || '') + ' ' + String(a.instagram_caption || '').slice(0, 300)));
    } catch (_) {}
  }
  return parts.join('\n').toLowerCase();
}

/**
 * @param {{db:object, accounts:Array<{handle:string, acc:object}>, nowMs:number, dry?:boolean,
 *          apiKey?:string, model?:string, send:Function, fetchImpl?:Function}} o
 */
async function runAdWatch(o) {
  const res = { stored: 0, paid_seen: 0, pending: 0, sent: false, skipped: '' };
  const rows = [];
  (o.accounts || []).forEach((a) => { if (a && a.acc && !a.acc.error) rows.push(...buildRows(a.handle, a.acc)); });
  res.stored = rows.length;
  res.paid_seen = rows.filter((r) => r.ad_tag).length;
  if (!rows.length) { res.skipped = 'no_rows'; return res; }
  if (o.dry) { res.skipped = 'dry'; return res; }

  const up = await o.db.from('competitor_watch_ig').upsert(rows, { onConflict: 'permalink', ignoreDuplicates: true });
  if (up && up.error) { res.skipped = 'store_failed'; return res; }

  const since = new Date(o.nowMs - PENDING_WINDOW_MS).toISOString();
  const q = await o.db.from('competitor_watch_ig')
    .select('id, handle, permalink, caption_head, ad_tag, ad_where, brand, ad_category, posted_at, created_at')
    .not('ad_tag', 'is', null).is('alerted_at', null).gte('posted_at', since)
    .order('posted_at', { ascending: false }).limit(60);
  const pending = (q && q.data) || [];
  res.pending = pending.length;
  if (!shouldSendDigest(o.nowMs, pending)) { res.skipped = pending.length ? 'not_digest_time' : 'nothing_pending'; return res; }

  // 브랜드는 한 번만 뽑는다. 전송이 실패해 다음 회차에 다시 와도 Claude 를 또 부르지 않게 저장해 둔다
  const need = pending.filter((p) => !p.brand);
  const map = await extractBrands(need, { apiKey: o.apiKey, model: o.model, fetchImpl: o.fetchImpl });
  for (const p of need) {
    const hit = map[p.permalink];
    if (!hit) continue;
    p.brand = hit.brand; p.ad_category = hit.category;
    try { await o.db.from('competitor_watch_ig').update({ brand: hit.brand, ad_category: hit.category }).eq('id', p.id); } catch (_) {}
  }
  const hay = await loadPapPaidText(o.db, o.nowMs);
  pending.forEach((p) => { p.pap_history = p.brand ? papHasRun(p.brand, hay) : null; });

  const text = formatDigest(pending);
  const sent = await o.send(text);
  if (sent && sent.ok) {
    res.sent = true;
    try {
      await o.db.from('competitor_watch_ig')
        .update({ alerted_at: new Date(o.nowMs).toISOString() }).in('id', pending.map((p) => p.id));
    } catch (_) {}
  } else {
    res.skipped = 'send_' + ((sent && (sent.skipped || sent.error)) || 'failed');
  }
  return res;
}

module.exports = {
  WATCH_HANDLES, CATEGORIES, AD_RE, HEAD_CHARS,
  detectAdTag, buildRows, kstHour, shouldSendDigest, extractBrands, papHasRun,
  formatDigest, loadPapPaidText, runAdWatch,
};
