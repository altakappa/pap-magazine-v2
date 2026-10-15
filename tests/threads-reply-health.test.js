/**
 * 스레드 링크 답글 건강 (2026-10-15)
 *
 * 발견: 본글 252건/월 전부 published, 링크 답글(IG→웹) 성공 0건. 10/04 부터 전부
 * code 10 "Application does not have permission" — SCOPES 에 threads_manage_replies 가 없었다.
 * 성질: 권한 scope 에 답글 권한이 있다 · 판정은 detail 을 직접 센다 · 표본 부족이면
 * 울지 않는다 · 권한 오류가 다수면 cause 'scope' 와 재인증 안내 · pipeline-watch 에 배선.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const h = require('../api/_lib/threadsReplyHealth');

console.log('[1] 권한');
t('SCOPES 에 threads_manage_replies (답글은 이 권한 없이는 code 10)', /SCOPES = '[^']*threads_manage_replies/.test(rd('api/_lib/threads.js')));
t('기존 권한은 그대로', /SCOPES = '[^']*threads_content_publish[^']*threads_manage_insights/.test(rd('api/_lib/threads.js')));

console.log('[2] 분류');
const SCOPE_ERR = '링크 답글 실패: 컨테이너 생성 실패: {"error":{"message":"Application does not have permission for this action","type":"THApiException","code":10}}';
t("권한 오류 → 'scope'", h.classify(SCOPE_ERR) === 'scope');
t("다른 실패 → 'other'", h.classify('링크 답글 실패: Unexpected end of JSON input') === 'other');
t('실패 아님 → null (null·빈 문자열·미디어 폴백 메모)', h.classify(null) === null && h.classify('') === null && h.classify('미디어 없이 게시함 — 캐러셀 컨테이너 생성 실패') === null);

console.log('[3] 판정');
t('본글 0건 → 보류', h.judgeThreadsReplyHealth({ attempted: 0, failed: 0 }).healthy === true);
t('표본 부족(3건 전부 실패) → 보류', h.judgeThreadsReplyHealth({ attempted: 3, failed: 3, scopeFails: 3 }).healthy === true);
const bad = h.judgeThreadsReplyHealth({ attempted: 10, failed: 10, scopeFails: 10, windowHours: 24 });
t("10/10 실패, 권한 → 고장 · cause 'scope'", bad.healthy === false && bad.cause === 'scope' && /100%/.test(bad.reason));
const bad2 = h.judgeThreadsReplyHealth({ attempted: 10, failed: 6, scopeFails: 1 });
t("6/10 실패, 권한 아님 → 고장 · cause 'other'", bad2.healthy === false && bad2.cause === 'other');
t('4/10 실패 → 정상 (50% 미만)', h.judgeThreadsReplyHealth({ attempted: 10, failed: 4, scopeFails: 4 }).healthy === true);
t('실측 10/14 재현: 13건 전부 권한 실패 → 고장', h.judgeThreadsReplyHealth({ attempted: 13, failed: 13, scopeFails: 13 }).healthy === false);

console.log('[4] 알림 문구');
const a = h.buildThreadsReplyAlert(bad, 'https://www.pap-magazine.com');
t('제목에 실패/전체', /실패 10\/10/.test(a.title));
t('권한 원인이면 재인증 경로와 권한 이름을 적는다', a.lines.join('\n').includes('threads_manage_replies') && a.lines.join('\n').includes('/api/threads/oauth'));
t('진단 페이지로 링크', /threads-diagnose/.test(a.url));

console.log('[5] 배선');
const pw = rd('api/cron/pipeline-watch.js');
t('pipeline-watch 가 checkThreadsLinkReply 를 호출', /const threadsReply = await checkThreadsLinkReply\(\{ dry \}\)/.test(pw));
t('threads_posts.detail 을 직접 센다 (크론 note 아님)', /from\('threads_posts'\)[\s\S]{0,80}select\('detail'\)/.test(pw));
t('응답 JSON 에 threadsReply', /naver, threadsReply, tiktok/.test(pw));
t('복구 알림은 쿨다운 무시 (wasBroken → ✅)', /스레드 링크 답글 재개/.test(pw));
t('ops_alert_state 키', /THREADS_REPLY_ALERT_KEY = 'threads-link-reply-health'/.test(pw));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
