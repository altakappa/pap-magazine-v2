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
t('pap-content-editorial.js 버전이 HTML 전체에서 하나 (≥89)', edV.size === 1 && Number([...edV][0].split('=')[1]) >= 89, [...edV].join(','));
t('pap-content-api-sync.js 버전이 HTML 전체에서 하나 (≥127)', syV.size === 1 && Number([...syV][0].split('=')[1]) >= 127, [...syV].join(','));

console.log('\n=== ⑤ 상단 가입 안내 (2026-09-16 도메니코: "유료 회원 가입 시 더 많은 이미지를 볼 수 있다는 문구") ===');
const seo = R('api/_lib/seoRenderer.js');
t('SSR: GALLERY_LOCK_T 9개 언어에 headFree·headFreeBlocked·subFree(cut)·login·subStandard(cut)·subPremium(cut) (2026-09-21 문구 정직화)', ['headFree:', 'headFreeBlocked:', 'subFree: (c) =>', 'ctaFree: ', 'subStandard: (c) =>', 'subPremium: (c) =>'].every((k) => (seo.split(k).length - 1) === 9) && (seo.match(/ctaFree: (['"]).*?\1, login: '/g) || []).length === 9 && /ctaFree: '무료로 가입하고 보기', login: '이미 회원이면 로그인'/.test(seo));
t('SSR: 에디토리얼이 잠겼을 때만 제목 아래에 .seo-top-note (등급별 href: free→/auth, 그 밖→/subscribe)', /\(kind === 'editorial' && galleryLocked\) \? \(\(\) => \{[\s\S]{0,600}editorial_top_note[\s\S]{0,300}class="seo-top-note"/.test(seo) && /\.seo-top-note\{display:block/.test(seo));
t('SPA: _papEdTopNoteHtml 은 det.locked 일 때만, 화보 단위 문구(남은 장수·필요 등급)·링크', /function _papEdTopNoteHtml\(det\)\{\s*if\(!det \|\| !det\.locked\) return '';/.test(ed) && /가입하면 남은 ' \+ left \+ '장을 볼 수 있습니다/.test(ed) && /남은 ' \+ left \+ '장은 STANDARD 멤버십에서/.test(ed) && /남은 ' \+ left \+ '장은 PREMIUM 멤버십에서/.test(ed) && /회원 전용 화보입니다/.test(ed) && /editorial_top_note/.test(ed));
t('SPA: 두 열기 경로(push·popstate) 모두 IG 버튼 옆에 붙인다', (ed.match(/\+ _papEdTopNoteHtml\(det\);/g) || []).length === 2);
const LANGS = ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
t('_shared 사전 8개 언어에 새 문구 (패널·팝업·상단 안내)', LANGS.every((l) => { const d = JSON.parse(R('frontend/i18n/ui/_shared.' + l + '.json')); return ['이 화보는 STANDARD 멤버십부터 열립니다', '이 화보는 PREMIUM 멤버십부터 열립니다', 'STANDARD · {0} 이후 발행 화보와 이미지 다운로드', 'PREMIUM · 2019년부터 모든 아카이브', '지금 STANDARD는 {0} 이후 화보까지 열립니다', '가입하면 이 화보를 끝까지 볼 수 있습니다', '회원 가입 후 멤버십에서 열리는 화보입니다', '무료 회원은 최신 10편, STANDARD는 {0} 이후 화보, PREMIUM은 2019년부터 모든 아카이브', '무료로 가입하고 보기', '이미 회원이면 로그인', '가입하면 남은 {0}장을 볼 수 있습니다', '남은 {0}장은 STANDARD 멤버십에서', '남은 {0}장은 PREMIUM 멤버십에서'].every((k) => d[k]); }));
t('캐시버스트: index data-v ≥ 7 · editorial.js ≥ 89', /content="index" data-v="([7-9]|\d{2,})"/.test(R('frontend/index.html')) && (function(){ const m = R('frontend/index.html').match(/pap-content-editorial\.js\?v=(\d+)/); return m && Number(m[1]) >= 89; })());

console.log('\n=== ⑥ det 요약 객체에 게이트 필드 (2026-09-17 라이브 실측: 잠금 패널·상단 안내가 SPA 에서 한 번도 안 떴다) ===');
/* 두 렌더 경로는 edDetails[title](=d) 에서 요약 객체 det 를 새로 만든다. 하이드레이트는 d 에 locked 등을 쓰는데
 * det 에 안 옮기면 _papEdApplyLock(det)·_papEdTopNoteHtml(det) 이 늘 '안 잠김' 으로 본다. 정규식 존재 검사가 아니라
 * 실제 줄을 실행해 det.locked 가 살아남는지, 그 det 로 _papEdApplyLock 이 패널을 붙이는지 본다. */
const detStmts = ed.match(/var det=\{issue:d\.issue[\s\S]*?viewState:d\.viewState\|\|''\};/g) || [];
t('det 생성문이 두 경로(push·popstate)에 하나씩, 둘 다 게이트 필드 포함', detStmts.length === 2 && detStmts.every((x) => /locked:!!d\.locked,requiredTier:d\.requiredTier/.test(x)));
const lockFnSrc = (ed.match(/function _papEdApplyLock\(det, gal\)\{[\s\S]*?\n\}\n/) || [''])[0];
t('_papEdApplyLock 원문 추출', lockFnSrc.length > 200);
(function () {
  let ok = true, err = '';
  try {
    for (const stmt of detStmts) {
      const build = new Function('d', 'thumb', '_normCr', stmt + ' return det;');
      const d = { thumb: 'c.jpg', images: ['a.jpg', 'b.jpg'], credits: [], locked: true, requiredTier: 'free', galleryCount: 16, previewCount: 2, viewState: 'preview' };
      const det = build(d, 'c.jpg', []);
      if (det.locked !== true || det.requiredTier !== 'free' || det.galleryCount !== 16 || det.previewCount !== 2 || det.viewState !== 'preview') { ok = false; err = 'fields lost: ' + JSON.stringify(det); break; }
      const gal = { html: '', querySelector() { return null; }, insertAdjacentHTML(_, h) { this.html += h; } };
      const apply = new Function('det', 'gal', 'window', lockFnSrc + ' return _papEdApplyLock(det, gal);');
      const r = apply(det, gal, { _papCutLabel: () => '2026.01' });
      if (r !== true || !/class="ed-locked"/.test(gal.html) || !/총 16장 중 14장이 더 있습니다/.test(gal.html) || !/editorial_gallery_lock/.test(gal.html)) { ok = false; err = 'lock panel not rendered: ' + gal.html.slice(0, 200); break; }
      const unlocked = build({ thumb: 'c.jpg', images: ['a.jpg'], credits: [] }, 'c.jpg', []);
      const gal2 = { html: '', querySelector() { return null; }, insertAdjacentHTML(_, h) { this.html += h; } };
      if (apply(unlocked, gal2) !== false || gal2.html !== '') { ok = false; err = 'panel rendered for unlocked'; break; }
    }
  } catch (e) { ok = false; err = String(e); }
  t('실행: 잠긴 d → det.locked 유지 → _papEdApplyLock 이 패널(총 16장 중 14장)을 붙인다 · 안 잠긴 d 는 안 붙인다', ok, err);
})();

console.log('\n=== ⑦ 잠금 안내가 보인다 (2026-09-21 도메니코 "회원가입 유도가 아직 설정 안 된 것 같다" — 글자색 상속 #111 로 검은 배경에서 안 보였다) ===');
{
  const lockSrc = (ed.match(/function _papEdApplyLock\(det, gal\)\{[\s\S]*?\n\}\n/) || [''])[0];
  const noteSrc = (ed.match(/function _papEdTopNoteHtml\(det\)\{[\s\S]*?\n\}\n/) || [''])[0];
  const noCmt = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // 주석은 뺀다 (주석이 사고 경위를 적고 있다)
  t('패널·상단 안내 코드에 color:inherit / currentColor 가 없다 (색을 못박는다)', lockSrc.length > 200 && noteSrc.length > 100 && !/color:inherit|currentColor/.test(noCmt(lockSrc)) && !/color:inherit|currentColor/.test(noCmt(noteSrc)));
  t('패널 글자 #fff · CTA 는 흰 바탕 검은 글자', /color:#fff/.test(lockSrc) && /background:#fff;color:#000/.test(lockSrc));
  t('상단 안내 글자 #fff + 테두리 (링크가 아니라 버튼처럼 보이게)', /color:#fff;background:rgba\(255,255,255,\.12\);border:1px solid/.test(noteSrc));
  t('패널은 중간 IG 창 앞에 끼운다 (없으면 맨 뒤)', /var mid = gal\.querySelector\('\.ed-mid-cta'\);\s*if\(mid\) mid\.insertAdjacentHTML\('beforebegin', html\); else gal\.insertAdjacentHTML\('beforeend', html\);/.test(lockSrc));
  // 실행: mid-cta 가 있으면 그 앞에 들어가는지
  let ok = true, err = '';
  try {
    const apply = new Function('det', 'gal', 'window', lockSrc + ' return _papEdApplyLock(det, gal);');
    const inserted = [];
    const gal = { querySelector() { return { insertAdjacentHTML(where, h) { inserted.push(where); } }; }, insertAdjacentHTML(where) { inserted.push('END:' + where); } };
    apply({ locked: true, requiredTier: 'free', galleryCount: 10, previewCount: 2, images: ['a', 'b'] }, gal, { _papCutLabel: () => '2026.01' });
    if (inserted.length !== 1 || inserted[0] !== 'beforebegin') { ok = false; err = JSON.stringify(inserted); }
  } catch (e) { ok = false; err = String(e); }
  t('실행: .ed-mid-cta 가 있으면 beforebegin 한 번', ok, err);
  // 서버 판정 전 임시 잠금 — 두 경로에 있고, 실행하면 det.locked 가 켜진다
  const provBlocks = ed.match(/if\(!d\._gateChecked && typeof window\._papViewState === 'function'\)\{[\s\S]*?det\.previewCount = det\.images\.length; \}\s*\}\s*\} catch\(_\)\{\}/g) || [];
  t('서버 판정 전 임시 잠금 블록이 두 경로(push·popstate)에 있다', provBlocks.length === 2, String(provBlocks.length));
  let ok2 = true, err2 = '';
  try {
    for (const stmt of detStmts) {
      const idx = ed.indexOf(stmt);
      const tail = ed.slice(idx, ed.indexOf('} catch(_){}', idx) + '} catch(_){}'.length);
      const build = new Function('d', 'thumb', '_normCr', 'window', tail + ' return det;');
      const d = { thumb: 'c.jpg', images: ['a.jpg'], credits: [], requiredTier: 'free', galleryCount: 12 };   // 목록에서 온 상태(판정 전)
      const det = build(d, 'c.jpg', [], { _papViewState: () => 'preview' });
      if (det.locked !== true || det.requiredTier !== 'free' || det.viewState !== 'preview' || det.galleryCount !== 12 || det.previewCount !== 1) { ok2 = false; err2 = JSON.stringify(det); break; }
      const detFull = build(d, 'c.jpg', [], { _papViewState: () => 'full' });
      if (detFull.locked !== false) { ok2 = false; err2 = 'full 인데 locked: ' + JSON.stringify(detFull); break; }
      const detChecked = build(Object.assign({ _gateChecked: true, locked: false }, d), 'c.jpg', [], { _papViewState: () => 'preview' });
      if (detChecked.locked !== false) { ok2 = false; err2 = '서버가 full 로 판정한 뒤엔 임시 잠금을 안 건다: ' + JSON.stringify(detChecked); break; }
    }
  } catch (e) { ok2 = false; err2 = String(e); }
  t('실행: 판정 전 + 화면 판단 preview → det.locked·tier·galleryCount 즉시 / full 이면 안 걸고 / 서버 판정 뒤엔 서버 값 우선', ok2, err2);
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ editorial-gate-snapshot FAILED'); process.exit(1); }
console.log('✅ editorial-gate-snapshot passed');
