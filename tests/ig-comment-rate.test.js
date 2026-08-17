/**
 * 댓글율을 대표 지표로 승격 (2026-08-17 신설)
 *
 * 배경 — 2026-08-16 에 대표 지표를 공유율에서 저장율로 정정했다. 그때 비교한
 * 것은 저장·좋아요·공유 셋뿐이었고 **댓글이 아예 빠져 있었다.**
 * 캐러셀 144편(도달 1,000+·전환 측정분)으로 다시 재니:
 *
 *     프로필방문율 0.468 · 저장율 0.457 · 댓글율 0.417 · 좋아요율 0.347 · 공유율 0.148
 *
 * 댓글이 저장과 사실상 동급이다. 프로필방문은 팔로우와 거의 같은 사건이라
 * 레버가 아니지만, 댓글은 캡션으로 직접 만들 수 있는 레버다.
 *
 * 이 하네스가 지키는 것:
 *   ① 댓글율이 API 응답에 있다
 *   ② 쿼리가 comments_count 를 실제로 가져온다 (안 가져오면 늘 0 이 된다)
 *   ③ 화면이 댓글율을 보여준다 (숫자 줄 + 상위 표)
 *   ④ 근거 수치가 화면에 적혀 있다 (두 건짜리 표본으로 되돌아가지 않게)
 *   ⑤ 저장율이 여전히 1위다 (댓글을 올리느라 순서를 뒤집지 않았다)
 *   ⑥ 공유율은 남아 있다 (지우지 않는다 — 내려갔을 뿐이다)
 *   ⑦ 도달이 목표가 아니라는 결론이 유지된다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const API = fs.readFileSync(path.join(ROOT, 'api', 'admin', 'ops-dashboard.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'ops-dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 200)); }
}

console.log('\n=== ① API 가 댓글율을 낸다 ===');
{
  t('comment_rate 필드가 있다', /comment_rate: rate\(sum\('comments_count'\), sum\('reach'\)\)/.test(API));
  t('댓글 총합도 낸다', /comments_30d: sum\('comments_count'\)/.test(API));
  t('상위 목록에도 댓글율이 실린다', /comment_rate: rate\(Number\(r\.comments_count\)/.test(API));
  t('상위 목록에 댓글 수도 실린다', /comments: Number\(r\.comments_count\)/.test(API));
}

console.log('\n=== ② 쿼리가 실제로 가져온다 ===');
{
  // 이게 빠지면 댓글율이 조용히 늘 0 이 된다. 0 은 "댓글이 없다" 는 거짓말이다.
  const cols = (API.match(/cols: '([^']*post_id[^']*reach[^']*)'/) || [])[1] || '';
  t('cols 에 comments_count 가 있다', /comments_count/.test(cols), cols);
  t('기존 컬럼이 그대로다',
    ['post_id', 'permalink', 'media_type', 'posted_at', 'captured_at', 'reach', 'shares', 'saved', 'follows']
      .every((c) => cols.includes(c)), cols);
}

console.log('\n=== ③ 화면이 보여준다 ===');
{
  t('숫자 줄에 댓글율', /line\('댓글율', g\.comment_rate/.test(HTML));
  t('댓글 총합을 각주로 보여준다', /댓글 ' \+ nf\(g\.comments_30d\)/.test(HTML));
  t('상위 표에 댓글율 열 머리말', /text-align:right">댓글율<\/th>/.test(HTML));
  t('상위 표에 댓글율 값', /p\.comment_rate \+ '%<\/td>'/.test(HTML));
  t('댓글율이 저장율 바로 아래다 (둘째 자리)',
    HTML.indexOf("line('저장율'") < HTML.indexOf("line('댓글율'")
    && HTML.indexOf("line('댓글율'") < HTML.indexOf("line('공유율'"));
}

console.log('\n=== ④ 근거를 화면에 적어 둔다 ===');
{
  // 근거를 안 적으면 다음 사람이(또는 내가) 두 건짜리 표본으로 되돌아간다.
  // 2026-08-16 에 실제로 그렇게 틀렸다.
  t('상관 수치가 화면에 있다', /댓글율 0\.42/.test(HTML), '화면에 근거 수치 없음');
  t('저장율 수치도 함께', /저장율 0\.46/.test(HTML));
  t('언제 왜 올라왔는지 적혀 있다', /2026-08-17 에 올라왔습니다/.test(HTML));
  t('표본 크기를 밝힌다', /144편/.test(HTML));
  t('API 주석에도 재측정 기록이 있다', /2026-08-17 재측정: 댓글을 빼먹고 있었다/.test(API));
  t('표본 조건 차이를 숨기지 않는다', /표본 조건 차이/.test(API));
  t('프로필방문율이 레버가 아닌 이유를 적어 뒀다', /레버가 아니다/.test(API));
}

console.log('\n=== ⑤ 저장율은 여전히 1위 ===');
{
  t('저장율이 첫 줄', HTML.indexOf("line('저장율'") < HTML.indexOf("line('댓글율'"));
  t('상위 목록 정렬 기준은 그대로 저장율', /\.sort\(\(a, b\) => b\.save_rate - a\.save_rate\)/.test(API));
  t('키 이름 top_by_save_rate 유지 (화면 계약)', /top_by_save_rate/.test(API) && /top_by_save_rate/.test(HTML));
}

console.log('\n=== ⑥⑦ 지우지 않은 것들 ===');
{
  t('공유율이 API 에 남아 있다', /share_rate: rate\(sum\('shares'\)/.test(API));
  t('공유율이 화면에 남아 있다', /line\('공유율', g\.share_rate/.test(HTML));
  t('도달 -0.05 결론이 유지된다', /도달 -0\.05/.test(HTML));
  t('도달 중앙값을 계속 보여준다', /line\('도달 중앙값'/.test(HTML));
  t('전환 사각지대 경고가 남아 있다', /전환 지표가 안 보이는 게시물/.test(HTML));
  t('팔로우 전환율이 남아 있다', /line\('팔로우 전환율'/.test(HTML));
}

console.log('\n' + (fail ? '✗' : '✓') + ' ig-comment-rate: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
