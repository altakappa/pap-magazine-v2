/**
 * 다이제스트 갈래 판정 — tests/celeb-classify.test.js (2026-08-07 신설)
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
 *   ③ 아트도 셀럽도 아닌 것은 'none' 으로 **두 모음 모두에서 뺀다**
 *      (도메니코 2026-08-07: "폭염은 아트도 셀럽도 아니야. 애매한건 억지로
 *       포함시키지 말고 그냥 빼줘.")
 *   ④ 사람이 손으로 정한 값이 무엇보다 우선한다
 *   ⑤ 저장된 판정이 없어도 방금 발행된 기사는 마커로 즉시 갈래가 정해진다
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

const C = require(path.join(ROOT, 'api', '_lib', 'digestKind.js'));
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
    const v = C.markerKind(A(tags));
    t(name, v.kind === 'celeb', JSON.stringify(v.hits));
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
    const v = C.markerKind(A(tags));
    t(name, v.kind !== 'celeb', JSON.stringify(v.hits));
  }
}

console.log('\n[3] 아트도 셀럽도 아닌 것은 뺀다 (none)');
{
  /* 도메니코가 직접 지목한 기사. 셀럽이 아니라는 이유로 아트 콜렉션에
     실리면 안 된다 — 갈래가 셋이어야 하는 이유가 이 한 건이다. */
  const heat = A(['heat wave', 'seoul', 'weather alert', 'climate', 'public health', 'korea', 'summer']);
  t('폭염경보는 none', C.markerKind(heat).kind === 'none', JSON.stringify(C.markerKind(heat)));
  t('none 은 셀럽이 아니다', C.digestKind(heat) !== 'celeb');
  t('none 은 콜렉션도 아니다 — 이게 핵심', C.digestKind(heat) !== 'collection');

  t('태그가 아예 없어도 none', C.markerKind(A([])).kind === 'none');
  t('빈 입력·null 에도 안 죽는다',
    C.markerKind({}).kind === 'none' && C.markerKind(null).kind === 'none');

  /* 반대로 'none' 이 남발되면 안 된다. 아트·패션·뷰티 신호가 하나라도
     있으면 콜렉션이다. 45일 332건 중 none 은 폭염 1건뿐이었다. */
  t('패션 태그 하나면 콜렉션', C.markerKind(A(['tailoring'])).kind === 'collection');
  t('아트 태그 하나면 콜렉션', C.markerKind(A(['contemporary art'])).kind === 'collection');
  t('한국어 태그도 읽는다 (실측: 슈즈 디자인·시스루 펌프스만 달린 기사)',
    C.markerKind(A(['시스루 펌프스', '여름 힐'])).kind === 'collection');
  t('부분 일치로 조합어를 잡는다', C.markerKind(A(['sculptural fashion'])).kind === 'collection');
}

console.log('\n[3-2] 마커가 못 가르는 것은 AI 로 넘긴다');
{
  /* 실측 반례: 태그가 전부 사람 이름이라 연예 마커가 없다.
     마커는 collection 이라 답하지만 실제로는 셀럽이다 — AI 가 고친다. */
  const photocall = A(['ferragamo', 'nana', 'kim hee-ae', 'yoon seung-ah', 'kim moo-yul', 'cara bag', 'fw26']);
  t('마커는 collection 이라 답한다 (틀린 답)', C.markerKind(photocall).kind === 'collection');
  t('저장된 판정이 없으니 AI 2차 대상이다', C.needsAiVerdict(photocall) === true);
  t('AI 가 celeb 이라 저장하면 그게 이긴다',
    C.digestKind(Object.assign({}, photocall, { digest_kind: 'celeb', kind_by: 'ai' })) === 'celeb');

  const woosuk = A(['byeon woo-seok', 'prada beauty', 'lip balm', 'k-beauty', 'purple trend']);
  t('변우석 프라다 뷰티도 같은 모양', C.markerKind(woosuk).kind === 'collection');
  t('이미 판정된 기사는 다시 안 묻는다',
    C.needsAiVerdict(A(['x'], { digest_kind: 'none' })) === false);
  t('이상한 값이 저장돼 있으면 무시하고 다시 묻는다',
    C.needsAiVerdict(A(['x'], { digest_kind: 'weird' })) === true);
}

console.log('\n[4] 우선순위 — 사람 손이 가장 위');
{
  const kpop = ['kpop', 'bts'];
  t('manual 이 마커를 이긴다',
    C.digestKind({ tags: kpop, digest_kind: 'collection', kind_by: 'manual' }) === 'collection');
  t('manual 은 마커 없어도 셀럽으로 만들 수 있다',
    C.digestKind({ tags: ['ferragamo'], digest_kind: 'celeb', kind_by: 'manual' }) === 'celeb');
  t('manual none 도 존중한다 (두 모음에서 빼기)',
    C.digestKind({ tags: kpop, digest_kind: 'none', kind_by: 'manual' }) === 'none');
  t('ai 판정도 마커보다 우선한다',
    C.digestKind({ tags: kpop, digest_kind: 'collection', kind_by: 'ai' }) === 'collection');
  t('저장값이 없으면 마커로 판단한다', C.digestKind({ tags: kpop }) === 'celeb');
  t('article 이 없으면 none', C.digestKind(null) === 'none');
}

console.log('\n[5] 태그 모양이 제각각이어도 읽는다');
{
  t('배열', C.tagList(['KPOP', ' BTS ']).join('|') === 'kpop|bts');
  t('JSON 문자열', C.tagList('["kpop","bts"]').join('|') === 'kpop|bts');
  t('쉼표 문자열', C.tagList('kpop, bts').join('|') === 'kpop|bts');
  t('null', C.tagList(null).length === 0);
  t('대소문자·공백 정규화', C.markerKind(A(['  K-POP  '])).kind === 'celeb');
}

