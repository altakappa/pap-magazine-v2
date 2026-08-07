/**
 * 셀럽/아트 갈래 판정 — tests/celeb-classify.test.js (2026-08-07 신설)
 *
 * 무슨 문제였나 ───────────────────────────────────────────────────────
 * 도메니코: "아트 아카이브 모음에 셀럽과 아트가 다 섞여 있고,
 *            셀럽 소식 모음은 오히려 갯수가 부족하다."
 *
 * 원인은 하나다. 다이제스트가 갈래를 category 로 갈랐는데, 실재하는
 * 카테고리는 넷뿐이고(Culture·Fashion·News·Beauty) 셀럽 기사가 셋에
 * 흩어져 있었다. 45일 실측 54건 vs 실제 최소 121건.
 *
 * 여기서 지키는 것:
 *   ① 실제로 샜던 기사들이 이제 셀럽으로 잡힌다 (실측 태그 그대로)
 *   ② 아트·디자이너 기사는 여전히 셀럽이 아니다 (오탐 금지)
 *   ③ 마커는 false 를 말하지 않는다 — 모르면 null (AI 2차 기회를 남긴다)
 *   ④ 사람이 손으로 정한 값이 무엇보다 우선한다
 *   ⑤ 저장된 판정이 없어도 방금 발행된 기사는 마커로 구제된다
 *   ⑥ 약한 마커를 다시 넣지 않는다 (fan event → 맨시티 축구가 딸려온다)
 *   ⑦ 배선: 다이제스트가 category 가 아니라 이 규칙을 쓴다
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const C = require(path.join(ROOT, 'api', '_lib', 'celebClassify.js'));
const A = (tags, extra) => Object.assign({ tags }, extra || {});

console.log('\n[1] 실제로 아트 콜렉션으로 새던 기사 — 이제 셀럽이다');
{
  /* 전부 2026-08-04~07 실측 태그 그대로. 카테고리는 셋으로 흩어져 있었다. */
  const cases = [
    ['휴닝카이 페라가모 (Fashion)', ['hueningkai', 'ferragamo', 'fw26', 'cara bag', 'menswear', 'kpop fashion']],
    ['정국 샤넬 향수 (Beauty)', ['jungkook', 'chanel', 'chanel beauty', 'fragrance', 'bts', '1957']],
    ['스트레이 키즈 컴백 (Culture)', ['stray kids', 'this & that', 'kpop', 'mini album', 'music video', 'comeback']],
    ['카리나 컨버스 (Fashion)', ['converse', 'karina', 'aespa', 'run star crush', 'sneakers']],
    ['안효섭 공항패션 (Fashion)', ['ahn hyo-seop', 'juun.j', 'airport fashion', 'korean actor', 'menswear']],
    ['에스파 뮤비 (Culture)', ['aespa', 'ty dolla sign', 'kwangya high', 'music video', 'kpop']],
    ['성화 송지오 캠페인 (Fashion)', ['seonghwa', 'ateez', 'songzio', 'fw26 campaign', 'menswear']],
    ['한소희·남주혁 (News)', ['han so-hee', 'nam joo-hyuk', 'kdrama', 'dior', 'korean actors']],
    ['젠데이아 앰배서더 (Beauty)', ['zendaya', 'prada beauty', 'brand ambassador', 'global campaign']],
  ];
  for (const [name, tags] of cases) {
    const v = C.markerVerdict(A(tags));
    t(name, v.celeb === true, JSON.stringify(v.hits));
  }
}

