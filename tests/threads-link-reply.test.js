/**
 * 스레드 도달 개선 — 링크를 첫 답글로 + 하루 상한 (2026-08-13 신설)
 *
 * [왜] 실측 30일: 게시 328건(하루 약 11건) · 평균 조회 36 · 좋아요 63 ·
 * **답글 0** · 리포스트 5. 그런데 웹 유입은 threads 가 1위(255건)였다.
 * 즉 콘텐츠가 아니라 도달만 문제였다.
 *
 * 2026 스레드 알고리즘 두 가지가 우리를 정면으로 때리고 있었다:
 *   ① 답글률이 1차 배포 신호 — 답글 0 이면 다음 글 도달이 깎인다
 *   ② 링크 달린 글은 랭킹이 눌린다
 * 그리고 하루 11건은 권장(2~3건)의 3~5배라 자기 글끼리 잡아먹었다.
 *
 * [고친 것] 본문은 링크 없이 올리고 링크는 곧바로 첫 답글로 붙인다
 * (링크 억제 회피 + thread depth 1 확보를 한 번에). 하루 상한 3건.
 *
 * 여기서 지키는 것:
 *   ① 본문에 링크가 없다  ② 링크 답글은 본글 성공 시에만
 *   ③ 답글 실패가 본글을 실패로 만들지 않는다 (단, 조용히 넘기지도 않는다)
 *   ④ 상한은 공용 함수에 있다 — 크론·실시간 두 경로가 모두 지나야 한다
 *   ⑤ utm 은 그대로 살아 있다 (성장 헌법 3조)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const th = R('api/_lib/threads.js');
const ap = R('api/_lib/threadsAutopost.js');
const AP = require(path.join(ROOT, 'api', '_lib', 'threadsAutopost.js'));

console.log('\n[1] threads.js — 답글로 붙일 수 있는가');
{
  t('postText 가 opts.replyToId 를 받는다', /function postText\(text, accountId, opts\)/.test(th));
  t('reply_to_id 를 컨테이너 파라미터에 넣는다',
    /params\.reply_to_id = String\(replyToId\)/.test(th));
  t('replyToId 가 없으면 reply_to_id 를 안 넣는다 (일반 게시 불변)',
    /if \(replyToId\) params\.reply_to_id/.test(th));
  t('기존 폴링·발행 경로는 그대로', /waitContainer\(cj\.id, token, 6\)/.test(th));
}

console.log('\n[2] 본문에 링크가 없다');
{
  const art = { id: 'a1', title: '제목', content: '<p>첫 문장이다. 둘째 문장.</p>', category: 'fashion' };
  const body = AP.fallbackBody(art);
  t('폴백 본문에 http 링크가 없다', body.indexOf('http') === -1, body);
  t('폴백 본문에 제목이 있다', body.indexOf('제목') >= 0);
  t('폴백 본문에 해시태그는 남는다 (링크와 다르다)', body.indexOf('#PAPMAGAZINE') >= 0);
  t('예전 폴백(fallbackText)은 링크를 그대로 유지한다 (하위호환)',
    AP.fallbackText(art, 'https://x.test/a').indexOf('https://x.test/a') >= 0);

  t('AI 경로도 body 와 url 을 나눠 돌려준다',
    /return \{ text, body: clean, url, ai: true \}/.test(ap));
  t('text(본문+링크)는 하위호환으로 남는다', /const text = \(clean \+ '\\n\\n' \+ url\)/.test(ap));
}

console.log('\n[3] 링크 답글 배선');
{
  t('본글은 링크 없는 bodyText 로 올린다',
    /postMedia\(media, bodyText\)/.test(ap) && /postText\(bodyText\)/.test(ap));
  t('본문에 text(링크 포함)를 다시 쓰지 않는다',
    !/postText\(text\)/.test(ap) && !/postMedia\(media, text\)/.test(ap));
  t('링크는 답글로 붙인다', /postText\(gen\.url, undefined, \{ replyToId: threadId \}\)/.test(ap));
  t('본글이 성공했을 때만 답글을 단다',
    /if \(status === 'published' && threadId && gen\.body && gen\.url\)/.test(ap));
  t('답글 실패가 본글을 실패로 만들지 않는다 (status 재할당 없음)',
    !/링크 답글 실패[\s\S]{0,200}status = 'failed'/.test(ap));
  t('답글 실패를 detail 에 남긴다 (조용한 실패 금지)',
    /'링크 답글 실패: ' \+ why/.test(ap));
  t('body 가 없는 구 경로는 예전처럼 링크 포함 본문을 쓴다',
    /const bodyText = gen\.body \|\| text;/.test(ap));
}

console.log('\n[4] 하루 상한 — 두 경로 공용');
{
  /* 2026-08-17 — 3 -> 7. 실측이 "게시량을 줄이면 유입이 그만큼 준다" 였다
     (게시당 유입 4~7 로 일정). 중간값으로 2주 재판정한다. */
  t('상한 기본값 7', AP.DAILY_CAP === 7, String(AP.DAILY_CAP));
  t('env 로 바꿀 수 있다', /process\.env\.THREADS_DAILY_CAP \|\| '7'/.test(ap));
  t('상한 근거가 코드에 남아 있다 (되돌릴 때 판단 근거가 된다)',
    /게시 1건당 유입은 4~7 로 거의 일정하다/.test(ap));
  t('상한 판정이 공용 함수(threadsAutopost)에 있다 — 크론에만 두면 실시간 경로가 샌다',
    /async function publishedTodayCount/.test(ap) && /postArticleToThreads/.test(ap));
  t('published 만 센다', /\.eq\('status', 'published'\)\.gte\('posted_at'/.test(ap));
  t('상한 도달은 실패가 아니라 skipped', /status: 'skipped', detail: '하루 상한/.test(ap));
  t('상한 조회 실패는 게시를 막지 않는다', /하루 상한 조회 실패, 그대로 진행/.test(ap));
  t('이미 게시됨 판정이 상한보다 먼저다 (스킵 사유가 안 섞이게)',
    ap.indexOf("'이미 게시됨'") < ap.indexOf('하루 상한 조회 실패'));
}

console.log('\n[5] KST 하루 경계');
{
  /* KST 0시가 UTC 15시(전날)다. 경계를 UTC 기준으로 잡으면 매일 9시간이 샌다. */
  const d1 = AP.kstDayStartIso('2026-08-13T00:30:00+09:00');
  const d2 = AP.kstDayStartIso('2026-08-13T23:59:00+09:00');
  t('같은 KST 날짜면 같은 시작점', d1 === d2, d1 + ' vs ' + d2);
  t('시작점이 UTC 15:00 (=KST 익일 0시)', /T15:00:00/.test(d1), d1);
  const d3 = AP.kstDayStartIso('2026-08-14T00:30:00+09:00');
  t('KST 날짜가 넘어가면 시작점도 넘어간다', d3 !== d1, d3);
}

console.log('\n[6] 성장 헌법 3조 — 링크는 여전히 계측된다');
{
  t('utm_source=threads 가 살아 있다', /searchParams\.set\('utm_source', 'threads'\)/.test(ap));
  t('답글로 나가는 것도 utm 붙은 링크다 (gen.url = linkWithUtm)',
    /generateThreadsText\(art, linkWithUtm\)/.test(ap) && /postText\(gen\.url,/.test(ap));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ threads-link-reply tests FAILED'); process.exit(1); }
console.log('✅ threads-link-reply tests passed');
