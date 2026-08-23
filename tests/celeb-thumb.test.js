/**
 * 셀럽 속보 썸네일 렌더러 — (일반1) 썸네일 재현 (2026-08-23 신설)
 *
 * ■ 이 테스트가 지키는 것
 *   ① 실측 상수가 바뀌지 않는다 (PSD 에서 잰 값. 눈대중으로 고치면 템플릿이 어긋난다)
 *   ② 제목을 2줄에 못 담으면 **자르지 않고 실패**한다 (폰트 축소 금지 — 도메니코 규격)
 *   ③ 줄바꿈은 쉼표 뒤 > 균형 순서다 (그냥 채우면 템플릿과 어긋난다 — 실측 오차 21.6/255)
 *   ④ 실제로 렌더한 결과가 PSD 합성본과 거의 같다 (평균절대오차 ≤ 2/255)
 *
 * ■ ④ 는 node_modules 가 있을 때만 돈다
 *   CI 는 `npm ci` 없이 `npm test` 를 돌린다(no-eager-npm-deps.test.js 머리말 참고).
 *   sharp·opentype.js 를 요구하면 CI 가 죽는다. 없으면 건너뛰고 그 사실을 **출력**한다 —
 *   조용히 통과하면 "돌았다"고 착각하게 된다.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api/_lib/celebThumb.js'), 'utf8');
const cb = require('../api/_lib/celebBrief');

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

console.log('셀럽 썸네일 렌더러');

/* ① PSD 실측 상수 — 볼트 60_Agents/PAP-셀럽속보-톤앤디자인.md §4-7 */
t('실측 상수가 그대로다', () => {
  const expect = {
    'W = 1080': /W = 1080/, 'H = 1350': /H = 1350/,
    '국문 64px': /KO_PX = 64/, '국문 행간 78': /KO_LEAD = 78/, '국문 자간 0': /KO_TRACK = 0/,
    '영문 42px': /EN_PX = 42/, '영문 행간 50': /EN_LEAD = 50/, '영문 자간 -40': /EN_TRACK = -40/,
    '국문 베이스라인 (99.7, 851)': /KO_X = 99\.7[\s\S]{0,40}KO_BASE = 851\.0/,
    '영문 베이스라인 (101.5, 988.6)': /EN_X = 101\.5[\s\S]{0,40}EN_BASE = 988\.6/,
    '그림자 (0,485)': /SHADOW_XY = \[0, 485\]/,
    '심볼 (505,1219)': /SYMBOL_XY = \[505, 1219\]/,
    '최대 2줄': /MAX_LINES = 2/,
    '릴스 캔버스 1080×1920': /reels:[\s\S]{0,60}W: 1080, H: 1920/,
    '릴스 국문 기준선 1101': /koBase: 1101\.0/,
    '릴스 영문 기준선 1238.6': /enBase: 1238\.6/,
    '릴스 그림자 (1,695)': /shadowXY: \[1, 695\]/,
    '릴스 심볼 (506,1469)': /symbolXY: \[506, 1469\]/,
  };
  for (const [label, re] of Object.entries(expect)) {
    assert.ok(re.test(SRC), '실측 상수가 바뀌었다: ' + label);
  }
});

