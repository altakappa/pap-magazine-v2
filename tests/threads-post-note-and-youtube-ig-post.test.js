/**
 * 2026-10-15 "있는 파이프에 문을 달자" 후속 2건
 *  ① threads-post 크론 기록: 간격 대기로 건너뛴 실행을 "posted" 라고 적지 않는다.
 *     실측: 10분마다 "posted 삼성과 이탈리아…" 7회, 실제 게시 0건.
 *  ② youtube-post 설명란: 프로필(/ig/youtube) 대신 그 영상의 인스타 원본(ig-out to=post).
 *     실측 30일: 업로드 156편, 인스타 클릭 13명.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

console.log('[1] threads-post 기록');
const tp = rd('api/cron/threads-post.js');
t("skipped 면 cronNote '건너뜀: <사유>' 와 skipped 응답", /if \(r\.status === 'skipped'\) \{[\s\S]{0,200}cronNote = '건너뜀: '[\s\S]{0,200}skipped: art\.title/.test(tp));
t("게시 성공이면 cronNote 에 링크 답글 ok/없음 을 적는다", /cronNote = '게시: '[^\n]*링크 답글 ok[^\n]*링크 답글 없음/.test(tp));
t('res.locals 를 핸들러 첫 줄에서 보장', /async function handler\(req, res\) \{\n  res\.locals = res\.locals \|\| \{\};/.test(tp));
t('응답에 link_reply_id 가 실린다', /link_reply_id: r\.link_reply_id \|\| null/.test(tp));

console.log('[2] youtube-post 설명란');
const yp = rd('api/cron/youtube-post.js');
t('ART_COLS 에 source_instagram_url (안 읽으면 원본을 모른다)', /ART_COLS = '[^']*source_instagram_url/.test(yp));
t('원본이 있으면 ig-out(src=youtube, to=post) 로 그 게시물', /igFirstLink\.igOutUrl\(art\.source_instagram_url, 'youtube'\)/.test(yp) && /▶ 인스타그램 원본 : /.test(yp));
t('원본이 없으면 종전 프로필(/ig/youtube) 유지', /else \{\s*lines\.push\('▶ 인스타그램 : ' \+ SITE \+ '\/ig\/youtube'\);/.test(yp));
t('직링크(instagram.com) 는 여전히 안 쓴다 (계측 경유)', !/https:\/\/www\.instagram\.com/.test(yp));
const { igOutUrl } = require('../api/_lib/igFirstLink');
const u = igOutUrl('https://www.instagram.com/reel/ABC/?igsh=zzz', 'youtube');
t('igOutUrl(youtube): src=youtube · to=post · 추적 쿼리 제거', /src=youtube&to=post&url=https%3A%2F%2Fwww\.instagram\.com%2Freel%2FABC%2F$/.test(u), u);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
