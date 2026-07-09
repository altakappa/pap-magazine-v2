/**
 * GET /api/admin/pinterest-diagnose — Pinterest 자동 게시 현황 진단 (관리자 전용).
 *
 * QA #352. sync-pinterest 크론 상태 확인.
 * Pinterest는 OAuth 코드가 없고 access_token 을 Vercel 환경변수에 직접 넣는 방식.
 * 토큰 30~60일 만료 자동 갱신 없음 → 만료 임박 경고가 이 진단의 주 기능.
 *
 * 응답 JSON:
 *   {
 *     schedule: '0 1,7,13,19 * * * → KST 10/16/22/04시',
 *     env: { has_access_token, has_board_id, has_cron_secret, board_id_masked },
 *     token: { valid, tested_at, error?, user_display_name?, boards_count?, target_board? },
 *     summary: {
 *       total_published: (에디토리얼 published 총수),
 *       pinned: (pinterest_pin_id 있는 수),
 *       pending: (아직 안 핀된 published 수),
 *       errored: (pinterest_error 있는 수),
 *       last_synced_at: 최근 sync 시각,
 *     },
 *     diagnosis: [ {level, msg} ... ],
 *     recent_pinned: [ ...10 ],
 *     next_batch: [ ...최대 16 후보 ],
 *   }
 *
 * 소비자: frontend/pinterest-diagnose.html
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

// Pinterest v5 API로 토큰 유효성 실검증 (user_account + 대상 보드 존재 여부)
async function testPinterestToken(token, boardId) {
  const out = { valid: false };
  if (!token) { out.error = 'PINTEREST_ACCESS_TOKEN 미설정'; return out; }
  try {
    // 계정 정보 조회
    const r = await fetch('https://api.pinterest.com/v5/user_account', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      out.error = 'user_account ' + r.status + ': ' + body.slice(0, 150);
      out.status = r.status;
      // 401 / 403 이면 토큰 만료·권한 문제
      if (r.status === 401 || r.status === 403) {
        out.error += ' — 토큰 만료·스코프 누락 가능성. Pinterest 개발자 콘솔에서 재발급 필요.';
      }
      return out;
    }
    const acct = await r.json();
    out.valid = true;
    out.user_display_name = acct.username || acct.display_name || null;
    out.account_type = acct.account_type || null;

    // 대상 보드 존재 확인
    if (boardId) {
      const br = await fetch('https://api.pinterest.com/v5/boards/' + encodeURIComponent(boardId), {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(10000),
      });
      if (br.ok) {
        const board = await br.json();
        out.target_board = { id: board.id, name: board.name, pin_count: board.pin_count };
      } else {
        out.board_error = 'boards/' + boardId + ' → ' + br.status;
      }
    }
  } catch (e) {
    out.error = String(e && e.message || e).slice(0, 200);
  }
  return out;
}

module.exports = async function handler(req, res){
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const boardId = process.env.PINTEREST_BOARD_ID || null;
    const env = {
      has_access_token: !!process.env.PINTEREST_ACCESS_TOKEN,
      has_board_id:     !!boardId,
      has_cron_secret:  !!process.env.CRON_SECRET,
      board_id_masked:  boardId ? (String(boardId).slice(0, 6) + '…') : null,
    };

    // 토큰 실검증
    const token = await testPinterestToken(process.env.PINTEREST_ACCESS_TOKEN, boardId);
    token.tested_at = new Date().toISOString();

    // 에디토리얼 통계
    const [
      { count: total_published },
      { count: pinned },
      { count: errored },
    ] = await Promise.all([
      supabaseAdmin.from('editorials').select('id', { count: 'exact', head: true })
        .eq('status', 'published').not('slug', 'is', null),
      supabaseAdmin.from('editorials').select('id', { count: 'exact', head: true })
        .not('pinterest_pin_id', 'is', null),
      supabaseAdmin.from('editorials').select('id', { count: 'exact', head: true })
        .not('pinterest_error', 'is', null),
    ]);
    const pendingCount = Math.max(0, (total_published || 0) - (pinned || 0));

    // 최근 sync 시각
    const { data: lastSyncRow } = await supabaseAdmin.from('editorials')
      .select('pinterest_synced_at')
      .not('pinterest_synced_at', 'is', null)
      .order('pinterest_synced_at', { ascending: false }).limit(1).maybeSingle();

    const summary = {
      total_published: total_published || 0,
      pinned: pinned || 0,
      pending: pendingCount,
      errored: errored || 0,
      last_synced_at: (lastSyncRow && lastSyncRow.pinterest_synced_at) || null,
    };

    // 최근 핀 성공 10건
    const { data: recentPinnedRaw } = await supabaseAdmin.from('editorials')
      .select('id, title, slug, pinterest_pin_id, pinterest_synced_at')
      .not('pinterest_pin_id', 'is', null)
      .order('pinterest_synced_at', { ascending: false }).limit(10);
    const recent_pinned = (recentPinnedRaw || []).map(e => ({
      id: e.id, title: e.title,
      content_url: '/editorial/' + (e.slug || e.id),
      pin_id: e.pinterest_pin_id,
      pin_url: e.pinterest_pin_id ? ('https://www.pinterest.com/pin/' + e.pinterest_pin_id + '/') : null,
      synced_at: e.pinterest_synced_at,
    }));

    // 다음 배치 후보 (최대 16 — 램프 상한)
    const { data: nextRaw } = await supabaseAdmin.from('editorials')
      .select('id, title, slug, published_date')
      .eq('status', 'published')
      .not('slug', 'is', null)
      .is('pinterest_pin_id', null)
      .order('published_date', { ascending: false }).limit(16);
    const next_batch = (nextRaw || []).map(e => ({
      id: e.id, title: e.title,
      published_date: e.published_date,
      content_url: '/editorial/' + (e.slug || e.id),
    }));

    // 진단 메시지
    const diagnosis = [];
    if (!env.has_access_token){
      diagnosis.push({ level: 'error', msg: 'PINTEREST_ACCESS_TOKEN 미설정. Pinterest 개발자 콘솔에서 pins:write + boards:read 스코프로 토큰 발급 후 Vercel 환경변수 추가.' });
    }
    if (!env.has_board_id){
      diagnosis.push({ level: 'error', msg: 'PINTEREST_BOARD_ID 미설정. @pap_magazine 계정에 "EDITORIAL" 보드 생성 후 Vercel 환경변수 추가.' });
    }
    if (env.has_access_token && !token.valid){
      diagnosis.push({ level: 'error', msg: '토큰 실검증 실패: ' + (token.error || 'unknown') });
    }
    if (token.valid && token.target_board){
      diagnosis.push({ level: 'ok', msg: '토큰 유효 — 계정 @' + (token.user_display_name || '?') + ', 보드 "' + token.target_board.name + '" (' + token.target_board.pin_count + ' pins).' });
    }
    if (token.valid && !token.target_board && env.has_board_id){
      diagnosis.push({ level: 'error', msg: '보드 ID(' + env.board_id_masked + ')로 조회 실패: ' + (token.board_error || '보드 없음') });
    }
    if (env.has_access_token && env.has_board_id && summary.pending > 0 && !summary.last_synced_at){
      diagnosis.push({ level: 'warn', msg: '한 번도 sync 안 됨. 크론 첫 실행(다음 예약: KST 10/16/22/04시) 대기 or 수동 트리거 필요.' });
    }
    if (summary.last_synced_at){
      const hours = Math.round((Date.now() - new Date(summary.last_synced_at).getTime()) / 3600000);
      if (hours < 12){
        diagnosis.push({ level: 'ok', msg: '최근 ' + hours + '시간 전 sync 완료.' });
      } else {
        diagnosis.push({ level: 'warn', msg: '마지막 sync 후 ' + hours + '시간 경과. 크론 로그 확인 권장.' });
      }
    }
    if (summary.errored > 0){
      diagnosis.push({ level: 'warn', msg: 'pinterest_error가 남은 에디토리얼 ' + summary.errored + '건. 개별 확인 필요.' });
    }
    diagnosis.push({ level: 'info', msg: 'Pinterest v5 토큰은 자동 갱신 없음 — 30~60일마다 수동 재발급 필요. 캘린더 리마인더 설정 권장.' });

    return res.status(200).json({
      schedule: '0 1,7,13,19 * * * (UTC) → KST 10 / 16 / 22 / 04 시',
      env,
      token,
      summary,
      diagnosis,
      recent_pinned,
      next_batch,
    });
  } catch (e) {
    console.error('[pinterest-diagnose] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
