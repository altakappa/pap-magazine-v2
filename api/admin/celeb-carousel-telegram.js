/**
 * POST /api/admin/celeb-carousel-telegram { id, titleKo?, titleEn?, caption? }
 *
 * 셀럽 브리프 한 건을 **인스타 캐러셀에 올릴 그대로의 파일**로 만들어 텔레그램(브리프를 받은 방)에
 * 문서로 보낸다. 1번 = 디자인 커버(제목 두 줄, 심볼 없음), 2번부터 = 4:5 로 자른 사진. 게시는 하지 않는다.
 *
 * 왜 (2026-10-20): 도메니코 "인스타그램 캐러셀용으로 만들어서 텔레그램으로 보내줘".
 * 브리프가 보내는 묶음은 커버 + **원본** 사진이라 비율이 제각각이고, 사진(photo)으로 보내면 텔레그램이
 * 1280px 로 다시 눌러 1080×1350 이 깨진다. 게시 경로(runPublish)와 같은 자르기(slideCrop)를 써서
 * "텔레그램에서 본 것 = 올라가는 것" 을 지키고, 문서(document)로 보내 바이트를 그대로 전달한다.
 * titleKo/titleEn 을 주면 큐의 게시용 제목도 같이 바꾼다 — 브리프 AI 가 사진만 보고 엉뚱한 제목을
 * 지은 사례(7/19 비버 사진 → "인간을 닮아가는 것은 인형인가, 기계인가")가 있어서다.
 */
'use strict';
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { supabaseAdmin } = require('../_lib/supabase');

const IG_CAROUSEL_MAX = 10;   // igPublish.publishPhotos 가 10장에서 자른다 — 여기서도 같은 수로 미리 보여 준다

async function fetchBuffer(url, timeoutMs) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 20000) });
  if (!r.ok) throw new Error('이미지 다운로드 실패 HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

/** 게시 경로(runPublish)와 같은 순서·같은 자르기로 캐러셀 버퍼 목록을 만든다. */
async function buildCarousel(pub, titleKo, titleEn, opts) {
  const { renderThumb } = require('../_lib/celebThumb');
  const { cropSlideToVariant } = require('../_lib/slideCrop');
  const max = (opts && opts.max) || IG_CAROUSEL_MAX;
  const variant = pub.variant || 'feed';
  const out = [];
  const cover = await renderThumb(await fetchBuffer(pub.coverUrl, 20000), titleKo, titleEn, { variant, focusTop: pub.focusTop });
  out.push({ buffer: cover, name: '01-cover.jpg', mime: 'image/jpeg' });
  const items = pub.items || [];
  const rest = (items[0] && items[0].type === 'image' ? items.slice(1) : items).filter((i) => i.type === 'image');
  for (let i = 0; i < rest.length && out.length < max; i++) {
    try {
      const cropped = await cropSlideToVariant(await fetchBuffer(rest[i].url, 20000), variant);
      if (cropped.drop) continue;
      out.push({ buffer: cropped.buffer, name: String(out.length + 1).padStart(2, '0') + '.jpg', mime: 'image/jpeg' });
    } catch (e) {
      console.warn('[celeb-carousel] 이미지 건너뜀:', (e && e.message) || e);
    }
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await requireAdmin(req, res);
  if (!user) return;
  const b = req.body || {};
  const id = parseInt(b.id, 10);
  if (!id) return res.status(400).json({ error: 'id 가 필요하다 (celeb_brief_queue.id)' });
  const { data: row, error } = await supabaseAdmin.from('celeb_brief_queue')
    .select('id, chat_id, shortcode, status, result').eq('id', id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row || !row.result || !row.result.publish) return res.status(404).json({ error: '브리프 결과(publish)가 없는 행이다: ' + id });
  const pub = row.result.publish;
  const titleKo = String(b.titleKo || pub.titleKo || '').trim();
  const titleEn = String(b.titleEn || pub.titleEn || '').trim();
  if (!titleKo || !titleEn) return res.status(400).json({ error: '국문·영문 제목이 둘 다 필요하다' });
  try {
    const files = await buildCarousel(pub, titleKo, titleEn);
    const tg = require('../_lib/telegram');
    const caption = String(b.caption || ('🖼 캐러셀 ' + files.length + '장 — 브리프 #' + row.id + ' · ' + titleKo));
    // 2026-10-30 도메니코 "기사 관련된 내용은 전부 pap 셀럽속보 방으로" — 설정이 없으면 브리프 받은 방(row.chat_id)
    const outChat = require('../_lib/celebChat').celebOr(row.chat_id);
    const sent = await tg.sendDocumentsToTelegram(files, caption, outChat);
    if (b.titleKo || b.titleEn) {
      /* 게시용 제목도 같이 바꾼다 — "올려 N" 이 이 제목으로 커버를 다시 그린다. */
      const next = { ...row.result, publish: { ...pub, titleKo, titleEn } };
      await supabaseAdmin.from('celeb_brief_queue').update({ result: next }).eq('id', row.id);
    }
    return res.status(200).json({ ok: true, id: row.id, files: files.length, sent, titleKo, titleEn });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
};
module.exports.buildCarousel = buildCarousel;
module.exports.IG_CAROUSEL_MAX = IG_CAROUSEL_MAX;
