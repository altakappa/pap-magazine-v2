/**
 * POST /api/csp-report — CSP 위반 리포트 수집 (2026-07-16 보안 하드닝)
 *
 * 배경: CSP를 정식 강제 전환(757248c)했지만 위반이 어디에도 기록되지 않아
 * "뭔가 막혔는지 / 오탐인지"를 알 수 없었다. 과거 Report-Only 정책이 2주
 * 관찰 후 승격한다는 로드맵이 있었는데 수집 엔드포인트가 없어 관찰 자체가
 * 불가능했던 것이 이중구조 방치의 근본 원인(SECURITY.md 참조).
 *
 * 이 엔드포인트는 두 소스의 리포트를 받는다:
 *  1. report-uri (구식, 광범위 지원) — Content-Type: application/csp-report,
 *     바디 { "csp-report": {...} } 단건
 *  2. Reporting API (report-to)     — Content-Type: application/reports+json,
 *     바디 [ {type:"csp-violation", body:{...}}, ... ] 배치
 *
 * 저장은 Vercel Logs(console.warn) — DB 마이그레이션 불필요, 운영 습관
 * (SECURITY.md "월 1회 Logs 확인")에 [csp-report] 검색만 추가하면 된다.
 * 위반이 실제로 유의미해지면 그때 테이블 승격을 검토.
 *
 * 안전 규칙:
 *  - 응답은 항상 204 (수집 실패가 사용자 플로우에 영향 주지 않도록 삼킴)
 *  - 바디 16KB 제한 + 필드 화이트리스트만 로그 (로그 오염/폭탄 방지)
 *  - 인메모리 레이트리밋(IP당 분당 30) — 수집용이라 콜드스타트 리셋 무방,
 *    DB 리미터(rl_hit)를 쓰지 않는 이유: 리포트 폭주가 DB 쓰기 폭주로
 *    전이되는 것 자체를 막기 위함
 */

// IP당 분당 카운터 (인메모리 — 콜드스타트 리셋 OK, 목적은 폭주 억제뿐)
const _hits = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;

function rateLimited(ip) {
  const now = Date.now();
  const rec = _hits.get(ip);
  if (!rec || now - rec.t > WINDOW_MS) {
    _hits.set(ip, { t: now, n: 1 });
    // 맵 무한 성장 방지 — 윈도 지난 항목 정리
    if (_hits.size > 5000) {
      for (const [k, v] of _hits) { if (now - v.t > WINDOW_MS) _hits.delete(k); }
    }
    return false;
  }
  rec.n++;
  return rec.n > MAX_PER_WINDOW;
}

// 리포트에서 로그에 남길 필드만 추출 (스키마 두 종 모두 커버)
function pick(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    directive: r['violated-directive'] || r['effective-directive'] || r.effectiveDirective || null,
    blocked: String(r['blocked-uri'] || r.blockedURL || '').slice(0, 300),
    document: String(r['document-uri'] || r.documentURL || '').slice(0, 300),
    source: String(r['source-file'] || r.sourceFile || '').slice(0, 300),
    line: r['line-number'] || r.lineNumber || null,
    sample: String(r['script-sample'] || r.sample || '').slice(0, 100),
    disposition: r.disposition || null, // "enforce" | "report"
  };
}

module.exports = async (req, res) => {
  // 수집 전용 — GET 등은 204로 조용히 종료 (프로브에 정보 노출 없음)
  if (req.method !== 'POST') { res.statusCode = 204; return res.end(); }

  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (rateLimited(ip)) { res.statusCode = 204; return res.end(); }

    // 바디 확보 — Vercel이 JSON류를 파싱해 주지만 content-type이
    // application/csp-report 면 문자열/버퍼로 올 수 있어 모두 처리
    let body = req.body;
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      if (body.length > 16384) { res.statusCode = 204; return res.end(); }
      try { body = JSON.parse(body); } catch (_) { body = null; }
    }

    const entries = [];
    if (body && body['csp-report']) {
      // report-uri 단건
      entries.push(pick(body['csp-report']));
    } else if (Array.isArray(body)) {
      // Reporting API 배치 (최대 10건만)
      body.slice(0, 10).forEach((it) => {
        if (it && (it.type === 'csp-violation' || it.type === 'csp') && it.body) entries.push(pick(it.body));
      });
    }

    entries.filter(Boolean).forEach((e) => {
      // Vercel Logs에서 `[csp-report]` 로 검색 (SECURITY.md 운영 습관)
      console.warn('[csp-report]', JSON.stringify(e));
    });
  } catch (_) { /* 수집 실패는 삼킨다 */ }

  res.statusCode = 204;
  return res.end();
};
