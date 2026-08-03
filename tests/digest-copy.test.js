/**
 * 소셜 다이제스트 문안 (api/_lib/digestCopy.js) + 요일 격자 (api/cron/social-digest.js).
 *
 * 여기서 지키는 건 도메니코가 못 박은 네 가지다:
 *   1) 링크는 인스타 프로필 하나뿐 — 기사별 링크 금지
 *   2) 자동 발행이라 모델이 URL 을 못 흘리게 기계로 막는다
 *   3) 한 기사는 한 줄 (제목 · 소개말), 제목은 원문 그대로
 *   4) 소재를 고르지 않는다 — 자리가 모자라면 소개말을 먼저 버린다
 *   5) 세 갈래가 같은 날 안 겹친다
 *   6) 스레드는 머리말 / 목록 / 마무리 / 링크 네 덩이뿐이고, 사이엔 빈 줄이 하나씩
 *
 * 2026-08-03 3차 — 셀럽을 월·목에서 월·화·목·금으로 늘렸다. X 한 글에는 제목이
 * 서너 개밖에 안 들어가서(가중 280자), 창이 길수록 넘쳐 버려지는 기사가 늘었다.
 * 자주 조금씩 내보내는 쪽이 같은 글자 수로 더 많이 나간다(실측 64% → 92%).
 *
 * 2026-08-03 4차 — 스레드 본문을 더 심플하게. 모델이 쓰던 intro 한 줄을 없애고
 * 머리말을 체언 + 마침표로 끊었다. 5차 — 마무리 앞 빈 줄은 도로 살렸다.
 *
 * ANTHROPIC_API_KEY 없이 돌면 generateNotes 가 곧장 null 이라 fallback 경로만
 * 탄다. 그게 오히려 낫다 — 테스트가 모델 응답에 흔들리지 않는다.
 */
const path = require('path');
const Module = require('module');

/* supabase 스텁 (tests/no-eager-npm-deps.test.js 의 ALLOW 규약). */
const SUPABASE = path.join(__dirname, '..', 'api', '_lib', 'supabase.js');
require.cache[SUPABASE] = new Module(SUPABASE);
require.cache[SUPABASE].exports = { supabaseAdmin: { from() { throw new Error('DB 접근 안 함'); } } };
require.cache[SUPABASE].loaded = true;

delete process.env.ANTHROPIC_API_KEY;

const copy = require('../api/_lib/digestCopy');
const { weightedLen } = require('../api/_lib/xPost');
const digest = require('../api/cron/social-digest');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const ITEMS = [
  { source: 'article', id: '1', title: '로에베 2026 프리폴 컬렉션' },
  { source: 'article', id: '2', title: '젠데이아, 파리에서 포착되다' },
  { source: 'editorial', id: '3', title: '서울의 새벽을 담은 화보' },
];
const PICKED = { bucket: 'collection', label: '아트 콜렉션', days: 3, items: ITEMS };

