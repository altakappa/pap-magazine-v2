/**
 * X 트윗 실패 가시화 (2026-08-17, 도메니코 지적: "X에 글이 안 올라간다").
 *
 * 실측: @papmagazine_ 마지막 트윗 8/1 — 17일간 죽어 있었는데 경보 0.
 * 원인: 실패가 results.tweets 에만 담기고 catch (_) {} 가 예외를 삼켰다.
 * 이 테스트는 "실패는 반드시 보인다"는 성질을 회귀로 고정한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'sync-instagram.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

t('트윗 실패가 콘솔에 찍힌다 (Vercel 로그에서 상태코드 확인 가능)',
  /console\.error\('\[sync-ig\] X 트윗 실패:'/.test(src));
t('트윗 예외도 삼키지 않는다 (catch (_) {} 금지)',
  /console\.error\('\[sync-ig\] X 트윗 예외:'/.test(src) &&
  !/const tw = await postTweet[\s\S]{0,800}catch \(_\) \{\}/.test(src));
t('cron 노트에 X 성공/전체 건수가 실린다', /' · X ' \+ \(twArr\.length - twFail\.length\)/.test(src));
t('실패 문자열에 상태코드가 포함된다', /'실패:' \+ \(tw\.status \|\| ''\)/.test(src));
t('스레드 결과도 노트에 실린다', /' · 스레드 '/.test(src));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ x-tweet-observability tests FAILED'); process.exit(1); }
