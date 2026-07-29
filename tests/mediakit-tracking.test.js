/**
 * 미디어킷 계측 회귀 (2026-07-29, 도메니코 요청).
 *
 * 배경: 미디어킷이 구글 드라이브 직링크라 인스타 바이오에서 우리 사이트를
 * 거치지 않고 바로 드라이브로 갔다. 드라이브는 통계를 주지 않으므로 다운로드
 * 수·시점·유입원이 전부 미측정. 이건 광고주 퍼널에서 유일하게 관측 가능한
 * 전환점(인스타를 본 사람이 매체 검토로 움직인 순간)이라 계측이 필요하다.
 *
 * 설계는 검증된 api/ig-out.js 를 따른다. 다른 점은 src 를 화이트리스트로 막지
 * 않는다는 것 — 게시물별 추적(ig_post_<shortcode>)이 목적이라 화이트리스트를
 * 두면 전부 'other' 로 뭉개져 정작 알고 싶은 것을 못 본다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d){ if(cond){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

const src = R('api/mediakit.js');
const vj = JSON.parse(R('vercel.json'));
const biz = R('frontend/business.html');
const contact = R('frontend/contact.html');

console.log('\n=== 라우팅 ===');
t('/mediakit → /api/mediakit 등록',
  vj.rewrites.some(r => r.source === '/mediakit' && r.destination === '/api/mediakit'));
/* 2026-07-29 라이브 실측: lang 은 들어오는데 src 가 계속 비어 'other' 로 기록됐다.
 * 원인은 확정하지 못했지만, 이 링크는 인스타·페북·메신저를 거쳐 유통될 물건이고
 * 그 경로에서 추적성 쿼리가 지워지거나 재작성되는 일은 흔하다(도메니코가 보낸
 * 드라이브 링크에도 fbclid 가 붙어 있었다). 경로 세그먼트는 중간 매개체가
 * 건드리지 않으므로 경로형을 1순위로 둔다. */
t('경로형 라우트 2종 등록 (쿼리 유실 대비)',
  vj.rewrites.some(r => r.source === '/mediakit/:lang(ko|en)/:src') &&
  vj.rewrites.some(r => r.source === '/mediakit/:src'));
t('경로형이 /mediakit 단독보다 앞 (더 구체적인 규칙 우선)',
  vj.rewrites.findIndex(r => r.source === '/mediakit/:src') <
  vj.rewrites.findIndex(r => r.source === '/mediakit'));
(function () {
  const mk = vj.rewrites.findIndex(r => r.source === '/mediakit');
  const catchAll = vj.rewrites.findIndex(r => String(r.source).startsWith('/:slug'));
  t('캐치올(/:slug)보다 앞 — 에디토리얼 SSR 이 먼저 잡지 않는다', mk >= 0 && catchAll >= 0 && mk < catchAll);
})();

console.log('=== 오픈 리다이렉터 방지 ===');
t('쿼리로 받은 URL 을 목적지로 쓰지 않는다', !/req\.query\.(url|dest|to)/.test(src),
  'url 파라미터를 그대로 리다이렉트하면 피싱 도구가 된다');
t('관리자 저장 링크도 https + 허용 호스트만', /ALLOWED_HOSTS/.test(src) && /u\.protocol !== 'https:'/.test(src));

