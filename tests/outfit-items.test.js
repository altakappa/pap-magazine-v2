/**
 * "이 착장 어디 거?" 착장 칩 (2026-11-14, 마이그레이션 189)
 *
 * 다른 세션이 백엔드(lib·라우트·sync 훅·마이그레이션)까지 만들고 멈춘 것을 이어받아
 * 프런트 블록·사전·테스트를 붙였다. 설계: 45_Business/2026-11-14-착장식별-참여거리-설계.md
 * 지키는 것: AI 는 제안만(status proposed) · 투표 1인 1표(서버 키) · 3표 확정/3표 숨김 ·
 *            발행을 막지 않는다(try/catch, 백필 제외) · 항목 없으면 블록 숨김.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
function stub(rel, exports) { const p = path.join(ROOT, 'api', '_lib', rel); require.cache[p] = new Module(p); require.cache[p].exports = exports; require.cache[p].loaded = true; }
stub('supabase.js', { supabaseAdmin: {} });

const O = require(path.join(ROOT, 'api', '_lib', 'outfitItems.js'));
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', typeof d === 'string' ? d : JSON.stringify(d)); } }

console.log('\n[1] 태그 → 브랜드 (순수 함수)');
const idx = new Map();
for (const [k, v] of [['ferragamo', { brand_id: 'ferragamo', display_name: 'Ferragamo' }], ['louisvuitton', { brand_id: 'louis-vuitton', display_name: 'Louis Vuitton' }], ['chanel', { brand_id: 'chanel', display_name: 'CHANEL' }], ['dior', { brand_id: 'dior', display_name: 'Dior' }], ['prada', { brand_id: 'prada', display_name: 'Prada' }]]) idx.set(k, v);
t('norm: 공백·하이픈·대소문자 무시', O.norm('Louis-Vuitton ') === 'louisvuitton' && O.norm('샤넬') === '샤넬');
const got = O.brandsFromTags(['hueningkai', 'Ferragamo', 'fw26', 'cara bag', 'louis vuitton', 'ferragamo'], idx);
t('태그에서 브랜드만, 순서 유지, 중복 제거', got.map((b) => b.brand_id).join(',') === 'ferragamo,louis-vuitton', got);
t('상한 MAX_AUTO(4)', O.brandsFromTags(['chanel', 'dior', 'prada', 'ferragamo', 'louis vuitton'], idx).length === O.MAX_AUTO && O.MAX_AUTO === 4);
t('셀럽 이름·제품명은 브랜드로 안 잡는다', O.brandsFromTags(['karina', 'heel force 1', 'son small'], idx).length === 0);
t('cleanUrl: https 만', O.cleanUrl('https://ferragamo.com/x') && !O.cleanUrl('http://x.com') && !O.cleanUrl('javascript:alert(1)'));
t('cleanText: 꺾쇠·제어문자 제거, 상한', O.cleanText('<b>Cara</b> bag\u0007', 80) === 'bCara/b bag' && O.cleanText('a'.repeat(100)).length === 80);

console.log('[2] 투표 확정 규칙 (vote 를 가짜 DB 로 실행)');
(async () => {
  const votes = {}; let item = { status: 'proposed' }; let lastUpdate = null;
  const db = { from: (tbl) => {
    const o = {};
    if (tbl === 'article_outfit_votes') {
      o.upsert = async (r) => { votes[r.voter_key] = r.vote; return { error: null }; };
      o.select = () => ({ eq: async () => ({ data: Object.values(votes).map((v) => ({ vote: v })), error: null }) });
    } else {
      o.select = () => ({ eq: () => ({ maybeSingle: async () => ({ data: item }) }) });
      o.update = (u) => { lastUpdate = u; return { eq: () => ({ select: () => ({ single: async () => { item.status = u.status; return { data: { id: 'i', status: u.status, yes_count: u.yes_count, no_count: u.no_count }, error: null }; } }) }) }; };
    }
    return o;
  } };
  let r = await O.vote('i', 'ip:a', 1, db); r = await O.vote('i', 'ip:b', 1, db);
  t('2표는 아직 제안됨', r.status === 'proposed' && r.yes_count === 2);
  r = await O.vote('i', 'ip:a', 1, db);
  t('같은 사람이 또 눌러도 1표 (upsert)', r.yes_count === 2);
  r = await O.vote('i', 'ip:c', 1, db);
  t('맞아요 3표면 확정', r.status === 'confirmed' && r.yes_count === 3);
  r = await O.vote('i', 'ip:a', -1, db);
  t('확정 뒤엔 표를 바꿔도 상태 유지 (집계만 갱신)', r.status === 'confirmed' && r.yes_count === 2 && r.no_count === 1);
  t('집계는 votes 표를 다시 세서 쓴다 (증감 산술 아님)', lastUpdate && lastUpdate.yes_count === 2 && lastUpdate.no_count === 1);

  console.log('[3] 배선');
  const route = R('api/articles/[id]/outfit.js');
  t('GET 은 로그인 불필요, vote 도 로그인 불필요(서버 키), propose 는 로그인', /action === 'vote'[\s\S]{0,700}actorKeyFor\(req\)/.test(route) && /action === 'propose'[\s\S]{0,120}requireAuth/.test(route));
  t('남의 기사 항목에 투표 못 한다 (article_id 확인)', /eq\('id', itemId\)\.eq\('article_id', articleId\)/.test(route));
  t('봇 투표는 세지 않는다', /isLikelyBot[\s\S]{0,80}204/.test(route));
  const sync = R('api/cron/sync-instagram.js');
  t('sync-instagram: 발행 직후 제안, 백필 제외, 실패해도 발행 안 막음', /if \(inserted && !backfillMode\)\{\s*try \{[\s\S]{0,300}proposeFromTags/.test(sync));
  const mig = R('supabase_migrations/189_article_outfit_items.sql');
  t('189: items·votes 표, 상태 3종, 1인 1표 PK, RLS 서비스 전용', /article_outfit_items/.test(mig) && /article_outfit_votes/.test(mig) && /PRIMARY KEY \(item_id, voter_key\)/.test(mig) && /REVOKE ALL ON public\.article_outfit_votes FROM anon, authenticated/.test(mig));
  t('181 번호 충돌 파일이 남아 있지 않다', !fs.existsSync(path.join(ROOT, 'supabase_migrations', '181_article_outfit_items.sql')));
  const fe = R('frontend/pap-engage.js');
  t('프런트: 기사에만 착장 블록, 항목 없으면 숨김', /kind === 'article' \? '<div class="pe-outfit" hidden>/.test(fe) && /if \(!items\.length\) \{ outfitEl\.hidden = true; return; \}/.test(fe));
  t('프런트: 확정은 /brand/ 링크 + ✓, 제안은 맞아요/아니에요', /\/brand\/' \+ encodeURIComponent\(i\.brand_id\)/.test(fe) && /action: 'vote'/.test(fe));
  const dict = JSON.parse(R('frontend/i18n/ui/_shared.en.json'));
  t('사전: 항목 없음 / 브랜드를 적어주세요', !!dict['항목 없음'] && !!dict['브랜드를 적어주세요']);

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ outfit-items tests FAILED'); process.exit(1); }
  console.log('✅ outfit-items tests passed'); process.exit(0);
})().catch((e) => { console.log('  ✗ 실행 오류', e && e.stack || e); process.exit(1); });