console.log('\n[1] 링크는 딱 하나 — 인스타 프로필');
(async () => {
  for (const platform of ['x', 'threads']) {
    const r = await copy.build(PICKED, platform);
    t(platform + ': 문안이 만들어진다', !!r);
    const links = (r.text.match(/https?:\/\/\S+/g) || []);
    t(platform + ': 링크 1개', links.length === 1, JSON.stringify(links));
    t(platform + ': 그 링크가 인스타 프로필', links[0] === copy.IG_URL, links[0]);
    t(platform + ': 기사 링크 없음', !/pap-magazine\.com\/(article|editorial)/.test(r.text));
    t(platform + ': 링크가 맨 끝', r.text.trim().endsWith(copy.IG_URL));
  }

  console.log('\n[2] 제목은 원문 그대로 나간다');
  const th = await copy.build(PICKED, 'threads');
  for (const it of ITEMS) t('제목 포함: ' + it.title, th.text.includes(it.title));

  console.log('\n[3] X 는 280 가중치를 넘지 않는다');
  const many = Array.from({ length: 12 }, (_, i) => ({
    source: 'article', id: 'x' + i,
    title: '아주 긴 제목을 가진 기사 ' + i + ' 번째 — 파리 뒷골목 빈티지 아카이브 상점 탐방기',
  }));
  const x = await copy.build({ bucket: 'celeb', label: '셀럽 소식', days: 3, items: many }, 'x');
  const w = weightedLen(x.text.replace(copy.IG_URL, '')) + 23;
  t('가중 길이 ' + w + ' ≤ 280', w <= 280);
  t('항목을 덜어냈다', x.items.length < many.length, x.items.length + '개');
  t('기록되는 항목은 실제로 실린 것뿐', x.items.every((it) => x.text.includes(it.title)));

  console.log('\n[4] 스레드는 500자를 넘지 않는다');
  const thMany = await copy.build({ bucket: 'celeb', label: '셀럽 소식', days: 3, items: many }, 'threads');
  t('길이 ' + thMany.text.length + ' ≤ 480', thMany.text.length <= copy.THREADS_MAX);

  console.log('\n[5] 모델이 URL·해시태그를 흘려도 지운다');
  const dirty = copy.cleanNote('여기 보세요 https://evil.example.com/x 그리고 #패션 www.foo.co.kr');
  t('http 링크 제거', !/https?:/.test(dirty), dirty);
  t('www 링크 제거', !/www\./.test(dirty), dirty);
  t('해시태그 제거', !/#/.test(dirty), dirty);
  t('대시 제거', !/[—–ㅡ]/.test(copy.cleanNote('앞 ㅡ 뒤')));

  console.log('\n[5-2] 소개말이 너무 길면 문장 끝에서 자른다');
  const long = copy.cleanNote('첫 문장은 이렇게 끝난다. 두 번째 문장은 상한을 한참 넘겨서 계속 이어지고 또 이어진다.', { max: 14 });
  t('상한 근처에서 잘렸다', long.length <= 26, long.length + '자: ' + long);
  t('문장 중간에서 안 끊긴다', /[.!?요다죠네]$/.test(long), long);

  console.log('\n[6] 어미 — X 존댓말 / 스레드 반말');
  const fbPolite = copy.fallbackCopy(ITEMS, true);
  const fbCasual = copy.fallbackCopy(ITEMS, false);
  t('존댓말 마무리', /요$/.test(fbPolite.closing), fbPolite.closing);
  t('반말 마무리', !/요$/.test(fbCasual.closing), fbCasual.closing);
  t('X 는 존댓말 문장을 쓴다', (await copy.build(PICKED, 'x')).text.includes(fbPolite.closing));
  t('스레드는 반말 문장을 쓴다', (await copy.build(PICKED, 'threads')).text.includes(fbCasual.closing));

  t('스레드 마무리는 도메니코가 못 박은 문장',
    fbCasual.closing === '더 많은 현장은 PAP 인스타그램에서 확인!', fbCasual.closing);
  t('마무리는 모델이 아니라 코드가 정한다',
    copy.closingFor(false) === fbCasual.closing && copy.closingFor(true) === fbPolite.closing);

  console.log('\n[6-2] 두 채널 다 번호로 카운트한다');
  const NOTES = ITEMS.map((_, i) => '소개말 ' + (i + 1) + ' 번째 줄입니다');
  for (const platform of ['x', 'threads']) {
    const head = copy.HEADLINE.collection[platform];
    const c = { closing: copy.closingFor(true), notes: NOTES };
    const text = copy.ASSEMBLE[platform](head, c, ITEMS);
    t(platform + ': 1번이 있다', /^1\. /m.test(text), text);
    t(platform + ': 2번이 있다', /^2\. /m.test(text));
    t(platform + ': 소개말이 실린다', text.includes(NOTES[0]), text);
    t(platform + ': 제목과 소개말이 한 줄에 있다',
      text.includes(ITEMS[0].title + copy.SEP + NOTES[0]), text);
    t(platform + ': 소개말이 따로 줄을 차지하지 않는다',
      !new RegExp('^\\s*' + NOTES[0], 'm').test(text), text);
  }

  console.log('\n[6-3] 항목 수가 소개말보다 우선한다 (2026-08-03 2차 지시)');
  {
    const five = Array.from({ length: 5 }, (_, i) => ({
      source: 'article', id: 'p' + i, title: '파리 뒷골목 빈티지 아카이브 상점 ' + i,
    }));
    const c = {
      closing: copy.closingFor(true),
      notes: five.map(() => '60년대 오뜨꾸뛰르가 옷걸이째 쌓여 있는 곳'),
    };
    const text = copy.assembleX(copy.HEADLINE.celeb.x, c, five);
    const shown = (text.match(/^\d\. /gm) || []).length;
    t('다섯 개를 다 싣는다 (' + shown + '개)', shown === five.length, text);
    t('자리가 없으면 소개말을 먼저 버린다', !text.includes(c.notes[0]), text);
    t('280 가중치 안', weightedLen(text.replace(copy.IG_URL, '')) + 23 <= 280);

    /* 자리가 되면 소개말도 같이 나간다 — 무조건 버리는 게 아니다. */
    const two = [{ source: 'article', id: 'a', title: '제니, 새 화보' },
                 { source: 'article', id: 'b', title: '에스파, 시카고 무대' }];
    const c2 = { closing: copy.closingFor(true),
      notes: ['표지컷 세 장 공개', '세트리스트와 현장 반응'] };
    const t2 = copy.assembleX(copy.HEADLINE.celeb.x, c2, two);
    t('자리가 되면 소개말도 같이 나간다', t2.includes(c2.notes[0]) && t2.includes(c2.notes[1]), t2);
  }

  console.log('\n[6-4] 머리말은 최근 으로 연다 (2026-08-03 2차 지시)');
  for (const b of ['collection', 'celeb']) {
    for (const p2 of ['x', 'threads']) {
      t(b + '/' + p2 + ': 요 며칠 이 없다', !/요 며칠/.test(copy.HEADLINE[b][p2]), copy.HEADLINE[b][p2]);
      t(b + '/' + p2 + ': 최근 으로 연다', /^최근/.test(copy.HEADLINE[b][p2]), copy.HEADLINE[b][p2]);
    }
  }
  console.log('\n[6-5] 스레드 뼈대 — 머리말 / 빈 줄 / 목록 / 빈 줄 / 마무리 / 링크 (2026-08-03 4차 지시)');
  {
    const head = copy.HEADLINE.celeb.threads;
    const c = {
      closing: copy.closingFor(false),
      notes: ['워터밤 현장 공기까지 그대로', '컴백 무드가 확 달라져.', '뮤비 티저부터 심상치 않아.'],
    };
    const lines = copy.assembleThreads(head, c, ITEMS).split('\n');
    t('첫 줄이 머리말', lines[0] === head, lines[0]);
    t('둘째 줄은 빈 줄', lines[1] === '', JSON.stringify(lines[1]));
    t('셋째 줄부터 바로 목록 (모델 intro 가 없다)', /^1\. /.test(lines[2]), lines[2]);
    t('마지막 항목이 제자리에 있다',
      lines[lines.length - 4] === '3. ' + ITEMS[2].title + copy.SEP + c.notes[2], lines[lines.length - 4]);
    t('마무리 앞에 빈 줄이 있다 (2026-08-03 5차 지시)',
      lines[lines.length - 3] === '', JSON.stringify(lines[lines.length - 3]));
    t('마무리는 끝에서 둘째 줄', lines[lines.length - 2] === c.closing, lines[lines.length - 2]);
    t('링크가 마지막 줄', lines[lines.length - 1] === copy.IG_URL, lines[lines.length - 1]);
    t('빈 줄은 딱 둘 — 머리말 밑과 마무리 앞',
      lines.filter((l) => l === '').length === 2, JSON.stringify(lines));
    t('X 는 빈 줄 없이 붙여 쓴다 (가중 280자)',
      !copy.assembleX(copy.HEADLINE.celeb.x, c, ITEMS).split('\n').some((l) => l === ''));
    t('셀럽 머리말은 도메니코가 준 본보기 그대로', head === '최근 셀럽들 소식 모음.', head);
    t('세 갈래 스레드 머리말이 모두 마침표로 끝난다',
      ['editorial', 'collection', 'celeb'].every((b) => /\.$/.test(copy.HEADLINE[b].threads)),
      JSON.stringify(['editorial', 'collection', 'celeb'].map((b) => copy.HEADLINE[b].threads)));
    t('X 머리말은 건드리지 않았다 (날짜도 문안도 그대로)',
      copy.HEADLINE.celeb.x === '최근 셀럽 소식' && !/\.$/.test(copy.HEADLINE.collection.x),
      copy.HEADLINE.celeb.x);
  }

  console.log('\n[6-6] 모델이 쓰던 intro 는 뿌리째 없앴다 (반쪽 수정 재발 방지)');
  {
    const fb = copy.fallbackCopy(ITEMS, false);
    t('fallbackCopy 에 intro 가 없다', !('intro' in fb), JSON.stringify(Object.keys(fb)));
    const s2 = require('fs').readFileSync(path.join(__dirname, '..', 'api', '_lib', 'digestCopy.js'), 'utf8');
    t('조립이 copy.intro 를 안 읽는다', !/copy\.intro/.test(s2));
    t('모델에게 시키는 JSON 규격에 intro 가 없다', !/"intro"/.test(s2));
    t('스레드 소개말 상한이 짧아졌다 (' + copy.NOTE_LEN.threads + '자)', copy.NOTE_LEN.threads <= 30);
  }

  console.log('\n[7] 소재가 없으면 글을 만들지 않는다');
  t('빈 목록 → null', (await copy.build({ bucket: 'celeb', label: '', days: 3, items: [] }, 'x')) === null);
  t('제목 없는 항목만 → null',
    (await copy.build({ bucket: 'celeb', label: '', days: 3, items: [{ source: 'article', id: '9', title: '' }] }, 'x')) === null);

  console.log('\n[8] 슬롯 격자 — 하루 두 자리, 한 자리에 갈래 하나 (2026-08-03 6차 지시)');
  const grid = digest.SLOT_BUCKET;
  const DOW = [0, 1, 2, 3, 4, 5, 6];
  t('슬롯은 아침·저녁 둘', Object.keys(grid).sort().join(',') === 'am,pm');
  t('아침 일요일 = 에디토리얼', grid.am[0] === 'editorial');
  t('아침 월·화·목·금 = 셀럽',
    grid.am[1] === 'celeb' && grid.am[2] === 'celeb' && grid.am[4] === 'celeb' && grid.am[5] === 'celeb');
  t('아침 수·토는 쉰다', grid.am[3] === null && grid.am[6] === null);
  t('저녁은 이레 내내 콜렉션', DOW.every((d) => grid.pm[d] === 'collection'));
  t('두 슬롯에 요일 일곱 개가 모두 선언돼 있다',
    ['am', 'pm'].every((s) => Object.keys(grid[s]).length === 7));
  t('한 슬롯에 갈래는 하나 (문자열 아니면 null)',
    ['am', 'pm'].every((s) => DOW.every((d) => grid[s][d] === null || typeof grid[s][d] === 'string')));
  /* 원칙은 그대로다 — 갈래끼리 겹치지 않는다. 다만 경계가 날짜에서 시간대로
     내려왔다. 같은 갈래가 하루에 두 번 나가는 것도 여전히 금지다. */
  t('같은 날 아침·저녁이 같은 갈래를 쓰지 않는다',
    DOW.every((d) => !grid.am[d] || grid.am[d] !== grid.pm[d]));
  t('세 갈래가 모두 주 1회 이상', ['editorial', 'collection', 'celeb']
    .every((b) => DOW.some((d) => grid.am[d] === b || grid.pm[d] === b)));
  t('콜렉션이 주 7회 — 물량이 하루 6건대라 주 2회로는 스레드에 41% 밖에 못 실렸다',
    DOW.filter((d) => grid.pm[d] === 'collection').length === 7);

  console.log('\n[9] KST 요일 계산 (크론은 UTC)');
  // 2026-08-03 은 월요일. UTC 11:00 → KST 20:00 같은 날 = 월요일.
  t('UTC 월 11:00 → KST 월', digest.kstDay(new Date('2026-08-03T11:00:00Z')) === 1);
  // UTC 일 16:00 → KST 월 01:00 — 날짜가 넘어간다.
  t('UTC 일 16:00 → KST 월', digest.kstDay(new Date('2026-08-02T16:00:00Z')) === 1);
  // 슬롯 경계는 KST 14시. UTC 00:00 → KST 09:00 = 아침, UTC 11:00 → KST 20:00 = 저녁.
  t('UTC 00:00 → KST 09시 (아침 슬롯)', digest.kstHour(new Date('2026-08-03T00:00:00Z')) === 9);
  t('UTC 11:00 → KST 20시 (저녁 슬롯)', digest.kstHour(new Date('2026-08-03T11:00:00Z')) === 20);
  t('슬롯 경계가 두 크론 시각 사이에 있다',
    9 < digest.SLOT_BOUNDARY_HOUR && digest.SLOT_BOUNDARY_HOUR <= 20);
  t('KST 오늘 0시 = UTC 전날 15:00',
    digest.kstTodayStartIso(new Date('2026-08-03T11:00:00Z')) === '2026-08-02T15:00:00.000Z',
    digest.kstTodayStartIso(new Date('2026-08-03T11:00:00Z')));

  console.log('\n[10] 채널 분기는 표 하나로만 (socialHook 단일 분기점 규약)');
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'api', '_lib', 'digestCopy.js'), 'utf8');
  t("digestCopy 안에 platform === 'x' 삼항 없음", !/platform\s*===\s*'x'\s*\?/.test(src));
  t('ASSEMBLE 표에 두 채널이 다 있다', !!copy.ASSEMBLE.x && !!copy.ASSEMBLE.threads);

  console.log('\n' + (fail ? '실패 ' + fail + '건 / ' : '') + '통과 ' + pass + '건');
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
