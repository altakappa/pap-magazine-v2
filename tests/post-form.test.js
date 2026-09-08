/**
 * 게시물 형태 라벨 — tests/post-form.test.js (2026-09-08 신설)
 *
 * 왜 있는가 ──────────────────────────────────────────────────────────
 * 9/6 진단(45_Business/2026-09-06-IG팔로워-증가-급락-진단.md)이 훅 코드
 * `#h1`~`#h9` 로 소재를 계측하려 했다. 9/8 실측: **394행 전부 'none'.**
 * 사람이 인스타 앱 캡션에 손으로 타이핑해야 하는 계측기는 안 눌린다.
 * 그래서 사후 자동 분류(post_form)로 바꾼다.
 *
 * 두 번째 구멍: 화보가 안 보였다. ig_post_latest 가 articles 에만 조인해서
 * 화보(editorials)는 '기사 매칭 없음' 으로 떨어졌고, igContentMix 는 그걸
 * 화보로 **추정**했다. 실측 31행 중 26행만 화보, 5행은 진짜 미매칭 —
 * 화보 수가 16% 부풀어 있었다.
 *
 * 여기서 지키는 것:
 *   ① 형태 값 집합이 흔들리지 않는다 (DB check 제약과 코드가 같은 목록)
 *   ② 사람이 정한 값(manual)을 크론이 덮지 않는다
 *   ③ 깨진 AI 응답은 통째로 버린다 — 반만 저장하지 않는다
 *   ④ 화보는 추정이 아니라 조인 결과로 가른다 (미매칭은 미매칭이라 부른다)
 *   ⑤ 곁다리 일(형태 판정)이 본 일(갈래 판정)을 500 으로 만들지 않는다
 *   ⑥ 새 크론을 만들지 않았다 — 호출 예산이 2,598/2,600 이라 여유가 없다
 *   ⑦ 계측기가 멈추면 보인다 (미판정 건수를 표에 적는다)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('      ', d); } }
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* supabase 없이 순수 부분만 — require 가로채기 */
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === './supabase' || id === '../_lib/supabase') return { supabaseAdmin: null };
  return orig.apply(this, arguments);
};
const PF = require(path.join(ROOT, 'api/_lib/postForm.js'));
const mix = require(path.join(ROOT, 'api/_lib/igContentMix.js'));
Module.prototype.require = orig;

const mig = rd('supabase_migrations/147_ig_post_form.sql');
const passSrc = rd('api/_lib/postFormPass.js');
const cronSrc = rd('api/cron/celeb-classify.js');

console.log('\n=== 1. 형태 값 집합 (코드 = DB 제약) ===');
{
  t('AI 가 답하는 값 넷', JSON.stringify(PF.FORMS) === JSON.stringify(['visual', 'namenews', 'onsite', 'none']));
  t('editorial 은 AI 에 안 묻는다 (뷰가 정한다)', !PF.FORMS.includes('editorial'));
  t('표에 쓰는 전체 목록에는 editorial 이 있다', PF.ALL_FORMS[0] === 'editorial' && PF.ALL_FORMS.length === 5);
  for (const f of PF.FORMS) {
    t("DB check 제약이 '" + f + "' 를 허용한다", new RegExp("'" + f + "'").test(mig.split('articles_post_form_chk')[2] || ''));
  }
  t('DB check 제약에 editorial 은 없다 (기사 열에 저장되지 않는다)',
    !/'editorial'/.test((mig.split('articles_post_form_chk')[2] || '').split(';')[0]));
}

console.log('\n=== 2. AI 응답 파싱 — 깨진 건 버린다 ===');
{
  const fence = '```json\n[{"i":0,"form":"visual"},{"i":1,"form":"onsite"}]\n```';
  t('코드펜스를 걷어낸다', JSON.stringify(PF.parseFormVerdicts(fence)) === '[{"i":0,"form":"visual"},{"i":1,"form":"onsite"}]');
  t('목록에 없는 값은 버린다', JSON.stringify(PF.parseFormVerdicts('[{"i":0,"form":"editorial"},{"i":1,"form":"visual"}]')) === '[{"i":1,"form":"visual"}]');
  t('i 가 정수가 아니면 버린다', JSON.stringify(PF.parseFormVerdicts('[{"i":"0","form":"visual"}]')) === '[]');
  t('배열이 아니면 null', PF.parseFormVerdicts('{"form":"visual"}') === null);
  t('빈 응답은 null', PF.parseFormVerdicts('') === null && PF.parseFormVerdicts(null) === null);
  t('망가진 JSON 은 null (예외로 안 죽는다)', PF.parseFormVerdicts('[{"i":0,"form":') === null);
}

