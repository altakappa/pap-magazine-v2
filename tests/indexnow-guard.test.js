/*
 * indexnow-guard.test.js  (2026-08-07)
 *
 * /api/indexnow 는 매일 02:00 에 예약돼 있으면서 cron_runs 에 아무 기록을
 * 남기지 않았다. 그래서 셋을 구분할 방법이 없었다 —
 *   ① 안 도는 것  ② 돌지만 제출할 게 없는 것  ③ 제출했는데 거절당한 것
 *
 * 특히 ③ 이 위험했다. 엔드포인트가 전부 거절해도 함수는 200 과
 * "submitted: 50" 을 돌려줬다. 그 숫자는 '보낸 개수' 지 '받아준 개수' 가 아니다.
 * 네이버·빙이 키를 못 읽어 403 을 주고 있어도 겉으로는 매일 성공이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'api/indexnow.js');
const src = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

console.log('\n=== 1. 관측 가능한가 ===');
ok(/withCronGuard\(\s*'indexnow'/.test(src), "withCronGuard('indexnow') 로 감싸져 있다");
ok(/cronNote/.test(src), 'cronNote 로 결과를 로그에 남긴다');
ok(/인증 거부/.test(src), '인증에 막힌 실행도 로그에 사유가 남는다');
ok(/제출 생략/.test(src), "'제출할 게 없었다' 와 '실패' 를 로그에서 구분할 수 있다");

console.log('\n=== 2. 수락 여부를 실제로 센다 ===');
ok(/accepted/.test(src), '수락 개수(accepted)를 따로 센다');
ok(/status\s*===\s*200\s*\|\|\s*.*status\s*===\s*202/.test(src),
   'IndexNow 규격대로 200·202 만 수락으로 본다');
ok(/if \(!accepted\)/.test(src), '수락이 0이면 별도 경로를 탄다');
ok(/status\(502\)/.test(src),
   '전부 거절이면 5xx 로 올린다 — 그래야 가드가 실패로 잡고 알림이 간다');
ok(!/return res\.status\(200\)\.json\(\{\s*\n?\s*submitted: urlList\.length,\s*\n?\s*mode/.test(src),
   '수락 확인 없이 200 을 돌려주던 옛 경로가 남아있지 않다');

console.log('\n=== 3. 판정 함수가 규격대로 동작한다 ===');
/* import 만으로 env 를 요구하는 모듈(supabase 등)을 갈아끼운다.
   이 저장소는 같은 함정을 이미 겪었다 — aiCreditWatch 가 import 만으로
   env 를 요구해 CI 스위트를 통째로 죽였다(86312cf). 같은 실수 반복 금지. */
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (req) {
  if (/_lib\/supabase$/.test(req)) return { supabaseAdmin: { from: () => ({}) } };
  if (/_lib\/cronGuard$/.test(req)) return { withCronGuard: (name, h) => h };
  return _origLoad.apply(this, arguments);
};
delete require.cache[require.resolve(SRC)];
const m = require(SRC);
Module._load = _origLoad;
const A = m.epAccepted;
ok(A({ status: 200 }) === true, '200 = 수락');
ok(A({ status: 202 }) === true, '202 = 수락 (키 확인 대기)');
ok(A({ status: 403 }) === false, '403 = 거절 (키 파일을 못 읽은 경우)');
ok(A({ status: 400 }) === false, '400 = 거절');
ok(A({ status: 429 }) === false, '429 = 거절 (과다 제출)');
ok(A({ error: 'timeout' }) === false, '타임아웃 = 수락 아님');
ok(A(null) === false, 'null 이어도 터지지 않는다');

console.log('\n=== 4. 엔드포인트 라벨이 로그를 짧게 유지한다 ===');
const L = m.epLabel;
ok(L('https://searchadvisor.naver.com/indexnow') === '네이버', '네이버 라벨');
ok(L('https://www.bing.com/indexnow') === '빙', '빙 라벨');
ok(L('https://api.indexnow.org/indexnow') === 'indexnow.org', 'indexnow.org 라벨');
ok(m.ENDPOINTS.every((e) => L(e).length <= 24), '모든 엔드포인트 라벨이 24자 이하 (note 500자 상한 보호)');
ok(m.ENDPOINTS.length >= 3, `제출 엔드포인트 ${m.ENDPOINTS.length}곳`);

console.log('\n=== 5. 언어판 URL 제출 (2026-08-26) ===');
/* [왜] Bing 웹마스터 "Important URLs missing" 이 전부 언어판(/en /ja /zh …)
   기사였다 — IndexNow 가 ko URL 만 제출하고 있었기 때문. en 은 항상,
   나머지는 seo_translations 에 번역이 실재하는 언어만 제출한다. */
ok(/langVariantUrls/.test(src) && /withLangs/.test(src), '언어판 확장 경로가 존재한다');
ok(/const h = f\.slug \|\| f\.id/.test(src),
   '필름 URL 이 title 폴백이 아니라 slug||id 다 (존재하지 않는 /film/<제목> 제출 방지)');