console.log('\n[6] 약한 마커를 다시 넣지 않는다');
{
  /* 이 셋은 한 번 넣었다가 뺐다. 근거를 테스트로 못박아 둔다:
     fan event → 맨시티 축구 팬 이벤트, performance/campaign → 아트·브랜드. */
  for (const weak of ['fan event', 'performance', 'campaign', 'festival fashion', 'interview']) {
    t("'" + weak + "' 는 단독으로 셀럽 신호가 아니다", C.markerKind(A([weak])).kind !== 'celeb');
  }
  t('그룹명은 단독으로도 셀럽 신호다', C.markerKind(A(['aespa'])).kind === 'celeb');
}

console.log('\n[7] 배선 — 다이제스트가 category 를 안 본다');
{
  const src = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'digestBuckets.js'), 'utf8');
  t('digestKind 를 쓴다', /require\('\.\/digestKind'\)/.test(src));
  t("셀럽 갈래는 kind === 'celeb'", /bucket === 'celeb'[\s\S]{0,240}digestKind\(a\) === 'celeb'/.test(src));
  t("콜렉션 갈래는 kind === 'collection'", /digestKind\(a\) === 'collection'/.test(src));
  t("**콜렉션이 '셀럽 아님' 으로 걸러지지 않는다** — 그러면 none 이 딸려 들어온다",
    !/!isCeleb\(a\)/.test(src) && !/digestKind\(a\) !== 'celeb'/.test(src));
  t('더 이상 isCelebCategory 로 갈래를 정하지 않는다',
    !/isLive\(a, nowIso\) && isCelebCategory/.test(src));
  t('판정 칸을 실제로 읽어 온다', /digest_kind, kind_by/.test(src));
  t('태그도 읽어 온다 (마커 즉석 판정에 필요)', /category, tags,/.test(src));

  const mig = fs.readFileSync(path.join(ROOT, 'supabase_migrations', '111_articles_digest_kind.sql'), 'utf8');
  t('마이그레이션이 digest_kind 를 만든다', /digest_kind text/.test(mig) && /kind_by text/.test(mig));
  t('세 값만 허용한다 (DB 가 오타를 막는다)',
    /check \(digest_kind is null or digest_kind in \('celeb', 'collection', 'none'\)\)/.test(mig));
  t('기본값을 주지 않는다 — null 이 대기열이다', !/digest_kind text[^,;]*default/i.test(mig));
  t('110 의 값을 옮긴다 (454건을 다시 판정하지 않는다)', /where is_celeb is true/.test(mig));

  const cron = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-classify.js'), 'utf8');
  t('2차 판정 크론이 manual 을 덮지 않는다', /kind_by/.test(cron) && /'ai'/.test(cron));
  t("대기열은 digest_kind is null 이다", /\.is\('digest_kind', null\)/.test(cron));
  t("AI 프롬프트가 'none' 을 가르친다", /"none"/.test(cron) && /폭염/.test(cron));
  t('세 값만 받아들인다', /KINDS\.includes\(o\.kind\)/.test(cron));
  t('마커로 잡힌 건 AI 에 안 묻고 바로 저장한다', /'marker'/.test(cron));
  t("돌았는데 못 했으면 note 에 적는다 ('돌았다 ≠ 했다')", /note\(res,/.test(cron));
  /* 2026-08-07 실사고 — x-vercel-cron 헤더로 크론을 알아보려 했는데 버셀은
     그 헤더를 안 보낸다. 예약 실행이 전부 401 로 끝나고 note 는 빈칸이었다.
     저장소의 다른 크론과 같은 관문이어야 한다. */
  t('크론 인증은 Authorization: Bearer CRON_SECRET 이다',
    /auth === 'Bearer ' \+ process\.env\.CRON_SECRET/.test(cron));
  t('x-vercel-cron 헤더에 기대지 않는다 (버셀은 안 보낸다)',
    !/x-vercel-cron/.test(cron.replace(/\/\*[\s\S]*?\*\//g, '')));
  t('인증에 막혀도 note 를 남긴다 — 빈칸이면 아무도 못 본다',
    /인증 거부/.test(cron));
  t('크론이 vercel.json 에 등록됨',
    (require(path.join(ROOT, 'vercel.json')).crons || []).some((c) => c.path === '/api/cron/celeb-classify'));
}

console.log('\n[8] 2차 판정 응답 파싱');
{
  const P = require(path.join(ROOT, 'api', 'cron', 'celeb-classify.js')).parseVerdicts;
  t('평범한 배열', P('[{"i":0,"kind":"celeb"}]').length === 1);
  t('세 값을 모두 받는다',
    P('[{"i":0,"kind":"celeb"},{"i":1,"kind":"collection"},{"i":2,"kind":"none"}]').length === 3);
  t('코드펜스를 걷어낸다', P('```json\n[{"i":1,"kind":"none"}]\n```').length === 1);
  t('앞뒤 설명문을 무시한다', P('네, 판정했습니다:\n[{"i":0,"kind":"celeb"}] 이상입니다').length === 1);
  t('모르는 값은 버린다 (DB check 에 걸리기 전에)', P('[{"i":0,"kind":"maybe"}]').length === 0);
  t('불리언이던 옛 형식은 안 받는다', P('[{"i":0,"celeb":true}]').length === 0);
  t('i 가 없으면 버린다', P('[{"kind":"celeb"}]').length === 0);
  t('배열이 아니면 null', P('{"i":0}') === null);
  t('깨진 JSON 은 null', P('[{"i":0,') === null);
  t('빈 입력은 null', P('') === null);
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ celeb-classify tests FAILED'); process.exit(1); }
console.log('✅ celeb-classify tests passed');
