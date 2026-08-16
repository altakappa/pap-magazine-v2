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

const { reportAiFailure } = require('../_lib/aiCreditWatch');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const papVoice = require('../_lib/papVoice');

const TABLE = 'article_body_backfill';

function plain(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
    },
    required: ['body_ko', 'added'],
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
    '',
    papVoice.ARTICLE_VOICE,
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
  return { body: String(tu.input.body_ko), added: String(tu.input.added || '') };
}

/* 생성물이 규격을 지켰는지 기계로 본다.
 * 통과 못 해도 버리지 않고 note 에 남긴다. 사람이 보고 판단할 값이다.
 * 여기서 자동 폐기하면 오탐 하나로 큐가 멎는다. */
function checkBody(oldBody, newBody) {
  const o = plain(oldBody), n = plain(newBody);
  const issues = papVoice.lintKoreanBody(newBody, { style: 'plain', structure: true, maxParas: 4, maxLen: 1500 });
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
        generated_at: new Date().toISOString(),
      }).eq('article_id', row.article_id);

      const { count } = await supabaseAdmin.from(TABLE)
        .select('article_id', { count: 'exact', head: true }).eq('status', 'queued');
      return res.status(200).json({
        generated: true, article_id: row.article_id, title: art.title,
        old_len: plain(art.content).length, new_len: plain(out.body).length,
        added: out.added, issues, remaining: count || 0,
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
