/**
 * 번역 백필 — 마감시각(deadline) 회귀 (2026-08-04 Patch 6 신설).
 *
 * 왜 필요했나 — 오늘 실측:
 *   backfill-translations 의 평균 실행시간이 94~138초, 최대 151초가 됐고,
 *   6시간 동안 22번이 Vercel 의 120초 상한에 걸려 강제종료됐다.
 *   그런데 cron_runs 의 실패는 0건이었다 — 잘려 죽은 실행은 자기 죽음을
 *   기록할 주체가 없다. 지표만 보면 아무 일도 없었던 것처럼 보인다.
 *
 * 원인은 '약속을 지킬 책임이 있는 쪽이 약속을 몰랐던 것' 이다.
 *   크론은 "웨이브에 들어가려면 CALL_MS + 여유가 남아야 한다" 를 지켰다.
 *   그 계산은 "runBackfillBatch 한 번 = Claude 호출 한 번" 을 전제한다.
 *   Patch 5 가 그 안에 단건 재시도와 3패스 반복을 넣으면서 전제가 깨졌다 —
 *   한 번 불릴 때 호출을 최대 6번(40초 × 6 = 240초) 할 수 있게 됐다.
 *   Patch 5 자체는 옳았다. 바깥의 예산을 안쪽이 모르고 있었을 뿐이다.
 *
 * 이 테스트가 지키는 것:
 *   ① 모든 Claude 호출 **앞에서** 남은 시간을 확인할 것
 *   ② 시간이 모자라면 지금까지 저장한 만큼 돌려주고 물러날 것 (부분 성공 유지)
 *   ③ 시간에 쫓겨 못 한 것을 '완주' 로 보고하지 말 것 (ran_out_of_time)
 *   ④ 시간에 쫓겨 건너뛴 건을 그 기사의 잘못(failedIds)으로 만들지 말 것
 *   ⑤ 마감을 안 주면(관리자 수동 호출) 예전과 똑같이 동작할 것
 *   ⑥ 크론이 실제로 마감을 넘길 것 — 헬퍼만 고치고 안 넘기면 아무 소용 없다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

function inject(filePath, exports) {
  const m = new Module(filePath, null);
  m.filename = filePath;
  m.loaded = true;
  m.exports = exports;
  require.cache[filePath] = m;
}

/* ── DB 스텁 ── 잔여 5건, 이미 번역된 건 없음. */
const db = { upserts: [] };
const EDS = Array.from({ length: 5 }, (_, i) => ({
  id: 'ed-' + i,
  title: 'Title ' + i,
  title_en: 'Title ' + i,
  description: 'A source description long enough to pass the 30-char source gate. #' + i,
  description_en: 'A source description long enough to pass the 30-char source gate. #' + i,
  description_it: null,
}));
inject(SUPABASE, {
  supabaseAdmin: {
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: table === 'seo_translations' ? [] : EDS, error: null }),
        upsert: (row) => { db.upserts.push(row); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  },
});

process.env.ANTHROPIC_API_KEY = 'test-key';
const helper = require(HELPER);
const { msLeft, canCall, callBudget, CALL_SLACK_MS, runBackfillBatch } = helper;

/* ── Claude 호출 스텁 ── 호출 수를 세고, 매 호출에 실제 시간을 쓴다. */
let calls = 0;
let replyText = '';
let callDelayMs = 0;
globalThis.fetch = async function () {
  calls++;
  if (callDelayMs) await new Promise(r => setTimeout(r, callDelayMs));
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: replyText }], stop_reason: 'end_turn' }),
    text: async () => replyText,
  };
};
const batchReply = (n) => JSON.stringify(
  Array.from({ length: n }, (_, i) => ({
    i,
    title: 'Übersetzter Titel ' + i,
    description: 'Eine ausreichend lange übersetzte Beschreibung für den Test. #' + i,
  })));

