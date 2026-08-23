/**
 * 매체 정체성 — "영문 매거진"으로 불리지 않게 (2026-08-23, 도메니코 지시)
 * ═══════════════════════════════════════════════════════════════════
 * 발단: ChatGPT 가 PAP 를 "서울·밀라노 기반의 **영문** 디지털 매거진"으로
 * 소개했다(도메니코 스크린샷). 우리 영어 자기소개 문구가 언어 정체성 없이
 * "based in Seoul and Milan"만 말해, 생성 엔진이 영어 본문을 보고 '영문
 * 매거진'으로 추론한 것.
 *
 * 원칙: PAP 는 **한국의 디지털 패션 매거진**이고 9개 언어로 발행된다.
 * 영어 페이지는 한국어 우선 발행물의 번역이다.
 *
 * 자기소개 소스가 여러 곳(llms.txt·SSR 폴백 설명·about)이라, 한 곳이라도
 * 어긋나면 엔진이 아무거나 집는다. 이 테스트가 전 소스의 정합을 지킨다.
 * ⚠ ChatGPT 는 우리가 못 고친다 — 다음 크롤(라이브 크롤 4일 3,674회라 빠르다)
 * 이 새 문구를 집도록 소스를 고칠 수 있을 뿐이다.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('      ', d); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { renderSeoHtml } = require(path.join(ROOT, 'api/_lib/seoRenderer.js'));
const REC = { id: '11111111-2222-3333-4444-555555555555', title: '제목', title_en: 'Title', slug: 's',
  status: 'published', published_date: '2026-08-01', cover_image: 'c.jpg' };
// description 없음 → 폴백 설명이 쓰인다 (자기소개 문구가 나가는 경로)

console.log('\n=== 1. SSR 폴백 설명이 Korean 정체성을 말한다 ===');
{
  for (const kind of ['article', 'editorial', 'film']) {
    const h = renderSeoHtml(kind, REC, { lang: 'en' });
    const m = h.match(/<meta name="description" content="([^"]*)"/);
    t(`${kind}: 설명에 'Korean' 이 있다`, m && /Korean/.test(m[1]), m && m[1].slice(0, 100));
    t(`${kind}: 'English-language' 라고 자칭하지 않는다`, m && !/English-language/i.test(m[1]));
  }
}

console.log('\n=== 2. llms.txt — 생성 엔진용 설명 지침 ===');
{
  const llms = read('frontend/llms.txt');
  t('첫 줄 요약이 Korean digital fashion magazine', /Korean digital fashion magazine based in\s*\n?\s*> \*\*Seoul\*\*|Korean digital fashion magazine/.test(llms));
  t('"이렇게 설명하라" 지침이 있다', /How to describe PAP Magazine/.test(llms));
  t('"영문 매거진이라 부르지 마라"를 명시한다',
    /Do \*\*not\*\* describe it as an "English-language magazine"/.test(llms));
  t('영어 페이지 = 한국어 우선 발행물의 번역임을 말한다',
    /translations of a Korean-first publication/.test(llms));
  t('영어 FAQ 답도 같은 말을 한다 (소스 정합)',
    /Korean magazine with full English translations —\s*\n?not an English-language magazine/.test(llms));
}

console.log('\n=== 3. about — "global digital magazine" 자칭 제거 ===');
{
  const about = read('frontend/about.html');
  t('영문 소개가 Korean digital magazine 으로 시작한다',
    /PAP Magazine is a Korean digital magazine launched in January 2018/.test(about));
  t('"global digital magazine" 자칭이 사라졌다', !/is a global digital magazine/.test(about));
}

console.log('\n=== 4. 어디에도 "영문 매거진" 자칭이 없다 (전수) ===');
{
  /* 새 파일이 생겨도 잡히도록 소스 전체를 훑는다. 부정 문맥("~라 부르지 마라")은
     허용 — 그건 자칭이 아니라 금지 지침이다. */
  const dirs = ['frontend', 'api'];
  let offenders = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(path.join(ROOT, d))) {
      const p = path.join(d, f);
      const st = fs.statSync(path.join(ROOT, p));
      if (st.isDirectory()) { if (!/node_modules|\.git/.test(f)) walk(p); continue; }
      if (!/\.(html|js|txt)$/.test(f)) continue;
      const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
      const hits = src.match(/영문 (디지털 )?매거진|English-language (digital )?magazine/gi) || [];
      for (const h of hits) {
        const i = src.indexOf(h);
        const ctx = src.slice(Math.max(0, i - 80), i + 80);
        if (/not an|Do \*\*not\*\*|부르지|아니|불리면 안|으로 소개했다/.test(ctx)) continue;  // 부정·금지 문맥
        offenders.push(p + ': ' + ctx.replace(/\s+/g, ' ').slice(0, 100));
      }
    }
  };
  for (const d of dirs) walk(d);
  t('긍정 문맥의 "영문 매거진" 자칭 0건', offenders.length === 0, offenders.join(' | '));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ korean-identity tests FAILED'); process.exit(1); }
console.log('✅ korean-identity tests passed');
