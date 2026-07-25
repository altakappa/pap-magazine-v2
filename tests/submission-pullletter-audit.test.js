/**
 * 서브미션·풀레터 감사(2026-07-26) 회귀 테스트
 * ─────────────────────────────────────────────────────────────────────
 * 웹사이트 담당 감사 문서의 A-1 / A-3 / B-1 / B-2 / C-1 조치가 되돌아가지
 * 않도록 감시한다. (A-2 / A-6 는 코드가 아니라 Supabase 버킷 설정 항목이라
 * 여기서 검증하지 않는다 — 별도 콘솔 확인)
 *
 *  A-1  사용자 URL 의 javascript:/data: 스킴 차단 (서버 저장 거부 + 렌더 방어)
 *  A-3  서버 내부 에러 원문의 클라이언트 노출 제거
 *  B-1  소유자 삭제 시 스토리지 고아 객체 정리
 *  B-2  풀레터 신청자 철회(소유자 전용 DELETE)
 *  C-1  오류 문구 다국어화 + 서버 원문 비노출
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const plApi     = R('api/pullletters/index.js');
const plDelete  = R('api/pullletters/[id]/index.js');
const subId     = R('api/submissions/[id].js');
const subUpload = R('api/submissions/upload-url.js');
const admin     = R('frontend/pap-admin.js');
const papApi    = R('frontend/pap-api.js');
const subHtml   = R('frontend/submission.html');
const plHtml    = R('frontend/pullletter.html');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

// ══════════════════════════════════════════════════════════════════
console.log('\n=== A-1  사용자 URL 스킴 차단 (관리자 저장형 XSS) ===');

t('서버: isHttpUrl 헬퍼 존재 (new URL + protocol 검사)',
  /function isHttpUrl[\s\S]{0,300}new URL[\s\S]{0,120}protocol === 'https?:'/.test(plApi));
t('서버: 포토그래퍼·스타일리스트 portfolio 검증',
  /_portfolioChecks[\s\S]{0,200}'photographer'[\s\S]{0,120}'stylist'/.test(plApi));
t('서버: 비디오그래퍼 portfolio 도 있으면 검증',
  /vdRaw\.portfolio[\s\S]{0,120}'videographer'/.test(plApi));
t('서버: 스킴 위반 시 400 + invalid_portfolio_url',
  /status\(400\)[\s\S]{0,220}code:\s*'invalid_portfolio_url'/.test(plApi));
t('서버: 무드보드 URL 도 자기 폴더 공개 URL 만 허용(경로 위조 방지)',
  /_moodPrefix[\s\S]{0,200}mUrls\.filter/.test(plApi),
  '클라이언트가 보낸 moodboardUrls 를 그대로 저장하면 javascript: 값이 관리자 화면에 렌더된다');

t('관리자 렌더: safeUrl 헬퍼 존재 (http/https 아니면 빈 문자열)',
  /function safeUrl\(u\)[\s\S]{0,300}\/\^https\?:\\\/\\\/\/i/.test(admin));
t('관리자 렌더: portfolio 가 safeUrl 을 통과한 값만 href 로',
  /var _pf=safeUrl\(t\.portfolio\)[\s\S]{0,300}_pf\s*\n?\s*\?\s*'<a href="'\+_pf/.test(admin));
t('관리자 렌더: portfolio 는 esc() 직접 href 사용 안 함',
  !/href="'\+esc\(t\.portfolio\)/.test(admin));
t('관리자 렌더: videoUrl 도 safeUrl 경유',
  /var safe=safeUrl\(desc\.videoUrl\)/.test(admin));
t('관리자 렌더: 무드보드 URL 도 safeUrl 경유(과거 미검증 행 방어)',
  /var _u=safeUrl\(u\)[\s\S]{0,400}href="'\+_u/.test(admin));

// ══════════════════════════════════════════════════════════════════
console.log('\n=== A-3  서버 내부 에러 원문 비노출 ===');

t('submissions/[id]: detail: err.message 계열 전부 제거',
  !/detail:\s*\w*[eE]rr(or)?\.message/.test(subId),
  'DB 원문/컬럼명이 사용자 응답에 실려 나간다');
t('submissions/[id]: GET catch 가 message/code 를 응답에 이어붙이지 않음',
  !/Failed to fetch submission' \+/.test(subId));
t('submissions/[id]: GET catch 응답에 문의처 + code',
  /Failed to fetch submission[\s\S]{0,160}contact@pap-magazine\.com[\s\S]{0,120}code:\s*'fetch_failed'/.test(subId));
t('submissions/upload-url: catch 가 err.message 를 붙이지 않음',
  !/Failed to create upload URLs' \+/.test(subUpload));
t('submissions/upload-url: 상세는 console.error 로만',
  /console\.error\('\[upload-url\] error:'/.test(subUpload));

// ══════════════════════════════════════════════════════════════════
console.log('\n=== B-1  서브미션 소유자 삭제 시 스토리지 정리 ===');

t('_storagePathFromUrl 헬퍼 존재(퍼지 크론과 같은 규칙)',
  /function _storagePathFromUrl\(url\)[\s\S]{0,400}\/storage\/v1\/object\/public\//.test(subId));
t('DELETE 성공 후 storage.remove 호출',
  /req\.method === 'DELETE'[\s\S]{0,2600}\.storage[\s\S]{0,80}\.remove\(paths\)/.test(subId));
t('스토리지 실패는 비치명(warn 후 진행)',
  /storage remove failed for'/.test(subId));
t('응답에 storageDeleted 카운트 포함',
  /ok: true, id, storageDeleted/.test(subId));

// ══════════════════════════════════════════════════════════════════
console.log('\n=== B-2  풀레터 신청자 철회 ===');

t('DELETE 전용 엔드포인트(그 외 405)',
  /req\.method !== 'DELETE'[\s\S]{0,120}status\(405\)/.test(plDelete));
t('소유자 아니면 403',
  /pl\.user_id !== user\.id[\s\S]{0,200}status\(403\)/.test(plDelete));
t("status==='pending' 이 아니면 409",
  /pl\.status !== 'pending'[\s\S]{0,200}status\(409\)/.test(plDelete));
t('발급(pull_letter_url) 있으면 409 already_issued',
  /pl\.pull_letter_url[\s\S]{0,220}code:\s*'already_issued'/.test(plDelete));
t('삭제 쿼리에 user_id 조건 동반(2중 방어)',
  /\.delete\(\)[\s\S]{0,80}\.eq\('id', id\)[\s\S]{0,80}\.eq\('user_id', user\.id\)/.test(plDelete));
t('무드보드(공개 버킷) + 시안 PDF(비공개 버킷) 모두 정리',
  /MOODBOARD_BUCKET[\s\S]{0,900}PROPOSAL_BUCKET\)\.remove/.test(plDelete));
t('원시 DB 메시지 비노출(A-3 규칙 준수)',
  !/message:\s*delErr\.message/.test(plDelete));

t('프론트 API: PAP.pullLetters.cancel 존재',
  /async cancel\(id\)[\s\S]{0,160}'DELETE', '\/pullletters\/'/.test(papApi));
t('마이페이지: pending + 발급전 에만 철회 버튼 노출',
  /r\.status === 'pending' && !r\.pullLetterSignedUrl/.test(R('frontend/mypage.html')));
t('마이페이지: mpCancelPullletter 가 confirm 후 DELETE 호출',
  /function mpCancelPullletter[\s\S]{0,900}confirm\(msg\)[\s\S]{0,400}method: 'DELETE'/.test(R('frontend/mypage.html')));

// ══════════════════════════════════════════════════════════════════
console.log('\n=== C-1  오류 문구 다국어화 · 서버 원문 비노출 ===');

const LANGS = ['ko','en','de','it','fr','es','ja','zh','ru'];
const ERR_KEYS = ['generic','network','session','tooLarge','loadSubmission','loadRevise','retry','lookCredit'];

t('submission.html: _ERR_I18N 사전 존재', /var _ERR_I18N = \{/.test(subHtml));
ERR_KEYS.forEach(function(k){
  const block = (subHtml.match(new RegExp(k + ':\\{ko:[\\s\\S]*?\\}(?=,\\n|\\n\\};)')) || [''])[0];
  const missing = LANGS.filter(function(l){ return !new RegExp('[{,]' + l + ":'").test(block); });
  t('  ' + k + ' 9개 언어', missing.length === 0, '누락: ' + missing.join(','));
});
t('_localizeApiError 존재 (code 우선 → 패턴 → 일반 폴백)',
  /function _localizeApiError\(e, fallbackKey\)[\s\S]{0,900}LOOK_CREDIT_REQUIRED/.test(subHtml));
t('영문 하드코딩 "Failed to load submission: " 제거',
  !/'Failed to load submission: '/.test(subHtml));
t('영문 하드코딩 "Failed to load your previous submission" 제거',
  !/Failed to load your previous submission/.test(subHtml));
t('수정 모드 배너에 재시도 버튼(B-5)',
  /_errT\('retry'\)[\s\S]{0,400}loadReviseSubmission\(\)/.test(subHtml));
t('submitForm catch 가 서버 원문(e.message)을 화면에 쓰지 않음',
  !/var m=em\|\|_t\('overlayErrorMsg'\)/.test(subHtml) && /var m=_localizeApiError\(e,'generic'\)/.test(subHtml));
t('submitForm catch 가 에러 클래스명(en+": ")을 덧붙이지 않음',
  !/m=en\+': '\+m/.test(subHtml));

t('pap-api: 실패 응답의 code/status/payload 를 Error 에 실어 보냄',
  /err\.code = json\.code[\s\S]{0,160}err\.payload = json/.test(papApi));
t('pap-api: message 자체는 그대로 유지(기존 분기 호환)',
  /new Error\(json\.message \|\| 'Request failed'\)/.test(papApi));

t('pullletter.html: badPortfolioUrl 9개 언어',
  LANGS.every(function(l){
    const block = (plHtml.match(/badPortfolioUrl:\{[\s\S]*?\},\n/) || [''])[0];
    return new RegExp('[{,]' + l + ":'").test(block);
  }));
t('pullletter.html: invalid_portfolio_url 를 badPortfolioUrl 로 매핑',
  /invalid_portfolio_url[\s\S]{0,160}badPortfolioUrl/.test(plHtml));

// ══════════════════════════════════════════════════════════════════
console.log('\n=== 한국어 모드 불변 (작업 원칙 1) ===');
t('한국어 오류 문구가 기존 톤 유지(문의처 포함)',
  /generic:\{ko:'[^']*contact@pap-magazine\.com/.test(subHtml));
t('관리자 UI 라벨은 한국어 고정(C-2 정책) — 촬영시안 PDF 라벨 유지',
  /촬영시안 PDF/.test(admin));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ submission-pullletter-audit tests FAILED'); process.exit(1); }
console.log('✅ submission-pullletter-audit tests passed');
