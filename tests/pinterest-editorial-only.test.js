/**
 * 핀터레스트 자동 발행은 에디토리얼만 (2026-08-22, 도메니코 지시)
 * ═══════════════════════════════════════════════════════════════════
 * 지시: "에디토리얼이 아니라면 핀터레스트에 자동 올리기를 하지 말아줘"
 *
 * 확인해 보니 **코드 쪽은 이미 그렇게 돼 있었다.** 실측:
 *   · api/cron/pinterest-pin.js    from('editorials') 만
 *   · api/cron/sync-pinterest.js   from('editorials') 만
 *   · api/pinterest-csv.js         from('editorials') 만
 *   · pinterest_pin_log            0건 (지금까지 핀된 적 없음)
 *   · editorials.pinterest_synced_at  전부 null
 *   · editorials 테이블 자체가 화보 전용 — 발행 2,301편 중
 *     [ NEWS ]/[ CELEBRITY ] 류 0건, 인스타 크론은 articles 로 들어간다
 *
 * ⚠ 진짜 위험은 코드가 아니라 **핀터레스트 계정 설정**이다.
 *   피드가 둘 있다:
 *     /rss-editorials.xml  에디토리얼만 (핀터레스트 자동발행용으로 만든 것)
 *     /rss.xml             기사 + 에디토리얼 통합 (articles 30 + editorials 30 병합)
 *   핀터레스트 비즈니스 계정의 'RSS 자동 발행'이 /rss.xml 을 보고 있으면
 *   기사가 에디토리얼보다 최신인 순간 기사가 핀으로 올라간다.
 *   (2026-08-22 실측 기준 /rss.xml 상위 30건이 우연히 전부 에디토리얼이라
 *    지금 당장은 사고가 안 났을 뿐이다. 장전된 상태다.)
 *   → 계정 설정 확인은 도메니코 몫. 이 테스트는 **코드 쪽이 흔들리지 않게** 못박는다.
 *
 * ■ 2026-09-02: 그 장전된 총이 발사됐다.
 *   도메니코 "핀터레스트에 에디토리얼만 올라가게 해줘" 로 재확인하다 실측:
 *
 *     /rss.xml            상위 12건이 **12건 다 /article/** (에디토리얼 0건)
 *     /rss-editorials.xml 100건 전부 /editorial/ (정상)
 *
 *   8/22 에는 우연히 전부 에디토리얼이었고, 9/2 에는 우연히 전부 기사다.
 *   기사 발행이 화보보다 빨라졌기 때문이다. 우연에 기대고 있었다는 뜻이다.
 *
 *   코드는 그대로 결백하다 — pinterest_pin_log 0건,
 *   editorials.pinterest_synced_at 전부 null, 크론은 PINTEREST_PUBLISH_PAUSED 로 정지 중.
 *   즉 지금 핀터레스트에 올라가는 것이 있다면 **우리 코드가 만든 게 아니다.**
 *   후보는 둘뿐이다:
 *     ① 핀터레스트 계정의 RSS 자동 발행이 /rss.xml 을 보고 있다
 *     ② 인스타그램 계정 연결(자동 핀) 이 켜져 있다  (2026-08-14 에 끄기로 한 항목)
 *   둘 다 계정 설정이라 코드로는 못 막는다. 이 주석은 다음 사람이 코드를 뒤지느라
 *   시간을 버리지 않게 하려고 남긴다.
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 소스에서 supabase 테이블 이름을 전부 뽑는다. */
function tablesIn(src) {
  return [...new Set([...src.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1]))];
}

console.log('\n=== 1. 핀을 만드는 경로는 editorials 만 읽는다 ===');
for (const f of ['api/cron/pinterest-pin.js', 'api/cron/sync-pinterest.js', 'api/pinterest-csv.js']) {
  const src = read(f);
  const tables = tablesIn(src);
  const contentTables = tables.filter((x) => ['articles', 'films', 'submissions', 'celebs'].indexOf(x) > -1);
  t(`${f} — 기사·필름 테이블을 읽지 않는다`, contentTables.length === 0, tables.join(','));
  t(`${f} — editorials 를 읽는다 (경로가 살아 있다)`, tables.indexOf('editorials') > -1, tables.join(','));
}

