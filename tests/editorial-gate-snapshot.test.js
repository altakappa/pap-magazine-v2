/**
 * 열람 게이트 구멍 회귀 (2026-09-16, 도메니코 제보 "비회원도 프리뷰가 아니라 전체 볼 수 있던데").
 *
 * 서버(/api/editorials/:id)·SSR 은 8/21·8/27 게이트대로 잠갔는데, 홈 SPA 가 먼저 읽는 정적 스냅샷
 * data/editorial-details.json(2026-04) 에 1,996편의 전체 이미지가 들어 있었다. 이미지·크레딧이 있으면
 * 상세 API 를 안 부르므로(_needsHydrate=false) 스냅샷 화보는 등급과 무관하게 전부 보였다 —
 * 프리미엄 전용 아카이브 2,060편이 비회원에게 열려 있었다.
 *
 * 지키는 것:
 *   ① 스냅샷에는 화보당 이미지 1장(표지)만 남는다 — 갤러리는 상세 API 만 내준다.
 *   ② SPA 는 id 가 있는 화보를 한 번은 반드시 상세 API 로 판정받는다(_gateChecked).
 *   ③ 잠긴 화보는 서버가 준 이미지 목록으로 통째로 바꾼다(스냅샷 이미지 잔존 금지).
 *   ④ 캐시버스트: 스냅샷 v=3, pap-content-editorial.js / pap-content-api-sync.js 버전이 HTML 10개에서 일치.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', String(d).slice(0, 300)); } }

console.log('\n=== ① 정적 스냅샷은 표지 1장만 ===');
const snap = JSON.parse(R('frontend/data/editorial-details.json'));
const keys = Object.keys(snap);
const over = keys.filter((k) => Array.isArray(snap[k].images) && snap[k].images.length > 1);
t('스냅샷 항목이 있다 (' + keys.length + ')', keys.length > 2000);
t('이미지 2장 이상인 항목 0 (갤러리는 상세 API 만)', over.length === 0, over.slice(0, 5).join(', '));
t('표지·크레딧·이슈는 그대로 남아 있다', keys.every((k) => snap[k].thumb !== undefined && snap[k].credits !== undefined && snap[k].issue !== undefined));

console.log('\n=== ② ③ SPA 가 반드시 서버 판정을 받는다 ===');
const ed = R('frontend/pap-content-editorial.js');
t('_needsHydrate 가 d._gateChecked 를 본다 (_edDetC 는 아래에서 선언되므로 쓰면 안 된다)', /var _needsHydrate = !d\._gateChecked \|\| \(_imgs <= 1\)/.test(ed) && !/!_edDetC\._gateChecked/.test(ed));
t('하이드레이트는 id 가 있을 때 상세 API 로 나간다', /if\(\(_needsHydrate \|\| _edNeedTr \|\| _edNeedIg\) && d\.id\)\{[\s\S]{0,400}fetch\('\/api\/editorials\/' \+ encodeURIComponent\(d\.id\)/.test(ed));
t('잠겼으면 서버 목록으로 통째로 교체', /if\(dstLocked\)\{\s*dst\.images = Array\.isArray\(full\.gallery\) \? full\.gallery\.slice\(\) : \[\];/.test(ed));
t('응답 후 _gateChecked = true (재요청 루프 방지)', /dst\._gateChecked = true;/.test(ed));
t('잠금 판정은 서버의 images.locked', /var dstLocked = _img \? !!_img\.locked/.test(ed));

console.log('\n=== ②-b 하이드레이트 판정 블록을 실제로 실행한다 (2026-09-17 사고: 선언 전 변수 참조로 try 가 삼킴) ===');
/* 어제 커밋이 `_edDetC._gateChecked` 를 _edDetC 선언(4줄 아래) 전에 읽었다. TypeError 를 감싼 try/catch 가 조용히
   먹어서 하이드레이트가 한 번도 안 나갔고, 프리미엄·관리자까지 스냅샷 표지 1장만 봤다. 정규식은 "글자가 있다"만
   확인한다 — 이 블록은 실제로 돌려서 예외 없이 값이 나오는지 본다. */
