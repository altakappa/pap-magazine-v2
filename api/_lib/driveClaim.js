/**
 * 드라이브 영상 게시 자리 찜하기 — api/_lib/driveClaim.js (2026-08-07 신설)
 *
 * 무슨 일이 있었나 ────────────────────────────────────────────────────
 * 휴닝카이 영상이 틱톡에 두 번 올라갔다. 도메니코가 하나를 손으로 지웠다.
 *
 * 원인은 순서다. 크론이 이렇게 생겼었다:
 *
 *     ① 이미 올린 목록을 읽는다          (A: 휴닝카이 없음)
 *     ② 드라이브에서 받아 틱톡에 올린다  (50초)
 *                                        (B 가 이 사이에 ① 을 함 → 역시 없음)
 *     ③ "올렸다" 고 적는다               (A 기록)  … B 도 올리고 덮어씀
 *
 * 읽기와 쓰기 사이에 50초가 비어 있다. 그 사이에 시작한 실행은 앞의 실행을
 * 볼 방법이 없다. 흔한 check-then-act 경합이고, 유니크 인덱스는 이걸 못 막는다 —
 * upsert 라서 두 번째 쓰기가 그냥 덮어쓰기 때문에 DB 에는 한 줄만 남고
 * 겉으로는 정상으로 보인다. **실제로 나간 게시물은 두 개다.**
 *
 * 그래서 순서를 뒤집는다 ──────────────────────────────────────────────
 *
 *     ① 자리를 먼저 찜한다 (status='claiming' 으로 INSERT)
 *        └ 유니크 인덱스가 두 번째 INSERT 를 23505 로 거절한다. 여기서 갈린다.
 *     ② 찜에 성공한 실행만 올린다
 *     ③ 결과를 같은 줄에 적는다
 *
 * INSERT 는 원자적이다. upsert 와 달리 '덮어쓰기' 가 없으므로 경합이 조용히
 * 통과하지 못한다.
 *
 * 찜만 하고 죽으면? ───────────────────────────────────────────────────
 * 함수가 타임아웃(120초)으로 강제 종료되면 'claiming' 줄이 남아 그 영상이
 * 영영 막힌다. 그래서 찜에는 나이가 있다 — STALE_MS 를 넘긴 찜은 다른 실행이
 * 가져갈 수 있다. 다만 가져가는 것도 **조건부 UPDATE 한 방**이라, 두 실행이
 * 동시에 낚아채도 하나만 성공한다(영향 행 수로 판정).
 *
 * 이 파일에 규칙을 몰아 두는 이유는 유튜브·틱톡 두 크론이 같은 실수를 각자
 * 반복했기 때문이다. 규칙이 두 벌이면 한쪽만 고쳐진다.
 */

'use strict';

const { supabaseAdmin } = require('./supabase');

const CLAIM_STATUS = 'claiming';

/* 함수 상한이 120초다. 그보다 넉넉히 잡되(재시도·콜드스타트), 사람이 기다릴
   만한 길이여야 한다 — 죽은 찜 하나가 그 영상을 이만큼 묶어 둔다. */
const STALE_MS = Number(process.env.DRIVE_CLAIM_STALE_MS || 10 * 60 * 1000);

/* 유니크 위반. PostgREST 는 code 로도, message 로도 알려 준다. */
function isConflict(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key|23505|already exists/i.test(String(err.message || ''));
}

/**
 * 이 영상을 지금 내가 처리해도 되는가. 되면 자리를 잡고 true.
 *
 * @param {string} table 'tiktok_posts' | 'youtube_posts'
 * @param {string} driveFileId 드라이브 파일 id (유니크 인덱스가 걸린 칸)
 * @param {object} [opts] { client, staleMs, now }
 * @returns {Promise<{ok:boolean, reason?:string, took?:string}>}
 *
 * ⚠️ article_id 는 여기서 안 쓴다. 두 표 모두 article_id 에도 유니크가 걸려
 *    있어서, 찜 단계에서 같이 넣으면 어느 제약이 터진 건지 구분할 수 없다.
 *    (드라이브 경합인지 '이 기사 이미 올림' 인지가 섞인다.)
 *    기사 연결은 finishClaim 에서 결과와 함께 적는다.
 */
