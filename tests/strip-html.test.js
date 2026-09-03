/**
 * 태그만 지운다 · 꺾쇠 제목은 살린다 (2026-09-03)
 *
 * 실제 사고: 2026-09-03 04:50 에 나간 X 트윗이 주어 없이 시작했다.
 *     "가 젠데이아와 로버트 패틴슨의 결혼식에 초대받았다."
 * 기사 원문은 "<PAP>가 …" 였고, 태그 제거 정규식이 <PAP> 를 지웠다.
 *
 * 이 하네스가 지키는 것
 *   ① 사고 재현 — <PAP> 와 <더 드라마> 가 살아남는다
 *   ② 진짜 HTML 태그는 여전히 지운다
 *   ③ 부등호(a < b)를 태그로 오해하지 않는다
 *   ④ 구분자 인자를 지킨다 ('' 이면 글자가 붙는다)
 *   ⑤ 규칙은 한 벌 — stripHtml 과 dropKnownTags 가 같은 판단을 한다
 *   ⑥ 실제 발신 경로에서도 살아남는다 (정규식이 아니라 **나가는 글**을 본다)
 *   ⑦ 일부러 뺀 곳은 그대로 (입력 위생 · 외부 피드 파서)
 *   ⑧ 전환이 빠짐없이 됐다 — 옛 정규식이 남은 곳은 ⑦의 목록뿐이다
 */
'use strict';

/* 2026-07-30 사고 재발 방지 — 라이브러리를 부르면 supabase 가 딸려 와서
   키 없는 CI 에서 죽는다. 먼저 가짜를 캐시에 심는다. */
const path = require('path');
const fs = require('fs');
const supaPath = require.resolve('../api/_lib/supabase');
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true,
  exports: { supabaseAdmin: { from() { throw new Error('테스트는 DB 를 안 쓴다'); } } } };
delete process.env.ANTHROPIC_API_KEY;   // 모델 없는 결정적 경로

const { stripHtml, stripHtmlTight, dropKnownTags, HTML_TAG_RE } = require('../api/_lib/stripHtml');

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}

