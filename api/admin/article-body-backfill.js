/**
 * GET /api/admin/article-body-backfill 상위 노출 기사 본문 보강 (관리자 전용)
 *
 * 왜 만들었나 (2026-08-17, GSC 30일 실측):
 *   노출의 89.6%가 4~10위에 갇혀 있고 그 구간 CTR 은 1.27% 다. 1~3위 키워드는
 *   392개(10.5%)뿐인데 클릭의 56.5%를 만든다. 원인은 콘텐츠 두께였다.
 *   발행 2,371편 본문 평균 545자, 72.5%가 600자 미만.
 *   커밋 016fecf 로 신규 기사는 800~1,200자로 올렸지만 기존 기사는 그대로다.
 *   이 도구는 그중 **노출이 실제로 나오고 있는 상위 31편만** 골라 보강한다.
 *
 * 왜 생성과 적용을 분리했나:
 *   이건 신규 발행이 아니라 **이미 구글에 색인된 본문을 바꾸는 일**이다.
 *   자동으로 덮어쓰면 되돌릴 수 없고, 저장소 규칙상 발행 판단은 도메니코 몫이다.
 *   그래서 생성은 status='draft' 로만 쌓고, articles.content 반영은
 *   ?apply= 를 사람이 눌러야 일어난다. old_body 는 적용 직전 원본을 통째로
 *   보관하므로 언제든 되돌릴 수 있다.
 *
 *   ?queue=1                     대기·초안 목록
 *   ?generate_next=1             다음 1건 초안 생성 (노출 큰 순)
 *   ?stored=1&id=<article_id>    초안 단건 조회 (원본 대조용)
 *   ?apply=1&id=<article_id>     articles.content 에 반영 (사람이 누른다)
 *   ?reject=1&id=<article_id>    반려
 *   ?revert=1&id=<article_id>    적용 취소, old_body 로 복원
 */

const { HTML_TAG_RE, dropKnownTags } = require('../_lib/stripHtml');
const { reportAiFailure } = require('../_lib/aiCreditWatch');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const papVoice = require('../_lib/papVoice');

const TABLE = 'article_body_backfill';

function plain(s) {
  return String(s || '').replace(HTML_TAG_RE, dropKnownTags(' ')).replace(/\s+/g, ' ').trim();
}

/* 갤러리 이미지를 비전 블록으로. 분량을 늘리려면 **실제 근거**가 있어야 한다.
 * 기존 본문만 주고 "길게 써라" 하면 모델이 형용사로 채우거나 없는 사실을 만든다.
 * 이미지는 우리가 이미 가진 1차 자료라, 거기서 읽어낸 것만 더하게 한다.
 * 3장까지만 쓴다. Vercel 함수 시간과 이미지 다운로드가 비용의 대부분이다. */
async function visionBlocks(gallery) {
  const out = [];
  const urls = (Array.isArray(gallery) ? gallery : []).slice(0, 3);
  for (const u of urls) {
    if (typeof u !== 'string' || !/^https?:\/\//.test(u)) continue;
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const mt = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!/^image\//.test(mt)) continue;           // mp4 를 넣으면 API 400 으로 전체 실패
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 4 * 1024 * 1024) continue;    // 과대 이미지는 건너뛴다
      out.push({ type: 'image', source: { type: 'base64', media_type: mt, data: buf.toString('base64') } });
    } catch (_) { /* 이미지 하나 실패는 무시한다 */ }
  }
  return out;
}

const TOOL = {
  name: 'emit_body',
  description: '보강한 기사 본문을 제출한다.',
  input_schema: {
    type: 'object',
    properties: {
      body_ko: { type: 'string', description: '보강된 한국어 본문. 단락은 <br><br> 로 구분.' },
      added: { type: 'string', description: '무엇을 근거로 무엇을 더했는지 한 줄. 검수용.' },
      /* 2026-08-18 신설 — 사람이 무엇을 대조해야 하는지 가르는 유일한 단서다.
         출력만 보고 자동으로 판별하려다 실패했다(마이그레이션 130 참고).
         무엇을 근거로 썼는지는 모델만 안다. 그래서 물어본다. */
      reads_image_text: {
        type: 'boolean',
        description: '사진 안에 인쇄된 글자(사람 이름·브랜드명·날짜·수치·계정명·라인업·가격 등)를 '
          + '읽어서 본문에 옮겼으면 true. 색·소재감·실루엣·배경·포즈처럼 글자가 아닌 것만 '
          + '묘사했으면 false. 애매하면 true 로 한다 — 사람이 한 번 더 보는 비용이 '
          + '틀린 이름이 발행되는 비용보다 훨씬 싸다.',
      },
      image_text: {
        type: 'string',
        description: 'reads_image_text 가 true 일 때, 사진에서 읽은 글자를 **본 그대로** 적는다. '
          + '한국어로 옮기지 말고 화면에 인쇄된 표기 그대로. (예: "NGHTMRE", "J.Y. PARK", '
          + '"@confidenceheist", "South Korea, 1999 - 2004") false 면 빈 문자열.',
      },
    },
    required: ['body_ko', 'added', 'reads_image_text', 'image_text'],
  },
};