ok(!/f\.title \|\| f\.id/.test(src), '옛 title 폴백이 남아있지 않다');

/* 실행 검증 — 번역 실재 언어만 + en 항상 + ko 접두 금지 */
Module._load = function (req) {
  if (/_lib\/supabase$/.test(req)) return { supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [
      { content_id: 'id1', lang: 'it' },
      { content_id: 'id1', lang: 'ja' },
      { content_id: 'id2', lang: 'ko' },
    ] }) }) }) }),
  } };
  if (/_lib\/cronGuard$/.test(req)) return { withCronGuard: (name, h) => h };
  return _origLoad.apply(this, arguments);
};
delete require.cache[require.resolve(SRC)];
const m2 = require(SRC);
Module._load = _origLoad;

(async () => {
  const urls = await m2.langVariantUrls('editorial', [
    { id: 'id1', slug: 'sacre-chaos' },
    { id: 'id2', slug: 'no-tr' },
    { id: 'id3' }, // slug 없음 → id 폴백
  ]);
  const S = 'https://www.pap-magazine.com';
  ok(urls.includes(S + '/en/editorial/sacre-chaos'), 'en 은 항상 제출 (title_en SSR 상존)');
  ok(urls.includes(S + '/it/editorial/sacre-chaos'), '번역 실재 언어(it) 제출');
  ok(urls.includes(S + '/ja/editorial/sacre-chaos'), '번역 실재 언어(ja) 제출');
  ok(!urls.some(u => u.indexOf('/ko/') !== -1), 'ko 접두 URL 은 만들지 않는다 (정본은 무접두)');
  ok(!urls.some(u => u.indexOf('/it/editorial/no-tr') !== -1), '번역 없는 콘텐츠에 언어판을 지어내지 않는다');
  ok(urls.includes(S + '/en/editorial/id3'), 'slug 없으면 id 폴백');

  console.log('\n=== 6. 갱신된 페이지도 제출한다 (2026-09-05) ===');
  /* [왜] 주석은 "발행/갱신" 이었는데 코드는 published_date 만 봤다. 제목 수정·
     FAQ 부착·영문 FAQ 백필·번역 갱신이 검색엔진에 한 번도 다시 알려지지 않았다.
     Ahrefs Site Audit 9/1: "Changed pages not submitted to IndexNow" 9,998.
     DB 9/5: 48h 안에 발행일은 옛날인데 updated_at 이 바뀐 기사 1,147편. */
  ok(/CHANGED_FILTER/.test(src) && /updated_at\.gte\./.test(src),
     'recent 필터가 updated_at 을 본다 (published_date 만 보던 회귀 방지)');
  ok(!/if \(sinceIso\) q = q\.gte\('published_date', sinceIso\)/.test(src),
     'published_date 단독 필터가 남아 있지 않다');
  ok(/\.order\(sinceIso \? 'updated_at' : 'published_date'/.test(src),
     'since 모드에서는 최근 갱신순으로 자른다 (오래된 갱신이 limit 에 밀려 영영 못 나가는 것 방지)');
  ok(/INDEXNOW_RECENT_CAP/.test(src), 'recent 총량 상한이 있다 (하루 1만 건 되밀기 방지)');
  ok(/translationOnly/.test(src), '번역행만 바뀐 언어판을 따로 세어 note 에 남긴다 (조용한 성공 금지)');

  const f = m2.CHANGED_FILTER('2026-09-03T06:12:34.567Z');
  ok(f === 'published_date.gte.2026-09-03T06:12:34Z,updated_at.gte.2026-09-03T06:12:34Z',
     'or 필터 문자열: 두 칼럼 모두, 밀리초 제거 — ' + f);

  /* 실행 검증 — since 가 있으면 언어판은 since 이후 갱신된 번역행만 */
  const calls = [];
  Module._load = function (req) {
    if (/_lib\/supabase$/.test(req)) return { supabaseAdmin: {
      from: () => ({ select: () => ({ eq: () => ({ in: () => {
        const rows = [
          { content_id: 'id1', lang: 'it' },   // 갱신됨(모의: gte 호출 시 it 만 남긴다)
          { content_id: 'id1', lang: 'ja' },
        ];
        const thenable = {
          gte: (col, v) => { calls.push([col, v]); return Promise.resolve({ data: rows.filter(r => r.lang === 'it') }); },
          then: (res) => res({ data: rows }),
        };
        return thenable;
      } }) }) }),
    } };
    if (/_lib\/cronGuard$/.test(req)) return { withCronGuard: (name, h) => h };
    return _origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve(SRC)];
  const m3 = require(SRC);
  Module._load = _origLoad;
  const withSince = await m3.langVariantUrls('article', [{ id: 'id1', slug: 'x' }], '2026-09-03T00:00:00Z');
  ok(calls.length === 1 && calls[0][0] === 'updated_at', 'since 지정 시 번역행을 updated_at 으로 거른다');
  ok(withSince.includes(S + '/en/article/x'), 'en 은 원본이 바뀌면 항상 (title_en SSR)');
  ok(withSince.includes(S + '/it/article/x') && !withSince.includes(S + '/ja/article/x'),
     '갱신된 번역(it)만 내고 안 바뀐 언어(ja)는 되밀지 않는다');
  const noSince = await m3.langVariantUrls('article', [{ id: 'id1', slug: 'x' }]);
  ok(noSince.includes(S + '/ja/article/x'), 'since 없으면(backfill·full) 종전대로 실재 언어 전부');


  /* ── 7. 엔드포인트가 조용히 계속 거절하는 것을 잡는다 (2026-09-15) ──────
   * 9/15 실행에서 네이버가 처음 403 을 돌려줬다(9/13까지 계속 200). 남은 기록은
   * 숫자 '403' 하나뿐이라 키 검증 실패인지 레이트리밋인지 알 방법이 없었다.
   * 그리고 수락이 하나라도 있으면 이 크론은 성공으로 끝나므로(옳다 — IndexNow
   * 는 엔드포인트끼리 제출을 공유한다) 며칠을 거절당해도 조용하다.
   * 네이버는 국내 검색 유입 채널이라 그 침묵이 제일 비싸다. */
  console.log('\n=== 7. 거절 추적 (2026-09-15) ===');
  ok(/let why = '';\s*\n\s*if \(!epAccepted\(\{ status: r\.status \}\)\)/.test(src),
     '거절(비2xx)일 때만 응답 본문을 읽는다 — 수락일 때 읽는 건 낭비다');
  ok(/why = await r\.text\(\)/.test(src), '거절 이유를 본문에서 가져온다');
  ok(/r\.why \? '\(' \+ String\(r\.why\)\.slice\(0, 60\) \+ '\)'/.test(src),
     '거절 이유가 note 에 실린다 (403 만 남던 문제)');
  ok(/async function refusalStreaks\(labels\)/.test(src), '연속 거절을 세는 함수가 있다');
  ok(/\.from\('cron_runs'\)\.select\('note'\)/.test(src) && !/create table/i.test(src),
     '새 표를 만들지 않고 이미 있는 cron_runs 기록만 읽는다');
  ok(/if \(!txt\) continue;/.test(src),
     '빈 note 는 건너뛴다 — 지금 실행의 행이 맨 위에 있고 note 가 아직 비어 있다');
  ok(/note 는 비어 있다\) 끝날 때 note 를 채운다/.test(src), '왜 건너뛰는지 적혀 있다');
  ok(/INDEXNOW_REFUSE_ALERT_DAYS \|\| 3/.test(src), '기본 경보 문턱 3회');
  ok(/streaks\[L\] \+ 1 >= REFUSE_ALERT_DAYS/.test(src), '이번 실행까지 합쳐 센다');
  ok(/refused\.length \? await refusalStreaks\(refused\) : \{\}/.test(src),
     '거절이 없으면 과거를 뒤지지 않는다');
  ok(/스트릭을 못 세도 제출 자체는 끝났다/.test(src),
     '스트릭 조회가 실패해도 제출을 실패로 만들지 않는다');
  ok(/alarmTxt = alarm\.length \? ' · ⚠ '/.test(src), '경보는 note 에 ⚠ 로 붙는다');

  /* 정규식 검사만으로는 '세는 로직' 이 맞는지 알 수 없다. 같은 알고리즘을
     여기 복제해 실제로 세어 본다. 원본이 바뀌면 위 정규식이 먼저 깨진다. */
  function streakOf(notes, label) {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(\\S+)');
    let n = 0;
    for (const txt of notes) {
      if (!txt) continue;
      const m = re.exec(txt);
      if (!m) break;
      if (m[1] === '200' || m[1] === '202') break;
      n++;
    }
    return n;
  }
  ok(streakOf(['', 'recent: 283건 · 네이버 403 · 빙 200', 'recent: 163건 · 네이버 200 · 빙 200'], '네이버') === 1,
     '지금 실행(빈 note) + 403 1회 + 그전 200 → 1 (실제 9/15 상황)');
  ok(streakOf(['', 'a 네이버 403 · 빙 200', 'b 네이버 403 · 빙 200', 'c 네이버 403 · 빙 200', 'd 네이버 200'], '네이버') === 3,
     '3회 연속 거절 → 3');
  ok(streakOf(['', 'a 네이버 403 · 빙 200', 'b 네이버 403 · 빙 200'], '빙') === 0,
     '거절하지 않은 엔드포인트는 0');
  ok(streakOf(['x 네이버 202'], '네이버') === 0, '202 는 수락이라 0');
  ok(streakOf([], '네이버') === 0, '기록이 아예 없으면 0');
  ok(streakOf(['a 네이버 403', 'b 빙 200', 'c 네이버 403'], '네이버') === 1,
     '그 실행 기록에 라벨이 없으면 거기서 멈춘다 (건너뛰고 이어 세지 않는다)');

  console.log(`\npassed: ${pass} failed: ${fail}`);
  if (fail) process.exit(1);
  console.log('✅ indexnow-guard tests passed');
})();
