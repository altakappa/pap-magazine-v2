/**
 * 모든 발신 채널이 인스타를 먼저 둔다 (2026-09-03)
 * ═══════════════════════════════════════════════════════════════════
 * 도메니코 2026-09-03:
 *   "모든 사이트에서의 주 도달은 웹사이트가 아닌 인스타그램이고
 *    서브 도달은 웹사이트입니다."
 *
 * ■ 왜 새 테스트가 필요한가
 *
 * 8-22 에 스레드·X 를 IG 우선으로 바꾸고 tests/ig-first-pipelines.test.js 를
 * 만들었다. 그런데 그 테스트는 **그 두 채널만** 지킨다. 유튜브·틱톡·뉴스레터·
 * 핀터레스트는 그대로 웹이 먼저였고, 아무도 그걸 잡지 못했다.
 *
 * 실측(2026-09-03)이 그 대가를 보여준다: 핀터레스트 내 핀 504개 중 136개가
 * 웹을 가리켰고, 그건 우리 크론 두 개가 만든 핀이었다. 규칙이 코드에만 있고
 * 테스트에 없으면 다음 채널에서 또 어긋난다.
 *
 * ■ 이 테스트가 지키는 것
 *
 *   1. 채널 파일 안에서 **IG 줄이 웹 줄보다 먼저 나온다** (순서 = 우선순위)
 *   2. 웹 링크가 사라지지 않는다 (성장 헌법 8항: 한쪽 방향을 제거하지 않는다)
 *   3. 링크가 하나뿐인 채널(핀터레스트)은 IG 하나만 남긴다
 *   4. 규칙이 호출부에 복제되지 않는다 (igFirstLink 한 곳에)
 *
 * ■ 순서를 소스 코드 위치로 재는 이유
 *
 * 이 파일들은 DB·외부 API 없이는 실행할 수 없다(크론 핸들러). 캡션 생성
 * 함수만 떼어 부르려면 모듈 전체가 로드돼야 하고 그때 supabase 초기화가
 * 걸린다. 그래서 "IG 줄의 위치 < 웹 줄의 위치" 로 판정한다.
 * 완벽하지 않지만, 순서가 뒤집히면 확실히 잡힌다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ('  — ' + extra) : '')); }
}

/** IG 표시 줄이 웹 표시 줄보다 먼저 나오는가 (주석은 뺀다) */
function igBeforeWeb(src, igNeedle, webNeedle) {
  const codeOnly = src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  const i = codeOnly.indexOf(igNeedle);
  const w = codeOnly.indexOf(webNeedle);
  return { ok: i >= 0 && w >= 0 && i < w, i, w };
}

console.log('\n=== 1. 유튜브 — 설명란에서 IG 가 먼저 ===');
{
  const yt = read('api/cron/youtube-post.js');
  const r = igBeforeWeb(yt, '▶ 인스타그램', '▶ 기사 전문');
  t('youtube-post: IG 줄이 기사 링크보다 먼저', r.ok, 'ig=' + r.i + ' web=' + r.w);
  t('youtube-post: 웹 링크를 끊지 않았다', /utm_source=youtube/.test(yt));

  const dy = read('api/cron/drive-youtube-post.js');
  const r2 = igBeforeWeb(dy, '▶ 인스타그램', '▶ 기사 전문');
  t('drive-youtube-post: IG 줄이 먼저', r2.ok, 'ig=' + r2.i + ' web=' + r2.w);
  t('drive-youtube-post: 웹 링크 생존', /▶ 기사 전문/.test(dy));

  const ds = read('api/cron/drive-story-shorts.js');
  const r3 = igBeforeWeb(ds, '▶ Instagram', '▶ PAP MAGAZINE :');
  t('drive-story-shorts: IG 줄이 먼저', r3.ok, 'ig=' + r3.i + ' web=' + r3.w);
  t('drive-story-shorts: 웹 링크 생존(utm 포함)', /utm_campaign=pap_story/.test(ds));
}