t('무거운 의존은 지연 로드다 (콜드스타트·CI 보호)', () => {
  const topLevel = SRC.split('\n').filter((l) => /^(const|let|var)\s.*require\(/.test(l));
  for (const line of topLevel) {
    assert.ok(!/require\('(sharp|opentype\.js)'\)/.test(line),
      '최상단에서 무거운 패키지를 로드한다: ' + line.trim());
  }
  assert.ok(/require\('opentype\.js'\)/.test(SRC) && /require\('sharp'\)/.test(SRC),
    '지연 로드라도 실제로 쓰긴 해야 한다');
});

/* ② */
t('제목이 2줄을 넘으면 던진다 (폰트를 줄이지 않는다)', () => {
  assert.ok(/국문 제목이 2줄을 넘습니다/.test(SRC), '국문 초과 시 실패 경로가 없다');
  assert.ok(/영문 제목이 2줄을 넘습니다/.test(SRC), '영문 초과 시 실패 경로가 없다');
  const shrink = /fontSize\s*\*\s*0\.|scale\s*=\s*0\.9|-- ?size/.test(SRC);
  assert.ok(!shrink, '폰트를 줄이는 코드가 들어왔다');
});

/* ③ 줄바꿈 정책 — 글자당 10px 가짜 measure */
const m10 = (s) => Array.from(s).length * 10;

t('사람이 넣은 줄바꿈이 가장 우선이다', () => {
  assert.deepStrictEqual(cb.wrapHeadline('가나다\n라마바', 100, m10, 2), ['가나다', '라마바']);
});

t('사람이 넣은 줄바꿈도 폭을 넘으면 null 이다', () => {
  assert.strictEqual(cb.wrapHeadline('가나다라마바사아자차\n짧게', 50, m10, 2), null);
});

t('쉼표 뒤에서 끊는다', () => {
  assert.deepStrictEqual(
    cb.wrapHeadline('이번 주, 파리에서 주목해야 할 것들', 150, m10, 2),
    ['이번 주,', '파리에서 주목해야 할 것들'],
  );
});

t('쉼표가 여럿이면 두 줄이 고른 쪽을 고른다', () => {
  const r = cb.wrapHeadline('가, 나다라마바, 사아자차카타파하', 120, m10, 2);
  assert.deepStrictEqual(r, ['가, 나다라마바,', '사아자차카타파하'],
    '가장 이른 쉼표를 고르면 한 줄이 지나치게 짧아진다');
});

t('쉼표가 없으면 두 줄 폭이 가장 고른 지점에서 끊는다', () => {
  const r = cb.wrapHeadline('가나 다라마바사 아자 차카', 100, m10, 2);
  assert.ok(r && r.length === 2, JSON.stringify(r));
  assert.ok(Math.abs(m10(r[0]) - m10(r[1])) <= 30, '한쪽만 길다: ' + JSON.stringify(r));
});

t('한 줄에 들어가면 나누지 않는다', () => {
  assert.deepStrictEqual(cb.wrapHeadline('짧은 제목', 500, m10, 2), ['짧은 제목']);
});

t('두 판형이 같은 글자 규격을 쓴다', () => {
  /* 릴스는 "다른 디자인" 이 아니라 같은 규격을 세로 판형에 옮긴 것이다.
     폰트·크기·행간·자간이 판형별로 갈리기 시작하면 두 벌을 관리하게 된다. */
  const thumb = require('../api/_lib/celebThumb');
  for (const v of ['feed', 'reels']) {
    assert.ok(thumb.VARIANTS[v], '판형 없음: ' + v);
  }
  assert.strictEqual(thumb.VARIANTS.feed.W, thumb.VARIANTS.reels.W, '폭은 1080 으로 같다');
  for (const k of ['koBase', 'enBase', 'shadow', 'shadowXY', 'symbolXY', 'H']) {
    assert.notDeepStrictEqual(thumb.VARIANTS.feed[k], thumb.VARIANTS.reels[k],
      '판형이 갈려야 하는 값이 같다: ' + k);
  }
  const SRC2 = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const shared of ['KO_PX = 64', 'EN_PX = 42', 'KO_LEAD = 78', 'EN_LEAD = 50', 'EN_TRACK = -40']) {
    assert.strictEqual((SRC2.match(new RegExp(shared.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g')) || []).length, 1,
      '글자 규격이 판형별로 복제됐다: ' + shared);
  }
});

/* ④ 실제 렌더 대조 — node_modules 있을 때만 */
let deps = true;
try { require('sharp'); require('opentype.js'); } catch (_e) { deps = false; }

if (!deps) {
  console.log('  … 렌더 대조 건너뜀 (sharp/opentype.js 없음 — CI 환경)');
} else {
  const ref = path.join(ROOT, 'tests/fixtures/celeb/ilban1_reference.png');
  const photo = path.join(ROOT, 'tests/fixtures/celeb/sample_photo.jpg');
  if (!fs.existsSync(ref) || !fs.existsSync(photo)) {
    throw new Error('대조용 fixture 가 없다: tests/fixtures/celeb/');
  }
  const KO = '이번 주, 파리에서 주목해야 할 것들';
  const EN = 'Your guide to the most exciting shows, events, and moments unfolding across the city.';
  const CASES = [
    { variant: 'feed',  photo, ref },
    { variant: 'reels',
      photo: path.join(ROOT, 'tests/fixtures/celeb/reels_photo.jpg'),
      ref:   path.join(ROOT, 'tests/fixtures/celeb/reels_reference.png') },
  ];
  (async () => {
    const sharp = require('sharp');
    const thumb = require('../api/_lib/celebThumb');
    for (const c of CASES) {
      if (!fs.existsSync(c.ref) || !fs.existsSync(c.photo)) {
        throw new Error('대조용 fixture 가 없다: ' + c.variant);
      }
      /* textShift: 0 — PSD 합성본과 대조하는 자리다. 인스타 그리드용 오프셋
         (TEXT_SHIFT)은 여기서 빼고 "템플릿을 정확히 재현하는가"만 잰다.
         두 가지를 섞으면 오프셋을 조정할 때마다 이 테스트가 깨져서
         진짜 조판 회귀를 못 잡는다. */
      const out = await thumb.renderThumb(fs.readFileSync(c.photo), KO, EN,
        { variant: c.variant, textShift: 0 });
      const a = await sharp(c.ref).removeAlpha().raw().toBuffer();
      const b = await sharp(out).raw().toBuffer();
      assert.strictEqual(a.length, b.length, c.variant + ' 캔버스 크기가 다르다');
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
      const mae = sum / a.length;
      console.log('  ✓ [' + c.variant + '] PSD 합성본과 평균절대오차 ' + mae.toFixed(3) + '/255');
      assert.ok(mae <= 2, c.variant + ' 템플릿과 어긋났다 (평균절대오차 ' + mae.toFixed(3) + ' > 2)');
      n++;
    }
    console.log('\n셀럽 썸네일 렌더러: ' + n + '건 통과');
  })().catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
}

if (!deps) 
t('썸네일도 오버레이도 MIN_LINES=2 로 조판한다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/celebThumb.js'), 'utf8');
  assert.ok(/const MIN_LINES = 2;/.test(src), 'MIN_LINES 상수가 없다');
  const calls = src.match(/wrapHeadline\([^)]*\)/g) || [];
  assert.ok(calls.length >= 2, 'wrapHeadline 호출을 못 찾았다');
  calls.forEach((c) => assert.ok(/MIN_LINES/.test(c), '두 줄 강제가 빠진 호출이 있다: ' + c));
});

