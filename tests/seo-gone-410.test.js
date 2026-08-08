/**
 * 내려간 콘텐츠 410 + 깨진 슬러그 관용 — tests/seo-gone-410.test.js (2026-08-08 신설)
 *
 * 왜 만들었나 ────────────────────────────────────────────────────────
 * GSC 메일: "페이지 색인 생성 문제(404)가 일부 해결되지 않음" — 839건, 5월
 * 250건에서 계속 증가. 표본 10개 실측:
 *
 *   7건  발행됐다가 draft 로 내려간 기사·화보 (DB엔 있음, status='draft')
 *        — draft 기사 162 + draft 화보 213 × 언어 프리픽스 = 집계의 몸통
 *   1건  슬러그에 공백이 낀 깨진 링크 (/editorial/donde -tdo-florece)
 *   2건  존재한 적 없는 외부발 잡경로 (/contrassts 등) — 404 가 정답
 *
 * 조치:
 *   ① 내려간(비공개 전환) 콘텐츠 → 410 Gone. 404 는 "일시적일 수 있음"이라
 *      구글이 계속 재방문하고, 410 은 "의도적 제거" — 색인에서 빨리 빠진다.
 *   ② 공백 낀 슬러그 → 공백 제거형이 존재하면 정규 URL 로 301.
 *
 * 여기서 지키는 것:
 *   - 410 판별은 반드시 neq(status, published) — 예약 발행(published+미래
 *     scheduled_publish_at) 화보가 410 + s-maxage=86400 에 걸리면 발행
 *     당일 하루 종일 CDN 캐시에 숨는다 (구현 중 실제로 잡은 함정).
 *   - 공개 조회의 status='published' 필터는 한 줄도 느슨해지지 않는다.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const art = R('api/seo/article/[slug].js');
const ed = R('api/seo/editorial/[slug].js');

console.log('\n[1] 기사 — 내려간 콘텐츠는 410');
{
  t('410 분기가 있다', /status\(410\)/.test(art));
  t('custom_url 로도 gone 을 판별한다 (기사 한글 URL 은 custom_url)',
    /eq\('custom_url', decoded\)\.neq\('status', 'published'\)/.test(art));
  t('slug 로도 판별한다', /eq\('slug', decoded\)\.neq\('status', 'published'\)/.test(art));
  t('UUID 로도 판별한다 (/article/<uuid> 레거시)',
    /eq\('id', slug\)\.neq\('status', 'published'\)/.test(art));
  t('410 은 오래 캐시한다 (재크롤 감소가 목적)',
    /s-maxage=86400[\s\S]{0,120}status\(410\)/.test(art));
  t('존재한 적 없는 URL 은 여전히 404', /status\(404\)\.send\(renderNotFoundHtml\('article'/.test(art));
  t('410 판별 실패는 404 로 안전 폴백', /410 판별 실패[\s\S]{0,40}404/.test(art));
}

console.log('\n[2] 에디토리얼 — 410 + 예약 발행 안전핀');
{
  t('410 분기가 있다', /status\(410\)/.test(ed));
  /* 예약 발행: status='published' + 미래 scheduled_publish_at 는 스케줄
     필터가 data 를 비운다. gone 판별에 neq(published) 가 없으면 그 행이
     걸려 발행 당일 410 이 하루 캐시된다 — 절대 재발 금지. */
  const goneBlock = ed.split('410 Gone')[1] ? ed.split('410 Gone')[1].split('status(404)')[0] : '';
  t('gone 판별 전부에 neq(published) — 예약 발행이 410 에 안 걸린다',
    (goneBlock.match(/neq\('status', 'published'\)/g) || []).length >= 2
    && !/\.eq\('slug', decoded\)\.limit\(1\)\.maybeSingle\(\)/.test(goneBlock));
  t('존재한 적 없는 URL 은 여전히 404', /status\(404\)\.send\(renderNotFoundHtml\('editorial'/.test(ed));
}

console.log('\n[3] 공백 낀 슬러그 — 301 정규화');
{
  t('공백 제거 재조회가 있다', /decoded\.replace\(\/\\s\+\/g, ''\)/.test(ed));
  t('찾으면 200 이 아니라 301 (깨진 URL 이 색인되면 안 된다)',
    /despaced[\s\S]{0,400}status\(301\)/.test(ed));
  t('published 만 대상 (draft 로 301 금지)',
    /eq\('slug', despaced\)\.eq\('status', 'published'\)/.test(ed));
}

console.log('\n[4] 공개 조회 필터는 느슨해지지 않았다');
{
  /* 410 작업이 공개 lookup 의 published 필터를 건드렸다면 draft 유출이다. */
  const pubLookups = (s) => (s.match(/select\('\*'\)[\s\S]{0,120}?\.eq\('status', 'published'\)/g) || []).length;
  t('기사 공개 lookup 전부 published 필터 유지 (' + pubLookups(art) + '개)', pubLookups(art) >= 7);
  t('에디토리얼 공개 lookup 전부 published 필터 유지 (' + pubLookups(ed) + '개)', pubLookups(ed) >= 7);
  t("기사에 select('*') + neq(published) 조합이 없다 (gone 판별은 id 만 뽑는다)",
    !/select\('\*'\)[\s\S]{0,120}?\.neq\('status', 'published'\)/.test(art));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ seo-gone-410 tests FAILED'); process.exit(1); }
console.log('✅ seo-gone-410 tests passed');
