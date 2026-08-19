/**
 * GET /api/ops/ig-comments-probe — IG 댓글 API 접근 가능 여부 진단 (읽기 전용)
 *
 * 왜 필요한가 (2026-08-19):
 *   PAP 게시물에 성인사이트 유인 스팸이 20분 만에 수십 건 붙는다.
 *   인스타 '숨겨진 단어' 필터는 원리상 못 잡는다 — 스패머가 한글 사이에
 *   그리스 문자 ι 를 끼우고, 한 글자씩 띄우고, 숫자를 ⑤②⑨⑦ 로 쓴다.
 *   그래서 우리 코드로 댓글을 읽어 정규화한 뒤 판정해야 한다.
 *
 *   그런데 그 전에 확인할 게 하나 있다: 우리 토큰이 댓글을 읽을 수 있는가?
 *   Graph API 에서 댓글 읽기/숨기기는 instagram_manage_comments 권한이 필요한데,
 *   지금 코드는 comments_count(개수)만 쓰고 본문은 한 번도 안 읽어봤다.
 *   전체 시스템을 다 짜놓고 마지막에 403 을 보는 건 최악이다. 먼저 찔러본다.
 *
 * 이 엔드포인트가 하는 일:
 *   1) 최근 게시물 몇 개를 가져온다 (이미 되는 것 — 대조군)
 *   2) 댓글이 달린 게시물 하나의 댓글 본문을 읽어본다 (되는지 모르는 것)
 *   3) 읽혔다면 스팸 판정기를 그대로 돌려 실제 점수를 보여준다
 *
 * 하지 않는 일: 숨기기·삭제·답글 등 쓰기 동작은 일절 없다. 순수 읽기.
 *   (쓰기 권한은 실제로 써봐야 알 수 있는데, 그건 도메니코 승인 후에 한다)
 *
 * 인증: CRON_SECRET 또는 관리자.
 */

const { requireAdmin } = require('../_lib/auth');
const { sanitizeCredential } = require('../_lib/instagramImport');
const spam = require('../_lib/igCommentSpam');

const API = 'https://graph.facebook.com/v21.0';

function creds() {
  const userId = sanitizeCredential(process.env.IG_USER_ID);
  const token = sanitizeCredential(process.env.IG_ACCESS_TOKEN);
  return { userId, token };
}

async function call(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body: j };
}

/** 토큰 값은 절대 응답에 넣지 않는다. 에러 메시지에 섞여 나올 수 있어 한 번 더 지운다. */
function scrub(text, token) {
  let s = String(text == null ? '' : text);
  if (token) s = s.split(token).join('[TOKEN]');
  return s.slice(0, 300);
}

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const { userId, token } = creds();
  if (!userId || !token) {
    return res.status(200).json({ ok: false, step: 'env', 결론: 'IG_USER_ID/IG_ACCESS_TOKEN 미설정' });
  }

  const out = { ok: true, 단계: {} };

  // ── 1. 대조군: 게시물 목록 (기존에 되던 호출) ──────────────
  const mediaUrl = `${API}/${userId}/media?fields=id,permalink,timestamp,comments_count&limit=10&access_token=${encodeURIComponent(token)}`;
  const media = await call(mediaUrl);
  if (!media.ok) {
    out.ok = false;
    out.단계.게시물목록 = { 결과: '실패', status: media.status, 오류: scrub(media.body && media.body.error && media.body.error.message, token) };
    out.결론 = '토큰 자체가 죽었거나 기본 권한도 없다. 댓글 권한 이전의 문제.';
    return res.status(200).json(out);
  }
  const posts = (media.body && media.body.data) || [];
  out.단계.게시물목록 = { 결과: '성공', 건수: posts.length };

  // ── 2. 본론: 댓글 본문 읽기 ────────────────────────────────
  const target = posts.find((p) => (p.comments_count || 0) > 0) || posts[0];
  if (!target) {
    out.단계.댓글읽기 = { 결과: '건너뜀', 이유: '게시물이 없다' };
    out.결론 = '판정 불가 — 게시물 없음';
    return res.status(200).json(out);
  }

  const cUrl = `${API}/${target.id}/comments?fields=id,text,username,timestamp,hidden&limit=25&access_token=${encodeURIComponent(token)}`;
  const comments = await call(cUrl);

  if (!comments.ok) {
    const err = (comments.body && comments.body.error) || {};
    out.ok = false;
    out.단계.댓글읽기 = {
      결과: '실패',
      status: comments.status,
      code: err.code,
      오류: scrub(err.message, token),
    };
    out.결론 = comments.status === 403 || err.code === 200 || err.code === 10
      ? '토큰에 instagram_manage_comments 권한이 없다 → 앱 권한 추가 + 재인증 필요'
      : '댓글 읽기 실패 — 위 오류 확인';
    return res.status(200).json(out);
  }

  const rows = (comments.body && comments.body.data) || [];
  out.단계.댓글읽기 = { 결과: '성공', 건수: rows.length, 대상게시물: target.permalink };

  // ── 3. 실제 댓글에 스팸 판정기를 돌려본다 ──────────────────
  const THRESHOLD = 60;
  const fpCount = new Map();
  const judged = rows.map((c) => {
    const s = spam.score(c.text || '');
    const fp = spam.fingerprint(c.text || '');
    fpCount.set(fp, (fpCount.get(fp) || 0) + 1);
    return { username: c.username, 점수: s.total, 신호: s.signals, 지문: fp, 이미숨김: !!c.hidden, 원문: String(c.text || '').slice(0, 60) };
  });
  // 같은 지문이 여러 계정에서 나오면 그것만으로도 확정적이다
  for (const j of judged) if ((fpCount.get(j.지문) || 0) >= 3) { j.점수 += 60; j.신호 = [...j.신호, 'burst:' + fpCount.get(j.지문) + '계정']; }

  const spamRows = judged.filter((j) => j.점수 >= THRESHOLD);
  out.판정 = {
    기준점: THRESHOLD,
    전체: judged.length,
    스팸: spamRows.length,
    스팸비율: judged.length ? Math.round((spamRows.length / judged.length) * 100) + '%' : '-',
    표본: judged.slice(0, 15),
  };
  out.결론 = `댓글 읽기 가능. 최근 댓글 ${judged.length}건 중 ${spamRows.length}건이 스팸으로 판정됨. 다음 단계는 숨기기 권한 확인(쓰기 1회 시험 — 도메니코 승인 필요).`;
  return res.status(200).json(out);
};
