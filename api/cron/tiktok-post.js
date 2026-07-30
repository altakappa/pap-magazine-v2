/**
 * PAP Magazine — TikTok 데일리 자동 게시 크론
 * Route: /api/cron/tiktok-post            (매일 11:00 KST — 에디토리얼)
 *        /api/cron/tiktok-post?kind=article (2시간마다 :30 — 기사 수시 게시)
 *
 * 에디토리얼 모드 (포토 슬라이드):
 *   1. 아직 게시 안 된 발행 에디토리얼 중 우선순위 선택
 *      — 신규(비 legacy) 최신 우선, 없으면 legacy 최신부터 (하루 1편, 스팸 방지)
 *   2. 갤러리 상위 10장 → TikTok 포토 모드 직접 게시 (PULL_FROM_URL)
 *      — 커버 제외 전 컷 하단 PAP 워드마크 스탬프
 *   3. 캡션: 제목 + 설명 첫 문장 + [Credits] + 직접 URL + 해시태그
 *   4. tiktok_posts.editorial_id 에 기록 (편당 1회 보장)
 *
 * 기사 모드 (kind=article, 067 마이그레이션 필요):
 *   — IG 수집 기사 중 갤러리 있는 최신 미게시분 1건 (영구 저장본 이미지)
 *   — 로고 스탬프 없음 (뉴스 이미지), 캡션: 제목 + 본문 첫 문장 + URL
 *   — tiktok_posts.article_id 에 기록
 *
 * 전제: /api/tiktok/oauth 1회 인증 완료 + TikTok 콘솔에서 이미지 도메인
 * (pap-magazine.com, *.supabase.co, pap-korea-bucket.s3...) URL 소유권 인증.
 * 앱 심사 전에는 SELF_ONLY(비공개) 게시 — 심사 승인 후 TIKTOK_PUBLIC=1.
 *
 * 수동 트리거: 관리자 토큰 GET/POST (?dry=1 로 선택 결과만 확인).
 */

const { withCronGuard } = require('../_lib/cronGuard');   // 실행기록·실패알림 (2026-07-30)
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { directPostPhotos, toOwnedImageUrl } = require('../_lib/tiktok');

// 크레딧 → 캡션 줄 배열. 두 스키마 모두 지원:
//   레거시 JSON:  [{r:'Photographer', h:[{n:'이름', id:'@핸들'}, …]}, …]
//   신규 어드민:  [{roles:['Photographer'], name, instagram, website}, …]
// 출력 줄: "▪ Photographer : Maren @marennl" (역할당 1줄, 이름들 ' · ' 연결)
function formatCreditLines(credits, maxChars) {
  if (!Array.isArray(credits) || !credits.length) return [];
  // 1차: 역할별로 사람 수집 (같은 역할 여러 행 — 레거시 Starring ×4 등 — 병합)
  const order = [];
  const byRole = new Map();
  function add(role, person) {
    const key = role || '';
    if (!byRole.has(key)) { byRole.set(key, []); order.push(key); }
    if (person) byRole.get(key).push(person);
  }
  for (const c of credits) {
    if (!c || typeof c !== 'object') continue;
    if (c.r !== undefined || c.h !== undefined) {
      // 레거시 스키마
      const role = String(c.r || '').trim();
      (Array.isArray(c.h) ? c.h : []).forEach((p) => {
        if (!p) return;
        const bits = [String(p.n || '').trim(), String(p.id || '').trim()].filter(Boolean);
        if (bits.length) add(role, bits.join(' '));
      });
    } else {
      // 신규 스키마
      const role = Array.isArray(c.roles) ? c.roles.filter(Boolean).join(', ') : String(c.role || '').trim();
      const bits = [String(c.name || '').trim(), String(c.instagram || '').trim()].filter(Boolean);
      if (bits.length) add(role, bits.join(' '));
    }
  }
  const lines = [];
  for (const role of order) {
    const people = byRole.get(role) || [];
    if (!people.length) continue;
    lines.push('▪ ' + (role ? role + ' : ' : '') + people.join(' · '));
  }
  // 줄 단위로 한도 내 유지 (중간 절단 방지)
  if (maxChars) {
    const kept = [];
    let len = 0;
    for (const l of lines) {
      if (len + l.length + 2 > maxChars) break;
      kept.push(l); len += l.length + 2;
    }
    return kept;
  }
  return lines;
}

