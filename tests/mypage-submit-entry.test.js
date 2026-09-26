'use strict';
/**
 * 마이페이지 제출 입구 (2026-09-26, 도메니코 "그럼 헷갈리지 않게 웹사이트를 고쳐줘").
 * 계기: 크리에이터가 마이페이지 SUBMISSIONS 에서 "파일이나 링크를 올리는 곳이 없다"고 메일.
 * 그 목록은 이미 보낸 작품의 진행 상황만 보여주고, 실제 제출 폼은 /submission.html 이다.
 *  1. 사이드바(폰에서는 가로 탭 줄) 맨 앞에 제출 버튼
 *  2. 서브미션 섹션: "이 목록은 보낸 작품만" 안내 + 제출 버튼 (항상 보임)
 *  3. 게재 작품이 없을 때 빈 칸에도 제출 버튼
 *  4. 한국어 탭 이름 '업로드' → '내 서브미션' (제출 페이지와 같은 말), 메일 탭 이름도 같이
 *  5. 새 문구는 9개 언어, 외국어 칸에 한국어 없음
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];
const HANGUL = /[가-힣]/;

const mp = R('frontend/mypage.html');
const m = mp.match(/var LANG = (\{[\s\S]*?\n\});/);
let LANG = null;
try { LANG = vm.runInNewContext('(' + m[1] + ')'); } catch (e) { LANG = null; }
t('LANG 사전이 문법 오류 없이 읽힘', !!LANG && LANGS.every((l) => LANG[l]));

const KEYS = ['navSubmit', 'submitCta', 'submitHint', 'emptyPublished', 'sectionUploads', 'sectionContributions', 'navSubmissions'];
KEYS.forEach((k) => {
  t(k + ': 9개 언어 모두 있음', LANG && LANGS.every((l) => typeof LANG[l][k] === 'string' && LANG[l][k].trim()), LANG && LANGS.filter((l) => !LANG[l][k]).join(','));
  t(k + ': 외국어 칸에 한국어 없음', LANG && LANGS.filter((l) => l !== 'ko').every((l) => !HANGUL.test(LANG[l][k] || '')));
});
t('한국어 탭 이름이 더 이상 "업로드"가 아님 → 내 서브미션', LANG && LANG.ko.navSubmissions === '내 서브미션' && LANG.ko.sectionUploads === '내 서브미션');
t('러시아어 탭이 "게재(ПУБЛИКАЦИИ)"로 오해되지 않음', LANG && LANG.ru.navSubmissions !== 'ПУБЛИКАЦИИ');

// 1. 사이드바 맨 앞 제출 버튼
const nav = mp.slice(mp.indexOf('<nav class="mp-side-nav">'), mp.indexOf('</nav>', mp.indexOf('<nav class="mp-side-nav">')));
const iCta = nav.indexOf('href="/submission.html" class="mp-side-link mp-side-cta" data-i18n="navSubmit"');
t('사이드바에 제출 버튼 (/submission.html)', iCta > 0);
t('제출 버튼이 탭 줄 맨 앞 (폰 가로 탭에서 스크롤 없이 보임)', iCta > 0 && iCta < nav.indexOf('href="#mp-profile"'));
t('섹션 이동 스크립트는 # 링크만 잡음 → 제출 버튼은 페이지 이동', /querySelectorAll\('\.mp-side-link\[href\^="#"\]'\)/.test(mp));
t('모바일에서 제출 버튼이 숨겨지지 않음', !/\.mp-side-cta\{[^}]*display:none/.test(mp));

// 2. 서브미션 섹션 안내 + 버튼
const sec = mp.slice(mp.indexOf('<section class="mp-section" id="mp-submissions">'), mp.indexOf('</section>', mp.indexOf('id="mp-submissions"')));
t('서브미션 섹션: 안내 문구', /data-i18n="submitHint"/.test(sec));
t('서브미션 섹션: 제출 버튼 → /submission.html', /href="\/submission\.html" class="mp-submit-cta" data-i18n="submitCta"/.test(sec));
t('안내·버튼이 목록보다 위 (빈 목록이어도 바로 보임)', sec.indexOf('submitCta') < sec.indexOf('id="mpRecentSubs"'));

// 3. 게재 작품 빈 칸
const le = mp.slice(mp.indexOf('function loadMyEditorials'), mp.indexOf('function loadMyEditorials') + 1600);
t('게재 작품 빈 칸: 문구가 사전(_t)에서 옴', /_t\.emptyPublished/.test(le));
t('게재 작품 빈 칸: 제출 버튼', /href="\/submission\.html" class="mp-submit-cta"/.test(le) && /_t\.submitCta/.test(le));
t('내부 링크에 utm 없음 (유입 통계 오염 방지)', !/submission\.html\?utm/.test(mp));

// 4. 외국어 번역 사전 (한국어 원문 키) + 캐시 버전
const v = Number((mp.match(/content="mypage" data-v="(\d+)"/) || [])[1]);
t('mypage 번역 사전 버전 올림 (≥14)', v >= 14);
LANGS.filter((l) => l !== 'ko').forEach((l) => {
  const d = JSON.parse(R('frontend/i18n/ui/mypage.' + l + '.json'));
  t('mypage.' + l + '.json: 새 한국어 문구 번역', d['내 서브미션'] === LANG[l].sectionUploads && d['새 에디토리얼 제출하기 →'] === LANG[l].submitCta && d['+ 화보 제출'] === LANG[l].navSubmit && d[LANG.ko.submitHint] === LANG[l].submitHint);
});

// 5. 메일의 탭 이름 = 마이페이지 탭 이름
const { MAIL_CHROME } = require(path.join(ROOT, 'api', '_lib', 'weeklyNewsCopy'));
t('메일 탭 이름(subsTab) = 마이페이지 navSubmissions (9개 언어)', LANGS.every((l) => MAIL_CHROME[l].subsTab === LANG[l].navSubmissions), LANGS.filter((l) => MAIL_CHROME[l].subsTab !== LANG[l].navSubmissions).join(','));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