console.log('\n[2] 아트·디자이너 기사는 셀럽이 아니다 (오탐 금지)');
{
  const cases = [
    ['존 갈리아노 회고전', ['john galliano', 'the met', 'fashion exhibition', 'maison margiela', 'retrospective']],
    ['릭 오웬스 파리', ['rick owens', 'paris fashion week', 'fashion news', 'pfw', 'runway show']],
    ['비즈 아티스트', ['marina rønnow honoré', 'perler beads', 'analog art', 'pixel art', 'contemporary sculpture']],
    ['텍스타일 아트', ['hannah knox', 'fashion art', 'memory', 'textile art', 'contemporary art']],
    ['폭염 경보', ['heat wave', 'seoul', 'weather alert', 'climate', 'public health']],
    ['젠틀몬스터 AI 안경', ['gentle monster', 'smart eyewear', 'ai glasses', 'samsung', 'wearable tech']],
    ['맨시티 팬 이벤트', ['manchester city', 'puma', 'seongsu', 'man city house', 'fan event', 'pop-up']],
    ['3D 바디 아트', ['poi', '3d art', 'digital art', 'body positivity', 'baroque', 'character design']],
  ];
  for (const [name, tags] of cases) {
    const v = C.markerVerdict(A(tags));
    t(name, v.celeb !== true, JSON.stringify(v.hits));
  }
}

console.log('\n[3] 마커는 false 를 말하지 않는다 — 모르면 null');
{
  /* 실측 반례: 태그가 전부 사람 이름이라 분야 마커가 하나도 없다.
     여기서 false 를 뱉으면 AI 2차 판정 기회가 사라진다. */
  const photocall = A(['ferragamo', 'nana', 'kim hee-ae', 'yoon seung-ah', 'kim moo-yul', 'cara bag', 'fw26']);
  t('페라가모 포토콜은 null (아님 이 아니다)', C.markerVerdict(photocall).celeb === null);
  t('그래서 AI 2차 대상이 된다', C.needsAiVerdict(photocall) === true);
  /* 또 하나의 실측 반례 — 변우석 프라다 뷰티. 태그가 브랜드·제품·트렌드뿐이라
     '연예인이 주인공' 이라는 사실이 태그에 안 남았다. 이것도 AI 몫이다. */
  const woosuk = A(['byeon woo-seok', 'prada beauty', 'lip balm', 'k-beauty', 'purple trend']);
  t('변우석 프라다 뷰티도 null', C.markerVerdict(woosuk).celeb === null, JSON.stringify(C.markerVerdict(woosuk).hits));
  t('마커가 걸리면 AI 에 안 묻는다', C.needsAiVerdict(A(['kpop', 'bts'])) === false);
  t('이미 판정된 기사는 다시 안 묻는다', C.needsAiVerdict(A(['x'], { is_celeb: false })) === false);
  t('null 은 false 로 저장된 것과 다르다',
    C.markerVerdict(A([])).celeb === null && C.markerVerdict(A([])).celeb !== false);
  t('빈 태그·null 에도 안 죽는다',
    C.markerVerdict({}).celeb === null && C.markerVerdict(null).celeb === null);
}

console.log('\n[4] 우선순위 — 사람 손이 가장 위');
{
  const kpop = ['kpop', 'bts'];
  t('manual=false 는 마커를 이긴다',
    C.isCeleb({ tags: kpop, is_celeb: false, celeb_by: 'manual' }) === false);
  t('manual=true 는 마커 없어도 셀럽',
    C.isCeleb({ tags: ['ferragamo'], is_celeb: true, celeb_by: 'manual' }) === true);
  t('ai 판정도 마커보다 우선한다 (사람이 본 최신 결론)',
    C.isCeleb({ tags: kpop, is_celeb: false, celeb_by: 'ai' }) === false);
  t('저장값이 없으면 마커로 판단한다', C.isCeleb({ tags: kpop }) === true);
  t('저장값도 마커도 없으면 셀럽 아님 (콜렉션으로)', C.isCeleb({ tags: ['ferragamo'] }) === false);
  t('article 이 없으면 false', C.isCeleb(null) === false);
}

console.log('\n[5] 태그 모양이 제각각이어도 읽는다');
{
  t('배열', C.tagList(['KPOP', ' BTS ']).join('|') === 'kpop|bts');
  t('JSON 문자열', C.tagList('["kpop","bts"]').join('|') === 'kpop|bts');
  t('쉼표 문자열', C.tagList('kpop, bts').join('|') === 'kpop|bts');
  t('null', C.tagList(null).length === 0);
  t('대소문자·공백 정규화', C.markerVerdict(A(['  K-POP  '])).celeb === true);
}

