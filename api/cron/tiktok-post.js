/**
 * PAP Magazine — TikTok 데일리 자동 게시 크론  (Buffer 경유, 2026-08-07 전환)
 * Route: /api/cron/tiktok-post            (매일 11:00 KST — 에디토리얼)
 *        /api/cron/tiktok-post?kind=article (2시간마다 :30 — 기사 수시 게시)
 *
 * ── 2026-08-07 전환 이력 (중요) ────────────────────────────────
 * 이 크론은 원래 TikTok Content Posting API 로 직접 게시(DIRECT_POST)했다.
 * 그런데 2026-07-10 TikTok 앱 심사가 '거절'됐다. 서류 미비가 아니라 정책 거절이다:
 *   "App will not be approved for personal or company internal use.
 *    TikTok for Developers currently does not support personal or internal company use."
 * → 재신청해도 video.publish 스코프는 영구히 못 받는다. 직접 게시 경로는 사망.
 *
 * 게다가 옛 코드는 TIKTOK_PUBLIC!=='1' 일 때 note 를 JSON 으로만 반환하고
 * res.locals.cronNote 에 안 넣어서, cron_runs 에 '성공·메모 없음'만 21일간 쌓였다.
 * "돌았다 ≠ 생산했다" — 이번엔 모든 조기 반환에 cronNote 를 남긴다.
 *
 * 지금 경로: 우리 서버 → Buffer(공식 TikTok 파트너) → TikTok 자동 게시.
 * Buffer 무료 플랜에서 schedulingType='automatic' 이 실제로 선택 가능함을
 * 2026-08-07 크롬으로 직접 확인했다. mode='shareNow' 라 예약 큐 10건 상한도 무관.
 *
 * 에디토리얼 모드 (포토 슬라이드):
 *   1. 아직 게시 안 된 발행 에디토리얼 중 우선순위 선택
 *      — 신규(비 legacy) 최신 우선, 없으면 legacy 최신부터 (하루 1편, 스팸 방지)
 *   2. 갤러리 상위 10장 → Buffer 포토 게시 (커버 제외 전 컷 하단 PAP 워드마크)
 *   3. 캡션: 제목 + 설명 첫 문장 + [Credits] + 직접 URL + 해시태그
 *   4. tiktok_posts.editorial_id 에 기록 (편당 1회 보장)
 *
 * 기사 모드 (kind=article):
 *   — IG 수집 기사 중 갤러리 있는 최신 미게시분 1건 (영구 저장본 이미지)
 *   — 로고 스탬프 없음 (뉴스 이미지), 캡션: 제목 + 본문 첫 문장 + URL
 *   — tiktok_posts.article_id 에 기록
 *
 * 전제: BUFFER_API_KEY 등록 + Buffer 에 TikTok 채널 연결.
 *   이미지는 Buffer 가 공개 HTTPS 직링크만 받으므로 toOwnedImageUrl() 로
 *   www.pap-magazine.com/api/img 프록시를 태운다 (기존과 동일).
 *
 * 진단: ?dry=1 선택 결과만 · ?channels=1 Buffer 연결 채널 목록.
 */

const { bearerOk } = require('../_lib/secretCompare');
const { HTML_TAG_RE, dropKnownTags } = require('../_lib/stripHtml');
const { withCronGuard } = require('../_lib/cronGuard');   // 실행기록·실패알림 (2026-07-30)
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { toOwnedImageUrl } = require('../_lib/tiktok');
const { IG_HANDLE_URL } = require('../_lib/igFirstLink');
const buffer = require('../_lib/buffer');

// TikTok 캡션 상한. TikTok API 자체는 4000자지만 Buffer 를 거치면 2200자다.
const CAPTION_MAX = 2200;
const CREDITS_BUDGET = 1200;   // 캡션 안에서 크레딧이 먹을 수 있는 최대 몫

