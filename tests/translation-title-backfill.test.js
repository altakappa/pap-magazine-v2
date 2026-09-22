/**
 * 언어판 제목 단축 (2026-09-15).
 *
 * [왜] Ahrefs Site Audit(9/15 크롤, 10,031페이지) 경고 1,623건 중 1,338건이
 * "Title too long" 이고 전부 /fr /de /es /it /ru 언어판이었다.
 * DB 전수 실측: fr 1,395 · de 1,352 · es 1,352 · it 1,289 · ru 1,172 이 60자 초과,
 * 최장 133자. ja 9건 · zh 3건 — 글자가 압축적이라 같은 프롬프트로도 괜찮다.
 *
 * 생성 쪽 상한은 2026-08-20 커밋 b23b31b 가 이미 걸었다. 8/20 이전 생성분은
 * 48.7~57.7% 가 60자 초과인데 이후 생성분은 1.9~4.6% 다. 즉 남은 건 전부
 * 레거시이고, 없던 것은 '기존 행을 되쓰는 도구' 였다.
 *
 * [이 테스트가 지키는 것]
 *  1) **한글 원제(articles.title)와 본문을 건드리지 않는다.** seo_translations.title 만.
 *  2) 반영은 사람이 누른다 (?apply=)
 *  3) 원본(old_title)을 보관해 되돌릴 수 있다
 *  4) 키가 (content_id, lang) 복합이다 — 같은 기사의 독일어판과 러시아어판은 다른 건이다
 *  5) "남은 것" 판별을 DB 뷰가 한다 (157 백필이 165번 헛돈 사고의 재발 방지)
 *  6) 지어내기 금지가 프롬프트에 있다
 *  7) 노출이 잡힌 것만 고친다 — 노출 0 은 고쳐도 확인할 방법이 없다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const S = R('api/admin/translation-title-backfill.js');
const M = R('supabase_migrations/161_translation_title_backfill.sql');
const PKG = R('package.json');

console.log('\n=== 한글 원제·본문은 안 건드린다 (가장 중요) ===');
t('seo_translations 에 쓰는 것은 title 뿐',
  /from\('seo_translations'\)\s*\n?\s*\.update\(\{ title: row\.new_title \}\)/.test(S));
t('articles 를 update 하지 않는다', !/from\('articles'\)[\s\S]{0,80}\.update\(/.test(S));
/* fetch 의 `body:` 는 HTTP 요청 본문이라 관계없다. DB update 페이로드만 본다 —
   번역 본문(seo_translations.body)을 건드리면 번역 전체가 날아간다. */
const UPDATE_PAYLOADS = (S.match(/\.update\(\{[^}]*\}/g) || []);
t('어떤 update 에도 body 를 넣지 않는다',
  UPDATE_PAYLOADS.every(u => !/\bbody\s*:/.test(u)), UPDATE_PAYLOADS.join(' | ').slice(0, 300));
t('어떤 update 에도 faq 를 넣지 않는다',
  UPDATE_PAYLOADS.every(u => !/\bfaq\s*:/.test(u)));
t('어떤 update 에도 description 을 넣지 않는다',
  UPDATE_PAYLOADS.every(u => !/\bdescription\s*:/.test(u)));
t('kind=article 로 좁힌다', /\.eq\('kind', 'article'\)/.test(S));
t('왜 그런지 적혀 있다', /한글 원제\(articles\.title\)도,/.test(S));

console.log('\n=== 되돌릴 수 있다 ===');
t('원본 제목을 보관한다', /old_title: c\.cur_title/.test(S));
t('원본 길이도 보관한다', /old_len: c\.cur_len/.test(S));
t('되돌리기가 있다', /q\.revert === '1'/.test(S) && /\.update\(\{ title: row\.old_title \}\)/.test(S));
t('되돌린 것은 reverted 로 남는다', /status: 'reverted'/.test(S));

console.log('\n=== 반영은 사람이 ===');
t('관리자만', /const user = await requireAdmin\(req, res\);/.test(S));
t('생성은 status=draft 까지만', /status: 'draft'/.test(S));
t('반영은 ?apply= 로만', /q\.apply === '1' && id && lang/.test(S));
t('큐에는 queued 로만 넣는다', /status: 'queued'/.test(S));
/* 2026-09-22 — 남은대상 조용한 0 버그 */
t('남은대상 개수 조회의 error 를 받는다', /count: remaining, error: remErr/.test(S));
t('남은대상을 || 0 으로 덮지 않는다', !/남은대상: remaining \|\| 0/.test(S));
t('실패면 null 과 남은대상_오류를 준다', /remErr \? null/.test(S) && /남은대상_오류/.test(S));
t('검토 화면이 있다', /q\.review === '1'/.test(S));
t('넣기 전 preview 가 있다', /q\.preview === '1'/.test(S));

console.log('\n=== 복합키 (content_id, lang) ===');
t('키 헬퍼가 둘 다 건다', /function keyed\(qb, id, lang\)[\s\S]{0,120}\.eq\('content_id', id\)\.eq\('lang', lang\)/.test(S));
t('apply 가 lang 없이는 안 돈다', /q\.apply === '1' && id && lang/.test(S));
t('revert 가 lang 없이는 안 돈다', /q\.revert === '1' && id && lang/.test(S));
t('reject 가 lang 없이는 안 돈다', /q\.reject === '1' && id && lang/.test(S));
t('중복 검사도 lang 을 본다', /has\.has\(c\.content_id \+ '\|' \+ c\.lang\)/.test(S));
t('마이그레이션 기본키가 복합', /primary key \(content_id, lang\)/.test(M));

