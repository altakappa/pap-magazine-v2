/*
 * creator-mail.test.js  (2026-09-24, 도메니코 "세 조각 설정해줘")
 *
 * 크리에이터가 한 번 오고 다시 안 온다(첫 제출 60일+ 51명 중 재제출 3명, 6%).
 * 미용실의 "다음 예약·다듬으러 오세요 문자·이달의 신메뉴" 세 조각을 지킨다.
 *   ① 승인 메일에 다음 촬영 초대 + 풀레터 동선 (승인일 때만)
 *   ② 게재 14~45일 화보 성적표 (발송 스위치 기본 꺼짐)
 *   ③ 월간 크리에이터 소식 초안 (크론은 draft 만 만든다. 보내는 건 도메니코)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const _orig = Module._load;
Module._load = function (req) {
  if (/nodemailer/.test(req)) return { createTransport: () => ({ sendMail: async () => ({}) }) };
  if (/(^|\/)supabase$/.test(req)) return { supabaseAdmin: { from: () => ({}) } };
  return _orig.apply(this, arguments);
};
const { templates } = require(path.join(ROOT, 'api/_lib/email'));
Module._load = _orig;
const R = require(path.join(ROOT, 'api/_lib/creatorReport'));
const { REPORT, MONTHLY } = require(path.join(ROOT, 'api/_lib/creatorMailCopy'));
const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];

console.log('\n=== ① 승인 메일: 다음 촬영 초대 ===');
for (const l of LANGS) {
  const h = templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, l, 'approved', {}).html;
  ok((h.match(/utm_campaign=next_shoot/g) || []).length === 2, l + ': 승인 메일에 다음 화보·풀레터 링크 2개 (utm next_shoot)');
}
for (const st of ['rejected', 'revision', 'pending']) {
  const h = templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, 'ko', st, {}).html;
  ok(!/next_shoot/.test(h), st + ' 메일에는 초대 블록이 없다');
}
const apKo = templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, 'ko', 'approved', {}).html;
ok(/월 1건/.test(apKo) && /프리미엄/.test(apKo), '풀레터 조건(프리미엄 월 1건)을 숨기지 않는다');
ok(/#mp-pullletters/.test(apKo), '풀레터 링크는 실제 신청 자리(마이페이지 풀레터)로 간다');

console.log('\n=== 문구 사전: 9개 언어, 같은 키 ===');
for (const [nm, D] of [['REPORT', REPORT], ['MONTHLY', MONTHLY]]) {
  const keys = Object.keys(D.ko);
  ok(LANGS.every((l) => D[l] && keys.every((k) => k in D[l])), nm + ': 9개 언어 모두 같은 키');
  const all = JSON.stringify(D);
  ok(!/보장|guarantee|garanti/i.test(all), nm + ': 없는 약속(보장)을 쓰지 않는다');
  ok(!/—|–/.test(D.ko ? JSON.stringify(D.ko) : ''), nm + ': 한국어 문구에 대시 없음 (도메니코 규칙)');
}

console.log('\n=== ② 성적표 규칙 (순수 함수) ===');
const NOW = Date.parse('2026-09-24T12:00:00Z');
const ed = (d, extra) => Object.assign({ status: 'published', source_submission_id: 's', published_date: d }, extra || {});
ok(!R.isReportDue(ed('2026-09-11'), NOW), '게재 13일: 아직');
ok(R.isReportDue(ed('2026-09-10'), NOW), '게재 14일: 보낸다');
ok(R.isReportDue(ed('2026-08-10'), NOW), '게재 45일: 보낸다');
ok(!R.isReportDue(ed('2026-08-09'), NOW), '게재 46일: 너무 오래됨');
ok(!R.isReportDue(ed('2026-09-01', { report_card_sent_at: '2026-09-20' }), NOW), '이미 보낸 화보는 다시 안 보낸다');
ok(!R.isReportDue(ed('2026-09-01', { report_card_attempts: 3 }), NOW), '3번 실패하면 포기');
ok(!R.isReportDue(ed('2026-09-01', { source_submission_id: null }), NOW), 'PAP 자체 화보(제출 아님)는 대상 아님');
ok(!R.isReportDue(ed('2026-09-01', { status: 'draft' }), NOW), '게재 전 화보는 대상 아님');
const ig = R.pickIgMetrics([{ reach: 100, like_count: 1 }, { reach: 23258, like_count: 2959, saved: 708, shares: 196 }, { reach: 0 }]);
ok(ig && ig.reach === 23258 && ig.likes === 2959, '인스타 게시물이 여럿이면 도달이 가장 큰 것');
ok(R.pickIgMetrics([]) === null && R.pickIgMetrics([{ reach: 0 }]) === null, '숫자가 없으면 null');
ok(R.worthSending(ig, 0) && R.worthSending(null, 20) && !R.worthSending(null, 19), '초라한 숫자만 있으면 보내지 않는다 (웹 20 미만 + 인스타 없음)');

console.log('\n=== ③ 월간 소식 규칙 ===');
ok(JSON.stringify(R.previousMonth(Date.parse('2026-10-01T01:00:00Z'))) === JSON.stringify({ key: '2026-09', start: '2026-09-01', end: '2026-10-01' }), '10/1 실행 → 9월');
ok(R.previousMonth(Date.parse('2027-01-01T01:00:00Z')).key === '2026-12', '1월 실행 → 전년 12월');
ok(R.monthRange('2026-13') === null && R.monthRange('x') === null && R.monthRange('2026-09').end === '2026-10-01', 'YYYY-MM 검증');
const eds = Array.from({ length: 8 }, (_, i) => ({ id: 'e' + i, slug: 's' + i, title: 't' + i, cover_image: 'i', ig: { reach: (i + 1) * 100 } }));
eds.push({ id: 'x', slug: '', title: 'no slug', cover_image: 'i', ig: { reach: 9999 } });
const pl = R.buildMonthlyPayload('2026-09', eds);
ok(pl.audience === 'creators' && pl.month === '2026-09', 'audience=creators');
ok(pl.totals.n === 9 && pl.totals.reach === 3600 + 9999, '합계는 전체로 센다');
ok(pl.items.length === 6 && pl.items[0].reach === 800 && pl.items.every((x) => x.slug), '카드는 주소 있는 것만, 도달 큰 순 6개');

console.log('\n=== 템플릿 렌더 ===');
const rc = templates.creatorReportCard({ name: 'Mina', title: 'Blue Hour', slug: 'blue-hour', days: 19, date: '2026-09-24', ig: { reach: 23258, likes: 2959, saved: 708, shares: 196 }, web: 110 }, 'ko');
ok(/23,258/.test(rc.html) && /2,959/.test(rc.html) && /110/.test(rc.html), '성적표에 도달·좋아요·웹 조회 숫자');
ok(/utm_source=creator_report_card/.test(rc.html) && /submission\.html/.test(rc.html), '성적표 CTA 는 다음 화보 제출 (utm)');
ok(/19일/.test(rc.subject), '제목에 게재 일수');
const rcNoIg = templates.creatorReportCard({ title: 'X', web: 40 }, 'en');
ok(!/Instagram reach/.test(rcNoIg.html) && /Website views/.test(rcNoIg.html), '인스타 숫자가 없으면 그 줄을 싣지 않는다');
const base = { payload: { month: '2026-09', totals: { n: 2, reach: 5000 }, items: [{ slug: 'a', title: '가나', title_en: 'Gana', image: 'https://x/y.jpg', reach: 4000 }] } };
const m1 = templates.creatorMonthly(base, { language: 'en' }, 'TOK');
ok(/unsubscribe\?token=TOK/.test(m1.html), '월간 소식에 수신거부 링크');
ok(!/Theme of the month/.test(m1.html), '테마를 비우면 테마 블록이 없다');
ok(/Gana/.test(m1.html) && !/가나/.test(m1.html), '영어 수신자에게는 영어 제목');
const m2 = templates.creatorMonthly(Object.assign({ hero_headline: 'Night', hero_body: 'Shoot the night.' }, base), { language: 'ko' }, 'TOK');
ok(/이달의 테마/.test(m2.html) && /Night/.test(m2.html) && /가나/.test(m2.html), '테마를 쓰면 블록이 붙고, 한국어 수신자는 한국어 제목');
ok(/2026년 9월/.test(m2.subject), '제목의 달 이름은 수신자 언어');
ok(!/<!--/.test(rc.html + m1.html + m2.html), '템플릿 문자열 안에 HTML 주석 없음 (CLAUDE.md 체크리스트)');

console.log('\n=== 크론 배선 ===');
const vj = JSON.parse(read('vercel.json'));
ok((vj.crons || []).some((c) => c.path === '/api/cron/creator-report-card' && /^\d+ \d+ \* \* \*$/.test(c.schedule)), '성적표 크론 매일 1회');
ok((vj.crons || []).some((c) => c.path === '/api/cron/creator-monthly' && c.schedule === '0 1 1 * *'), '월간 초안 크론 매월 1일');
const rcSrc = read('api/cron/creator-report-card.js');
ok(/withCronGuard\(CRON_NAME/.test(rcSrc) && /CRON_SECRET/.test(rcSrc) && /res\.locals = res\.locals \|\| \{\}/.test(rcSrc), '성적표 크론: 가드·비밀값·locals');
ok(/key', 'creator_report_card'\)/.test(rcSrc) && /value\.send === true/.test(rcSrc), '발송 스위치는 site_settings (기본 꺼짐)');
const firstSend = rcSrc.indexOf('await sendEmail(');
const previewGate = rcSrc.indexOf('if (!sendOn) {');
ok(previewGate > 0 && firstSend > previewGate, '꺼져 있으면 sendEmail 에 닿기 전에 돌아선다');
ok(/TIME_BUDGET_MS/.test(rcSrc) && /GAP_MS/.test(rcSrc), '한 통씩 간격을 두고, 시간 예산 안에서 멈춘다 (SMTP 421 대비)');
const cmSrc = read('api/cron/creator-monthly.js');
ok(/status: 'draft'/.test(cmSrc) && !/sendEmail/.test(cmSrc), '월간 크론은 draft 만 만들고 절대 보내지 않는다');
ok(/withCronGuard\(CRON_NAME/.test(cmSrc) && /CRON_SECRET/.test(cmSrc) && /res\.locals = res\.locals \|\| \{\}/.test(cmSrc), '월간 크론: 가드·비밀값·locals');
ok(/creator-monthly-' \+ range\.key/.test(cmSrc) && /eq\('name', name\)/.test(cmSrc), '같은 달 초안은 한 번만 (멱등)');
const sdc = read('api/cron/send-due-campaigns.js');
ok(/audience === 'creators'/.test(sdc) && /\.eq\('status', 'approved'\)/.test(sdc), '발송기: creators = 승인 크리에이터 ∩ 수신 동의');
ok(/'creator-monthly'\s*\n?\s*\? templates\.creatorMonthly/.test(sdc), '발송기: creator-monthly 템플릿 연결');
ok(/templates\.creatorMonthly/.test(read('api/admin/campaigns/[id]/send-test.js')), '테스트 발송도 creator-monthly 지원');
const adm = read('frontend/pap-admin-campaigns.js');
ok(/state\.existingPayload/.test(adm) && /payload = state\.existingPayload/.test(adm), '관리자 편집기가 크론이 만든 payload 를 덮어쓰지 않는다');
ok(/pap-admin-campaigns\.js\?v=5/.test(read('frontend/admin.html')), '관리자 캠페인 스크립트 캐시버스트');

(async () => {
console.log('\n=== 이달의 테마 후보 (기본 키워드 4개 고정 + 최신 트렌드, 포괄적으로, 고르는 건 도메니코) ===');
const T = require(path.join(ROOT, 'api/_lib/creatorTheme'));
ok(JSON.stringify(T.BASE_KEYWORDS) === JSON.stringify(['DREAMY', 'SURREALISM', 'STORYTELLING', 'CREATIVITY']), '기본 키워드 4개 (도메니코 2026-09-24 확정)');
ok(['2026-10', '2026-11', '2027-03'].every((m) => JSON.stringify(T.keywordsForMonth(m)) === JSON.stringify(T.BASE_KEYWORDS)), '달이 바뀌어도 기본 키워드는 그대로 (순환 폐기)');
ok(T.nextMonthKey('2026-09') === '2026-10' && T.nextMonthKey('2026-12') === '2027-01', '테마는 소식 다음 달(촬영할 달) 기준');
const fb = T.fallbackCandidates();
ok(fb.length === 3 && fb.every((c) => c.i18n.ko.title && c.i18n.en.title && c.keywords.every((k) => T.BASE_KEYWORDS.includes(k))), 'AI 없이도 기본 키워드 위의 후보 3개 (ko·en)');
ok(!/[—–]/.test(JSON.stringify(T.FALLBACK)), '고정 후보 문구에 대시 없음');
ok(!/소품|조명|로케이션|색을|컬러/.test(JSON.stringify(T.FALLBACK.map((f) => f.ko))), '고정 후보는 포괄적이다 (촬영 장치 지시 없음)');
const norm = T.normalizeCandidates({ candidates: [
  { keywords: ['dreamy', 'X'], trend: '경계 — 흐림', ko: { title: '가 — 나', body: '본문' }, en: { title: 'A', body: 'B' }, de: { title: 'D', body: 'E' } },
  { ko: { title: '영어 없음' } },
] });
ok(norm.length === 3 && norm[0].source === 'ai' && norm[1].source === 'fallback', '쓸 수 없는 후보는 버리고 고정 후보로 3개를 채운다');
ok(!/—/.test(norm[0].i18n.ko.title + norm[0].trend) && norm[0].keywords.join() === 'DREAMY', '모델 출력의 대시를 지우고, 없는 키워드는 버린다');
ok(T.parseRssTitles('<rss><item><title><![CDATA[Soft &amp; Strange]]></title></item><item><title>B</title></item></rss>', 'Dazed').join('|') === 'Dazed: Soft & Strange|Dazed: B', 'RSS 헤드라인 파싱');
const fakeDb = { from: () => ({ select: () => ({ gte: async () => ({ data: [{ items: [{ keywords: ['몽환', '레트로'] }, { keywords: ['몽환'] }] }] }) }) }) };
const rssFetch = async (u) => ({ ok: true, text: async () => '<item><title>' + u.slice(8, 20) + '</title></item>' });
const tr = await T.gatherTrendSignals({ fetch: rssFetch, supabase: fakeDb });
ok(tr.headlines.length === T.TREND_FEEDS.length && tr.keywords[0] === '몽환(2)', '트렌드 신호: 매체 헤드라인 + trend_reports 키워드 빈도');
const trFail = await T.gatherTrendSignals({ fetch: async () => { throw new Error('x'); }, supabase: { from: () => { throw new Error('y'); } } });
ok(Array.isArray(trFail.headlines) && trFail.headlines.length === 0 && trFail.keywords.length === 0, '트렌드 수집이 다 실패해도 throw 하지 않는다');
const _key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
const g0 = await T.generateThemeCandidates('2026-10', '', { trends: tr });
ok(g0.candidates.length === 3 && /고정/.test(g0.note), 'AI 키가 없으면 고정 후보 + 사유');
process.env.ANTHROPIC_API_KEY = 'test';
let sentBody = '';
const aiJson = { candidates: [0, 1, 2].map((i) => { const o = { keywords: [T.BASE_KEYWORDS[i]], trend: '흐름' + i }; for (const l of T.LANGS) o[l] = { title: l + i, body: 'b' + i }; return o; }) };
const fakeFetch = async (u, init) => { sentBody = init && init.body; return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(aiJson) }] }) }; };
const g1 = await T.generateThemeCandidates('2026-10', 'ctx', { fetch: fakeFetch, trends: tr });
ok(g1.candidates.length === 3 && g1.candidates.every((c) => c.source === 'ai' && c.i18n.ru && c.i18n.ja && c.trend), 'AI 후보 3개, 9개 언어, 읽은 흐름(trend) 포함');
ok(/몽환\(2\)/.test(sentBody) && /Dazed|Vogue|www\./.test(sentBody), '트렌드 신호가 실제로 프롬프트에 들어간다');
const g2 = await T.generateThemeCandidates('2026-10', 'ctx', { fetch: async () => { throw new Error('boom'); } });
ok(g2.candidates.length === 3 && /실패/.test(g2.note), 'AI 가 터져도 throw 하지 않고 고정 후보');
if (_key) process.env.ANTHROPIC_API_KEY = _key; else delete process.env.ANTHROPIC_API_KEY;
const pr = T.buildPrompt('2026-10', '', tr);
ok(/DREAMY · SURREALISM · STORYTELLING · CREATIVITY/.test(pr.system) && /매달 고정/.test(pr.system), '프롬프트: 기본 키워드 4개 고정');
ok(/포괄적/.test(pr.system) && /촬영 지시를 쓰지 않는다/.test(pr.system), '프롬프트: 구체적 지시 대신 포괄적 개념');
ok(/셀럽·브랜드·행사 뉴스 자체는 버리고/.test(pr.system), '프롬프트: 트렌드는 뉴스가 아니라 밑에 흐르는 흐름으로 읽는다');

const chosenTheme = { i18n: { ko: { title: '크기가 틀린 방', body: '소품' }, en: { title: 'Wrong Sizes', body: 'Prop' }, de: { title: 'Falsche Größen', body: 'Requisite' } } };
const withTheme = { hero_headline: '크기가 틀린 방', hero_body: '도메니코가 다듬은 문장', payload: Object.assign({}, base.payload, { theme: chosenTheme }) };
const tDe = templates.creatorMonthly(withTheme, { language: 'de' }, 'T');
ok(/Falsche Größen/.test(tDe.html) && !/도메니코가 다듬은/.test(tDe.html), '고른 후보: 독일어 수신자에게는 독일어 테마');
const tKo = templates.creatorMonthly(withTheme, { language: 'ko' }, 'T');
ok(/도메니코가 다듬은 문장/.test(tKo.html), '한국어 수신자에게는 편집기에서 다듬은 한국어가 우선');
const tFr = templates.creatorMonthly(withTheme, { language: 'fr' }, 'T');
ok(/Wrong Sizes/.test(tFr.html), '그 언어 번역이 없으면 영어 후보로');
const cmSrc2 = read('api/cron/creator-monthly.js');
ok(/theme_candidates = theme\.candidates/.test(cmSrc2) && /gatherTrendSignals/.test(cmSrc2) && /generateThemeCandidates\(themeMonth, context, \{ trends \}\)/.test(cmSrc2) && !/sendEmail/.test(cmSrc2), '월간 크론이 트렌드를 모아 후보를 만들고 초안에 담는다 (보내지는 않는다)');
const adm2 = read('frontend/pap-admin-campaigns.js');
ok(/function pickTheme/.test(adm2) && /pickTheme,/.test(adm2) && /theme_candidates/.test(adm2), '관리자 편집기에서 후보를 눌러 고른다');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
