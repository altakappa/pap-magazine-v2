/**
 * 언어 정합 회귀 테스트 (2026-07-26)
 * ─────────────────────────────────────────────────────────────────────
 * 도메니코 지시: "영어로 설정하면 모든게 다 영어로, 한국어로 설정하면
 * 모두 한국어로 일치되어야 한다."
 *
 * [고친 결함 3종 — 되돌아가면 이 테스트가 잡는다]
 *  ① 폴백이 한국어였다 (`L[l]||L.ko`). 사전에 없는 언어를 고르면 페이지
 *     전체가 한국어로 떴다. pullletter.html 의 es 가 정확히 이 상태였다.
 *  ② 사전에 값이 없는 키는 마크업 리터럴이 그대로 남았고, 그중 일부
 *     리터럴이 한국어였다(labelProposal / proposalUploadHint /
 *     teamCreditsRequiredHint) → 영어 모드에도 한글이 섞였다.
 *  ③ pap-i18n.js(defer) 가 전역 setLang 을 덮어써서, 언어 선택기로 바꿀 때
 *     페이지 전용 사전(L)과 _curLang 이 갱신되지 않았다. 최초 로드만
 *     정상이라 "새로고침하면 맞는데 선택기로 바꾸면 안 바뀌는" 증상이었다.
 *
 * 검증 방식: 실제 setLang 의 해석 순서(d[k] → L.en[k] → 마크업 리터럴)를
 * 그대로 재현해 '최종 화면에 표시될 값'을 계산하고, 한국어 이외의 언어에
 * 한글이 남는지 본다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const ALL = ['ko','en','de','it','fr','es','ja','zh','ru'];
const HANGUL = /[가-힣]/;

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

function buildDict(html, extNames){
  const L = new Function(html.match(/\nvar L ?= ?\{[\s\S]*?\n\};/)[0].replace(/^\nvar L ?= ?/,'return ')+'')();
  for(const name of extNames){
    const m = html.match(new RegExp('var '+name+' ?= ?\\{[\\s\\S]*?\\n\\};'));
    if(!m) continue;
    const ext = new Function(m[0].replace(/^var \w+ ?= ?/,'return ')+'')();
    // teamCreditsRequiredHint 전용 사전은 {lang: '문자열'} 형태
    const flat = typeof ext[Object.keys(ext)[0]] === 'string';
    Object.keys(ext).forEach(function(l){
      if(!L[l]) L[l] = {};
      if(flat){ if(L[l].teamCreditsRequiredHint === undefined) L[l].teamCreditsRequiredHint = ext[l]; return; }
      Object.keys(ext[l]).forEach(function(k){ if(L[l][k] === undefined) L[l][k] = ext[l][k]; });
    });
  }
  return L;
}
function markupLiterals(html){
  const lit = {};
  for(const m of html.matchAll(/<(\w+)[^>]*\bdata-i18n(?:-html)?="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)){
    const txt = m[3].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
    if(txt && !lit[m[2]]) lit[m[2]] = txt;
  }
  return lit;
}
function usedKeys(html){
  const s = new Set();
  for(const m of html.matchAll(/data-i18n(?:-html|-ph)?="([^"]+)"/g)) s.add(m[1]);
  // searchPh 는 공용 헤더 사전(pap-i18n.js)이 담당한다 — 페이지 사전 대상 아님
  s.delete('searchPh');
  return s;
}

const PAGES = [
  { file:'frontend/submission.html', exts:['_PAP_SUBMISSION_I18N_EXT','_PAP_TEAM_HINT_I18N'] },
  { file:'frontend/pullletter.html', exts:['_PAP_PULLLETTER_I18N_EXT'] },
];

for(const p of PAGES){
  const html = R(p.file);
  console.log('\n=== ' + p.file + ' ===');

  // ── ① 폴백이 영어여야 한다 ──
  const fallbacks = [...html.matchAll(/L\[\w+\] ?\|\| ?L\.(\w+)/g)].map(m => m[1]);
  t('언어 폴백이 전부 en (ko 폴백 금지)',
    fallbacks.length > 0 && fallbacks.every(f => f === 'en'),
    '발견된 폴백: ' + fallbacks.join(',') + ' — L.ko 폴백이 있으면 없는 언어가 한국어로 뜬다');

  // ── ③ 전역 setLang 충돌 해소 ──
  t('덮어쓰기 전 페이지 setLang 참조를 잡아둔다 (_papPageSetLang)',
    /var _papPageSetLang = setLang;/.test(html));
  t('DOMContentLoaded 에서 전역 setLang 을 체이닝',
    /_papPageChained[\s\S]{0,400}window\.setLang = chained/.test(html),
    'pap-i18n.js(defer) 가 전역 setLang 을 덮어쓰므로 체이닝이 없으면 선택기 전환이 페이지 사전을 건너뛴다');

  // ── ②+실렌더: 어떤 언어를 골라도 한글이 남지 않아야 한다 ──
  const L = buildDict(html, p.exts);
  const lit = markupLiterals(html);
  const used = usedKeys(html);
  t('9개 언어 사전이 모두 존재', ALL.every(l => !!L[l]),
    '없는 언어: ' + ALL.filter(l => !L[l]).join(','));
  ALL.forEach(function(l){
    if(!L[l]) { fail++; console.log('  ✗ ' + l + ' 사전 없음'); return; }
    const leaks = [...used].filter(function(k){
      const shown = L[l][k] || L.en[k] || lit[k] || '';
      return l !== 'ko' && HANGUL.test(shown);
    });
    const undef = [...used].filter(function(k){
      return /undefined/.test(String(L[l][k] || L.en[k] || lit[k] || ''));
    });
    t('  ' + l + ' — 최종 표시값에 한글/undefined 없음',
      leaks.length === 0 && undef.length === 0,
      (leaks.length ? '한글: ' + leaks.join(',') : '') + (undef.length ? ' undefined: ' + undef.join(',') : ''));
  });

  // 한국어 모드는 반드시 한국어여야 한다 (작업 원칙 1 — 출력 불변)
  const koKeys = [...used].filter(k => L.ko[k] !== undefined);
  t('  ko — 사전 커버리지 유지 (' + koKeys.length + '/' + used.size + ')',
    koKeys.length >= used.size - 1);
}

// ── 마크업 리터럴에 한글이 남아 있으면 안 되는 지점 ──
console.log('\n=== 마크업 한글 리터럴 (사전 우회 경로) ===');
const pl = R('frontend/pullletter.html');
t('labelProposal 리터럴이 영어', /data-i18n="labelProposal">Shoot Proposal PDF Upload</.test(pl));
t('proposalUploadHint 리터럴이 영어', /data-i18n="proposalUploadHint">to attach your shoot proposal PDF</.test(pl));
const sub = R('frontend/submission.html');
t('teamCreditsRequiredHint 가 data-i18n-html 로 전환 + 9개 언어 사전 보유',
  /data-i18n-html="teamCreditsRequiredHint"/.test(sub)
  && ALL.every(l => new RegExp('\\b' + l + ":'⚠").test(sub.match(/var _PAP_TEAM_HINT_I18N = \{[\s\S]*?\n\};/)[0])));
t('submission.html: 영/한 병기 하드코딩 토스트 제거',
  !/Photographer credit cannot be removed · 포토그래퍼/.test(sub));
t('submission.html: 무드보드 안내 한국어 하드코딩 제거 (+제목 이스케이프)',
  !/무드보드를 기반으로 제안 중입니다/.test(sub.replace(/moodboardPrefill:\{[\s\S]*?\},/,''))
  && /PAP\.sanitize\(b\.title\|\|''\)/.test(sub));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ lang-consistency tests FAILED'); process.exit(1); }
console.log('✅ lang-consistency tests passed');
