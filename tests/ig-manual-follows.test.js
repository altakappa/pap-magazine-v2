/**
 * 릴스 팔로우 수동 기록 — tests/ig-manual-follows.test.js (2026-09-07 신설)
 * 텔레그램 "팔로우 <숏코드|링크> <숫자>" → ig_manual_follows → ig_post_latest.follows COALESCE(146)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('      ', d); } }
const lib = require(path.join(ROOT, 'api', '_lib', 'igManualFollows.js'));

console.log('=== 1. 명령 파싱 (본문은 데이터 — 정규식 형태만) ===');
{
  const p = lib.parseFollowCommand;
  t('숏코드 + 숫자', JSON.stringify(p('팔로우 DcxDxXBPE60 74')) === JSON.stringify({ shortcode: 'DcxDxXBPE60', follows: 74 }));
  t('릴스 링크', p('팔로우 https://www.instagram.com/reel/DcxDxXBPE60/ 74').shortcode === 'DcxDxXBPE60');
  t('p 링크 + 슬래시 명령', p('/팔로우 https://instagram.com/p/Dc3QFSFGd7-/?igsh=x 17').shortcode === 'Dc3QFSFGd7-');
  t('앞뒤 공백 허용', p('  팔로우 ABCDEF 3  ').follows === 3);
  t('다른 메시지는 null (게시 명령 흐름을 건드리지 않는다)', p('올려 12') === null && p('https://instagram.com/reel/abc/') === null && p('') === null);
  t('숫자 없으면 null', p('팔로우 DcxDxXBPE60') === null);
  t('7자리 이상 숫자는 거절', p('팔로우 DcxDxXBPE60 1234567') === null);
  t('숏코드가 아닌 토큰은 error', p('팔로우 설윤 74') && p('팔로우 설윤 74').error);
  t('extractShortcode: 코드 그대로', lib.extractShortcode('Dc-k-uDGfiA') === 'Dc-k-uDGfiA');
  t('extractShortcode: 4자는 거절', lib.extractShortcode('abcd') === null);
}

console.log('\n=== 2. 저장 (supabase 스텁) ===');
{
  const calls = [];
  const mk = (rows) => ({
    from(tbl) {
      const chain = { _tbl: tbl, _up: null,
        select() { return chain; }, ilike() { return chain; }, limit() { return chain; },
        upsert(row, opt) { chain._up = { row, opt }; calls.push({ tbl, row, opt }); return chain; },
        then(ok, err) {
          if (tbl === 'ig_post_latest') return Promise.resolve({ data: rows, error: null }).then(ok, err);
          return Promise.resolve({ error: null }).then(ok, err);
        } };
      return chain;
    } });
  (async () => {
    const r1 = await lib.recordManualFollows(mk([{ post_id: '18', permalink: 'https://www.instagram.com/reel/DcxDxXBPE60/', media_type: 'VIDEO', follows: null, reach: 21419 }]),
      { shortcode: 'DcxDxXBPE60', follows: 74 }, '12345');
    t('저장 성공 메시지', r1.ok && /기록했습니다/.test(r1.message), r1.message);
    t('ig_manual_follows 에 post_id 로 upsert', calls[0] && calls[0].tbl === 'ig_manual_follows' && calls[0].row.post_id === '18' && calls[0].opt.onConflict === 'post_id');
    t('/1k 를 같이 말해준다 (74/21419 = 3.5)', /3\.5\/1k/.test(r1.message), r1.message);
    const r2 = await lib.recordManualFollows(mk([]), { shortcode: 'ZZZZZZ', follows: 1 }, '1');
    t('우리 표에 없는 게시물은 거절', !r2.ok && /없는 게시물/.test(r2.message));
    const r3 = await lib.recordManualFollows(mk([{ post_id: '19', permalink: 'p/X/', media_type: 'CAROUSEL_ALBUM', follows: 12, reach: 10000 }]),
      { shortcode: 'X', follows: 30 }, '1');
    t('캐러셀에 API 값이 있으면 API 값 우선임을 알려준다', r3.ok && /API 값 12/.test(r3.message), r3.message);

    console.log('\n=== 3. 배선·마이그레이션 ===');
    const wh = fs.readFileSync(path.join(ROOT, 'api/telegram/webhook.js'), 'utf8');
    t('웹훅이 파서를 부른다', /parseFollowCommand\(parsed\.text\)/.test(wh));
    t('게시 명령("올려") 앞에서 처리한다', wh.indexOf('parseFollowCommand') < wh.indexOf('parsed.publishCommand'));
    t('허용 chat 검사 뒤에서 처리한다 (아무나 못 적는다)', wh.indexOf('chat_not_allowed') < wh.indexOf('parseFollowCommand'));
    const mig = fs.readFileSync(path.join(ROOT, 'supabase_migrations/146_ig_manual_follows.sql'), 'utf8');
    t('146: 표 + RLS + service_role 전용', /CREATE TABLE IF NOT EXISTS public\.ig_manual_follows/.test(mig)
      && /ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.ig_manual_follows FROM anon, authenticated/.test(mig));
    t('146: 뷰가 COALESCE(API, 수동) 로 흡수', /COALESCE\(l\.follows, mf\.follows\) AS follows/.test(mig));
    t('146: 뷰 열 계약 유지 (follows_per_1k 그대로)', /AS follows_per_1k/.test(mig));

    console.log(`\npassed: ${pass}   failed: ${fail}`);
    if (fail) { console.log('❌ ig-manual-follows tests FAILED'); process.exit(1); }
    console.log('✅ ig-manual-follows tests passed');
  })();
}
