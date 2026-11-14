/**
 * "이 착장 어디 거?" — 착장 식별 항목 (2026-11-14 신설, 마이그레이션 189)
 *
 * ■ 왜
 *   웹 커뮤니티 기능은 다 있는데 글 0·댓글 0 (11/14 실측). 가장 낮은 문턱의
 *   참여는 "한 번 탭"이다. 패션 독자가 매일 하는 질문 "저거 어디 거?" 에 기사가
 *   답하고, 독자가 맞는지 확인하고, 모자란 건 독자가 채운다.
 *   설계: PAP-Vault/45_Business/2026-11-14-착장식별-참여거리-설계.md
 *
 * ■ 세 가지 일
 *   proposeFromTags(article, brands)  발행 직후 태그 ↔ brands 대조 → 'proposed' 자동 생성
 *   vote(itemId, voterKey, vote)      맞아요(+1)/아니에요(-1), 1인 1표, 바꾸면 갱신
 *   listForArticle(articleId, viewer) 보이는 항목 + 내 표
 *
 * ■ 확정 규칙 (숫자는 env 로)
 *   yes ≥ CONFIRM_YES → confirmed · no ≥ HIDE_NO → hidden. 관리자는 즉시.
 *   AI 는 제안만 한다. 확정은 사람(독자 3표 또는 관리자)이다.
 *
 * ■ 안 하는 것
 *   제품명 자동 추출. 태그의 "cara bag" 이 제품인지 셀럽 이름인지 기계는 모른다.
 *   브랜드만 자동, 제품은 사람이.
 */
'use strict';

const { supabaseAdmin } = require('./supabase');

const CONFIRM_YES = Number(process.env.OUTFIT_CONFIRM_YES || 3);
const HIDE_NO = Number(process.env.OUTFIT_HIDE_NO || 3);
const MAX_AUTO = 4;            // 기사당 자동 제안 상한 — 칩이 줄줄이면 아무도 안 누른다
const MAX_TEXT = 80;

/* 비교용 정규화: 소문자, 영숫자·한글만. 'Louis Vuitton' == 'louisvuitton' == 'louis-vuitton' */
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKC').replace(/[^0-9a-zㄱ-힝]/g, '');
}

/* brands 표를 {norm → {brand_id, display_name}} 사전으로. 호출부가 한 번 받아 재사용한다
   (sync-instagram 은 회차당 한 번). 5,500행이라 메모리는 사소하다. */
async function loadBrandIndex(db) {
  const client = db || supabaseAdmin;
  const idx = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from('brands')
      .select('brand_id, display_name, status')
      .neq('status', 'archived')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const b of (data || [])) {
      const rec = { brand_id: b.brand_id, display_name: b.display_name || b.brand_id };
      for (const k of [norm(b.brand_id), norm(b.display_name)]) if (k && k.length >= 3 && !idx.has(k)) idx.set(k, rec);
    }
    if (!data || data.length < PAGE) break;
  }
  return idx;
}

/* 태그 → 브랜드 후보. 순서 유지, 중복 제거, 상한 MAX_AUTO. 순수 함수라 테스트가 직접 본다. */
function brandsFromTags(tags, brandIndex) {
  const out = [];
  const seen = new Set();
  for (const t of (Array.isArray(tags) ? tags : [])) {
    const rec = brandIndex.get(norm(t));
    if (!rec || seen.has(rec.brand_id)) continue;
    seen.add(rec.brand_id);
    out.push(rec);
    if (out.length >= MAX_AUTO) break;
  }
  return out;
}

/* 발행 직후 호출. 실패해도 발행을 막지 않는다 — 호출부가 try/catch 로 감싼다.
   반환: 만든 개수. 이미 있으면(유니크 충돌) 조용히 0. */
async function proposeFromTags(article, brandIndex, db) {
  const client = db || supabaseAdmin;
  if (!article || !article.id) return 0;
  const cands = brandsFromTags(article.tags, brandIndex);
  if (!cands.length) return 0;
  const rows = cands.map((b) => ({
    article_id: article.id, brand_id: b.brand_id, brand_name: b.display_name,
    product: null, status: 'proposed', source: 'tag',
  }));
  /* 유니크 인덱스가 식 인덱스(lower(...))라 PostgREST upsert onConflict 로는 못 가리킨다.
     한 건씩 넣고 중복은 삼킨다. 기사당 최대 4건이라 왕복은 사소하다. */
  let n = 0;
  for (const r of rows) {
    const one = await client.from('article_outfit_items').insert(r).select('id');
    if (!one.error) n++;
    else if (!/duplicate|unique/i.test(String(one.error.message || ''))) throw one.error;
  }
  return n;
}