async function generateBody(art) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수 누락.');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const imgs = await visionBlocks(art.gallery);

  const prompt = [
    '너는 PAP 매거진의 한국어 에디터다. 아래는 이미 발행되어 구글에 색인된 기사다.',
    '이 기사의 본문이 너무 짧아 검색 순위가 안 나온다. 본문을 보강하라.',
    '',
    '절대 규칙 (어기면 이 작업은 실패다):',
    '1) **기존 본문의 사실을 하나도 바꾸지 마라.** 이미 색인된 글이다. 더하기만 한다.',
    '2) **없는 사실을 지어내지 마라.** 근거는 딱 두 가지뿐이다:',
    '   기존 본문에 이미 있는 내용, 그리고 함께 준 사진에서 눈으로 확인되는 것.',
    '   날짜·수치·인용·장소를 새로 만들어내는 것은 절대 금지다.',
    '3) 사진에서 읽어낸 것은 단정하지 말고 보이는 그대로만 쓴다.',
    '   (예: 옷의 실루엣·색·소재감·배경·연출 방식)',
    '4) 더 쓸 근거가 정말 없으면 800자에 못 미쳐도 된다. **지어내는 것보다 짧은 게 낫다.**',
    '5) 기존 본문의 첫 문장(리드)과 마지막 문장(클로징)의 역할은 유지한다.',
    /* 2026-08-18 — 주류 기사의 과음 경고는 국민건강증진법이 문안까지 정해 둔
       것이라 '~합니다' 를 '~한다' 로 바꾸면 법정 문구가 아니게 된다.
       아래 ARTICLE_VOICE 의 "존댓말 절대 금지" 보다 이 규칙이 위다. */
    '6) **법으로 문안이 정해진 고지 문장은 한 글자도 바꾸지 마라.** 그대로 옮긴다.',
    '   (주류 과음·임신 중 음주 경고, 19세 미만 표기, 음주운전 경고 등)',
    '   이 문장들만은 존댓말이어도 평서체로 고치지 않는다. 삭제도 금지다.',
    '',
    papVoice.ARTICLE_VOICE,
    '',
    '위 문체 규칙의 유일한 예외는 절대 규칙 6) 의 법정 고지 문장이다.',
    '',
    '기사 제목: ' + art.title,
    '카테고리: ' + (art.category || '-'),
    '태그: ' + JSON.stringify(art.tags || []),
    '기존 본문(HTML):',
    '"""',
    String(art.content || ''),
    '"""',
    imgs.length ? '함께 준 사진 ' + imgs.length + '장은 이 기사의 실제 게시 이미지다.' : '사진 없음. 기존 본문만으로 판단하라.',
    '',
    'emit_body 도구로 제출하라. added 에는 "무엇을 근거로 무엇을 더했는지"를 한 줄로 적는다.',
    '',
    /* 2026-08-18 — 워터밤 초안이 라인업 포스터에서 이름 4개를 잘못 읽었다.
       린터는 문체만 보므로 경보가 0건이었다. 사람이 무엇을 대조해야 하는지
       가려 주는 것은 이 신고뿐이다. */
    'reads_image_text 는 정직하게 답하라. 사진 안에 **인쇄된 글자**를 읽어 본문에',
    '옮겼으면 true 다. 포스터의 출연진 이름, 티저의 날짜, 패키지의 제품명,',
    '캡션 카드의 계정명·연도, 가격표의 숫자가 전부 여기 해당한다.',
    '옷 색·소재감·실루엣·배경·포즈처럼 글자가 아닌 것만 묘사했으면 false 다.',
    '**애매하면 true 로 하라.** 사람이 한 번 더 보는 비용이, 틀린 이름이',
    '발행되는 비용보다 훨씬 싸다. true 면 image_text 에 읽은 글자를 본 그대로 적는다.',
  ].join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 5000,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: imgs.concat([{ type: 'text', text: prompt }]) }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    await reportAiFailure(res.status, t, 'article-body-backfill');
    throw new Error('Claude API ' + res.status);
  }
  const j = await res.json();
  const tu = (Array.isArray(j.content) ? j.content : []).find(c => c && c.type === 'tool_use');
  if (!tu || !tu.input || !tu.input.body_ko) throw new Error('본문을 얻지 못함');
  return {
    body: String(tu.input.body_ko),
    added: String(tu.input.added || ''),
    readsImageText: tu.input.reads_image_text === true,
    imageText: String(tu.input.image_text || '').slice(0, 500),
  };
}

