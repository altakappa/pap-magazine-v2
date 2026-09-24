'use strict';
/**
 * 공동작업자 지정 → 텔레그램 (인스타그램용 이미지 + 크레딧) · 설명 보강 (도메니코 2026-09-24)
 *   "공동작업자 지정시 반드시 텔레그램으로 인스타그램용 이미지와 크레딧과 함께 나에게 알려줘."
 *   "지정되려면 PAP 회원으로 가입돼 있어야 하는 점을 표시해줘."
 *   "연간 프리미엄 가입자는 제출 후 편집으로도 공동작업자 수정이 가능하다는 걸 알려줘."
 *
 *  1. collabCreditText: 크레딧·Starring·Fashion by·Collaborators 를 복사용으로 (실행)
 *  2. collabImageUrls: 제출자가 고른 커버가 첫 장, 중복 제거, 20장 상한 (실행)
 *  3. collaboratorsChanged: 순서·대소문자·@ 무시 (실행)
 *  4. sendCollabImages: 테스트 실행 중에는 절대 보내지 않는다 (실행)
 *  5. dispatchCollabImages: waitUntil 로 워커를 Bearer CRON_SECRET 으로 깨움 / 시크릿 없으면 이미지 생략 (실행)
 *  6. 워커 api/submissions/collab-telegram.js: 인증·404·공동작업자 없음 skip (require 스텁 실행)
 *  7. vercel.json: 워커 maxDuration 300
 *  8. 화면 설명: 폼(가입 필요·제출 후 수정)·마이페이지·구독 페이지 9개 언어
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

(async () => {
  const CT = require('../api/_lib/collabTelegram');

  console.log('=== 1. collabCreditText ===');
  {
    const desc = {
      team: [
        { role: 'Photographer', name: 'A', instagram: '@kamo06167' },
        { role: 'Stylist', name: 'A', instagram: 'kamo06167' },
        { role: 'MUAH', name: 'B', instagram: 'https://instagram.com/muah_b/' },
        { role: 'Retoucher', name: 'C', instagram: '' },
      ],
      models: [{ name: 'M', instagram: 'model_m', agencyInstagram: '@agency_x' }],
      looks: [{ n: 1, items: [{ brand: 'Mincrisot', instagram: '@mincrisot' }, { brand: 'X', instagram: 'mincrisot' }] }, { n: 2, items: [{ brand: 'Y', instagram: 'brand_y' }] }],
    };
    const txt = CT.collabCreditText({ title: 'Modern Tears' }, desc, [{ handle: 'prem' }, 'free_one']);
    t('첫 줄: 제목 + exclusive for @pap_magazine', /^'Modern Tears' exclusive for @pap_magazine/.test(txt), txt);
    t('같은 인스타그램의 여러 역할은 한 줄로 (Photographer & Stylist @kamo06167)', /Photographer & Stylist @kamo06167/.test(txt), txt);
    t('URL 핸들도 @ 로 정규화', /@muah_b/.test(txt));
    t('인스타그램 없는 크레딧은 뺀다', !/Retouch/.test(txt));
    t('Starring @model @agency', /Starring @model_m @agency_x/.test(txt));
    t('Fashion by: 브랜드 중복 제거', /Fashion by @mincrisot @brand_y$/m.test(txt));
    t('Collaborators @prem @free_one', /Collaborators @prem @free_one/.test(txt));
    t('머리말(🤝 등) 없이 크레딧만 — 그대로 복사해 쓴다', !/🤝|submission=/.test(txt));
  }

  console.log('\n=== 2. collabImageUrls ===');
  {
    const urls = Array.from({ length: 25 }, (_, i) => 'https://x/s/' + i + '.jpg');
    let r = CT.collabImageUrls({ file_urls: urls }, { coverImageIndex: 3 });
    t('커버(3번)가 첫 장, 나머지는 순서대로', r[0] === urls[3] && r[1] === urls[0] && r[4] === urls[4], r.slice(0, 5).join(','));
    t('20장 상한 (인스타그램 캐러셀)', r.length === 20 && CT.IG_MAX_IMAGES === 20);
    r = CT.collabImageUrls({ file_urls: ['https://x/a.jpg', 'https://x/a.jpg', 'ftp://x', 'https://x/b.jpg'] }, { coverImageIndex: 99 });
    t('잘못된 커버 번호 → 첫 장, 중복·비 http 제거', r.join(',') === 'https://x/a.jpg,https://x/b.jpg', r.join(','));
    t('파일 없으면 빈 배열', CT.collabImageUrls({}, {}).length === 0);
  }

  console.log('\n=== 3. collaboratorsChanged ===');
  t('순서·대소문자·@ 무시 → 안 바뀜', CT.collaboratorsChanged([{ handle: 'a' }, { handle: 'B' }], ['@b', { handle: 'a' }]) === false);
  t('한 명 추가 → 바뀜', CT.collaboratorsChanged([{ handle: 'a' }], [{ handle: 'a' }, { handle: 'c' }]) === true);
  t('없음 → 있음 → 바뀜', CT.collaboratorsChanged(undefined, [{ handle: 'a' }]) === true);

  console.log('\n=== 4. sendCollabImages 는 테스트 중에 보내지 않는다 ===');
  {
    let fetched = 0; const of = global.fetch; global.fetch = async () => { fetched++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({ ok: true }) }; };
    const r = await CT.sendCollabImages({ id: 's', title: 'T', file_urls: ['https://x/a.jpg'] }, { collaborators: [{ handle: 'a' }] });
    global.fetch = of;
    t('skipped: test_run, 네트워크 0회', r && r.skipped === 'test_run' && fetched === 0, JSON.stringify(r));
  }

  console.log('\n=== 5. dispatchCollabImages ===');
  {
    const calls = [], wu = [];
    const of = global.fetch; global.fetch = (url, o) => { calls.push({ url, o }); return Promise.resolve({ ok: true, status: 200 }); };
    const orig = Module.prototype.require;
    Module.prototype.require = function (n) { if (n === '@vercel/functions') return { waitUntil: (p) => wu.push(p) }; return orig.apply(this, arguments); };
    process.env.CRON_SECRET = 'sek';
    let r = await CT.dispatchCollabImages('11111111-1111-1111-1111-111111111111', 'resubmit');
    t('waitUntil 로 워커를 Bearer CRON_SECRET 으로 깨우고 즉시 반환', r.dispatched === 'waitUntil' && calls.length === 1 && wu.length === 1
      && /\/api\/submissions\/collab-telegram\?id=11111111-1111-1111-1111-111111111111&kind=resubmit$/.test(calls[0].url) && calls[0].o.headers.Authorization === 'Bearer sek', JSON.stringify({ r, calls }));
    calls.length = 0;
    delete process.env.CRON_SECRET;
    r = await CT.dispatchCollabImages('11111111-1111-1111-1111-111111111111', 'new');
    t('CRON_SECRET 없으면 이미지 생략 (요청 안에서 합성하지 않는다 — 504 방지)', r.dispatched === 'no_secret' && calls.length === 0);
    Module.prototype.require = orig; global.fetch = of;
  }

  console.log('\n=== 6. 워커 api/submissions/collab-telegram.js ===');
  {
    const stubs = {
      '../_lib/supabase': { supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: global.__row, error: global.__row ? null : { message: 'x' } }) }) }) }) } },
      '../_lib/cors': { handleCors: () => false },
      '../_lib/secretCompare': { safeEqual: (a, b) => a === b },
      '../_lib/auth': { requireAdmin: async (req, res) => { if (req.headers['x-admin']) return { id: 'u', email: 'a@b' }; res.status(403).json({ message: 'Admin access required' }); return null; } },
      '../_lib/collabTelegram': { sendCollabImages: async (sub, desc, o) => { global.__sent = { id: sub.id, kind: o.kind, n: (desc.collaborators || []).length }; return { sent: 5 }; } },
    };
    const orig = Module.prototype.require;
    Module.prototype.require = function (n) { if (Object.prototype.hasOwnProperty.call(stubs, n)) return stubs[n]; return orig.apply(this, arguments); };
    delete require.cache[require.resolve('../api/submissions/collab-telegram.js')];
    const handler = require('../api/submissions/collab-telegram.js');
    Module.prototype.require = orig;
    function res() { const o = { code: 0, body: null, status(c) { o.code = c; return o; }, json(b) { o.body = b; return o; } }; return o; }
    const ID = '22222222-2222-2222-2222-222222222222';
    process.env.CRON_SECRET = 'sek';
    global.__row = { id: ID, title: 'T', file_urls: ['https://x/a.jpg'], description: JSON.stringify({ collaborators: [{ handle: 'a' }, { handle: 'b' }] }) };
    let r = res(); global.__sent = null;
    await handler({ method: 'GET', headers: { authorization: 'Bearer sek' }, query: { id: ID, kind: 'resubmit' } }, r);
    t('Bearer CRON_SECRET → 전송, kind·공동작업자 수 전달, 200', r.code === 200 && global.__sent && global.__sent.kind === 'resubmit' && global.__sent.n === 2, JSON.stringify({ b: r.body, s: global.__sent }));
    r = res(); global.__sent = null;
    await handler({ method: 'GET', headers: { authorization: 'Bearer nope' }, query: { id: ID } }, r);
    t('잘못된 시크릿 + 관리자 아님 → 403, 전송 없음', r.code === 403 && global.__sent === null);
    r = res(); global.__sent = null;
    await handler({ method: 'GET', headers: { 'x-admin': '1' }, query: { id: ID } }, r);
    t('관리자 수동 재전송 → 200, kind=new', r.code === 200 && global.__sent && global.__sent.kind === 'new');
    global.__row = { id: ID, title: 'T', file_urls: [], description: JSON.stringify({}) };
    r = res(); global.__sent = null;
    await handler({ method: 'GET', headers: { authorization: 'Bearer sek' }, query: { id: ID } }, r);
    t('공동작업자 없으면 보내지 않는다 (skipped)', r.code === 200 && r.body.skipped === 'no_collaborators' && global.__sent === null);
    global.__row = null;
    r = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer sek' }, query: { id: ID } }, r);
    t('없는 서브미션 → 404', r.code === 404);
    r = res();
    await handler({ method: 'GET', headers: { authorization: 'Bearer sek' }, query: { id: 'x' } }, r);
    t('id 형식 아니면 400', r.code === 400);
    delete process.env.CRON_SECRET; delete global.__row; delete global.__sent;
  }

  console.log('\n=== 7. vercel.json ===');
  {
    const f = (JSON.parse(R('vercel.json')).functions) || {};
    t('워커 maxDuration 300 (정확한 파일명 키, 와일드카드보다 앞)', f['api/submissions/collab-telegram.js'] && f['api/submissions/collab-telegram.js'].maxDuration === 300
      && Object.keys(f).indexOf('api/submissions/collab-telegram.js') < Object.keys(f).indexOf('api/**/*.js'));
  }

  console.log('\n=== 8. 화면 설명 ===');
  {
    const html = R('frontend/submission.html');
    t('폼: 목록 아래 안내 블록(collabHints) — 가입 필요 · 제출 후 수정', /id="collabHints"/.test(html) && /data-i18n-html="collabMemberHint"/.test(html) && /data-i18n-html="collabEditHint"/.test(html));
    t('가입 필요 안내 9개 언어 + 가입 링크(utm_source=collab_invite)', (html.match(/collabMemberHint:'(?:[^'\\]|\\.)*auth\?mode=signup&utm_source=collab_invite/g) || []).length === 9);
    t('제출 후 수정 안내 9개 언어 (SUBMISSIONS 경로)', (html.match(/collabEditHint:'(?:[^'\\]|\\.)*SUBMISSIONS/g) || []).length === 9);
    t('연간 아님 안내에도 "제출 후 수정" 9개 언어', (html.match(/collabYearlyOnly:'(?:[^'\\]|\\.)*(심사가 끝나기 전까지|until the review is finished|bis zum Ende der Prüfung|finché la revisione|jusqu’à la fin de l’examen|hasta que termine la revisión|審査が終わるまで|审核结束前|пока идёт проверка)/g) || []).length === 9);
    t('게이트가 안내 블록도 같이 숨긴다', /var hints=document\.getElementById\('collabHints'\); if\(hints\) hints\.style\.display = open \? '' : 'none';/.test(html));
    t('회원 아님 경고가 가입 링크를 가리킨다 9개 언어', (html.match(/collabNotMember:'(?:[^'\\]|\\.)*(가입 링크|sign-up link|Registrierungslink|link di iscrizione|lien d’inscription|enlace de registro|登録リンク|注册链接|ссылку для регистрации)/g) || []).length === 9);
    t('가이드라인 혜택: 가입 필요 · 제출 후 수정 9개 언어', (html.match(/glAddBody:'(?:[^'\\]|\\.)*(연간 프리미엄|Yearly Premium|Jahres-Premium|Premium annuale|Premium annuel|Premium anual|年間プレミアム|年度高级会员|Годовой Premium)[^<]*(마이페이지|My Page|マイページ|我的页面)/g) || []).length === 9);
    const mp = R('frontend/mypage.html');
    t('마이페이지: 심사 중 수정 버튼 옆 "연간 프리미엄은 공동작업자도 수정" 안내 + 사전 8개 언어', /연간 프리미엄 회원은 심사가 끝나기 전까지 수정하기에서 인스타그램 공동작업자/.test(mp)
      && ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'].every((l) => JSON.parse(R('frontend/i18n/ui/mypage.' + l + '.json'))['연간 프리미엄 회원은 심사가 끝나기 전까지 수정하기에서 인스타그램 공동작업자(최대 5명, PAP 회원)도 바꿀 수 있습니다.']));
    const sb = R('frontend/subscribe.html');
    t('구독 페이지 혜택 목록: 무료 회원도 지정 가능 · 제출 후 수정 가능 (9개 언어 블록 + ru 중복)', (sb.match(/\{on:true, text:'[^']*(연간 프리미엄|Yearly Premium|Годовой Premium|Jahres-Premium|Premium annuale|Premium annuel|Premium anual|年間プレミアム|年度高级会员)[^']*(제출 후 수정|editable after|изменить после|nach dem Einreichen|modificabili dopo|modifiables après|editables tras|提出後も変更|提交后可修改)[^']*'\}/g) || []).length >= 9);
  }

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ collab-telegram FAILED'); process.exit(1); }
  console.log('✅ collab-telegram passed');
})();