(async function main() {

console.log('\n=== 남은 시간 계산 (순수 함수) ===');
(function () {
  t('마감이 없으면 무제한', msLeft(0) === Infinity && msLeft(undefined) === Infinity);
  t('마감이 있으면 남은 ms', Math.abs(msLeft(Date.now() + 5000) - 5000) < 50);
  t('지난 마감은 음수', msLeft(Date.now() - 1000) < 0);

  t('마감 없으면 언제나 호출 가능', canCall(0, 60000) === true);
  t('타임아웃 + 여유가 남아야 호출', canCall(Date.now() + 60000 + CALL_SLACK_MS + 500, 60000) === true);
  t('빠듯하면 호출하지 않는다', canCall(Date.now() + 60000, 60000) === false,
    '이게 없으면 마지막 호출이 함수 상한을 넘겨 실행 전체가 잘린다');

  t('마감 없으면 타임아웃 그대로', callBudget(0, 60000) === 60000);
  t('마감이 가까우면 타임아웃을 줄인다', callBudget(Date.now() + 10000, 60000) <= 10000 - CALL_SLACK_MS + 50);
  t('줄여도 0 이하로는 안 준다', callBudget(Date.now() - 5000, 60000) >= 1);
})();

console.log('=== 마감이 이미 지났으면 Claude 를 부르지 않는다 ===');
(function () {
  calls = 0; db.upserts.length = 0; replyText = batchReply(5); callDelayMs = 0;
})();
{
  const r = await runBackfillBatch({ lang: 'de', kind: 'editorial', batch: 5, timeoutMs: 1000,
    deadlineAt: Date.now() - 1 });
  t('호출 0회', calls === 0, 'calls=' + calls);
  t('저장 0건', db.upserts.length === 0);
  t('완주로 보고하지 않는다', r.ran_out_of_time === true, JSON.stringify(r));
  t('잔여를 그대로 남긴다', r.remaining === 5, 'remaining=' + r.remaining);
}

console.log('=== 시간이 되는 만큼만 하고 물러난다 (부분 성공 유지) ===');
{
  calls = 0; db.upserts.length = 0;
  /* 배치 응답에 5건 중 2건만 담긴다 — 나머지 3건은 단건 재시도 대상.
     그런데 첫 호출이 시간을 다 쓰게 만들어, 재시도는 시작조차 못 하게 한다. */
  replyText = batchReply(2);
  callDelayMs = 250;
  const timeoutMs = 100;
  const r = await runBackfillBatch({ lang: 'de', kind: 'editorial', batch: 5, timeoutMs,
    deadlineAt: Date.now() + timeoutMs + CALL_SLACK_MS + 60 });
  t('배치 한 번만 부른다 (단건 재시도는 마감에 막힘)', calls === 1, 'calls=' + calls);
  t('그래도 받은 2건은 저장한다', db.upserts.length === 2, 'upserts=' + db.upserts.length);
  t('처리 수를 정직하게 보고', r.processed === 2, 'processed=' + r.processed);
  t('시간에 쫓겼음을 밝힌다', r.ran_out_of_time === true, JSON.stringify(r));
  t('못 한 3건을 불량으로 낙인찍지 않는다', !r.skipped_failed,
    '여기서 failedIds 에 넣으면 멀쩡한 기사가 영영 뒤로 밀린다');
}

console.log('=== 마감을 안 주면 예전 그대로 (관리자 수동 호출) ===');
{
  calls = 0; db.upserts.length = 0; replyText = batchReply(5); callDelayMs = 0;
  const r = await runBackfillBatch({ lang: 'de', kind: 'editorial', batch: 5, timeoutMs: 5000 });
  t('배치 한 번으로 5건 처리', calls === 1 && r.processed === 5, 'calls=' + calls + ' processed=' + r.processed);
  t('시간 초과 표시 없음', r.ran_out_of_time === undefined);
  t('저장 5건', db.upserts.length === 5, 'upserts=' + db.upserts.length);
}

console.log('=== 크론이 실제로 마감을 넘기는가 (소스 대조) ===');
(function () {
  const cron = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'backfill-translations.js'), 'utf8');
  t('마감시각을 BUDGET_MS 로부터 계산한다',
    /const\s+deadlineAt\s*=\s*started\s*\+\s*BUDGET_MS\s*-\s*WAVE_SLACK_MS/.test(cron),
    '크론의 예산과 헬퍼의 마감이 같은 숫자에서 나와야 둘이 어긋나지 않는다');
  t('runBackfillBatch 에 마감을 넘긴다', /runBackfillBatch\(\{[^}]*deadlineAt[^}]*\}\)/.test(cron),
    '헬퍼만 고치고 안 넘기면 아무것도 달라지지 않는다 — 이번 사고가 그 형태였다');

  const admin = fs.readFileSync(path.join(ROOT, 'api', 'admin', 'backfill-translations.js'), 'utf8');
  /* 2026-08-08 — 이 단언을 뒤집었다.
     원래 근거는 "사람이 직접 누르는 경로까지 90초로 자를 이유가 없다" 였다.
     그런데 **Vercel 함수 상한 120초는 누가 눌렀는지 안 가린다.** 마감이
     Infinity 면 배치 호출(90초) + 단건 재시도(90초)가 180초라 함수가 그냥
     죽고, 죽으면 응답이 없어 화면에는 원인 없는 '실패'만 남는다.
     이 경로는 크론이 6,000자 상한으로 제외한 긴 글을 처리하는 유일한 통로라
     (관리자 화면 「긴 글 번역」) 정확히 그 긴 글에서 이 문제가 터진다.
     마감을 주면 스스로 접고 ran_out_of_time 으로 보고한 뒤 200 으로 나간다. */
  t('관리자 수동 경로도 마감을 준다 (함수 상한 120초는 사람을 안 가린다)',
    /deadlineAt: Date\.now\(\) \+ ADMIN_BUDGET_MS/.test(admin),
    '마감이 없으면 90초 호출이 두 번 돌 때 함수가 죽는다');
  const adminBudget = Number((admin.match(/ADMIN_BUDGET_MS = (\d+)/) || [])[1]);
  t('관리자 예산도 함수 상한 안에 있다 (예산 + 여유 ≤ 120초)',
    adminBudget > 0 && adminBudget <= 100000, adminBudget);
})();

console.log('\n' + (fail ? '✗ ' + fail + '건 실패' : '✓ 전부 통과') + ' (' + pass + '/' + (pass + fail) + ')');
process.exit(fail ? 1 : 0);
})().catch(e => { console.error('테스트 실행 실패:', e); process.exit(1); });
