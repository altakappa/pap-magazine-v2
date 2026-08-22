/**
 * 아티클 SSR 내부 링크 + kind별 메타 서명 회귀 (Ahrefs Tip #3, 2026-07-23).
 * 에디토리얼엔 있던 "More X" 내부링크 블록을 아티클에도 부여 + 메타 서명을
 * kind별로 정확화(뉴스에 "패션 에디토리얼" 오표기 금지).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { renderSeoHtml } = require(path.join(__dirname, '..', 'api', '_lib', 'seoRenderer.js'));
const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'seo', 'article', '[slug].js'), 'utf8');
// 2026-08-08 — 빌더 본체가 api/_lib/moreArticles.js 로 이사 (SPA 상세 API 와
// 공유 — 규칙이 두 벌이면 한쪽만 고쳐진다). 체인 규칙 검증은 lib 쪽을 본다.
const moreLib = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'moreArticles.js'), 'utf8');
function meta(h){ const m=h.match(/<meta name="description" content="([^"]*)"/); return m?m[1]:''; }

let pass=0, fail=0;
function t(n,c,d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

const art = { title:'속보', slug:'yg', status:'published', published_date:'2026-07-22', content:'짧음', category:'celeb', cover_image:'x.jpg',
  more_articles:{ prev:{title:'이전',slug:'prev-a',thumbnail:'p.jpg'}, next:{title:'다음',slug:'next-a',thumbnail:'n.jpg'}, related:[{title:'관련',slug:'rel-a',thumbnail:'r.jpg'}] } };
const ed = { title:'에디', slug:'ed', status:'published', published_date:'2026-07-22', description:'짧음', cover_image:'x.jpg',
  more_editorials:{ prev:{title:'전',slug:'prev-e',thumbnail:'p.jpg'}, next:null, related:[] } };

console.log('\n=== 아티클 내부 링크 블록 ===');
const ah = renderSeoHtml('article', art, {lang:'ko'});
t('아티클: "More Articles" 헤딩', ah.includes('More Articles'));
t('아티클: /article/ 내부 링크 렌더', (ah.match(/href="\/article\//g)||[]).length >= 3);
t('아티클: /editorial/ 로 잘못 링크하지 않음', !ah.includes('/editorial/prev-a'));
t('에디토리얼: 여전히 "More Editorials"·/editorial/', renderSeoHtml('editorial', ed, {lang:'ko'}).includes('More Editorials'));

console.log('--- kind별 메타 서명 정확성 ---');
const bareArt = renderSeoHtml('article', {title:'속보', slug:'b', status:'published', published_date:'2026-07-22', content:'짧', cover_image:'x.jpg'}, {lang:'ko'});
t('아티클 메타: "뉴스" 표기', /뉴스/.test(meta(bareArt)));
t('아티클 메타: "패션 에디토리얼" 오표기 없음', !/패션 에디토리얼/.test(meta(bareArt)));
const bareEd = renderSeoHtml('editorial', {title:'에디', slug:'e', status:'published', published_date:'2026-07-22', description:'짧', cover_image:'x.jpg'}, {lang:'ko'});
t('에디토리얼 메타: "에디토리얼" 표기 유지', /에디토리얼/.test(meta(bareEd)));

console.log('--- 아티클 route 로더 ---');
t('route: more_articles 탑재 (공용 빌더 경유)', /data\.more_articles = await buildMoreArticles\(data\)/.test(route));
t('빌더: prev/next 발행일 체인 + 카테고리 관련', /published_date\.lt/.test(moreLib) && /eq\('category', data\.category\)/.test(moreLib));
t('route: 실패해도 페이지 정상(try/catch)', /try \{[\s\S]*more_articles[\s\S]*\} catch/.test(route));

/* ── 엔티티 클러스터 링크 (2026-08-22) ──────────────────────────────
   8월 실측: 한국어 노출의 88%가 4~10위. 막힌 질의는 거의 전부 엔티티
   (윤채 1,936·휴먼메이드 1,346·셩셩 1,018·조나단 앤더슨 708).
   원인은 내부링크 — 홈이 10,001개를 받는 동안 기사는 2~13개다.
   기존 related(임베딩·카테고리+날짜)는 '내용이 닮음'이지 '같은 대상'이 아니다. */
console.log('\n=== 엔티티 클러스터 내부 링크 ===');
t('태그 겹침으로 같은 대상 기사를 찾는다', /tags\.cs\./.test(moreLib) && /_entityCluster/.test(moreLib));
t('후보군에서 흔한 태그는 점수에서 뺀다 (kpop·bts)',
  /GENERIC_RATIO/.test(moreLib) && /n > genericAt/.test(moreLib));
t('희소 태그가 1개 이상 겹쳐야 인정한다', /x\.rare >= 1/.test(moreLib));
t('드문 태그일수록 무겁게 센다 (1/빈도)', /score \+= 1 \/ n/.test(moreLib));
t('related 4칸 중 2칸만 내준다 (기존 추천을 밀어내지 않는다)',
  /CLUSTER_SLOTS\s*=\s*2/.test(moreLib));
t('클러스터를 앞자리에 둔다 (뒤에 두면 4칸에서 잘린다)',
  moreLib.indexOf('for (const a of cluster)') < moreLib.indexOf('for (const a of related)'));
t('자기 자신·중복을 거른다', /seenIds/.test(moreLib) && /new Set\(\[data\.id\]\)/.test(moreLib));
t('실패하면 조용히 빈 배열 — 페이지는 종전대로',
  /catch \(_e\) \{\s*\n?\s*return \[\];/.test(moreLib));
t('or() 를 깨뜨리는 태그는 미리 뺀다 (콤마·따옴표·괄호)',
  /\[,"'\(\)\\\\\]/.test(moreLib));
t('새 페이지를 만들지 않는다 (브랜드 허브 881개가 평균 22.4위인 실패의 반복 방지)',
  !/from\('brands'\)/.test(moreLib));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ article-internal-links tests FAILED'); process.exit(1); }
console.log('✅ article-internal-links tests passed');
