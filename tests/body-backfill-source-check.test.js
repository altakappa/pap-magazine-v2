/**
 * 본문 보강 — '사진 속 글자를 읽었는가' 자가신고 (2026-08-18 신설)
 *
 * ■ 왜 만들었나
 * 워터밤 초안(노출 6,300, 2위 페이지)이 라인업 포스터를 읽어 날짜별
 * 출연진 단락을 만들었다. **린터 경보는 0건이었다.** 사람이 포스터 원본과
 * 대조하니 4곳이 틀렸다.
 *
 *   NGHTMRE      → 엔플라잉    (DJ 를 밴드로)
 *   J.Y. PARK    → 박재범      (박진영을 박재범으로)
 *   NOWIMYOUNG   → 임영웅      (트로트 가수 이름으로)
 *   KC [ SIK-K ] → 케이시      (식케이를 케이시로)
 *
 * 린터는 문체만 본다. 사실은 아무도 안 본다.
 *
 * ■ 왜 자동 판별이 아니라 모델 신고인가 — 시험해 보고 버렸다
 * 초안 31편에 '기존 본문에 없던 토큰' 방식을 실제로 돌렸다.
 *   영문·숫자만  → 11편 표시. 한국어 이름 오독을 통째로 놓친다
 *   한글 3자 이상 → 31편 전부 표시. '장악하고' '잇는다' 같은 어미 변화가
 *                  새 단어로 잡혀 쓸모가 없다
 * 출력만 보고는 못 가른다. 무엇을 근거로 썼는지는 모델만 안다.
 *
 * ■ 이 하네스가 지키는 것
 *   ① 도구가 신고를 **강제**한다 (선택이면 모델이 빼먹는다)
 *   ② 무엇이 true 인지 프롬프트가 구체적으로 말한다
 *   ③ 애매하면 true — 기울기가 안전한 쪽이다
 *   ④ 읽은 글자를 원문 표기 그대로 받는다 (대조하려면 원문이어야 한다)
 *   ⑤ 신고가 DB 까지 간다 (계산만 되고 안 저장되면 없는 것과 같다)
 *   ⑥ 검토 화면이 보여준다 (저장만 되고 안 보이면 없는 것과 같다)
 *   ⑦ 일괄 적용 금지가 그대로다 (이 커밋이 그 결정을 뒤집지 않았다)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const API = fs.readFileSync(path.join(ROOT, 'api', 'admin', 'article-body-backfill.js'), 'utf8');
const MIG = path.join(ROOT, 'supabase_migrations', '130_body_backfill_source_check.sql');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 250)); }
}

console.log('\n=== ① 신고를 강제한다 ===');
{
  t('도구 스키마에 reads_image_text 가 있다', /reads_image_text: \{/.test(API));
  t('image_text 도 있다', /image_text: \{/.test(API));
  const req = (API.match(/required: \[([^\]]*)\]/) || [])[1] || '';
  t('reads_image_text 가 required 다', /reads_image_text/.test(req), req);
  t('image_text 도 required 다', /image_text/.test(req), req);
  t('body_ko·added 가 required 에서 빠지지 않았다',
    /body_ko/.test(req) && /added/.test(req), req);
  t('불리언이다 (문자열 "false" 함정 방지)', /reads_image_text: \{\s*\n?\s*type: 'boolean'/.test(API));
}

console.log('\n=== ② 무엇이 true 인지 말해 준다 ===');
{
  for (const w of ['이름', '날짜', '수치', '계정명']) {
    t('true 예시에 ' + w + ' 이 있다', new RegExp(w).test(API));
  }
  t('false 예시(색·실루엣)도 있다', /색·소재감·실루엣/.test(API));
  t('프롬프트에도 규칙이 실린다', /reads_image_text 는 정직하게 답하라/.test(API));
  t('워터밤 사고가 근거로 적혀 있다', /라인업 포스터/.test(API));
}

console.log('\n=== ③ 애매하면 true ===');
{
  t('스키마가 애매하면 true 라고 못 박는다', /애매하면 true/.test(API));
  t('프롬프트도 같은 말을 한다', /\*\*애매하면 true 로 하라\.\*\*/.test(API));
  t('왜 그쪽으로 기울이는지 이유가 있다', /비용보다 훨씬 싸다/.test(API));
}