// 조기 반환마다 cron_runs 에 남길 메모를 반드시 세운다.
// (이 한 줄이 없어서 21일간 무음 실패했다 — 절대 빼지 말 것)
function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

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
// 대비책: ① 모든 줄을 공백 두 칸으로 연결해 줄바꿈이 사라져도 단어가 붙지 않게 하고,
// ② 각 줄 앞에 구분 기호(▪/▶)를 둬 한 줄로 흘러도 시각적으로 구획이 유지되게 한다.
function buildCaption(ed) {
  const lines = [];
  lines.push("'" + ed.title + "' — PAP MAGAZINE editorial");
  lines.push('');
  const ko = String(ed.description || '').split(/(?<=[.!?다요])\s/)[0] || '';
  if (ko && ko.length <= 160) { lines.push(ko); lines.push(''); }
  const creditLines = formatCreditLines(ed.credits, CREDITS_BUDGET);
  if (creditLines.length) {
    lines.push('[ Credits ]');
    creditLines.forEach((l) => lines.push(l));
    lines.push('');
  }
  /* 2026-09-03 — 인스타가 먼저. 도메니코: "모든 사이트에서의 주 도달은
     웹사이트가 아닌 인스타그램이고 서브 도달은 웹사이트입니다."
     틱톡 캡션의 URL 은 클릭이 안 된다 — 계측도 불가능하다. 남는 수단이
     "눈으로 읽고 찾아가게 하는 것"뿐이라 **먼저 오는 줄이 곧 우선순위**다. */
  lines.push('▶ 인스타그램 : ' + IG_HANDLE_URL);
  // 직접 URL — 클릭은 안 되지만 복사·검색 가능한 명시적 출처 (표기는 짧게)
  lines.push('▶ 전체 화보 : pap-magazine.com/editorial/' + (ed.slug || ''));
  lines.push('');
  const tt = String(ed.title || '').replace(/[^A-Za-z0-9가-힣]/g, '').toUpperCase();
  const tags = ['#패션화보', '#에디토리얼'];
  if (tt.length >= 2 && tt.length <= 25) tags.push('#' + tt);
  tags.push('#FASHIONEDITORIAL', '#PAPMAGAZINE');
  lines.push(tags.slice(0, 5).join(' '));
  return lines.join('  ').slice(0, CAPTION_MAX);
}

// Buffer 로 포토 캐러셀 1건 게시. 성공 시 Buffer post 객체 반환.
async function publishViaBuffer(photos, title, caption) {
  const channelId = await buffer.findChannelId('tiktok');
  return buffer.createImagePost({
    channelId,
    text: caption,
    title,
    imageUrls: photos,
    mode: 'shareNow',      // 큐를 안 쓴다 — 무료 플랜 예약 10건 상한 회피
    maxImages: 10,         // TikTok 캐러셀 상한
    maxText: CAPTION_MAX,
  });
}

