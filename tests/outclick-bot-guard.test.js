/**
 * 웹→IG 아웃클릭 봇 오염 방지 회귀 (2026-08-16, "급락" 오독 사건).
 *
 * [사건] 8/1~8/9 데스크탑 UA 10종 × IP 1,100여 개 봇 함대가 ig-out 을
 * 훑어 인간필터(087)를 통과, 8/5 하루 1,171건(모바일 0.9%)까지 부풀림.
 * 함대가 떠나자 주간 성적표가 -65% "급락"으로 표시 — 실손실 없음.
 *
 * 3중 방어: ① 뷰 125 — (UA,기간) 소급 제외 테이블 ② 성적표가 원본이
 * 아니라 인간필터 뷰를 집계 ③ 모바일 비율 <10% 경보 (다음 함대 대비).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const sc = R('api/_lib/channelScorecard.js');
const mig = R('supabase_migrations/125_ig_outclick_bot_fleet.sql');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  \u2713',n);} else {fail++;console.log('  \u2717',n); if(d)console.log('     ',d);} }

console.log('\n=== \uc131\uc801\ud45c\ub294 \uc778\uac04\ud544\ud130 \ubdf0\ub97c \uc4f4\ub2e4 ===');
t('igOut 집계가 ig_outclicks_human 사용',
  /_count\('ig_outclicks_human', 'clicked_at', d7, null\)/.test(sc) &&
  /_count\('ig_outclicks_human', 'clicked_at', d14, d7\)/.test(sc),
  '원본 테이블로 되돌리면 봇 함대에 다시 30배 부풀려진다');
t('igOut 에서 원본 ig_outclicks 직접 집계 없음',
  !/_count\('ig_outclicks',/.test(sc));

console.log('--- \ubaa8\ubc14\uc77c \ube44\uc728 \ubd07 \uacbd\ubcf4 ---');
t('모바일 클릭 별도 집계', /device_type', 'mobile'\)/.test(sc));
t('경보 조건: 표본 50+ AND 모바일 <10%',
  /igOutCur >= 50 && \(igOutMobileCur \/ igOutCur\) < 0\.10/.test(sc));
t('표에 경고 라벨 렌더', /봇 의심\(모바일/.test(sc));

console.log('--- \ub9c8\uc774\uadf8\ub808\uc774\uc158 125 ---');
t('봇 UA 기간제외 테이블 생성', /CREATE TABLE IF NOT EXISTS public\.ig_outclick_bot_uas/.test(mig));
t('UA 10종 등재', (mig.match(/2026-08 봇 함대/g) || []).length === 10);
t('영구 차단이 아니라 기간 한정 (active_from\/to 조건)',
  /r\.clicked_at >= b\.active_from AND r\.clicked_at < b\.active_to/.test(mig));
t('088 보안 재적용: security_invoker=on', /security_invoker = on/.test(mig));
t('088 보안 재적용: anon 권한 회수', /REVOKE ALL ON public\.ig_outclicks_human FROM anon/.test(mig));
t('새 테이블도 RLS + anon 회수',
  /ig_outclick_bot_uas ENABLE ROW LEVEL SECURITY/.test(mig) &&
  /REVOKE ALL ON public\.ig_outclick_bot_uas FROM anon/.test(mig));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('\u274c outclick-bot-guard tests FAILED'); process.exit(1); }