function cleanText(s, max) {
  const v = String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F<>]/g, '').trim();
  return v.length > (max || MAX_TEXT) ? v.slice(0, max || MAX_TEXT) : v;
}

function cleanUrl(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  if (!/^https:\/\/[^\s]{4,300}$/i.test(v)) return null;   // https 만, 공백 없음
  return v;
}

/* 독자 제안 (로그인 필요 — 호출부가 user 를 넘긴다). 같은 브랜드+제품이 있으면 그 항목을 돌려준다. */
async function propose(articleId, user, input, brandIndex, db) {
  const client = db || supabaseAdmin;
  const brandName = cleanText(input && input.brand, 60);
  if (!brandName) return { error: '브랜드를 적어주세요' };
  const product = cleanText(input && input.product, MAX_TEXT) || null;
  const url = cleanUrl(input && input.url);
  const known = brandIndex ? brandIndex.get(norm(brandName)) : null;
  const row = {
    article_id: articleId, brand_id: known ? known.brand_id : null,
    brand_name: known ? known.display_name : brandName, product, url,
    status: 'proposed', source: 'user', created_by: user.id,
  };
  const ins = await client.from('article_outfit_items').insert(row)
    .select('id, brand_id, brand_name, product, url, status, yes_count, no_count').single();
  if (ins.error) {
    if (/duplicate|unique/i.test(String(ins.error.message || ''))) {
      const { data } = await client.from('article_outfit_items')
        .select('id, brand_id, brand_name, product, url, status, yes_count, no_count')
        .eq('article_id', articleId).ilike('brand_name', row.brand_name)
        .limit(1);
      return { item: data && data[0], existed: true };
    }
    throw ins.error;
  }
  return { item: ins.data, existed: false };
}

/* 표. 같은 사람이 다시 누르면 바꾼다(맞아요→아니에요). 같은 표면 그대로.
   집계는 votes 표에서 다시 세서 items 에 쓴다 — 증감 산술은 경합에서 틀어진다. */
async function vote(itemId, voterKey, v, db) {
  const client = db || supabaseAdmin;
  const value = v > 0 ? 1 : -1;
  const up = await client.from('article_outfit_votes')
    .upsert({ item_id: itemId, voter_key: voterKey, vote: value }, { onConflict: 'item_id,voter_key' });
  if (up.error) throw up.error;
  const { data: votes, error: vErr } = await client.from('article_outfit_votes').select('vote').eq('item_id', itemId);
  if (vErr) throw vErr;
  let yes = 0, no = 0;
  for (const r of (votes || [])) { if (r.vote > 0) yes++; else no++; }
  const { data: cur } = await client.from('article_outfit_items').select('status').eq('id', itemId).maybeSingle();
  let status = (cur && cur.status) || 'proposed';
  if (status === 'proposed') {
    if (yes >= CONFIRM_YES && yes > no) status = 'confirmed';
    else if (no >= HIDE_NO && no > yes) status = 'hidden';
  }
  const upd = await client.from('article_outfit_items')
    .update({ yes_count: yes, no_count: no, status, updated_at: new Date().toISOString() })
    .eq('id', itemId).select('id, status, yes_count, no_count').single();
  if (upd.error) throw upd.error;
  return { ...upd.data, mine: value };
}

async function listForArticle(articleId, voterKey, db) {
  const client = db || supabaseAdmin;
  const { data, error } = await client.from('article_outfit_items')
    .select('id, brand_id, brand_name, product, url, status, yes_count, no_count, source, created_at')
    .eq('article_id', articleId).in('status', ['confirmed', 'proposed'])
    .order('status', { ascending: true })          // confirmed < proposed (알파벳) — 확정이 먼저
    .order('yes_count', { ascending: false })
    .limit(20);
  if (error) throw error;
  const items = data || [];
  let mine = {};
  if (voterKey && items.length) {
    const { data: v } = await client.from('article_outfit_votes').select('item_id, vote')
      .eq('voter_key', voterKey).in('item_id', items.map((i) => i.id));
    for (const r of (v || [])) mine[r.item_id] = r.vote;
  }
  return items.map((i) => ({ ...i, mine: mine[i.id] || 0 }));
}

async function setStatus(itemId, status, db) {
  const client = db || supabaseAdmin;
  if (!['confirmed', 'hidden', 'proposed'].includes(status)) return { error: 'status' };
  const { data, error } = await client.from('article_outfit_items')
    .update({ status, updated_at: new Date().toISOString() }).eq('id', itemId).select('id, status').single();
  if (error) throw error;
  return data;
}

module.exports = {
  norm, brandsFromTags, loadBrandIndex, proposeFromTags, propose, vote, listForArticle, setStatus,
  cleanText, cleanUrl, CONFIRM_YES, HIDE_NO, MAX_AUTO,
};