console.log('\n=== 3. 대기열 조건 ===');
{
  t('이미 판정된 기사는 다시 안 묻는다', PF.needsFormVerdict({ post_form: 'visual' }) === false);
  t('판정 없는 기사는 대기열', PF.needsFormVerdict({ post_form: null }) === true);
  t('null 입력에 안 죽는다', PF.needsFormVerdict(null) === false);
  t('IG 에 올라간 기사만 묻는다 (계측 대상이 그것뿐)', /not\('source_instagram_url', 'is', null\)/.test(passSrc));
  t('published 만', /\.eq\('status', 'published'\)/.test(passSrc));
}

console.log('\n=== 4. 저장 안전 (celeb-classify 2026-08-07 사고와 같은 규칙) ===');
{
  t('upsert 를 안 쓴다 (PostgREST upsert 는 INSERT ... ON CONFLICT)', !/\.upsert\(/.test(passSrc));
  t('UPDATE 만 쓴다', /\.update\(\{ post_form/.test(passSrc));
  t("사람이 정한 값을 안 덮는다 — .is('post_form', null)", /\.is\('post_form', null\)/.test(passSrc));
  t('판정 주체를 남긴다', /post_form_by: 'ai'/.test(passSrc));
  t('manual 은 덮지 않는다고 문서에 적혀 있다', /manual.*안 덮/.test(passSrc) || /manual.*절대 안 건드/.test(passSrc));
  t('배치가 깨지면 그 배치를 버린다 (continue)', /응답 파싱 실패[\s\S]{0,120}continue;/.test(passSrc));
  t('호출 실패면 다음 실행에 재개 (break)', /catch \(e\) \{[\s\S]{0,160}break;/.test(passSrc));
  t('남은 대기열은 DB 에 직접 묻는다 (진행률 거짓말 방지)', /count: 'exact', head: true/.test(passSrc));
}

console.log('\n=== 5. 새 크론을 만들지 않았다 (호출 예산 2,598/2,600) ===');
{
  const vj = JSON.parse(rd('vercel.json'));
  const paths = (vj.crons || []).map((c) => String(c.path || ''));
  t('post-form 전용 크론이 없다', !paths.some((p) => /post-form/.test(p)));
  t('형태 판정은 celeb-classify 에 얹었다', /runPostFormPass/.test(cronSrc));
  t('왜 얹었는지 근거가 코드에 있다 (예산·빈 대기열)', /예산/.test(passSrc) && /대기열이 0건/.test(passSrc));
  t('곁다리가 본 일을 못 죽인다 — try/catch', /try \{\s*form = await runPostFormPass\(\)/.test(cronSrc));
  t('실패해도 200 으로 갈래 판정 결과를 낸다', /formSaved: form\.saved/.test(cronSrc));
  t('note 에 형태 결과가 붙는다', /msg \+ ' · ' \+ form\.note/.test(cronSrc));
}

console.log('\n=== 6. 화보는 추정이 아니라 조인 결과다 ===');
{
  t('뷰가 editorials 에 조인한다', /FROM public\.editorials e/.test(mig));
  t('content_kind 를 만든다', /AS content_kind/.test(mig));
  t('화보가 기사보다 먼저다', /WHEN e_id IS NOT NULL THEN 'editorial'[\s\S]{0,80}WHEN a_id IS NOT NULL THEN 'article'/.test(mig));
  t('미매칭을 미매칭이라 부른다', /ELSE 'unmatched'/.test(mig));

  const c = mix.classify;
  t("content_kind=editorial → 화보", c({ content_kind: 'editorial', article_id: 'a' }) === '화보');
  t("content_kind=unmatched → 미매칭 (옛 규칙은 이걸 화보로 셌다)", c({ content_kind: 'unmatched', article_id: null }) === '미매칭');
  t("content_kind=article 이면 기사로 센다", c({ content_kind: 'article', article_id: 'a', article_category: 'Fashion' }) === '기사·외부소스');
  t('147 이전 행은 옛 규칙으로 폴백 (열이 없다)', c({ article_id: null }) === '화보');
  t('미매칭이 유형 목록에 있다', mix.TYPES.includes('미매칭'));
}

console.log('\n=== 7. 형태는 유형과 다른 축이다 ===');
{
  t('editorial 형태 인식', mix.formOf({ post_form: 'editorial' }) === 'editorial');
  t('모르는 값은 (미판정)', mix.formOf({ post_form: 'zzz' }) === '(미판정)');
  t('값이 없어도 (미판정)', mix.formOf({}) === '(미판정)' && mix.formOf(null) === '(미판정)');

  const now = Date.parse('2026-09-08T00:00:00Z');
  const d = (n) => new Date(now - n * 86400000).toISOString();
  const row = (o) => Object.assign({ media_type: 'CAROUSEL_ALBUM', posted_at: d(2), age_hours: 48,
    reach: 10000, saved: 100, shares: 100, follows: 10, permalink: 'p/x/' }, o);
  const rows = [
    row({ post_id: '1', content_kind: 'article', article_id: 'a', post_form: 'visual', reach: 60000, follows: 60 }),
    row({ post_id: '2', content_kind: 'article', article_id: 'b', post_form: 'namenews', reach: 20000, follows: 2 }),
    row({ post_id: '3', content_kind: 'article', article_id: 'c', post_form: 'onsite', reach: 4000, follows: 0 }),
    row({ post_id: '4', content_kind: 'editorial', article_id: null, post_form: 'editorial', reach: 8000, follows: 8 }),
    row({ post_id: '5', content_kind: 'article', article_id: 'e' }),                     // 라벨 없음
    row({ post_id: '6', content_kind: 'unmatched', article_id: null }),                  // 미매칭
  ];
  const m = mix.computeContentMix(rows, now);
  const by = {}; m.forms.forEach((r) => { by[r.type] = r; });
  t('형태별 합이 게시물 수와 같다', m.forms.reduce((a, r) => a + r.posts, 0) === 6);
  t('visual 1편 히트 1 (6만)', by.visual.posts === 1 && by.visual.hits === 1);
  t('namenews 는 도달 2만인데 히트가 아니다', by.namenews.posts === 1 && by.namenews.hits === 0);
  t('onsite 팔로우/1k = 0', by.onsite.follows_1k === 0);
  t('editorial 팔로우/1k = 8/8000 = 1', by.editorial.follows_1k === 1);
  t('라벨 없는 2편이 (미판정) 으로 센다', by['(미판정)'].posts === 2, JSON.stringify(by['(미판정)']));
  t('유형 축은 따로 센다 (화보 1 · 미매칭 1)',
    m.cur.find((r) => r.type === '화보').posts === 1 && m.cur.find((r) => r.type === '미매칭').posts === 1);

  const md = mix.renderContentMixMd(m);
  t('형태별 표가 붙는다', /### 형태별/.test(md));
  t('두 축이 다르다는 걸 표가 말한다', /유형과 다른 축/.test(md));
  t('형태 이름은 한국어로 읽힌다', /작업물이 주인공/.test(md) && /이름이 주인공/.test(md));
  t('미판정 건수를 적는다 (계측기가 멈추면 보이게)', /미판정 2편은 형태 라벨이 아직/.test(md));
  t('표가 하나가 아니라 둘이다', (md.match(/\| 게시물\(릴스\) \|/g) || []).length === 2);
}

console.log('\n=== 8. 프롬프트가 실측 사례를 담고 있다 ===');
{
  t('visual 예시에 실제 히트 제목', /머리카락으로 조각하는 작가|할머니집 식탁보/.test(PF.SYSTEM));
  t('onsite 예시에 실제 저조 제목', /프리즈 서울|잠실 잔디밭/.test(PF.SYSTEM));
  t('none 은 마지막 수단이라고 못박는다', /none 은 마지막 수단/.test(PF.SYSTEM));
  t('본문은 안 보낸다 (제목·태그·캡션머리만)', !/본문/.test(PF.buildUserPrompt([{ title: 'x', tags: [], instagram_caption: 'a\nb\nc\n본문본문' }])));
  t('캡션은 앞 두 줄만', PF.buildUserPrompt([{ title: 'x', tags: [], instagram_caption: 'a\nb\n본문본문' }]).includes('캡션머리: a / b'));
}

console.log('\n=== 9. 왜 마커를 안 만들었는지 기록이 남아 있다 ===');
{
  const lib = rd('api/_lib/postForm.js');
  t('마커 미도입 근거(태그 표본 실측)가 적혀 있다', /표본이 태그당 4~21건|적중률이 0~80%/.test(lib));
  t('훅 코드가 0건이었다는 사실이 마이그레이션에 남아 있다', /한 건도 안 붙었다|전부 hook_code='none'/.test(mig));
  t('훅 코드 뷰(144)를 지우지 않았다', /hook_code/.test(mig));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ post-form tests FAILED'); process.exit(1); }
console.log('✅ post-form tests passed');
