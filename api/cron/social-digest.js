/**
 * PAP Magazine — 소셜 다이제스트 크론 (2026-08-03, 도메니코 지시).
 * Route: /api/cron/social-digest
 *
 * X·스레드는 인스타로 사람을 밀어넣는 장치다. 기사별 자동 게시(기존 경로)는
 * 그대로 두고, 그 위에 며칠에 한 번 "그동안 올라온 것 모아보기"를 얹는다.
 *
 * 갈래와 주기 (도메니코 지정: 세 갈래가 서로 겹치지 않을 것):
 *   celeb       셀럽 소식        월·목   (창 3일)
 *   collection  아트 콜렉션      화·금   (창 3일)
 *   editorial   오리지널 에디토리얼  일    (창 7일)
 *   수·토는 쉰다.
 *
 * 왜 요일 고정인가 — "3일마다"를 크론으로 쓰면 `*&#47;3` 형태의 일(day-of-month)
 * 스테핑이 되는데, 이건 7일 주기인 에디토리얼과 주기적으로 겹치고 매달 1일에
 * 리셋되며 튄다. 요일 격자는 겹칠 수가 없다 — 대신 간격이 정확히 3일이 아니라
 * 3일/4일 번갈아가 된다. 겹치지 않는 쪽을 택했다.
 *
 * 그리고 크론 설정만 믿지 않는다. vercel.json 이 잘못 편집되거나 수동 실행이
 * 끼면 하루에 두 갈래가 나갈 수 있으므로, 핸들러 안에서도 "오늘 이미 다른
 * 갈래가 나갔으면 거른다"를 한 번 더 건다. 규칙은 설정과 코드 양쪽에 있어야
 * 한 쪽이 틀려도 안 샌다.
 *
 * 게이트: DIGEST_CRON_ENABLED=false 로만 끈다 (기본 활성).
 * 수동 트리거: 관리자 토큰 GET/POST.
 *   ?dry=1            발행하지 않고 문안만 본다 (중복 기록도 안 남긴다)
 *   ?bucket=celeb     요일 무시하고 갈래 지정 (미리보기·복구용)
 *   ?platform=x       한 채널만
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const digestBuckets = require('../_lib/digestBuckets');
const digestCopy = require('../_lib/digestCopy');
const xPost = require('../_lib/xPost');
const threads = require('../_lib/threads');

/* KST 요일 → 갈래. 크론은 UTC 로 돌지만 "무슨 요일에 나가나"는 도메니코가
   보는 한국 시간 기준이어야 한다. 0=일 … 6=토. */
const DAY_BUCKET = {
  0: 'editorial',
  1: 'celeb',
  2: 'collection',
  3: null,
  4: 'celeb',
  5: 'collection',
  6: null,
};

const PLATFORMS = ['x', 'threads'];

/** UTC 시각을 KST 요일(0=일)로. Date 하나로 끝내려고 9시간을 더해서 UTC 요일을 읽는다. */
function kstDay(now) {
  return new Date(now.getTime() + 9 * 3600000).getUTCDay();
}

/** KST 기준 오늘 0시의 UTC ISO. 같은 날 중복 발행을 막을 때 쓴다. */
function kstTodayStartIso(now) {
  const shifted = new Date(now.getTime() + 9 * 3600000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 9 * 3600000).toISOString();
}

/**
 * 오늘(KST) 이미 나간 다이제스트가 있는지 본다.
 * 갈래가 다르면 특히 문제다 — 도메니코가 요구한 "세 갈래가 겹치지 않을 것"이
 * 바로 이 경우다. 같은 갈래 재실행도 막는다 (크론 중복 호출).
 */
async function postedToday(now) {
  const { data, error } = await supabaseAdmin
    .from('social_digests')
    .select('bucket, platform')
    .eq('status', 'posted')
    .gte('created_at', kstTodayStartIso(now))
    .limit(50);
  if (error) {
    /* 못 읽으면 막지 않는다. 여기서 멈추면 DB 가 잠깐 흔들릴 때 그날 글이
       통째로 빠진다. 중복 한 번이 결번 한 번보다 낫다고 보기는 어렵지만,
       진짜 중복은 아래 social_digest_items 기록이 한 번 더 걸러준다. */
    console.warn('[social-digest] 오늘 발행 기록 조회 실패:', error.message);
    return [];
  }
  return data || [];
}

async function recordDigest(row, items) {
  const { data, error } = await supabaseAdmin
    .from('social_digests')
    .insert(row)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[social-digest] social_digests 기록 실패:', error.message);
    return null;
  }
  const digestId = data && data.id;
  if (digestId && items.length) {
    const rows = items.map((it, i) => ({
      digest_id: digestId,
      bucket: row.bucket,
      source: it.source,
      source_id: it.id,
      title: it.title,
      position: i + 1,
    }));
    const { error: itemErr } = await supabaseAdmin.from('social_digest_items').insert(rows);
    if (itemErr) console.error('[social-digest] social_digest_items 기록 실패:', itemErr.message);
  }
  return digestId;
}

