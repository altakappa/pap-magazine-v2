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
ok('실행당 상한이 살아 있다', /candidates\.length >= MAX_JUDGE/.test(SRC) && /MAX_JUDGE/.test(SRC));
ok('첫 폴링 기준선이 살아 있다 (옛 글 폭탄 방지)', /baseline_done/.test(SRC));
ok('24시간 신선도 창이 살아 있다', /FRESH_MS/.test(SRC));

console.log('\n=== 알림 문구를 소스에서 떼어내 실제로 돌린다 ===');
const m = SRC.match(/function fmtCount[\s\S]*?\nfunction buildAlert\(acc, m, why\) \{[\s\S]*?\n\}/);
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


console.log('\n=== 뉴스 판정 게이트 (2026-09-18) ===');
ok('AI 판정기가 붙어 있다', /function judgeNews/.test(SRC));
ok('판정 결과 파싱은 공용 jsonRepair 를 쓴다 (규칙 두 벌 금지)',
  /require\('\.\.\/_lib\/jsonRepair'\)/.test(SRC));
ok('판정 실패 시 아무것도 안 보낸다 (fail-closed)',
  /out\.judgeError = judged\.reason/.test(SRC) && /if \(judged && judged\.ok\)/.test(SRC));
ok('판정 실패한 건은 seen 에 안 남긴다 (다음 실행에 재시도)',
  !/judgeError[\s\S]{0,300}celeb_account_seen/.test(SRC));
ok('판정이 안 돌아온 항목은 뉴스아님으로 삼지 않는다',
  /if \(!v\) \{ out\.unjudged\+\+; continue; \}/.test(SRC));
ok('뉴스가 아니어도 seen 에는 남긴다 (같은 글을 다시 묻지 않는다)',
  /if \(!v\.news\) \{ out\.skipped\+\+; continue; \}/.test(SRC));
ok('판정이 막히면 remaining 으로 세어 감시망에 걸린다',
  /remaining: unwatched \+ \(out\.judgeError \? candidates\.length : 0\) \+ out\.unjudged/.test(SRC));
ok('판정 실패·누락이 노트에 드러난다 (조용히 0건으로 안 보이게)',
  /판정 누락/.test(SRC) && /판정 실패/.test(SRC));
ok('계정마다 부르지 않고 모아서 한 배치로 묻는다',
  /candidates\.push\(\{ acc, m \}\)/.test(SRC) && /judgeNews\(candidates\)/.test(SRC));
ok('애매하면 제외하라고 지시한다', /애매하면 false/.test(SRC));
ok('싼 모델을 기본으로 쓴다', /claude-haiku/.test(SRC));

console.log('\n--- 판정 응답 파서를 실제로 돌린다 ---');
{
  const pm = SRC.match(/function parseNewsVerdicts\(text\) \{[\s\S]*?\n\}/);
  ok('parseNewsVerdicts 를 찾았다', !!pm);
  if (pm) {
    const path2 = require('path');
    // eslint-disable-next-line no-new-func
    const P = new Function('require', `${pm[0]}; return parseNewsVerdicts;`)(
      (id) => require(id.startsWith('.') ? path2.join(ROOT, 'api', 'cron', id) : id));
    const good = P('[{"i":0,"news":true,"why":"컴백 티저"},{"i":1,"news":false,"why":"셀카"}]');
    ok('정상 JSON 을 읽는다', good && good[0].news === true && good[1].news === false);
    ok('why 를 보관한다', good && good[0].why === '컴백 티저');
    const fenced = P('```json\n[{"i":0,"news":true,"why":"수상"}]\n```');
    ok('코드펜스가 섞여도 읽는다', fenced && fenced[0].news === true);
    ok('빈 응답은 null (배치를 통째로 버린다)', P('') === null);
    ok('배열이 아니면 null', P('{"i":0}') === null);
    const partial = P('[{"i":0,"news":true,"why":"x"},{"i":1,"why":"불량"}]');
    ok('news 가 없는 항목은 버리고 나머지는 산다',
      partial && partial[0] && partial[1] === undefined);
  }
}

console.log('\n--- 알림에 판정 이유가 붙는가 ---');
{
  const m2 = SRC.match(/function fmtCount[\s\S]*?\nfunction buildAlert\(acc, m, why\) \{[\s\S]*?\n\}/);
  ok('buildAlert 가 why 를 받는다', !!m2);
  if (m2) {
    // eslint-disable-next-line no-new-func
    const F2 = new Function(`${m2[0]}; return buildAlert;`)();
    const withWhy = F2({ username: 'a', label: '블랙핑크' },
      { type: 'IMAGE', likes: 1, comments: 1, ts: Date.now(), caption_head: 'x', permalink: 'https://x/p/A/' },
      '컴백 티저');
    ok('판정 이유가 첫 줄에 보인다', withWhy.split('\n')[0].includes('컴백 티저'));
    const noWhy = F2({ username: 'a', label: '블랙핑크' },
      { type: 'IMAGE', likes: 1, comments: 1, ts: Date.now(), caption_head: 'x', permalink: 'https://x/p/A/' });
    ok('이유가 없으면 빈 구분자를 남기지 않는다', !noWhy.split('\n')[0].includes('·'));
  }
}

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
