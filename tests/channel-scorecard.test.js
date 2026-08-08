/**
 * 주간 채널 성적표 — tests/channel-scorecard.test.js (2026-08-08 신설)
 *
 * 성장 가이드라인 6번의 집행 장치: "채널 성적은 두 도달점(IG·웹)으로 몇 명을
 * 보냈나로만 잰다." 데이터는 이미 쌓이는데 사람이 매주 꺼내 보지 않아
 * 죽은 지표였다 — weekly-briefing 에 자동 표로 싣는다.
 *
 * 여기서 지키는 것:
 *   ① 성적표는 결정론 — AI 가 숫자를 만들지 않는다
 *   ② AI 서사가 실패해도 성적표는 나간다 (숫자를 AI 가용성에 인질 잡히지 않게)
 *   ③ 채널 목록이 socialInclick 화이트리스트와 어긋나지 않는다
 *   ④ 진성 한국인 전선(네이버·카카오)이 표의 맨 앞이다
 *   ⑤ 기존 브리핑 저장·메일 배선을 깨지 않는다
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

const sc = require(path.join(ROOT, 'api', '_lib', 'channelScorecard.js'));
const libSrc = R('api/_lib/channelScorecard.js');
const wb = R('api/cron/weekly-briefing.js');
const si = R('api/_lib/socialInclick.js');

console.log('\n[1] 채널 목록 — 계측 화이트리스트와 한 몸');
{
  const wl = (si.split('SRC_WHITELIST')[1] || '').split(']')[0];
  const wlChannels = (wl.match(/'([a-z]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  const missing = wlChannels.filter((c) => !sc.CHANNELS.includes(c));
  t('화이트리스트 채널이 성적표에 전부 있다', missing.length === 0, '누락: ' + missing.join(','));
  t("미등록 소스 폴백('other')이 있다", sc.CHANNELS.includes('other'));
  t('진성 한국인 전선이 맨 앞 (네이버 → 카카오)', sc.CHANNELS[0] === 'naver' && sc.CHANNELS[1] === 'kakao');
}

console.log('\n[2] 렌더 — 결정론 마크다운');
{
  const md = sc.renderScorecardMd({
    inflow: [
      { ch: 'naver', cur: 12, prev: 8 }, { ch: 'kakao', cur: 5, prev: 0 },
      { ch: 'x', cur: 0, prev: 0 }, { ch: 'other', cur: 1, prev: 2 },
    ],
    igOut: { cur: 1200, prev: 1500 },
    newMembers: { cur: 7, prev: 7 },
    paidTotal: 3,
  });
  t('제목이 집계 방식(7일 vs 7일)을 밝힌다', /지난 7일 vs 그 전 7일/.test(md));
  t('전주 대비 %를 계산한다 (12 vs 8 → +50%)', /\+50%/.test(md));
  t('0→n 은 NEW 로 표기', /NEW/.test(md));
  t('0/0 채널은 표에서 뺀다 (x 행 없음)', !/\| X \|/.test(md));
  t('합계 행이 있다', /\*\*합계\*\*/.test(md) && /\*\*18\*\*/.test(md));
  t('웹→IG(플라이휠 절반)를 싣는다', /웹 → 인스타그램/.test(md) && /1200/.test(md));
  t('유료 구독자 = 북극성 ②', /유료 구독자/.test(md) && /북극성 ②/.test(md));
  t('IG 인사이트(북극성 ①)는 수동임을 명시', /수동 확인/.test(md));
  t('0% 는 +0% 로 (7 vs 7)', /\+0%/.test(md));
}

console.log('\n[3] 집계 소스 — 올바른 컬럼·필터');
{
  t('유입은 clicked_at 기준 (created_at 아님 — 실제 스키마)', /clicked_at', d14/.test(libSrc));
  t('유료는 standard·premium 만 센다', /\['standard', 'premium'\]/.test(libSrc));
  t('유입 행 상한이 있다 (폭증 대비)', /limit\(20000\)/.test(libSrc));
}

console.log('\n[4] weekly-briefing 배선');
{
  t('브리핑이 성적표 lib 를 부른다', /require\('\.\.\/_lib\/channelScorecard'\)/.test(wb)
    && /buildChannelScorecard/.test(wb));
  t('성적표 실패가 브리핑을 못 막는다 (best-effort)', /scorecard failed/.test(wb));
  t('AI 입력에도 원자료를 넘긴다 (서사 근거)', /채널 성적표\(7일 vs 전 7일/.test(wb));
  t('표는 결정론으로 뒤에 붙인다', /renderScorecardMd\(scorecard\)/.test(wb));
  t('AI 가 죽어도 성적표 단독 발송', /briefing \? \(briefing \+ '\\n\\n---\\n\\n' \+ scMd\) : scMd/.test(wb));
  t('model 실패 표기는 AI 기준 유지 (aiOk)', /const aiOk = !!briefing/.test(wb)
    && /model: aiOk \? model/.test(wb));
  t('metrics 에 북극성 수치 저장 (대시보드 시계열)', /paid_total/.test(wb) && /ig_out_7d/.test(wb));
  t('기존 배선 유지 — weekly_briefings upsert + 메일', /weekly_briefings/.test(wb)
    && /briefingRecipients\(\)/.test(wb));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ channel-scorecard tests FAILED'); process.exit(1); }
console.log('✅ channel-scorecard tests passed');
