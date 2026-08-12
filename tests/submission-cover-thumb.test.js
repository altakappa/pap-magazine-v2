/**
 * 서브미션 커버/썸네일 분리 회귀 (2026-08-12, 도메니코 리포트).
 *
 * [증상] "에디토리얼 서브미션 편집시 cover 를 누르면 thumb 와 cover 에
 * 다 적용이 되고, thumb 버튼을 누르면 아무 일도 일어나지 않는다."
 *
 * [실측 원인 2가지 — DB 8건 전수 확인 (cover==thumb, 전부 변환 URL)]
 * ① 승인 스테이징이 커버 선택 하나를 cover_image 와 thumbnail 두
 *    칸에 모두 기록했다 (review.js).
 * ② 스테이징이 기록하는 URL 은 최적화 변환(/render/image/…?width=…)
 *    형태라, 편집기의 ★/◆ 복원이 원본 URL 인 갤러리와 정확 일치
 *    비교에서 항상 실패 → ★·◆ 가 늘 1번 이미지에 겹쳐 붙고, 저장할
 *    때마다 thumbnail 이 1번 이미지로 조용히 덮였다 (pap-admin.js).
 *
 * [수정] 스테이징은 cover 만 기록(thumbnail: null — 모든 노출 경로가
 * cover_image 폴백 확인됨). 편집기는 _normImgUrl 로 변환을 벗겨낸 뒤
 * ★/◆ 를 실제 저장값과 일치하는 갤러리 이미지로 복원.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const rev = R('api/submissions/[id]/review.js');
const adm = R('frontend/pap-admin.js');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  \u2713',n);} else {fail++;console.log('  \u2717',n); if(d)console.log('     ',d);} }

console.log('\n=== \uc2b9\uc778 \uc2a4\ud14c\uc774\uc9d5: \ucee4\ubc84\ub294 \ucee4\ubc84\uc5d0\ub9cc ===');
t('스테이징 INSERT 가 thumbnail 에 커버를 복사하지 않는다',
  !/thumbnail:\s*getOptimizedThumbnail\(coverUrl\)/.test(rev),
  '커버 선택이 다시 thumbnail 까지 덮으면 이 버그가 재발한다');
t('스테이징 INSERT 는 thumbnail: null (편집기 \u2605 로만 채움)',
  /cover_image: getOptimizedHero\(coverUrl\),[\s\S]{0,600}?thumbnail: null,/.test(rev));
t('getOptimizedThumbnail import 제거 (사용처 없음)',
  !/getOptimizedThumbnail/.test(rev));
t('cover_image 는 여전히 최적화 히어로로 기록', /cover_image: getOptimizedHero\(coverUrl\)/.test(rev));

console.log('--- \ud3b8\uc9d1\uae30 \ubcf5\uc6d0: \ubcc0\ud658 URL \ub530\uc704\ub294 \ubb34\uc2dc ---');
t('_normImgUrl 헬퍼 존재 (render/image \u2192 object, \ucffc\ub9ac \uc81c\uac70)',
  /function _normImgUrl\(u\)\{[\s\S]{0,300}?render\/image\/public\/[\s\S]{0,200}?object\/public\//.test(adm));
t('\u2605 THUMB 복원이 정규화 비교 사용',
  /thumbMatch = galleryImages\.find\(function\(g\)\{ return _normImgUrl\(g\.src\) === _normImgUrl\(savedThumbUrl\); \}\);/.test(adm));
t('thumbnail 비었을 때 \u2605 기본값은 커버와 같은 이미지',
  /if\(!thumbMatch && !savedThumbUrl && ed\.cover_image\)\{/.test(adm));
t('\u25c6 COVER 복원도 저장된 cover_image 와 매칭 (\ubb34\uc870\uac74 1\ubc88 \uae08\uc9c0)',
  /_coverMatch = ed\.cover_image \? galleryImages\.find\(function\(g\)\{ return _normImgUrl\(g\.src\) === _normImgUrl\(ed\.cover_image\); \}\) : null;/.test(adm));
t('\u2605 정확 일치 구식 비교 제거됨',
  !/return g\.src === savedThumbUrl;/.test(adm));

console.log('--- \uc800\uc7a5 \ub9e4\ud551 \ubd88\ubcc0 (\ud68c\uadc0 \uac10\uc2dc) ---');
t('finalThumb = \u2605 \uc120\ud0dd \u2192 \uccab \uac24\ub7ec\ub9ac \ud3f4\ubc31',
  /var finalThumb = thumbUrlPick \|\| \(galleryUrls\.length \? galleryUrls\[0\] : null\);/.test(adm));
t('finalCover = \uc0c8 \uc5c5\ub85c\ub4dc \u2192 \uae30\uc874 \ucee4\ubc84 \u2192 \uc378\ub124\uc77c \ud3f4\ubc31',
  /var finalCover = thumbUrl \|\| existingCoverUrl \|\| finalThumb;/.test(adm));

console.log('--- \uce90\uc2dc\ubc84\uc2a4\ud2b8 ---');
t('admin.html \uc774 pap-admin.js v147+ \ucc38\uc870',
  /pap-admin\.js\?v=(14[7-9]|1[5-9]\d|[2-9]\d\d)/.test(R('frontend/admin.html')));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('\u274c submission-cover-thumb tests FAILED'); process.exit(1); }
