/**
 * /go 클릭 사람 신호 기록 회귀 (2026-11-15, "브랜드 클릭 7배" 오독 사건)
 *
 * [사건] 11월의 새 크롤러는 리퍼러를 달고 와서 8/17 필터(리퍼러 없는 히트 제외)를
 * 통과했다. 30일 유효 클릭 7,057건 중 3,241건이 매일 00시(UTC) 한 시간에 몰렸고
 * IP 는 전부 달랐으며 휴대폰은 0건이었다. 이 숫자를 성장으로 읽고 "월 50~90만 원"
 * 수익 계획을 세웠다가 철회했다 (PAP-Vault/45_Business/어필리에이트-현황.md 부록 D).
 *
 * 방어 2겹: ① 브라우저가 스스로 붙이는 Sec-Fetch-* 를 기록해 1주 뒤 기준을 정한다
 * (지금은 기록만, counted 는 그대로) ② 주간 브리핑이 숫자 옆에 휴대폰 몫과 경고를 싣는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const { fetchMeta, clickBotSuspect, affiliateClickLine } = require('../api/_lib/clickGuard');
const go = R('api/go/[id].js');
const wb = R('api/cron/weekly-briefing.js');
const mig = R('supabase_migrations/190_affiliate_clicks_fetch_meta.sql');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }
const req = h => ({ headers: h });

console.log('\n=== fetchMeta: 브라우저 신호 읽기 ===');
const human = fetchMeta(req({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' }));
t('사람이 누른 이동: 네 값 모두 기록',
  human.sec_fetch_site === 'same-origin' && human.sec_fetch_mode === 'navigate' &&
  human.sec_fetch_dest === 'document' && human.sec_fetch_user === true, JSON.stringify(human));
const bare = fetchMeta(req({ 'user-agent': 'Mozilla/5.0', referer: 'https://www.pap-magazine.com/brand/x' }));
t('헤더 없는 수집기: 전부 null (false 가 아니라 "모름")',
  bare.sec_fetch_site === null && bare.sec_fetch_mode === null &&
  bare.sec_fetch_dest === null && bare.sec_fetch_user === null, JSON.stringify(bare));
t('Sec-Fetch-User 가 ?0 이면 false', fetchMeta(req({ 'sec-fetch-user': '?0' })).sec_fetch_user === false);
t('대소문자·공백 정리', fetchMeta(req({ 'sec-fetch-site': '  Cross-Site ' })).sec_fetch_site === 'cross-site');
const junk = fetchMeta(req({ 'sec-fetch-site': "x'; DROP TABLE affiliate_clicks;--", 'sec-fetch-mode': 'a'.repeat(5000), 'sec-fetch-dest': '<script>' }));
t('허용 목록 밖 값은 저장하지 않는다 (null)',
  junk.sec_fetch_site === null && junk.sec_fetch_mode === null && junk.sec_fetch_dest === null, JSON.stringify(junk));
t('req 가 비어도 안 죽는다', (() => { try { fetchMeta(null); fetchMeta({}); return true; } catch (e) { return false; } })());
t('돌려주는 키는 DB 칸 네 개뿐',
  Object.keys(human).sort().join() === 'sec_fetch_dest,sec_fetch_mode,sec_fetch_site,sec_fetch_user');

console.log('--- /go 핸들러가 기록한다 ---');
t('recordClick insert 에 fetchMeta 를 싣는다', /\.\.\.fetchMeta\(req\),/.test(go));
t('clickGuard 에서 fetchMeta 를 가져온다', /sanitizeReferrer, fetchMeta \} = require\('\.\.\/_lib\/clickGuard'\)/.test(go));
t('counted 판정은 그대로 (기록만, 1주 관찰 뒤 결정)',
  /const counted = hasReferrer && \(ipHash \? !\(await isDuplicate\(ipHash, brandId, now\)\) : true\);/.test(go),
  '인앱 브라우저가 이 헤더를 붙이는지 모르는 채로 기준에 넣으면 진짜 독자를 버린다');
t('insert 실패가 리다이렉트를 막지 않는다 (경고만)', /console\.warn\('\[go\] click insert failed'/.test(go));

console.log('--- 마이그레이션 190 ---');
t('칸 네 개 추가 (IF NOT EXISTS)',
  ['sec_fetch_site TEXT', 'sec_fetch_mode TEXT', 'sec_fetch_dest TEXT', 'sec_fetch_user BOOLEAN']
    .every(c => mig.includes('ADD COLUMN IF NOT EXISTS ' + c)));
t('뷰가 새 칸을 끝에 붙인다 (기존 칸 순서 보존)',
  /counted, clicked_at, destination_type,\s+sec_fetch_site, sec_fetch_mode, sec_fetch_dest, sec_fetch_user/.test(mig));
t('뷰 보안 재적용: security_invoker = on', /CREATE OR REPLACE VIEW public\.affiliate_clicks_human WITH \(security_invoker = on\)/.test(mig));
t('뷰 보안 재적용: anon·authenticated 회수',
  /REVOKE ALL ON public\.affiliate_clicks_human FROM anon/.test(mig) &&
  /REVOKE ALL ON public\.affiliate_clicks_human FROM authenticated/.test(mig));
t('127 봇 UA 기간제외 조건 보존', /FROM public\.ig_outclick_bot_uas b/.test(mig) && /a\.clicked_at >= b\.active_from AND a\.clicked_at < b\.active_to/.test(mig));
t('기존 행·counted 를 고치지 않는다 (UPDATE·DELETE 없음)', !/^\s*(UPDATE|DELETE)\b/mi.test(mig));

console.log('--- 크롤러 의심 판정 ---');
t('사건 재현: 2,400건 중 휴대폰 70건 → 의심', clickBotSuspect(2400, 70) === true);
t('건강한 주: 300건 중 휴대폰 200건 → 정상', clickBotSuspect(300, 200) === false);
t('표본 50 미만은 판단하지 않는다', clickBotSuspect(49, 0) === false);
t('경계: 50건 중 5건(딱 10%)은 정상, 4건은 의심', clickBotSuspect(50, 5) === false && clickBotSuspect(50, 4) === true);
t('숫자가 아니면 의심으로 몰지 않는다', clickBotSuspect(null, undefined) === false && clickBotSuspect('x', 3) === false);

console.log('--- 주간 브리핑 한 줄 ---');
const warn = affiliateClickLine(2400, 70);
t('의심이면 경고와 하한선을 같이 싣는다',
  /2400 \(그중 휴대폰 70건\)/.test(warn) && /크롤러 의심/.test(warn) && /성장·수익 신호로 해석하지 말 것/.test(warn) && /하한선은 휴대폰 70건/.test(warn), warn);
const ok = affiliateClickLine(300, 200);
t('정상이면 경고 없이 휴대폰 몫만', ok === '300 (그중 휴대폰 200건)', ok);
t('휴대폰 집계가 실패하면(null) 숫자만, 0 으로 둔갑시키지 않는다', affiliateClickLine(300, null) === '300');
t('문서 규칙: 대시 없음', !/[—–]|--/.test(warn + ok));
t('브리핑이 휴대폰 클릭을 따로 센다',
  /\.eq\('counted', true\)\.not\('referrer_path', 'is', null\)\.eq\('device_type', 'mobile'\)/.test(wb));
t('브리핑 줄이 affiliateClickLine 을 쓴다', /affiliateClickLine\(clicks\.count \|\| 0, clicksMobileN\)/.test(wb));
t('휴대폰 집계 실패는 null (0 아님)',
  /const clicksMobileN = \(clicksMobile && !clicksMobile\.error\) \? \(clicksMobile\.count \|\| 0\) : null;/.test(wb));
t('지표에 하한선 저장', /affiliate_clicks_mobile_7d: clicksMobileN/.test(wb));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
