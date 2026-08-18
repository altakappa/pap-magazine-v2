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
  t('폴백 본문 = 제목 + 첫 문장 + 태그', gen.body.startsWith(art.title) && gen.body.includes('첫 단독 내한'));

  const xp = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'xPost.js'), 'utf8');
  t('postTweet 이 답글(in_reply_to_tweet_id)을 지원한다',
    /in_reply_to_tweet_id: String\(c\.replyToId\)/.test(xp));

  const sync = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'sync-instagram.js'), 'utf8');
  t('본글 성공 시에만 링크 답글을 올린다', /if \(tw\.ok && gen\.url\) \{\s*\n\s*const rep = await postTweet\(gen\.url, \{ replyToId: tw\.id \}\)/.test(sync));
  t('링크 답글 실패는 반드시 표시된다 (유입 0 침묵 방지)',
    /링크답글실패/.test(sync) && /console\.error\('\[sync-ig\] X 링크 답글 실패:'/.test(sync));

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ x-threads-parity tests FAILED'); process.exit(1); }
})();
