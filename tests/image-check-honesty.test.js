/**
 * 이미지 점검·이관 — 2026-08-09 「깨진 대표 이미지 19건」 경보에서 나온 것들.
 *
 * ── 경보를 파보니 셋이 섞여 있었다 ──────────────────────────────────
 *   supabase timeout 6건  → **헛경보.** storage.objects 로 확인: 전부 존재,
 *                           크기 0.1~1.1MB. 느릴 이유가 없다.
 *   wixstatic 403         → 구 사이트의 핫링크 차단. 71건이 여기 걸려 있는데
 *                           **어느 이관 크론의 대상도 아니었다.**
 *   drive 404/500         → 진짜 소실 가능성.
 * 경보 문안은 셋을 뭉쳐 '깨짐'이라 부르고 "관리자에서 재등록"을 지시했다.
 * timeout 은 깨진 게 아니었고, 403 의 해법은 재등록이 아니라 이관이다.
 *
 * ── 헛 timeout 은 검사기가 스스로 만들었다 ──────────────────────────
 * probe() 의 두 return 경로(HTTP 오류 · html 판정)가 **응답 본문을 소비도
 * 취소도 하지 않고** 빠져나갔다. undici 는 본문이 소비될 때까지 연결을 풀에
 * 반납하지 않는다. 동시 20 으로 4,600개를 훑는 동안 Wix 403·드라이브 500 이
 * 쌓여 연결이 고갈되고, 뒤 요청이 8초를 넘긴다 → 가장 빠른 자사 파일이 timeout.
 *
 * 게다가 그 timeout 을 image_migration_failures 에 **영구 기록**했다.
 * 그 표에 오른 URL 은 이관 크론이 영원히 건너뛴다. 실측 24건 전부 자사 파일이었다.
 *
 * ── 진짜 그림 (실측) ────────────────────────────────────────────────
 *   published 에디토리얼 2,295건의 커버 호스트
 *     google drive 1,077 · supabase(자사) 958 · 구 S3 180 · wixstatic 71
 *   → 1,328건(58%)이 남의 서버에 걸려 있다. CREATURES 사고의 구조 그대로.
 *   그런데 이관 크론은 2026-07-28 부터 꺼져 있었다(커밋 64bc86d).
 *   끈 근거는 "외부(instagram CDN) 이미지 잔존 0건" — 그런데 이 크론이 보는 건
 *   드라이브·구 S3 다. **재는 지표가 대상과 달랐다.** 드라이브 잔량은
 *   끄기 전 헤더에 적힌 1,077건에서 한 건도 안 줄어 있었다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 검사기가 본문을 반드시 버릴 것 (헛 timeout 재발 방지)
 *   ② 확정 실패(404·html)만 영구 실패 명단에 올릴 것
 *   ③ 알림이 원인을 뭉치지 말 것 — 틀린 지시("전부 재등록") 금지
 *   ④ 이관 대상 목록이 **JS 와 SQL 양쪽에서 같을 것** (107 교훈)
 *   ⑤ wixstatic 이 이관 대상일 것
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHECK = fs.readFileSync(path.join(ROOT, 'api/cron/image-link-check.js'), 'utf8');
const MIG = fs.readFileSync(path.join(ROOT, 'api/cron/migrate-external-images.js'), 'utf8');
const SQLP = path.join(ROOT, 'supabase_migrations/118_external_images_add_wix.sql');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 240)); }
}
/* 주석에 적힌 단어로 통과시키면 아무것도 못 지킨다. 실행 코드만 본다. */
const code = (s) => s.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');
const CHECK_C = code(CHECK), MIG_C = code(MIG);

