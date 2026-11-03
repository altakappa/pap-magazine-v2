/**
 * 커버 스태프 크레딧 — 줄 균형 + 이름 중복 제거 (2026-11-03)
 * ═══════════════════════════════════════════════════════════════════
 * 도메니코: "서브미션 편집시 커버에서 스태프 크레딧을 적을때 띄어쓰기를 적당히
 *            균형감 있게. 현재는 첫째칸 6명 둘째칸 1명인데, 첫째칸 4명 둘째칸 3명
 *            이런식으로. 그리고 중복되는 사람의 이름은 하나만."
 *
 * [왜 6+1 이었나] 기여자 줄은 이름들을 공백으로 이어 붙인 한 문자열이었고,
 *   줄바꿈은 일반 단어 줄바꿈이 했다. 한 줄을 최대한 채우고 넘치는 것만 넘기는
 *   탐욕적 방식이라 6+1 이 나온다. 게다가 "Shin Haedeun" 같은 두 단어 이름은
 *   가운데서 잘릴 수도 있었다 — 단어 경계와 이름 경계가 다르기 때문이다.
 *
 * [고침] 이름을 '단위'로 들고 다닌다. 줄바꿈은 이름 경계에서만 하고, 두 줄의
 *   렌더 폭 차이가 가장 작은 지점에서 자른다. 동점이면 앞줄을 더 채운다(4+3).
 *
 * 폭 계산은 캔버스 폰트에 달려 있으므로, 시험에서는 글자 수에 비례하는 가짜
 * measureText 를 물려 규칙 자체를 검증한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

/* 세 함수를 소스에서 그대로 떼어 세운다 (IIFE 가 아니라 전역 함수라 구간만 잘라내면 된다). */
const from = SRC.indexOf('function _papDedupeNames(list){');
const to = SRC.indexOf('async function _papCoverComposite(');
t('헬퍼 구간을 떼어낼 수 있다', from > 0 && to > from);
const slice = SRC.slice(from, to);
const build = new Function(slice + '\n return { dedupe: _papDedupeNames, balance: _papCoverBalanceNames, wrap: _papCoverWrap };');
const F = build();

/* 글자 하나 = 10px 인 가짜 컨텍스트. */
const ctx = { measureText: (s) => ({ width: String(s).length * 10 }) };

/* ── 중복 제거 ── */
t('같은 사람이 여러 역할에 있어도 한 번만',
  JSON.stringify(F.dedupe(['Kim Jinju', 'Shin Haedeun', 'Kim Jinju'])) === JSON.stringify(['Kim Jinju', 'Shin Haedeun']));
t('대소문자·중복 공백이 달라도 같은 사람으로 본다',
  JSON.stringify(F.dedupe(['Kim Jinju', 'kim  jinju', 'KIM JINJU'])) === JSON.stringify(['Kim Jinju']));
t('첫 표기를 남긴다 (나중 표기로 덮어쓰지 않는다)', F.dedupe(['Kim Jinju', 'kim jinju'])[0] === 'Kim Jinju');
t('빈 칸·공백만 있는 칸은 버린다', JSON.stringify(F.dedupe(['', '   ', null, undefined, 'A'])) === JSON.stringify(['A']));
t('앞뒤 공백을 정리한다', F.dedupe(['  Kim Jinju  '])[0] === 'Kim Jinju');

/* ── 줄 균형: 도메니코가 본 그 상황 ── */
const seven = ['Aaaaaaaaaa', 'Bbbbbbbbbb', 'Cccccccccc', 'Dddddddddd', 'Eeeeeeeeee', 'Ffffffffff', 'Gggggggggg'];
const MAXW = 700;   // 글자 70개 = 이름 6개까지 들어가는 폭
{
  const greedy = F.wrap(ctx, seven.join(' '), MAXW);
  t('종전 방식이면 실제로 6+1 이 나온다 (재현)',
    greedy.length === 2 && greedy[0].split(' ').length === 6 && greedy[1].split(' ').length === 1,
    JSON.stringify(greedy.map((l) => l.split(' ').length)));
}
{
  const lines = F.balance(ctx, seven, MAXW);
  const counts = lines.map((l) => l.split(' ').length);
  t('새 방식은 4+3', lines.length === 2 && counts[0] === 4 && counts[1] === 3, JSON.stringify(counts));
}
t('한 줄에 다 들어가면 한 줄로 둔다', F.balance(ctx, ['Aa', 'Bb', 'Cc'], MAXW).length === 1);
t('이름이 하나면 한 줄', JSON.stringify(F.balance(ctx, ['Kim Jinju'], MAXW)) === JSON.stringify(['Kim Jinju']));
t('빈 목록은 빈 결과', F.balance(ctx, [], MAXW).length === 0 && F.balance(ctx, null, MAXW).length === 0);

/* 이름이 쪼개지지 않는다 — 두 줄을 합치면 원래 목록이 순서까지 그대로여야 한다. */
{
  const names = ['Shin Haedeun', 'Kim Jinju', 'Kim Leeyeon', 'Domenico Kang', 'Park Seo Bo', 'Lee Ufan', 'Nam June Paik'];
  const lines = F.balance(ctx, names, 400);
  t('이름이 줄 사이에서 쪼개지지 않는다 (합치면 원래 순서 그대로)',
    lines.join(' ') === names.join(' '), JSON.stringify(lines));
  const w = lines.map((l) => l.length * 10);
  t('두 줄 폭 차이가 가장 작은 지점에서 잘린다',
    lines.length === 1 || Math.abs(w[0] - w[1]) <= Math.max(...names.map((n) => n.length * 10)),
    JSON.stringify(w));
}
{
  /* 한 이름이 폭을 넘으면 어떻게 잘라도 두 줄로 못 담는다 → 종전 단어 줄바꿈으로 되돌리고
     바깥의 '글자 크기 줄이기' 루프가 받는다. */
  const lines = F.balance(ctx, ['Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Bb'], 100);
  t('두 줄로 못 담으면 종전 단어 줄바꿈으로 되돌린다', lines.length >= 2);
}

/* ── 배선 ── */
t('meta 가 이름 단위를 같이 넘긴다', /contribUnits: contribUnits,/.test(SRC));
t('크레딧 칸을 모을 때 중복을 제거한다', /contribUnits = _papDedupeNames\(names\);/.test(SRC));
t('합성이 이름 단위가 있으면 균형 줄바꿈을 쓴다',
  /meta\.contribUnits && meta\.contribUnits\.length\)[\s\S]{0,120}_papCoverBalanceNames\(ctx, meta\.contribUnits, contribMaxW\)/.test(SRC));
t('편집자가 직접 쓴 경우엔 종전 단어 줄바꿈 (이름 경계를 알 수 없다)',
  /_papCoverWrap\(ctx, meta\.contributors \|\| '', contribMaxW\)/.test(SRC));
t('글자 크기를 줄일 때도 같은 규칙으로 다시 나눈다', /contribLines = _contribSplit\(\);/.test(SRC));
t('동점이면 앞줄을 더 채운다', /if \(!best \|\| diff <= best\.diff\)/.test(SRC));
t('브라우저 캐시 버전을 올렸다',
  /pap-admin\.js\?v=(17[3-9]|1[89]\d|[2-9]\d\d)/.test(fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8')));
t('테스트 스크립트 등록', /cover-credits-balance\.test\.js/.test(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