console.log('\n=== 2. 틱톡 — 캡션에서 IG 가 먼저 ===');
{
  /* 틱톡 캡션의 URL 은 클릭이 안 된다. 계측도 불가능하다.
     남는 수단이 "읽고 찾아가게 하는 것"뿐이라 순서가 곧 전부다. */
  for (const f of ['api/cron/tiktok-post.js', 'api/cron/tiktok-reels.js', 'api/cron/drive-tiktok-post.js']) {
    const src = read(f);
    const name = path.basename(f, '.js');
    t(name + ': IG 핸들 상수를 공용 모듈에서 가져온다',
      /require\('\.\.\/_lib\/igFirstLink'\)/.test(src) && /IG_HANDLE_URL/.test(src));
    t(name + ': 계정을 캡션에 직접 박아넣지 않았다',
      !/instagram\.com\/pap_magazine/.test(src));
    /* 웹 주소 문자열('pap-magazine.com/…')은 캡션 조립보다 위에서 const 로
       미리 만들어진다. 그래서 그 문자열 위치로 재면 늘 웹이 먼저로 나온다.
       재야 할 것은 **캡션에 실제로 밀어넣는 줄**의 순서다. */
    const webLine = src.indexOf('▶ 기사 전문') >= 0 ? '▶ 기사 전문' : '▶ 전체 화보';
    const r = igBeforeWeb(src, '▶ 인스타그램', webLine);
    t(name + ': IG 줄이 웹 줄보다 먼저', r.ok, 'ig=' + r.i + ' web=' + r.w);
    t(name + ': 웹 줄을 지우지 않았다', src.indexOf(webLine) >= 0);
  }
  /* tiktok-post 는 화보(전체 화보)와 기사(기사 전문) 두 경로가 있다.
     한쪽만 고치고 넘어가기 쉬운 자리라 둘 다 따로 본다. */
  {
    const tp = read('api/cron/tiktok-post.js');
    t('tiktok-post: 화보 경로도 IG 가 먼저',
      igBeforeWeb(tp, '▶ 인스타그램', '▶ 전체 화보').ok);
    t('tiktok-post: IG 줄이 두 경로 모두에 있다',
      (tp.match(/▶ 인스타그램/g) || []).length === 2,
      '발견 ' + (tp.match(/▶ 인스타그램/g) || []).length + '건');
  }
}

console.log('\n=== 3. 뉴스레터 — IG 가 주 버튼, 웹이 보조 ===');
{
  const em = read('api/_lib/email.js');

  /* ① 주간 뉴스 다이제스트 — 같은 CTA 묶음 안에서 IG 가 먼저여야 한다.
     email.js 전체를 훑으면 다른 템플릿의 링크가 먼저 잡히므로
     이 CTA 블록만 잘라서 본다. */
  const start = em.indexOf('padding:28px 28px 4px;');
  const end = em.indexOf('padding:18px 28px 0;', start);
  const cta = start > 0 && end > start ? em.slice(start, end) : '';
  t('주간뉴스: CTA 블록을 찾았다', cta.length > 0);
  const igIn = cta.indexOf('IG_FOLLOW_MAIL');
  const webIn = cta.indexOf("withMailUtm(FRONTEND_URL + '/')");
  t('주간뉴스: IG 가 웹보다 먼저', igIn >= 0 && webIn > igIn, 'ig=' + igIn + ' web=' + webIn);
  t('주간뉴스: IG 가 큰 버튼이다',
    /IG_FOLLOW_MAIL\}" style="display:inline-block;background:#6b1a1a/.test(cta));
  t('주간뉴스: 웹 링크를 지우지 않았다 (유료 사다리 유지)', webIn > 0);

  /* ② 에디토리얼 캠페인 — 껍데기(wrapMarketing)가 본문 뒤에 IG 흰 버튼을
     붙인다. 본문에도 같은 크기의 흰 버튼이 있으면 둘이 맞먹어 우선순위가
     사라진다. 그래서 버튼은 IG 하나만 남기고 웹은 텍스트 링크로 둔다. */
  t('에디토리얼 캠페인: 웹이 큰 흰 버튼이 아니다',
    !/withMailUtm\(FRONTEND_URL \+ '\/'\)\}" style="display:inline-block;background:#fff/.test(em));
  t('에디토리얼 캠페인: 웹 링크는 남아 있다',
    /withMailUtm\(FRONTEND_URL \+ '\/'\)\}"[^>]*VIEW MORE ON PAP|VIEW MORE ON PAP/.test(em));
  t('공통 껍데기의 IG 버튼은 그대로다',
    /IG_FOLLOW_MAIL\}" style="display:inline-block;background:#fff/.test(em));

  t('IG 클릭이 계측된다 (ig-out?src=newsletter)', /ig-out\?src=newsletter/.test(em));
}

