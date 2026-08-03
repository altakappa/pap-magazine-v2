/**
 * PAP Magazine — 소셜 다이제스트 크론 (2026-08-03, 도메니코 지시).
 * Route: /api/cron/social-digest
 *
 * X·스레드는 인스타로 사람을 밀어넣는 장치다. 기사별 자동 게시(기존 경로)는
 * 그대로 두고, 그 위에 며칠에 한 번 "그동안 올라온 것 모아보기"를 얹는다.
 *
 * 갈래와 주기 (2026-08-03 6차 지시 — 하루 두 슬롯):
 *   아침(am, KST 09시)   celeb 월·화·목·금 (창 4일) · editorial 일 (창 7일) · 수·토는 쉰다
 *   저녁(pm, KST 20시)   collection 매일 (창 3일)
 *
 * 왜 슬롯을 둘로 쪼갰나 — 콜렉션 공급이 하루 6건대로 늘어, 주 2회(수·토)
 * 발행으로는 스레드 커버리지가 41%, X 는 14% 밖에 안 됐다(28일 실측).
 * 콜렉션에 매일 한 자리를 주면 스레드 102% · X 49% 로 올라간다. 대신
 * "세 갈래가 절대 안 겹친다"는 원칙을 날짜가 아니라 *시간대* 로 푼다 —
 * 아침과 저녁은 타임라인에서 서로 다른 글이고, 한 슬롯에 갈래는 여전히
 * 하나다. 같은 갈래가 하루에 두 번 나가는 일도 없다(아래 겹침 방지).
 *
 * 왜 요일 고정인가 — "3일마다"를 크론으로 쓰면 `*&#47;3` 형태의 일(day-of-month)
 * 스테핑이 되는데, 이건 7일 주기인 에디토리얼과 주기적으로 겹치고 매달 1일에
 * 리셋되며 튄다. 요일 격자는 겹칠 수가 없다 — 대신 간격이 정확히 3일이 아니라
 * 3일/4일 번갈아가 된다. 겹치지 않는 쪽을 택했다.
 *
 * 그리고 크론 설정만 믿지 않는다. vercel.json 이 잘못 편집되거나 수동 실행이
 * 끼면 같은 묶음이 하루에 두 번 나갈 수 있으므로, 핸들러 안에서도 "오늘 이미
 * 같은 갈래가 나갔으면 거른다"를 한 번 더 건다. 규칙은 설정과 코드 양쪽에
 * 있어야 한 쪽이 틀려도 안 샌다. (갈래가 *다르면* 이제 통과시킨다 — 그게
 * 두 슬롯의 목적이다.)
 *
 * 게이트: DIGEST_CRON_ENABLED=false 로만 끈다 (기본 활성).
 * 수동 트리거: 관리자 토큰 GET/POST.
 *   ?dry=1            발행하지 않고 문안만 본다 (중복 기록도 안 남긴다)
 *   ?slot=am|pm       슬롯 지정 (크론이 붙여서 부른다. 없으면 KST 시각으로 판단)
 *   ?bucket=celeb     요일·슬롯 무시하고 갈래 지정 (미리보기·복구용)
 *   ?platform=x       한 채널만
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const digestBuckets = require('../_lib/digestBuckets');
const digestCopy = require('../_lib/digestCopy');
const xPost = require('../_lib/xPost');
const threads = require('../_lib/threads');

/* KST 요일 × 슬롯 → 갈래. 크론은 UTC 로 돌지만 "무슨 요일 몇 시에 나가나"는
   도메니코가 보는 한국 시간 기준이어야 한다. 0=일 … 6=토. null 은 쉬는 자리.

   2026-08-03 도메니코 — 하루를 아침·저녁 두 슬롯으로 쪼갠다.
   저녁은 콜렉션이 매일 가져간다. 콜렉션은 공급이 하루 6건대라 주 2회로는
   스레드에 41% 밖에 못 실렸다(28일 실측). 매일 한 자리를 주면 102% 다.
   아침은 셀럽 월·화·목·금, 에디토리얼 일. 수·토 아침은 비워 둔다 —
   시뮬레이션상 그 두 자리를 콜렉션에 더 줘도 커버리지가 안 움직인다
   (저녁 발행만으로 이미 밀린 게 없다). 없어도 되는 글은 안 올린다. */
const SLOT_BUCKET = {
  am: {
    0: 'editorial',   // 일
    1: 'celeb',       // 월
    2: 'celeb',       // 화
    3: null,          // 수 — 쉼
    4: 'celeb',       // 목
    5: 'celeb',       // 금
    6: null,          // 토 — 쉼
  },
  pm: {
    0: 'collection',  // 일
    1: 'collection',  // 월
    2: 'collection',  // 화
    3: 'collection',  // 수
    4: 'collection',  // 목
    5: 'collection',  // 금
    6: 'collection',  // 토
  },
};

