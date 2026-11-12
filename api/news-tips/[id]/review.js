/**
 * POST /api/news-tips/:id/review — 제보 처리 (관리자)
 *
 * body: { action, status?, notes? }
 *   action='status'   — new · checking · used · dropped
 *   action='notes'    — 관리자 메모만
 *   action='archive'  — 채택한 제보의 미디어를 **영구 저장소로 확보**
 *   action='rewarded' — 보상(크레딧 + 프리미엄 1개월) 처리 시각 기록
 *
 * ■ '기사로 전환' 버튼은 없다
 * 이 파일에는 `articles` 를 건드리는 코드가 한 줄도 없다. 도메니코가 제보를
 * 보고 확인하고 **직접** 기사를 쓴다(설계 결정). 증거가 있어도 확인은 여전히
 * 필요하다 — 영상 속 인물이 정말 그 사람인지, 언제 찍힌 것인지, 맥락이 맞는지.
 *
 * ■ 7일 삭제가 발행된 기사를 깨지 않게 하는 장치
 * 도메니코: "일주일뒤 보관하지않고 삭제." 그런데 채택해서 기사에 실은 영상이
 * 7일 뒤 사라지면 발행된 기사가 깨진다. 그래서 순서를 둔다:
 *   ① 채택(used) 표시 → ② 미디어 확보(archive) → ③ 7일 뒤 원본 삭제
 * 퍼지 크론은 **②가 끝나지 않은 used 제보를 건드리지 않는다**
 * (api/cron/purge-news-tips.js). 즉 확보를 잊어도 영상이 먼저 사라지지 않는다.
 *
 * 확보 방식은 파일 크기로 갈린다:
 *   · 작은 파일(사진 등)은 서버가 공개 버킷으로 복사한다.
 *   · 큰 영상은 함수 메모리로 옮길 수 없다 — 관리자가 직접 내려받아 기사에
 *     올리고, 확보했다고 표시한다. 시스템이 알 수 없는 일을 안다고 하지 않는다.
 */

'use strict';

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { sendTextToTelegramSafe } = require('../../_lib/telegram');
const T = require('../../_lib/newsTip');

const STATUSES = ['new', 'checking', 'used', 'dropped'];

/* 서버가 직접 복사할 수 있는 최대 크기. 함수 메모리(1GB) 안에서 버퍼로 다루는
   일이므로 넉넉하게 잡지 않는다. 이보다 큰 영상은 관리자가 직접 내려받는다. */
const ARCHIVE_MAX_BYTES = 40 * 1024 * 1024;

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ message: 'Missing id', code: 'missing_id' });

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
  }
  const action = String((body && body.action) || '').trim();
  const now = new Date().toISOString();

  try {
    const { data: tip, error } = await supabaseAdmin
      .from('news_tips').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!tip) return res.status(404).json({ message: 'Tip not found', code: 'not_found' });

    if (action === 'notes') {
      const notes = String(body.notes == null ? '' : body.notes).slice(0, 8000);
      const { error: e } = await supabaseAdmin.from('news_tips')
        .update({ admin_notes: notes, updated_at: now }).eq('id', id);
      if (e) throw e;
      return res.status(200).json({ ok: true, admin_notes: notes });
    }

    if (action === 'status') {
      const status = String(body.status || '').trim();
      if (STATUSES.indexOf(status) === -1) {
        return res.status(400).json({ message: 'Unknown status', code: 'status_invalid', allowed: STATUSES });
      }
      const { error: e } = await supabaseAdmin.from('news_tips')
        .update({ status, reviewed_by: admin.id, reviewed_at: now, updated_at: now })
        .eq('id', id);
      if (e) throw e;
      // 채택했으면 미디어 확보가 남았다는 걸 알린다 — 잊으면 7일 뒤 원본이 사라진다
      // (퍼지는 확보 전 used 를 건드리지 않지만, 쓰려면 결국 확보해야 한다).
      if (status === 'used' && !tip.media_archived) {
        try {
          await sendTextToTelegramSafe('📌 제보 채택됨 — 미디어 확보가 남았습니다'
            + '\n제목: ' + String(tip.title || '').slice(0, 80)
            + '\ntip=' + id
            + '\n관리자 화면에서 "미디어 확보" 를 눌러 주세요. 확보 전에는 원본이 삭제되지 않습니다.');
        } catch (_) {}
      }
      return res.status(200).json({ ok: true, status });
    }

    if (action === 'rewarded') {
      // 보상 자체(크레딧 + 프리미엄 1개월)는 도메니코가 수동으로 한다.
      // 여기서는 "했다" 는 시각만 남긴다 — 코드가 등급을 올리지 않는다.
      const { error: e } = await supabaseAdmin.from('news_tips')
        .update({ rewarded_at: now, updated_at: now }).eq('id', id);
      if (e) throw e;
      return res.status(200).json({ ok: true, rewarded_at: now });
    }

    if (action === 'archive') {
      if (tip.media_purged_at) {
        return res.status(409).json({ message: 'The original media is already deleted.', code: 'already_purged' });
      }
      const media = Array.isArray(tip.media) ? tip.media : [];
      if (!media.length) return res.status(400).json({ message: 'Nothing to archive', code: 'no_media' });

      const archived = [];
      const manual = [];
      for (const m of media) {
        if (Number(m.size) > ARCHIVE_MAX_BYTES) {
          // 함수 메모리로 옮길 수 없는 크기 — 사람이 내려받아야 한다.
          manual.push({ path: m.path, name: m.name || '', size: m.size, type: m.type });
          continue;
        }
        try {
          const dl = await supabaseAdmin.storage.from(T.BUCKET).download(m.path);
          if (dl.error || !dl.data) throw dl.error || new Error('download failed');
          const buf = Buffer.from(await dl.data.arrayBuffer());
          const dest = T.archivePathFor(id, m.path);
          const up = await supabaseAdmin.storage.from(T.ARCHIVE_BUCKET)
            .upload(dest, buf, { contentType: m.type, upsert: true });
          if (up.error) throw up.error;
          const { data: pub } = supabaseAdmin.storage.from(T.ARCHIVE_BUCKET).getPublicUrl(dest);
          archived.push({ path: dest, url: (pub && pub.publicUrl) || '', type: m.type, size: m.size, name: m.name || '' });
        } catch (e2) {
          console.error('[news-tips/review] archive failed for', m.path, (e2 && e2.message) || e2);
          manual.push({ path: m.path, name: m.name || '', size: m.size, type: m.type, failed: true });
        }
      }

      const record = { at: now, by: admin.id, files: archived, manual };
      const { error: e } = await supabaseAdmin.from('news_tips')
        .update({ media_archived: record, updated_at: now }).eq('id', id);
      if (e) throw e;

      return res.status(200).json({ ok: true, archived: archived.length, manual: manual.length, media_archived: record });
    }

    return res.status(400).json({ message: 'Unknown action', code: 'unknown_action' });
  } catch (err) {
    console.error('[news-tips/review] error:', err);
    // 원문 노출 금지 (.claude/rules/api.md A-3)
    return res.status(500).json({ message: 'Action failed. Check the server logs.', code: 'review_failed' });
  }
};