// 틱톡은 API 로 넣은 줄바꿈(\n)을 클라이언트에 따라 뭉개서 표시하기도 한다.
// 대비책: ① 모든 줄을 공백+줄바꿈(' \n')으로 연결해 줄바꿈이 사라져도
// 단어가 붙지 않게 하고, ② 각 줄 앞에 구분 기호(▪/▶)를 둬 한 줄로
// 흘러도 시각적으로 구획이 유지되게 한다.
function buildCaption(ed) {
  const lines = [];
  lines.push("'" + ed.title + "' — PAP MAGAZINE editorial");
  lines.push('');
  const ko = String(ed.description || '').split(/(?<=[.!?다요])\s/)[0] || '';
  if (ko && ko.length <= 160) { lines.push(ko); lines.push(''); }
  const creditLines = formatCreditLines(ed.credits, 1800); // 4000자 한도 내 안전 몫
  if (creditLines.length) {
    lines.push('[ Credits ]');
    creditLines.forEach((l) => lines.push(l));
    lines.push('');
  }
  // 직접 URL — 클릭은 안 되지만 복사·검색 가능한 명시적 출처 (표기는 짧게)
  lines.push('▶ 전체 화보 : pap-magazine.com/editorial/' + (ed.slug || ''));
  lines.push('');
  const tt = String(ed.title || '').replace(/[^A-Za-z0-9가-힣]/g, '').toUpperCase();
  const tags = ['#패션화보', '#에디토리얼'];
  if (tt.length >= 2 && tt.length <= 25) tags.push('#' + tt);
  tags.push('#FASHIONEDITORIAL', '#PAPMAGAZINE');
  lines.push(tags.slice(0, 5).join(' '));
  // U+2028 (LINE SEPARATOR): 틱톡이 API 캡션의 \n 을 뭉개는 것이 확인돼
  // (2026-07-06 실측) 유니코드 줄구분자로 대체 — 다수 클라이언트에서
  // 실제 줄바꿈으로 렌더된다. 미지원 클라이언트에서도 공백처럼 표시돼
  // 앞뒤 공백 + ▪/▶ 구분 기호 덕에 가독성이 유지된다.
  return lines.join('  ').slice(0, 4000);
}

