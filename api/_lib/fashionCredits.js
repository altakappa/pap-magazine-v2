/**
 * PAP Magazine — editorials.fashion 크레딧 정규화 (2026-07-29 신설)
 *
 * 왜 필요한가: fashion 컬럼에 서로 다른 두 형태가 섞여 있다.
 *   · 신형(오브젝트) — { brands: [{ name, instagram }, ...], ... }  실측 105건
 *   · 구형(배열)     — [{ n: 표기명, id: '@handle' }, ...]          실측 2,373건
 * 그런데 브랜드 링크(SSR)와 brand-sync 크론이 둘 다 신형만 읽고 있었다.
 * 결과: 구형으로 저장된 발행 기사 788건의 실제 브랜드 크레딧 4,970개가 통째로
 * 무시됐다 — 그중 1,475개는 brands 테이블에도 없어 브랜드 페이지조차 없었다.
 * (2026-07-29 GEO 감사 실측. 이 함수를 만들기 전엔 링크 0개로 보였다.)
 *
 * 플레이스홀더 주의: 초기 인스타 대량 임포트가 크레딧 자리에
 * [{"n":"Brand","id":"@brand"}] 라는 더미를 넣어 뒀다(실측 1,559건).
 * 실제 브랜드가 아니므로 반드시 걸러낸다 — 안 그러면 /brand/brand 라는
 * 가짜 페이지가 생기고 모든 기사가 같은 브랜드를 가리킨다.
 *
 * 파싱만 한다. DB 접근·정책 판단은 호출부 몫이다.
 */
'use strict';

// 더미 크레딧 — 표기명/핸들이 말 그대로 'brand' 인 것들
const PLACEHOLDER = new Set(['brand', 'brands', 'brandname', 'brand name', '@brand']);

/** 인스타 핸들 → brand_id (소문자, URL·@·후행 슬래시 제거).
 *  브랜드 라우트가 소문자 핸들로 조회하므로 그 규칙에 맞춘다.
 *  한글 표기·공백은 페이지가 없으므로 빈 문자열로 떨군다. */
function toBrandId(raw) {
  if (!raw) return '';
  const s = String(raw).trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!s || PLACEHOLDER.has(s)) return '';
  return /^[a-z0-9._-]{2,60}$/.test(s) ? s : '';
}

/** fashion 컬럼(문자열/오브젝트/배열 무엇이든) → [{ id, name }] 중복 제거.
 *  id 는 brand_id 규격을 통과한 것만 남는다. name 은 표기용(없으면 핸들 대문자). */
function parseBrandCredits(fashion) {
  let o = fashion;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (_) { return []; } }
  if (!o) return [];

  // 신형 { brands: [...] } / 구형 [...] 둘 다 배열 하나로 모은다
  const arr = Array.isArray(o) ? o : (Array.isArray(o.brands) ? o.brands : []);

  const out = [];
  const seen = new Set();
  arr.forEach((b) => {
    if (!b || typeof b !== 'object') return;
    // 신형 키(instagram/name) · 구형 키(id/n) 를 함께 본다
    const handle = b.instagram || b.id || b.handle || '';
    const label = b.name || b.n || '';
    /* 표기명(name/n) 폴백은 하지 않는다. brand_id 는 인스타 핸들 규격이라
       이름으로 지어내면 크레딧에 "VINTAGE"·"VIA"·"EDITION" 이라고만 적힌 건이
       브랜드 페이지가 된다 (2026-07-28 실측 8건, 커밋 a2ff820). */
    const id = toBrandId(handle);
    if (!id || seen.has(id)) return;
    // 표기명이 더미면 핸들로 대체 (구형 더미 [{n:'Brand',id:'@brand'}] 방어)
    const nm = String(label || '').trim().replace(/^@/, '');
    if (PLACEHOLDER.has(nm.toLowerCase())) return;
    seen.add(id);
    out.push({ id, name: (nm || id).toUpperCase().slice(0, 120) });
  });
  return out;
}

module.exports = { parseBrandCredits, toBrandId };