console.log('\n=== ④ 읽은 글자는 원문 표기 그대로 ===');
{
  t('본 그대로 적으라고 한다', /본 그대로/.test(API));
  t('한국어로 옮기지 말라고 한다', /한국어로 옮기지 말고/.test(API));
  t('실제 사례가 예시로 들어 있다', /NGHTMRE/.test(API) && /confidenceheist/.test(API));
  t('false 면 빈 문자열', /false 면 빈 문자열/.test(API));
  t('길이를 자른다 (DB 폭주 방지)', /image_text \|\| ''\)\.slice\(0, 500\)/.test(API));
}

console.log('\n=== ⑤ 신고가 DB 까지 간다 ===');
{
  t('true 판정이 엄격하다 (=== true)', /tu\.input\.reads_image_text === true/.test(API),
    '느슨하면 문자열 "false" 가 true 가 된다');
  /* 응답에도 같은 문자열이 있어서, 그것만 보면 저장부를 지워도 통과한다.
     실제로 변이로 확인했다 — 두 줄이 **붙어 있는** 저장 블록을 본다. */
  t('저장 블록에 두 줄이 함께 실린다',
    /reads_image_text: out\.readsImageText,\s*\n\s*image_text_note: out\.imageText \|\| null,/.test(API),
    'update 페이로드에 신고가 안 들어가면 DB 는 영원히 NULL 이다');
  t('저장이 note·generated_at 과 같은 블록이다',
    /image_text_note: out\.imageText \|\| null,\s*\n\s*generated_at:/.test(API));
  t('응답에도 실어 준다', /reads_image_text: out\.readsImageText, image_text: out\.imageText/.test(API));

  t('마이그레이션 130 이 있다', fs.existsSync(MIG));
  const sql = fs.existsSync(MIG) ? fs.readFileSync(MIG, 'utf8') : '';
  t('두 컬럼을 만든다',
    /reads_image_text\s+BOOLEAN/.test(sql) && /image_text_note\s+TEXT/.test(sql));
  t('IF NOT EXISTS 로 재실행 안전', /ADD COLUMN IF NOT EXISTS/.test(sql));
  t('왜 만들었는지 적혀 있다', /린터는 문체만 본다/.test(sql));
}

console.log('\n=== ⑥ 검토 화면이 보여준다 ===');
{
  t('조회 컬럼에 들어 있다', /reads_image_text, image_text_note/.test(API));
  t('대조 대상 건수를 센다', /const checkCount = drafts\.filter\(\(r\) => r\.reads_image_text === true\)\.length/.test(API));
  t('카드에 표시가 붙는다', /const src = r\.reads_image_text === true/.test(API));
  t('무엇을 하라는지 화면이 말한다', /원본과 대조할 것/.test(API));
  t('읽은 글자를 화면에 보여준다', /읽었다고 신고한 글자/.test(API));
  t('요약줄에 건수가 나온다', /사진 속 글자를 읽은 초안 ' \+ n\(checkCount\)/.test(API));
  t('나머지는 안 봐도 된다고 말해 준다', /틀려도 손해가 작다/.test(API));
  t('문체 경보와 다른 색이다 (src 클래스)', /\.src\{background:#fdecec/.test(API));
}

console.log('\n=== ⑦ 일괄 적용 금지는 그대로다 ===');
{
  /* 어제의 결정을 이 커밋이 뒤집지 않았는지 본다. 검수 부담을 줄이는 것과
     한 번에 다 바꾸는 것은 다른 문제다. 후자는 도메니코가 정할 일이다. */
  t('일괄 적용 링크가 없다', !/apply=all|applyAll|apply_all/.test(API));
  t('건별 적용 링크는 그대로', /\?apply=1&amp;id=/.test(API));
  t('되돌리기도 그대로', /\?revert=1&amp;id=/.test(API));
  t('한 건씩 누른다는 안내가 남아 있다', /적용은 한 건씩 누른다/.test(API));
}

console.log('\n' + (fail ? '✗' : '✓') + ' body-backfill-source-check: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
