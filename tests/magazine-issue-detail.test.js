/**
 * 매거진 발행호 상세 — 단일 템플릿 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🚨 구조 이원화): 관리자 등록 발행호(VOL.30·31)의 상세에는 정렬 필터가
 * 있는데, 이전 웹사이트 이관분(VOL.1~29)은 아예 다른 페이지 구조였다.
 * "아티클 상세 구조 이원화"와 같은 패턴 — 데이터가 들어온 경로에 따라
 * 화면이 갈리는 문제.
 *
 * ── 원인 ────────────────────────────────────────────────────────────
 * 진입점과 템플릿이 둘이었다.
 *   · VOL.1~29  → qvOpenLegacy(vol): "그 분기에 속한 월" 목록만 보여줌.
 *                  정렬 필터 없음. 데이터 출처는 하드코딩 정적 카드.
 *   · VOL.30+   → qvOpen(qi): 에디토리얼 목록 + 정렬 필터(최신/오래된/제목).
 *                  데이터 출처는 /api/editorials.
 * 이관분이 다른 화면을 쓴 진짜 이유는 "에디토리얼을 못 불러와서"였다 —
 * /api/editorials 에 기간 필터가 없어 과거 분기만 뽑을 방법이 없었고,
 * 전체를 받아 거르는 방식은 2,448건이라 현실적이지 않았다.
 *
 * ── 수정 ────────────────────────────────────────────────────────────
 * 1. API 에 published_date 기간 필터(from/to) 추가 → 분기 하나만 받으면 된다
 *    (실측: 볼륨당 13~125건).
 * 2. 진입점을 qvOpenVol(vol) 하나로 통일. 두 카드 계열이 모두 이걸 부른다.
 * 3. 상세 오버레이는 qvOpen 하나만 남긴다 — 정렬 필터 포함, 전 볼륨 공통.
 *
 * 데이터 가용성 확인(SQL): 볼륨 공식 (year-2019)*4 + floor((month-1)/3) + 1 로
 * 묶으면 VOL.1~31 전 구간에 에디토리얼이 있다. 누락 볼륨 0, 빈 볼륨 0.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 발행호 카드가 진입점 하나만 쓸 것 (경로별 분기 금지)
 *  2. 정렬 필터가 특정 볼륨 전용으로 되돌아가지 않을 것
 *  3. 분기 범위 계산이 볼륨 라벨과 계속 일치할 것
 *  4. API 기간 필터가 살아 있을 것 (없으면 이관분이 다시 못 불러온다)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const mag = fs.readFileSync(path.join(ROOT, 'frontend/magazine.html'), 'utf8');
const edApi = fs.readFileSync(path.join(ROOT, 'api/editorials/index.js'), 'utf8');

console.log('\n=== 1. 발행호 카드가 단일 진입점을 쓰는가 ===');
const entryPoints = [...mag.matchAll(/onclick="(qv[A-Za-z]+)\(/g)].map(m => m[1]);
const uniq = [...new Set(entryPoints)];
t(`카드 진입점이 하나뿐 (발견: ${uniq.join(', ') || '없음'})`,
  uniq.length === 1 && uniq[0] === 'qvOpenVol',
  '데이터 경로별로 다른 함수를 부르면 화면이 다시 갈린다');
t('레거시 전용 진입점(qvOpenLegacy)이 카드에 남아있지 않다',
  !/onclick="qvOpenLegacy\(/.test(mag));
t('통합 진입점 qvOpenVol 이 정의돼 있다', /window\.qvOpenVol\s*=\s*function/.test(mag));

console.log('\n=== 2. 상세 오버레이가 하나인가 (정렬 필터 공통) ===');
t('표준 오버레이 qvOpen 이 존재', /window\.qvOpen\s*=\s*function/.test(mag));
t('정렬 필터(최신/오래된/제목)가 표준 오버레이에 있다',
  /function sortList\(mode\)/.test(mag) && /'oldest'/.test(mag) && /'title'/.test(mag));
t('qvOpen 이 (vol, list) 형태로 목록을 주입받는다 (경로 무관 재사용)',
  /window\.qvOpen\s*=\s*function\(volOrQi,\s*presetList\)/.test(mag));
t('옛 레거시 오버레이는 폴백 전용으로만 남아있다',
  /window\.qvOpenLegacyRaw\s*=\s*function/.test(mag) &&
  !/window\.qvOpenLegacy\s*=\s*function/.test(mag),
  '평상시 경로에 남아있으면 이원화가 부활한다');

console.log('\n=== 3. 분기 범위 계산이 볼륨 라벨과 맞는가 ===');
/* magazine.html 의 volLabel 과 같은 규칙으로 계산해 교차검증.
   VOL.1 = 2019 Q1 … VOL.29 = 2026 Q1, VOL.30 = 2026 Q2 (기존 라벨과 일치). */
