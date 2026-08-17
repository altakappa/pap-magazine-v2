/**
 * 주간 브리핑 데이터 정직성 회귀 (2026-08-17, "확인필요" 3건 검증 후).
 *
 * [사건1] 브리핑의 어필리에이트 클릭이 존재하지 않는 created_at 컬럼으로
 * 집계 → 쿼리 조용히 실패 → count null → "|| 0" 이 "클릭 0건"으로 둔갑.
 * 실제 7일 클릭은 773건이었다. 없는 컬럼은 0이 아니라 에러여야 한다.
 * [사건2] AI 검색 유입이 리퍼러 도메인 그대로(chatgpt_com) 저장돼 채널이
 * 갈라짐 → 별칭 통합.
 * [사건3] growth_events(운영 이벤트 로그) 40일 공백 → 8건 백필(DB).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const wb = R('api/cron/weekly-briefing.js');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  \u2713',n);} else {fail++;console.log('  \u2717',n); if(d)console.log('     ',d);} }

console.log('\n=== \uc5b4\ud544\ub9ac\uc5d0\uc774\ud2b8 \uc9d1\uacc4 \ucef4\ub7fc ===');
t('affiliate_clicks 를 clicked_at 으로 거른다',
  /affiliate_clicks'\)\.select\('\*', \{ count: 'exact', head: true \}\)[\s\S]{0,50}\.gte\('clicked_at'/.test(wb),
  'created_at 으로 되돌리면 브리핑에 다시 가짜 0이 실린다');
t('created_at 필터 잔존 없음 (affiliate 구간)',
  !/affiliate_clicks'\)[\s\S]{0,120}created_at/.test(wb));
t('쿼리 에러를 0으로 둔갑시키지 않는다 (error 가드)',
  /clicks\.error \? null : \(clicks\.count \|\| 0\)/.test(wb) &&
  /clicks\.error \? '\uc9d1\uacc4 \uc2e4\ud328/.test(wb));

console.log('--- AI \uac80\uc0c9 \uc720\uc785 \ubcc4\uce6d ---');
delete require.cache[require.resolve('../api/_lib/socialInclick.js')];
let normalizeSrc;
try { ({ normalizeSrc } = require('../api/_lib/socialInclick.js')); } catch(e) { normalizeSrc = null; }
if (normalizeSrc) {
  t('chatgpt_com -> chatgpt', normalizeSrc('chatgpt_com') === 'chatgpt');
  t('openai -> chatgpt', normalizeSrc('openai') === 'chatgpt');
  t('chatgpt 는 그대로', normalizeSrc('chatgpt') === 'chatgpt');
} else {
  const si = R('api/_lib/socialInclick.js');
  t('chatgpt 별칭 존재(소스 검사)', /\['chatgpt_com', 'chatgpt'\]/.test(si) && /\['openai', 'chatgpt'\]/.test(si));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('\u274c weekly-briefing-honesty tests FAILED'); process.exit(1); }
