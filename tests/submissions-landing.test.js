/**
 * 공개 서브미션 랜딩 /submissions (2026-08-26 신설 — 유료 구독자 늘리기 1탄-③)
 *
 * [근거 실측] GSC 3개월 'submi*' 키워드 0건, 리스트 사이트 백링크 0.
 * SERP 실측('fashion magazine submissions', US): 상위 10 중 6개가 매거진
 * 자체 /submissions 페이지(DR 33~67), KD 0 — 우리 페이지가 낄 자리가 있다.
 *
 * 지키는 것:
 *  ① 색인 경로 4종이 전부 연결돼 있다 (rewrite·sitemap·SSR nav·llms.txt)
 *     — instagram-magazine 때 고아 페이지 전철 방지
 *  ② 페이지가 약속하는 규칙이 실제 서브미션 폼 규칙과 일치한다
 *     (무료 = 룩 4+ & 의상 브랜드 4종+, €380/€790, 수락 시에만 청구)
 *  ③ CTA 는 실제 제출 위치(/submission)로 간다
 *  ④ FAQ/HowTo JSON-LD 가 유효한 JSON 이다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, fn) {
  try { fn(); pass++; console.log('  ✓', n); }
  catch (e) { fail++; console.log('  ✗', n, '—', e.message); }
}

console.log('submissions-landing');

const PAGE = R('frontend/submissions.html');
const VERCEL = R('vercel.json');
const SITEMAP = R('api/sitemap.js');
const SEO = R('api/_lib/seoRenderer.js');
const LLMS = R('frontend/llms.txt');
const FORM = R('frontend/submission.html');

t('색인 경로 4종 연결 — rewrite·sitemap·SSR nav·llms.txt', () => {
  /* 2026-08-26 — 포맷 의존 정규식이 배포 5건을 연속으로 죽였다. 로컬 파일은
     source 줄 뒤에 개행이 있어 통과했지만, Vercel 빌드 환경의 vercel.json 은
     재직렬화돼 개행이 달라 같은 커밋이 실패했다(dpl_BvhW·dpl_2Svc 실측 —
     캐시 무시 재배포도 동일 실패, 다른 파일 검사 4종은 전부 통과).
     내용이 아니라 포맷을 검사한 게 잘못이다. JSON 으로 파싱해 사실을 검사한다. */
  const _cfg = JSON.parse(VERCEL);
  const _rw = (_cfg.rewrites || []).some((r) => r && r.source === '/submissions' && r.destination === '/submissions.html');
  assert.ok(_rw, 'vercel rewrite 없음 — rewrites 내 /submissions 항목: '
    + JSON.stringify((_cfg.rewrites || []).filter((r) => r && String(r.source).indexOf('submissions') !== -1)));
  assert.ok(/path: '\/submissions'/.test(SITEMAP), 'sitemap 엔트리 없음');
  assert.ok(/\/submissions">Submissions<\/a>/.test(SEO), 'SSR nav 링크 없음');
  assert.ok(/pap-magazine\.com\/submissions\)/.test(LLMS), 'llms.txt 엔트리 없음');
});

t('무료 게재 규칙이 서브미션 폼과 일치한다 (룩 4+ & 브랜드 4종+ / €380 / €790)', () => {
  assert.ok(/4\+ looks/.test(PAGE) && /4\+ different clothing brands/.test(PAGE), '무료 조건 명시 없음');
  assert.ok(/€380/.test(PAGE) && /€790/.test(PAGE), '유료 금액 없음');
  assert.ok(/only if your work is accepted|only if accepted/.test(PAGE), '수락 시에만 청구 문구 없음');
  // 폼 쪽 근거가 사라지면(규칙 변경) 이 페이지도 같이 고쳐야 한다
  assert.ok(/4 different clothing brands/.test(FORM), '폼의 4브랜드 규칙이 사라짐 — 랜딩도 갱신 필요');
  assert.ok(/€380/.test(FORM) && /€790/.test(FORM), '폼의 금액이 사라짐 — 랜딩도 갱신 필요');
});

t('CTA 는 실제 제출 폼(/submission)으로 간다', () => {
  assert.ok(PAGE.includes('href="https://www.pap-magazine.com/submission"'), '제출 CTA 없음');
});

t('JSON-LD 가 유효하고 FAQ·HowTo 를 포함한다', () => {
  const m = PAGE.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(m, 'JSON-LD 블록 없음');
  const j = JSON.parse(m[1]);
  const types = j['@graph'].map(x => x['@type']);
  assert.ok(types.includes('FAQPage'), 'FAQPage 없음');
  assert.ok(types.includes('HowTo'), 'HowTo 없음');
  assert.ok(types.includes('BreadcrumbList'), 'Breadcrumb 없음');
});

t('canonical·robots·심사 기간(1–3 business days) 명시', () => {
  assert.ok(PAGE.includes('rel="canonical" href="https://www.pap-magazine.com/submissions"'), 'canonical 없음');
  assert.ok(/index,follow/.test(PAGE), 'robots 없음');
  assert.ok(/1–3 business days/.test(PAGE), '심사 기간 없음');
});

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