async function claimDriveFile(table, driveFileId, opts = {}) {
  const db = opts.client || supabaseAdmin;
  const staleMs = Number.isFinite(opts.staleMs) ? opts.staleMs : STALE_MS;
  const now = opts.now ? new Date(opts.now) : new Date();

  if (!driveFileId) return { ok: false, reason: 'drive_file_id 없음' };

  const ins = await db.from(table).insert({
    drive_file_id: driveFileId, status: CLAIM_STATUS,
    detail: '처리 중 (' + now.toISOString() + ')',
  });
  if (!ins.error) return { ok: true, took: 'new' };
  if (!isConflict(ins.error)) {
    return { ok: false, reason: '찜 실패: ' + String(ins.error.message || ins.error).slice(0, 160) };
  }

  /* 이미 줄이 있다. 가져올 수 있는 두 경우만 가져온다.
     ① 지난번에 실패한 줄      — 재시도가 원래 허용돼 있었다
     ② 오래된 'claiming' 줄     — 그 실행은 죽었다고 본다
     둘 다 조건부 UPDATE 한 방으로 낚아챈다. 읽고 나서 쓰면 여기서 또 같은
     경합이 생긴다 — 그게 애초에 이 파일이 존재하는 이유다. */
  const cutoff = new Date(now.getTime() - staleMs).toISOString();
  const stamp = { status: CLAIM_STATUS, created_at: now.toISOString(), publish_id: null, video_id: undefined };
  delete stamp.video_id;   // 표마다 칸이 달라 아예 안 건드린다

  const retakeFailed = await db.from(table)
    .update({ ...stamp, detail: '재시도 (' + now.toISOString() + ')' })
    .eq('drive_file_id', driveFileId).eq('status', 'failed').select('drive_file_id');
  if (retakeFailed.error) {
    return { ok: false, reason: '재시도 확인 실패: ' + String(retakeFailed.error.message || retakeFailed.error).slice(0, 160) };
  }
  if ((retakeFailed.data || []).length) return { ok: true, took: 'failed' };

  const retakeStale = await db.from(table)
    .update({ ...stamp, detail: '죽은 찜 회수 (' + now.toISOString() + ')' })
    .eq('drive_file_id', driveFileId).eq('status', CLAIM_STATUS).lt('created_at', cutoff)
    .select('drive_file_id');
  if (retakeStale.error) {
    return { ok: false, reason: '죽은 찜 확인 실패: ' + String(retakeStale.error.message || retakeStale.error).slice(0, 160) };
  }
  if ((retakeStale.data || []).length) return { ok: true, took: 'stale' };

  return { ok: false, reason: '다른 실행이 이미 처리 중이거나 완료함' };
}

/**
 * 결과를 적는다. 찜해 둔 그 줄을 갱신하는 것이므로 insert 가 아니라 update 다.
 * 갱신된 줄이 0개면 '내 찜이 사라졌다' 는 뜻이니 성공이라고 말하지 않는다.
 */
async function finishClaim(table, driveFileId, fields, opts = {}) {
  const db = opts.client || supabaseAdmin;
  const r = await db.from(table).update(fields)
    .eq('drive_file_id', driveFileId).select('drive_file_id');
  if (r.error) return { ok: false, reason: String(r.error.message || r.error).slice(0, 200) };
  if (!(r.data || []).length) return { ok: false, reason: '찜한 줄이 사라졌다 — 기록하지 못함' };
  return { ok: true };
}

/**
 * 올리기 전에 그만두게 됐을 때 찜을 놓는다 (매칭 실패 등).
 * 실패해도 조용히 넘어간다 — STALE_MS 뒤에 어차피 회수된다.
 */
async function releaseClaim(table, driveFileId, opts = {}) {
  const db = opts.client || supabaseAdmin;
  try {
    await db.from(table).delete().eq('drive_file_id', driveFileId).eq('status', CLAIM_STATUS);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e).slice(0, 120) };
  }
}

/**
 * 후보에서 빼야 할 drive_file_id 집합.
 *
 * 'failed' 는 재시도 대상이라 뺀다. 'claiming' 은 **아직 살아 있을 때만** 뺀다 —
 * 죽은 찜까지 영구히 빼면 그 영상은 영영 안 올라간다(그게 더 나쁘다).
 */
function doneIdsFrom(rows, opts = {}) {
  const staleMs = Number.isFinite(opts.staleMs) ? opts.staleMs : STALE_MS;
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const out = new Set();
  for (const r of (rows || [])) {
    if (!r || !r.drive_file_id) continue;
    if (r.status === 'failed') continue;
    if (r.status === CLAIM_STATUS) {
      const at = r.created_at ? Date.parse(r.created_at) : 0;
      if (now - at >= staleMs) continue;    // 죽은 찜 — 다시 후보로
    }
    out.add(r.drive_file_id);
  }
  return out;
}

module.exports = { claimDriveFile, finishClaim, releaseClaim, doneIdsFrom, isConflict, CLAIM_STATUS, STALE_MS };
