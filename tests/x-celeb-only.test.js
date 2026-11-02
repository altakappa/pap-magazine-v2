/**
 * X 는 셀럽 기사만 (2026-11-02, 도메니코 "셀럽에 관련된 기사만 X에 올리는걸로 설정하자")
 *   ① 판정: 태그 마커 celeb → 통과 · 아니면 AI 한 번 · AI 실패면 안 올림 · X_SCOPE=all 이면 전부
 *   ② 연결: 기사 자동 게시 · 다이제스트(셀럽 갈래만) · 부스트(화보는 X 제외)
 * + Buffer 429 원인 기록 (어느 상한인지 남기고, 서버가 준 해제 시각을 따른다)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

(async () => {
  const G = require(path.join(ROOT, 'api', '_lib', 'xCelebGate.js'));
  const oldScope = process.env.X_SCOPE; delete process.env.X_SCOPE;

  console.log('\n[1] 판정 (실제 10/19~11/02 기사)');
  {
    let asked = 0;
    const deps = (kind) => ({ ask: async () => { asked++; return kind; }, save: async () => {} });
    const r1 = await G.celebForX({ title: '리사가 금발로 킬빌의 키도가 됐다', tags: ['lisa', 'blackpink', 'kpop'] }, deps('collection'));
    t('아이돌(마커) → AI 안 묻고 통과', r1.post === true && r1.why === 'marker' && asked === 0, r1);
    const r2 = await G.celebForX({ id: 'a', title: '가벼운 패딩으로 겨울을 준비하는 변우석의 법칙', tags: ['byeon wooseok', 'discovery expedition'] }, deps('celeb'));
    t('배우(마커 못 잡음) → AI celeb → 통과', r2.post === true && r2.why === 'ai_celeb' && asked === 1, r2);
    const r3 = await G.celebForX({ title: '해체의 미학을 퍼포먼스로, 젠틀몬스터 X 메종 마르지엘라', tags: ['gentle monster', 'maison margiela'] }, deps('collection'));
    t('브랜드 기사 → AI collection → 안 올림', r3.post === false && r3.why === 'ai_collection', r3);
    const r4 = await G.celebForX({ title: '애플 맥북', tags: ['apple'] }, deps(null));
    t('AI 실패 → 안 올림 (돈 드는 쪽이 기본값 아님)', r4.post === false && r4.why === 'ai_unavailable', r4);
    const r5 = await G.celebForX({ title: 'x', tags: [] }, { ask: async () => { throw new Error('boom'); } });
    t('예외도 던지지 않고 안 올림', r5.post === false && r5.why === 'error', r5);
    let saved = null;
    await G.celebForX({ id: 'art1', title: '배우 우도환', tags: ['woo do-hwan'] }, { ask: async () => 'celeb', save: async (id, k) => { saved = [id, k]; } });
    t('AI 판정은 저장해 celeb-classify 가 다시 안 묻게', saved && saved[0] === 'art1' && saved[1] === 'celeb');
    process.env.X_SCOPE = 'ALL';
    const r6 = await G.celebForX({ title: '애플 맥북', tags: ['apple'] }, deps('collection'));
    t('X_SCOPE=all → 전부 (예전 동작)', r6.post === true && r6.why === 'scope_all' && G.xScopeAll());
    delete process.env.X_SCOPE;
    t('기본은 셀럽 한정', G.xScopeAll() === false);
    const gs = R('api/_lib/xCelebGate.js');
    t('celeb-classify 와 같은 프롬프트 재사용', /require\('\.\.\/cron\/celeb-classify'\)/.test(gs) && /cc\.SYSTEM/.test(gs));
    t('저장은 빈 칸에만 (사람이 고친 값 보호)', /\.is\('digest_kind', null\)/.test(gs));
  }

  console.log('\n[2] 연결');
  {
    const si = R('api/cron/sync-instagram.js');
    const gi = si.indexOf("require('../_lib/xCelebGate').celebForX(");
    const ci = si.indexOf("const clash = await recentClash(generated.tags);");
    const pi = si.indexOf('await postTweet(');
    t('기사 자동 게시: 판정이 주제 가드·게시보다 먼저', gi > 0 && gi < ci && ci < pi, { gi, ci, pi });
    t('기사 자동 게시: 셀럽 아니면 X 만 건너뛴다 (xTopicSkip 재사용)', /if \(!xGate\.post\) \{[\s\S]{0,300}xTopicSkip: true/.test(si));
    const sd = R('api/cron/social-digest.js');
    t('다이제스트: 셀럽 갈래 아니면 X 제외', /if \(bucket !== 'celeb' && !require\('\.\.\/_lib\/xCelebGate'\)\.xScopeAll\(\)\) allowed = allowed\.filter\(\(p\) => p !== 'x'\)/.test(sd));
    const gb = R('api/_lib/goldenBoost.js');
    t('부스트: 화보는 X 제외', /o\.kind === 'editorial' \? \{ post: false, why: 'editorial' \}/.test(gb));
    t('부스트: 그 밖은 캡션으로 판정', /gateMod\.celebForX\(\{ title: String\(m\.caption \|\| ''\)/.test(gb));
    t('부스트: 막히면 X 호출 안 함', /\} else if \(!xGate\.post\) \{\s*xErr = '셀럽 한정\('/.test(gb));
  }

  console.log('\n[3] Buffer 429 원인 기록');
  {
    const B = require(path.join(ROOT, 'api', '_lib', 'buffer.js'));
    const hdr = (o) => ({ headers: { get: (k) => (o[k] == null ? null : String(o[k])) } });
    const now = Date.parse('2026-11-02T00:00:00Z');
    const reason = B.rateLimitReason(hdr({ 'retry-after': '120', 'x-ratelimit-remaining': '0' }), { error: 'monthly limit' });
    t('사유에 헤더·본문이 남는다', /retry-after=120/.test(reason) && /x-ratelimit-remaining=0/.test(reason) && /monthly limit/.test(reason), reason);
    t('retry-after 초', B.rateLimitUntil(hdr({ 'retry-after': '120' }), now) === now + 120000);
    t('retry-after 날짜', B.rateLimitUntil(hdr({ 'retry-after': 'Mon, 03 Nov 2026 00:00:00 GMT' }), now) === Date.parse('2026-11-03T00:00:00Z'));
    t('reset epoch 초', B.rateLimitUntil(hdr({ 'x-ratelimit-reset': '1793750400' }), now) === 1793750400000);
    t('헤더 없으면 null (기본 6시간)', B.rateLimitUntil(hdr({}), now) === null);
    const bb = R('api/_lib/bufferBreaker.js');
    t('차단기가 서버 해제 시각을 따른다 (31일 넘는 값은 버림)', /async function trip\(reason, opts\)/.test(bb) && /31 \* 86400000/.test(bb));
  }

  if (oldScope !== undefined) process.env.X_SCOPE = oldScope;
  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ x-celeb-only tests FAILED'); process.exit(1); }
  console.log('✅ x-celeb-only tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
