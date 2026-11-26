/**
 * 경쟁사 광고주 알림 (2026-11-26, 도메니코 "3번 해줘")
 * 실측 캡션으로 광고 판정을 보고, 하루 한 번만 보내는지, 실패해도 크론을 안 막는지 확인한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const a = require('../api/_lib/competitorAdWatch');

console.log('\n[1] 광고 판정 (실측 캡션)');
t('셀패진 "#광고 게스 현진"', a.detectAdTag('#광고 게스 현진 만나러 잠실 감').tag === '#광고');
t('셀패진 "[#제작지원 ㅣ셀패진 Exclusive]"', a.detectAdTag('[#제작지원 ㅣ셀패진 Exclusive] 게스 26 윈터').tag === '#제작지원');
t('아트아트 "#댓글이벤트 #광고 (EVENT)"', a.detectAdTag('#댓글이벤트 #광고 (EVENT📩) 한 점에 40년').where === 'head');
t('#AD 대소문자', a.detectAdTag('new drop #ad').tag === '#AD' && a.detectAdTag('#AD | 코치').tag === '#AD');
t('앞 150자 밖이면 tail', a.detectAdTag('가'.repeat(200) + ' #맥도날드 #광고').where === 'tail');
t('#광고디자인 은 광고 아님', a.detectAdTag('맥도날드 할로윈 #광고디자인 #광고캠페인') === null);
t('#adidas #ad_x #additional 은 광고 아님', a.detectAdTag('#adidas #ad_x #additional') === null);
t('"광고" 낱말만 있으면 아님', a.detectAdTag('맥도날드의 할로윈 광고에는 소품이 없다') === null);
t('빈 값', a.detectAdTag('') === null && a.detectAdTag(null) === null);

console.log('\n[2] 행 만들기');
const acc = { followers: 865247, media: [
  { permalink: 'https://www.instagram.com/p/A/', ts: '2026-11-26T01:00:00+0000', caption_head: '#광고 게스 현진', likes: 323, comments: 2, ad: { tag: '#광고', where: 'head' } },
  { permalink: 'https://www.instagram.com/p/B/', ts: '2026-11-26T02:00:00+0000', caption_head: '빅뱅 신곡', likes: null, comments: 0, ad: null },
  { permalink: 'https://www.instagram.com/p/C/', ts: 'nope', caption_head: 'x' },
  { ts: '2026-11-26T02:00:00+0000', caption_head: 'no link' },
  { permalink: 'https://www.instagram.com/p/D/', ts: '2026-11-26T03:00:00+0000', caption_head: '#제작지원 | 커버낫' },
] };
const rows = a.buildRows('celeb_fashion_magazine', acc);
t('깨진 날짜·링크 없는 것은 버림', rows.length === 3);
t('광고 표시가 행에 들어감', rows[0].ad_tag === '#광고' && rows[0].ad_where === 'head' && rows[1].ad_tag === null);
t('igDiscovery 판정이 없으면 앞머리로 판정', rows[2].ad_tag === '#제작지원');
t('좋아요 숨김(null)은 0 으로 바꾸지 않음', rows[1].likes === null);
t('7개 계정', a.WATCH_HANDLES.length === 7 && a.WATCH_HANDLES.includes('hipkr_') && a.WATCH_HANDLES.includes('newsourcemag'));

console.log('\n[3] 언제 보내나');
const kst9 = Date.UTC(2026, 10, 26, 0, 7);    // 한국 09:07
const kst13 = Date.UTC(2026, 10, 26, 4, 7);   // 한국 13:07
const fresh = [{ created_at: new Date(kst13 - 3600000).toISOString() }];
const stale = [{ created_at: new Date(kst13 - 30 * 3600000).toISOString() }];
t('한국 9시 회차', a.kstHour(kst9) === 9 && a.shouldSendDigest(kst9, fresh));
t('다른 시간엔 안 보냄', a.shouldSendDigest(kst13, fresh) === false);
t('26시간 넘게 밀렸으면 대신 보냄', a.shouldSendDigest(kst13, stale) === true);
t('보낼 것이 없으면 안 보냄', a.shouldSendDigest(kst9, []) === false);

console.log('\n[4] PAP 이력 판정');
const hay = '구출된 카리나, mlb 커브패딩으로 윈터시티 탈출\n김지원이 선택한 듀베티카 겨울 패딩\n게스트 하우스에서 생긴 일';
t('MLB 는 이력 있음', a.papHasRun('MLB', hay));
t('듀베티카 는 이력 있음', a.papHasRun('듀베티카', hay));
t('"게스" 가 "게스트" 에 걸리지 않음', a.papHasRun('게스', hay) === false);
t('"게스의" 는 걸림', a.papHasRun('게스', '게스의 겨울 캠페인'));
t('없는 브랜드', a.papHasRun('노스페이스', hay) === false);
t('한 글자·빈 값은 판단 안 함', a.papHasRun('a', hay) === false && a.papHasRun('', hay) === false);

console.log('\n[5] 알림 문구');
const msg = a.formatDigest([
  { handle: 'celeb_fashion_magazine', permalink: 'https://www.instagram.com/p/A/', caption_head: '#광고 게스 현진 만나러 잠실 감', ad_where: 'head', brand: '게스', ad_category: '패션', pap_history: false },
  { handle: 'hypejackmag', permalink: 'https://www.instagram.com/p/A2/', caption_head: '#광고 게스 팝업', ad_where: 'head', brand: '게스', ad_category: '패션', pap_history: false },
  { handle: 'hypejackmag', permalink: 'https://www.instagram.com/p/M/', caption_head: '#광고 카리나 구출', ad_where: 'head', brand: 'MLB', ad_category: '패션', pap_history: true },
  { handle: 'eyesmag', permalink: 'https://www.instagram.com/p/U/', caption_head: '겨울 팝업 소식 ' + '가'.repeat(60), ad_where: 'tail', brand: '', ad_category: '', pap_history: null },
]);
t('건수와 묶음 수', msg.startsWith('경쟁사 새 광고 4건') && msg.includes('PAP 에 없던 브랜드 1곳') && msg.includes('PAP 도 실은 브랜드 1곳') && msg.includes('브랜드 못 읽음 1건'));
t('같은 브랜드는 한 줄로 묶고 매체를 나열', /· 게스 \(패션\) \/ celeb_fashion_magazine, hypejackmag \/ 2건/.test(msg));
t('새 리드가 PAP 이력보다 위', msg.indexOf('게스 (패션)') < msg.indexOf('MLB (패션)'));
t('끝 태그는 확인 필요 표시', msg.includes('끝 태그라 확인 필요'));
t('링크가 들어감', msg.includes('https://www.instagram.com/p/A/') && msg.includes('https://www.instagram.com/p/M/'));
t('사람이 연락한다고 밝힘', msg.includes('연락은 사람이 직접'));
t('대시 기호 없음', !/[—–]/.test(msg));
t('없으면 빈 문자열', a.formatDigest([]) === '');
const many = []; for (let i = 0; i < 30; i++) many.push({ handle: 'eyesmag', permalink: 'https://www.instagram.com/p/' + i + '/', caption_head: '#광고 브랜드' + i, ad_where: 'head', brand: '브랜드' + i, ad_category: '패션', pap_history: false });
const long = a.formatDigest(many);
t('20곳까지만 보여 주고 나머지는 건수로', long.includes('외 10곳') && long.length < 4000, String(long.length));

/* 가짜 DB: 테이블별 호출을 기록한다 */
function fakeDb(o) {
  const log = [];
  return { log, from(table) {
    const q = { _t: table, _op: 'select' };
    const chain = ['select', 'eq', 'gte', 'ilike', 'not', 'is', 'order'];
    chain.forEach((k) => { q[k] = function () { return q; }; });
    q.upsert = function (rows, opt) { log.push({ t: table, op: 'upsert', n: rows.length, opt }); return Promise.resolve({ error: o.upsertError || null }); };
    q.update = function (v) { q._op = 'update'; q._v = v; return q; };
    q.in = function (col, ids) { log.push({ t: table, op: 'update_in', v: q._v, ids }); return Promise.resolve({ error: null }); };
    q.limit = function () { return Promise.resolve({ data: table === 'articles' ? (o.articles || []) : (o.pending || []) }); };
    const eq0 = q.eq;
    q.eq = function (col, val) { if (q._op === 'update') { log.push({ t: table, op: 'update_eq', v: q._v, id: val }); return Promise.resolve({ error: null }); } return eq0(); };
    return q;
  } };
}

