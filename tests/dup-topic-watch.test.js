/**
 * 같은 뉴스 중복 기사 경고 (2026-11-24, 도메니코 "경고만")
 * 실측 사례로 순수 로직을 보고, sync-instagram 배선과 '막지 않음' 을 확인한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const d = require('../api/_lib/dupTopicWatch');

// 실측 태그 (articles 2026-10-26 · 11-11 · 11월 로에베)
const rose1 = { id: 1, slug: 'rose-johnnie-walker-global-brand-partner', title: '로제와 조니워커가 만났다', tags: ['rosé', 'johnnie walker', 'brand partnership', 'blackpink'] };
const rose2 = { id: 2, slug: 'rose-johnnie-walker-global-brand-partner-signature-cocktail', title: '조니워커의 새로운 글로벌 파트너, 로제', tags: ['rosé', 'johnnie walker', 'blackpink', 'whisky'] };
const sh1 = { id: 3, slug: 'ateez-seonghwa-songzio-egonlab-launch-event', tags: ['ateez', 'seonghwa', 'songzio', 'egonlab', 'brand ambassador'] };
const sh2 = { id: 4, slug: 'seonghwa-songzio-egonlab-collaboration-launch-event', tags: ['seonghwa', 'ateez', 'songzio', 'egonlab', 'collaboration'] };
const wy = { id: 5, slug: 'ateez-wooyoung-loewe-tim-burton-capsule-casa', tags: ['loewe', 'ateez', 'wooyoung', 'tim burton', 'capsule collection'] };
const sk = { id: 6, slug: 'song-kang-loewe-casa-tim-burton-capsule-collection', tags: ['loewe', 'song kang', 'tim burton', 'capsule collection'] };
const fope1 = { id: 7, slug: 'meovv-narin-fope-second-anniversary-casa-fope', tags: ['meovv', 'narin', 'fope', 'jewelry'] };
const fope2 = { id: 8, slug: 'woo-do-hwan-fope-second-anniversary', tags: ['woo do-hwan', 'fope', 'jewelry', 'anniversary'] };

console.log('\n[1] 진짜 중복은 잡는다');
t('로제×조니워커 2편', d.matchSameTopic(rose2, [rose1]).length === 1);
t('성화×송지오에곤랩 2편', d.matchSameTopic(sh2, [sh1]).length === 1);

console.log('\n[2] 같은 행사 다른 셀럽은 안 잡는다');
t('로에베 송강 vs 우영', d.matchSameTopic(sk, [wy]).length === 0);
t('포페 나린 vs 우도환', d.matchSameTopic(fope2, [fope1]).length === 0);

console.log('\n[3] 경계');
t('자기 자신은 제외', d.matchSameTopic(rose1, [rose1]).length === 0);
t('태그 1개뿐이면 판단 안 함', d.matchSameTopic({ id: 9, tags: ['rosé'] }, [rose1]).length === 0);
t('범용 태그만 겹치면 안 잡음', d.matchSameTopic({ id: 10, tags: ['kpop', 'fashion', 'paris fashion week', 'a'] }, [{ id: 11, tags: ['kpop', 'fashion', 'paris fashion week', 'b'] }]).length === 0);
t('기본 창 48시간', d.windowHours() === 48);

console.log('\n[4] 조회 실패는 빈 결과 (발행을 막지 않음)');
(async () => {
  const badDb = { from() { throw new Error('boom'); } };
  const r = await d.findRecentSameTopic(rose2, { db: badDb });
  t('DB 오류 → []', Array.isArray(r) && r.length === 0);

  const okDb = { from() { const q = { select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; }, limit() { return Promise.resolve({ data: [rose1, wy] }); } }; return q; } };
  const r2 = await d.findRecentSameTopic(rose2, { db: okDb });
  t('DB 결과에서 같은 주제만', r2.length === 1 && r2[0].slug === rose1.slug, JSON.stringify(r2));

  console.log('\n[5] 알림 문구');
  const msg = d.formatAlert([{ slug: rose2.slug, title: rose2.title, matches: [{ slug: rose1.slug, title: rose1.title }] }], 'https://www.pap-magazine.com');
  t('건수·두 링크가 들어감', /중복 기사 의심 1건/.test(msg) && msg.includes('/article/' + rose1.slug) && msg.includes('/article/' + rose2.slug));
  t('발행은 그대로라고 밝힘', msg.includes('발행은 그대로'));
  t('적발 없으면 빈 문자열', d.formatAlert([], '') === '');
  t('대시 기호 없음', !/[—–]/.test(msg));

  console.log('\n[6] sync-instagram 배선');
  const src = fs.readFileSync(path.join(ROOT, 'api/cron/sync-instagram.js'), 'utf8');
  t('라이브러리를 불러옴', src.includes("require('../_lib/dupTopicWatch')"));
  t('발행분만 검사(백필 제외)', /!backfillMode && pubStatus === 'published'\)\{\s*\n\s*try \{\s*\n\s*const dupHits/.test(src));
  t('note 에 건수', src.includes("' · 중복의심 '"));
  t('개인방 한 통', src.includes('dupTopicWatch.formatAlert(results.dup_topic, SITE)'));
  t('검사가 insert 뒤에 있음(발행을 막지 않음)', src.indexOf('const dupHits') > src.indexOf(".from('articles')\n        .insert(row)"));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})();
