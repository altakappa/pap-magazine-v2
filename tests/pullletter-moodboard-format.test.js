/**
 * 풀레터 촬영시안 통합 구조 회귀 (2026-07-22 도메니코 지시).
 *
 * [변경] 별도 "무드보드 파일 업로드" 란을 폐지하고, 무드보드·촬영 컨셉·
 * 팀 구성을 촬영시안 PDF 하나에 포함하는 구조로 통합했다.
 * (이 파일의 이전 버전은 무드보드 형식 3계층 정합 테스트였다 — 폼에서
 *  무드보드 업로드 자체가 사라지며 프론트 어서션을 통합 구조 기준으로 교체.
 *  서버 upload-url 의 moodboard category 는 과거 요청 호환용으로 유지.)
 *
 * [이 테스트가 지키는 것]
 *  1. 폼에 무드보드 업로드란이 되살아나지 않는다 (단일 시안 PDF 원칙)
 *  2. 시안 안내문구에 무드보드·촬영 컨셉·팀 구성 포함이 명시된다 (ko+기본)
 *  3. 프론트·서버 모두 무드보드 없이 제출 가능 (필수 검증 제거)
 *  4. 촬영시안 PDF 는 여전히 필수 + PDF 전용 + 25MB
 *  5. 과거 요청의 무드보드(file_urls)는 마이페이지에서 계속 표시 (하위 호환)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const server = R('api/pullletters/upload-url.js');
const idx    = R('api/pullletters/index.js');
const html   = R('frontend/pullletter.html');
const papi   = R('frontend/pap-api.js');
const mp     = R('frontend/mypage.html');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 풀레터 촬영시안 통합 (무드보드란 폐지) ===');

// 1) 폼에서 무드보드 업로드란 제거 유지
t('폼: 무드보드 업로드 마크업(uploadZone/fileInput) 없음',
  !/id="uploadZone"/.test(html) && !/id="fileInput"/.test(html),
  '무드보드 업로드란이 되살아나면 단일 시안 PDF 원칙 붕괴');
t('폼: 무드보드 필수 검증(err-moodboard/noFiles 체크) 없음',
  !/getElementById\('err-moodboard'\)/.test(html));
t('폼: create 호출이 무드보드 빈 배열 전달', /pullLetters\.create\(data, \[\], proposalFile/.test(html));

// 2) 시안 안내문구 — 무드보드·촬영 컨셉·팀 구성 포함 명시
t('안내(ko): 무드보드·촬영 컨셉·팀 구성 포함 명시',
  /proposalHelp:'[^']*무드보드[^']*촬영 컨셉[^']*팀 구성[^']*'/.test(html));
t('안내(기본/EN): mood board·concept·team 명시',
  /data-i18n="proposalHelp">[^<]*mood board[^<]*concept[^<]*team/i.test(html));

// 3) 무드보드 없이 제출 가능
t('pap-api: 무드보드 필수 throw 제거',
  !/At least one moodboard image is required/.test(papi));
t('서버(index): JSON·레거시 경로 모두 무드보드 필수 400 제거',
  !/At least one moodboard image is required/.test(idx));

// 4) 촬영시안 PDF 는 여전히 필수·PDF 전용·25MB
t('pap-api: proposal PDF 필수 유지', /if \(!proposalPdf\) throw new Error\('Proposal PDF is required'\)/.test(papi));
t('서버(index): proposalPath 검증 유지(경로+pdf 확장자)', /촬영시안 PDF is required/.test(idx));
t('서버(upload-url): proposal 은 application/pdf 강제 유지',
  /type !== 'application\/pdf'[\s\S]*?proposal must be application\/pdf/.test(server));
t('프론트: 촬영시안 상한 25MB 유지', /PROPOSAL_MAX_BYTES = 25\*1024\*1024/.test(html));
t('프론트: 제출 검증에 proposal 필수 체크 유지', /_getValText\('noProposal'\)/.test(html));

// 5) 하위 호환 — 과거 요청 무드보드 표시 + 서버 category 유지
t('서버(upload-url): moodboard category 하위 호환 유지', /category === 'proposal'/.test(server) && /MOODBOARD_MIME/.test(server));
t('마이페이지: 과거 무드보드(file_urls) 렌더 유지', /Array\.isArray\(r\.file_urls\)/.test(mp));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ pullletter-moodboard-format tests FAILED'); process.exit(1); }
console.log('✅ pullletter-moodboard-format tests passed');