function volRange(vol) {
  const qi = vol - 1, year = 2019 + Math.floor(qi / 4), q = qi % 4;
  const fm = q * 3 + 1, tm = q * 3 + 3;
  const last = new Date(year, tm, 0).getDate();
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return { from: `${year}-${pad(fm)}-01`, to: `${year}-${pad(tm)}-${pad(last)}` };
}
[[1, '2019-01-01', '2019-03-31'], [29, '2026-01-01', '2026-03-31'],
 [30, '2026-04-01', '2026-06-30'], [31, '2026-07-01', '2026-09-30']].forEach(([v, f, to]) => {
  const r = volRange(v);
  t(`VOL.${v} → ${r.from} ~ ${r.to}`, r.from === f && r.to === to);
});
t('페이지의 볼륨 라벨 규칙(2019 기준 4분기)이 그대로다',
  /var qi=vol-1, y=2019\+Math\.floor\(qi\/4\), ms=\(qi%4\)\*3/.test(mag),
  '이 규칙이 바뀌면 위 범위 계산도 함께 고쳐야 한다');
t('BASE_VOL(동적 볼륨 시작)과 EPOCH 전제가 유지된다',
  /var EPOCH=new Date\('2026-04-01/.test(mag) && /BASE_VOL=30/.test(mag));

console.log('\n=== 4. API 기간 필터 (이관분을 불러오는 근거) ===');
t('/api/editorials 가 from 필터를 지원', /query\.gte\('published_date', req\.query\.from\)/.test(edApi));
t('/api/editorials 가 to 필터를 지원', /query\.lte\('published_date', req\.query\.to\)/.test(edApi));
t('날짜 형식을 검증한다 (임의 문자열 주입 방지)',
  /DATE_RE\s*=\s*\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//.test(edApi));
t('프론트가 from/to 를 붙여 분기만 요청한다',
  /\/api\/editorials\?public=1&limit=\d+&from='\s*\+\s*r\.from\s*\+\s*'&to='\s*\+\s*r\.to/.test(mag));
t('볼륨별 응답을 캐시한다 (같은 볼륨 재요청 방지)', /_volEdCache/.test(mag));
t('네트워크 실패 시 폴백이 있다', /qvOpenLegacyRaw\(vol\)/.test(mag));

console.log('\n=== 5. 아카이브 총계가 한 값으로 통일되는가 (QA: 하단 CTA 숫자 불일치) ===');
/* 같은 숫자를 쓰는 곳이 셋이다 — 히어로 배지 / 하단 구독 CTA / 구독 모달.
   앞선 papRegroupByQuarter 가 정적 카드 기준으로 셋을 채우는데, 최종
   renderAll 이 배지만 갈아끼우면 화면에 두 숫자가 공존한다.
   실측(수정 전 라이브): 배지 "31 ISSUES · 2,206+" vs CTA "29 issues, 2,120+". */
const renderAllBody = (mag.match(/function renderAll\(dynCards,dynVols,dynEds\)\{[\s\S]*?\n  \}/) || [''])[0];
t('renderAll 을 찾았다', renderAllBody.length > 0);
t('renderAll 이 히어로 배지를 갱신한다', /getElementById\('heroBadge'\)/.test(renderAllBody));
t('renderAll 이 하단 구독 CTA 도 함께 갱신한다',
  /getElementById\('subCtaDesc'\)/.test(renderAllBody),
  '배지만 갱신하면 CTA 가 옛 숫자로 남는다');
t('renderAll 이 구독 모달용 전역값도 갱신한다',
  /_papTotalVolumes\s*=\s*total/.test(renderAllBody) &&
  /_papTotalEditorialsBucket\s*=/.test(renderAllBody),
  '모달만 옛 숫자로 남는다');
t('세 곳이 같은 소스(total / legacyEds+dynEds)를 쓴다',
  /var _edTotal = legacyEds \+ dynEds/.test(renderAllBody) &&
  (renderAllBody.match(/_edTotal/g) || []).length >= 3);

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ magazine-issue-detail tests FAILED'); process.exit(1); }
console.log('✅ magazine-issue-detail tests passed');
