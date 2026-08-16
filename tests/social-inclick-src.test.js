/**
 * 유입 출처 계측 — 원본 보존 · 새 출처 이름 노출 (2026-08-10 신설)
 *
 * 왜 필요했나 — 실측(8/4~8/10): 유입 93건 중 67건(72%)이 'other'.
 *   리퍼러 없음 + 모바일 + 고유 방문자 33명 → 앱 내부 브라우저에서 온
 *   진짜 사람인데 어느 앱인지 기록이 없다.
 *
 *   원인은 목록이 짧아서가 아니라 **모르는 값을 만나면 원본을 버리는 설계**다.
 *   2026-08-07 에 'threads' 를 목록에 채워 넣는 방식으로 고쳤는데 사흘 만에
 *   같은 사고가 재발했다. 다음에 뭐가 올지 우리는 모른다.
 *
 * 여기서 지키는 것:
 *   ① 모르는 출처도 원본을 남길 것 ← 사고의 핵심
 *   ② 쓰레기 값은 막을 것 (길이·문자 제한)
 *   ③ 같은 출처의 다른 표기는 하나로 모을 것 (instagram=ig)
 *   ④ 집계에서 다시 'other' 로 뭉개지 말 것 (고친 의미가 사라진다)
 *   ⑤ 표가 무한정 길어지지 않을 것 (상위 N개 + 나머지 접기)
 *   ⑥ 합계는 어떤 경우에도 원본 행 수와 같을 것 (숫자가 새면 안 된다)
 */
'use strict';

const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}
function inject(p, exports) {
  const m = new Module(p, null);
  m.filename = p; m.loaded = true; m.exports = exports;
  require.cache[p] = m;
}

inject(path.join(ROOT, 'api', '_lib', 'supabase.js'), { supabaseAdmin: { from: () => ({}) } });
inject(path.join(ROOT, 'api', '_lib', 'clickGuard.js'), {
  extractClientIp: () => '1.2.3.4', hashIp: () => 'h', detectDeviceType: () => 'mobile',
  sanitizeReferrer: () => null, isLikelyBot: () => false,
});
const { normalizeSrc } = require(path.join(ROOT, 'api', '_lib', 'socialInclick.js'));

console.log('[1] 모르는 출처도 원본을 남긴다 (핵심)');
t("zalo 가 zalo 로 남는다", normalizeSrc('zalo') === 'zalo', normalizeSrc('zalo'));
t("line 이 line 으로 남는다", normalizeSrc('line') === 'line');
t("처음 보는 값도 그대로", normalizeSrc('weverse') === 'weverse');
t("대문자는 소문자로", normalizeSrc('Zalo') === 'zalo');
t("앞뒤 공백 제거", normalizeSrc('  discord  ') === 'discord');

console.log('[2] 별칭은 하나로 모은다');
[['instagram','ig'],['insta','ig'],['IG_Story','ig'],['twitter','x'],['thread','threads'],
 ['kakaotalk','kakao'],['naver_blog','naver'],['yt','youtube'],['email','newsletter']].forEach(([a,b]) => {
  t(a + ' → ' + b, normalizeSrc(a) === b, normalizeSrc(a));
});
t('이미 정식 이름이면 그대로', normalizeSrc('ig') === 'ig');

console.log('[3] 쓰레기 값은 막는다');
t('빈 값 → other', normalizeSrc('') === 'other');
t('null → other', normalizeSrc(null) === 'other');
t('기호만 → other', normalizeSrc('!!!///') === 'other');
t('한글은 밑줄로 치환되어 other', normalizeSrc('출처') === 'other', normalizeSrc('출처'));
t('24자 초과는 잘린다', normalizeSrc('a'.repeat(50)).length === 24, normalizeSrc('a'.repeat(50)).length);
t('SQL/스크립트 문자가 안 남는다', /^[a-z0-9_]+$/.test(normalizeSrc("x';drop table--")), normalizeSrc("x';drop table--"));
t('꼬리 밑줄이 안 남는다', !/_$/.test(normalizeSrc('abc!!!')), normalizeSrc('abc!!!'));

console.log('[4] 집계 — 새 출처를 이름으로 낸다');
(async function () {
  const rows = [];
  const now = Date.now();
  const cur = new Date(now - 1 * 86400000).toISOString();   // 최근 7일
  const prev = new Date(now - 10 * 86400000).toISOString(); // 그 전 7일
  const push = (src, n, ts) => { for (let i = 0; i < n; i++) rows.push({ src, clicked_at: ts }); };
  push('threads', 20, cur); push('ig', 3, cur);
  push('zalo', 7, cur); push('line', 4, cur); push('discord', 1, cur);
  push('a1', 1, cur); push('a2', 1, cur); push('a3', 1, cur); push('a4', 1, cur);
  push('other', 2, cur);
  push('threads', 5, prev);

  const CS = path.join(ROOT, 'api', '_lib', 'channelScorecard.js');
  delete require.cache[CS];
  inject(path.join(ROOT, 'api', '_lib', 'supabase.js'), {
    supabaseAdmin: {
      from(tbl) {
        const chain = {
          select(_c, opt) {
            chain._head = !!(opt && opt.head); return chain;
          },
          gte() { return chain; }, lt() { return chain; }, in() { return chain; },
          eq() { return chain; }, // 2026-08-16 — 성적표 igOut 모바일 집계(.eq)가 추가되어 스텁에도 반영
          limit() { return chain; },
          then(ok, err) {
            const r = tbl === 'social_inclicks' && !chain._head
              ? { data: rows, error: null }
              : { count: 0, error: null };
            return Promise.resolve(r).then(ok, err);
          },
        };
        return chain;
      },
    },
  });
  const { buildChannelScorecard } = require(CS);
  const sc = await buildChannelScorecard(now);
  const by = {}; sc.inflow.forEach((r) => { by[r.ch] = r; });

  t('zalo 가 이름으로 나온다', !!by.zalo && by.zalo.cur === 7, by.zalo);
  t('line 도 이름으로', !!by.line && by.line.cur === 4, by.line);
  t('고정 채널은 0건이어도 줄이 남는다', !!by.naver && by.naver.cur === 0, by.naver);
  t('새 출처는 5개까지만 이름으로', sc.inflow.filter((r) => !['naver','kakao','ig','threads','x','tiktok','youtube','newsletter','other'].includes(r.ch)).length === 5,
    sc.inflow.map((r) => r.ch));
  /* 발견된 출처 7개: zalo7 line4 discord1 a1..a4 각1.
     상위 5 = zalo, line, 그리고 1건 동률 4개 중 사전순 a1·a2·a3.
     접히는 것 = a4(1) + discord(1) = 2. 원래 other 2 를 더해 4. */
  t('나머지는 other 로 접힌다 (원래 other 2 + 접힌 2)', by.other.cur === 4, by.other);
  t('접힌 것이 정확히 a4·discord', sc.foldedIntoOther.slice().sort().join(',') === 'a4,discord', sc.foldedIntoOther);
  t('상위 5개는 이름이 남는다', ['zalo','line','a1','a2','a3'].every((k) => !!by[k]), Object.keys(by));

  const total = sc.inflow.reduce((s, r) => s + r.cur + r.prev, 0);
  t('합계가 원본 행 수와 같다 (숫자가 새지 않는다)', total === rows.length, total + ' vs ' + rows.length);

  console.log('\n' + (fail ? '✗' : '✓') + ' social-inclick-src: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
