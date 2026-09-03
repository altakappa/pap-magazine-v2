/**
 * X = 스레드 포맷 패리티 (2026-08-18, 도메니코: "말투만 다르고 올라가는
 * 포맷은 스레드와 동일하게").
 *
 * 구조: 본문(대화형·링크 없음·#PAPMAGAZINE) + 미디어, 링크는 첫 답글.
 * 이 성질이 깨지면 X 가 다시 링크 본문으로 돌아가 도달 억제 + 유료 링크
 * 트윗 비용 구조로 회귀한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
/* 2026-09-03 — 이 파일은 **모델이 없는 경로**(기계식 폴백)를 잰다.
   그런데 키를 지우지 않고 있었다. 내 맥에는 ANTHROPIC_API_KEY 가 없어서
   폴백이 돌았고, Vercel 빌드 환경에는 키가 있어서 **진짜 모델을 불렀다.**
   그래서 로컬 npm test 는 초록, 같은 커밋의 배포 관문은 빨강이었다(148b1a1
   배포 ERROR). 같은 파일이 환경에 따라 서로 다른 코드를 재고 있었던 것이다.
   말투 경로는 tests/x-voice-fallback.test.js 가 스텁으로 따로 본다. */
delete process.env.ANTHROPIC_API_KEY;

const { buildThreadsParityTweet } = require('../api/_lib/xPost');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

(async () => {
  // AI 미설정 환경 → 결정적 폴백 경로 검증
  const art = {
    title: '무대와 객석이 하나된 순간, 오피셜히게단디즘 내한 현장',
    url: 'https://www.pap-magazine.com/article/officialhigedandism-seoul',
    tags: ['오피셜히게단디즘', '내한공연'],
    body: '오피셜히게단디즘이 서울에서 첫 단독 내한 공연을 열었다.',
  };
  const gen = await buildThreadsParityTweet(art);
  t('본문에 링크가 없다 (스레드 원칙)', !/https?:\/\//.test(gen.body), gen.body);
  t('본문에 #PAPMAGAZINE 이 있다', gen.body.includes('#PAPMAGAZINE'));
  t('url 은 별도로 반환되고 utm 이 붙어 있다',
    /utm_source=x&utm_medium=social&utm_campaign=officialhigedandism-seoul/.test(gen.url), gen.url);
  t('이 파일은 모델 없는 경로를 잰다 (키가 지워져 있다)', !process.env.ANTHROPIC_API_KEY);
  /* 모델이 못 쓰면 트윗을 통째로 잃는 게 아니라 최소형이라도 나가야 한다.
     '무엇이 0 이 되면 안 되는가': 제목·본문 한 줄·브랜드 태그. */
  t('모델이 없어도 트윗을 잃지 않는다 (제목·첫 문장·태그가 남는다)',
    gen.body.startsWith(art.title) && gen.body.includes('첫 단독 내한') &&
    gen.body.includes('#PAPMAGAZINE'), gen.body);

  const xp = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'xPost.js'), 'utf8');
  t('postTweet 이 답글(in_reply_to_tweet_id)을 지원한다',
    /in_reply_to_tweet_id: String\(c\.replyToId\)/.test(xp));

  // 2026-08-18 도메니코: "글만 올라가는 게시물은 없었으면" — 무매체 시 링크 본문
  t('bodyWithLink 는 링크를 본문에 포함한다', /https?:\/\//.test(gen.bodyWithLink), gen.bodyWithLink);
  t('bodyWithLink 도 브랜드 태그 유지', gen.bodyWithLink.includes('#PAPMAGAZINE'));

  const sync = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'sync-instagram.js'), 'utf8');
  t('미디어 있으면 패리티, 없으면 링크 본문 (글만 트윗 불가)',
    /const hasMedia = xMedia\.mediaIds\.length > 0/.test(sync) &&
    /hasMedia\s*\n?\s*\? await postTweet\(gen\.body, \{ mediaIds: xMedia\.mediaIds \}\)\s*\n?\s*: await postTweet\(gen\.bodyWithLink/.test(sync));
  t('미디어 본글 성공 시에만 링크 답글', /if \(hasMedia && tw\.ok && gen\.url\)/.test(sync));
  t('링크 답글 실패는 반드시 표시된다 (유입 0 침묵 방지)',
    /링크답글실패/.test(sync) && /console\.error\('\[sync-ig\] X 링크 답글 실패:'/.test(sync));

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ x-threads-parity tests FAILED'); process.exit(1); }
})();
