/**
 * 발신 파이프라인을 IG 우선으로 (2026-08-22)
 * ═══════════════════════════════════════════════════════════════════
 * 도메니코: "모든 파이프라인을 이어서 IG로 우선시되게 조정해줘."
 *
 * ■ 실측이 가리킨 곳 — 헌법과 코드가 어긋나 있었다
 *
 * 외부→웹 유입 30일 1,367건의 출처:
 *     threads 560 (7일 213) · chatgpt 320 · x 214 (7일 214) · other 134 ·
 *     ig 76 · naver 25 · youtube 13 · gemini 12 · pinterest 6 · kakao 1
 *   → **스레드+X 가 774건, 전체의 57%**
 *
 * 그런데 성장 가이드라인(2026-08-08)은 스레드·X 를 "① PAP 인스타그램으로
 * 보내는 파이프"로 정의한다. 실제 코드는 둘 다 **웹으로만** 보내고 있었다.
 * 가장 큰 두 파이프가 헌법과 반대로 흐르고 있었다.
 *
 * ■ 무엇을 근거로 IG 게시물인가
 *   같은 페이지·같은 방문자 비교(30일): 게시물 1,394 vs 프로필 421 → 3.3:1
 *   원본 보유율: 화보 95.0% · 기사 87.7%
 *
 * ■ 무엇을 하지 않는가 — 웹을 끊지 않는다
 *   웹은 2순위 도달점이고 유료 사다리가 거기 있다. 가이드라인 8항(두 도달점은
 *   서로의 파이프)도 한쪽 제거를 금한다. 한 답글에 두 링크, **IG 가 먼저**.
 *   게시 횟수가 안 늘어 X 과금($0.20/답글)도 그대로다. "우선시"≠"독점".
 *
 * ■ 이 테스트가 지키는 것
 *   1. IG 가 웹보다 먼저 온다 (순서가 곧 우선순위다)
 *   2. 웹 링크가 사라지지 않는다 (2순위를 끊지 않는다)
 *   3. IG 클릭이 계측된다 (ig-out 경유 + 화이트리스트 등재)
 *   4. 원본 URL 필드명이 달라도 찾는다 (규칙이 두 벌이 되지 않게)
 *   5. 원본이 없어도 IG 로 간다 (프로필 폴백)
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('      ', d); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { igFirstLinkBlock, igOutUrl } = require(path.join(ROOT, 'api/_lib/igFirstLink.js'));

const WEB = 'https://www.pap-magazine.com/article/x?utm_source=threads&utm_medium=social';

console.log('\n=== 1. IG 가 먼저 온다 ===');
{
  const b = igFirstLinkBlock({ source_instagram_url: 'https://www.instagram.com/p/A/' }, 'threads', WEB);
  t('IG 줄이 웹 줄보다 먼저', b.indexOf('ig-out') < b.indexOf('utm_source'), b);
  t('두 줄이다', b.split('\n').length === 2, JSON.stringify(b));
  t('웹 링크가 살아 있다 (2순위를 끊지 않는다)', b.indexOf(WEB) > -1);
  t('utm 이 보존된다 (웹 유입 계측 유지)', /utm_source=threads/.test(b));
}

console.log('\n=== 2. IG 클릭이 계측된다 ===');
{
  const b = igFirstLinkBlock({ ig: 'https://www.instagram.com/p/A/' }, 'threads', WEB);
  t('ig-out 을 경유한다 (맨몸 instagram.com 이 아니다)',
    /\/api\/ig-out\?src=threads&to=post/.test(b), b.split('\n')[0]);
  const wl = new Function(read('api/ig-out.js').match(/const SRC_WHITELIST = new Set\(\[[\s\S]*?\]\);/)[0] + '; return SRC_WHITELIST;')();
  t("'threads' 가 화이트리스트에 있다 (없으면 other 로 뭉개진다)", wl.has('threads'));
  t("'x' 가 화이트리스트에 있다", wl.has('x'));
  t('기존 라벨이 사라지지 않았다',
    ['ssr_top', 'spa_top', 'ssr_article', 'editorial_mid', 'push', 'boost'].every((s) => wl.has(s)));
  t('모르는 채널은 other 로 떨어진다 (거짓 라벨 방지)',
    /src=other/.test(igOutUrl('https://www.instagram.com/p/A/', '스팸채널')));
}

console.log('\n=== 3. 원본 URL 필드명이 달라도 찾는다 ===');
{
  const cases = [
    ['source_instagram_url', { source_instagram_url: 'https://www.instagram.com/p/A/' }],
    ['ig', { ig: 'https://www.instagram.com/p/B/' }],
    ['permalink', { permalink: 'https://www.instagram.com/reel/C/?igsh=zz' }],
  ];
  for (const [name, art] of cases) {
    const b = igFirstLinkBlock(art, 'x', WEB);
    t(`${name} 필드를 인식한다 → to=post`, /to=post/.test(b), b.split('\n')[0]);
  }
  t('추적 쿼리(?igsh=)를 떼고 보낸다',
    igFirstLinkBlock({ permalink: 'https://www.instagram.com/reel/C/?igsh=zz' }, 'x', WEB).indexOf('igsh') === -1);
  const none = igFirstLinkBlock({}, 'x', WEB);
  t('원본이 없으면 프로필로 — 그래도 IG 가 먼저', /to=profile/.test(none) && none.indexOf('ig-out') < none.indexOf('utm_source'));
}

console.log('\n=== 4. 두 채널이 실제로 이 규칙을 쓴다 ===');
{
  const th = read('api/_lib/threadsAutopost.js');
  t('스레드 링크 답글이 igFirstLinkBlock 을 쓴다', /igFirstLinkBlock\(art, 'threads', gen\.url\)/.test(th));
  t('스레드가 맨몸 gen.url 만 올리지 않는다', !/postText\(gen\.url,\s*undefined/.test(th));
  const ig = read('api/cron/sync-instagram.js');
  t('X 링크 답글이 igFirstLinkBlock 을 쓴다', /igFirstLinkBlock\([\s\S]{0,40}?'x', gen\.url\)/.test(ig));
  t('X 가 맨몸 gen.url 만 답글로 올리지 않는다', !/postTweet\(gen\.url,\s*\{ replyToId/.test(ig));
  /* 게시 횟수가 늘면 X 과금이 늘어난다 — 답글은 한 건 그대로여야 한다 */
  /* 정규식으로 괄호 안을 훑으면 인자 안의 ')' 에서 끊긴다(오늘 이 실수를 반복했다).
     세야 할 것은 "답글 호출이 몇 번인가" 이므로 replyToId 자체를 센다. */
  t('X 답글이 한 건 그대로다 (과금 증가 없음)',
    (ig.match(/replyToId:/g) || []).length === 1,
    '발견 ' + (ig.match(/replyToId:/g) || []).length + '건');
}

console.log('\n=== 5. 웹 파이프를 끊지 않았다 ===');
{
  const th = read('api/_lib/threadsAutopost.js');
  t('스레드가 여전히 utm 붙은 웹 링크를 만든다', /utm_source', 'threads'/.test(th));
  const x = read('api/_lib/xPost.js');
  t('X 가 여전히 utm 붙은 웹 링크를 만든다', /withUtm\(art\.url, 'x'/.test(x));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ig-first-pipelines tests FAILED'); process.exit(1); }
console.log('✅ ig-first-pipelines tests passed');
