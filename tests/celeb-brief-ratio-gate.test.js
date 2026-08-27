/**
 * 셀럽 브리프 — 판형 실측 · 셀럽 게이트 · 슬라이드 상한 (2026-08-26 신설)
 *
 * 도메니코 2026-08-26: "영상의 경우 위아래 납짝해지지 않게 … 릴스용이라면 릴스
 * 비율로, 캐러셀이라면 캐러셀 비율로 … 지금은 너무 비율이 엉망이야. 그리고
 * 이미지를 최대한으로 뽑아줘. 추가로 모두 셀럽이 포함된 기사여야만해."
 *
 * 무엇이 잘못돼 있었나 (실측, celeb_brief_queue 42건) ────────────────────
 *  ① 판형: `items[0].type === 'video' ? 'reels' : 'feed'` — 영상이면 무조건
 *     9:16 이라고 찍었다. 재는 코드는 이 판단보다 **뒤에서** 돌고 있었다.
 *       브리프 41·40·34·32·28  720x1280 = 0.5625 (9:16)  판정 맞음
 *       브리프 25 (프라다)      720x900  = 0.8    (4:5)   **판정 틀림**
 *  ② 상한: MAX_SLIDES = 10 인데 인스타 캐러셀은 20장이다. 브리프 36 이 10 에서 잘렸다.
 *  ③ 게이트: 감시 계정에 브랜드 단독이 3개(dior·prada·chanel). 디올 단독 9건,
 *     4시간 안에 같은 테일러링 캠페인 3건이 텔레그램으로 갔다.
 *
 * 여기서 지키는 것:
 *   ① 판형은 **실측 비율**로 정한다 (영상이라고 9:16 으로 찍지 않는다)
 *   ② 못 쟀으면 종전 동작(reels)을 유지한다 — 고장 범위를 넓히지 않는다
 *   ③ 셀럽 게이트는 **fail-open** 이다 ← 이게 핵심. kind 를 못 받으면 통과시킨다.
 *      "판단 불가"를 "인물 없음"으로 읽으면 브리프가 전부 사라진다.
 *   ④ 슬라이드 상한 20, 게시 경로도 같은 상수를 쓴다 (두 벌로 갈리지 않게)
 *   ⑤ 코드 순서: 재기 → 판형 → 커버. 이 순서가 뒤집히면 ①이 그대로 재발한다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const cb = require(path.join(ROOT, 'api', '_lib', 'celebBrief.js'));
const CRON = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-brief.js'), 'utf8');
const IMP = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'instagramImport.js'), 'utf8');

console.log('[1] 판형은 실측 비율로 정한다');
t('9:16 영상(720x1280) → reels',
  cb.pickVariant([{ type: 'video' }], { width: 720, height: 1280, ratio: 0.5625 }) === 'reels');
t('4:5 영상(720x900) → feed  ← 브리프 25 프라다가 여기서 틀렸다',
  cb.pickVariant([{ type: 'video' }], { width: 720, height: 900, ratio: 0.8 }) === 'feed',
  cb.pickVariant([{ type: 'video' }], { ratio: 0.8 }));
t('1:1 영상(0.999) → feed', cb.pickVariant([{ type: 'video' }], { ratio: 0.999 }) === 'feed');
t('가로 영상(1.78) → feed', cb.pickVariant([{ type: 'video' }], { ratio: 1.78 }) === 'feed');
t('경계 바로 아래(0.61) → reels', cb.pickVariant([{ type: 'video' }], { ratio: 0.61 }) === 'reels');
t('경계 바로 위(0.63) → feed', cb.pickVariant([{ type: 'video' }], { ratio: 0.63 }) === 'feed');
t('경계값 0.62 는 9:16(0.5625)과 4:5(0.8) 사이다',
  cb.REELS_MAX_RATIO > 0.5625 && cb.REELS_MAX_RATIO < 0.8, cb.REELS_MAX_RATIO);

console.log('\n[2] 못 쟀을 때는 종전 동작을 유지한다 (고장 범위를 넓히지 않는다)');
t('영상인데 실측 없음 → reels', cb.pickVariant([{ type: 'video' }], null) === 'reels');
t('ratio 가 0 → reels', cb.pickVariant([{ type: 'video' }], { ratio: 0 }) === 'reels');
t('ratio 가 NaN → reels', cb.pickVariant([{ type: 'video' }], { ratio: NaN }) === 'reels');
t('사진이면 실측과 무관하게 feed', cb.pickVariant([{ type: 'image' }], { ratio: 0.5625 }) === 'feed');
t('슬라이드가 비면 feed', cb.pickVariant([], null) === 'feed');

console.log('\n[3] 셀럽 게이트 — 인물이 있어야 통과');
t('브랜드만 → 막는다', cb.celebGate([{ ko: '디올', kind: 'brand' }]).pass === false);
t('막힌 이유가 남는다', /인물 없음/.test(cb.celebGate([{ ko: '디올', kind: 'brand' }]).reason || ''));
t('개인이 있으면 통과',
  cb.celebGate([{ ko: '디올', kind: 'brand' }, { ko: '지수', kind: 'person' }]).pass === true);
t('그룹이 있으면 통과',
  cb.celebGate([{ ko: '프라다', kind: 'brand' }, { ko: '라이즈', kind: 'group' }]).pass === true);
t('브랜드 여러 개여도 인물 없으면 막는다',
  cb.celebGate([{ ko: '디올', kind: 'brand' }, { ko: '샤넬', kind: 'brand' }]).pass === false);

console.log('\n[4] fail-open — 판단 불가를 "인물 없음"으로 읽지 않는다  ← 핵심');
t('kind 가 하나도 없으면 통과 (모델이 안 줬을 때 브리프가 전멸하면 안 된다)',
  cb.celebGate([{ ko: '디올' }, { ko: '지수' }]).pass === true);
t('그 이유가 기록된다', /판단 불가/.test(cb.celebGate([{ ko: '디올' }]).reason || ''));
t('entities 가 빈 배열이면 통과', cb.celebGate([]).pass === true);
t('entities 가 null 이면 통과', cb.celebGate(null).pass === true);
t('entities 가 undefined 면 통과', cb.celebGate(undefined).pass === true);
t('kind 가 빈 문자열이면 판단 불가로 통과', cb.celebGate([{ ko: '디올', kind: '' }]).pass === true);
t('kind 가 섞여 있으면 있는 것만 본다 (브랜드만 표기 → 막힘)',
  cb.celebGate([{ ko: '디올', kind: 'brand' }, { ko: '무엇' }]).pass === false);

console.log('\n[4-2] 주제 게이트 — 셀럽 "소식"만 (2026-08-26 2차 지시)');
/* 도메니코: "제발 셀럽소식만 보내줘. 셀럽이 매거진에 실린소식은 안알려줘도돼.
   챌린지도 알려줄필요없어."  인물이 있어도 통과하면 안 되는 것들이 있었다. */
