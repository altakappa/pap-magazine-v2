/**
 * X 본문 링크 A/B (2026-10-05, 도메니코 "일주일만 인스타링크로 시험해볼까?")
 *
 * 성질: 실험은 env 로만 켜지고 날짜로 꺼진다 · 갈래는 기사 id 로 결정적 ·
 * body 갈래는 본문에 ig-out(x_body) 링크, 답글엔 웹만 · reply 갈래는 종전 그대로 ·
 * 갈래가 x_posts.kind 에 남는다 · 도달은 x-metrics 크론이 잰다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

delete process.env.X_BODY_LINK_AB; delete process.env.X_BODY_LINK_AB_UNTIL;
const ab = require('../api/_lib/xBodyLinkAb');
const x = require('../api/_lib/xPost');

t('기본은 꺼짐 (env 없음 → null)', ab.variantFor('7f6f81a6-0000') === null);
process.env.X_BODY_LINK_AB = 'on';
t('켜면 짝수 끝자리 → body', ab.variantFor('abc0') === 'body' && ab.variantFor('abce') === 'body');
t('켜면 홀수 끝자리 → reply', ab.variantFor('abc1') === 'reply' && ab.variantFor('abcd') === 'reply');
t('같은 id 는 늘 같은 갈래(결정적)', ab.variantFor('7f6f81a6-1c24-4b7e-9589-e8276520b35d') === ab.variantFor('7f6f81a6-1c24-4b7e-9589-e8276520b35d'));
process.env.X_BODY_LINK_AB_UNTIL = '2026-10-13';
t('UNTIL 전이면 켜짐', ab.variantFor('abc0', Date.parse('2026-10-12T23:00:00Z')) === 'body');
t('UNTIL 이후면 저절로 꺼짐 (일주일 실험)', ab.variantFor('abc0', Date.parse('2026-10-13T00:00:01Z')) === null);
delete process.env.X_BODY_LINK_AB_UNTIL;

const body = '후킹 한 줄\n\n본문이다.\n\n#PAPMAGAZINE';
const link = 'https://www.pap-magazine.com/api/ig-out?src=x_body&to=post&url=https%3A%2F%2Fwww.instagram.com%2Freel%2FABC%2F';
const out = ab.bodyWithIgLink(body, link, x);
t('body 갈래: 본문 + 링크 + 태그 줄 순서', out === '후킹 한 줄\n\n본문이다.\n\n' + link + '\n\n#PAPMAGAZINE');
t('body 갈래에 안내 줄은 없다(링크가 있으니)', !/풀 영상은 인스타/.test(out));
t('URL 은 23자로 센다 (긴 ig-out 주소가 280 판정을 왜곡하지 않는다)', ab.bodyWithIgLink('가'.repeat(120) + '\n\n#PAPMAGAZINE', link, x) !== null);
t('진짜로 넘치면 null (호출부가 reply 갈래로)', ab.bodyWithIgLink('가'.repeat(135) + '\n\n#PAPMAGAZINE', link, x) === null);

// 계측 라벨
const igout = fs.readFileSync(path.join(ROOT, 'api/ig-out.js'), 'utf8');
const igfl = fs.readFileSync(path.join(ROOT, 'api/_lib/igFirstLink.js'), 'utf8');
t('ig-out 화이트리스트에 x_body', /'x_body'/.test(igout));
t('igFirstLink 채널에 x_body (없으면 other 로 뭉개진다)', /'x_body'/.test(igfl) && ab.IG_OUT_SRC === 'x_body');
const { igOutUrl } = require('../api/_lib/igFirstLink');
t('igOutUrl 이 x_body 를 src 로 보낸다', /src=x_body/.test(igOutUrl('https://www.instagram.com/reel/ABC/?igsh=1', 'x_body')));

// 배선
const sync = fs.readFileSync(path.join(ROOT, 'api/cron/sync-instagram.js'), 'utf8');
t('sync-instagram: 갈래 계산은 미디어 있을 때만', /const abVariant = hasMedia \? ab\.variantFor\(inserted\.id\) : null/.test(sync));
t('sync-instagram: body 갈래 본문 → kind ab_body, reply 갈래 → ab_reply, 꺼짐 → article', /const abKind = abBody \? 'ab_body' : \(abVariant \? 'ab_reply' : 'article'\)/.test(sync));
t('sync-instagram: body 갈래의 답글은 웹 링크만', /abBody \? \('웹에서 전문 보기 → ' \+ gen\.url\) : igFirstLinkBlock/.test(sync));
t('sync-instagram: postTweet 에 kind 를 넘긴다', /kind: abKind/.test(sync));

// 도달 눈금
const xp = fs.readFileSync(path.join(ROOT, 'api/_lib/xPost.js'), 'utf8');
t('xPost.getTweetMetrics: public_metrics 를 GET, 쿼리를 서명에 넣는다', /tweet\.fields=public_metrics/.test(xp) && /_oauthGetHeader\(base, q\)/.test(xp) && typeof x.getTweetMetrics === 'function');
t('x-metrics 크론 파일 + 가드', fs.existsSync(path.join(ROOT, 'api/cron/x-metrics.js')) && /withCronGuard\('x-metrics'/.test(fs.readFileSync(path.join(ROOT, 'api/cron/x-metrics.js'), 'utf8')));
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
t('vercel.json 에 x-metrics 예약', (vj.crons || []).some((c) => c.path === '/api/cron/x-metrics'));
t('마이그레이션 178: x_posts 지표 컬럼', /ADD COLUMN IF NOT EXISTS views integer/.test(fs.readFileSync(path.join(ROOT, 'supabase_migrations/178_x_posts_metrics.sql'), 'utf8')));
const xm = fs.readFileSync(path.join(ROOT, 'api/cron/x-metrics.js'), 'utf8');
t('x-metrics: 조회 막히면 사유를 노트에 싣고 remaining 을 올린다', /지표 조회 막힘/.test(xm) && /reportProduction\(res, \{ produced: 0, remaining: due\.length \}\)/.test(xm));
t('x-metrics: 응답에 없는 트윗은 stage 9 로 큐에서 뺀다', /metrics_stage: STAGE_DEAD/.test(xm) && /STAGE_DEAD = 9/.test(xm));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
