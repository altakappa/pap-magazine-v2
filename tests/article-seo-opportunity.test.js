/**
 * 본문 보강 큐를 GSC 실측으로 채운다 (2026-09-14, 도메니코 "1~3위로 올리는 작업").
 *
 * [무엇이 문제였나] api/admin/article-body-backfill.js 는 status='queued' 인 행을
 * 노출 큰 순으로 하나씩 생성한다. 그런데 **큐를 채우는 코드가 없었다.**
 * 8/17~18 에 사람이 넣은 50편을 다 쓴 뒤로 큐가 비어 한 달 가까이 멈춰 있었다.
 * (실측: article_body_backfill 은 applied 50건뿐, 최신 2026-08-18)
 *
 * [무엇을 기준으로 고르나] 뷰 article_seo_opportunity (마이그레이션 158).
 * 최근 28일 GSC 를 **기사 단위로 합산**한다. 언어판을 합치지 않으면 순서가 틀린다.
 *   실측 — 제니 아디다스 발레코어:
 *     /es/ 17,207 · /ja/ 9,303 · / 7,128 …  →  합계 46,472 (1위)
 *   페이지 단위로는 3등쯤으로 보였다.
 *
 * [왜 본문 길이인가] 2026-09-14 실측:
 *   812자 → 3.5위 · CTR 21.3%   (서도호 전시)
 *   337자 → 8.5위 · CTR 0.54%  (제니 서머소닉 CK)
 *   405자 → 6.5위 · CTR 0.18%  (튜이드 SUN KISS)
 *
 * [이 테스트가 지키는 것]
 *  1) 큐에 넣기만 한다. 생성도 반영도 하지 않는다 (발행 판단은 도메니코 몫)
 *  2) 이미 큐에 있거나 반영된 기사를 다시 넣지 않는다
 *  3) 3위 안쪽과 15위 밖은 건드리지 않는다
 *  4) 넣기 전에 눈으로 볼 수 있다 (preview)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const S = R('api/admin/article-body-backfill.js');
const M = R('supabase_migrations/158_article_seo_opportunity.sql');

console.log('\n=== 뷰 158 ===');
t('뷰를 만든다', /create or replace view public\.article_seo_opportunity/.test(M));
t('**언어판을 합산한다** (안 하면 우선순위가 틀린다)',
  /\^\/\(en\|ja\|it\|fr\|es\|de\|zh\|ru\)\//.test(M));
t('최근 28일만 본다', /date >= current_date - 28/.test(M));
t('발행된 기사만', /a\.status = 'published'/.test(M));
t('본문 자수를 태그 뺀 길이로 센다', /regexp_replace\(coalesce\(a\.content, ''\), '<\[\^>\]\+>'/.test(M));
t('노출·클릭·CTR·평균순위를 준다',
  /as impressions/.test(M) && /as clicks/.test(M) && /as ctr/.test(M) && /as avg_position/.test(M));
t('anon 권한을 회수한다', /revoke all on public\.article_seo_opportunity from anon, authenticated/.test(M));
t('아무것도 바꾸지 않는다고 적혀 있다', /아무것도 바꾸지 않는다/.test(M));
t('실측 근거(46,472)가 적혀 있다', M.includes('46,472'));

console.log('\n=== enqueue 엔드포인트 ===');
t('?enqueue=1 이 있다', /if \(q\.enqueue === '1'\)/.test(S));
t('뷰에서 고른다', /\.from\('article_seo_opportunity'\)/.test(S));
t('순위 3.5~15 만 (3위 안쪽·15위 밖은 손대지 않는다)',
  /\.gte\('avg_position', 3\.5\)/.test(S) && /\.lte\('avg_position', 15\)/.test(S));
t('본문이 짧은 것만', /\.lt\('body_len', maxLen\)/.test(S));
t('노출 하한이 있다', /\.gte\('impressions', minImp\)/.test(S));
t('노출 큰 순', /\.order\('impressions', \{ ascending: false \}\)/.test(S));
t('이미 큐·반영된 기사는 다시 안 넣는다', /const has = new Set/.test(S) && /!has\.has\(c\.article_id\)/.test(S));
t('큐에는 status=queued 로만 넣는다', /status: 'queued'/.test(S));
t('넣기 전에 눈으로 보는 preview 가 있다', /q\.preview === '1'/.test(S));
t('한 번에 최대 100편', /\|\| 20, 1\), 100\)/.test(S));

console.log('\n=== 순서는 그대로다 (큐 → 생성 → 사람이 반영) ===');
t('enqueue 는 본문을 생성하지 않는다', !/q\.enqueue === '1'[\s\S]{0,3000}generateBody\(/.test(S));
t('enqueue 는 articles 를 건드리지 않는다',
  !/q\.enqueue === '1'[\s\S]{0,3000}from\('articles'\)[\s\S]{0,60}\.update\(/.test(S));
t('반영은 여전히 사람이 누른다 (?apply=)', /q\.apply/.test(S));
t('관리자만 부를 수 있다', /const user = await requireAdmin\(req, res\);/.test(S));

console.log('\n=== 왜 했는지 적혀 있다 ===');
t('큐가 비어 멈춰 있었다는 사실', /큐를 채우는 코드가 없었다/.test(S));
t('언어판 합산 이유', /언어판/.test(S));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ article-seo-opportunity tests FAILED'); process.exit(1); }
console.log('✅ article-seo-opportunity tests passed');