const P = [{ ko: '지수', kind: 'person' }];
const BR = [{ ko: '디올', kind: 'brand' }];
t('셀럽 소식은 통과', cb.briefGate({ entities: P, brief_topic: 'celeb_news' }).pass === true);
t('남의 매거진에 실린 소식은 막는다',
  cb.briefGate({ entities: P, brief_topic: 'magazine_feature' }).pass === false);
t('챌린지는 막는다', cb.briefGate({ entities: P, brief_topic: 'challenge' }).pass === false);
t('인물이 있어도 브랜드 캠페인이면 막는다',
  cb.briefGate({ entities: P, brief_topic: 'brand_campaign' }).pass === false);
t('other 도 막는다', cb.briefGate({ entities: P, brief_topic: 'other' }).pass === false);
t('막힌 이유에 주제가 적힌다',
  /매거진/.test(cb.briefGate({ entities: P, brief_topic: 'magazine_feature' }).reason || ''));
t('브랜드만이면 주제가 celeb_news 여도 막는다',
  cb.briefGate({ entities: BR, brief_topic: 'celeb_news' }).pass === false);

console.log('\n[4-3] 주제 게이트도 fail-open ← 표기가 흔들려도 전멸하면 안 된다');
t('하이픈 표기(celeb-news)도 통과', cb.briefGate({ entities: P, brief_topic: 'celeb-news' }).pass === true);
t('대문자(CELEB_NEWS)도 통과', cb.briefGate({ entities: P, brief_topic: 'CELEB_NEWS' }).pass === true);
t('모르는 값이면 막지 않고 인물 판정으로 넘긴다',
  cb.briefGate({ entities: P, brief_topic: 'zzz_unknown' }).pass === true);
t('brief_topic 이 아예 없으면 인물 판정으로만 통과',
  cb.briefGate({ entities: P }).pass === true);
t('그 사실이 이유에 남는다', /brief_topic/.test(cb.briefGate({ entities: P }).reason || ''));
t('gen 이 null 이어도 던지지 않는다', cb.briefGate(null).pass === true);
t('막는 목록이 프롬프트에 정의된 넷뿐이다 (모르는 값을 막지 않는다)',
  cb.TOPIC_BLOCK.size === 4, Array.from(cb.TOPIC_BLOCK));

console.log('\n[4-4] 크론이 주제 게이트를 쓴다');
t('celebGate 가 아니라 briefGate 를 부른다',
  /celebBrief\.briefGate\(gen\)/.test(CRON) && !/celebBrief\.celebGate\(gen\.entities\)/.test(CRON));
t('막힌 건의 brief_topic 을 보관한다 (게이트가 과한지 세려면 필요하다)',
  /brief_topic: gen\.brief_topic/.test(CRON));