/* 슬롯 경계는 KST 14시. 크론이 ?slot= 을 붙여서 부르지만, 수동 실행이나
   vercel.json 오편집으로 슬롯이 빠졌을 때 시각으로라도 맞게 떨어져야 한다. */
const SLOT_BOUNDARY_HOUR = 14;

const PLATFORMS = ['x', 'threads'];

/** UTC 시각을 KST 요일(0=일)로. Date 하나로 끝내려고 9시간을 더해서 UTC 요일을 읽는다. */
function kstDay(now) {
  return new Date(now.getTime() + 9 * 3600000).getUTCDay();
}

/** UTC 시각을 KST 시(0~23)로. 슬롯을 시각으로 되짚을 때 쓴다. */
function kstHour(now) {
  return new Date(now.getTime() + 9 * 3600000).getUTCHours();
}

/** KST 기준 오늘 0시의 UTC ISO. 같은 갈래의 하루 중복 발행을 막을 때 쓴다. */
function kstTodayStartIso(now) {
  const shifted = new Date(now.getTime() + 9 * 3600000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 9 * 3600000).toISOString();
}

/**
 * 오늘(KST) 이미 나간 다이제스트를 갈래·채널째로 돌려준다.
 * 호출부는 이 중 *같은 갈래* 가 있으면 거른다 — 크론 중복 호출과 수동 재실행이
 * 같은 묶음을 두 번 내보내는 걸 막는다. 갈래가 다르면 통과다(아침·저녁 슬롯).
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
  const slot = q.slot ? String(q.slot) : (kstHour(now) < SLOT_BOUNDARY_HOUR ? 'am' : 'pm');

  if (!SLOT_BUCKET[slot]) {
    return res.status(400).json({ error: '알 수 없는 슬롯: ' + slot });
  }

  const bucket = q.bucket ? String(q.bucket) : SLOT_BUCKET[slot][day];

  if (!bucket) {
    return res.status(200).json({ ok: true, slot, note: '이 슬롯은 쉰다 (KST 요일 ' + day + ' · ' + slot + ')' });
  }
  if (!digestBuckets.BUCKETS[bucket]) {
    return res.status(400).json({ error: '알 수 없는 갈래: ' + bucket });
  }

  /* 겹침 방지 — 격자를 코드가 한 번 더 확인한다. 막는 건 *같은 갈래* 의 하루
     재발행뿐이다. 갈래가 다르면(아침 셀럽 / 저녁 콜렉션) 통과시킨다 — 그게
     두 슬롯을 만든 이유다. dry 도 통과시킨다(미리보기는 발행이 아니다). */
  if (!dry) {
    const today = await postedToday(now);
    const same = today.filter((r) => r.bucket === bucket);
    if (same.length) {
      return res.status(200).json({
        ok: true,
        slot,
        note: '오늘 이미 ' + bucket + ' 다이제스트가 나갔다 — 거름 (' + same.map((r) => r.platform).join(', ') + ')',
        posted_today: today.map((r) => r.bucket + '/' + r.platform),
      });
    }
  }

  const wanted = q.platform ? [String(q.platform)] : PLATFORMS;
  const out = [];

  /* 소재는 루프 *밖에서* 한 번만 고른다.
     채널마다 collect() 를 부르면, 먼저 나간 X 가 social_digest_items 에 기록을
     남기고 그 기록이 뒤따르는 스레드의 후보에서 바로 그 기사들을 빼 버린다.
     dedupe 기록은 채널이 아니라 갈래 단위이기 때문이다. 그러면 X 는 제일 새
     기사 서너 개, 스레드는 그 다음 것들 — 두 채널에 같은 묶음을 내보낸다는
     이 기능의 전제가 깨지고, 정작 스레드에 제일 새 기사가 안 실린다.
     한 번 고른 목록을 두 채널이 같이 쓴다. 채널별 분량 차이는 문안 조립이
     알아서 자른다(X 가중 280자 / 스레드 480자). */
  const picked = await digestBuckets.collect(bucket, { skipDedupe: dry });
  if (!picked.items.length) {
    res.locals = res.locals || {};
    res.locals.cronNote = bucket + ' — 소재 없음';
    return res.status(200).json({ ok: true, bucket, slot, kst_day: day, dry, note: '소재 없음', results: [] });
  }

  for (const platform of wanted) {
    if (!PLATFORMS.includes(platform)) continue;

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

  return res.status(200).json({ ok: true, bucket, slot, kst_day: day, dry, results: out });
});

module.exports.SLOT_BUCKET = SLOT_BUCKET;
module.exports.SLOT_BOUNDARY_HOUR = SLOT_BOUNDARY_HOUR;
module.exports.kstDay = kstDay;
module.exports.kstHour = kstHour;
module.exports.kstTodayStartIso = kstTodayStartIso;
