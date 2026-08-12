/**
 * 골든아워 부스트 — tests/golden-boost.test.js (2026-08-09 신설)
 *
 * "메타 광고 없이 참여 광고 효과" 요청의 정직한 구현: 광고가 사는 것은
 * 게시 직후 초기 속도이고 (PAP 실측: 캐러셀 첫 3시간 좋아요 ↔ 최종 도달
 * corr 0.94), 그 초기 속도를 우리 채널(스레드·X)로 만든다.
 *
 * 여기서 지키는 것:
 *   ① 게시물당 부스트 정확히 1회 — claim-first (틱톡 이중게시 사고 재발 금지)
 *   ② 골든아워(90분) 밖·백필 모드에서는 침묵
 *   ③ 링크는 ig-out?src=boost 경유 (성장 헌법 3조 — 측정 없는 발신 금지)
 *   ④ 부스트 실패가 수집(sync-instagram)을 절대 못 막는다
 *   ⑤ 부풀리기 아님 — 실제 우리 팔로워에게 알리는 것뿐 (봇·품앗이 코드 부재)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

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

const gb = require(path.join(ROOT, 'api', '_lib', 'goldenBoost.js'));
const src = R('api/_lib/goldenBoost.js');
const sync = R('api/cron/sync-instagram.js');
const igOut = R('api/ig-out.js');
const mig = R('supabase_migrations/113_ig_boosts.sql');

console.log('\n[1] 창(window) — 뒷북 부스트는 소음');
{
  const now = Date.parse('2026-08-09T12:00:00Z');
  t('30분 전 게시물은 부스트 대상', gb.withinGoldenWindow('2026-08-09T11:30:00Z', now));
  t('89분 전도 대상 (기본 90분)', gb.withinGoldenWindow('2026-08-09T10:31:00Z', now));
  t('3시간 전은 침묵', !gb.withinGoldenWindow('2026-08-09T09:00:00Z', now));
  t('미래 시각(시계 오차)은 거부', !gb.withinGoldenWindow('2026-08-09T13:00:00Z', now));
  t('깨진 timestamp 는 거부', !gb.withinGoldenWindow('not-a-date', now));
}

console.log('\n[2] 1회 보장 — claim-first');
{
  t('INSERT 를 먼저 하고 23505 로 판단한다 (읽고-쓰기 금지)',
    src.indexOf(".insert(") < src.indexOf("error.code === '23505'"));
  t('마이그레이션이 post_id PK (부분 인덱스 아님)', /post_id text primary key/.test(mig)
    && !/unique index[\s\S]{0,80}where/i.test(mig));
  t('백필 모드는 즉시 침묵', /backfillMode\) return \{ boosted: false, reason: 'backfill' \}/.test(src));
}

console.log('\n[3] 링크 — 측정 없는 발신 금지');
{
  const text = gb.boostText('https://www.instagram.com/p/ABC123/?igshid=x');
  t('ig-out?src=boost 경유', text.indexOf('/api/ig-out?src=boost&to=post') >= 0, text);
  t('추적 쿼리(igshid) 제거 후 인코딩', text.indexOf('igshid') === -1
    && text.indexOf(encodeURIComponent('https://www.instagram.com/p/ABC123/')) >= 0);
  t("ig-out 화이트리스트에 'boost' 등록", /'newsletter', 'boost'/.test(igOut));
}

console.log('\n[4] sync-instagram 배선 — 자동 게시가 없는 모든 지점');
{
  /* 2026-08-09 확장: 에디토리얼 스킵 3지점 + 품질 게이트 draft = 4지점.
     발행 기사형은 제외 — 기존 자동 게시와 같은 채널 이중 게시 방지. */
  /* 2026-08-09 B-7: kind 를 넘긴다 — 에디토리얼만 웹 푸시가 함께 나간다 */
  const hooksEd = (sync.match(/maybeBoostPost\(m, \{ backfillMode, kind: 'editorial' \}\)/g) || []).length;
  const hooksDr = (sync.match(/maybeBoostPost\(m, \{ backfillMode, kind: 'draft' \}\)/g) || []).length;
  t('부스트 3지점 (에디토리얼 2 + draft 1) (' + hooksEd + '+' + hooksDr + '/3)', hooksEd === 2 && hooksDr === 1);

  /* 2026-08-12 회귀 — 개수만 세던 이 테스트는 "4지점" 을 통과시켰지만 그중 2개가
     도달 불가 코드였다. 백필 블록(`if (backfillMode && !dry)`) 안의 `!backfillMode`
     가드는 절대 참이 되지 않는다. ig_boosts 가 신설 후 0건이던 진짜 이유다.
     이제 개수가 아니라 **위치**를 검증한다. */
  const backfillStart = sync.indexOf('if (backfillMode && !dry){');
  const backfillEnd = sync.indexOf('// ═══ 최근-동기화(backfillDays===0)');
  t('백필 블록 경계를 찾을 수 있다', backfillStart > 0 && backfillEnd > backfillStart,
    backfillStart + '/' + backfillEnd);
  const insideBackfill = sync.slice(backfillStart, backfillEnd);
  t('백필 블록 안에는 부스트 호출이 없다 (도달 불가 코드 금지)',
    insideBackfill.indexOf('maybeBoostPost') === -1);
  t('최근-동기화 경로의 에디토리얼 스킵에 부스트가 걸려 있다',
    /if \(cls !== 'article'\)\{[\s\S]{0,900}?maybeBoostPost\(m, \{ backfillMode, kind: 'editorial' \}\)/.test(sync));
  t('그 스킵 지점은 백필 블록 밖이다',
    sync.indexOf("if (cls !== 'article'){") > backfillEnd);
  t('lib 를 require 한다', /require\('\.\.\/_lib\/goldenBoost'\)/.test(sync));
  t('부스트 수를 결과에 센다', /results\.boosted = \(results\.boosted\|\|0\)\+1/.test(sync));
  t('draft 지점은 발행 분기 앞에 있다 (발행 기사는 부스트 안 탐)',
    sync.indexOf("pubStatus !== 'published' && !backfillMode") < sync.indexOf("if (h && pubStatus === 'published')"));
  t('발행 기사 자동 게시는 그대로 (이중 게시 없음)', /pubStatus === 'published'/.test(sync));
  t('구이름 호환 export 유지', /maybeBoostEditorialPost: maybeBoostPost/.test(R('api/_lib/goldenBoost.js')));
}

console.log('\n[5] 실패 격리 — 부스트가 수집을 못 막는다');
{
  t('본체가 전체 try/catch (실패도 반환값으로)', /catch \(e\) \{\n    return \{ boosted: false/.test(src));
  t('스레드 실패는 warn 만', /\[boost\] threads 실패/.test(src));
  t('X 실패는 warn 만', /\[boost\] x 실패/.test(src));
  t('결과 기록 실패도 삼킨다 (부스트는 이미 나갔다)', /결과 기록 실패는 삼킨다/.test(src));
}

console.log('\n[6] 부풀리기 아님 — 헌법 6조');
{
  t('봇·좋아요 생성 코드가 없다 (알림만)', !/like|follow_request|comment_create/i.test(
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ golden-boost tests FAILED'); process.exit(1); }
console.log('✅ golden-boost tests passed');
