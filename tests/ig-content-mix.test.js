/**
 * IG 소재 유형별 성적표 — tests/ig-content-mix.test.js (2026-09-07 신설)
 *
 * 왜: "팔로워·인사이트가 두 달 사이 엄청나게 하락했다" → 실측은 게시물당 저장·공유율은 최고치,
 * 사라진 건 5만+ 히트(주 3~4 → 0). 히트는 소재가 만든다. 그래서 브리핑에 "어떤 소재가
 * 히트·팔로우를 내는가" 표를 매주 같은 자로 붙인다. 이 테스트는 분류 규칙·집계·배선을 고정한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('      ', d); } }

/* supabase 클라이언트 없이 순수 계산만 검증 — require 를 가로챈다 */
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === './supabase') return { supabaseAdmin: null };
  return origRequire.apply(this, arguments);
};
const mix = require(path.join(ROOT, 'api', '_lib', 'igContentMix.js'));
Module.prototype.require = origRequire;

console.log('=== 1. 분류 규칙 (9/6 진단 노트와 동일) ===');
{
  const c = mix.classify;
  t('기사 매칭 없음 → 화보', c({ article_id: null }) === '화보');
  t('category=editorial → 화보', c({ article_id: 'a', article_category: 'editorial' }) === '화보');
  t('celeb + PAP 마커 → 셀럽·직접취재', c({ article_id: 'a', digest_kind: 'celeb', pap_shot: true }) === '셀럽·직접취재');
  t('celeb 마커 없음 → 셀럽·보도자료', c({ article_id: 'a', digest_kind: 'celeb', pap_shot: false }) === '셀럽·보도자료');
  t('비셀럽 + 마커 → 기사·직접취재', c({ article_id: 'a', digest_kind: null, pap_shot: true }) === '기사·직접취재');
  t('비셀럽 마커 없음 → 기사·외부소스', c({ article_id: 'a', article_category: 'Fashion' }) === '기사·외부소스');
  t('null 입력에 안 죽는다', c(null) === '기사·외부소스');
}