module.exports = withCronGuard('tiktok-post', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  // 심사 승인 전 대기 모드: 미심사 앱은 공개 계정에 게시 불가하므로
  // 크론 자동 실행은 TIKTOK_PUBLIC=1 설정 후에만 가동 (관리자 수동은 허용 —
  // 샌드박스 테스트용). 승인되면 env 추가만으로 즉시 가동된다.
  if (cronOk && process.env.TIKTOK_PUBLIC !== '1') {
    return res.status(200).json({ ok: true, note: '심사 승인 대기 — TIKTOK_PUBLIC=1 설정 시 자동 게시 시작' });
  }

  try {
    // 게시 처리 상태 조회: ?check=<publish_id>
    // (PULL_FROM_URL 은 비동기 — 제출 후 다운로드·검증 단계에서 실패할 수 있어
    //  status/fetch 로 PROCESSING_DOWNLOAD / PUBLISH_COMPLETE / FAILED 확인)
    if (req.query && req.query.check) {
      const { getAccessToken } = require('../_lib/tiktok');
      const token = await getAccessToken();
      const r = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ publish_id: String(req.query.check) }),
        signal: AbortSignal.timeout(15000),
      });
      return res.status(200).json(await r.json());
    }

    const kind = (req.query && req.query.kind) === 'article' ? 'article' : 'editorial';

    // 이미 게시된 콘텐츠 id 집합 — 실패(failed) 기록은 제외해 재시도 허용
    // (계정 비공개 미전환·일시 오류 등으로 실패한 편이 영구 건너뜀 되지 않게)
    const idCol = kind === 'article' ? 'article_id' : 'editorial_id';
    const { data: posted } = await supabaseAdmin.from('tiktok_posts').select(idCol + ', status').limit(5000);
    const done = new Set((posted || []).filter((p) => p.status !== 'failed').map((p) => p[idCol]).filter(Boolean));

    // ── 기사 모드 ─────────────────────────────────────────────
    // 수시 게시(2시간 주기): 신선도 창(최근 3일) 안의 미게시 기사만 1건씩.
    // 오래된 백로그가 쏟아지는 것을 막고, 새 뉴스는 수집 후 몇 시간 내 게시.
    if (kind === 'article') {
      const freshCutoff = new Date(Date.now() - 3 * 86400000).toISOString();
      const { data: arts } = await supabaseAdmin.from('articles')
        .select('id, title, slug, custom_url, content, gallery, thumbnail_url, category')
        .eq('status', 'published')
        .gte('published_date', freshCutoff)
        .order('published_date', { ascending: false }).limit(200);
      const art = (arts || []).find((a) =>
        !done.has(a.id) && Array.isArray(a.gallery) && a.gallery.length >= 1);
      if (!art) return res.status(200).json({ ok: true, kind, note: '게시할 기사 없음' });

      // 뉴스 이미지에는 로고 스탬프 없음 (자사 화보가 아닌 보도 이미지)
      const photos = (art.gallery || [])
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 10)
        .map((u) => toOwnedImageUrl(u));
      const artUrl = 'pap-magazine.com/article/' + (art.custom_url || art.slug || '');
      const firstSentence = String(art.content || '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        .split(/(?<=[.!?다요])\s/)[0] || '';
      const capLines = [art.title + ' — PAP MAGAZINE', ''];
      if (firstSentence && firstSentence.length <= 200) { capLines.push(firstSentence); capLines.push(''); }
      capLines.push('▶ 기사 전문 : ' + artUrl);
      capLines.push('');
      capLines.push(['#PAPMAGAZINE', '#패션뉴스', art.category ? '#' + String(art.category).replace(/[^A-Za-z0-9가-힣]/g, '').toUpperCase() : null].filter(Boolean).join(' '));
      const caption = capLines.join('  ').slice(0, 4000);

      if (req.query && req.query.dry === '1') {
        return res.status(200).json({ ok: true, dry: true, kind, pick: { title: art.title, photos: photos.length }, caption });
      }

      const shortTitle = (art.title + ' — PAP MAGAZINE').slice(0, 90);
      let publishId = null; let status = 'submitted'; let detail = null;
      try {
        publishId = await directPostPhotos(photos, shortTitle, caption);
      } catch (err) {
        status = 'failed';
        detail = String(err && err.message || err).slice(0, 400);
      }
      // 미심사 앱 방어: TIKTOK_PUBLIC 이 심사 승인 전에 실수로 켜져 있으면 공개
      // 게시가 거부된다(unaudited_client_can_only_post_to_private_accounts).
      // 이때는 '실패'로 기록·알림하지 않고 조용히 보류한다(심사 승인 후 자동 재개).
      if (status === 'failed' && detail && detail.indexOf('unaudited_client_can_only_post_to_private_accounts') !== -1) {
        return res.status(200).json({ ok: true, kind, note: 'TikTok 앱 심사 전 — 공개 게시 보류. 심사 승인 후에만 TIKTOK_PUBLIC=1 유지.' });
      }
      await supabaseAdmin.from('tiktok_posts').upsert({
        article_id: art.id, publish_id: publishId, status, detail,
      }, { onConflict: 'article_id' });

      if (status === 'failed') return res.status(502).json({ error: 'tiktok article post failed', title: art.title, detail });
      return res.status(200).json({ ok: true, kind, posted: art.title, publish_id: publishId, photos: photos.length });
    }
    // ── 에디토리얼 모드 (기본) ────────────────────────────────

    // 후보: 신규 우선 → legacy. 갤러리 2장 이상 필수 (포토 모드 품질)
    async function pickFrom(legacyFlag) {
      const { data } = await supabaseAdmin.from('editorials')
        .select('id, title, slug, description, gallery, cover_image, legacy, credits')
        .eq('status', 'published').eq('legacy', legacyFlag)
        .order('published_date', { ascending: false }).limit(200);
      return (data || []).find((e) => !done.has(e.id) && Array.isArray(e.gallery) && e.gallery.length >= 2);
    }
    const ed = (await pickFrom(false)) || (await pickFrom(true));
    if (!ed) return res.status(200).json({ ok: true, note: '게시할 에디토리얼 없음 (전량 완료)' });

    // 인증 도메인(pap-magazine.com) 경유 — PULL_FROM_URL 요건.
    // 브랜딩: 커버(첫 장)는 원본 그대로, 나머지 갤러리 컷은 하단 중앙에
    // PAP 워드마크 스탬프 (어드민 인스타 생성기 QA #261 과 동일 규격).
    const photos = [ed.cover_image].concat(ed.gallery || [])
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 10)
      .map((u, i) => toOwnedImageUrl(u, { logo: i > 0 }));
    const caption = buildCaption(ed);

    if (req.query && req.query.dry === '1') {
      return res.status(200).json({ ok: true, dry: true, pick: { title: ed.title, slug: ed.slug, legacy: ed.legacy, photos: photos.length }, caption });
    }

    // 포토 게시: title(짧은 제목 ≤90자)과 description(캡션) 분리 필수
    const shortTitle = ("'" + ed.title + "' — PAP MAGAZINE").slice(0, 90);
    let publishId = null; let status = 'submitted'; let detail = null;
    try {
      publishId = await directPostPhotos(photos, shortTitle, caption);
    } catch (err) {
      status = 'failed';
      detail = String(err && err.message || err).slice(0, 400);
    }
    // 미심사 앱 방어(에디토리얼): 위와 동일 — 심사 전 공개거부는 보류 처리.
    if (status === 'failed' && detail && detail.indexOf('unaudited_client_can_only_post_to_private_accounts') !== -1) {
      return res.status(200).json({ ok: true, note: 'TikTok 앱 심사 전 — 공개 게시 보류. 심사 승인 후에만 TIKTOK_PUBLIC=1 유지.' });
    }
    // upsert — 이전 실패 기록이 있는 편의 재시도 시 UNIQUE(editorial_id) 충돌 방지
    await supabaseAdmin.from('tiktok_posts').upsert({
      editorial_id: ed.id, publish_id: publishId, status, detail,
    }, { onConflict: 'editorial_id' });

    if (status === 'failed') return res.status(502).json({ error: 'tiktok post failed', title: ed.title, detail });
    return res.status(200).json({ ok: true, posted: ed.title, publish_id: publishId, photos: photos.length });
  } catch (err) {
    console.error('[tiktok-post] error:', err);
    return res.status(500).json({ error: 'tiktok cron failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}, { silenceTransient: true });
