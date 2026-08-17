/**
 * 발신 링크 계측 커버리지 — tests/utm-coverage.test.js (2026-08-08 신설)
 *
 * 성장 헌법 3조의 집행 장치: "모든 외부 발신 링크에는 utm_source 를 붙인다.
 * 웹→IG 는 /api/ig-out 경유만." 전수 감사(2026-08-08) 실측:
 *
 *   스레드   매일 발신 · 링크 맨몸 → utm=threads 가 한 번도 안 찍힘 (유령 채널)
 *   유튜브   설명란 기사 링크 맨몸 (클릭 가능한데 미계측)
 *   이메일   웹 링크 전부 맨몸 + 주간 다이제스트엔 PAP 링크가 아예 0개
 *   X        withUtm 적용돼 있었음 (정상)
 *   카카오   utm=kakao 적용돼 있었음 (정상)
 *   틱톡     캡션 URL 은 클릭 불가(텍스트) — utm 은 소음이라 의도적으로 제외
 *
 * 여기서 지키는 것: 위 보수가 되돌아가지 않는다.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const th = R('api/_lib/threadsAutopost.js');
const yt = R('api/cron/youtube-post.js');
const em = R('api/_lib/email.js');
const igOut = R('api/ig-out.js');
const x = R('api/_lib/xPost.js');
const seo = R('api/_lib/seoRenderer.js');

console.log('\n[1] 스레드 — 유령 채널 탈출');
{
  t("링크에 utm_source=threads 를 붙인다", /utm_source', 'threads'/.test(th));
  t('utm 붙인 링크가 실제로 텍스트 생성에 들어간다', /generateThreadsText\(art, linkWithUtm\)/.test(th));
  t('URL 파싱 실패 시 원본 폴백 (게시가 utm 에 인질 잡히지 않게)', /catch \(_\) \{ return art\.url; \}/.test(th));
}

console.log('\n[2] 유튜브 — 설명란 링크 계측');
{
  t('기사 링크에 utm_source=youtube', /utm_source=youtube&utm_medium=social/.test(yt));
  t('기존 쿼리가 있으면 & 로 잇는다', /url\.indexOf\('\?'\) >= 0 \? '&' : '\?'/.test(yt));
  t('IG 링크는 기존 경로형(/ig/youtube) 유지 — 외부 앱 쿼리 소실 대비', /\/ig\/youtube/.test(yt));
}

console.log('\n[3] 이메일 — 유령 채널 2호 탈출');
{
  t('utm 헬퍼가 있다 (utm_source=newsletter)', /utm_source=newsletter&utm_medium=email/.test(em));
  t('헤더 로고 링크 계측', /href="\$\{withMailUtm\(FRONTEND_URL\)\}" style="color:#fff;font-size:28px/.test(em));
  t('에디토리얼 카드 링크 계측', /withMailUtm\(`\$\{FRONTEND_URL\}\/editorial\//.test(em));
  t('IG 팔로우 버튼이 ig-out 을 경유한다 (직링크 금지)', /IG_FOLLOW_MAIL/.test(em)
    && /ig-out\?src=newsletter&to=profile/.test(em));
  t('공통 셸에 인스타 직링크가 안 남았다',
    !/href="https:\/\/www\.instagram\.com\/pap_magazine\/" style="display:inline-block;background:#fff/.test(em));
  /* 주간 다이제스트: PAP 링크 0개였던 구멍 */
  t('주간 다이제스트에 PAP CTA 가 있다', /VIEW PAP MAGAZINE/.test(em));
  t('다이제스트 IG 팔로우도 계측 경유', /FOLLOW @PAP_MAGAZINE<\/a>/.test(em));
  t('ig-out 화이트리스트에 newsletter 가 있다', /'submission_done', 'newsletter'/.test(igOut));
}

console.log('\n[4] 기존 계측 회귀 방지');
{
  // 2026-08-17 — campaign 이 고정값에서 게시물 slug 로 바뀜 (게시물 단위 계측)
  t('X 는 withUtm 유지 (slug campaign)', /withUtm\(art\.url, 'x', slugCampaign\(art\.url, 'pap_auto'\)\)/.test(x));
  t('카카오 공유 utm 유지 (SSR)', /utm_source=kakao&utm_medium=share/.test(seo));
  t('canonical 은 여전히 utm 무오염', !/const canonical = [^\n]*utm_/.test(seo));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ utm-coverage tests FAILED'); process.exit(1); }
console.log('✅ utm-coverage tests passed');