console.log('\n=== 2. 집계 ===');
{
  const now = Date.parse('2026-09-07T00:00:00Z');
  const d = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  const rows = [
    // 이번 주 화보 2편 (캐러셀, follows 있음)
    { post_id: '1', permalink: 'p/1/', media_type: 'CAROUSEL_ALBUM', posted_at: d(1), age_hours: 40, reach: 10000, saved: 100, shares: 50, follows: 12, article_id: null, article_title: '화보A' },
    { post_id: '2', permalink: 'p/2/', media_type: 'CAROUSEL_ALBUM', posted_at: d(2), age_hours: 60, reach: 20000, saved: 200, shares: 100, follows: 20, article_id: 'e', article_category: 'editorial', article_title: '화보B' },
    // 이번 주 셀럽 직접취재 릴스 (follows 는 수동기록 값)
    { post_id: '3', permalink: 'reel/3/', media_type: 'VIDEO', posted_at: d(3), age_hours: 90, reach: 60000, saved: 600, shares: 3000, follows: 74, article_id: 'c', digest_kind: 'celeb', pap_shot: true, article_title: '설윤' },
    // 이번 주 셀럽 보도자료 (follows null 릴스)
    { post_id: '4', permalink: 'reel/4/', media_type: 'VIDEO', posted_at: d(4), age_hours: 100, reach: 8000, saved: 10, shares: 400, follows: null, article_id: 'c2', digest_kind: 'celeb', pap_shot: false, article_title: '보도' },
    // 너무 어린 게시물 (20시간 미만) → 제외
    { post_id: '5', permalink: 'p/5/', media_type: 'CAROUSEL_ALBUM', posted_at: d(0.2), age_hours: 4, reach: 999999, saved: 1, shares: 1, follows: 1, article_id: null },
    // 전주 기사 외부소스 히트
    { post_id: '6', permalink: 'p/6/', media_type: 'CAROUSEL_ALBUM', posted_at: d(9), age_hours: 200, reach: 120000, saved: 500, shares: 5000, follows: 300, article_id: 'x', article_category: 'Culture', article_title: '귀여운 얼굴' },
    // 15일 전 → 창 밖
    { post_id: '7', permalink: 'p/7/', media_type: 'CAROUSEL_ALBUM', posted_at: d(15), age_hours: 400, reach: 1, saved: 0, shares: 0, follows: 0, article_id: null },
  ];
  const m = mix.computeContentMix(rows, now);
  const by = {}; m.cur.forEach((r) => { by[r.type] = r; });
  t('이번 주 게시물 4 (어린 것·창 밖 제외)', m.summary.posts === 4, String(m.summary.posts));
  t('전주 게시물 1', m.summary.postsPrev === 1);
  t('화보 2편 · 도달 중앙값 15,000', by['화보'].posts === 2 && by['화보'].medReach === 15000, JSON.stringify(by['화보']));
  t('화보 팔로우/1k = 32/30000 = 1.1', by['화보'].follows_1k === 1.1, String(by['화보'].follows_1k));
  t('셀럽·직접취재 릴스 1 · 히트 1 (6만)', by['셀럽·직접취재'].reels === 1 && by['셀럽·직접취재'].hits === 1);
  t('수동 기록 릴스 팔로우가 잡힌다 (74/60000 = 1.2/1k)', by['셀럽·직접취재'].follows_1k === 1.2, String(by['셀럽·직접취재'].follows_1k));
  t('follows null 릴스는 팔로우 분모에서 빠진다', by['셀럽·보도자료'].follows_1k === null && by['셀럽·보도자료'].followsPosts === 0);
  t('공유/1k: 보도자료 400/8000 = 50', by['셀럽·보도자료'].shares_1k === 50);
  t('히트 합계 이번 주 1 · 전주 1', m.summary.hits === 1 && m.summary.hitsPrev === 1);
  t('공유 TOP 1 = 보도자료(50/1k)', m.topShares[0] && m.topShares[0].shares_1k === 50, JSON.stringify(m.topShares[0]));
  t('팔로우 TOP 1 = 설윤 74', m.topFollows[0] && m.topFollows[0].follows === 74);
  const md = mix.renderContentMixMd(m);
  t('표 헤더', /\| 유형 \| 게시물\(릴스\) \| 도달 중앙값 \| 5만\+ 히트 \| 저장\/1k \| 공유\/1k \| 팔로우\/1k \|/.test(md));
  t('합계 줄에 전주 대비', /\*\*합계\*\* \| \*\*4\*\* \(\+300%\)/.test(md), md.split('\n').find((l) => /합계/.test(l)));
  t('릴스 팔로우 한계 고지 (텔레그램 수동 기록)', /팔로우 <숏코드> <숫자>/.test(md));
  t('빈 집계는 빈 문자열', mix.renderContentMixMd(mix.computeContentMix([], now)) === '');
}

console.log('\n=== 3. 배선 ===');
{
  const wb = fs.readFileSync(path.join(ROOT, 'api/cron/weekly-briefing.js'), 'utf8');
  t('브리핑이 contentMix 를 부른다', /buildIgContentMix\(Date\.now\(\)\)/.test(wb));
  t('best-effort — try/catch', /try \{ contentMix = await buildIgContentMix/.test(wb));
  t('결정론으로 뒤에 붙인다', /renderContentMixMd\(contentMix\)/.test(wb));
  const lib = fs.readFileSync(path.join(ROOT, 'api/_lib/igContentMix.js'), 'utf8');
  t('ig_post_latest 뷰를 읽는다 (수동 릴스 팔로우 146 흡수)', /from\('ig_post_latest'\)/.test(lib));
  t('게시 20시간 미만은 제외', /MIN_AGE_H = 20/.test(lib));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ig-content-mix tests FAILED'); process.exit(1); }
console.log('✅ ig-content-mix tests passed');
