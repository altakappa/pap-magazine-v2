/**
 * Search Console 을 우리 DB 로 가져온다 (2026-08-18 신설)
 *
 * ■ 왜 만들었나
 * 2026-08-18 에 Ahrefs 의 GSC 미러로 페이지를 고르려다 두 번 틀렸다.
 * 숫자가 맞지 않았기 때문이다.
 *
 *   국가별 클릭 합계           약 4,800
 *   페이지별 표 상위 100 합계   약 400   (8%)
 *   일본 클릭 992 인데 키워드 표에 잡힌 건 12  (1.2%)
 *
 * 사이트 전체는 주당 노출 12만인데 노출 2,000 넘는 페이지가 2개로 나온다.
 * **앞뒤가 안 맞는 데이터로 판단하면 그 판단도 안 맞는다.** 원본을 가져온다.
 *
 * ■ 인증
 * 새 OAuth 앱을 만들지 않았다. 유튜브·드라이브가 쓰는 앱에 스코프
 * webmasters.readonly 만 더했다(읽기 전용). 그래서 토큰 관리 코드가
 * 한 벌이다 — 규칙이 두 벌이면 한쪽만 고쳐진다.
 *
 * ■ 지연과 재수집
 * GSC 는 최근 2~3일 수치를 나중에 확정한다. 그래서 매 회차 최근 며칠을
 * 다시 긁어 덮어쓴다. 한 번 긁고 끝내면 마지막 며칠이 영원히 과소 집계로
 * 남는다. 덮어쓰기 키는 기본키와 정확히 같다 — 선택 키와 제약 키가
 * 어긋나면 중복이 쌓인다(이 저장소가 이미 겪은 사고다).
 */
'use strict';

const { getAccessToken } = require('./youtube');

const API = 'https://searchconsole.googleapis.com/webmasters/v3';
/* 도메인 속성이 기본이다. www·비www·다국어 경로를 한 속성으로 본다.
   URL 접두어 속성만 있는 계정이면 env GSC_SITE_URL 로 바꾼다. */
const SITE = process.env.GSC_SITE_URL || 'sc-domain:pap-magazine.com';
const PAGE_SIZE = 25000;   // GSC 1회 최대

function ymd(d) { return d.toISOString().slice(0, 10); }

/** 오늘로부터 n일 전 (UTC 기준 날짜 문자열) */
function daysAgo(n, nowMs) {
  const t = (typeof nowMs === 'number' ? nowMs : Date.now()) - n * 86400000;
  return ymd(new Date(t));
}

/** 계정이 볼 수 있는 속성 목록. SITE 가 틀렸을 때 무엇을 넣어야 하는지 알려준다. */
async function listSites() {
  const token = await getAccessToken();
  const r = await fetch(API + '/sites', {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('sites 조회 실패 ' + r.status + ': ' + JSON.stringify(j).slice(0, 200));
  return (j.siteEntry || []).map((s) => s.siteUrl);
}

/**
 * searchAnalytics.query 를 끝까지 넘긴다.
 * @param {{startDate:string, endDate:string, dimensions:string[], rowLimit?:number}} opts
 */
async function queryAll(opts) {
  const token = await getAccessToken();
  const url = API + '/sites/' + encodeURIComponent(SITE) + '/searchAnalytics/query';
  const limit = opts.rowLimit || PAGE_SIZE;
  const out = [];
  let startRow = 0;

  for (let guard = 0; guard < 40; guard++) {      // 최대 100만 행에서 멈춘다
    const body = {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: opts.dimensions,
      rowLimit: limit,
      startRow,
      type: 'web',
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      /* 403·404 는 십중팔구 속성 이름이 틀렸거나 재인증을 안 한 것이다.
         '권한 없음' 만 남기면 어느 쪽인지 모른다. 볼 수 있는 속성을 같이 싣는다. */
      let hint = '';
      if (r.status === 403 || r.status === 404) {
        try { hint = ' · 이 계정이 볼 수 있는 속성: ' + (await listSites()).join(', '); }
        catch (e) { hint = ' · 속성 목록도 못 읽었다(재인증 필요일 수 있다): ' + e.message; }
      }
      throw new Error('GSC ' + r.status + ' [' + SITE + ']: '
        + JSON.stringify(j).slice(0, 200) + hint);
    }
    const rows = j.rows || [];
    out.push.apply(out, rows);
    if (rows.length < limit) break;
    startRow += rows.length;
  }
  return out;
}

/** GSC 행 → DB 행. 날짜는 항상 첫 dimension 이다. */
function toRows(rows, kind) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const keys = (r && r.keys) || [];
    const date = keys[0];
    const subject = keys[1];
    if (!date || !subject) continue;
    /* 같은 (날짜, 대상) 이 두 번 오면 upsert 가 터진다. 앞엣것만 남긴다. */
    const k = date + ' ' + subject;
    if (seen.has(k)) continue;
    seen.add(k);
    const row = {
      date,
      clicks: Number(r.clicks || 0),
      impressions: Number(r.impressions || 0),
      position: r.position == null ? null : Number(Number(r.position).toFixed(2)),
    };
    if (kind === 'page') row.page = String(subject).slice(0, 1000);
    else row.query = String(subject).slice(0, 500);
    out.push(row);
  }
  return out;
}

module.exports = { listSites, queryAll, toRows, daysAgo, SITE, PAGE_SIZE };
