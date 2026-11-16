/**
 * 미디어킷 링크 점검 (2026-11-16)
 * ─────────────────────────────────────────────────────────────────────
 * 사고 기록: 사이트가 가리키던 미디어킷 파일 두 개가 구글 드라이브 휴지통에 있었다.
 *   · KO 1wjL9Qe… "[PAP] 미디어키트 2026_09.pdf" (8/24)
 *   · EN 1rjZPyD… "2026 MEDIA KIT (ENG)_ May_2026.pdf" (7/29)
 * 도메니코가 새 키트를 올리고 옛 파일을 휴지통에 넣었는데, 드라이브는 파일을 교체하면
 * ID 가 바뀌므로 사이트가 따라가지 못했다. 소유자는 로그인 상태라 휴지통 파일도 그냥
 * 열려서 "옛 키트가 뜬다" 로만 보였고, 광고주에게는 오류가 떴다. 7/29 에도 같은
 * 사고였고 그때는 주석만 남겼다 — 주석은 재발을 막지 못했다.
 *
 * 이 파일이 지키는 것
 *  ① 드라이브 뷰어가 **200 으로 돌려주는 오류**를 잡는다. 상태 코드만 보면 못 잡는다.
 *  ② 네트워크 실패를 '죽음' 으로 읽지 않는다 — 한 번의 실패로 경보를 울리면 경보가
 *     싫어지고, 싫어진 경보는 진짜 고장도 묻는다.
 *  ③ 전부 멀쩡하면 알리지 않는다 (매일 오는 '정상' 알림은 곧 안 읽는다).
 *  ④ 설정과 코드 폴백을 **둘 다** 본다. 두 번의 사고 모두 둘이 함께 썩었다.
 *  ⑤ 크론 계약: res.locals 선생성 · 예약 호출만 · vercel.json 등록.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = (f) => path.join(ROOT, f);
const R = (f) => fs.readFileSync(P(f), 'utf8');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'x';
process.env.SUPABASE_SERVICE_KEY = 'x';
process.env.CRON_SECRET = 'test-secret';

let telegram = [];
let settings = {
  mediakit_link_ko: 'https://drive.google.com/file/d/KO_LIVE/view?usp=sharing',
  mediakit_link_en: 'https://drive.google.com/file/d/EN_LIVE/view?usp=sharing',
};

require.cache[require.resolve(P('api/_lib/cors.js'))] = {
  id: require.resolve(P('api/_lib/cors.js')), loaded: true,
  exports: { handleCors: () => false },
};
require.cache[require.resolve(P('api/_lib/telegram.js'))] = {
  id: require.resolve(P('api/_lib/telegram.js')), loaded: true,
  exports: { sendTextToTelegramSafe: async (m) => { telegram.push(String(m)); return true; } },
};
require.cache[require.resolve(P('api/_lib/cronGuard.js'))] = {
  id: require.resolve(P('api/_lib/cronGuard.js')), loaded: true,
  exports: { withCronGuard: (_n, fn) => fn },   // 가드 자체는 cron-contract 가 본다
};
require.cache[require.resolve(P('api/_lib/supabase.js'))] = {
  id: require.resolve(P('api/_lib/supabase.js')), loaded: true,
  exports: {
    supabaseAdmin: {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: { value: settings }, error: null }),
      }),
    },
  },
};

/* 바깥으로 나가지 않는다 — URL 별로 정해 둔 답을 돌려준다 */
const RESPONSES = {};
global.fetch = async (url) => {
  const r = RESPONSES[String(url)] || { status: 200, type: 'application/pdf', body: '' };
  if (r.throw) throw new Error(r.throw);
  return {
    status: r.status,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? (r.type || '') : null) },
    text: async () => r.body || '',
  };
};

const handler = require(P('api/cron/mediakit-link-watch.js'));
const { probe } = handler;

function mkRes() {
  const r = { code: 0, body: null, locals: undefined };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function run(auth) {
  telegram = [];
  const res = mkRes();
  await handler({ method: 'GET', headers: { authorization: auth === undefined ? 'Bearer test-secret' : auth } }, res);
  return res;
}

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); } }