console.log('\n=== 4. 네이버 블로그 — 초안 문안에서 IG 가 먼저 ===');
{
  /* 네이버 블로그는 게시를 사람이 한다. 그래서 이 초안이 곧 최종 문안이고,
     **먼저 나오는 링크가 곧 우선순위**다.
     네이버는 외부 링크가 많으면 저품질로 본다 — 개수는 늘리지 않고 순서만 바꿨다. */
  const nd = read('api/admin/naver-blog-draft.js');
  const igCall = nd.indexOf("igCtaBlock(art.source_instagram_url");
  const webLink = nd.indexOf("' 원문</a>에서 보실 수 있어요.</p>'");
  t('기사 초안: IG CTA 가 원문 링크보다 먼저', igCall > 0 && webLink > igCall,
    'ig=' + igCall + ' web=' + webLink);

  const igCall2 = nd.indexOf("igCtaBlock(ed.source_instagram_url");
  const webLink2 = nd.indexOf("' 웹사이트</a>에서 만나보실 수 있어요.</p>'");
  t('화보 초안: IG CTA 가 웹 링크보다 먼저', igCall2 > 0 && webLink2 > igCall2,
    'ig=' + igCall2 + ' web=' + webLink2);

  t('기사 초안: 웹 원문 링크가 살아 있다', webLink > 0);
  t('화보 초안: 웹 링크가 살아 있다', webLink2 > 0);
  t('IG 클릭이 계측된다 (ig-out?src=naverblog)', /src=naverblog/.test(nd));
  t('저작권 라인이 맨 뒤에 남아 있다',
    nd.indexOf('무단 전재 및 재배포 금지') > webLink2);

  const nk = read('api/naver-blog-kit.js');
  const igK = nk.indexOf('인스타그램 @pap_magazine</a>');
  const webK = nk.indexOf('PAP매거진 웹사이트</a>');
  t('블로그 키트: IG 가 웹보다 먼저', igK > 0 && webK > igK, 'ig=' + igK + ' web=' + webK);
  t('블로그 키트: 웹 링크가 살아 있다', webK > 0);
  t('블로그 키트: IG 링크가 ig-out 경유다', /src=naverblog/.test(nk));
}

console.log('\n=== 5. 핀터레스트 — 링크가 하나뿐이라 IG 하나만 ===');
{
  const sp = read('api/cron/sync-pinterest.js');
  const pp = read('api/cron/pinterest-pin.js');
  t('sync-pinterest 가 단일 링크 규칙을 쓴다', /singleLinkDestination/.test(sp));
  t('pinterest-pin 이 단일 링크 규칙을 쓴다', /singleLinkDestination/.test(pp));
  t('두 파일 모두 규칙을 복제하지 않았다',
    !/const link = SITE \+ '\/editorial\//.test(sp) && !/const link = SITE \+ '\/editorial\//.test(pp));
}

console.log('\n=== 6. 규칙은 한 곳에만 산다 ===');
{
  const lib = read('api/_lib/igFirstLink.js');
  t('두 링크 채널용 함수가 있다', /function igFirstLinkBlock/.test(lib));
  t('단일 링크 채널용 함수가 있다', /function singleLinkDestination/.test(lib));
  t('클릭 불가 채널용 표기 상수가 있다', /IG_HANDLE_URL/.test(lib));
  t('세 가지 모두 export 된다',
    /singleLinkDestination/.test(lib.split('module.exports')[1] || '')
    && /IG_HANDLE_URL/.test(lib.split('module.exports')[1] || '')
    && /igFirstLinkBlock/.test(lib.split('module.exports')[1] || ''));

  /* 실제로 불러서 동작을 확인한다 — 문자열 검사만으로는 회귀를 못 잡는다. */
  const m = require(path.join(ROOT, 'api/_lib/igFirstLink.js'));
  const a = m.singleLinkDestination({ slug: 'x', source_instagram_url: 'https://www.instagram.com/p/AAA/?igsh=z' });
  t('원본이 있으면 IG 로 가고 추적 쿼리가 떨어진다',
    a.isIg === true && a.url === 'https://www.instagram.com/p/AAA/', a.url);
  const b = m.singleLinkDestination({ slug: 'lost-form' });
  t('원본이 없으면 웹 화보로 폴백한다 (프로필로 뭉개지 않는다)',
    b.isIg === false && /\/editorial\/lost-form$/.test(b.url), b.url);
  const c = m.singleLinkDestination({ slug: 'c', source_instagram_url: 'https://evil.example.com/p/x/' });
  t('인스타가 아닌 주소를 IG 로 취급하지 않는다', c.isIg === false, c.url);
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ig-first-all-channels tests FAILED'); process.exit(1); }
console.log('✅ ig-first-all-channels tests passed');