t('renderThumb 이 조판을 다시 짜지 않는다 (_layers 한 벌)', () => {
  /* 2026-08-23: 실제로 갈라져 있었다. MIN_LINES 를 두 곳에 넣어야 했고,
     한쪽만 고치면 영상 오버레이와 썸네일이 다른 줄바꿈을 갖게 된다. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/celebThumb.js'), 'utf8');
  const body = src.split('async function renderThumb(')[1].split('module.exports')[0];
  assert.ok(/_layers\(titleKo, titleEn, opts\)/.test(body), 'renderThumb 이 _layers 를 안 쓴다');
  assert.ok(!/wrapHeadline\(/.test(body), 'renderThumb 안에 조판 코드가 복제돼 있다');
});


/* ─── 피드 4:5 크롭 대응 (도메니코 2026-08-23) ─────────────────────────── */

t('피드 안전구간을 4:5 로 잡는다', () => {
  const TH = require('../api/_lib/celebThumb');
  assert.deepStrictEqual(TH.safeBand(1080, 1920), [285, 1635], '릴스 안전구간이 틀렸다');
  assert.deepStrictEqual(TH.safeBand(1080, 1350), [0, 1350], 'feed 는 이미 4:5 라 통째로 안전해야 한다');
});

t('얼굴이 위에 있으면 사진을 그만큼 내린다', () => {
  const TH = require('../api/_lib/celebThumb');
  // 지수 건: 얼굴 맨 위가 이미지의 7.8% 지점 → 175px 내려야 안전구간에 들어온다
  assert.strictEqual(TH.photoShiftFor(1080, 1920, 0.078), 175);
  // feed 판형은 잘릴 게 없으니 건드리지 않는다
  assert.strictEqual(TH.photoShiftFor(1080, 1350, 0.078), 0);
});

t('focusTop 이 없거나 이상하면 예전과 똑같이 동작한다', () => {
  const TH = require('../api/_lib/celebThumb');
  [undefined, null, '', -0.2, 1.4, NaN, 'abc'].forEach((v) => {
    assert.strictEqual(TH.photoShiftFor(1080, 1920, v), 0, '값 ' + String(v) + ' 에서 사진이 움직였다');
  });
});

t('얼굴이 이미 안전구간 안이면 건드리지 않는다', () => {
  const TH = require('../api/_lib/celebThumb');
  assert.strictEqual(TH.photoShiftFor(1080, 1920, 0.5), 0);
});

t('사진 이동이 상한 안에 있다 (하단이 통째로 날아가지 않게)', () => {
  const TH = require('../api/_lib/celebThumb');
  // 얼굴이 이미지 맨 위에 붙어 있는 최악의 경우가 325px — 하단 17% 를 버린다.
  const worst = TH.photoShiftFor(1080, 1920, 0);
  assert.strictEqual(worst, 325);
  assert.ok(worst <= TH.PHOTO_SHIFT_MAX, '상한을 넘었다');
  assert.ok(worst / 1920 < 0.2, '하단을 20% 넘게 버리고 있다');
});

t('글자 내림이 심볼을 안전구간 밖으로 밀지 않는다', () => {
  const TH = require('../api/_lib/celebThumb');
  /* 심볼 bbox 하단 1539, 안전구간 끝 1635 → 96px 이 한계.
     이걸 넘기면 피드 그리드에서 PAP 심볼이 잘린다. */
  const V = TH.VARIANTS.reels;
  const symBottom = V.symbolXY[1] + 70 + TH.textShiftFor('reels');
  assert.ok(symBottom <= TH.safeBand(V.W, V.H)[1],
    '심볼이 피드에서 잘린다: ' + symBottom + ' > ' + TH.safeBand(V.W, V.H)[1]);
  assert.ok(TH.TEXT_SHIFT_MAX <= 96, '상한이 느슨해졌다');
});

t('feed 판형은 글자를 내리지 않는다 (잘릴 게 없다)', () => {
  const TH = require('../api/_lib/celebThumb');
  assert.strictEqual(TH.textShiftFor('feed'), 0);
});


t('인스타 오프셋은 PSD 조판 위에 얹히는 별개 값이다', () => {
  const TH = require('../api/_lib/celebThumb');
  assert.strictEqual(TH.textShiftFor('reels', 0), 0, 'override 가 안 먹는다 — PSD 대조가 오염된다');
  assert.strictEqual(TH.textShiftFor('reels'), TH.TEXT_SHIFT.reels);
});

console.log('\n셀럽 썸네일 렌더러: ' + n + '건 통과 (렌더 대조 제외)');