(async () => {
  console.log('=== 1. probe: 드라이브는 오류도 200 으로 준다 ===');
  {
    const U = 'https://drive.google.com/file/d/X/view';
    RESPONSES[U] = { status: 200, type: 'text/html', body: '<html>이 파일은 소유자의 휴지통에 있습니다</html>' };
    t('200 + 휴지통 문구 → 죽음', (await probe(U)).ok === false);
    RESPONSES[U] = { status: 200, type: 'text/html', body: '<html>Sorry, unable to open the file at this time.</html>' };
    t('200 + 영문 오류 문구 → 죽음', (await probe(U)).ok === false);
    RESPONSES[U] = { status: 200, type: 'text/html', body: '<html>You need access</html>' };
    t('200 + 권한 요청 → 죽음 (권한을 바꿔도 광고주는 못 본다)', (await probe(U)).ok === false);
    RESPONSES[U] = { status: 200, type: 'text/html', body: '<html><title>[PAP] 미디어키트2026_11.pdf</title></html>' };
    t('200 + 평범한 뷰어 → 살아 있음', (await probe(U)).ok === true);
    RESPONSES[U] = { status: 200, type: 'application/pdf', body: '%PDF-1.4' };
    t('PDF 바이트 → 살아 있음', (await probe(U)).ok === true);
    RESPONSES[U] = { status: 404 };
    t('404 → 죽음', (await probe(U)).ok === false);
    RESPONSES[U] = { status: 403 };
    t('403 → 죽음', (await probe(U)).ok === false);
  }

  console.log('\n=== 2. 모르는 건 모른다고 한다 ===');
  {
    const U = 'https://drive.google.com/file/d/Y/view';
    RESPONSES[U] = { throw: 'network down' };
    const r = await probe(U);
    /* 네트워크 한 번 끊겼다고 "미디어킷이 죽었다" 고 외치면, 그 경보는 곧 무시된다 */
    t('네트워크 실패 → 보류(null), 죽음이 아니다', r.ok === null, JSON.stringify(r));
    RESPONSES[U] = { status: 503 };
    t('503 → 보류(저쪽 장애)', (await probe(U)).ok === null);
    t('빈 링크 → 죽음 (설정이 비어 있으면 버튼이 아무 데도 안 간다)', (await probe('')).ok === false);
  }

  console.log('\n=== 3. 핸들러: 죽으면 알리고, 멀쩡하면 조용하다 ===');
  {
    const KO = 'https://drive.google.com/file/d/KO_LIVE/view?usp=sharing';
    const EN = 'https://drive.google.com/file/d/EN_LIVE/view?usp=sharing';
    RESPONSES[KO] = { status: 200, type: 'application/pdf' };
    RESPONSES[EN] = { status: 200, type: 'application/pdf' };
    const r = await run();
    t('전부 정상 → 200', r.code === 200, JSON.stringify(r.body));
    t('전부 정상이면 텔레그램을 보내지 않는다', telegram.length === 0, telegram.join(' | '));
    t('cronNote 는 남긴다 (조용하지만 기록은 된다)', /정상/.test(String(r.locals && r.locals.cronNote)), r.locals && r.locals.cronNote);

    RESPONSES[KO] = { status: 200, type: 'text/html', body: '소유자의 휴지통' };
    const r2 = await run();
    t('하나라도 죽으면 텔레그램', telegram.length === 1, telegram.join(' | '));
    t('어느 것이 왜 죽었는지 적는다', /공유용 드라이브 KO/.test(telegram[0] || ''), telegram[0]);
    /* 고치는 곳이 두 군데라 매번 한쪽만 고쳐 왔다. 알림이 둘 다 말해 준다. */
    t('고쳐야 할 두 곳을 함께 알려준다',
      /어드민/.test(telegram[0] || '') && /DEFAULT_LINKS/.test(telegram[0] || ''));
    t('소유자에게는 멀쩡해 보인다는 함정을 알려준다', /로그인 상태/.test(telegram[0] || ''));
    t('응답 body 에 죽은 목록이 담긴다', r2.body && r2.body.dead && r2.body.dead.length >= 1, JSON.stringify(r2.body));
  }

  console.log('\n=== 4. 설정과 코드 폴백을 둘 다 본다 ===');
  {
    const src = R('api/cron/mediakit-link-watch.js');
    t('설정(site_settings.business_page)을 읽는다', /business_page/.test(src));
    t('코드 폴백(DEFAULT_LINKS)도 읽는다', /DEFAULT_LINKS/.test(src));
    t('mediakit.js 가 폴백을 내보낸다', /module\.exports\.DEFAULT_LINKS/.test(R('api/mediakit.js')));
    t('공개 정적 PDF 도 본다 (AI 검색이 읽는 파일)', /media-kit\/PAP-Magazine-Media-Kit-2026-KO\.pdf/.test(src));
    /* 설정과 폴백이 같은 값이면 한 번만 열어 본다 — 같은 URL 을 두 번 때릴 이유가 없다 */
    t('같은 URL 은 한 번만 연다', /seen\.has\(t\.url\)/.test(src));
  }

  console.log('\n=== 5. 크론 계약 ===');
  {
    const src = R('api/cron/mediakit-link-watch.js');
    t('res.locals 를 먼저 만든다 (2026-08-13 사고)', /res\.locals = res\.locals \|\| \{\};/.test(src));
    t('withCronGuard 로 감싼다', /withCronGuard\('mediakit-link-watch'/.test(src));
    const r = await run('Bearer wrong');
    t('예약 호출이 아니면 401 (외부 호출이 있는 크론)', r.code === 401, r.code);
    const cfg = JSON.parse(R('vercel.json'));
    t('vercel.json 에 등록됐다',
      (cfg.crons || []).some((c) => c.path === '/api/cron/mediakit-link-watch'));
    t('하루 한 번이다', (cfg.crons || []).some((c) => c.path === '/api/cron/mediakit-link-watch'
      && /^\d+ \d+ \* \* \*$/.test(c.schedule)));
  }

  console.log('\n=== 6. 지금 걸린 링크가 새 파일인가 ===');
  {
    /* 사고 당시의 죽은 ID 가 코드에 남아 있으면 안 된다 */
    const mk = R('api/mediakit.js');
    t('휴지통 ID(KO 1wjL9Qe · EN 1rjZPyD)가 코드에 없다',
      !/1wjL9Qezq5bdgQl15lyftg2bn3hB4Gs6-/.test(mk) && !/1rjZPyD5wy_amn_OMhlysuUJiN_zb_nBY/.test(mk));
    t('새 KO·EN 파일을 가리킨다',
      /1dAV7cMwsDOuyLucU_ponpLxwwuJmxCuf/.test(mk) && /1SXhmU1FDYvnXqVuv_sqylJvqyKT_ImE1/.test(mk));
  }

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ mediakit-link-watch tests FAILED'); process.exit(1); }
  console.log('✅ mediakit-link-watch tests passed');
  /* api/mediakit.js 가 끌어오는 rateLimit 등이 정리 타이머를 들고 있어 그냥 두면
     프로세스가 끝나지 않는다(npm test 가 거기서 멈춘다). 저장소의 다른 테스트와
     같이 명시적으로 끝낸다. */
  process.exit(0);
})();
