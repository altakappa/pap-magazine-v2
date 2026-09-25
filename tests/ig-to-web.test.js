'use strict';
/**
 * 인스타 → 웹 (2026-09-25, 도메니코 "전부 적용하고 푸시해줘").
 * 실측: 팔로워 384,869 · 30일 IG→웹 클릭 214.
 *  1. /ig 프로필 링크 페이지 (받는 사람 언어 · 최신 화보 · 방문 기록 · CDN 캐시 없음)
 *  2. 화보 공개 순간 크리에이터에게 공유용 링크 메일 (한 번만 · 예약 공개는 cron 이)
 *  3. 댓글 키워드 → DM 으로 웹 링크 (기본 꺼짐 · 스팸 제외 · 한 댓글 한 번 · 권한 없으면 멈춤)
 *  4. 캡션: 에디토리얼 Full Story 링크에 utm (서버·어드민 미러 같게), 셀럽 브리프는 DM 켜졌을 때만 안내
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];
const stub = (rel, exp) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };

// 가짜 DB: from(t).select().eq().in().is().ilike().order().limit() + update/insert
function fakeDb(tables, opts) {
  const o = opts || {};
  const db = { tables, log: [] };
  db.from = (name) => {
    const st = { name, op: 'select', f: [], payload: null, lim: null };
    const rows = () => (db.tables[name] = db.tables[name] || []);
    const m = (r) => st.f.every(([op, k, v]) => op === 'eq' ? String(r[k]) === String(v)
      : op === 'in' ? v.map(String).includes(String(r[k]))
        : op === 'is' ? (r[k] == null) === (v == null)
          : op === 'ilike' ? String(r[k] || '').toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase()) : true);
    const run = () => {
      db.log.push({ name, op: st.op, payload: st.payload, f: st.f.slice() });
      if (o.failOn === name) return { data: null, error: { message: 'down' } };
      if (st.op === 'insert') { rows().push(Object.assign({}, st.payload)); return { data: [st.payload], error: null }; }
      if (st.op === 'update') { const hit = rows().filter(m); hit.forEach((r) => Object.assign(r, st.payload)); return { data: hit, error: null }; }
      let all = rows().filter(m); if (st.lim != null) all = all.slice(0, st.lim); return { data: all, error: null };
    };
    const b = {
      select() { return b; }, eq(k, v) { st.f.push(['eq', k, v]); return b; }, in(k, v) { st.f.push(['in', k, v]); return b; },
      is(k, v) { st.f.push(['is', k, v]); return b; }, ilike(k, v) { st.f.push(['ilike', k, v]); return b; },
      order() { return b; }, limit(n) { st.lim = n; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; }, update(p) { st.op = 'update'; st.payload = p; return b; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] || null : null, error: r.error }); },
      then(ok, bad) { return Promise.resolve(run()).then(ok, bad); },
    };
    return b;
  };
  return db;
}

(async () => {
  console.log('=== 1. /ig 페이지 ===');
  const logged = [];
  stub('api/_lib/supabase.js', { supabaseAdmin: fakeDb({}) });
  stub('api/_lib/socialInclick.js', { logSocialInclick: async (req, page) => { logged.push({ q: req.query, page }); } });
  const IGL = require(path.join(ROOT, 'api/ig-landing.js'));
  const { pickLang, IG_PAGE } = require(path.join(ROOT, 'api/_lib/igLandingCopy.js'));
  t('언어: ?lang → Accept-Language → 영어', pickLang('ja') === 'ja' && pickLang('', 'de-DE,de;q=0.9') === 'de' && pickLang('xx', 'zz') === 'en');
  t('문구 9개 언어', LANGS.every((l) => IG_PAGE[l] && IG_PAGE[l].newsletter && IG_PAGE[l].submit && IG_PAGE[l].member));
  const today = new Date().toISOString().slice(0, 10);
  const old = '2020-01-01';
  const db = fakeDb({
    editorials: [
      { id: 'e1', title: 'Milan, After Dark', slug: 'milan', cover_image: 'https://x/e1.png', view_count: 50, published_date: today, status: 'published' },
      { id: 'e2', title: 'Old One', slug: 'old', cover_image: 'https://x/e2.png', view_count: 999, published_date: old, status: 'published' },
      { id: 'e3', title: 'Hot', slug: 'hot', cover_image: 'https://x/e3.png', view_count: 90, published_date: today, status: 'published' },
      { id: 'e4', title: 'No image', slug: 'noimg', view_count: 5, published_date: today, status: 'published' },
    ],
    articles: [{ id: 'a1', title: '기사 하나', title_en: 'Article One', slug: 'a-one', thumbnail_url: 'https://x/a1.jpg', view_count: 3, published_date: today, status: 'published' }],
    seo_translations: [{ content_id: 'e1', kind: 'editorial', lang: 'ja', title: 'ミラノ、夜' }],
  });
  IGL._db = db; IGL._reset();
  const call = async (q, h) => { const res = { code: 0, body: '', headers: {} }; res.status = (c) => { res.code = c; return res; }; res.send = (s) => { res.body = s; return res; }; res.setHeader = (k, v) => { res.headers[k] = v; }; await IGL({ query: q || {}, headers: h || {} }, res); return res; };
  let r = await call({ lang: 'ko' });
  t('200 · CDN 캐시 없음(방문 기록이 빠지지 않게) · 검색 제외', r.code === 200 && r.headers['Cache-Control'] === 'no-store' && /noindex,follow/.test(r.body));
  t('최근 14일 조회수 순이 먼저 (Hot → Milan), 오래된 건 뒤, 이미지 없는 건 빠짐',
    r.body.indexOf('/editorial/hot') > 0 && r.body.indexOf('/editorial/hot') < r.body.indexOf('/editorial/milan') && r.body.indexOf('/editorial/milan') < r.body.indexOf('/editorial/old') && !r.body.includes('noimg'));
  t('한국어: 앞말 없는 주소 · 틀 문구 한국어 · 기사 한국어 제목', r.body.includes('https://www.pap-magazine.com/editorial/hot?utm_source=ig_bio') && r.body.includes('이번 주 PAP') && r.body.includes('매주 월요일 뉴스레터 받기') && r.body.includes('기사 하나'));
  t('모든 링크에 utm_source=ig_bio', (r.body.match(/href="https:\/\/www\.pap-magazine\.com[^"]*"/g) || []).every((h) => /utm_source=ig_bio/.test(h)));
  t('방문 기록: src ig · campaign bio', logged.length === 1 && logged[0].q.utm_source === 'ig' && logged[0].q.utm_campaign === 'bio');
  r = await call({}, { 'accept-language': 'ja-JP' });
  t('일본어: /ja/ 주소 · 번역 제목 · 틀 일본어', r.body.includes('/ja/editorial/milan') && r.body.includes('ミラノ、夜') && r.body.includes('今週のPAP') && r.body.includes('<html lang="ja">'));
  const koTxt = (await call({ lang: 'ko' })).body.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');
  t('한국어 페이지에 영어 틀 문구 없음', !/THIS WEEK|EDITORIAL|ARTICLE|newsletter|Submit/.test(koTxt));
  IGL._db = fakeDb({}, { failOn: 'editorials' }); IGL._reset();
  const origErr = console.error; console.error = () => {};
  r = await call({ lang: 'en' });
  console.error = origErr;
  t('목록 조회 실패해도 200 (버튼은 보인다)', r.code === 200 && r.body.includes('Get the Monday newsletter'));
  const vj = JSON.parse(R('vercel.json'));
  t('vercel.json: /ig → /api/ig-landing (기존 /ig/:src 와 별개)', vj.rewrites.some((x) => x.source === '/ig' && x.destination === '/api/ig-landing') && vj.rewrites.some((x) => x.source === '/ig/:src'));

  console.log('\n=== 2. 화보 공개 알림 ===');
  const EL = require(path.join(ROOT, 'api/_lib/editorialLive.js'));
  const now = Date.parse('2026-09-25T12:00:00Z');
  t('지금 보이는가: 예약 없음·지남 = 예, 미래 예약 = 아니오, 비공개 = 아니오',
    EL.isLiveNow({ status: 'published' }, now) && EL.isLiveNow({ status: 'published', scheduled_publish_at: '2026-09-25T11:00:00Z' }, now)
    && !EL.isLiveNow({ status: 'published', scheduled_publish_at: '2026-09-26T00:00:00Z' }, now) && !EL.isLiveNow({ status: 'draft' }, now));
  t('공유 링크: 언어 앞말 + utm creator_share', EL.shareUrl('blue', 'ko') === 'https://www.pap-magazine.com/editorial/blue?utm_source=creator_share&utm_medium=social&utm_campaign=ed-blue' && EL.shareUrl('blue', 'en').startsWith('https://www.pap-magazine.com/en/editorial/blue?'));
  const mails = [];
  const { templates } = require(path.join(ROOT, 'api/_lib/email.js'));
  const deps = (d, ok) => ({ db: d, templates, now, resolveEmailLang: (p) => p.language || 'en', sendEmail: async (to, tpl) => { mails.push({ to, tpl }); return ok === false ? { sent: false, error: 'x' } : { sent: true }; } });
  const mkDb = () => fakeDb({ editorials: [{ id: 'ed1', live_email_sent_at: null }], submissions: [{ id: 's1', user_id: 'u1' }], profiles: [{ id: 'u1', email: 'c@x.y', display_name: 'Mina', language: 'ko' }] });
  const row = { id: 'ed1', status: 'published', slug: 'blue', title: 'Blue Hour', source_submission_id: 's1' };
  let d = mkDb();
  let out = await EL.sendEditorialLiveMail(row, deps(d));
  t('보냄: 크리에이터 언어 · 제목 · 공유 링크 · 도장', out.sent === true && mails[0].to === 'c@x.y' && mails[0].tpl.subject === '"Blue Hour" 화보가 PAP에 공개되었습니다'
    && mails[0].tpl.html.includes('utm_source=creator_share') && !!d.tables.editorials[0].live_email_sent_at);
  out = await EL.sendEditorialLiveMail(row, deps(d));
  t('두 번째는 안 보냄 (도장)', out.skipped === 'already_sent' && mails.length === 1);
  out = await EL.sendEditorialLiveMail(Object.assign({}, row, { scheduled_publish_at: '2099-01-01T00:00:00Z' }), deps(mkDb()));
  t('예약 공개 전이면 안 보냄 (cron 이 공개 때)', out.skipped === 'not_live' && mails.length === 1);
  out = await EL.sendEditorialLiveMail(Object.assign({}, row, { source_submission_id: null }), deps(mkDb()));
  t('서브미션에서 온 화보가 아니면 안 보냄', out.skipped === 'no_submission');
  d = mkDb();
  out = await EL.sendEditorialLiveMail(row, deps(d, false));
  t('발송 실패 → 도장 되돌림 (다음에 다시 시도)', out.sent === false && d.tables.editorials[0].live_email_sent_at === null);
  t('메일 9개 언어', LANGS.every((l) => { const m = templates.editorialLive({ name: 'A' }, { title: 'T', url: 'https://x' }, l); return m.subject && m.html.includes('https://x'); }));
  const put = R('api/editorials/[id].js');
  t('관리자 공개(PUT) 순간에 부른다 (텔레그램 전송 다음)', /await dispatchTelegramEditorial\(data\);[\s\S]{0,200}await sendEditorialLiveMail\(data, \{ db: supabaseAdmin, sendEmail, templates, resolveEmailLang \}\)/.test(put));
  const cr = R('api/cron/release-due-scheduled.js');
  t('예약 공개 cron 이 에디토리얼 공개 때 부른다 (필요한 칸을 읽는다)', /type === 'editorial' \? 'id, title, slug, status, scheduled_publish_at, source_submission_id'/.test(cr) && /if \(type === 'editorial'\) \{\s*for \(const row of fresh\)[\s\S]{0,120}sendEditorialLiveMail\(row/.test(cr));
  t('마이그레이션 170: live_email_sent_at', /add column if not exists live_email_sent_at timestamptz/.test(R('supabase_migrations/170_editorial_live_email.sql')));

  console.log('\n=== 3. 댓글 → DM ===');
  const DM = require(path.join(ROOT, 'api/_lib/igCommentDm.js'));
  t('키워드: CREDITS·크레딧·リンク 는 잡고 incredible 은 안 잡음', DM.matchKeyword('CREDITS please!') && DM.matchKeyword('크레딧 알려주세요') && DM.matchKeyword('リンクください') && !DM.matchKeyword('incredible work'));
  t('언어 짐작', DM.guessLang('링크') === 'ko' && DM.guessLang('リンク') === 'ja' && DM.guessLang('链接') === 'zh' && DM.guessLang('ссылка') === 'ru' && DM.guessLang('link pls') === 'en');
  const old2 = process.env.IG_DM_ENABLED;
  delete process.env.IG_DM_ENABLED;
  const rowsIn = [
    { comment_id: 'c1', media_id: 'm1', text: 'CREDITS', score: 0, posted_at: new Date(now - 3600e3).toISOString(), username: 'a' },
    { comment_id: 'c2', media_id: 'm2', text: '링크 주세요', score: 0, posted_at: new Date(now - 3600e3).toISOString() },
    { comment_id: 'c3', media_id: 'm1', text: 'link in my bio for 18+', score: 90, posted_at: new Date(now - 3600e3).toISOString() },
    { comment_id: 'c4', media_id: 'm1', text: 'credits', score: 0, posted_at: new Date(now - 8 * 86400e3).toISOString() },
    { comment_id: 'c5', media_id: 'm3', text: 'link', score: 0, posted_at: new Date(now - 3600e3).toISOString() },
    { comment_id: 'c6', media_id: 'm1', text: 'beautiful', score: 0 },
  ];
  const media = [{ id: 'm1', permalink: 'https://www.instagram.com/p/ABC123/' }, { id: 'm2', permalink: 'https://www.instagram.com/reel/XYZ/' }, { id: 'm3', permalink: 'https://www.instagram.com/p/NOPE/' }];
  const sent = [];
  const send = async (cid, text) => { sent.push({ cid, text }); return { ok: true }; };
  let res1 = await DM.runCommentDms({ db: fakeDb({}), rows: rowsIn, media, threshold: 60, now, send });
  t('기본 꺼짐: 아무것도 안 보냄', res1.enabled === false && sent.length === 0);
  process.env.IG_DM_ENABLED = '1';
  const ddb = fakeDb({
    articles: [{ slug: 'art-1', status: 'published', source_instagram_post_id: 'm2' }],
    editorials: [{ slug: 'ed-abc', status: 'published', source_instagram_url: 'https://www.instagram.com/p/ABC123/' }],
    ig_comment_dms: [{ comment_id: 'c5', status: 'sent' }],
  });
  res1 = await DM.runCommentDms({ db: ddb, rows: rowsIn, media, threshold: 60, now, send });
  t('키워드 댓글만 · 스팸 제외 · 7일 지난 것 제외 · 이미 보낸 것 제외', JSON.stringify(sent.map((s) => s.cid)) === JSON.stringify(['c1', 'c2']));
  t('영어 댓글 → 그 게시물의 화보 주소(/en/editorial/ed-abc) + utm ig_dm', sent[0].text.startsWith('Thanks for your comment') && sent[0].text.includes('https://www.pap-magazine.com/en/editorial/ed-abc?utm_source=ig_dm'));
  t('한국어 댓글 → 게시물 번호로 찾은 기사 (앞말 없음) · 한국어 문구', sent[1].text.startsWith('댓글 고마워요') && sent[1].text.includes('https://www.pap-magazine.com/article/art-1?utm_source=ig_dm'));
  t('보낸 기록이 남는다 (한 댓글 한 번)', ddb.tables.ig_comment_dms.filter((x) => x.status === 'sent').length === 3);
  const u3 = await DM.targetUrl(fakeDb({}), { id: 'zz', permalink: 'https://www.instagram.com/p/NONE/' }, 'ja');
  t('연결된 글이 없으면 /ig (그 언어)', u3.startsWith('https://www.pap-magazine.com/ig?lang=ja&utm_source=ig_dm'));
  sent.length = 0;
  const denied = [];
  const res2 = await DM.runCommentDms({ db: fakeDb({}), rows: rowsIn, media, threshold: 60, now, send: async (cid) => { denied.push(cid); return { ok: false, permission: true, error: '(#10) permission' }; } });
  t('권한 없음 → 한 번 시도하고 멈춤, 사유 남김', denied.length === 1 && /permission/.test(res2.stopped));
  if (old2 === undefined) delete process.env.IG_DM_ENABLED; else process.env.IG_DM_ENABLED = old2;
  const scan = R('api/cron/ig-comment-scan.js');
  t('스팸 수집 크론에 붙어 있고 dry 에선 안 보냄', /if \(!dry\) \{\s*try \{ dmResult = await runCommentDms\(\{ db: supabaseAdmin, rows, media: targets, threshold: THRESHOLD \}\)/.test(scan));
  t('마이그레이션 171: ig_comment_dms (댓글 id 기본키 · RLS)', /comment_id\s+text primary key/.test(R('supabase_migrations/171_ig_comment_dms.sql')) && /enable row level security/.test(R('supabase_migrations/171_ig_comment_dms.sql')));

  console.log('\n=== 4. 캡션 ===');
  t('서버 캡션 빌더 · 어드민 미러 모두 Full Story 링크에 utm', /editorial\/' \+ slug \+ '\?utm_source=ig&utm_campaign=caption'/.test(R('api/_lib/igCaption.js')) && /editorial\/' \+ _fsSlug \+ '\?utm_source=ig&utm_campaign=caption'/.test(R('frontend/pap-admin.js')));
  t('어드민 스크립트 캐시 번호 올림 (v=163)', R('frontend/admin.html').includes('/pap-admin.js?v=163'));
  const cb = require(path.join(ROOT, 'api/_lib/celebBrief.js'));
  delete process.env.IG_DM_ENABLED;
  const capOff = cb.buildBriefCaption({ hook: 'H', bodyKo: '한', bodyEn: 'E' });
  process.env.IG_DM_ENABLED = '1';
  const capOn = cb.buildBriefCaption({ hook: 'H', bodyKo: '한', bodyEn: 'E' });
  delete process.env.IG_DM_ENABLED;
  t('셀럽 브리프: DM 켜졌을 때만 "댓글에 링크" 안내', !/DM/.test(capOff) && /댓글에 '링크'/.test(capOn));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
