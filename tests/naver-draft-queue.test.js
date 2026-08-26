/**
 * 네이버 초안 — 큐 상한 · TTL 만료 · 최신 우선 (2026-08-05 신설)
 *
 * 왜 필요했나 — 14일 실측:
 *   생성 124건 / 발행 76건 → 하루 +3.4건씩 쌓여 대기 58건.
 *   가장 오래된 초안은 16일 묵었다. 네이버는 글쓰기 API 가 없어 붙여넣기가
 *   사람 손이라, 넘치는 만큼은 **처음부터 돈만 쓰고 버려지는 초안**이었다.
 *
 * 도메니코 지시(2026-08-05): 7일 만료 · 큐 차면 생성 중단 · 최신 기사부터.
 *
 * 여기서 지키는 것:
 *   ① 만료를 생성보다 **먼저** 돌 것 (자리를 비운 뒤 상한을 잰다)
 *   ② 만료는 DELETE 가 아니라 status='expired' UPDATE 일 것 (되돌릴 수 있게)
 *   ③ 만료는 status='draft' 인 것만 건드릴 것 (posted 를 지우면 대형 사고)
 *   ④ 큐가 상한 이상이면 생성 0건 + skipped='queue_full'
 *   ⑤ 상한까지 남은 자리보다 많이 만들지 말 것
 *   ⑥ TTL=0 이면 만료하지 않을 것 (끌 수 있어야 한다)
 *   ⑦ 선정 순서가 '최신부터'일 것 · NAVER_DRAFT_ORDER=oldest 로 복귀 가능
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRON = path.join(ROOT, 'api', 'cron', 'naver-draft-sweep.js');
const ADMIN = path.join(ROOT, 'api', 'admin', 'naver-blog-draft.js');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}
function inject(p, exports) {
  const m = new Module(p, null);
  m.filename = p; m.loaded = true; m.exports = exports;
  require.cache[p] = m;
}

/* ── supabase 목 — 체인이 thenable 이라 실제 호출 순서를 기록한다 ────── */
function makeSupabase(state) {
  const calls = state.calls = [];
  return {
    from(table) {
      const ctx = { table, op: null, eq: {}, lt: null, payload: null, _done: false };
      let resolver = () => ({ data: null, error: null });
      const chain = {
        select(_col, opt) {
          if (opt && opt.head) { ctx.op = 'count'; resolver = () => ({ count: state.queue }); }
          else {
            const n = state.expirable || 0;
            resolver = () => ({ data: Array.from({ length: n }, (_, k) => ({ id: k + 1 })), error: null });
          }
          return chain;
        },
        update(payload) { ctx.op = 'update'; ctx.payload = payload; return chain; },
        delete() { ctx.op = 'delete'; return chain; },
        eq(k, v) { ctx.eq[k] = v; return chain; },
        lt(k, v) { ctx.lt = { k, v }; return chain; },
        then(onOk, onErr) {
          if (!ctx._done) { ctx._done = true; calls.push(ctx); }   // await 시점 = 실제 실행 순서
          try { return Promise.resolve(resolver()).then(onOk, onErr); }
          catch (e) { return Promise.reject(e).then(onOk, onErr); }
        },
      };
      return chain;
    },
  };
}

function loadCron(state, genImpl) {
  delete require.cache[CRON];
  inject(path.join(ROOT, 'api', '_lib', 'supabase.js'), { supabaseAdmin: makeSupabase(state) });
  inject(path.join(ROOT, 'api', '_lib', 'cronGuard.js'), { withCronGuard: (_n, h) => h });
  inject(ADMIN, { generateNext: genImpl });
  return require(CRON);
}

function runHandler(handler, env) {
  const saved = {};
  Object.keys(env).forEach((k) => { saved[k] = process.env[k]; process.env[k] = env[k]; });
  process.env.CRON_SECRET = 'S';
  const req = { headers: { authorization: 'Bearer S' } };
  let body = null;
  const res = { locals: {}, status() { return res; }, json(b) { body = b; return res; } };
  return handler(req, res).then(() => {
    Object.keys(saved).forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
    return { body, note: res.locals.cronNote };
  });
}