/* 생성물이 규격을 지켰는지 기계로 본다.
 * 통과 못 해도 버리지 않고 note 에 남긴다. 사람이 보고 판단할 값이다.
 * 여기서 자동 폐기하면 오탐 하나로 큐가 멎는다. */
function checkBody(oldBody, newBody) {
  const o = plain(oldBody), n = plain(newBody);
  const issues = papVoice.lintKoreanBody(newBody, { style: 'plain', structure: true, maxParas: 5, maxLen: 1100 });
  if (n.length <= o.length) issues.push('보강 안 됨 (' + o.length + ' → ' + n.length + '자)');
  if (n.length < 800) issues.push('800자 미만 (' + n.length + '자)');
  return issues;
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const q = req.query || {};

  try {
    if (q.queue === '1') {
      const { data, error } = await supabaseAdmin.from(TABLE)
        .select('article_id, impressions, old_len, new_len, status, note, generated_at, applied_at')
        .order('status', { ascending: true }).order('impressions', { ascending: false }).limit(200);
      if (error) throw error;
      return res.status(200).json({ queue: data || [] });
    }

    /* ── 검토 화면 (2026-08-18 신설) ────────────────────────────────
     *
     * 왜 필요했나: 2026-08-16 에 이 도구를 만들고 하루 반 동안 **한 번도
     * 안 돌렸다.** 오늘 31편을 생성하고 나서야 이유를 알았다 — 적용 판단은
     * 사람이 하게 설계해 놓고, 정작 **판단할 화면을 안 만들었다.**
     * JSON 을 31번 열어 보라는 건 안 하겠다는 말과 같다.
     *
     * 그래서 좌우 비교 한 장으로 만든다. 적용 버튼은 두지 않는다 —
     * 적용은 되돌릴 수 있어도 색인은 되돌릴 수 없으므로, 링크를 눌러
     * 한 건씩 의도적으로 하게 둔다. 실수로 31편이 한 번에 바뀌지 않는다. */
    if (q.review === '1') {
      const { data: rows } = await supabaseAdmin.from(TABLE)
        .select('article_id, impressions, old_body, new_body, note, status, generated_at, applied_at, reads_image_text, image_text_note')
        .order('impressions', { ascending: false }).limit(200);
      const list = rows || [];
      const ids = list.map((r) => r.article_id);
      const { data: arts } = ids.length
        ? await supabaseAdmin.from('articles').select('id, title, slug').in('id', ids)
        : { data: [] };
      const byId = new Map((arts || []).map((a) => [a.id, a]));

      const esc = (t) => String(t == null ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const plain = (h) => String(h || '').replace(HTML_TAG_RE, dropKnownTags(' ')).replace(/\s+/g, ' ').trim();
      const n = (x) => Number(x || 0).toLocaleString('ko-KR');

      const done = list.filter((r) => r.status === 'applied').length;
      const drafts = list.filter((r) => r.status === 'draft');
      const okCount = drafts.filter((r) => !/⚠/.test(String(r.note || ''))).length;
      /* 2026-08-18 — 사람이 원본 이미지와 대조해야 하는 건수. 이 숫자가
         검수 부담의 실제 크기다. 나머지는 색·실루엣 묘사라 빠르게 넘길 수 있다. */
      const checkCount = drafts.filter((r) => r.reads_image_text === true).length;

      const cards = list.map((r) => {
        const a = byId.get(r.article_id) || {};
        const oldT = plain(r.old_body), newT = plain(r.new_body);
        const warn = /⚠/.test(String(r.note || ''));
        const applied = r.status === 'applied';
        /* 이미지 속 글자를 읽은 초안은 사람이 원본과 대조해야 한다.
           워터밤(노출 6,300)에서 라인업 포스터의 이름 4개가 틀렸는데
           린터 경보는 0건이었다. 문체 경보와 다른 물건이라 따로 세운다. */
        const src = r.reads_image_text === true;
        return '<article class="c' + (applied ? ' done' : '') + '">'
          + '<h2>' + esc(a.title || r.article_id) + '</h2>'
          + '<div class="m">노출 ' + n(r.impressions) + ' · ' + esc(r.status)
          + ' · ' + n(oldT.length) + '자 → <b>' + n(newT.length) + '자</b>'
          + (newT.length >= 800 ? ' <span class="ok">목표 달성</span>' : '')
          + '</div>'
          + (src
              ? '<div class="src"><b>사진 속 글자를 읽었다 — 원본과 대조할 것</b>'
                + (r.image_text_note ? '<br>읽었다고 신고한 글자: ' + esc(r.image_text_note) : '')
                + '</div>'
              : '')
          + (r.note ? '<div class="' + (warn ? 'warn' : 'note') + '">' + esc(r.note) + '</div>' : '')
          + '<div class="two"><div><h3>기존</h3><p>' + esc(oldT) + '</p></div>'
          + '<div><h3>보강</h3><p>' + esc(newT) + '</p></div></div>'
          + '<div class="act">'
          + (applied
              ? '<a class="rv" href="?revert=1&amp;id=' + esc(r.article_id) + '">되돌리기</a>'
              : '<a class="ap" href="?apply=1&amp;id=' + esc(r.article_id) + '">이 건만 적용</a>'
                + ' <a class="rj" href="?reject=1&amp;id=' + esc(r.article_id) + '">버리기</a>')
          + (a.slug ? ' <a class="lk" target="_blank" href="/article/' + esc(a.slug) + '">기사 보기</a>' : '')
          + '</div></article>';
      }).join('');

      const html = '<!doctype html><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>본문 보강 검토 · PAP</title><style>'
        + 'body{font:15px/1.75 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;'
        + 'margin:0;padding:24px;background:#f6f6f7;color:#16161a}'
        + 'h1{font-size:20px;margin:0 0 4px}.sum{color:#666;font-size:13px;margin-bottom:20px}'
        + '.c{background:#fff;border-radius:12px;padding:18px 20px;margin:0 0 16px;'
        + 'box-shadow:0 1px 3px rgba(0,0,0,.07)}.c.done{opacity:.55}'
        + '.c h2{font-size:16px;margin:0 0 6px}.m{font-size:12px;color:#666;margin-bottom:10px}'
        + '.ok{color:#1a7f3c;font-weight:700}'
        + '.note,.warn{font-size:12px;padding:8px 10px;border-radius:8px;margin-bottom:12px;line-height:1.6}'
        + '.note{background:#f1f3f5;color:#495057}.warn{background:#fff3cd;color:#7a5b00}'
        + '.src{background:#fdecec;color:#96271f;font-size:12px;padding:8px 10px;'
        + 'border-radius:8px;margin-bottom:10px;line-height:1.6;border:1px solid #f3c9c5}'
        + '.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}'
        + '@media(max-width:760px){.two{grid-template-columns:1fr}}'
        + '.two h3{font-size:11px;color:#888;margin:0 0 6px;font-weight:600;letter-spacing:.04em}'
        + '.two p{margin:0;font-size:13px;white-space:pre-wrap}'
        + '.act{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap}'
        + '.act a{font-size:12px;padding:6px 12px;border-radius:7px;text-decoration:none}'
        + '.ap{background:#16161a;color:#fff}.rj{background:#eee;color:#555}'
        + '.rv{background:#fdecec;color:#b03636}.lk{background:#eef3ff;color:#2c5bd6}'
        + '</style>'
        + '<h1>본문 보강 검토</h1>'
        + '<div class="sum">' + n(list.length) + '건 · 적용됨 ' + n(done)
        + ' · 초안 ' + n(drafts.length) + '(이슈 없음 ' + n(okCount) + ')<br>'
        + '<b>사진 속 글자를 읽은 초안 ' + n(checkCount) + '건</b> — 이것만 원본 이미지와 '
        + '대조하면 된다. 나머지는 색·실루엣 묘사라 틀려도 손해가 작다.<br>'
        + '적용은 한 건씩 누른다. 되돌리기는 원본이 남아 있는 동안만 된다.</div>'
        + cards;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(html);
    }

    if (q.stored === '1' && q.id) {
      const { data, error } = await supabaseAdmin.from(TABLE)
        .select('*').eq('article_id', String(q.id)).maybeSingle();
      if (error || !data) return res.status(404).json({ error: '찾지 못함' });
      return res.status(200).json(data);
    }

    if (q.generate_next === '1') {
      const { data: rows } = await supabaseAdmin.from(TABLE)
        .select('article_id').eq('status', 'queued')
        .order('impressions', { ascending: false }).limit(1);
      const row = (rows || [])[0];
      if (!row) return res.status(200).json({ done: true, message: '대기 중인 대상이 없습니다.' });

      const { data: art, error: aErr } = await supabaseAdmin.from('articles')
        .select('id, title, content, category, tags, gallery').eq('id', row.article_id).single();
      if (aErr || !art) throw new Error('기사를 찾지 못함: ' + row.article_id);

      let out;
      try {
        out = await generateBody(art);
      } catch (e) {
        await supabaseAdmin.from(TABLE).update({
          status: 'failed', note: String((e && e.message) || e).slice(0, 300),
        }).eq('article_id', row.article_id);
        throw e;
      }

      const issues = checkBody(art.content, out.body);
      await supabaseAdmin.from(TABLE).update({
        old_body: art.content,
        new_body: out.body,
        old_len: plain(art.content).length,
        new_len: plain(out.body).length,
        status: 'draft',
        note: (out.added + (issues.length ? ' / ⚠ ' + issues.join(', ') : '')).slice(0, 500),
        reads_image_text: out.readsImageText,
        image_text_note: out.imageText || null,
        generated_at: new Date().toISOString(),
      }).eq('article_id', row.article_id);

      const { count } = await supabaseAdmin.from(TABLE)
        .select('article_id', { count: 'exact', head: true }).eq('status', 'queued');
      return res.status(200).json({
        generated: true, article_id: row.article_id, title: art.title,
        old_len: plain(art.content).length, new_len: plain(out.body).length,
        added: out.added, issues, remaining: count || 0,
        reads_image_text: out.readsImageText, image_text: out.imageText,
      });
    }

    /* 적용 — 사람이 누르는 자리. 여기서만 라이브 본문이 바뀐다. */
    if (q.apply === '1' && q.id) {
      const { data: row, error } = await supabaseAdmin.from(TABLE)
        .select('*').eq('article_id', String(q.id)).maybeSingle();
      if (error || !row) return res.status(404).json({ error: '찾지 못함' });
      if (row.status !== 'draft') return res.status(400).json({ error: 'draft 상태만 적용할 수 있습니다.', status: row.status });
      if (!row.new_body) return res.status(400).json({ error: '초안이 비어 있습니다.' });

      const { error: uErr } = await supabaseAdmin.from('articles')
        .update({ content: row.new_body, updated_at: new Date().toISOString() })
        .eq('id', row.article_id);
      if (uErr) throw uErr;

      await supabaseAdmin.from(TABLE)
        .update({ status: 'applied', applied_at: new Date().toISOString() })
        .eq('article_id', row.article_id);
      return res.status(200).json({ ok: true, applied: row.article_id, new_len: row.new_len });
    }

    /* 되돌리기 — old_body 를 그대로 다시 넣는다. 적용 후 마음이 바뀌었을 때. */
    if (q.revert === '1' && q.id) {
      const { data: row, error } = await supabaseAdmin.from(TABLE)
        .select('*').eq('article_id', String(q.id)).maybeSingle();
      if (error || !row) return res.status(404).json({ error: '찾지 못함' });
      if (row.status !== 'applied') return res.status(400).json({ error: 'applied 상태만 되돌릴 수 있습니다.', status: row.status });
      if (!row.old_body) return res.status(400).json({ error: '원본이 없어 되돌릴 수 없습니다.' });

      const { error: uErr } = await supabaseAdmin.from('articles')
        .update({ content: row.old_body, updated_at: new Date().toISOString() })
        .eq('id', row.article_id);
      if (uErr) throw uErr;
      await supabaseAdmin.from(TABLE)
        .update({ status: 'draft', applied_at: null }).eq('article_id', row.article_id);
      return res.status(200).json({ ok: true, reverted: row.article_id });
    }

    if (q.reject === '1' && q.id) {
      const { error } = await supabaseAdmin.from(TABLE)
        .update({ status: 'rejected' }).eq('article_id', String(q.id));
      if (error) throw error;
      return res.status(200).json({ ok: true, rejected: q.id });
    }

    return res.status(400).json({ error: '?queue=1 / ?generate_next=1 / ?stored=1&id= / ?apply=1&id= / ?revert=1&id= / ?reject=1&id= 필요' });
  } catch (e) {
    console.error('[article-body-backfill]', e);
    return res.status(500).json({ error: '처리에 실패했습니다. contact@pap-magazine.com', code: 'backfill_failed' });
  }
};

module.exports._checkBody = checkBody;
module.exports._plain = plain;
module.exports._TOOL = TOOL;
