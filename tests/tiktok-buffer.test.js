/**
 * 틱톡 → Buffer 전환 + 침묵 감지 (2026-08-07 신설)
 *
 * 왜 필요했나 — 틱톡은 21일 동안 한 건도 안 올라갔는데 cron_runs 는 전부
 * ok=true 였다. 원인은 두 겹이다:
 *   ① 정책: TikTok 앱 심사가 07-10 '거절'됐다. 개인·사내용은 승인 안 한다는
 *      정책 거절이라 재신청해도 안 된다. → Buffer(공식 파트너) 경유로 전환.
 *   ② 코드: 조기 반환에서 note 를 JSON 으로만 돌려주고 res.locals.cronNote
 *      에 안 넣어서, 기록에 '성공·메모 없음'만 쌓였다. 대시보드는 평화로웠다.
 *
 * 여기서 지키는 것:
 *   ① 모든 조기 반환이 res.locals.cronNote 를 세운다 (침묵 재발 방지)
 *   ② 캡션이 Buffer/TikTok 상한(2200자)을 넘지 않는다
 *   ③ 후보가 없으면 울리지 않는다 — 오탐 방지
 *   ④ 키 미설정으로 전 회차를 건너뛰면 cause='not-configured'
 *   ⑤ 실패가 쌓이면 cause='failing'
 *   ⑥ 후보가 있는데 생산 0이면 cause='stalled'
 *   ⑦ 소스에 TikTok 직접게시(DIRECT_POST) 잔재가 남아 있지 않다
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('pushAlert.js', { pushAlert: async () => ({ ok: true }) });
stub('instagramImport.js', {
  listRecentMedia: async () => [],
  isLikelyEditorialCaption: () => false,
  _extractShortcode: () => null,
});
stub('cronGuard.js', { withCronGuard: (_name, fn) => fn });
stub('backfillHealth.js', { diagnoseBackfill: () => ({}), buildBackfillAlert: () => ({}) });
stub('translateHealth.js', { judgeTranslateHealth: () => ({}), buildTranslateAlert: () => ({}) });
stub('faqHealth.js', { judgeFaqHealth: () => ({}), buildFaqAlert: () => ({}), summarizeFaqRuns: () => ({}) });
stub('cronDurationHealth.js', { summarizeDurations: () => ({}), judgeCronDuration: () => ({}), buildCronDurationAlert: () => ({}) });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const watch = require(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'));
const tt = require(path.join(ROOT, 'api', 'cron', 'tiktok-post.js'));
const buffer = require(path.join(ROOT, 'api', '_lib', 'buffer.js'));

const J = watch.judgeTikTokHealth;
const base = { candidates: 5, producedInWindow: 0, failedInWindow: 0, runsInWindow: 13, unconfiguredRuns: 0, windowHours: 30 };

console.log('\n[1] 판정 로직 — 오탐 방지가 최우선');
t('후보 0건이면 생산 0이어도 정상 (올릴 게 없는 것)',
  J({ ...base, candidates: 0 }).healthy === true);
t('한 건이라도 게시했으면 정상',
  J({ ...base, producedInWindow: 1 }).healthy === true);
t('실행 1회뿐이면 판단 보류 (표본 부족)',
  J({ ...base, runsInWindow: 1 }).healthy === true);
t('후보 있는데 13회 돌고 0건 → stalled',
  J(base).healthy === false && J(base).cause === 'stalled', J(base));

console.log('\n[2] 21일 침묵의 정확한 모양 — 키 미설정');
const unconf = J({ ...base, runsInWindow: 13, unconfiguredRuns: 13 });
t('전 회차 키 미설정 → cause=not-configured', unconf.cause === 'not-configured', unconf);
t('키 미설정은 후보 0건이어도 잡는다 (설정 문제는 콘텐츠와 무관)',
  J({ ...base, candidates: 0, unconfiguredRuns: 13 }).healthy === false);
t('일부만 미설정이면 not-configured 아님 (배포 직후 혼재 허용)',
  J({ ...base, unconfiguredRuns: 5, producedInWindow: 1 }).healthy === true);

console.log('\n[3] 실패·미실행');
t('실행 0회 → cause=no-runs', J({ ...base, runsInWindow: 0 }).cause === 'no-runs');
t('실패 1건이면 성공이 있어도 운다',
  J({ ...base, failedInWindow: 1, producedInWindow: 2 }).cause === 'failing');
t('no-runs 가 not-configured 보다 먼저 (더 근본 원인)',
  J({ ...base, runsInWindow: 0, unconfiguredRuns: 0 }).cause === 'no-runs');

console.log('\n[4] 알림 문구');
const a = watch.buildTikTokAlert(J(base), 'https://x.test');
t('제목에 원인이 들어간다', /생산 정지/.test(a.title), a.title);
t('진단 명령이 들어간다', a.lines.join(' ').indexOf('channels=1') !== -1, a.lines);
t('숫자(후보·게시·실패·실행)가 들어간다',
  /후보 5건 · 게시 0건 · 실패 0건 · 실행 13회/.test(a.lines.join(' ')), a.lines);

console.log('\n[5] 캡션 — Buffer/TikTok 2200자 상한');
t('CAPTION_MAX 는 2200', tt.CAPTION_MAX === 2200, tt.CAPTION_MAX);
const longCredits = Array.from({ length: 200 }, (_, i) => ({ roles: ['Photographer ' + i], name: '이름'.repeat(10), instagram: '@handle' + i }));
const cap = tt.buildCaption({ title: '가'.repeat(300), description: '설명. 두번째.', slug: 'x'.repeat(200), credits: longCredits });
t('아무리 길어도 2200자를 넘지 않는다', cap.length <= 2200, cap.length);
t('크레딧이 중간에 잘려 반쪽 줄로 끝나지 않는다', !/▪[^▪]*$/.test(cap.slice(-40)) || cap.indexOf('▶') !== -1);
const capShort = tt.buildCaption({ title: 'TEST', description: '설명입니다. 다음.', slug: 'test', credits: [{ roles: ['Photographer'], name: 'Maren', instagram: '@marennl' }] });
t('크레딧 줄이 역할·이름·핸들을 담는다', capShort.indexOf('▪ Photographer : Maren @marennl') !== -1, capShort);
t('출처 URL 이 들어간다', capShort.indexOf('pap-magazine.com/editorial/test') !== -1);
t('해시태그는 5개 이하', (capShort.match(/#[^\s#]+/g) || []).length <= 5, capShort.match(/#[^\s#]+/g));

console.log('\n[6] 침묵 재발 방지 — 조기 반환마다 cronNote');
const src = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'tiktok-post.js'), 'utf8');
// 반환문이 여러 줄에 걸치므로 '한 줄'이 아니라 '문장 전체'를 본다.
// (한 줄만 보면 멀쩡한 코드를 실패로 읽어 테스트가 거짓말을 한다)
const RET = 'return res.status(200).json(';
const earlyReturns = [];
for (let i = src.indexOf(RET); i !== -1; i = src.indexOf(RET, i + 1)) {
  const end = src.indexOf('});', i);
  earlyReturns.push(src.slice(i, end === -1 ? i + 400 : end + 3));
}
t('200 조기 반환이 실제로 존재한다', earlyReturns.length >= 4, earlyReturns.length);
t('모든 200 반환이 note(res, …) 를 통과한다',
  earlyReturns.every((r) => r.indexOf('note(res,') !== -1),
  earlyReturns.filter((r) => r.indexOf('note(res,') === -1));
t('note() 가 res.locals.cronNote 를 세운다', /res\.locals\.cronNote = msg/.test(src));
t('502/500 실패 경로도 cronNote 를 남긴다',
  (src.match(/note\(res, '[^']*실패/g) || []).length >= 2
  && /note\(res, '크론 예외/.test(src));

console.log('\n[7] 직접게시(DIRECT_POST) 잔재 제거');
t('tiktok-post.js 가 directPostPhotos 를 더 이상 쓰지 않는다',
  src.indexOf('directPostPhotos') === -1);
// 주석에는 남아 있어도 된다(왜 없앴는지 기록). 코드에서만 사라지면 된다.
t('TIKTOK_PUBLIC 게이트가 코드에서 사라졌다 (21일 침묵의 방아쇠)',
  src.indexOf('process.env.TIKTOK_PUBLIC') === -1);
t('toOwnedImageUrl 은 유지 (Buffer 도 공개 직링크만 받는다)',
  src.indexOf('toOwnedImageUrl') !== -1);
t('Buffer 로 보낸다', /require\('\.\.\/_lib\/buffer'\)/.test(src));

console.log('\n[8] Buffer 클라이언트');
t('키 없으면 isConfigured=false', (() => {
  const old = process.env.BUFFER_API_KEY; delete process.env.BUFFER_API_KEY;
  const r = buffer.isConfigured(); if (old !== undefined) process.env.BUFFER_API_KEY = old; return r === false;
})());
t('service 비교는 대소문자·기호 무시 (TikTok vs tiktok)',
  buffer._norm('TikTok') === 'tiktok' && buffer._norm('Tik-Tok') === 'tiktok');
const bsrc = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'buffer.js'), 'utf8');
t('schedulingType 은 automatic 고정 (notification 이면 손으로 올려야 한다)',
  /schedulingType: 'automatic'/.test(bsrc) && bsrc.indexOf("'notification'") === -1);
t('기본 mode 는 shareNow (무료 플랜 예약 10건 상한 회피)',
  /opts\.mode \|\| 'shareNow'/.test(bsrc));
t('엔드포인트는 api.buffer.com', /const API = 'https:\/\/api\.buffer\.com'/.test(bsrc));
t('401/403 을 인증 실패로 구분해 말한다', /Buffer 인증 실패/.test(bsrc));
t('이미지는 10장으로 제한 (TikTok 캐러셀 상한)', /opts\.maxImages \|\| 10/.test(bsrc));

console.log('\n[9] 크론 등록 확인');
const crons = require(path.join(ROOT, 'vercel.json')).crons || [];
t('tiktok-post 크론이 vercel.json 에 살아 있다',
  crons.some((c) => c.path === '/api/cron/tiktok-post'), crons.filter((c) => /tiktok/.test(c.path)));
/* 2026-08-13 — 기사 모드 중지. 기사 갤러리는 제3자 이미지(브랜드·에이전시·타 매체)라
   워터마크도 출처 표기도 없이 2시간마다 재게시하는 것은 TikTok 지식재산권·미오리지널
   정책 양쪽에 걸린다. 실측 유입도 0이었다. 크론과 코드 두 곳에서 막는다 —
   크론만 지우면 URL 직접 호출이나 스케줄 복구로 조용히 재개된다. */
t('기사 모드 크론이 제거되어 있다',
  !crons.some((c) => /tiktok-post\?kind=article/.test(c.path)),
  crons.filter((c) => /tiktok/.test(c.path)));
t('코드에서도 기사 모드를 막는다 (크론만 지우면 조용히 되살아난다)',
  /const ARTICLE_MODE_ENABLED = false;/.test(src)
  && /kind === 'article' && !ARTICLE_MODE_ENABLED/.test(src));
t('차단 시에도 cron_runs 에 사유를 남긴다 (돌았다 ≠ 했다)',
  /기사 모드 중지[\s\S]{0,120}note\(res,|note\(res, '기사 모드 중지/.test(src));
t('영상 경로와 에디토리얼 사진 모드는 그대로 살아 있다',
  crons.some((c) => c.path === '/api/cron/tiktok-post')
  && crons.some((c) => c.path === '/api/cron/drive-tiktok-post')
  && crons.some((c) => c.path === '/api/cron/drive-youtube-post'));

console.log('\n' + (fail ? '❌' : '✅') + ` ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
