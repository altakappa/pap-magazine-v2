/**
 * 추세·계절 맥락 회귀 (2026-10-19)
 *
 * [사건] 10/19 주간 브리핑이 파리 패션위크(~10/6)가 끝난 주를 "ChatGPT 유입 40% 붕괴,
 * 발행량 변화 없음, 검색 랭킹 재조정" 으로 읽었다. 실측: 유입 801(패션위크) → 340(8월 말 수준),
 * 기사 142 → 74, 기사당 유입 그대로, 챗GPT 봇 읽기는 오히려 증가. 9/21 사고의 재판.
 * 이 테스트는 (1) 주별 집계·기준선·행사 창 계산이 맞는지 (2) 브리핑이 그 표를 AI 에게
 * 넘기고 규칙을 시스템 프롬프트에 박아 두는지 (3) SoV 가 같은 질문끼리 비교하는지 지킨다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* trendContext 는 최상단에서 _lib/supabase 를 부른다. 테스트는 DB 없이 돌아야 하므로
   require.cache 에 스텁을 끼운다 (no-eager-npm-deps 가 요구하는 검증된 패턴). */
const SUPA = path.join(ROOT, 'api', '_lib', 'supabase.js');
require.cache[SUPA] = { id: SUPA, filename: SUPA, loaded: true, exports: { supabaseAdmin: { from: () => ({}) }, supabase: {} } };
const { aggregateWeekly, renderTrendMd, eventsInWindow, weekStartOf } = require('../api/_lib/trendContext');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

console.log('\n=== 주 경계·행사 창 ===');
t('weekStartOf: 일요일은 직전 월요일', weekStartOf('2026-10-18') === '2026-10-12');
t('weekStartOf: 월요일은 자기 자신', weekStartOf('2026-10-19') === '2026-10-19');
t('9/28 주는 파리 패션위크 창에 걸린다', eventsInWindow('2026-09-28', '2026-10-04').some((n) => /파리 패션위크 SS27/.test(n)));
t('10/12 주는 행사 없음', eventsInWindow('2026-10-12', '2026-10-18').length === 0);

console.log('\n=== 주별 집계 (실측 모양을 흉내 낸 가짜 행) ===');
// 기준: 2026-10-19(월) 12:00 KST
const nowMs = Date.parse('2026-10-19T03:00:00Z');
const clicks = [];
function addClicks(dayStr, n) { for (let i = 0; i < n; i++) clicks.push({ clicked_at: dayStr + 'T05:00:00Z', ip_hash: dayStr + '#' + i }); }
addClicks('2026-09-02', 40); addClicks('2026-09-09', 50); addClicks('2026-09-16', 50);
addClicks('2026-09-23', 60); addClicks('2026-09-30', 80);  // 파리 패션위크 주
addClicks('2026-10-07', 60); addClicks('2026-10-14', 34); addClicks('2026-10-19', 3);
// 같은 사람이 두 번 눌러도 한 명
clicks.push({ clicked_at: '2026-10-14T06:00:00Z', ip_hash: '2026-10-14#0' });
const articles = [];
function addArticles(dayStr, n) { for (let i = 0; i < n; i++) articles.push({ published_date: dayStr }); }
addArticles('2026-09-30', 14); addArticles('2026-10-14', 7);
const fetches = [{ day: '2026-10-14', hits: 300 }, { day: '2026-10-15', hits: 110 }, { day: '2026-09-30', hits: 200 }];
const ctx = aggregateWeekly({ clicks, articles, fetches, nowMs, weeks: 10 });
const byWeek = {}; ctx.rows.forEach((r) => { byWeek[r.week] = r; });
t('10주 행, 마지막이 이번 주(진행 중)', ctx.rows.length === 10 && ctx.rows[9].week === '2026-10-19' && ctx.rows[9].partial === true);
t('고유 방문자로 센다 (중복 클릭 1명)', byWeek['2026-10-12'].chatgpt_visitors === 34);
t('패션위크 주 80명 + 행사 표시', byWeek['2026-09-28'].chatgpt_visitors === 80 && /파리/.test(byWeek['2026-09-28'].events.join()));
t('기사 수·기사당 유입', byWeek['2026-10-12'].articles === 7 && byWeek['2026-10-12'].per_article === 4.9);
t('챗GPT 봇 읽기 주 합계', byWeek['2026-10-12'].chatgpt_user_fetches === 410);
t('기준선 = 행사 없는·0 아닌 완결 주 중앙값 (8/31주 40, 10/12주 34 → 40; 패션위크 4주와 빈 주는 제외)', ctx.baseline === 40, 'got ' + ctx.baseline);
t('2027-01 남성복 창은 60일 밖 (10/19 기준) → 다가오는 행사 없음', ctx.upcoming.length === 0);
const md = renderTrendMd(ctx);
t('표에 기준선·선행지표 설명이 붙는다', /기준선/.test(md) && /선행지표/.test(md) && /2026-09-28 \| 80 \|/.test(md));
t('빈 입력은 빈 문자열', renderTrendMd(null) === '');

console.log('\n=== 브리핑 배선 ===');
const wb = R('api/cron/weekly-briefing.js');
t('brief 가 trendContext 를 불러 AI 입력에 넘긴다', /buildTrendContext\(\{ weeks: 10 \}\)/.test(wb) && /추세·계절 맥락\(주별/.test(wb));
t('표가 발행 장부 바로 뒤에 들어간다', /pubLedger && pubLedger\.rows\) \|\| \[\]\),\n[\s\S]{0,200}추세·계절 맥락/.test(wb));
t('시스템 프롬프트에 성수기·기준선·선행지표·같은 질문 규칙', /성수기 종료/.test(wb) && /기준선/.test(wb) && /선행지표가 반대/.test(wb) && /sovSameKeys/.test(wb));
t('꼼수 베팅 금지 문구', /꼼수 금지/.test(wb));
t('표가 결정론으로 붙는다 (AI 가 죽어도)', /renderTrendMd\(trend\)/.test(wb));

console.log('\n=== SoV 같은 질문끼리 ===');
const av = R('api/_lib/aiVisibility.js');
t('sovSameKeys·prevSovSameKeys·newKeys 산출', /sovSameKeys:/.test(av) && /prevSovSameKeys:/.test(av) && /newKeys,/.test(av));
t('렌더가 새 질문 추가 회차를 분모 변화로 설명', /같은 질문끼리\*\* 비교하면/.test(av) && /분모가 바뀐 것/.test(av));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ trend-context tests FAILED'); process.exit(1); }
console.log('✅ trend-context tests passed');
