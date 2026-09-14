/**
 * 제목·메타 설명을 검색어에 맞춘다 (2026-09-14).
 *
 * [왜] 28일 GSC 실측에서 순위로는 설명이 안 되는 구멍이 나왔다.
 *   튜이드               노출 5,057 · 클릭 1 · CTR 0.02% · 순위 6.4
 *   나띠                 노출 8,407 · 클릭 5 · CTR 0.06% · 순위 9.8
 *   jennie summer sonic  노출 4,780 · 클릭 9 · CTR 0.19% · 순위 6.6
 * 6.4위면 보통 CTR 이 3~5% 다. 우리는 0.02% 다. 보여도 안 눌린다.
 * 본문 보강은 순위를 올리는 일이고, 이건 CTR 이다. 훨씬 싸고 빠르다.
 *
 * [이 테스트가 지키는 것]
 *  1) **사이트에 보이는 제목(articles.title)을 건드리지 않는다.**
 *     seo_title · seo_description 만 바꾼다. 편집 판단 부담이 적고 되돌리기 쉽다.
 *  2) 반영은 사람이 누른다 (?apply=)
 *  3) 원본을 보관해 되돌릴 수 있다
 *  4) 겨냥할 검색어를 못 찾은 기사는 큐에 넣지 않는다 — 무엇을 겨냥할지 모르면 못 고친다
 *  5) 지어내기 금지가 프롬프트에 있다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const S = R('api/admin/article-title-backfill.js');
const M = R('supabase_migrations/159_article_title_backfill.sql');

console.log('\n=== 사이트 제목은 안 건드린다 (가장 중요) ===');
t('articles 에 쓰는 것은 seo_title · seo_description 뿐',
  /update\(\{ seo_title: row\.new_title, seo_description: row\.new_desc \}\)/.test(S));
t('articles.title 을 쓰지 않는다', !/update\(\{[^}]*\btitle:/.test(S));
t('왜 그런지 적혀 있다', /사이트에 보이는 제목\(articles\.title\)은 \*\*건드리지 않는다/.test(S));
t('렌더러 근거가 적혀 있다', /seoRenderer\.js:880/.test(S));

console.log('\n=== 되돌릴 수 있다 ===');
t('원본 제목을 보관한다', /old_title: art\.seo_title \|\| art\.title/.test(S));
t('원본 설명을 보관한다', /old_desc: art\.seo_description/.test(S));
t('되돌리기가 있다', /q\.revert === '1'/.test(S) && /seo_title: row\.old_title/.test(S));
t('되돌린 것은 reverted 로 남는다', /status: 'reverted'/.test(S));

console.log('\n=== 반영은 사람이 ===');
t('관리자만', /const user = await requireAdmin\(req, res\);/.test(S));
t('생성은 status=draft 까지만', /status: 'draft'/.test(S));
t('반영은 ?apply= 로만', /q\.apply === '1' && q\.id/.test(S));
t('큐에는 queued 로만 넣는다', /status: 'queued'/.test(S));
t('검토 화면이 있다', /q\.review === '1'/.test(S));
t('넣기 전 preview 가 있다', /q\.preview === '1'/.test(S));

console.log('\n=== 대상 고르기 ===');
t('노출 크고 CTR 낮은 것', /\.gte\('impressions', minImp\)/.test(S) && /\.lte\('ctr', maxCtr\)/.test(S));
t('겨냥할 검색어가 있는 기사만', /byId\[o\.article_id\] && \(byId\[o\.article_id\]\.queries \|\| \[\]\)\.length/.test(S));
t('이미 처리한 기사는 다시 안 넣는다', /const has = new Set/.test(S) && /!has\.has\(o\.article_id\)/.test(S));
t('한 번에 최대 100편', /\|\| 20, 1\), 100\)/.test(S));

console.log('\n=== 프롬프트 규칙 ===');
t('지어내기 금지가 있다', /없는 사실을 지어내지 마라/.test(S));
t('본문에 없으면 쓰지 말라고 한다', /본문에 없으면 쓰지 마라/.test(S));
t('검색어를 제목 앞쪽에 넣으라고 한다', /검색어 자체를 제목 앞쪽에/.test(S));
t('낚시 금지', /낚시 금지/.test(S));
t('대시 금지 (도메니코 규칙)', /대시\(—, –, ㅡ, --\) 금지/.test(S));
t('브랜드명은 렌더러가 붙인다', /브랜드명\("PAP Magazine"\)은 붙이지 마라/.test(S));

console.log('\n=== 길이 검사 ===');
t('제목 60자 기준', /TITLE_BACKFILL_TITLE_MAX \|\| 60/.test(S));
t('설명 155자 기준 (backfill-meta-desc 와 같다)', /TITLE_BACKFILL_DESC_MAX \|\| 155/.test(S));
t('길이 초과를 경고한다', /제목 ' \+ TITLE_MAX \+ '자 초과/.test(S));
t('대시·느낌표를 잡는다', /\[—–ㅡ\]\|--/.test(S) && /\[!\]/.test(S));
t('제목이 그대로면 잡는다', /바뀐 게 없다/.test(S));
t('자동 폐기하지 않고 사람에게 보여준다', /자동 폐기하지 않고 사람에게 보여 준다/.test(S));

console.log('\n=== 마이그레이션 159 ===');
t('검색어 매칭 뷰가 있다', /create or replace view public\.article_query_match/.test(M));
t('와일드카드(% _ \\\\)를 막는다', /replace\(replace\(replace\(t\.query/.test(M));
t('최근 28일만', /date >= current_date - 28/.test(M));
t('발행 기사만', /a\.status = 'published'/.test(M));
t('장부 표가 있다', /create table if not exists public\.article_title_backfill/.test(M));
t('원본 열이 있다', /old_title\s+text/.test(M) && /old_desc\s+text/.test(M));
t('RLS 를 켠다', /alter table public\.article_title_backfill enable row level security/.test(M));
t('anon 권한을 회수한다',
  /revoke all on public\.article_query_match from anon, authenticated/.test(M)
  && /revoke all on public\.article_title_backfill from anon, authenticated/.test(M));
t('실측 근거가 적혀 있다', M.includes('0.02%') && M.includes('2026-09-14'));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ article-title-backfill tests FAILED'); process.exit(1); }
console.log('✅ article-title-backfill tests passed');