t('프롬프트가 brief_topic 을 요구한다', /"brief_topic"/.test(IMP));
t('네 갈래를 전부 설명한다',
  ['celeb_news', 'magazine_feature', 'challenge', 'brand_campaign'].every((k) => IMP.includes(k)));

console.log('\n[5] 슬라이드 상한 20 (인스타 캐러셀 상한)');
t('MAX_SLIDES 가 20', cb.MAX_SLIDES === 20, cb.MAX_SLIDES);
const kids = { children: { data: Array.from({ length: 25 }, (_, i) => ({ media_type: 'IMAGE', media_url: 'https://x/' + i + '.jpg' })) } };
t('25장 게시물에서 20장을 뽑는다', cb.collectMediaItems(kids).length === 20, cb.collectMediaItems(kids).length);
const merged = cb.mergeMediaItems([cb.collectMediaItems(kids), cb.collectMediaItems(kids)]);
t('여러 게시물 합쳐도 20 에서 멈춘다', merged.length === 20, merged.length);
t('게시 경로가 같은 상수를 쓴다 (숫자를 두 벌로 두지 않는다)',
  /urls\.length < celebBrief\.MAX_SLIDES/.test(CRON));
t('게시 경로에 10 하드코딩이 남아 있지 않다', !/urls\.length < 10\b/.test(CRON));

console.log('\n[6] 코드 순서 — 재고 나서 판형을 정한다 (뒤집히면 ①이 재발한다)');
const iMeasure = CRON.indexOf('mp4Dimensions');
const iPick = CRON.indexOf('celebBrief.pickVariant');
const iRender = CRON.indexOf('renderThumb(cover');
t('실측 코드가 존재한다', iMeasure > -1);
t('판형 결정이 존재한다', iPick > -1);
t('커버 렌더가 존재한다', iRender > -1);
t('실측 → 판형 순서다', iMeasure > -1 && iPick > -1 && iMeasure < iPick, iMeasure + ' vs ' + iPick);
t('판형 → 커버 순서다', iPick > -1 && iRender > -1 && iPick < iRender, iPick + ' vs ' + iRender);
t('영상이면 무조건 reels 로 찍던 옛 규칙이 없다',
  !/items\[0\]\.type === 'video' \? 'reels' : 'feed'/.test(CRON));
t('오버레이 굽기가 reels 로 고정돼 있지 않다',
  !/renderOverlay\([^)]*variant: 'reels'/.test(CRON));
t('오버레이가 정해진 판형을 쓴다', /renderOverlay\([^)]*\{ variant \}/.test(CRON));

console.log('\n[7] 게이트에 걸린 건은 조용히 사라지지 않는다');
t('상태로 남긴다', /skipped_no_celeb/.test(CRON));
t('사유를 error 에 적는다', /error: gate\.reason/.test(CRON));
t('막힌 건의 entities 를 보관한다 (게이트가 과한지 나중에 셀 수 있어야 한다)',
  /entities: gen\.entities/.test(CRON));
t('크론 노트에 남는다', /셀럽 없음으로 건너뜀/.test(CRON));

console.log('\n[8] 프롬프트가 kind 를 요구한다 (게이트의 재료)');
t('person 예시가 있다', /"kind": "person"/.test(IMP));
t('group 예시가 있다', /"kind": "group"/.test(IMP));
t('brand 예시가 있다', /"kind": "brand"/.test(IMP));
t('셋 중 하나만 쓰라고 못박는다', /셋 중 하나만/.test(IMP));

console.log('\n[9] DB 제약이 코드가 쓰는 상태를 전부 허용한다');
/* 2026-08-26 에 실제로 터져 있던 구멍: 코드가 web_queued 등 4개를 쓰는데
   CHECK 제약에 없어서 "웹만" 경로가 한 번도 동작하지 못했다(실측 web_ 상태 0행).
   상태를 늘릴 때 마이그레이션을 같이 안 고치면 조용히 같은 일이 난다. */
const MIG = fs.readFileSync(path.join(ROOT, 'supabase_migrations', '137_celeb_queue_status_values.sql'), 'utf8');
const CRON_STATUSES = Array.from(new Set(
  (CRON.match(/status: '[a-z_]+'/g) || []).map((m) => m.slice(9, -1))
));
t('크론에서 상태 값을 실제로 뽑았다 (5개 이상)', CRON_STATUSES.length >= 5, CRON_STATUSES);
const missing = CRON_STATUSES.filter((v) => !MIG.includes("'" + v + "'"));
t('코드가 쓰는 상태가 전부 마이그레이션에 있다', missing.length === 0, missing);
t('웹 전용 경로 상태 4개가 들어 있다',
  ['web_queued', 'web_publishing', 'web_published', 'web_publish_failed']
    .every((v) => MIG.includes("'" + v + "'")));
t('셀럽 게이트 상태가 들어 있다', MIG.includes("'skipped_no_celeb'"));

console.log('\n' + (fail ? '✗' : '✓') + ' celeb-brief-ratio-gate: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