(async function main() {
  console.log('[1] 만료 — 순서·방식·대상');
  {
    const state = { queue: 5, expirable: 3 };
    let made = 0;
    const cron = loadCron(state, async () => { made++; return { done: false, slug: 's' + made, draft: { title: 'T' } }; });
    const r = await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '7', NAVER_DRAFT_QUEUE_MAX: '30' });

    const ops = state.calls.map((c) => c.op);
    t('만료(update)가 큐 세기(count)보다 먼저 온다', ops.indexOf('update') >= 0 && ops.indexOf('update') < ops.indexOf('count'), ops);
    const up = state.calls.find((c) => c.op === 'update');
    t('DELETE 가 아니라 UPDATE 다', !ops.includes('delete'), ops);
    t("status='expired' 로 내린다", up && up.payload && up.payload.status === 'expired', up && up.payload);
    t("status='draft' 인 것만 대상", up && up.eq.status === 'draft', up && up.eq);
    t('brand/kind 로 좁힌다', up && up.eq.brand === 'pap' && up.eq.kind === 'article', up && up.eq);
    t('created_at 기준 cutoff 를 쓴다', !!(up && up.lt && up.lt.k === 'created_at'), up && up.lt);
    t('만료 건수가 응답에 실린다', r.body.expired === 3, r.body.expired);
    t('note 에 만료가 보인다', /만료 3건/.test(r.note), r.note);
  }

  console.log('[2] TTL=0 이면 만료하지 않는다');
  {
    const state = { queue: 5, expirable: 3 };
    const cron = loadCron(state, async () => ({ done: true }));
    const r = await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '0', NAVER_DRAFT_QUEUE_MAX: '30' });
    t('update 호출 없음', !state.calls.some((c) => c.op === 'update'), state.calls.map((c) => c.op));
    t('expired 0', r.body.expired === 0, r.body.expired);
  }

  console.log('[3] 큐 상한 — 가득 차면 생성을 건너뛴다');
  {
    const state = { queue: 30, expirable: 0 };
    let made = 0;
    const cron = loadCron(state, async () => { made++; return { done: false, slug: 'x', draft: { title: 'T' } }; });
    const r = await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '7', NAVER_DRAFT_QUEUE_MAX: '30' });
    t('생성 함수를 한 번도 안 부른다', made === 0, made);
    t("skipped='queue_full'", r.body.skipped === 'queue_full', r.body.skipped);
    t('note 에 상한 도달이 보인다', /상한 도달/.test(r.note), r.note);
  }

  console.log('[4] 상한까지 남은 자리만큼만 만든다');
  {
    const state = { queue: 28, expirable: 0 };   // 상한 30 → 남은 자리 2, 회당 상한 4
    let made = 0;
    const cron = loadCron(state, async () => { made++; return { done: false, slug: 'x' + made, draft: { title: 'T' } }; });
    const r = await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '7', NAVER_DRAFT_QUEUE_MAX: '30', NAVER_DRAFT_DAILY_MAX: '4' });
    t('4건이 아니라 2건만 만든다', made === 2, made);
    t('응답 generated 도 2', r.body.generated === 2, r.body.generated);
  }

  console.log('[5] 상한 여유가 충분하면 회당 상한(4건)까지 만든다');
  {
    const state = { queue: 0, expirable: 0 };
    let made = 0;
    const cron = loadCron(state, async () => { made++; return { done: false, slug: 'x' + made, draft: { title: 'T' } }; });
    await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '7', NAVER_DRAFT_QUEUE_MAX: '30', NAVER_DRAFT_DAILY_MAX: '4' });
    t('4건 만든다', made === 4, made);
  }

  console.log('[6] 선정 순서 — 소스에서 실제 식을 꺼내 평가한다');
  {
    const src = fs.readFileSync(ADMIN, 'utf8');
    /* 2026-08-14 — 선정에 '자체 취재 우선'(own/pool)이 끼어들었다.
       이 테스트의 방식(소스에서 식을 꺼내 실제로 평가)은 그대로 두되,
       꺼내는 범위를 네 줄로 넓힌다. 식을 손으로 베껴 적으면 소스와 갈라져
       테스트가 거짓말을 하게 되므로, 계속 소스에서 꺼내는 게 핵심이다. */
    /* 2026-08-26 — 선정에 '아트 기사만'(artOnly/base)이 추가됐다 (도메니코 지시).
       추출 범위를 그만큼 넓힌다. 계속 소스에서 꺼내는 게 핵심이다. */
    const m = src.match(/const oldestFirst = ([^;]+);[\s\S]*?const artOnly = ([^;]+);\s*const base = ([^;]+);\s*if \(!base\.length\) return [^;]+;\s*const own = ([^;]+);\s*const pool = ([^;]+);\s*const next = ([^;]+);/);
    t('선정 식을 찾았다', !!m, m && m[6]);
    if (m) {
      // artOnlyEnabled 도 소스에서 꺼낸다 — 손으로 베끼면 소스와 갈라진다
      const fnm = src.match(/function artOnlyEnabled\(\) \{([\s\S]*?)\n\}/);
      t('artOnlyEnabled 를 소스에서 찾았다', !!fnm);
      const pick = new Function('process', 'pending', 'kind',
        'function artOnlyEnabled() {' + fnm[1] + '}\n'
        + 'kind = kind || \'article\'; const oldestFirst = ' + m[1] + '; const artOnly = ' + m[2]
        + '; const base = ' + m[3] + '; if (!base.length) return null; const own = ' + m[4]
        + '; const pool = ' + m[5] + '; const next = ' + m[6] + '; return next;');
      // 아트 필터가 기본값이므로 기존 순서 검증 픽스처에는 art:true 를 준다
      const A = (o) => Object.assign({ art: true }, o);
      const pending = [A({ slug: 'oldest' }), A({ slug: 'mid' }), A({ slug: 'newest' })]; // 발행 오름차순
      t('기본값은 최신부터', pick({ env: {} }, pending).slug === 'newest', pick({ env: {} }, pending));
      t('ORDER=oldest 면 옛 동작', pick({ env: { NAVER_DRAFT_ORDER: 'oldest' } }, pending).slug === 'oldest');
      t('대문자도 먹는다', pick({ env: { NAVER_DRAFT_ORDER: 'OLDEST' } }, pending).slug === 'oldest');
      t('1건뿐이면 그걸 고른다', pick({ env: {} }, [A({ slug: 'only' })]).slug === 'only');

      // 자체 취재(🎥 PAP)가 있으면 더 최신이어도 그쪽을 먼저 고른다
      const mixed = [A({ slug: 'own-old', own: true }), A({ slug: 'plain-mid' }), A({ slug: 'plain-new' })];
      t('자체 취재를 최신보다 먼저 고른다',
        pick({ env: {} }, mixed).slug === 'own-old', pick({ env: {} }, mixed));
      const twoOwn = [A({ slug: 'own-old', own: true }), A({ slug: 'plain' }), A({ slug: 'own-new', own: true })];
      t('자체 취재가 여럿이면 그 안에서 최신',
        pick({ env: {} }, twoOwn).slug === 'own-new', pick({ env: {} }, twoOwn));
      t('자체 취재 안에서도 ORDER=oldest 가 먹는다',
        pick({ env: { NAVER_DRAFT_ORDER: 'oldest' } }, twoOwn).slug === 'own-old');
      // 폴백이 없으면 캡션이 채워지는 3일 동안 생성이 통째로 멎는다
      t('자체 취재가 없으면 전체에서 고른다',
        pick({ env: {} }, pending).slug === 'newest');

      // 아트 필터 (2026-08-26): 아트 기사만 초안화, 비아트는 최신이어도 건너뜀
      const artMix = [A({ slug: 'art-old' }), { slug: 'celeb-mid' }, { slug: 'celeb-new' }];
      t('아트 기사가 비아트 최신보다 먼저다',
        pick({ env: {} }, artMix).slug === 'art-old', pick({ env: {} }, artMix));
      t('아트 기사가 없으면 만들지 않는다 (null)',
        pick({ env: {} }, [{ slug: 'celeb-1' }, { slug: 'celeb-2' }]) === null);
      t('ART_ONLY=false 면 전체에서 고른다',
        pick({ env: { NAVER_DRAFT_ART_ONLY: 'false' } }, artMix).slug === 'celeb-new');
      t('에디토리얼 kind 는 아트 필터를 안 탄다',
        pick({ env: {} }, [{ slug: 'ed-1' }], 'editorial').slug === 'ed-1');
    }
  }

  console.log('[9] 아트 판별 — 소스에서 함수를 꺼내 실행한다 (2026-08-26)');
  {
    const src = fs.readFileSync(ADMIN, 'utf8');
    const fm = src.match(/const ART_TERMS = \[([\s\S]*?)\];\s*function isArtArticle\(title, caption\) \{([\s\S]*?)\n\}/);
    t('isArtArticle 을 찾았다', !!fm);
    if (fm) {
      const isArt = new Function('title', 'caption', 'const ART_TERMS = [' + fm[1] + '];' + fm[2]);
      t('조각 작가 기사 = 아트', isArt('매트 존슨, 폐컨테이너로 명상하는 조각을 만들다', '') === true);
      t('전시 기사 = 아트', isArt('서울 아트위크, 페어 밖 아홉 개의 전시', '') === true);
      t('영문 exhibition 도 아트', isArt('', 'A new exhibition opens in Seoul') === true);
      t('셀럽 컴백 기사 = 비아트', isArt('넥스지 컴백, SAUCIN 활동 중 N잡러 변신 영상 화제', '') === false);
      t('뮤비 티저 기사 = 비아트', isArt('제니 신곡 뮤비 티저, 청량 로맨틱 스타일링이 이미 화제', '') === false);
      t('빈 입력에 안 터진다', isArt(null, undefined) === false);
    }
  }

  console.log('[7] TTL 유예(램프) — 2026-08-12 전에는 14일, 그 뒤 7일');
  {
    const state = { queue: 0, expirable: 0 };
    const cron = loadCron(state, async () => ({ done: true }));
    const ttl = cron._defaultTtlDays;
    const ramp = cron._RAMP_UNTIL;
    t('램프 기준일이 2026-08-12 KST', new Date(ramp).toISOString() === '2026-08-11T15:00:00.000Z', new Date(ramp).toISOString());
    t('기준일 하루 전 → 14일', ttl(ramp - 86400000) === 14, ttl(ramp - 86400000));
    t('기준일 1초 전 → 14일', ttl(ramp - 1000) === 14, ttl(ramp - 1000));
    t('기준일 당일 → 7일', ttl(ramp) === 7, ttl(ramp));
    t('한참 뒤 → 7일', ttl(ramp + 30 * 86400000) === 7, ttl(ramp + 30 * 86400000));
  }

  console.log('[8] 환경변수는 램프를 덮어쓴다');
  {
    const state = { queue: 5, expirable: 2 };
    const cron = loadCron(state, async () => ({ done: true }));
    const r = await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '3', NAVER_DRAFT_QUEUE_MAX: '30' });
    t('ttlDays 3 이 응답에 실린다', r.body.ttlDays === 3, r.body.ttlDays);
    const up = state.calls.find((c) => c.op === 'update');
    const days = up ? Math.round((Date.now() - Date.parse(up.lt.v)) / 86400000) : null;
    t('cutoff 가 3일 전 근처', days === 3, days);
  }

  console.log('[10] 아트 모드 크론 기본값 (2026-08-26) — 만료 0 · 상한 무제한');
  {
    /* 도메니코 지시: "모든 아트 기사"가 초안을 받는다. 아트 모드(기본)에선
       큐 상한이 생성을 멈추지 않고, 만료가 초안을 버리지 않는다. */
    const state = { queue: 12, expirable: 3 };
    let made = 0;
    const cron = loadCron(state, async () => { made++; return { done: true }; });
    const r = await runHandler(cron, {});
    t('큐 12건이어도 생성이 돈다 (상한 무제한)', made === 1, made);
    t('만료를 걸지 않는다 (ttlDays 0)', r.body.ttlDays === 0, r.body.ttlDays);
    t('만료 UPDATE 가 없다', !state.calls.some((c) => c.op === 'update'));

    made = 0;
    const state2 = { queue: 12, expirable: 3 };
    const cron2 = loadCron(state2, async () => { made++; return { done: true }; });
    const r2 = await runHandler(cron2, { NAVER_DRAFT_ART_ONLY: 'false' });
    t('아트 모드를 끄면 종전 기본(상한 5)으로 생성 건너뜀',
      made === 0 && r2.body.skipped === 'queue_full', r2.body.skipped);
    // queue_full 응답에는 ttlDays 가 안 실린다 — 만료가 실제로 도는지로 확인
    t('아트 모드를 끄면 만료도 종전대로 돈다 (만료 UPDATE 발생)',
      state2.calls.some((c) => c.op === 'update'));
  }

  console.log('\n' + (fail ? '✗' : '✓') + ' naver-draft-queue: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