module.exports = withCronGuard('tiktok-post', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  // 키 미설정은 '실패'가 아니라 '미구성'이다. 단, 반드시 흔적을 남긴다.
  if (!buffer.isConfigured()) {
    return res.status(200).json({ ok: true, note: note(res, 'BUFFER_API_KEY 미설정 — 게시 건너뜀') });
  }

  try {
    // 진단: Buffer 에 어떤 채널이 붙어 있는지 (틱톡 연결 확인용)
    if (req.query && req.query.channels === '1') {
      const chans = await buffer.listChannels();
      return res.status(200).json({
        ok: true,
        note: note(res, 'Buffer 채널 ' + chans.length + '개'),
        channels: chans.map((c) => ({ id: c.id, name: c.name, service: c.service })),
      });
    }

    const kind = (req.query && req.query.kind) === 'article' ? 'article' : 'editorial';

    /* ── 기사 모드 중지 (2026-08-13 도메니코 결정) ─────────────────────
     * 왜: 기사 갤러리는 브랜드·에이전시·타 매체가 만든 제3자 이미지다.
     * 우리가 편집한 자사 화보가 아니다. 이걸 워터마크도 출처 표기도 없이
     * 2시간마다 자동 게시하고 있었다 (누적 45건).
     *
     * TikTok 정책 두 갈래에 모두 걸린다:
     *   - 지식재산권: 권한 없는 타인 사진 게시는 삭제 대상, 반복 시 계정 정지
     *   - 미오리지널 콘텐츠: 타 출처 재게시는 FYP 추천에서 제외
     * 실측도 이와 일관됐다 — 30일간 social_inclicks 의 tiktok 유입 0건.
     * 얻는 것이 0이고 걸리는 것이 계정이라 계산이 맞지 않는다.
     *
     * 크론(vercel.json)에서도 뺐지만, 여기서 한 번 더 막는다. 크론만 지우면
     * 누군가 URL 을 직접 부르거나 스케줄을 되살릴 때 조용히 재개된다.
     * 되살리려면 이 상수를 바꾸는 의도적 코드 변경이 필요하다 — 그때는
     * 워터마크·출처 표기·재배포 권한 확인이 선행돼야 한다.
     * 영상 경로(drive-tiktok-post)와 에디토리얼 사진 모드는 그대로 돈다. */
    const ARTICLE_MODE_ENABLED = false;
    if (kind === 'article' && !ARTICLE_MODE_ENABLED) {
      return res.status(200).json({ ok: true, kind, disabled: true,
        note: note(res, '기사 모드 중지 — 제3자 이미지 재게시 위험 (2026-08-13). 에디토리얼·영상만 게시한다.') });
    }

    // 이미 게시된 콘텐츠 id 집합 — 실패(failed) 기록은 제외해 재시도 허용
    const idCol = kind === 'article' ? 'article_id' : 'editorial_id';
    const { data: posted } = await supabaseAdmin.from('tiktok_posts').select(idCol + ', status').limit(5000);
    const done = new Set((posted || []).filter((p) => p.status !== 'failed').map((p) => p[idCol]).filter(Boolean));

    // ── 기사 모드 ─────────────────────────────────────────────
    // 수시 게시(2시간 주기): 신선도 창(최근 3일) 안의 미게시 기사만 1건씩.
    if (kind === 'article') {
      const freshCutoff = new Date(Date.now() - 3 * 86400000).toISOString();
      const { data: arts } = await supabaseAdmin.from('articles')
        .select('id, title, slug, custom_url, content, gallery, thumbnail_url, category')
        .eq('status', 'published')
        .gte('published_date', freshCutoff)
        .order('published_date', { ascending: false }).limit(200);
      const art = (arts || []).find((a) =>
        !done.has(a.id) && Array.isArray(a.gallery) && a.gallery.length >= 1);
      if (!art) {
        return res.status(200).json({ ok: true, kind, note: note(res, '게시할 기사 없음 (최근 3일 내 미게시분 0건)') });
      }

      // 뉴스 이미지에는 로고 스탬프 없음 (자사 화보가 아닌 보도 이미지)
      const photos = (art.gallery || [])
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 10)
        .map((u) => toOwnedImageUrl(u));
      const artUrl = 'pap-magazine.com/article/' + (art.custom_url || art.slug || '');
      const firstSentence = String(art.content || '')
        .replace(HTML_TAG_RE, dropKnownTags(' ')).replace(/\s+/g, ' ').trim()
        .split(/(?<=[.!?다요])\s/)[0] || '';
      const capLines = [art.title + ' — PAP MAGAZINE', ''];
      if (firstSentence && firstSentence.length <= 200) { capLines.push(firstSentence); capLines.push(''); }
      /* 2026-09-03 — 인스타가 먼저 (도메니코: 주 도달은 인스타). */
      capLines.push('▶ 인스타그램 : ' + IG_HANDLE_URL);
      capLines.push('▶ 기사 전문 : ' + artUrl);
      capLines.push('');
      capLines.push(['#PAPMAGAZINE', '#패션뉴스', art.category ? '#' + String(art.category).replace(/[^A-Za-z0-9가-힣]/g, '').toUpperCase() : null].filter(Boolean).join(' '));
      const caption = capLines.join('  ').slice(0, CAPTION_MAX);

      if (req.query && req.query.dry === '1') {
        return res.status(200).json({ ok: true, dry: true, kind, note: note(res, 'dry: ' + art.title), pick: { title: art.title, photos: photos.length }, caption });
      }

      const shortTitle = (art.title + ' — PAP MAGAZINE').slice(0, 90);
      let post = null; let status = 'submitted'; let detail = null;
      try {
        post = await publishViaBuffer(photos, shortTitle, caption);
        detail = 'buffer:' + String(post && post.status || '');
      } catch (err) {
        status = 'failed';
        detail = String(err && err.message || err).slice(0, 400);
      }
      /* ── 기록 실패는 게시 실패보다 위험하다 (2026-08-09 사고) ──────────
       * article_id 의 유니크 인덱스가 **부분 인덱스**(WHERE article_id IS NOT NULL)
       * 였다. Postgres 의 ON CONFLICT 는 부분 인덱스를 술어(predicate) 없이는
       * 못 고른다 — PostgREST 는 술어를 못 붙이므로 이 upsert 는 **매번 42P10 으로
       * 실패**했다. 그런데 오류를 안 봤다. 그래서 '게시는 됐는데 기록은 없는'
       * 상태가 반복됐고, 2시간마다 같은 기사가 또 나갔다:
       * 6편이 17번 게시(최다 5회). 인덱스는 전체 유니크로 바꿔 고쳤고,
       * 여기서는 **두 번 다시 조용히 넘어가지 않도록** 오류를 크게 운다.
       * 게시 실패보다 심각하게 다룬다 — 밖으로 이미 나갔기 때문이다. */
      const { error: writeErr } = await supabaseAdmin.from('tiktok_posts').upsert({
        article_id: art.id, publish_id: post && post.id || null, status, detail,
      }, { onConflict: 'article_id' });
      if (writeErr) {
        const m = String(writeErr.message || writeErr).slice(0, 200);
        note(res, '\u26a0\ufe0f 게시됐으나 기록 실패 — 중복게시 위험: ' + art.title + ' — ' + m);
        return res.status(500).json({ error: 'tiktok article post recorded failed', title: art.title, detail: m });
      }

      if (status === 'failed') {
        note(res, '기사 게시 실패: ' + art.title + ' — ' + detail);
        return res.status(502).json({ error: 'tiktok article post failed', title: art.title, detail });
      }
      return res.status(200).json({
        ok: true, kind, posted: art.title, publish_id: post.id, photos: photos.length,
        note: note(res, '기사 1건 게시: ' + art.title + ' (' + photos.length + '장)'),
      });
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
    if (!ed) {
      return res.status(200).json({ ok: true, note: note(res, '게시할 에디토리얼 없음 (전량 완료)') });
    }

    // 브랜딩: 커버(첫 장)는 원본 그대로, 나머지 갤러리 컷은 하단 중앙에
    // PAP 워드마크 스탬프 (어드민 인스타 생성기 QA #261 과 동일 규격).
    const photos = [ed.cover_image].concat(ed.gallery || [])
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 10)
      .map((u, i) => toOwnedImageUrl(u, { logo: i > 0 }));
    const caption = buildCaption(ed);

    if (req.query && req.query.dry === '1') {
      return res.status(200).json({ ok: true, dry: true, note: note(res, 'dry: ' + ed.title), pick: { title: ed.title, slug: ed.slug, legacy: ed.legacy, photos: photos.length }, caption });
    }

    // 포토 게시: title(짧은 제목 ≤90자)과 캡션(text)은 분리 필드
    const shortTitle = ("'" + ed.title + "' — PAP MAGAZINE").slice(0, 90);
    let post = null; let status = 'submitted'; let detail = null;
    try {
      post = await publishViaBuffer(photos, shortTitle, caption);
      detail = 'buffer:' + String(post && post.status || '');
    } catch (err) {
      status = 'failed';
      detail = String(err && err.message || err).slice(0, 400);
    }
    // upsert — 이전 실패 기록이 있는 편의 재시도 시 UNIQUE(editorial_id) 충돌 방지
    const { error: edWriteErr } = await supabaseAdmin.from('tiktok_posts').upsert({
      editorial_id: ed.id, publish_id: post && post.id || null, status, detail,
    }, { onConflict: 'editorial_id' });
    /* 기사 모드와 같은 이유. editorial_id 는 전체 유니크라 지금은 문제가 없지만,
       '기록 실패 = 다음 실행이 또 올린다' 는 구조는 여기도 똑같다. */
    if (edWriteErr) {
      const m = String(edWriteErr.message || edWriteErr).slice(0, 200);
      note(res, '\u26a0\ufe0f 게시됐으나 기록 실패 — 중복게시 위험: ' + ed.title + ' — ' + m);
      return res.status(500).json({ error: 'tiktok post recorded failed', title: ed.title, detail: m });
    }

    if (status === 'failed') {
      note(res, '에디토리얼 게시 실패: ' + ed.title + ' — ' + detail);
      return res.status(502).json({ error: 'tiktok post failed', title: ed.title, detail });
    }
    return res.status(200).json({
      ok: true, posted: ed.title, publish_id: post.id, photos: photos.length,
      note: note(res, '에디토리얼 1건 게시: ' + ed.title + ' (' + photos.length + '장)'),
    });
  } catch (err) {
    console.error('[tiktok-post] error:', err);
    note(res, '크론 예외: ' + String(err && err.message || err).slice(0, 200));
    return res.status(500).json({ error: 'tiktok cron failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}, { silenceTransient: true });

// 테스트용 노출 (게시 없이 캡션·크레딧 로직만 검증)
module.exports.buildCaption = buildCaption;
module.exports.formatCreditLines = formatCreditLines;
module.exports.CAPTION_MAX = CAPTION_MAX;
