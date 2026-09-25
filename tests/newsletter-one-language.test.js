'use strict';
/**
 * 주간 뉴스레터는 한 언어로만 (2026-09-25, 도메니코 "언어는 하나로 통일되어야해").
 * 미리보기(한국어)에 영어가 섞여 있었다: ART · FASHION… / Weekly Briefing — September 21 /
 * THIS WEEK ON PAP / EDITORIAL / TREND BRIEFING / FOLLOW… / 에디토리얼 영어 원제 / 제목 "SEP 17".
 *
 *  1. 틀 문구 9개 언어가 빠짐없이 있다
 *  2. 날짜: 언어별 형식, 발송일(KST) 기준, 못 읽으면 원문
 *  3. 템플릿: 9개 언어로 그려서 영어 틀 문구가 하나도 없다 (en 제외) · 제목 날짜도 그 언어
 *  4. 제목 합치기: 원제·DB 번역을 지키고 빈칸·미번역만 채운다 · 번역 실패면 원제
 *  5. 생성 크론: 뉴스 번역과 같은 시간에 제목 번역 · 실패해도 발송은 계속
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];
const { WEEKLY_COPY, weeklyCopy, localDate } = require(path.join(ROOT, 'api/_lib/weeklyNewsCopy.js'));

console.log('=== 1. 틀 문구 ===');
const KEYS = ['tag', 'subjectPrefix', 'tagline', 'issueLabel', 'thisWeek', 'trend', 'editorial', 'article', 'follow', 'viewSite'];
t('9개 언어 × 10개 문구 전부 있음', LANGS.every((l) => WEEKLY_COPY[l] && KEYS.every((k) => typeof WEEKLY_COPY[l][k] === 'string' && WEEKLY_COPY[l][k].trim())));
t('모르는 언어 → 영어', weeklyCopy('xx') === WEEKLY_COPY.en);
t('사이트 표기와 같게: 한국어 "에디토리얼"', WEEKLY_COPY.ko.editorial === '에디토리얼');
const EN_UI = ['ART · FASHION', 'Weekly Briefing', 'THIS WEEK ON PAP', 'TREND BRIEFING', 'EDITORIAL', 'FOLLOW @', 'VIEW PAP'];
// 그 언어에서도 같은 철자인 낱말 (영어가 섞인 게 아니다): es·de 'EDITORIAL', it 'EDITORIALE', de 'September'
const SAME_WORD = { es: ['EDITORIAL'], de: ['EDITORIAL', 'September'], it: ['EDITORIAL'] };
const isShared = (l, w) => (SAME_WORD[l] || []).includes(w);
t('en 이 아닌 언어의 틀 문구에 영어 문구가 없다',
  LANGS.filter((l) => l !== 'en').every((l) => KEYS.filter((k) => k !== 'tag').every((k) => !EN_UI.some((e) => WEEKLY_COPY[l][k].includes(e) && !isShared(l, e)))));

console.log('\n=== 2. 날짜 ===');
t('ko 2026년 9월 28일', localDate('September 28, 2026', 'ko') === '2026년 9월 28일');
t('ja 2026年9月28日 · de 28. September 2026', localDate('2026-09-28', 'ja') === '2026年9月28日' && localDate('2026-09-28', 'de') === '28. September 2026');
t('월·일만 (제목용) ko 9월 28일', localDate(new Date(Date.UTC(2026, 8, 28)), 'ko', { month: 'long', day: 'numeric' }) === '9월 28일');
t('못 읽으면 원문', localDate('garbage', 'ko') === 'garbage' && localDate('', 'ko') === '');

console.log('\n=== 3. 템플릿 ===');
{
  const { templates } = require(path.join(ROOT, 'api/_lib/email.js'));
  const news = (l) => Array.from({ length: 10 }, (_, i) => ({ title: l + ' 뉴스 ' + i, summary: l + ' 요약 ' + i, category: 'ART', url: 'https://x/' + i, image: '' }));
  const i18n = {}; LANGS.forEach((l) => { i18n[l] = { subject: 'PAP 이주의 뉴스 — SEP 17', preheader: l + ' pre', newsItems: news(l) }; });
  const titles = {}; LANGS.forEach((l) => { titles[l] = '[' + l + '] 제목'; }); titles._ = 'Milan, After Dark';
  const campaign = {
    name: 'news-weekly-2026-09-27', type: 'news-weekly', subject: 'PAP 이주의 뉴스 — SEP 17',
    scheduled_at: '2026-09-27T23:00:00.000Z',   // = 9/28 월 08:00 KST
    payload: { issueLabel: 'Weekly Briefing', headerDate: 'September 27, 2026', i18n,
      papItems: [
        { kind: 'editorial', url: 'https://www.pap-magazine.com/editorial/a', image: 'https://x/a.jpg', titles },
        { kind: 'article', url: 'https://www.pap-magazine.com/article/b', image: 'https://x/b.jpg', titles },
      ] },
  };
  const strip = (h) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·');
  const out = {};
  LANGS.forEach((l) => { out[l] = templates.weeklyNews(campaign, { id: 'u', email: 'a@b.c', language: l }, 'tok'); });
  t('제목 = 그 언어 머리말 + 발송일(9/28, KST) — Claude 가 쓴 "SEP 17" 은 안 씀',
    out.ko.subject === 'PAP 이주의 뉴스 — 9월 28일' && out.en.subject === 'PAP Weekly News — September 28' && out.de.subject === 'PAP News der Woche — 28. September'
    && LANGS.every((l) => !/SEP 17/.test(out[l].subject)), out.ko.subject);
  t('머리 날짜도 그 언어 (ko 2026년 9월 28일)', strip(out.ko.html).includes('주간 브리핑') && strip(out.ko.html).includes('2026년 9월 28일'));
  const bad = [];
  LANGS.filter((l) => l !== 'en').forEach((l) => {
    const txt = strip(out[l].html);
    EN_UI.forEach((e) => { if (txt.includes(e) && !isShared(l, e)) bad.push(l + ':' + e); });
    if (/Weekly Briefing/.test(txt) || (/September/.test(txt) && !isShared(l, 'September'))) bad.push(l + ':date/label');
  });
  t('en 말고 8개 언어 본문에 영어 틀 문구 0개', bad.length === 0, bad.join(', '));
  t('한국어: 틀 문구 전부 한국어', ['아트 · 패션 · 뷰티 · 컬처', '이번 주 PAP', '트렌드 브리핑', '에디토리얼', '기사', '@PAP_MAGAZINE 팔로우', 'PAP 매거진 보기'].every((w) => strip(out.ko.html).includes(w)));
  t('PAP 제목은 받는 사람 언어판', out.ko.html.includes('[ko] 제목') && out.ja.html.includes('[ja] 제목') && !out.ko.html.includes('Milan, After Dark'));
  t('영어 메일은 영어 그대로', strip(out.en.html).includes('THIS WEEK ON PAP') && strip(out.en.html).includes('September 28, 2026'));
  t('<title> 도 그 언어', /<title>PAP 이주의 뉴스<\/title>/.test(out.ko.html));
}

console.log('\n=== 4. 제목 합치기 ===');
{
  const stub = (rel, exp) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
  stub('api/_lib/supabase.js', { supabaseAdmin: {} });
  stub('api/_lib/cronGuard.js', { withCronGuard: (_n, fn) => fn });
  const cron = require(path.join(ROOT, 'api/cron/weekly-news.js'));
  const items = [
    { kind: 'editorial', titles: { _: 'Milan, After Dark' } },
    { kind: 'article', titles: { ko: '사진은 부재를 기억한다', en: 'Photographs Remember Absence', ja: 'Photographs Remember Absence', de: 'Fotos erinnern an Abwesenheit', _: 'Photographs Remember Absence' } },
    { kind: 'article', titles: { ko: '한국어 제목만', en: '한국어 제목만', _: '한국어 제목만' } },
  ];
  const mk = (arr) => arr;
  const tr = {
    ko: mk(['밀라노, 어둠이 내린 뒤', '덮으면 안 됨', '덮으면 안 됨']), en: mk(['Milan, After Dark', 'x', 'Korean Title Only']),
    ja: mk(['ミラノ、夜のあとで', '写真は不在を記憶する', '韓国語タイトル']), de: mk(['Mailand bei Nacht', 'nicht überschreiben', 'Nur koreanisch']),
    it: mk(['Milano, dopo il tramonto', 'i', 'i']), fr: mk(['Milan, la nuit', 'f', 'f']), es: mk(['Milán de noche', 'e', 'e']),
    zh: mk(['米兰，入夜之后', 'z', 'z']), ru: mk(['Милан после заката', 'r', 'r']),
  };
  const m = cron.mergePapTitles(items, tr);
  t('에디토리얼: 9개 언어가 전부 채워지고 영어는 원제', ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'].every((l) => m[0].titles[l]) && m[0].titles.en === 'Milan, After Dark' && m[0].titles.ko === '밀라노, 어둠이 내린 뒤');
  t('기사: 쓴 한국어·영어 원제는 덮지 않는다', m[1].titles.ko === '사진은 부재를 기억한다' && m[1].titles.en === 'Photographs Remember Absence');
  t('기사: 진짜 DB 번역(de)은 지키고, 번역 안 된 칸(ja=영어 그대로)은 채운다', m[1].titles.de === 'Fotos erinnern an Abwesenheit' && m[1].titles.ja === '写真は不在を記憶する');
  t('영어 칸에 한국어가 들어 있으면 번역으로 바꾼다', m[2].titles.en === 'Korean Title Only' && m[2].titles.ko === '한국어 제목만');
  const none = cron.mergePapTitles(items, null);
  t('번역 실패 → 원제 그대로 (지우지 않음)', none[0].titles.en === 'Milan, After Dark' && !none[0].titles.ko && none[1].titles.ko === '사진은 부재를 기억한다');
  const badKo = cron.mergePapTitles([{ kind: 'editorial', titles: { _: 'A' } }], { ko: ['A'] });
  t('한국어 칸에 한국어가 아닌 답은 안 받는다', !badKo[0].titles.ko);
  const short = cron.mergePapTitles(items, { ko: ['하나만'] });
  t('배열이 짧아도 안 터지고 있는 칸만 채운다', short[0].titles.ko === '하나만' && !short[2].titles.ja);
}

console.log('\n=== 5. 생성 크론 ===');
{
  const c = R('api/cron/weekly-news.js');
  const iPap = c.indexOf('const papRaw = await papPicks();');
  const iTr = c.indexOf('Promise.allSettled(LOCALES.map((loc) => claude(translateSystem(loc)');
  t('PAP 고르기 → 뉴스 번역과 제목 번역을 같이 (Promise.all)', iPap > 0 && iTr > iPap && /const \[translations, papTr\] = await Promise\.all\(/.test(c));
  t('제목 번역 실패는 로그만, 발송은 계속', /PAP_TITLE_SYSTEM[\s\S]{0,200}\.catch\(\(e\) => \{ console\.warn\([^)]*원제로 보낸다/.test(c));
  t('payload 에 합친 제목이 들어간다', /const papItems = mergePapTitles\(papRaw, papTr\);/.test(c) && /papItems,\s+\/\/ 2026-09-25/.test(c));
  t('papPicks 는 한 번만 부른다', (c.match(/await papPicks\(\)/g) || []).length === 1);
  t('Claude 에게 제목에 영문 날짜를 넣으라고 하지 않는다', !/영문 월 일/.test(c));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
