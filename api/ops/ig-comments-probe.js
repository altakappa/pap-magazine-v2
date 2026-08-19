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

  // ── 0. 토큰이 실제로 무슨 권한을 들고 있나 ─────────────────
  // 2026-08-19: 댓글 읽기는 되는데 숨기기가 (#10) permission denied 로 막혔다.
  // '읽히니까 권한이 있다'는 추정이 틀렸다. 추정 말고 목록을 본다.
  try {
    const pr = await call(`${API}/me/permissions?access_token=${encodeURIComponent(token)}`);
    if (pr.ok) {
      const rows = (pr.body && pr.body.data) || [];
      const granted = rows.filter((x) => x.status === 'granted').map((x) => x.permission);
      const declined = rows.filter((x) => x.status !== 'granted').map((x) => x.permission + '(' + x.status + ')');
      out.단계.토큰권한 = {
        승인됨: granted,
        거부됨: declined,
        댓글관리: granted.includes('instagram_manage_comments') ? '있음' : '❌ 없음',
      };
    } else {
      out.단계.토큰권한 = { 결과: '조회 실패', status: pr.status };
    }
  } catch (e) {
    out.단계.토큰권한 = { 결과: '조회 실패', 오류: String((e && e.message) || e).slice(0, 120) };
  }

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
  // 최근 게시물 하나만 보면 스팸이 안 붙은 새 글이 걸려 "스팸 0건" 이 나온다.
  // 실제 피해 규모를 보려면 댓글이 달린 게시물을 전부 훑어야 한다.
  const targets = posts.filter((p) => (p.comments_count || 0) > 0);
  if (!targets.length) {
    out.단계.댓글읽기 = { 결과: '건너뜀', 이유: '댓글 달린 게시물이 없다' };
    out.결론 = '판정 불가 — 댓글 없음';
    return res.status(200).json(out);
  }

  const all = [];
  const perPost = [];
  let readFail = null;
  for (const p of targets) {
    // 답글(replies)까지 가져온다. IG 표기 댓글 수보다 읽히는 수가 늘 적었는데
    // 그 차이가 답글이다. 답글에 붙은 스팸을 못 보면 비율을 과소평가한다.
    const FIELDS = 'id,text,username,timestamp,hidden,from{id,username},replies{id,text,username,timestamp,hidden,from{id,username}}';
    const cUrl = `${API}/${p.id}/comments?fields=${encodeURIComponent(FIELDS)}&limit=50&access_token=${encodeURIComponent(token)}`;
    const r = await call(cUrl);
    if (!r.ok) { readFail = { post: p.permalink, err: r }; break; }
    const rows = (r.body && r.body.data) || [];
    let replyCount = 0;
    for (const c of rows) {
      all.push({ ...c, permalink: p.permalink, 답글: false });
      const reps = (c.replies && c.replies.data) || [];
      replyCount += reps.length;
      for (const rp of reps) all.push({ ...rp, permalink: p.permalink, 답글: true });
    }
    perPost.push({ 게시물: p.permalink, 최상위: rows.length, 답글: replyCount, 합계: rows.length + replyCount, IG표기수: p.comments_count });
  }

  if (readFail) {
    const err = (readFail.err.body && readFail.err.body.error) || {};
    out.ok = false;
    out.단계.댓글읽기 = { 결과: '실패', status: readFail.err.status, code: err.code, 오류: scrub(err.message, token) };
    out.결론 = readFail.err.status === 403 || err.code === 200 || err.code === 10
      ? '토큰에 instagram_manage_comments 권한이 없다 → 앱 권한 추가 + 재인증 필요'
      : '댓글 읽기 실패 — 위 오류 확인';
    return res.status(200).json(out);
  }

  out.단계.댓글읽기 = { 결과: '성공', 게시물수: perPost.length, 총댓글: all.length, 게시물별: perPost };

  // ── 3. 실제 댓글에 스팸 판정기를 돌려본다 ──────────────────
  const THRESHOLD = 60;
  const fpCount = new Map();
  const judged = all.map((c) => {
    const sc = spam.score(c.text || '');
    const fp = spam.fingerprint(c.text || '');   // 글자가 안 남는 댓글은 null
    if (fp) fpCount.set(fp, (fpCount.get(fp) || 0) + 1);
    return {
      댓글ID: c.id,
      username: c.username || (c.from && c.from.username) || '(불명)',
      점수: sc.total,
      신호: sc.signals,
      지문: fp,
      이미숨김: !!c.hidden,
      게시물: c.permalink,
      원문: String(c.text || '').slice(0, 70),
    };
  });
  // 같은 지문이 3계정 이상에서 나오면 그것만으로도 확정적이다
  for (const j of judged) {
    if (!j.지문) continue;                        // 묶을 근거가 없는 것은 가산하지 않는다
    const n = fpCount.get(j.지문) || 0;
    if (n >= 3) { j.점수 += 60; j.신호 = [...j.신호, 'burst:' + n + '건']; }
  }

  const spamRows = judged.filter((j) => j.점수 >= THRESHOLD).sort((a, b) => b.점수 - a.점수);
  const cleanRows = judged.filter((j) => j.점수 < THRESHOLD);
  // 살포 무리 — 같은 문구가 몇 계정에서 나왔나
  const bursts = [...fpCount.entries()].filter(([fp, n]) => fp && n >= 3)
    .map(([fp, n]) => ({ 지문: fp, 건수: n, 예시: (judged.find((j) => j.지문 === fp) || {}).원문 }))
    .sort((a, b) => b.건수 - a.건수);

  out.판정 = {
    기준점: THRESHOLD,
    전체: judged.length,
    스팸: spamRows.length,
    스팸비율: judged.length ? Math.round((spamRows.length / judged.length) * 100) + '%' : '-',
    이미숨겨진것: judged.filter((j) => j.이미숨김).length,
    살포무리: bursts,
    스팸표본: spamRows.slice(0, 20),
    정상표본: cleanRows.slice(0, 10),
  };
  out.결론 = `댓글 읽기 가능. 게시물 ${perPost.length}개 · 댓글 ${judged.length}건 중 ${spamRows.length}건(${out.판정.스팸비율})이 스팸. `
    + `다음 단계는 숨기기 권한 확인(쓰기 1회 시험 — 도메니코 승인 필요).`;
  return res.status(200).json(out);
};
