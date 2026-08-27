/**
 * realImage 가드 — 껍데기 화보가 새 표면으로 새지 않게 (2026-08-27)
 *
 * 배경: 발행 화보 2,304편 중 14편이 사진 없는 껍데기(플레이스홀더 SVG 10 · 죽은
 * 드라이브 4, 크레딧은 더미 "Photographer"). Web Story 는 "커버가 있으면 만든다"
 * 였으므로 그대로 두면 구글에 그라데이션 이미지를 광고할 뻔했다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const lib = rd('api/_lib/realImage.js');
const smap = rd('api/sitemap-stories.js');
const story = rd('api/seo/story-editorial/[slug].js');
const edSitemap = rd('api/sitemap-editorials.js');

const { isRealImage, hasRealImagery } = require('../api/_lib/realImage.js');

console.log('=== realImage 판정 ===');
t('data: URI 플레이스홀더 거부', isRealImage('data:image/svg+xml,%3Csvg%3E') === false);
t('죽은 드라이브 썸네일 거부', isRealImage('https://drive.google.com/thumbnail?id=x') === false);
t('wixstatic 거부', isRealImage('https://static.wixstatic.com/media/a.jpg') === false);
t('빈 값·비URL 거부', !isRealImage('') && !isRealImage(null) && !isRealImage('foo.jpg'));
t('정상 https 이미지 허용', isRealImage('https://cdn.example.com/a.jpg') === true);
t('hasRealImagery — 갤러리에 하나라도 있으면 true',
  hasRealImagery({ cover_image: 'data:image/svg+xml,x', gallery: ['https://c.dn/a.jpg'] }) === true);
t('hasRealImagery — 전부 껍데기면 false',
  hasRealImagery({ cover_image: 'data:image/svg+xml,x', gallery: ['data:image/svg+xml,y'] }) === false);

console.log('\n=== 표면 적용 ===');
t('스토리 사이트맵이 hasRealImagery 로 거른다', /hasRealImagery\(e\)/.test(smap));
t('스토리 핸들러가 껍데기를 404 로 막는다',
  /hasRealImagery\(ed\)/.test(story) && /\.filter\(isRealImage\)/.test(story));
t('화보 사이트맵이 껍데기 이미지를 광고하지 않는다',
  /\.find\(isRealImage\)/.test(edSitemap));
t('발행 상태(status)는 건드리지 않는다 — 노출 억제 전용',
  !/update\(\{[^}]*status/.test(smap) && !/update\(\{[^}]*status/.test(story)
  && /발행 상태\(status\)는 절대 건드리지 않는다/.test(lib));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ real-image-guard tests passed');
