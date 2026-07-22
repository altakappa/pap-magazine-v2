/**
 * pap-geo-lang.js 언어 우선순위 (2026-07-22 QA: 아티클 제목 영문 표기 근본 원인).
 *
 * [라이브 재현으로 확정한 원인] 저장된 pap-lang='ko' 라도 pap-lang-source 가
 * 정확히 'user' 가 아니면(null·'auto'·'geo'), IP 판정이 미매핑 국가(VPN·프록시·
 * 해외망 → 'en')일 때 자동 감지가 저장값을 덮었다. 'user' 표시를 남기는 경로는
 * 셀렉터 리스너 하나뿐이라(노드 교체 시 소실) 보호가 사실상 작동하지 않았다.
 * 홈 카드는 항상 한국어라 멀쩡했고, pap-lang 을 따르는 아티클만 영문이 됐다.
 *
 * [수정 정책 — 이 테스트가 지키는 것]
 *  1. 저장 언어 + 출처 없음(레거시/직접 setLang) → 사용자 선택으로 승격·보호
 *  2. 출처 'user' → 절대 불변
 *  3. 지난 방문의 'auto' 저장값도 IP 보정이 덮지 못함 (같은 로드에서 방금 넣은
 *     자동 추측만 IP 로 정정 가능 — 첫 방문 UX 는 유지)
 *  4. 첫 방문(저장값 없음)은 브라우저 추측 → IP 정정 정상 동작
 *
 * 검증 방식: 실제 파일을 mock globals 로 실행해 시나리오별 최종 상태를 확인한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'pap-geo-lang.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

function makeEnv(seed, navLang){
  const store = new Map(Object.entries(seed || {}));
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k,v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const document = { addEventListener(){}, dispatchEvent(){}, getElementById(){ return null; } };
  const window = {};
  const navigator = { language: navLang || 'en-US' };
  const fetch = () => Promise.reject(new Error('network disabled in test'));
  const CustomEvent = function(){};
  new Function('window','document','localStorage','navigator','fetch','CustomEvent', src)(
    window, document, localStorage, navigator, fetch, CustomEvent);
  return { window, store, localStorage };
}
const tick = () => new Promise(r => setTimeout(r, 10));

(async () => {
  console.log('\n=== geo-lang 우선순위 (실행 검증) ===');
  const FRESH_TS = String(Date.now());

  // 1) 레거시: ko 저장 + 출처 없음 + IP 캐시 US → ko 유지 + user 승격
  {
    const { window, store } = makeEnv({ 'pap-lang':'ko', 'pap-geo-country':'US', 'pap-geo-ts':FRESH_TS });
    await window.papGeoLang.detect(); await tick();
    t('레거시(출처 없음) ko 는 IP=US 여도 유지된다', store.get('pap-lang') === 'ko', 'got '+store.get('pap-lang'));
    t('레거시 값은 user 로 승격된다', store.get('pap-lang-source') === 'user');
  }

  // 2) user 선택: 절대 불변
  {
    const { window, store } = makeEnv({ 'pap-lang':'ko', 'pap-lang-source':'user', 'pap-geo-country':'US', 'pap-geo-ts':FRESH_TS });
    await window.papGeoLang.detect(); await tick();
    t("source='user' ko 는 불변", store.get('pap-lang') === 'ko');
    t("source 도 'user' 유지(강등 없음)", store.get('pap-lang-source') === 'user');
  }

  // 3) 지난 방문의 auto 저장값: IP 미매핑 국가여도 덮지 않는다 (라이브 재현됐던 버그)
  {
    const { window, store } = makeEnv({ 'pap-lang':'ko', 'pap-lang-source':'auto', 'pap-geo-country':'US', 'pap-geo-ts':FRESH_TS });
    await window.papGeoLang.detect(); await tick();
    t("지난 방문 'auto' ko 도 IP=US 가 덮지 못한다 (버그 재현 시나리오)", store.get('pap-lang') === 'ko', 'got '+store.get('pap-lang'));
  }

  // 4) 첫 방문: 브라우저 en 추측 → IP=KR 로 정정 (정상 UX 유지)
  {
    const { window, store } = makeEnv({ 'pap-geo-country':'KR', 'pap-geo-ts':FRESH_TS }, 'en-US');
    await window.papGeoLang.detect(); await tick();
    t('첫 방문은 IP(KR) 정정이 동작한다 → ko', store.get('pap-lang') === 'ko', 'got '+store.get('pap-lang'));
  }

  // 5) 수동 선택 감지 견고화 (정적 감시)
  console.log('\n=== 수동 선택 마킹 (구조 감시) ===');
  t('문서 위임 캡처 리스너로 셀렉터 변경을 감지한다', /document\.addEventListener\('change'[\s\S]*?langSelect/.test(src));
  t('전역 setLang 래핑으로 어떤 경로든 user 마킹', /_papGeoWrapped/.test(src));
  t('내부 적용(_applying) 은 user 로 오인하지 않는다', /_applying/.test(src) && /if\(!_applying\) setSource\('user'\)/.test(src));

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if(fail){ console.log('❌ geo-lang-priority tests FAILED'); process.exit(1); }
  console.log('✅ geo-lang-priority tests passed');
})();
