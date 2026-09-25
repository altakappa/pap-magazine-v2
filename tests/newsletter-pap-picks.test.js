'use strict';
/**
 * 주간 뉴스레터 맨 위 "THIS WEEK ON PAP" (2026-09-25, 도메니코 "화보·기사 5개 + 외부 트렌드 뉴스 10개").
 * 실측: 뉴스 카드에는 출처도 링크도 없어 뉴스레터→PAP 클릭이 주 1~4회였다.
 *
 *  1. 고르기: 지난 7일 게재분, 화보 3 + 기사 2, 한쪽이 모자라면 다른 쪽으로 5개 채움 (가짜 DB 로 실행)
 *  2. 조회 실패해도 뉴스레터는 나간다 (빈 배열)
 *  3. 템플릿: 링크 전부 PAP + utm_campaign=회차명, 제목은 수신자 언어(화보는 작품명 그대로)
 *  4. papItems 없는 옛 캠페인은 예전 모양 그대로
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

function fakeDb(rows, opts) {
  const seen = [];
  function q(table) {
    const st = { table, filters: [] };
    const b = {
      select() { return b; }, eq(k, v) { st.filters.push(['eq', k, v]); return b; }, gte(k, v) { st.filters.push(['gte', k, v]); return b; },
      in(k, v) { st.filters.push(['in', k, v]); return b; }, order() { return b; }, limit() { return b; },
      then(ok, bad) {
        seen.push(st);
        if (opts && opts.throwOn === table) return Promise.reject(new Error('boom')).then(ok, bad);
        return Promise.resolve({ data: rows[table] || [], error: null }).then(ok, bad);
      },
    };
    return b;
  }
  return { from: q, seen };
}
const stub = (rel, exp) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
function loadCron(db) {
  const p = require.resolve(path.join(ROOT, 'api/cron/weekly-news.js'));
  delete require.cache[p];
  stub('api/_lib/supabase.js', { supabaseAdmin: db });
  stub('api/_lib/cronGuard.js', { withCronGuard: (_n, fn) => fn });
  return require(p);
}

(async () => {
  console.log('=== 1. 고르기 ===');
  {
    const db = fakeDb({
      editorials: [
        { id: 'e1', title: 'Milan, After Dark', slug: 'milan-after-dark', cover_image: 'https://x/e1.png' },
        { id: 'e2', title: 'No Image', slug: 'no-image' },
      ],
      articles: [1, 2, 3, 4, 5].map((i) => ({ id: 'a' + i, title: '기사' + i, title_en: 'Article ' + i, slug: 'a-' + i, thumbnail_url: 'https://x/a' + i + '.jpg' })),
      seo_translations: [{ content_id: 'a1', lang: 'ja', title: '記事1' }],
    });
    const cron = loadCron(db);
    const picks = await cron.papPicks();
    t('5개', picks.length === 5, picks.length);
    t('이미지 없는 화보는 뺀다 → 화보 1 + 기사 4 로 채움', picks.filter((p) => p.kind === 'editorial').length === 1 && picks.filter((p) => p.kind === 'article').length === 4);
    t('화보가 먼저', picks[0].kind === 'editorial');
    t('링크는 PAP 화보·기사 주소', picks[0].url === 'https://www.pap-magazine.com/editorial/milan-after-dark' && picks[1].url === 'https://www.pap-magazine.com/article/a-1');
    t('기사 제목: ko 원문 · en title_en · ja 번역', picks[1].titles.ko === '기사1' && picks[1].titles.en === 'Article 1' && picks[1].titles.ja === '記事1');
    t('화보 제목은 작품명 그대로(_)', picks[0].titles._ === 'Milan, After Dark' && !picks[0].titles.ja);
    const ed = db.seen.find((s) => s.table === 'editorials');
    t('게재 상태 + 지난 7일만', ed.filters.some((f) => f[0] === 'eq' && f[1] === 'status' && f[2] === 'published') && ed.filters.some((f) => f[0] === 'gte' && f[1] === 'published_date'));
    t('기본 비율 화보 3 · 기사 2', cron.PAP_PICKS.editorials === 3 && cron.PAP_PICKS.articles === 2 && cron.PAP_PICKS.total === 5);
  }

  {
    const src = require('fs').readFileSync(path.join(ROOT, 'api/cron/weekly-news.js'), 'utf8');
    t('핸들러가 papPicks 를 불러 payload.papItems 에 싣는다', /const papRaw = await papPicks\(\);/.test(src) && /const papItems = mergePapTitles\(papRaw, papTr\);/.test(src) && /\bpapItems,\s*\/\/ 2026-09-25/.test(src));
  }
  console.log('\n=== 2. 조회 실패 ===');
  {
    const cron = loadCron(fakeDb({}, { throwOn: 'editorials' }));
    const picks = await cron.papPicks();
    t('실패하면 빈 배열 (뉴스레터는 나간다)', Array.isArray(picks) && picks.length === 0);
  }

  console.log('\n=== 3. 템플릿 ===');
  const emailPath = require.resolve(path.join(ROOT, 'api/_lib/email.js'));
  delete require.cache[emailPath];
  const { templates } = require(emailPath);
  const papItems = [
    { kind: 'editorial', url: 'https://www.pap-magazine.com/editorial/e1', image: 'https://igcazquhkwxtqsaqpznx.supabase.co/storage/v1/object/public/media/e1.png', titles: { _: 'Milan, After Dark' } },
    { kind: 'article', url: 'https://www.pap-magazine.com/article/a1', image: 'https://x/a1.jpg', titles: { ko: '기사 한국어', en: 'Article EN', ja: '記事', _: 'Article EN' } },
  ];
  const newsItems = [{ title: 'News', summary: 'S', category: 'ART', url: 'https://www.vogue.com/x', image: '' }];
  const mk = (payload) => ({ name: 'news-weekly-2026-09-27', subject: 's', preheader: 'p', payload: Object.assign({ issueLabel: 'Weekly Briefing', headerDate: 'Sep 28', newsItems, i18n: { en: { subject: 's', newsItems } } }, payload) });
  const ko = templates.weeklyNews(mk({ papItems }), { language: 'ko' }, 'TOK').html;
  const ja = templates.weeklyNews(mk({ papItems }), { language: 'ja' }, 'TOK').html;
  const it = templates.weeklyNews(mk({ papItems }), { language: 'it' }, 'TOK').html;
  // 2026-09-25 틀 문구가 받는 사람 언어로 바뀜 (newsletter-one-language.test.js): ko = 이번 주 PAP · 트렌드 브리핑
  t('이번 주 PAP 이 뉴스보다 위', ko.indexOf('이번 주 PAP') > 0 && ko.indexOf('이번 주 PAP') < ko.indexOf('트렌드 브리핑') && ko.indexOf('트렌드 브리핑') < ko.indexOf('>News<'));
  t('PAP 링크 + utm_source=newsletter + utm_campaign=회차명', /href="https:\/\/www\.pap-magazine\.com\/editorial\/e1\?utm_source=newsletter&utm_medium=email&utm_campaign=news-weekly-2026-09-27"/.test(ko));
  t('이미지는 /api/img 프록시', /src="https:\/\/www\.pap-magazine\.com\/api\/img\?u=https%3A%2F%2Figcazquhkwxtqsaqpznx/.test(ko));
  t('제목 언어: ko 한국어 · ja 번역 · it 은 en 으로', />기사 한국어</.test(ko) && />記事</.test(ja) && />Article EN</.test(it));
  t('번역이 없는 화보 제목은 원제로 떨어진다 (생성 크론이 9개 언어를 채우는 게 정상 경로)', />Milan, After Dark</.test(ko) && />Milan, After Dark</.test(ja));
  t('외부 매체 링크는 없다 (뉴스 카드는 여전히 텍스트)', !/href="https:\/\/www\.vogue\.com/.test(ko));
  const old = templates.weeklyNews(mk({}), { language: 'ko' }, 'TOK').html;
  t('papItems 없는 옛 캠페인: 블록 없음', !/이번 주 PAP|THIS WEEK ON PAP/.test(old) && !/트렌드 브리핑|TREND BRIEFING/.test(old) && />News</.test(old));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ newsletter-pap-picks FAILED'); process.exit(1); }
  console.log('✅ newsletter-pap-picks passed');
})().catch((e) => { console.error(e); process.exit(1); });
