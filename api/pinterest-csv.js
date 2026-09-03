/**
 * PAP Magazine — Pinterest 대량 업로드 CSV 익스포트
 * Route: /pinterest-csv  (rewritten in vercel.json)
 *
 * Pinterest 비즈니스 "대량 만들기(Bulk create Pins)" 에 업로드할 CSV.
 * API Standard 승인 전까지 에디토리얼을 핀으로 대량 발행하는 경로.
 *
 * 한국인 팔로워 유도 최적화:
 *   - 설명(Description)에 한국어 키워드 + "@pap_magazine 인스타그램 팔로우"
 *     문구 → 핀 자체에서 인스타 팔로우 유도 + 한국 Pinterest 검색 노출.
 *   - Link 는 PAP 에디토리얼 상세(한국어 페이지 + Follow @pap_magazine CTA)
 *     → Pinterest 클릭 → PAP 페이지 → 인스타 팔로우 깔때기.
 *   - Board = EDITORIAL.
 *
 * 사용: 브라우저로 /pinterest-csv 접속 → CSV 다운로드 → 200행씩 나눠
 *       Pinterest 대량 만들기에 업로드. ?limit=200&offset=0 로 페이지네이션.
 *
 * 컬럼: Title, Media URL, Board, Description, Link, Keywords
 * (Pinterest 템플릿의 정확한 헤더명은 다운로드본과 대조해 맞출 것.)
 */

const { HTML_TAG_RE, dropKnownTags } = require('./_lib/stripHtml');
const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const SITE = 'https://www.pap-magazine.com';
const BOARD = 'EDITORIAL';

function csvCell(s) {
  s = String(s == null ? '' : s).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  // 따옴표 이스케이프 + 감싸기
  return '"' + s.replace(/"/g, '""') + '"';
}
function clean(s, n) {
  s = String(s || '').replace(HTML_TAG_RE, dropKnownTags(' ')).replace(/\s+/g, ' ').trim();
  return n && s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '200', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

    const { data: eds, error } = await supabaseAdmin
      .from('editorials')
      .select('id, title, title_en, slug, description, description_en, cover_image, og_image, thumbnail, issue')
      .eq('status', 'published')
      .not('published_date', 'is', null)
      .lte('published_date', new Date().toISOString())
      .not('cover_image', 'is', null)
      .order('published_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const header = ['Title', 'Media URL', 'Board', 'Description', 'Link', 'Keywords'];
    const rows = [header.map(csvCell).join(',')];

    (eds || []).forEach(e => {
      const handle = e.slug || e.id;
      const img = e.cover_image || e.og_image || e.thumbnail || '';
      if (!handle || !e.title || !img) return;
      const link = SITE + '/editorial/' + encodeURIComponent(handle);
      const title = clean(e.title, 95);
      const base = clean(e.description || e.description_en, 220);
      // 한국어 키워드 + 인스타 팔로우 유도 (핀 자체에서 전환)
      const desc = clean(
        (base ? base + ' ' : '') +
        `${e.title} — PAP 매거진 에디토리얼${e.issue ? ' · ' + e.issue : ''}. ` +
        `패션·뷰티·컬쳐 화보. 더 많은 화보는 인스타그램 @pap_magazine 에서. #PAP매거진`,
        480
      );
      const keywords = ['패션 에디토리얼', '패션 화보', 'fashion editorial', 'PAP 매거진', 'pap magazine',
        'beauty', 'fashion'].filter(Boolean).join(', ');

      rows.push([
        csvCell(title),
        csvCell(img),
        csvCell(BOARD),
        csvCell(desc),
        csvCell(link),
        csvCell(keywords),
      ].join(','));
    });

    const csv = '﻿' + rows.join('\r\n') + '\r\n'; // BOM for Excel/한글

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="pap-pinterest-editorials-${offset}-${offset + limit}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(csv);
  } catch (err) {
    console.error('[pinterest-csv] error:', err);
    return res.status(500).send('export error');
  }
};
