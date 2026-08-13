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

// ══════════════════════════════════════════════════════════════════
console.log('\n=== A-5  업로드 매직바이트 검증 ===');

const sig = require('../api/_lib/fileSignature');
const B = a => Buffer.from(a);
const JPEG = B([0xFF,0xD8,0xFF,0xE0,0,16,0x4A,0x46,0x49,0x46]);
const PNG  = B([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0,0,0,13]);
const PDF  = Buffer.from('%PDF-1.7\n%abc','latin1');
const ZIP  = B([0x50,0x4B,0x03,0x04,20,0,6,0]);
const HTML = Buffer.from('<!DOCTYPE html><html><script>alert(1)</script>','utf8');
const SVG  = Buffer.from('<svg xmlns="x" onload="alert(1)">','utf8');

t('sniffMime 이 주요 형식을 인식',
  sig.sniffMime(JPEG) === 'image/jpeg' && sig.sniffMime(PNG) === 'image/png'
  && sig.sniffMime(PDF) === 'application/pdf' && sig.sniffMime(ZIP) === 'application/zip');
t('정상 파일은 통과 (jpeg/jpeg)', sig.verifySignature(JPEG, 'image/jpeg').ok);
t('비표준 별칭 image/jpg 도 통과', sig.verifySignature(JPEG, 'image/jpg').ok);
t('pptx(zip 컨테이너)도 통과',
  sig.verifySignature(ZIP, 'application/vnd.openxmlformats-officedocument.presentationml.presentation').ok);
t('모르는 형식은 막지 않는다 (하드닝 원칙)',
  sig.verifySignature(B([0x00,0x11,0x22,0x33,0x44,0x55]), 'image/png').ok,
  '시그니처를 모르는 파일까지 막으면 정상 업로드가 깨진다');
t('HTML 을 image/jpeg 로 위장 → 차단', !sig.verifySignature(HTML, 'image/jpeg').ok);
t('SVG 를 image/png 로 위장 → 차단', !sig.verifySignature(SVG, 'image/png').ok);
t('PNG 을 application/pdf 로 위장 → 차단', !sig.verifySignature(PNG, 'application/pdf').ok);
t('PDF 를 image/jpeg 로 위장 → 차단', !sig.verifySignature(PDF, 'image/jpeg').ok);

const libUpload = R('api/_lib/upload.js');
t('공용 초크포인트(uploadFiles)에 검증이 걸려 있다',
  /verifyFileOnDisk\(fs, file\.filepath, file\.mimetype\)/.test(libUpload),
  '여기 한 번만 걸면 media/scrap/레거시 multipart 가 모두 덮인다');
t('불일치 시 업로드를 거부', /_sig\.ok[\s\S]{0,300}throw new Error/.test(libUpload));
t('관리자 발급 PDF 경로에도 적용',
  /verifySignature\([\s\S]{0,80}'application\/pdf'\)/.test(R('api/pullletters/upload.js')));
t('레거시 multipart 시안 PDF 에도 적용',
  /proposalBuffer[\s\S]{0,200}verifySignature/.test(plApi));

// ══════════════════════════════════════════════════════════════════
console.log('\n=== A-6  앱 화이트리스트 ↔ 버킷 MIME 정합 ===');

t('submissions: 서명 URL 과 함께 정규화된 contentType 을 돌려준다',
  /contentType: canonicalMime\(type\)/.test(subUpload),
  '버킷은 image/jpg 를 허용하지 않는다 — 그 값으로 PUT 하면 조용히 실패한다');
t('submissions: image/jpg → image/jpeg 정규화',
  /'image\/jpg': 'image\/jpeg'/.test(subUpload));
t('pullletters: contentType 을 돌려준다 (확장자 폴백 포함)',
  /contentType: resolveContentType\(f\.type, f\.name, isProposal\)/.test(R('api/pullletters/upload-url.js')));
t('클라이언트가 서버의 contentType 을 우선 사용 (3개 PUT 지점 전부)',
  (papApi.match(/'Content-Type': (?:slot|u)\.contentType \|\|/g) || []).length === 3,
  'file.type 을 그대로 쓰면 버킷 MIME 검사에서 거부된다');

// ══════════════════════════════════════════════════════════════════
console.log('\n=== B-6  관리자 렌더 전수 점검 (사용자 유래 값) ===');

