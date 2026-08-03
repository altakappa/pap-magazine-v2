/**
 * 소셜 다이제스트 문안 (api/_lib/digestCopy.js) + 요일 격자 (api/cron/social-digest.js).
 *
 * 여기서 지키는 건 도메니코가 못 박은 네 가지다:
 *   1) 링크는 인스타 프로필 하나뿐 — 기사별 링크 금지
 *   2) 자동 발행이라 모델이 URL 을 못 흘리게 기계로 막는다
 *   3) 항목마다 한두 줄, 제목은 원문 그대로
 *   4) 세 갈래가 같은 날 안 겹친다
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

  t('스레드 마무리는 명사형 (반말이 링크 앞에서 튀지 않게)',
    fbCasual.closing === '전체 기사는 인스타에서', fbCasual.closing);

  console.log('\n[6-2] 두 채널 다 번호로 카운트한다');
  const NOTES = ITEMS.map((_, i) => '소개말 ' + (i + 1) + ' 번째 줄입니다');
  for (const platform of ['x', 'threads']) {
    const head = copy.HEADLINE.collection[platform];
    const c = { intro: '', closing: '전체 기사는 인스타에서', notes: NOTES };
    const text = copy.ASSEMBLE[platform](head, c, ITEMS);
    t(platform + ': 1번이 있다', /^1\. /m.test(text), text);
    t(platform + ': 2번이 있다', /^2\. /m.test(text));
    t(platform + ': 소개말이 실린다', text.includes(NOTES[0]), text);
  }

  console.log('\n[6-3] X 는 항목 수보다 소개말을 우선한다');
  {
    const five = Array.from({ length: 5 }, (_, i) => ({
      source: 'article', id: 'p' + i, title: '파리 뒷골목 빈티지 아카이브 상점 ' + i,
    }));
    const c = {
      intro: '', closing: '전체 기사는 인스타에서',
      notes: five.map(() => '60년대 오뜨꾸뛰르가 옷걸이째 쌓여 있는 곳'),
    };
    const text = copy.assembleX('요 며칠의 셀럽 소식', c, five);
    t('제목만 나열하고 끝내지 않는다', text.includes(c.notes[0]), text);
    const shown = (text.match(/^\d\. /gm) || []).length;
    t('그 대신 항목이 줄었다 (' + shown + '개)', shown < five.length && shown >= 1);
    t('280 가중치 안', weightedLen(text.replace(copy.IG_URL, '')) + 23 <= 280);
  }

  console.log('\n[7] 소재가 없으면 글을 만들지 않는다');
  t('빈 목록 → null', (await copy.build({ bucket: 'celeb', label: '', days: 3, items: [] }, 'x')) === null);
  t('제목 없는 항목만 → null',
    (await copy.build({ bucket: 'celeb', label: '', days: 3, items: [{ source: 'article', id: '9', title: '' }] }, 'x')) === null);

  console.log('\n[8] 요일 격자 — 세 갈래가 절대 안 겹친다');
  const grid = digest.DAY_BUCKET;
  t('일요일 = 에디토리얼', grid[0] === 'editorial');
  t('월·목 = 셀럽', grid[1] === 'celeb' && grid[4] === 'celeb');
  t('화·금 = 콜렉션', grid[2] === 'collection' && grid[5] === 'collection');
  t('수·토 = 쉼', grid[3] === null && grid[6] === null);
  const days = Object.keys(grid);
  t('하루에 갈래는 최대 하나', days.every((d) => grid[d] === null || typeof grid[d] === 'string'));
  t('세 갈래가 모두 주 1회 이상', ['editorial', 'collection', 'celeb']
    .every((b) => days.some((d) => grid[d] === b)));

  console.log('\n[9] KST 요일 계산 (크론은 UTC)');
  // 2026-08-03 은 월요일. UTC 11:00 → KST 20:00 같은 날 = 월요일.
  t('UTC 월 11:00 → KST 월', digest.kstDay(new Date('2026-08-03T11:00:00Z')) === 1);
  // UTC 일 16:00 → KST 월 01:00 — 날짜가 넘어간다.
  t('UTC 일 16:00 → KST 월', digest.kstDay(new Date('2026-08-02T16:00:00Z')) === 1);
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
