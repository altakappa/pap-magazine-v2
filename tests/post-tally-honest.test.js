/**
 * sync-instagram note 가 '게시 안 한 것' 을 성공으로 세지 않는다 (2026-11-24 화요일 견고화).
 *
 * 실측 11/17~11/24: note 가 주장한 X 성공 30건 vs x_posts 실제 성공 0건.
 * '건너뜀(셀럽아님)'·'마감초과'·'스킵'·'이월' 이 '실패' 로 시작하지 않아 성공으로 세어졌다.
 * 함수(splitPosts·skipNote)를 실제로 돌리고, note 식을 같은 모양으로 재현해 본다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { postOutcome, splitPosts, skipNote } = require('../api/_lib/postTally');
const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'sync-instagram.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

/* note 의 X·스레드 조각을 sync-instagram 과 같은 식으로 만든다 */
function noteFor(label, arr) {
  const s = splitPosts(arr);
  return (s.counted.length ? ' · ' + label + ' ' + (s.counted.length - s.notOk.length) + '/' + s.counted.length + '건'
      + (s.notOk.length ? ' [' + s.notOk.join('; ').slice(0, 160) + ']' : '') : '')
    + skipNote(label, s.skipped);
}

// ── 분류
t('게시 id 는 성공', postOutcome('1993012345678901234') === 'ok');
t('id + 표시(미디어없음)도 성공', postOutcome('1993(미디어없음→링크본문)') === 'ok');
t('실패: 는 실패', postOutcome('실패:402 {"detail":"credits depleted"}') === 'fail');
t('실패(예외): 도 실패', postOutcome('실패(예외):boom') === 'fail');
t('건너뜀(셀럽아님) 은 건너뜀', postOutcome('건너뜀(셀럽아님:editorial)') === 'skip');
t('건너뜀(같은주제) 은 건너뜀', postOutcome('건너뜀(같은주제:x)') === 'skip');
t('스레드 스킵: 은 건너뜀', postOutcome('스킵:중복') === 'skip');
t('마감초과 는 미확인(성공 아님)', postOutcome('마감초과(함수상한 앞에서 손 뗌)') === 'carry');
t('이월:스위퍼 는 미확인(성공 아님)', postOutcome('이월:스위퍼(남은 20초 < 60초)') === 'carry');

// ── 사고 재현: fashion 계정 11/23 note 'X 1/1건' (x_posts 에 fashion 행 0)
t('셀럽아님 건너뜀 1건은 "X 1/1" 이 아니다',
  noteFor('X', ['건너뜀(셀럽아님:fashion)']) === ' · X 건너뜀 1 [건너뜀(셀럽아님:fashion)]',
  noteFor('X', ['건너뜀(셀럽아님:fashion)']));
t('마감초과 1건은 X 0/1 + 사유',
  noteFor('X', ['마감초과(함수상한 앞에서 손 뗌)']) === ' · X 0/1건 [마감초과(함수상한 앞에서 손 뗌)]');
t('성공 1 + 건너뜀 1 → X 1/1 + 건너뜀 1',
  noteFor('X', ['1993', '건너뜀(같은주제:a)']) === ' · X 1/1건 · X 건너뜀 1 [건너뜀(같은주제:a)]');
t('스레드 이월은 성공으로 안 센다',
  noteFor('스레드', ['이월:스위퍼(남은 5초 < 60초)']).startsWith(' · 스레드 0/1건'));
t('스레드 스킵은 분모에서 빠진다',
  noteFor('스레드', ['th_1', '스킵:dup']) === ' · 스레드 1/1건 · 스레드 건너뜀 1 [스킵:dup]');

// ── 종전 동작 보존
t('성공만이면 종전과 같다 (X 2/2건)', noteFor('X', ['1', '2']) === ' · X 2/2건');
t('실패 사유는 그대로 [..] 에', noteFor('X', ['실패:402 x']) === ' · X 0/1건 [실패:402 x]');
t('빈 배열·undefined → 빈 문자열', noteFor('X', []) === '' && noteFor('X', undefined) === '');
t('순서 보존', JSON.stringify(splitPosts(['a', '실패:b', '건너뜀(c)', 'd']).counted) === '["a","실패:b","d"]');

// ── 경계값
t('null/undefined 항목은 성공(게시 id 가 비어도 게시는 됐다 — 종전과 같음)', postOutcome(undefined) === 'ok' && postOutcome(null) === 'ok');
t('"실패" 가 중간에 있는 id 성 문자열은 성공', postOutcome('id실패') === 'ok');
t('건너뜀 사유가 길어도 80자에서 자른다', skipNote('X', ['건너뜀(' + 'ㄱ'.repeat(300) + ')']).length <= ' · X 건너뜀 1 []'.length + 80);
t('skipNote 빈 목록은 빈 문자열', skipNote('X', []) === '' && skipNote('X', null) === '');

// ── 배선 (note 빌더가 실제로 이 부품을 쓴다)
t('sync-instagram 이 splitPosts 로 X·스레드를 나눈다',
  /splitPosts\(results\.tweets\)/.test(src) && /splitPosts\(results\.threads\)/.test(src));
t('종전 "실패 시작만 실패" 필터가 남아 있지 않다',
  !/twArr\.filter\(t => String\(t\)\.startsWith\('실패'\)\)/.test(src) && !/thArr\.filter\(t => String\(t\)\.startsWith\('실패'\)\)/.test(src));
t('건너뜀 조각이 note 에 붙는다', /skipNote\('X', twS\.skipped\)/.test(src) && /skipNote\('스레드', thS\.skipped\)/.test(src));
t('require 경로는 ../_lib (api/cron 하위)', /require\('\.\.\/_lib\/postTally'\)/.test(src));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ post-tally-honest tests FAILED'); process.exit(1); }
