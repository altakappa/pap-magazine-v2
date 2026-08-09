/**
 * 번역 경보 발행 유예 (2026-08-09 헛경보).
 *
 * ── 무슨 일이 있었나 (초 단위) ──────────────────────────────────────
 *   09:30:33  새 기사 발행 「살갗을 부딪히던 서브컬처의 냉만은 어디로」
 *   09:31:34  pipeline-watch → 잔량 7(1기사×7언어) · 3시간 저장 0 → 🚨 경보
 *   09:32:10  번역 크론이 7개 언어 전부 저장 (경보 36초 뒤)
 * 아무 문제도 없었다. 발행~번역 사이 ~2분 틈에 감시가 들어온 것뿐이다.
 *
 * ── 왜 이제 터졌나 ──────────────────────────────────────────────────
 * 판정 규칙은 "잔량>0 인데 창 안에 저장 0 → 정체" 다. 어제까지는 백필이 계속
 * 돌아 '3시간 저장 0'이 될 일이 없었다. 2026-08-09 전 조합 완주 이후로는
 * **평상시가 저장 0** 이다. 그래서 기사 하나만 발행돼도 경보가 울 수 있다.
 * 실측: 최근 30일 발행 기사 1,875건(하루 62건) · 감시는 30분 주기
 *       → 쿨다운 6시간이 막아줘도 하루 1~4회 헛경보.
 * 헛경보가 반복되면 진짜 정체를 놓친다 — 감시를 만든 이유가 무너진다.
 *
 * ── 고친 방법 ───────────────────────────────────────────────────────
 * pipeline-watch 가 IG 파이프라인 감시에 이미 쓰던 유예를 번역에도 붙였다.
 * (그 파일 머리말: "GRACE_HOURS 보다 오래된 게시물만 본다 — 방금 올린 건
 *  아직 정상 대기 중이다.")  마이그레이션 117: 발행 30분 이내는 잔량에서 뺀다.
 *
 * 30분 근거: 번역 크론은 2분 주기 → 유예 안에 15번 기회. 실측 처리 97초.
 * 30분을 넘겨도 안 되면 진짜 정체이고, 다음 감시(30분 주기)에서 정상 경보된다.
 * **진짜 장애는 최대 30분 늦을 뿐, 놓치지 않는다.**
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 117 이 잔량(remaining)에만 유예를 걸 것
 *   ② produced·done·total_targets 에는 유예를 걸지 말 것
 *      (분모가 흔들리면 진행률이 "100% → 99.9%" 로 널뛴다)
 *   ③ 107 의 CJK 문턱과 6,000자 상한을 함께 데려올 것 (한쪽만 고치는 사고 방지)
 *   ④ 판정 규칙(_lib/translateHealth.js)은 그대로 — 유예는 DB 쪽 책임이다
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase_migrations/117_translate_health_publish_grace.sql');
const HEALTH = fs.readFileSync(path.join(ROOT, 'api/_lib/translateHealth.js'), 'utf8');
const WATCH = fs.readFileSync(path.join(ROOT, 'api/cron/pipeline-watch.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 240)); }
}

t('117 마이그레이션이 있다', fs.existsSync(MIG));
if (!fs.existsSync(MIG)) { console.log('\npassed: ' + pass + '   failed: ' + fail); process.exit(1); }

const raw = fs.readFileSync(MIG, 'utf8');
/* 주석에 설명이 길게 들어 있다. 실행문만 골라 검사한다 —
   주석의 단어를 근거로 통과시키면 아무것도 지키지 못한다. */
const sql = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

console.log('\n=== ① 잔량에만 유예가 걸린다 ===');
t('유예 CTE(aged)가 있다', /\baged as \(/.test(sql));
t('30분 유예다', /interval '30 minutes'/.test(sql), (sql.match(/interval '[^']+'/g) || []).join(','));
t('아티클·에디토리얼 양쪽에 건다',
  (sql.match(/created_at <= now\(\) - interval '30 minutes'/g) || []).length >= 2);
t('잔량이 aged_pairs 를 센다', /as remaining/.test(sql) && /from aged_pairs p/.test(sql));

console.log('\n=== ② 진행률에는 유예를 걸지 않는다 ===');
/* remaining · produced · done · total 네 개의 select 를 순서대로 잘라 각각 검사한다. */
const tail = sql.slice(sql.lastIndexOf('aged_pairs as ('));
const segs = tail.split(/\bas (remaining|produced|done|total_targets)\b/);
function segFor(label) {
  const i = segs.indexOf(label);
  return i > 0 ? segs[i - 1] : '';
}
t('produced 는 aged 를 안 쓴다', !/aged/.test(segFor('produced')), segFor('produced'));
t('done 은 pairs(전체)를 쓴다', /from pairs p/.test(segFor('done')) && !/aged/.test(segFor('done')));
t('total_targets 는 pairs(전체)를 쓴다',
  /from pairs\)?/.test(segFor('total_targets')) && !/aged/.test(segFor('total_targets')));
t('remaining 만 aged 를 쓴다', /aged_pairs/.test(segFor('remaining')));

console.log('\n=== ③ 107 의 성과를 데려온다 (한쪽만 고치는 사고 방지) ===');
t('CJK 문턱 40 이 유지된다',
  /case when t\.lang in \('ja','zh'\) then 40 else 100 end/.test(sql),
  'ja·zh 문턱이 사라지면 경보가 영원히 운다 (107 사고 재발)');
t('CJK 문턱이 두 곳 모두에 있다 (filled · produced)',
  (sql.match(/then 40 else 100 end/g) || []).length >= 2);
t('6,000자 상한이 유지된다', /<= 6000/.test(sql),
  '크론이 제외하는 긴 글을 여기서 세면 영원히 안 줄어드는 잔량이 생긴다');
t('에디토리얼 description 문턱 40 유지', /coalesce\(t\.description,''\)\)\) >= 40/.test(sql));
t('7개 언어 그대로', /\('it'\),\('fr'\),\('es'\),\('ja'\),\('de'\),\('ru'\),\('zh'\)/.test(sql));
t('함수 시그니처가 그대로다 (호출부가 안 깨진다)',
  /translate_health_stats\(window_hours integer DEFAULT 3\)/.test(sql)
  && /RETURNS TABLE\(remaining bigint, produced bigint, done bigint, total_targets bigint\)/.test(sql));

console.log('\n=== ④ 판정 규칙은 그대로 (유예는 DB 책임) ===');
t('잔량 0 이면 완주로 본다', /if \(remaining === 0\)/.test(HEALTH));
t('생산 0 이면 정체로 본다', /if \(produced === 0\)/.test(HEALTH));
t('감시가 여전히 RPC 로 통계를 받는다', /rpc\('translate_health_stats'/.test(WATCH));
/* 같은 유예를 JS 에도 또 적으면 두 곳이 어긋난다 — 107 이 그래서 터졌다. */
t('JS 판정에 유예 상수를 중복해 두지 않았다',
  !/GRACE/i.test(HEALTH), '유예는 SQL 한 곳에만 있어야 한다');

console.log('\n=== IG 감시가 쓰던 같은 개념인지 (근거 고정) ===');
t('pipeline-watch 에 GRACE_HOURS 가 존재한다', /GRACE_HOURS/.test(WATCH));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ translate-health-grace tests passed');