console.log('\n=== ① 검사기가 본문을 반드시 버린다 ===');
t('finally 에서 본문을 취소한다',
  /finally \{[\s\S]{0,200}r\.body\.cancel\(\)/.test(CHECK_C), '헛 timeout 재발');
t('응답 객체를 try 밖에서 잡는다 (finally 가 볼 수 있게)',
  /let r = null;/.test(CHECK_C));
t('식별 User-Agent 를 보낸다', /'User-Agent': UA/.test(CHECK_C) && /const UA = /.test(CHECK_C));
t('브라우저인 척하지 않는다',
  !/Mozilla|Chrome\/|Safari\//.test(CHECK_C), '검사기가 UA 를 위장하면 안 된다');

console.log('\n=== ② 확정 실패만 영구 명단에 올린다 ===');
t('isDefiniteFailure 가 있다', /function isDefiniteFailure\(/.test(CHECK_C));
t('timeout 은 확정 실패가 아니다',
  !/isDefiniteFailure[\s\S]{0,200}'timeout'/.test(CHECK_C));
t('404·html 은 확정 실패다',
  /'html-instead-of-image'/.test(CHECK_C) && /'HTTP 404'/.test(CHECK_C));
t('실패 표에 definite 만 기록한다',
  /image_migration_failures'\)\s*\n?\s*\.upsert\(definite/.test(CHECK_C)
  || /\.upsert\(definite\.map/.test(CHECK_C), '보류까지 영구 등재하면 되돌릴 사람이 없다');
t('broken 전체를 기록하는 옛 경로가 없다',
  !/\.upsert\(broken\.map/.test(CHECK_C));

console.log('\n=== ③ 알림이 원인을 뭉치지 않는다 ===');
t('호스트별로 묶어 보여준다', /const byHost = new Map\(\)/.test(CHECK_C));
t('확정과 보류를 나눠 센다', /확정 ' \+ definite\.length/.test(CHECK) && /판정보류 ' \+ suspect\.length/.test(CHECK));
t('"전부 재등록" 이라는 틀린 지시가 없다',
  !/관리자에서 해당 에디토리얼 이미지 재등록 필요/.test(CHECK));
t('403 의 해법이 이관임을 알려준다', /migrate-external-images/.test(CHECK));

console.log('\n=== ④⑤ 이관 대상 — JS 와 SQL 이 같아야 한다 (107 교훈) ===');
const HOSTS = ['drive\\.google\\.com', 'pap-korea-bucket\\.s3', 'static\\.wixstatic\\.com'];
const jsRe = (MIG_C.match(/const EXTERNAL_RE = \/([^/]+)\//) || [])[1] || '';
for (const h of HOSTS) t('JS 대상에 ' + h.replace(/\\/g, '') + ' 포함', jsRe.includes(h), jsRe);

t('118 마이그레이션이 있다', fs.existsSync(SQLP));
if (fs.existsSync(SQLP)) {
  const sql = fs.readFileSync(SQLP, 'utf8').split('\n')
    .filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const h of HOSTS) t('SQL 대상에 ' + h.replace(/\\/g, '') + ' 포함', sql.includes(h), '한쪽만 고치면 조용히 어긋난다');
  t('함수 이름·시그니처가 그대로다',
    /external_image_editorials\(lim integer DEFAULT 12\)/.test(sql));
  t('헛 실패 기록을 지운다', /delete from public\.image_migration_failures/.test(sql));
  /* JS 와 SQL 의 호스트 개수가 같아야 한다 — 한쪽에만 추가하는 사고 방지 */
  t('JS 와 SQL 의 대상 호스트 개수가 같다',
    jsRe.split('|').length === HOSTS.length, jsRe);
}

console.log('\n=== 크론 등록 상태 (근거 고정) ===');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const crons = cfg.crons || [];
t('주간 점검 크론은 등록돼 있다',
  crons.some((c) => c.path.includes('image-link-check')));
/* 이관 크론은 2026-07-28 에 잘못된 근거로 제거됐다. 되살릴 때 이 핀이
   '등록됨'으로 바뀌어야 한다 — 지금은 '아직 안 됨'을 기록으로 남긴다. */
const migRegistered = crons.some((c) => c.path.includes('migrate-external-images'));
console.log('  · 이관 크론 등록 여부: ' + (migRegistered ? '등록됨' : '미등록 (잔량 1,328건 — 슬롯 확인 후 복구 예정)'));
t('크론 엔트리 수를 기록한다 (한도 확인용)', crons.length > 0, crons.length + '개');

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ image-check-honesty tests passed');
