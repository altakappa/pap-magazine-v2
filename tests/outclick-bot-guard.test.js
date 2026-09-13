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
const mig151 = R('supabase_migrations/151_ig_outclick_ssr_referrer_rule.sql');

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

console.log('--- \ub9c8\uc774\uadf8\ub808\uc774\uc158 151 \u2014 SSR \ub9c1\ud06c\ub294 referrer \uc5c6\ub294 \ube44\ubaa8\ubc14\uc77c\uc744 \uc548 \uc13c\ub2e4 ---');
/* 2026-09-13. 127 의 (일자,UA) 고유IP 60+ 규칙은 함대가 UA 를 쪼개 IP 를 60 아래로
   유지하면 샌다(실측 70/44IP · 68/42 · 64/40, 전부 모바일 0%·referrer NULL).
   임계값을 낮추는 대신 봇이 흉내 낼 수 없는 신호를 쓴다 — SSR 링크는 SSR 페이지
   HTML 안에만 있으므로 사람이 누르면 같은 출처 Referer 가 반드시 남는다. */
t('규칙 3 존재: src LIKE ssr% AND referrer NULL 제외',
  /NOT \(r\.src LIKE 'ssr%'::text/.test(mig151) && /r\.referrer_path IS NULL/.test(mig151));
t('모바일은 살려 둔다 (일부 모바일 브라우저가 Referer 를 지운다)',
  /r\.device_type IS DISTINCT FROM 'mobile'::text/.test(mig151));
t('087 시작시각 조건 보존', /2026-07-20 02:11:00\+00/.test(mig151));
t('087 ssr 데스크탑 제외 보존',
  /NOT \(r\.src = 'ssr'::text AND r\.device_type = 'desktop'::text\)/.test(mig151));
t('125 수동 UA 목록 보존', /FROM ig_outclick_bot_uas b/.test(mig151));
t('127 자동 함대 판정 보존', /FROM ig_outclick_bot_days d/.test(mig151));
t('127 IP당 10건 상한 보존', /nth_same_ip_src <= 10/.test(mig151));
/* 147 교훈: CREATE OR REPLACE VIEW 는 열 이름·순서·개수를 못 바꾼다.
   바꾸면 마이그레이션 전체가 실패하고, 피하려 DROP 을 쓰면 읽는 쪽이 다 깨진다. */
t('열 이름·순서가 그대로 8개',
  /SELECT id,\s*\n\s*src,\s*\n\s*to_type,\s*\n\s*target_url,\s*\n\s*referrer_path,\s*\n\s*device_type,\s*\n\s*ip_hash,\s*\n\s*clicked_at\s*\n\s*FROM ranked/.test(mig151));
t('088 보안 재적용 3종',
  /security_invoker = on/.test(mig151) &&
  /REVOKE ALL ON public\.ig_outclicks_human FROM anon/.test(mig151) &&
  /GRANT SELECT ON public\.ig_outclicks_human TO service_role/.test(mig151));
/* 규칙이 ssr 계열에만 걸려야 한다. x·spa_top·editorial_mid 등 다른 src 를
   건드리면 그쪽 지표가 이유 없이 깎인다(적용 전 실측: 다른 src 변화 0). */
t('ssr 계열 밖으로 번지지 않는다 (다른 src 를 직접 제외하지 않는다)',
  !/NOT \(r\.src = 'x'/.test(mig151) && !/NOT \(r\.src LIKE 'spa/.test(mig151));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('\u274c outclick-bot-guard tests FAILED'); process.exit(1); }
