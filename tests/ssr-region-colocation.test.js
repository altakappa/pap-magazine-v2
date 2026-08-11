/**
 * SSR 응답시간 — 함수와 DB 를 같은 지역에 둔다 (2026-08-11 실측 기반).
 *
 * ■ 왜 이 핀이 필요한가
 * 구글 검색 유입이 6월 하루 30클릭 → 8/3 하루 750클릭으로 25배가 됐는데
 * 신규 가입은 주당 54 → 67 로 거의 안 움직였다. 유입은 뚫렸고 전환이 막혔다.
 * 원인을 재보니 검색 유입이 떨어지는 페이지가 전부 SSR 경로였고, 그 응답이 느렸다.
 *
 * ■ 실측 (브라우저에서 직접, 2026-08-11)
 *     정적 페이지 (/ , /magazine)          19 ~ 20 ms
 *     DB 안 쓰는 함수 (/api/badge)        307 ms      ← 사용자→함수 왕복만
 *     기사 SSR (첫 쿼리에서 적중)       1,400 ~ 1,840 ms
 *     기사 SSR 404 (폴백 8단계 전부)    2,257 ~ 2,508 ms
 *     → 폴백 8회 추가분 약 700ms = **쿼리 1회당 약 90ms**
 *
 *   x-vercel-id 가 `icn1::iad1::…` 였다.
 *   앞은 접속한 엣지(서울), 뒤는 **함수가 실행된 지역 = iad1(미국 버지니아)**.
 *   그런데 Supabase 는 ap-northeast-2(서울)다.
 *   즉 요청 하나가 태평양을 여러 번 왕복하고 있었다.
 *
 * ■ 왜 '사용자 근처' 가 아니라 'DB 근처' 인가
 * 이 페이지는 순차 DB 조회를 10회 가까이 한다(슬러그 폴백 8단계 + 번역 + 관련기사).
 * 사용자와 함수 사이는 요청당 **1왕복**이지만, 함수와 DB 사이는 **10왕복**이다.
 * 그래서 함수를 DB 옆에 두는 쪽이 미국·유럽 사용자에게도 이득이다.
 * (미국 사용자: 사용자→함수 +200ms, 그러나 DB 왕복 10회 × -85ms = -850ms)
 *
 * ■ 되돌릴 때 확인할 것
 * Supabase 프로젝트 지역을 서울에서 옮긴다면 이 값도 함께 옮겨야 한다.
 * 둘이 어긋나는 순간 같은 사고가 재현된다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 함수 실행 지역 ===');
t('regions 가 명시돼 있다', Array.isArray(vj.regions) && vj.regions.length > 0,
  '없으면 Vercel 기본값 iad1(미국 버지니아)로 간다 — DB(서울)와 태평양을 사이에 두게 된다');
t('서울(icn1) 이다 — Supabase ap-northeast-2 와 같은 곳',
  Array.isArray(vj.regions) && vj.regions[0] === 'icn1',
  'DB 지역을 옮겼다면 이 값도 함께 옮길 것');
t('단일 지역이다 (여러 지역은 Enterprise 전용)',
  Array.isArray(vj.regions) && vj.regions.length === 1);

console.log('=== 같이 지켜야 하는 것 ===');
t('크론이 그대로 살아 있다 (regions 추가가 스케줄을 건드리지 않았다)',
  Array.isArray(vj.crons) && vj.crons.length >= 40,
  '45개 기준 — 크론이 사라지면 파이프라인 전체가 조용히 멈춘다');
t('이관 크론이 여전히 등록돼 있다',
  vj.crons.some(c => c.path === '/api/cron/migrate-external-images'));
t('함수 기본 설정이 남아 있다 (maxDuration/memory)',
  vj.functions && vj.functions['api/**/*.js'] && vj.functions['api/**/*.js'].maxDuration >= 60);

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ ssr-region-colocation tests FAILED'); process.exit(1); }
console.log('✅ ssr-region-colocation tests passed');