(async () => {
  console.log('\n[6] 전체 흐름');
  const accounts = [{ handle: 'celeb_fashion_magazine', acc }, { handle: 'eyesmag', acc: { error: 'rate limit' } }];
  const pending = [
    { id: 1, handle: 'celeb_fashion_magazine', permalink: 'https://www.instagram.com/p/A/', caption_head: '#광고 게스 현진', ad_tag: '#광고', ad_where: 'head', brand: null, created_at: new Date(kst9 - 3600000).toISOString() },
    { id: 2, handle: 'hypejackmag', permalink: 'https://www.instagram.com/p/M/', caption_head: '#광고 카리나 MLB', ad_tag: '#광고', ad_where: 'head', brand: 'MLB', ad_category: '패션', created_at: new Date(kst9 - 3600000).toISOString() },
  ];
  const clone = () => pending.map((p) => Object.assign({}, p));
  const okFetch = async () => ({ ok: true, json: async () => ({ content: [{ text: '[{"i":0,"brand":"게스","category":"패션"}]' }] }) });

  let sentText = '';
  let db = fakeDb({ pending: clone(), articles: [{ title: '구출된 카리나, MLB 커브패딩', instagram_caption: '#광고 MLB' }] });
  let r = await a.runAdWatch({ db, accounts, nowMs: kst9, apiKey: 'k', fetchImpl: okFetch, send: async (x) => { sentText = x; return { ok: true }; } });
  t('에러 난 계정은 건너뛰고 저장', r.stored === 3 && db.log[0].op === 'upsert' && db.log[0].opt.ignoreDuplicates === true);
  t('9시에 보냄', r.sent === true && sentText.includes('게스'));
  t('이미 브랜드가 있는 행은 다시 안 뽑음 (MLB 그대로)', sentText.includes('MLB') && db.log.filter((l) => l.op === 'update_eq').length === 1);
  t('PAP 이력으로 갈림', sentText.indexOf('· 게스') > -1 && sentText.indexOf('· 게스') < sentText.indexOf('[PAP 도 실은 브랜드') && sentText.indexOf('[PAP 도 실은 브랜드') < sentText.indexOf('· MLB'), sentText);
  t('보낸 뒤 alerted_at 표시', db.log.some((l) => l.op === 'update_in' && l.v.alerted_at && l.ids.length === 2));

  db = fakeDb({ pending: clone() });
  r = await a.runAdWatch({ db, accounts, nowMs: kst13, apiKey: 'k', fetchImpl: okFetch, send: async () => { throw new Error('보내면 안 됨'); } });
  t('9시가 아니면 저장만', r.sent === false && r.skipped === 'not_digest_time' && r.pending === 2);

  db = fakeDb({ pending: clone() });
  r = await a.runAdWatch({ db, accounts, nowMs: kst9, apiKey: 'k', fetchImpl: okFetch, send: async () => ({ ok: false, skipped: 'no_personal_chat_id' }) });
  t('전송 실패면 alerted_at 을 찍지 않음 (다음에 다시)', r.sent === false && r.skipped === 'send_no_personal_chat_id' && !db.log.some((l) => l.op === 'update_in'));
  t('그래도 뽑은 브랜드는 저장 (Claude 재호출 방지)', db.log.some((l) => l.op === 'update_eq' && l.v.brand === '게스'));

  db = fakeDb({ pending: clone() });
  let text2 = '';
  r = await a.runAdWatch({ db, accounts, nowMs: kst9, apiKey: '', send: async (x) => { text2 = x; return { ok: true }; } });
  t('Claude 키가 없어도 캡션으로 알림', r.sent === true && text2.includes('브랜드 못 읽음 1건'));

  db = fakeDb({ pending: clone() });
  r = await a.runAdWatch({ db, accounts, nowMs: kst9, apiKey: 'k', fetchImpl: async () => { throw new Error('boom'); }, send: async () => ({ ok: true }) });
  t('Claude 가 죽어도 알림은 감', r.sent === true);

  db = fakeDb({ pending: clone() });
  r = await a.runAdWatch({ db, accounts, nowMs: kst9, dry: true, send: async () => { throw new Error('x'); } });
  t('dry 는 저장도 전송도 안 함', r.skipped === 'dry' && db.log.length === 0);

  db = fakeDb({ pending: clone(), upsertError: { message: 'relation does not exist' } });
  r = await a.runAdWatch({ db, accounts, nowMs: kst9, send: async () => { throw new Error('x'); } });
  t('표가 없으면 조용히 멈춤 (마이그레이션 전 배포 대비)', r.skipped === 'store_failed' && r.sent === false);

  r = await a.runAdWatch({ db: fakeDb({}), accounts: [], nowMs: kst9, send: async () => ({ ok: true }) });
  t('계정이 하나도 안 읽혔으면 아무것도 안 함', r.skipped === 'no_rows');

  console.log('\n[7] 배선');
  const cron = fs.readFileSync(path.join(ROOT, 'api/cron/competitor-watch.js'), 'utf8');
  const disc = fs.readFileSync(path.join(ROOT, 'api/_lib/igDiscovery.js'), 'utf8');
  const mig = fs.readFileSync(path.join(ROOT, 'supabase_migrations/193_competitor_watch_ig.sql'), 'utf8');
  t('크론이 라이브러리를 부름', cron.includes("require('../_lib/competitorAdWatch')") && cron.includes('runAdWatch({'));
  t('본지 5곳과 페퍼릿 2곳 모두 넘김', (cron.match(/adAccs\.push\(\{ handle: u, acc \}\)/g) || []).length === 2);
  t('"게시물 없음" 조기 종료보다 앞에서 돔', cron.indexOf('runAdWatch({') < cron.indexOf("'24시간 내 경쟁사 게시물 없음.'"));
  t('실패해도 크론을 안 막음 (try 안)', /try \{\s*\n\s*adWatch = await runAdWatch/.test(cron));
  t('개인방으로 보냄 (그룹방 아님)', cron.includes('send: sendTextToTelegramPersonalSafe'));
  t('cron_runs note 에 남김', cron.includes("' · 광고감시 저장 '") && (cron.match(/\+ adNote/g) || []).length === 2);
  t('igDiscovery 가 캡션 전체로 판정', disc.includes('ad: detectAdTag(m.caption)'));
  t('표는 서버만 접근 (RLS + REVOKE)', /ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.competitor_watch_ig FROM anon, authenticated/.test(mig));
  t('pepperit_watch_ig 는 건드리지 않음', !/ALTER TABLE public\.pepperit_watch_ig|DROP/.test(mig));
  const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  t('npm test 에 등록', pkg.includes('node tests/competitor-ad-watch.test.js'));

  console.log('\n결과: ' + pass + ' 통과 / ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
})();
