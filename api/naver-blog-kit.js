/**
 * PAP Magazine — 네이버 블로그 발행 킷
 * Route: GET /api/naver-blog-kit?slug=<에디토리얼 슬러그>
 *        GET /api/naver-blog-kit            → 최신 발행 에디토리얼 목록 (킷 링크)
 *
 * 목적: 네이버 검색은 자사 생태계(블로그·포스트) 콘텐츠를 최상단에
 * 노출한다. '아이즈매거진급' 네이버 존재감을 만들려면 네이버 안에
 * PAP 채널 콘텐츠가 쌓여야 하는데, 이 킷은 에디토리얼 하나를
 * 네이버 블로그 에디터에 그대로 붙여넣을 수 있는 완성 포스트로
 * 변환한다 (제목 + 본문 + 이미지 + 백링크 + 태그).
 *
 * 사용법:
 *   1. 이 페이지를 브라우저로 연다
 *   2. "본문 복사" 영역을 전체 선택(Cmd+A 대신 영역 클릭 후 드래그) → 복사
 *   3. 네이버 블로그 글쓰기(스마트에디터)에 붙여넣기 → 이미지까지 같이 들어감
 *   4. 제목·태그는 상단 박스에서 복사
 *
 * SEO 설계:
 *   - 제목에 'PAP매거진' 브랜드 키워드 고정 → 네이버에서 'pap매거진'
 *     검색 시 블로그 글이 함께 잡히는 브랜드 SERP 형성
 *   - 본문 하단 백링크(웹사이트·인스타그램) → 채널 간 연결 신호
 *   - noindex: 이 킷 페이지 자체는 검색에 안 잡히게 (복제 콘텐츠 방지)
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const SITE = 'https://www.pap-magazine.com';
const IG = 'https://www.instagram.com/pap_magazine/';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function page(title, body) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
  body{font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;background:#f5f5f5;color:#111;margin:0;padding:32px 16px;line-height:1.7}
  .wrap{max-width:760px;margin:0 auto}
  .tool{background:#fff;border:1px solid #ddd;border-radius:8px;padding:20px 22px;margin-bottom:18px}
  .tool h2{font-size:14px;margin:0 0 10px;color:#03c75a}
  .tool .hint{font-size:12.5px;color:#777;margin:8px 0 0}
  .copybox{background:#fafafa;border:1px dashed #bbb;border-radius:6px;padding:14px;font-size:14px;user-select:all;cursor:pointer}
  .content{background:#fff;border:2px solid #03c75a;border-radius:8px;padding:28px}
  .content img{max-width:100%;height:auto;display:block;margin:18px 0}
  .content h1{font-size:24px;line-height:1.35}
  .content .credit{font-size:13px;color:#666}
  .content a{color:#03c75a}
  ul.list{list-style:none;padding:0}
  ul.list li{background:#fff;border:1px solid #ddd;border-radius:6px;margin-bottom:8px;padding:12px 16px;font-size:14px}
  ul.list a{color:#111;text-decoration:none;font-weight:600}
  ul.list a:hover{color:#03c75a}
  .badge{display:inline-block;background:#03c75a;color:#fff;font-size:11px;font-weight:700;border-radius:4px;padding:2px 8px;margin-right:8px;vertical-align:middle}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    const slug = req.query.slug ? String(req.query.slug) : '';

    // 목록 모드 — 최신 에디토리얼 30개의 킷 링크
    if (!slug) {
      const { data: eds } = await supabaseAdmin
        .from('editorials')
        .select('slug, title, published_date')
        .eq('status', 'published')
        .not('slug', 'is', null)
        .order('published_date', { ascending: false })
        .limit(30);
      const items = (eds || []).map(e =>
        `<li><a href="/api/naver-blog-kit?slug=${encodeURIComponent(e.slug)}">${esc(e.title)}</a>
         <span style="color:#999;font-size:12px"> · ${esc(String(e.published_date || '').slice(0, 10))}</span></li>`).join('');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(page('네이버 블로그 발행 킷 — PAP Magazine',
        `<div class="tool"><h2><span class="badge">N</span>네이버 블로그 발행 킷</h2>
         에디토리얼을 클릭하면 네이버 블로그에 붙여넣을 수 있는 완성 포스트가 생성됩니다.
         <p class="hint">권장 페이스: 주 2~3회, 점심 11~13시 발행. 매번 태그를 조금씩 바꿔주세요.</p></div>
         <ul class="list">${items}</ul>`));
    }

    // 킷 모드 — 단일 에디토리얼
    const { data: e } = await supabaseAdmin
      .from('editorials')
      .select('title, title_en, slug, description, description_en, cover_image, gallery, credits, issue, published_date, tags')
      .eq('slug', slug).eq('status', 'published')
      .limit(1).maybeSingle();

    if (!e) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(page('없음', '<div class="tool">에디토리얼을 찾을 수 없습니다.</div>'));
    }

    const url = SITE + '/editorial/' + encodeURIComponent(e.slug);
    const descKo = stripHtml(e.description) || stripHtml(e.description_en);
    const gallery = Array.isArray(e.gallery) ? e.gallery.filter(u => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 8) : [];
    const cover = e.cover_image && /^https:\/\//.test(e.cover_image) ? e.cover_image : (gallery[0] || '');

    // 크레딧 텍스트 (형태 다양성 방어적 처리)
    let creditLines = [];
    try {
      const cr = e.credits;
      if (Array.isArray(cr)) {
        creditLines = cr.map(c => {
          const roles = Array.isArray(c.roles) ? c.roles.join(', ') : (c.role || '');
          const who = c.name || c.instagram || '';
          return roles && who ? roles + ' — ' + who : (who || roles);
        }).filter(Boolean);
      } else if (cr && typeof cr === 'object') {
        creditLines = Object.keys(cr).map(k => {
          const v = cr[k];
          const who = typeof v === 'string' ? v : (v && (v.name || v.instagram)) || '';
          return who ? k + ' — ' + who : '';
        }).filter(Boolean);
      }
    } catch (_) {}

    // 네이버 검색 최적화 제목: 브랜드 키워드 고정
    const blogTitle = `${e.title} — PAP매거진 ${e.issue ? e.issue + ' ' : ''}패션 에디토리얼 화보`;

    // 태그: 브랜드 고정 2 + 콘텐츠 태그
    const tagSet = ['PAP매거진', '패션화보', '패션에디토리얼']
      .concat(Array.isArray(e.tags) ? e.tags.slice(0, 4) : [])
      .filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 8);

    const bodyHtml =
      `<h1>${esc(e.title)}${e.title_en && e.title_en !== e.title ? ' (' + esc(e.title_en) + ')' : ''}</h1>` +
      (e.issue ? `<p class="credit">PAP MAGAZINE · ${esc(e.issue)}</p>` : '') +
      (cover ? `<img src="${esc(cover)}" alt="${esc(e.title)} — PAP매거진 패션 에디토리얼">` : '') +
      (descKo ? `<p>${esc(descKo)}</p>` : '') +
      gallery.filter(g => g !== cover).map((g, i) =>
        `<img src="${esc(g)}" alt="${esc(e.title)} 화보 컷 ${i + 2} — PAP매거진">`).join('') +
      (creditLines.length ? `<p class="credit"><b>CREDITS</b><br>${creditLines.map(esc).join('<br>')}</p>` : '') +
      `<p>전체 화보와 더 많은 에디토리얼은 <a href="${esc(url)}">PAP매거진 웹사이트</a>에서,` +
      ` 매일 업데이트되는 화보와 셀럽 뉴스는 <a href="${esc(IG)}">인스타그램 @pap_magazine</a>에서 만나보세요.</p>` +
      `<p class="credit">ⓒ PAP MAGAZINE (PAP매거진) — 무단 전재 및 재배포 금지</p>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(page('네이버 킷 — ' + e.title,
      `<div class="tool"><h2><span class="badge">N</span>1. 제목 (클릭하면 전체 선택)</h2>
        <div class="copybox">${esc(blogTitle)}</div></div>
       <div class="tool"><h2><span class="badge">N</span>2. 태그 (클릭하면 전체 선택)</h2>
        <div class="copybox">${tagSet.map(t => '#' + esc(t)).join(' ')}</div>
        <p class="hint">네이버 블로그 태그 입력칸에 붙여넣으세요.</p></div>
       <div class="tool"><h2><span class="badge">N</span>3. 본문 — 아래 초록 박스 안을 드래그 선택 → 복사 → 스마트에디터에 붙여넣기 (이미지 포함 이동)</h2></div>
       <div class="content">${bodyHtml}</div>
       <div class="tool"><p class="hint">발행 후 팁: 발행 직후 해당 글 주소를 서치어드바이저 '웹 페이지 수집'에 넣으면 색인이 빨라집니다.</p></div>`));
  } catch (err) {
    console.error('[naver-blog-kit] error:', err);
    return res.status(500).send('kit error');
  }
};
