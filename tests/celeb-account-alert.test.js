// PAP Magazine — 셀럽 계정 감시는 알리기만 한다 (2026-09-18)
//
// [왜] 08-23~09-01 자동감시 9일 실측: 브리프 136건, 발행 1건.
// 나는 "하루 14건이라 많아서 안 봤다"고 설명했는데 틀렸다. 같은 기간
// PAP 속보(뉴스)는 하루 23~46건(평균 36건)이 갔고 도메니코는 그건 잘 본다.
// 양이 문제가 아니었다. 게시물 하나당 메시지가 두 개(감지 + 사진 브리프)였고,
// 두 번째가 매번 "올릴래 말래" 결정을 요구한 것이 문제였다.
// 도메니코(2026-09-18): "기사는 내가 쓴다. 캡션 내용과 함께 새 소식만 알려달라."
//
// Run with `node tests/celeb-account-alert.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-account-watch.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== 브리프 경로가 정말로 끊겼는가 ===');
ok('celeb_brief_queue 에 적재하지 않는다', !/celeb_brief_queue/.test(SRC));
ok('"브리프 준비 중" 문구가 남아있지 않다', !/브리프 준비 중/.test(SRC));
ok('seen 기록은 그대로 남긴다 (중복 알림 방지)', /celeb_account_seen/.test(SRC));
ok('실행당 상한이 살아 있다', /alertBudget\s*<=\s*0/.test(SRC) && /MAX_ALERTS/.test(SRC));
ok('첫 폴링 기준선이 살아 있다 (옛 글 폭탄 방지)', /baseline_done/.test(SRC));
ok('24시간 신선도 창이 살아 있다', /FRESH_MS/.test(SRC));

console.log('\n=== 알림 문구를 소스에서 떼어내 실제로 돌린다 ===');
const m = SRC.match(/function fmtCount[\s\S]*?\nfunction buildAlert\(acc, m\) \{[\s\S]*?\n\}/);
ok('buildAlert 를 찾았다', !!m);

if (m) {
  // eslint-disable-next-line no-new-func
  const F = new Function(`${m[0]}; return { buildAlert, fmtCount, fmtAgo };`)();
  const now = Date.now();
  const full = F.buildAlert(
    { username: 'blackpinkofficial', label: '블랙핑크' },
    { type: 'CAROUSEL_ALBUM', likes: 1243000, comments: 8421, ts: now - 7 * 60000,
      caption_head: 'BLACKPINK WORLD TOUR\nIN SEOUL', permalink: 'https://www.instagram.com/p/AAA/' });

  ok('계정을 적는다', full.includes('@blackpinkofficial'));
  ok('라벨을 적는다', full.includes('블랙핑크'));
  ok('캡션을 싣는다 (이게 이번 변경의 핵심)', full.includes('BLACKPINK WORLD TOUR'));
  ok('캡션의 줄바꿈을 한 줄로 편다', !/WORLD TOUR\n/.test(full) && full.includes('WORLD TOUR IN SEOUL'));
  ok('링크를 적는다', full.includes('https://www.instagram.com/p/AAA/'));
  ok('게시 유형을 한국어로 적는다', full.includes('여러 장'));
  ok('반응 수를 적는다', full.includes('124.3만') && full.includes('8,421'));
  ok('경과 시간을 적는다', full.includes('7분 전'));

  // 잘린 캡션은 잘렸다고 표시해야 한다 — 안 하면 원문이 그게 전부인 줄 안다
  const cut = F.buildAlert({ username: 'a', label: null },
    { type: 'VIDEO', likes: 1, comments: 1, ts: now, caption_head: 'x'.repeat(200), permalink: 'https://x/p/B/' });
  ok('200자에서 잘린 캡션에 … 를 붙인다', cut.includes('…'));
  const short = F.buildAlert({ username: 'a', label: null },
    { type: 'VIDEO', likes: 1, comments: 1, ts: now, caption_head: '짧은 캡션', permalink: 'https://x/p/B/' });
  ok('안 잘린 캡션에는 … 를 안 붙인다', !short.includes('…'));

  // 값이 없을 때 빈칸·NaN·undefined 가 새면 안 된다
  const bare = F.buildAlert({ username: 'aespa_official', label: null },
    { type: 'IMAGE', likes: null, comments: null, ts: now - 30000, caption_head: '', permalink: 'https://x/p/C/' });
  ok('캡션이 없으면 "(캡션 없음)" 으로 적는다', bare.includes('(캡션 없음)'));
  ok('반응이 null 이어도 NaN·undefined 가 안 샌다',
    !/NaN|undefined|null/.test(bare), JSON.stringify(bare));
  ok('라벨이 없으면 빈 괄호를 만들지 않는다', !bare.includes('()'));

  ok('숫자 포맷: 1만 미만은 콤마', F.fmtCount(8421) === '8,421');
  ok('숫자 포맷: 1만 이상은 만 단위', F.fmtCount(1243000) === '124.3만');
  ok('숫자 포맷: null 은 null', F.fmtCount(null) === null);

  // 한 게시물 = 한 메시지 (도메니코 원칙1, 2026-07-27)
  ok('링크가 메시지에 하나뿐이다', (full.match(/https?:\/\//g) || []).length === 1);
}

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
