/**
 * 풀레터 무드보드 형식 검증 3계층 정합 (2026-07-22 QA: "unsupported moodboard type").
 *
 * [원인] 무드보드 안내 문구는 "JPG·PNG·PDF·PPT" 인데 서버 화이트리스트
 * (api/pullletters/upload-url.js MOODBOARD_MIME)는 이미지만 허용했다. 그래서
 * 안내대로 올린 PDF 가 415 로 거부되고 영문 "unsupported moodboard type" 팝업이 떴다.
 *
 * [이 테스트가 지키는 것]
 *  1. 서버 무드보드 화이트리스트가 PDF·PPT 를 허용한다 (안내와 일치)
 *  2. 서버가 빈 MIME 대비 확장자 폴백을 갖는다
 *  3. 촬영시안(proposal)은 여전히 PDF 전용 (형식 분리 유지)
 *  4. 프론트 addFiles 허용 목록도 PDF·PPT 포함, 용량 25MB, 영문 하드코딩 토스트 제거
 *  5. 무드보드/촬영시안 검증이 서로 뒤바뀌지 않음(각자 category 로 분기)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const server = R('api/pullletters/upload-url.js');
const html   = R('frontend/pullletter.html');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 풀레터 무드보드 형식 정합 (JPG/PNG/PDF/PPT) ===');

// 1) 서버 화이트리스트
const moodSet = (server.match(/const MOODBOARD_MIME = new Set\(\[([\s\S]*?)\]\)/) || ['',''])[1];
t('서버: 무드보드가 application/pdf 허용', /application\/pdf/.test(moodSet));
t('서버: 무드보드가 PPT(ms-powerpoint) 허용', /vnd\.ms-powerpoint/.test(moodSet));
t('서버: 무드보드가 PPTX 허용', /presentationml\.presentation/.test(moodSet));

// 2) 확장자 폴백
t('서버: 확장자 폴백 세트(MOODBOARD_EXT) 존재', /const MOODBOARD_EXT = new Set\(/.test(server));
t('서버: 검증이 MIME 또는 확장자로 통과', /!MOODBOARD_MIME\.has\(type\)\s*&&\s*!MOODBOARD_EXT\.has\(/.test(server));

// 3) 촬영시안은 PDF 전용 유지 (형식 분리)
t('서버: proposal 은 application/pdf 강제 유지', /type !== 'application\/pdf'[\s\S]*?proposal must be application\/pdf/.test(server));
t('서버: category 로 moodboard/proposal 분기 유지', /category === 'proposal'/.test(server) && /unsupported moodboard type/.test(server));

// 4) 프론트 addFiles
const addFiles = (html.match(/function addFiles\(files\)\{[\s\S]*?renderFileList\(\);\n\}/) || [''])[0];
t('프론트: addFiles 가 application/pdf 허용', /application\/pdf/.test(addFiles));
t('프론트: addFiles 가 PPT 허용', /vnd\.ms-powerpoint/.test(addFiles) && /presentationml\.presentation/.test(addFiles));
t('프론트: 무드보드 용량 25MB 로 정합', /maxSize=25\*1024\*1024/.test(addFiles));
t('프론트: 영문 하드코딩 토스트 제거(Invalid file type 등 없음)',
  !/Invalid file type|File too large \(max 20MB\)|Maximum 20 files allowed/.test(addFiles),
  '영문 하드코딩이 남아 있으면 한국어화 회귀');
t('프론트: 형식 오류를 i18n(moodBadType)으로 안내', /_getValText\('moodBadType'\)/.test(addFiles));

// 4b) 용량 통일 — 무드보드·촬영시안 모두 25MB (2026-07-22 도메니코 지시)
t('서버: 촬영시안 상한 25MB', /MAX_PROPOSAL_SIZE = 25 \* 1024 \* 1024/.test(server));
t('서버: 무드보드 상한 25MB', /MAX_MOODBOARD_SIZE = 25 \* 1024 \* 1024/.test(server));
t('프론트: 촬영시안 상한 25MB', /PROPOSAL_MAX_BYTES = 25\*1024\*1024/.test(html));
t('프론트: 촬영시안 안내문구에 20MB 잔존 없음', !/max 20MB|최대 20MB|20MB 이하|20 Mo|20 МБ/.test(html), '20MB 문구가 남으면 통일 실패');

// 5) i18n 키 존재 (한국어)
t('프론트: moodBadType 한국어 문구 존재', /moodBadType:\{ko:'지원하지 않는 파일 형식/.test(html));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ pullletter-moodboard-format tests FAILED'); process.exit(1); }
console.log('✅ pullletter-moodboard-format tests passed');
