/**
 * og_image 낡은 값 가드 회귀 (2026-09-03, created_by: 다인)
 *
 * 무슨 사고였나:
 *   LIMINAL BEING 복구 검증 중, 갤러리·커버는 Supabase 로 잘 옮겨졌는데
 *   페이지의 og:image · twitter:image · 상단 커버 · Pinterest media 는
 *   여전히 구글 드라이브를 가리키고 있었다.
 *
 *   원인: 이미지 이관 크론(api/cron/migrate-external-images.js)과 선별 함수
 *   external_image_editorials 가 cover_image · thumbnail · gallery 만 보고
 *   **og_image 를 통째로 빠뜨렸다.** 그런데 seoRenderer 의 폴백 사슬은
 *   `record.og_image || record.cover_image || ...` 라 낡은 og_image 가
 *   멀쩡한 커버를 이겨버린다.
 *
 *   전수 실측(발행 2,292건): og_image 가 Supabase 인 건 135건(5.9%) 뿐이고
 *   드라이브 1,074 · 구 S3 887 · wix 35 · data: URI 플레이스홀더 161,
 *   합계 2,157건(94%)이 외부 의존이거나 SNS 에서 아예 안 뜨는 값이었다.
 *   DB 는 og_image = cover_image 로 일괄 정정했다(백업: og_image_backup_20260903).
 *
 * 이 테스트가 지키는 것:
 *   1) 렌더 시점 방어 — 못 쓰는 og_image 는 무시하고 cover_image 로 흘러간다
 *   2) 멀쩡한 og_image 는 그대로 존중한다 (과잉 방어 금지)
 *   3) 크론이 커버를 옮길 때 og_image 도 같이 맞춘다
 *
 *   1번이 핵심이다. 3번만 고치면 '앞으로'는 막지만, 어떤 경로로든 낡은 값이
 *   다시 들어오면 화면이 또 깨진다. 마지막 방어선은 렌더 쪽에 있어야 한다.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { renderSeoHtml } = require(path.join(__dirname, '..', 'api', '_lib', 'seoRenderer.js'));

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

const COVER = 'https://igcazquhkwxtqsaqpznx.supabase.co/storage/v1/object/public/media/migrated/abc/1_0.jpg';
function ogOf(og) {
  const html = renderSeoHtml('editorial', {
    title: 'TEST', slug: 'og-guard', status: 'published',
    published_date: '2026-09-03', description: '짧음',
    cover_image: COVER, og_image: og,
  }, { lang: 'ko' });
  const m = html.match(/<meta property="og:image" content="([^"]*)"/);
  return m ? m[1] : '';
}

console.log('\n=== ① 못 쓰는 og_image 는 커버로 흘러간다 ===');
t('구글 드라이브 링크는 무시', ogOf('https://drive.google.com/thumbnail?id=ABC&sz=w1600') === COVER, ogOf('https://drive.google.com/thumbnail?id=ABC&sz=w1600'));
t('구 S3 링크는 무시', ogOf('https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5b66d87dcb.jpg') === COVER);
t('wixstatic 링크는 무시 (핫링크 차단 대상)', ogOf('https://static.wixstatic.com/media/462397_01e2.jpg') === COVER);
t('data: URI 플레이스홀더는 무시 (SNS 가 렌더 못 함)', ogOf('data:image/svg+xml,%3Csvg%20xmlns%3D%22x%22%3E%3C%2Fsvg%3E') === COVER);
t('빈 문자열·공백은 무시', ogOf('   ') === COVER && ogOf('') === COVER);
t('null 이면 기존 폴백대로 커버', ogOf(null) === COVER);

console.log('\n=== ② 멀쩡한 og_image 는 존중한다 (과잉 방어 금지) ===');
const CUSTOM = 'https://igcazquhkwxtqsaqpznx.supabase.co/storage/v1/object/public/media/custom-og.jpg';
t('Supabase 자사 URL 은 그대로 쓴다', ogOf(CUSTOM) === CUSTOM, ogOf(CUSTOM));

console.log('\n=== ③ 이관 크론이 og_image 도 같이 맞춘다 ===');
const cron = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'migrate-external-images.js'), 'utf8');
t('커버를 옮길 때 og_image 패치를 건다', /patch\.og_image\s*=\s*patch\.cover_image/.test(cron));
t('낡은 값일 때만 덮어쓴다 (멀쩡한 og 보존)', /EXTERNAL_RE\.test\(og\)/.test(cron) && /og\.startsWith\('data:'\)/.test(cron));
t('선별 함수에서 og_image 를 받아 본다', /row\.og_image/.test(cron));

console.log('\n=== ④ 렌더 쪽 가드가 코드에 남아 있다 ===');
const seo = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'seoRenderer.js'), 'utf8');
t('OG_UNUSABLE_RE 로 판정한다', /OG_UNUSABLE_RE/.test(seo));
t('폴백 사슬 첫 자리가 raw og_image 가 아니다', /const ogImage = ogUsable/.test(seo));

console.log(`\nog_image 낡은 값 가드: ${pass}건 통과${fail ? `, ${fail}건 실패` : ''}`);
if (fail) process.exit(1);