// 속성 안 삽입(value/title/href/src/…)에 esc()/safeUrl() 없이 변수가 들어가면
// 따옴표 하나로 속성을 빠져나올 수 있다. 0건이어야 한다.
// 검사 대상은 'API 응답 객체의 속성'(obj.prop) — B-6 이 겨냥한 사용자 유래 값이다.
// 지역 변수(_pf/_u/safe 같은 이미 정제된 값), 루프 인덱스, 코드 고정 라벨은 제외.
// 화이트리스트 — 사용자 유래가 아님이 확인된 값만. 근거를 함께 남긴다.
const ATTR_ALLOW = new Set([
  // 관리자 본인이 방금 고른 로컬 파일의 FileReader 결과(data: URL).
  // safeUrl() 을 걸면 data: 스킴이라 미리보기가 깨진다 — 제3자 입력이 아니다.
  'e.target.result',
  // 코드에 고정된 정렬 옵션 배열(PAP_SORT_OPTIONS).
  'o.value', 'o.label',
]);
const attrHits = [];
admin.split('\n').forEach(function(ln, i){
  const re = /(value|title|alt|placeholder|href|src|data-[\w-]+)=\\?"'\s*\+\s*([^+]+?)\s*\+\s*'/g;
  let m;
  while((m = re.exec(ln))){
    const e = m[2].trim();
    if(!/^[a-zA-Z$][\w$]*\.[\w.$]+$/.test(e)) continue;   // obj.prop 형태만
    if(/^esc\(|^safeUrl\(/.test(e)) continue;
    if(ATTR_ALLOW.has(e)) continue;
    attrHits.push('L' + (i+1) + ' ' + m[1] + '="' + e + '"');
  }
});
t('HTML 속성 안에 이스케이프 없는 API 값 삽입 0건',
  attrHits.length === 0, attrHits.slice(0, 8).join(' | '));

// 본문(텍스트 노드) 삽입도 같은 기준으로 — 신규 필드 추가 시 회귀 방지.
// 화이트리스트: 서버가 만든 URL/숫자·코드 고정 라벨·관리자 로컬 FileReader 결과.
const BODY_ALLOW = new Set([
  'info.cls','info.label',            // 코드 고정 배지 맵
  'pl.file_urls.length','errs.length','counts.draft','counts.scheduled','r.status',
  'e.target.result','img.src',        // 관리자 본인이 고른 로컬 파일 / 서버 URL
  'o.value','o.label',                // 고정 옵션 목록
  's.color','s.bg','s.label',         // 코드 고정 상태 맵
  's.id','a.id','p.id','e.id',        // DB UUID (onclick 인자)
  // 2026-08-13 — '이달의 에디토리얼' 후보 건수. 사용자 유래 값이 아니라
  // JS 배열의 length(숫자)다. 문자열이 될 수 없으므로 주입 경로가 없다.
  'cands.length',
]);
const bodyHits = [];
admin.split('\n').forEach(function(ln, i){
  if(!/innerHTML|\+=\s*'<|return\s*'</.test(ln)) return;
  const re = /'\s*\+\s*([^+;]+?)\s*\+\s*'/g;
  let m;
  while((m = re.exec(ln))){
    const e = m[1].trim();
    if(!/^[a-zA-Z$][\w$]*\.[\w.$]+$/.test(e)) continue;
    if(/^esc\(|^safeUrl\(/.test(e)) continue;
    if(BODY_ALLOW.has(e)) continue;
    bodyHits.push('L' + (i+1) + ' ' + e);
  }
});
t('본문에 이스케이프 없는 API 값 삽입 0건 (화이트리스트 외)',
  bodyHits.length === 0,
  bodyHits.slice(0, 8).join(' | ') + ' — 안전이 확인된 값이면 BODY_ALLOW 에 근거와 함께 추가');

// ── 속성 이스케이프는 esc() 로 안 된다 (실측으로 확인한 결함) ──
// esc() 는 textContent→innerHTML 직렬화라 따옴표를 건드리지 않는다.
// value="'+esc('" onerror="alert(1)')+'" 는 브라우저 파서에서
// value="" + onerror="alert(1)" 두 속성으로 쪼개진다.
t('escAttr 헬퍼가 존재하고 따옴표를 이스케이프한다',
  /function escAttr\(s\)\{[\s\S]{0,300}replace\(\/"\/g,'&quot;'\)/.test(admin));
t('safeUrl 이 escAttr 를 쓴다 (반환값은 항상 속성 안)',
  /function safeUrl\(u\)\{[\s\S]*?return escAttr\(s\);/.test(admin),
  'esc() 를 쓰면 스킴 검사를 통과한 URL 뒤의 따옴표로 속성을 빠져나올 수 있다');
t('속성 컨텍스트에 esc() 를 쓴 곳이 남아 있지 않다',
  !/(?:value|title|alt|placeholder|href|src|data-[\w-]+)=\\?"'\+esc\(/.test(admin));
t('룩 이미지 크레딧이 value 속성에서 escAttr 로 이스케이프됨',
  /value="'\+escAttr\(img\.credits\|\|''\)\+'"/.test(admin),
  '회원/관리자가 쓴 값이 value="…" 로 그대로 들어가면 속성 탈출이 가능하다');

const mypage = R('frontend/mypage.html');
t('mypage 도 escAttr/safeUrl 을 갖추고 href·src 에 적용',
  /function escAttr\(s\)/.test(mypage) && /function safeUrl\(u\)/.test(mypage)
  && !/(?:href|src)=" \+ esc\(/.test(mypage));

// ── 저장소 전체 스윕 ──────────────────────────────────────────────
// 처음엔 pap-admin.js / mypage.html 만 고쳤는데, 같은 textContent→innerHTML
// 이스케이퍼가 프론트 전반에 복사돼 있었다(진단 페이지 5종 · search · ops
// 대시보드 · pap-api 의 PAP.sanitize · submission 의 _esc 등).
// 호출부를 하나씩 고치는 대신 **이스케이퍼 자체**를 따옴표까지 처리하도록
// 바꿨다 — 텍스트 노드에서는 &quot;/&#39; 가 따옴표로 렌더되어 표시가 같고,
// 속성 컨텍스트에서는 탈출이 막힌다. 새 파일이 옛 패턴을 다시 들여오면
// 아래 검사가 잡는다.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const ESCAPER_RE = /(?:function|var|const|let)\s+(_?esc|escAttr|sanitize)\s*(?:=\s*function)?\s*\([^)]*\)\s*\{([\s\S]{0,400}?)\n?\s*\}/g;
const weak = [];
let escaperCount = 0;
for(const f of fs.readdirSync(FRONTEND_DIR).filter(n => /\.(js|html)$/.test(n))){
  const s = fs.readFileSync(path.join(FRONTEND_DIR, f), 'utf8');
  ESCAPER_RE.lastIndex = 0;
  let m;
  while((m = ESCAPER_RE.exec(s))){
    const name = m[1], body = m[2];
    if(name === 'escAttr') continue;          // 정의상 속성 전용 — 별도 검사
    escaperCount++;
    const domSerialize = /textContent/.test(body) && /innerHTML/.test(body);
    const escapesQuote = /&quot;|&#34;/.test(body);
    if(domSerialize || !escapesQuote){
      weak.push(f + '::' + name + (domSerialize ? '(textContent→innerHTML)' : '(따옴표 미처리)'));
    }
  }
}
t('프론트 전체 이스케이퍼(' + escaperCount + '개)가 따옴표를 이스케이프한다',
  weak.length === 0,
  weak.join(' | ') + ' — textContent→innerHTML 방식은 따옴표를 남겨 속성 탈출을 허용한다');
t('숏츠 목록의 사용자 유래 값이 esc() 경유',
  /esc\(s\.title\)[\s\S]{0,200}esc\(s\.yt\)/.test(admin));
t('배너 이미지·링크가 safeUrl\\(\\)/esc\\(\\) 경유',
  /src="'\+safeUrl\(b\.img\)/.test(admin) && /esc\(b\.link\)/.test(admin));
t('카테고리 목록이 esc() 경유', /esc\(c\.nameKo\)[\s\S]{0,80}esc\(c\.slug\)/.test(admin));

// ══════════════════════════════════════════════════════════════════
console.log('\n=== B-4  레거시 multipart 사용량 계측 (제거 판단 근거) ===');
t('레거시 분기 진입 시 태그 로그를 남긴다',
  /\[pullletters\]\[LEGACY-MULTIPART\]/.test(plApi),
  '제거 전 "최근 사용 0건" 을 확인할 방법이 있어야 한다');
t('로그가 JSON 형태로 진단 정보를 담는다',
  /LEGACY-MULTIPART[\s\S]{0,200}userId[\s\S]{0,120}ua/.test(plApi));

// ══════════════════════════════════════════════════════════════════
console.log('\n=== C-2  언어 정책 명문화 ===');
const feRules = R('.claude/rules/frontend.md');
const apiRules = R('.claude/rules/api.md');
t('회원 대면 9개 언어 / 운영자 대면 한국어 고정이 문서화됨',
  /운영자 대면\(한국어 고정 허용\)/.test(feRules) && /회원 대면\(9개 언어 필수\)/.test(feRules));
t('전역 setLang 충돌 함정이 재발 방지용으로 문서화됨',
  /_papPageChained/.test(feRules) && /pap-i18n\.js`? 는 defer/.test(feRules));
t('관리자 렌더 안전 규칙(컨텍스트별 esc/escAttr/safeUrl)이 문서화됨',
  /escAttr\(\)/.test(feRules) && /safeUrl\(\)`? 을 쓰고/.test(feRules)
  && /따옴표를 이스케이프하지 않는다/.test(feRules),
  'esc/escAttr/safeUrl 을 언제 쓰는지가 문서에 남아 있어야 재발을 막는다');
t('API 에러 응답 규칙(원문 비노출 + code)이 문서화됨',
  /detail: err\.message/.test(apiRules) && /분류용 `code`/.test(apiRules));
t('버킷 설정 표가 문서화됨 (앱 화이트리스트 변경 시 동반 갱신)',
  /allowed_mime_types/.test(apiRules) && /pull-letters/.test(apiRules));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ submission-pullletter-audit tests FAILED'); process.exit(1); }
console.log('✅ submission-pullletter-audit tests passed');