console.log('\n[6] 약한 마커를 다시 넣지 않는다');
{
  /* 이 셋은 한 번 넣었다가 뺐다. 근거를 테스트로 못박아 둔다:
     fan event → 맨시티 축구 팬 이벤트, performance/campaign → 아트·브랜드. */
  for (const weak of ['fan event', 'performance', 'campaign', 'festival fashion', 'interview']) {
    t("'" + weak + "' 는 단독으로 셀럽 신호가 아니다", C.markerVerdict(A([weak])).celeb !== true);
  }
  t('그룹명은 단독으로도 셀럽 신호다', C.markerVerdict(A(['aespa'])).celeb === true);
}

console.log('\n[7] 배선 — 다이제스트가 category 를 안 본다');
{
  const src = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'digestBuckets.js'), 'utf8');
  t('celebClassify 를 쓴다', /require\('\.\/celebClassify'\)/.test(src));
  t('셀럽 갈래가 isCeleb 로 걸러진다', /bucket === 'celeb'[\s\S]{0,200}isCeleb\(a\)/.test(src));
  t('콜렉션 갈래가 !isCeleb 로 걸러진다', /!isCeleb\(a\)/.test(src));
  t('더 이상 isCelebCategory 로 갈래를 정하지 않는다',
    !/isLive\(a, nowIso\) && isCelebCategory/.test(src));
  t('판정 칸을 실제로 읽어 온다', /is_celeb, celeb_by/.test(src));
  t('태그도 읽어 온다 (마커 즉석 판정에 필요)', /category, tags,/.test(src));

  const mig = fs.readFileSync(path.join(ROOT, 'supabase_migrations', '110_articles_is_celeb.sql'), 'utf8');
  t('마이그레이션이 두 칸을 만든다', /is_celeb boolean/.test(mig) && /celeb_by text/.test(mig));
  t('기본값을 주지 않는다 — null 이 대기열이다', !/is_celeb boolean[^,;]*default/i.test(mig));

  const cron = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-classify.js'), 'utf8');
  t('2차 판정 크론이 manual 을 덮지 않는다', /celeb_by/.test(cron) && /'ai'/.test(cron));
  t('대기열은 is_celeb is null 이다', /\.is\('is_celeb', null\)/.test(cron));
  t('마커로 잡힌 건 AI 에 안 묻고 바로 저장한다', /'marker'/.test(cron));
  t("돌았는데 못 했으면 note 에 적는다 ('돌았다 ≠ 했다')", /note\(res,/.test(cron));
  t('크론이 vercel.json 에 등록됨',
    (require(path.join(ROOT, 'vercel.json')).crons || []).some((c) => c.path === '/api/cron/celeb-classify'));
}

console.log('\n[8] 2차 판정 응답 파싱');
{
  const P = require(path.join(ROOT, 'api', 'cron', 'celeb-classify.js')).parseVerdicts;
  t('평범한 배열', JSON.stringify(P('[{"i":0,"celeb":true}]')) === '[{"i":0,"celeb":true}]');
  t('코드펜스를 걷어낸다', P('```json\n[{"i":1,"celeb":false}]\n```').length === 1);
  t('앞뒤 설명문을 무시한다', P('네, 판정했습니다:\n[{"i":0,"celeb":true}] 이상입니다').length === 1);
  t('celeb 이 불리언이 아니면 버린다', P('[{"i":0,"celeb":"yes"}]').length === 0);
  t('i 가 없으면 버린다', P('[{"celeb":true}]').length === 0);
  t('배열이 아니면 null', P('{"i":0}') === null);
  t('깨진 JSON 은 null', P('[{"i":0,') === null);
  t('빈 입력은 null', P('') === null);
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ celeb-classify tests FAILED'); process.exit(1); }
console.log('✅ celeb-classify tests passed');