console.log('\n=== 남은 것 판별은 DB 가 한다 (157 재발 방지) ===');
t('대상 뷰를 쓴다', /const TARGETS_VIEW = 'translation_title_targets'/.test(S));
t('뷰 조회 헬퍼가 하나다', /function targetQuery\(columns, selectOpts\)/.test(S));
t('왜 그런지 157 을 인용한다', /157 의 교훈/.test(S));
t('개수는 head count 로 센다 (5,000행 상한 함정 회피)',
  /\{ count: 'exact', head: true \}/.test(S));
t('supabase-js 규칙: from 뒤에 select 가 먼저', !/\.from\((?:'|")[^'"]+(?:'|")\)\s*\n?\s*\.(eq|gte|lte|in|or|order|limit)\(/.test(S));

console.log('\n=== 프롬프트 규칙 ===');
t('지어내기 금지가 있다', /Invent nothing/.test(S));
t('두 제목에 있는 것만 쓰라고 한다', /must already be in the two titles above/.test(S));
t('날짜·수치·인물을 새로 넣지 말라고 한다', /Do not add dates, numbers, people/.test(S));
t('한글이 남으면 안 된다고 한다', /No Hangul anywhere/.test(S));
t('영어로 쓰지 말라고 한다', /Not English, not Korean/.test(S));
t('대시 금지 (도메니코 규칙)', /No dashes \(em dash, en dash, double hyphen\)/.test(S));
t('느낌표·이모지 금지', /No emoji\. No exclamation marks/.test(S));
t('브랜드명은 렌더러가 붙인다', /The renderer adds it/.test(S));
t('억지로 길이를 채우지 말라고 한다', /Never pad a title to reach the limit/.test(S));
t('무엇부터 덜어낼지 알려준다', /Drop subordinate clauses, appositions/.test(S));

console.log('\n=== 초안 검사 ===');
t('언어별 상한을 seoTranslateBackfill 에서 가져온다',
  /require\('\.\.\/_lib\/seoTranslateBackfill'\)/.test(S) && /TITLE_MAX\[lang\] \|\| 60/.test(S));
t('한글 검사기를 재사용한다', /hasHangul\(t\)/.test(S));
t('영어 베끼기 검사기를 재사용한다', /isEnglishEcho\(t, row\.ko_title, row\.lang\)/.test(S));
t('길이 초과를 잡는다', /t\.length > max/.test(S));
t('대시·느낌표를 잡는다', /\[—–ㅡ\]\|--/.test(S) && /\/!\//.test(S));
t('안 바뀐 제목을 잡는다', /바뀐 게 없다/.test(S));
t('너무 많이 잘라낸 것도 잡는다', /원본의 3분의 1 미만/.test(S));
t('자동 폐기하지 않고 사람에게 보여준다', /자동 폐기하지 않고 사람에게 ⚠ 로 보여 준다/.test(S));

console.log('\n=== 대상 고르기 ===');
t('노출 하한이 있다', /\.gte\('impressions', minImp\)/.test(S));
t('기본 하한 50', /parseInt\(q\.min_imp, 10\) \|\| 50/.test(S));
t('노출 큰 것부터', /\.order\('impressions', \{ ascending: false \}\)/.test(S));
t('ja/zh 는 제외한다', /const LANGS = \['it', 'fr', 'es', 'de', 'ru'\]/.test(S));
t('왜 제외하는지 적혀 있다', /각각 9건·3건뿐이라 뺀다/.test(S));
t('한 번에 최대 200건', /\|\| 40, 1\), 200\)/.test(S));

console.log('\n=== 마이그레이션 161 ===');
t('대상 뷰가 있다', /create or replace view public\.translation_title_targets/.test(M));
t('60자 초과만', /char_length\(t\.title\) > 60/.test(M));
t('최근 28일 노출만', /g\.date >= current_date - 28/.test(M));
t('발행 기사만', /a\.status = 'published'/.test(M));
t('언어를 5개로 좁힌다', /t\.lang in \('it', 'fr', 'es', 'de', 'ru'\)/.test(M));
t('slug 와 custom_url 둘 다로 잇는다', /g\.handle = a\.slug or g\.handle = a\.custom_url/.test(M));
t('장부 표가 있다', /create table if not exists public\.translation_title_backfill/.test(M));
t('원본 열이 있다', /old_title\s+text/.test(M) && /old_len\s+integer/.test(M));
t('RLS 를 켠다', /alter table public\.translation_title_backfill enable row level security/.test(M));
t('anon 권한을 회수한다',
  /revoke all on public\.translation_title_targets from anon, authenticated/.test(M)
  && /revoke all on public\.translation_title_backfill from anon, authenticated/.test(M));
t('실측 근거가 적혀 있다', M.includes('1,395') && M.includes('2026-09-15'));
t('생성 쪽은 이미 막혔다는 근거가 적혀 있다', M.includes('b23b31b') && M.includes('8/20 이후'));

console.log('\n=== 테스트 등록 ===');
t('package.json 에 등록돼 있다', PKG.includes('node tests/translation-title-backfill.test.js'));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ translation-title-backfill tests FAILED'); process.exit(1); }
console.log('✅ translation-title-backfill tests passed');
