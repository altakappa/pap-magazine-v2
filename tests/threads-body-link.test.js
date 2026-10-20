/**
 * 스레드 본문 인스타 링크 (2026-10-20, 도메니코 "트위터 계정을 참고")
 *   ① 본문 = 글 + CTA + 인스타 원본 링크(ig-out src=threads_body), 500자 이내
 *   ② 답글 = 웹 링크만
 *   ③ 호출부 두 곳이 source_instagram_url 을 넘긴다 (빠지면 링크가 프로필로 간다)
 *   ④ THREADS_BODY_IG_LINK=off 로 예전 방식 복귀
 *   ⑤ 화이트리스트 두 곳에 threads_body
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const TB = require(path.join(ROOT, 'api', '_lib', 'threadsBodyLink.js'));
const { igOutUrl } = require(path.join(ROOT, 'api', '_lib', 'igFirstLink.js'));

console.log('\n[1] 본문 조립');
{
  const link = igOutUrl('https://www.instagram.com/p/ABC123/?igsh=x', TB.IG_OUT_SRC);
  t('ig-out src=threads_body, 게시물로 간다', /src=threads_body&to=post/.test(link), link);
  const r = TB.composeBody('캣츠아이가 런웨이를 걸었다\n핑크 크롭탑부터.\n\n#PAPMAGAZINE', link, '자세한 내용은 아래 링크에서↓');
  const lines = r.text.split('\n');
  t('본문이 먼저', lines[0] === '캣츠아이가 런웨이를 걸었다');
  t('CTA 바로 아래 링크', r.text.indexOf('자세한 내용은 아래 링크에서↓\n' + link) > 0, r.text);
  t('태그 줄은 맨 끝에 남는다', /\n\n#PAPMAGAZINE$/.test(r.text));
  t('500자 이내', r.text.length <= TB.MAX, String(r.text.length));
  t('짧으면 자르지 않는다', r.trimmed === false);
  const long = '가'.repeat(430) + '\n\n#PAPMAGAZINE';
  const r2 = TB.composeBody(long, link, '전체 화보는 아래 링크에서 ↓');
  t('길면 본문만 줄여 500자에 맞춘다', r2.text.length <= TB.MAX && r2.trimmed === true, String(r2.text.length));
  t('줄여도 링크는 온전하다', r2.text.indexOf(link) > 0);
  t('줄인 자리에 말줄임', r2.text.indexOf('…') > 0);
}

console.log('\n[2] CTA 고르기 (X 와 같은 문구)');
{
  t('화보', TB.ctaFor({ url: 'https://www.pap-magazine.com/editorial/a' }, {}) === '전체 화보는 아래 링크에서 ↓');
  t('영상', TB.ctaFor({ url: 'https://www.pap-magazine.com/article/a' }, { video: 'v.mp4' }) === '풀 영상은 아래 링크에서 ↓');
  t('기사', TB.ctaFor({ url: 'https://www.pap-magazine.com/article/a' }, { images: ['a'] }) === '자세한 내용은 아래 링크에서↓');
}

console.log('\n[3] 끄기');
{
  delete process.env.THREADS_BODY_IG_LINK;
  t('기본은 켜짐', TB.isOn() === true);
  process.env.THREADS_BODY_IG_LINK = 'off';
  t('off 면 꺼짐', TB.isOn() === false);
  delete process.env.THREADS_BODY_IG_LINK;
}

console.log('\n[4] 배선');
{
  const ap = R('api/_lib/threadsAutopost.js');
  t('본문 링크일 때 composeBody 로 본문을 만든다', /tbl\.composeBody\(gen\.body, igOutUrl\(igRaw, tbl\.IG_OUT_SRC\)/.test(ap));
  t('본문 링크일 때 답글은 웹만', /bodyIg \? tbl\.webOnlyReply\(gen\.url\) : igFirstLinkBlock\(art, 'threads', gen\.url\)/.test(ap));
  t('미디어 선택이 본문 조립보다 먼저 (CTA 가 영상인지 안다)', ap.indexOf('const media = selectArticleMedia(art)') < ap.indexOf('tbl.composeBody'));
  t('답글 웹 링크에 utm 이 붙어 있다 (gen.url = linkWithUtm)', /generateThreadsText\(art, linkWithUtm\)/.test(ap));
  t('웹 전용 답글 문구', TB.webOnlyReply('https://w/a?utm_source=threads') === '웹에서 전문 보기 → https://w/a?utm_source=threads');
}

console.log('\n[5] 호출부가 인스타 원본을 넘긴다 (빠지면 프로필로 간다, 10/06~10/20 실측 to=post 0)');
{
  const tp = R('api/cron/threads-post.js');
  t('threads-post: select 에 source_instagram_url', /select\('[^']*source_instagram_url[^']*'\)/.test(tp));
  t('threads-post: 넘긴다', /source_instagram_url: art\.source_instagram_url/.test(tp));
  const si = R('api/cron/sync-instagram.js');
  const i = si.indexOf('postArticleToThreads({');   // 2026-10-20 호출이 raceDeadline(...) 로 감싸져 변수명이 바뀜 — 호출 자체를 찾는다
  t('sync-instagram: 넘긴다', i > 0 && /source_instagram_url:/.test(si.slice(i, i + 900)));
}

console.log('\n[6] 계측 화이트리스트');
{
  const { CHANNELS } = require(path.join(ROOT, 'api', '_lib', 'igFirstLink.js'));
  t('igFirstLink CHANNELS', CHANNELS.has('threads_body'));
  t('ig-out SRC_WHITELIST', /'threads_body'/.test(R('api/ig-out.js')));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ threads-body-link tests FAILED'); process.exit(1); }
console.log('✅ threads-body-link tests passed');