/**
 * 채널별 게시. 두 모듈의 반환 규약이 다르다 —
 *   xPost.postTweet   → {ok, id} 또는 {ok:false, skipped|status|detail} (안 던짐)
 *   threads.postText  → 게시 id 문자열, 실패하면 throw
 * 그 차이를 여기서 하나로 눌러 담는다. skipped 는 '실패'가 아니라 '미설정'이다
 * — env 를 아직 안 넣은 채널 때문에 크론이 빨갛게 뜨면 안 된다.
 */
async function publish(platform, text) {
  if (platform === 'x') {
    if (!xPost.isConfigured()) return { skipped: 'X env 미설정' };
    const r = await xPost.postTweet(text);
    if (r && r.ok && r.id) return { ok: true, id: r.id };
    if (r && r.skipped) return { skipped: r.skipped };
    return { ok: false, error: (r && (r.detail || r.status)) || 'unknown' };
  }
  const { data: authRow } = await supabaseAdmin
    .from('threads_auth').select('access_token').eq('id', 1).maybeSingle();
  if (!authRow || !authRow.access_token) return { skipped: '스레드 미인증' };
  const id = await threads.postText(text);
  return { ok: !!id, id: id || null };
}

module.exports = withCronGuard('social-digest', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const q = req.query || {};
  const dry = String(q.dry || '') === '1';

  if (String(process.env.DIGEST_CRON_ENABLED || '').toLowerCase() === 'false') {
    return res.status(200).json({ ok: true, note: '다이제스트 비활성화 (DIGEST_CRON_ENABLED=false)' });
  }

  const now = new Date();
  const day = kstDay(now);
  const bucket = q.bucket ? String(q.bucket) : DAY_BUCKET[day];

  if (!bucket) {
    return res.status(200).json({ ok: true, note: '오늘은 쉬는 날 (KST 요일 ' + day + ')' });
  }
  if (!digestBuckets.BUCKETS[bucket]) {
    return res.status(400).json({ error: '알 수 없는 갈래: ' + bucket });
  }

  /* 겹침 방지 — 요일 격자를 코드가 한 번 더 확인한다. dry 는 통과시킨다
     (미리보기는 발행이 아니므로 겹칠 수 없다). */
  if (!dry) {
    const today = await postedToday(now);
    if (today.length) {
      const other = today.filter((r) => r.bucket !== bucket);
      return res.status(200).json({
        ok: true,
        note: '오늘 이미 다이제스트가 나갔다 — 거름 (' + today.map((r) => r.bucket + '/' + r.platform).join(', ') + ')',
        collided_with_other_bucket: other.length > 0,
      });
    }
  }

  const wanted = q.platform ? [String(q.platform)] : PLATFORMS;
  const out = [];

  for (const platform of wanted) {
    if (!PLATFORMS.includes(platform)) continue;

    /* 소재 선정은 채널마다 따로 부른다. 스레드가 먼저 나가고 기록이 남으면
       X 는 그 글을 안 뽑아야 하나? 아니다 — 같은 날 같은 묶음을 두 채널에
       같이 내보내는 게 이 기능의 목적이다. 그래서 dedupe 기록은 채널이 아니라
       갈래 단위이고, 한 번의 실행 안에서는 같은 목록을 쓴다. */
    const picked = await digestBuckets.collect(bucket, { skipDedupe: dry });
    if (!picked.items.length) {
      out.push({ platform, skipped: '소재 없음' });
      continue;
    }

    const built = await digestCopy.build(picked, platform);
    if (!built) {
      out.push({ platform, skipped: '문안 생성 실패' });
      continue;
    }

    if (dry) {
      out.push({ platform, dry: true, text: built.text, item_count: built.items.length });
      continue;
    }

    let result = { ok: false };
    try {
      result = await publish(platform, built.text);
    } catch (e) {
      result = { ok: false, error: String((e && e.message) || e).slice(0, 300) };
    }

    /* 미설정 채널은 기록도 남기지 않는다. failed 로 쌓아두면 나중에 env 를
       넣었을 때 "예전에 실패했던 글"이 재시도 대상처럼 보인다. */
    if (result.skipped) {
      out.push({ platform, skipped: result.skipped });
      continue;
    }

    await recordDigest({
      bucket,
      platform,
      status: result.ok ? 'posted' : 'failed',
      window_days: picked.days,
      item_count: built.items.length,
      body: built.text,
      post_id: result.id || null,
      attempts: 1,
      error: result.ok ? null : String(result.error || 'unknown'),
      posted_at: result.ok ? new Date().toISOString() : null,
    }, result.ok ? built.items : []);

    out.push({ platform, posted: result.ok, post_id: result.id || null, error: result.ok ? null : String(result.error || '') });
  }

  res.locals = res.locals || {};
  res.locals.cronNote = bucket + ' — ' + out.map((o) => o.platform + ':' + (o.posted ? 'ok' : (o.dry ? 'dry' : (o.skipped || 'fail')))).join(', ');

  return res.status(200).json({ ok: true, bucket, kst_day: day, dry, results: out });
});

module.exports.DAY_BUCKET = DAY_BUCKET;
module.exports.kstDay = kstDay;
module.exports.kstTodayStartIso = kstTodayStartIso;