(function () {
  const a = ed.indexOf('  try {\n    var _imgs = Array.isArray(d.images)');
  const b = ed.indexOf('    if((_needsHydrate || _edNeedTr || _edNeedIg) && d.id){');
  t('판정 블록의 시작·끝을 찾았다', a > 0 && b > a);
  if (a > 0 && b > a) {
    const body = 'var title="X"; var d=edDetails[title]; ' + ed.slice(a + 8, b) + ' return { h: _needsHydrate, tr: _edNeedTr, ig: _edNeedIg };';
    const g = { window: {}, document: { getElementById: () => null }, localStorage: { getItem: () => null } };
    const run = (det) => new Function('window', 'document', 'localStorage', 'edDetails', body)(g.window, g.document, g.localStorage, { X: det });
    let r1 = null, r2 = null, err = null;
    try {
      r1 = run({ id: '1', images: ['a'], credits: [{ r: 1 }], desc: { ko: 'x' }, _igChecked: true });
      r2 = run({ id: '1', images: ['a', 'b', 'c'], galleryCount: 3, credits: [{ r: 1 }], desc: { ko: 'x' }, _igChecked: true, _gateChecked: true });
    } catch (e) { err = e; }
    t('블록이 예외 없이 실행된다 (선언 전 참조 없음)', !err, err && err.message);
    t('서버 판정 전(_gateChecked 없음)이면 이미지·크레딧이 있어도 하이드레이트', !!(r1 && r1.h === true));
    t('서버 판정 후 + 이미지 전부면 다시 안 부른다', !!(r2 && r2.h === false));
  }
})();

console.log('\n=== ④ 캐시버스트 ===');
const sync = R('frontend/pap-content-api-sync.js');
t('스냅샷 v=3 (api-sync · v5.html)', /editorial-details\.json\?v=3/.test(sync) && /editorial-details\.json\?v=3/.test(R('frontend/pap-magazine-v5.html')) && !/editorial-details\.json\?v=2/.test(sync));
const htmls = fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => f.endsWith('.html'));
const edV = new Set(), syV = new Set();
for (const h of htmls) {
  const s = R('frontend/' + h);
  (s.match(/pap-content-editorial\.js\?v=(\d+)/g) || []).forEach((m) => edV.add(m));
  (s.match(/pap-content-api-sync\.js\?v=(\d+)/g) || []).forEach((m) => syV.add(m));
}
t('pap-content-editorial.js 버전이 HTML 전체에서 하나 (≥87)', edV.size === 1 && Number([...edV][0].split('=')[1]) >= 87, [...edV].join(','));
t('pap-content-api-sync.js 버전이 HTML 전체에서 하나 (≥127)', syV.size === 1 && Number([...syV][0].split('=')[1]) >= 127, [...syV].join(','));

console.log('\n=== ⑤ 상단 가입 안내 (2026-09-16 도메니코: "유료 회원 가입 시 더 많은 이미지를 볼 수 있다는 문구") ===');
const seo = R('api/_lib/seoRenderer.js');
t('SSR: GALLERY_LOCK_T 에 topFree·topPaid 9개 언어', (seo.match(/topFree: '/g) || []).length === 9 && (seo.match(/topPaid: '/g) || []).length === 9);
t('SSR: 에디토리얼이 잠겼을 때만 제목 아래에 .seo-top-note (등급별 href: free→/auth, 그 밖→/subscribe)', /\(kind === 'editorial' && galleryLocked\) \? \(\(\) => \{[\s\S]{0,600}editorial_top_note[\s\S]{0,300}class="seo-top-note"/.test(seo) && /\.seo-top-note\{display:block/.test(seo));
t('SPA: _papEdTopNoteHtml 은 det.locked 일 때만, 등급별 문구·링크', /function _papEdTopNoteHtml\(det\)\{\s*if\(!det \|\| !det\.locked\) return '';/.test(ed) && /회원 가입 시 전체 이미지를 볼 수 있습니다/.test(ed) && /유료 멤버십 가입 시 더 많은 이미지를 볼 수 있습니다/.test(ed) && /editorial_top_note/.test(ed));
t('SPA: 두 열기 경로(push·popstate) 모두 IG 버튼 옆에 붙인다', (ed.match(/\+ _papEdTopNoteHtml\(det\);/g) || []).length === 2);
const LANGS = ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
t('_shared 사전 8개 언어에 두 문구', LANGS.every((l) => { const d = JSON.parse(R('frontend/i18n/ui/_shared.' + l + '.json')); return d['회원 가입 시 전체 이미지를 볼 수 있습니다'] && d['유료 멤버십 가입 시 더 많은 이미지를 볼 수 있습니다']; }));
t('캐시버스트: index data-v ≥ 7 · editorial.js ≥ 87', /content="index" data-v="([7-9]|\d{2,})"/.test(R('frontend/index.html')) && (function(){ const m = R('frontend/index.html').match(/pap-content-editorial\.js\?v=(\d+)/); return m && Number(m[1]) >= 87; })());

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ editorial-gate-snapshot FAILED'); process.exit(1); }
console.log('✅ editorial-gate-snapshot passed');