console.log('\n=== ① 사고 재현 ===');
{
  const 원문 = '<PAP>가 젠데이아와 로버트 패틴슨의 결혼식에 초대받았다. 영화 <더 드라마>의 프로모션 이벤트다.';
  const out = stripHtmlTight(원문);
  t('매체 이름 <PAP> 가 남는다', out.indexOf('<PAP>') !== -1, out);
  t('작품 제목 <더 드라마> 가 남는다', out.indexOf('<더 드라마>') !== -1, out);
  t('주어 없이 조사부터 시작하지 않는다', !/^가 /.test(out), out);
  t('종전 정규식이었다면 깨졌다 (대조)', /^가 /.test(원문.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
}

/* 두 가지 쓰임(직접 호출 · 체인 중간)을 **둘 다** 통과해야 한다.
   한쪽만 재면 다른 쪽이 조용히 어긋나도 모른다. */
function 양쪽(input, expect, sep) {
  const a = stripHtmlTight(input, sep);
  const b = String(input).replace(HTML_TAG_RE, dropKnownTags(sep === undefined ? ' ' : sep))
    .replace(/\s+/g, ' ').trim();
  return a === expect && b === expect;
}

console.log('\n=== ② 진짜 태그는 지운다 (직접 호출·체인 양쪽) ===');
{
  t('<br>', 양쪽('한<br>줄', '한 줄'));
  t('대문자 <BR>', 양쪽('한<BR>줄', '한 줄'));
  t('속성 있는 여는 태그', 양쪽('<p class="x" data-y="1">본문</p>', '본문'));
  t('자기닫힘 <img />', 양쪽('앞<img src="a.jpg" />뒤', '앞 뒤'));
  t('닫는 태그 </div>', 양쪽('가</div>나', '가 나'));
  t('주석', stripHtmlTight('가<!-- 메모 -->나') === '가 나');
  t('AMP 태그도 안다 (웹스토리)', 양쪽('<amp-img src="a">캡션</amp-img>', '캡션'));
  t('여러 줄에 걸친 속성', 양쪽('<a\n  href="x">링크</a>', '링크'));
}

console.log('\n=== ③ 부등호를 태그로 보지 않는다 ===');
{
  t('a < b', stripHtmlTight('a < b 이다').indexOf('<') !== -1);
  t('숫자 비교 3 <5', stripHtmlTight('3 <5 는 참').indexOf('<') !== -1);
  t('모르는 이름은 남긴다', stripHtmlTight('<Vogue>와 <PAP>').indexOf('<Vogue>') !== -1);
}

console.log('\n=== ④ 구분자 인자 ===');
{
  t("''  이면 글자가 붙는다", 양쪽('강남<b>역</b>', '강남역', ''));
  t("생략하면 공백", 양쪽('강남<b>역</b>', '강남 역'));
}

console.log('\n=== ⑤ 규칙은 한 벌이다 ===');
{
  const 표본 = ['<PAP>가 왔다', '<b>굵게</b>', '<더 드라마>', 'a < b', '<amp-img src="x">'];
  const 같다 = 표본.every((s) => stripHtml(s) === s.replace(HTML_TAG_RE, dropKnownTags(' ')));
  t('stripHtml 과 dropKnownTags 가 같은 판단', 같다);
}

console.log('\n=== ⑥ 실제 발신 경로 (정규식이 아니라 나가는 글을 본다) ===');
(async () => {
  const art = {
    title: '젠데이아와 로버트 패틴슨의 결혼식에 다녀왔다',
    url: 'https://www.pap-magazine.com/article/zendaya-wedding',
    tags: ['젠데이아'],
    body: '<PAP>가 젠데이아와 로버트 패틴슨의 결혼식에 초대받았다. 영화 <더 드라마>의 프로모션 이벤트다.',
  };
  const { buildThreadsParityTweet } = require('../api/_lib/xPost');
  const tw = await buildThreadsParityTweet(art);
  t('X 트윗 본문에 <PAP> 가 남는다', tw.body.indexOf('<PAP>') !== -1, tw.body);
  t('X 트윗이 조사부터 시작하지 않는다', !/\n\n가 /.test(tw.body), tw.body);

  const { fallbackBody } = require('../api/_lib/threadsAutopost');
  const th = fallbackBody({ title: art.title, content: art.body });
  t('스레드 본문에도 <PAP> 가 남는다', th.indexOf('<PAP>') !== -1, th);

  const { htmlToText } = require('../api/_lib/socialRepurpose');
  t('리퍼포즈 텍스트에도 남는다', htmlToText(art.body, 500).indexOf('<PAP>') !== -1);

  const { descFromBody } = require('../api/_lib/seoRenderer');
  const d = descFromBody(art.body + ' '.repeat(0) + ' 추가 문장으로 최소 길이를 넘긴다. 더 붙인다.');
  t('구글 메타 설명에도 남는다 (SEO)', d.indexOf('<PAP>') !== -1, d);

  console.log('\n=== ⑦ 일부러 뺀 곳은 그대로다 ===');
  const 제외 = [
    ['api/_lib/validate.js', '입력 위생 — 여기서는 모르는 태그일수록 지워야 한다'],
    ['api/cron/celeb-watch.js', '외부 피드 파서'],
    ['api/cron/weekly-news.js', '외부 피드 파서'],
    ['api/cron/trend-scout.js', '외부 피드 파서'],
    ['api/cron/studio-import.js', '외부 HTML 파서'],
  ];
  for (const [f, why] of 제외) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    t('이 함수를 쓰지 않는다 — ' + f + ' (' + why + ')', src.indexOf('stripHtml') === -1, f);
  }

  console.log('\n=== ⑧ 전환이 빠짐없이 됐다 ===');
  {
    /* 규칙을 설명하는 주석에 옛 정규식이 그대로 적혀 있다. 그건 사고 기록이라 남긴다. */
    const 제외집합 = new Set(제외.map(([f]) => f).concat(['api/_lib/stripHtml.js']));
    const 남은 = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
        if (!name.endsWith('.js')) continue;
        const rel = path.relative(path.join(__dirname, '..'), p).split(path.sep).join('/');
        let src; try { src = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
        if (/replace\(\/<\[\^>\][*+]>\/g/.test(src) && !제외집합.has(rel)) 남은.push(rel);
      }
    };
    walk(path.join(__dirname, '..', 'api'));
    t('옛 정규식이 남은 곳은 일부러 뺀 목록뿐이다', 남은.length === 0,
      '아직 남음: ' + 남은.join(', ') + ' — 새 파일이면 stripHtml 을 쓰거나 ⑦ 목록에 이유와 함께 넣을 것');
  }

  console.log('\n' + (fail ? '✗' : '✓') + ' strip-html: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