console.log('=== 봇·레이트리밋 (ig-out 과 동일 방침) ===');
t('레이트리밋 적용', /rateLimitStrict\(req, res, \{ limit: 60/.test(src));
t('두 판별기 OR 로 봇 차단', /isLikelyBot\(ua\) \|\| isBot\(ua\)/.test(src));
t('로그 실패는 삼킨다 (리다이렉트는 항상 완료)', /catch \(e\) \{[\s\S]{0,120}console\.warn\('\[mediakit\] insert threw/.test(src));

console.log('=== 호출부가 계측을 경유 ===');
t('business.html 이 /mediakit 경유', /\/mediakit\?lang='\+l\+'&src=business/.test(biz));
t('contact.html 이 /mediakit 경유', /\/mediakit\?lang='\+l\+'&src=contact/.test(contact));
t('드라이브 직링크 window.open 제거', !/window\.open\('https:\/\/drive\.google\.com/.test(biz) && !/window\.open\('https:\/\/drive\.google\.com/.test(contact));

console.log('=== 동작 실측 (가짜 supabase) ===');
(function () {
  let inserted = null, redirected = null;
  const orig = Module._load;
  Module._load = function (req) {
    const r = String(req);
    if (r.endsWith('_lib/supabase')) return { supabaseAdmin: { from(tb) { return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      insert: (row) => { inserted = { tb, row }; return Promise.resolve({ error: null }); } }; } } };
    if (r.endsWith('_lib/rateLimit')) return { rateLimitStrict: async () => false };
    if (r.endsWith('_lib/clickGuard')) return { extractClientIp: () => '1.2.3.4', hashIp: () => 'h',
      detectDeviceType: () => 'mobile', sanitizeReferrer: (x) => x || null, isLikelyBot: (ua) => /bot/i.test(ua || '') };
    if (r.endsWith('_lib/botDetect')) return { isBot: (ua) => /crawler/i.test(ua || '') };
    return orig.apply(this, arguments);
  };
  const handler = require('../api/mediakit.js');
  Module._load = orig;

  const req = (q, ua, url) => ({ method: 'GET', url: url || '/mediakit', query: q,
    headers: { 'user-agent': ua || 'Mozilla/5.0 iPhone' } });
  const res = () => ({ setHeader(){}, redirect(c, u){ redirected = { c, u }; }, status(){ return this; }, send(){} });

  return (async () => {
    await handler(req({ lang: 'ko', src: 'ig_bio' }), res());
    t('ko → 한글판 드라이브 302', redirected.c === 302 && redirected.u.includes('1gUeTUJrg'));
    t('mediakit_downloads 에 기록', inserted && inserted.tb === 'mediakit_downloads' && inserted.row.lang === 'ko' && inserted.row.src === 'ig_bio');

    inserted = null;
    await handler(req({ lang: 'en', src: 'IG_post_DVyq0eF!!<script>' }), res());
    t('en → 영문판 드라이브', redirected.u.includes('1gVKLuOP'));
    // 게시물별 추적(ig_post_<shortcode>)은 살리되 위험문자는 제거된다.
    // 남는 문자는 [a-z0-9_-] 뿐이라 SQL·HTML 어느 쪽으로도 새지 않는다.
    t('src 정규화 — 소문자 + [a-z0-9_-] 만', inserted.row.src === 'ig_post_dvyq0efscript');

    inserted = null;
    await handler(req({ lang: 'en', src: 'a'.repeat(80) }), res());
    t('src 길이 40자 상한', inserted.row.src.length === 40);

    inserted = null;
    await handler(req({ lang: 'ko' }, 'Googlebot/2.1'), res());
    t('봇은 리다이렉트만, 로그 없음', inserted === null && redirected.u.includes('1gUeTUJrg'));

    inserted = null;
    await handler(req({}), res());
    t('lang 누락 시 en 폴백 · src 는 other', redirected.u.includes('1gVKLuOP') && inserted.row.src === 'other');

    // 경로형 — 쿼리가 통째로 지워져도 귀속이 살아있어야 한다
    inserted = null;
    await handler(req({}, null, '/mediakit/ko/ig_bio'), res());
    t('경로 /mediakit/ko/ig_bio → ko + ig_bio',
      inserted.row.lang === 'ko' && inserted.row.src === 'ig_bio' && redirected.u.includes('1gUeTUJrg'));

    inserted = null;
    await handler(req({}, null, '/mediakit/ig_post_dvyq0ef'), res());
    t('경로 /mediakit/<src> → en 기본 + 게시물 귀속',
      inserted.row.lang === 'en' && inserted.row.src === 'ig_post_dvyq0ef');

    inserted = null;
    await handler(req({ src: 'zzz' }, null, '/mediakit/ko/ig_bio?src=zzz'), res());
    t('경로가 쿼리보다 우선', inserted.row.src === 'ig_bio');

    console.log(`\npassed: ${pass}   failed: ${fail}`);
    if (fail) { console.log('❌ mediakit-tracking tests FAILED'); process.exit(1); }
    console.log('✅ mediakit-tracking tests passed');
  })();
})();