console.log('\n=== 2. 핀 링크는 /editorial/ 로만 나간다 ===');
{
  const src = read('api/cron/pinterest-pin.js');
  const links = [...src.matchAll(/SITE\s*\+\s*'(\/[a-z-]+)\//g)].map((m) => m[1]);
  t('핀 링크 경로가 /editorial 뿐이다', links.length > 0 && links.every((l) => l === '/editorial'), links.join(','));
  t("로그에 kind:'editorial' 로 남긴다", /kind:\s*'editorial'/.test(src));
}

console.log('\n=== 3. 핀터레스트용 RSS 는 에디토리얼 전용이다 ===');
{
  const src = read('api/rss-editorials.js');
  const tables = tablesIn(src);
  t('rss-editorials 는 editorials 만 읽는다',
    tables.length === 1 && tables[0] === 'editorials', tables.join(','));
  t('링크를 /editorial/ 로만 만든다', !/\/article\/|\/film\//.test(src));
  t('이 피드가 핀터레스트용이라는 사실이 파일에 적혀 있다', /핀터레스트|Pinterest/.test(src));
}

console.log('\n=== 4. 통합 피드(/rss.xml)와 헷갈리지 않게 ===');
{
  /* /rss.xml 은 기사를 담는 게 정상이다. 문제는 그걸 핀터레스트에 물렸을 때다.
     여기서 지키는 건 "두 피드가 서로 다른 파일이고, 통합 피드가
     에디토리얼 전용 라우트를 가로채지 않는다" 는 것. */
  const rss = read('api/rss.js');
  t('/rss.xml 은 기사도 담는다 (통합 피드로서 정상)', tablesIn(rss).indexOf('articles') > -1);
  const vercel = JSON.parse(read('vercel.json'));
  const rw = vercel.rewrites || [];
  const edRoute = rw.filter((r) => r.source === '/rss-editorials.xml');
  t('/rss-editorials.xml 라우트가 존재한다', edRoute.length === 1, JSON.stringify(edRoute));
  t('/rss-editorials.xml 이 api/rss-editorials 로 간다',
    edRoute.length === 1 && /rss-editorials/.test(edRoute[0].destination), JSON.stringify(edRoute));
  const mainRoute = rw.filter((r) => r.source === '/rss.xml' && /\/api\/rss$/.test(r.destination || ''));
  t('/rss.xml 은 통합 피드로 따로 간다', mainRoute.length === 1);
}

/* ── 2026-09-03: 핀 목적지는 인스타그램 ────────────────────────────────
   도메니코: "모든 사이트에서의 주 도달은 웹사이트가 아닌 인스타그램이고
   서브 도달은 웹사이트입니다."

   sync-pinterest 가 자동 발행을 담당하는 유일한 크론이다(pinterest-pin 은
   이중 게시 때문에 자동 스케줄에서 빠져 있다). 그래서 여기가 새 핀의
   목적지를 정하는 실질적 한 곳이다.

   실측 배경(2026-09-03): 내 핀 504개 중 366개는 인스타를 가리키고
   136개는 웹을 가리켰다. 그 136개가 바로 이 크론이 만든 핀이다.
   크론을 안 고치면 기존 핀을 손으로 고쳐도 웹 링크 핀이 계속 늘어난다. */
console.log('\n=== 핀 목적지 = 인스타 원본 (2026-09-03) ===');
{
  const sp = fs.readFileSync(path.join(ROOT, 'api/cron/sync-pinterest.js'), 'utf8');
  t('단일 링크 규칙 모듈을 쓴다', sp.includes('singleLinkDestination'));
  t('규칙을 자기 파일에 복제하지 않는다',
    !/const link = SITE \+ '\/editorial\//.test(sp));
  t('인스타 원본 컬럼을 실제로 조회한다', /select\([^)]*source_instagram_url/.test(sp));

  const lib = fs.readFileSync(path.join(ROOT, 'api/_lib/igFirstLink.js'), 'utf8');
  t('원본이 없으면 웹으로 폴백한다 (프로필로 뭉개지 않는다)',
    /return \{ url: SITE \+ path, isIg: false \}/.test(lib));
  t('인스타 URL 만 인스타로 판정한다', /instagram\\\.com/.test(lib));
  t('추적 쿼리(?igsh=…)를 떼고 보낸다', /raw\.split\('\?'\)\[0\]/.test(lib));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ pinterest-editorial-only tests FAILED'); process.exit(1); }
console.log('✅ pinterest-editorial-only tests passed');
