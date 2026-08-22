/**
 * 스토리 전용 영상 → 유튜브 쇼츠 (2026-08-21 신설)
 *
 * 배경 — 인스타 스토리에만 올라간 영상은 피드 게시물이 없고 따라서 기사도 없다.
 * 기존 drive-youtube-post 는 '기사 1건 = 영상 1건' 전제라 이런 영상을 영원히
 * 매칭 실패로만 남긴다. 실패 로그가 상시로 깔리면 진짜 실패가 그 안에 묻힌다.
 *
 * 여기서 지키는 것:
 *   ① 제목은 파일명에서 온다 (AI 판단 없음 — 틀린 제목이 공개로 안 나간다)
 *   ② 압축 중 임시 파일 차단 규칙을 새 경로도 똑같이 탄다 (b_4-WtPB6rA 사고)
 *   ③ 기존 경로와 폴더가 안 겹친다 (하위 폴더만 본다)
 *   ④ 기록 실패를 삼키지 않는다 (기록 없으면 다음 회차가 또 올린다)
 *   ⑤ 외부 링크는 utm·계측 경로 (성장 헌법 3항)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* driveVideos 는 youtube.js → supabase.js 를 끌고 온다. npm test 에는 env 가
   없으므로 그대로 require 하면 '✗' 가 아니라 **프로세스가 통째로 죽는다.**
   (2026-08-20 에 정확히 이 모양으로 한 번 속았다 — 죽은 테스트는 실패조차
   보고하지 못한다.) 그래서 여기서만 가짜로 갈아끼운다. */
function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('youtube.js', { getAccessToken: async () => 'test', uploadVideo: async () => ({ id: 'x' }) });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, d === undefined ? '' : '\n      ' + d); }
}

const src = R('api/cron/drive-story-shorts.js');
const dsrc = R('api/_lib/driveVideos.js');
const vj = JSON.parse(R('vercel.json'));

/* 2026-08-22 — 전에는 여기에 정규화 규칙을 **손으로 베껴** 두고 그 사본을
   검사했다. 그러면 크론 코드만 바뀌어도 테스트는 초록으로 남는다. 같은 날
   압축기 사본이 셋이라 '고쳤는데 안 도는' 일을 겪고 나서 바꿨다 —
   규칙은 한 군데에만 있어야 하고, 테스트는 그 한 군데를 불러야 한다. */
const strip = require(path.join(ROOT, 'api', 'cron', 'drive-story-shorts.js')).titleFromFilename;

console.log('\n[1] 제목은 파일명에서 온다');
{
  t('AI·비전 호출이 없다', !/anthropic|claude|vision/i.test(src));
  t('파일명에서 제목을 만드는 함수가 있다', /function titleFromFilename/.test(src));
  t('확장자를 걷어낸다', /A-Za-z0-9\]\{2,4\}\$/.test(src));
  t('압축기 접미사(_압축)를 걷어낸다', /압축\\d\*\$/.test(src));
  t('유튜브 금지문자 < > 를 지운다 (2026-07-19 업로드 400 사고)', /\[<>\]/.test(src));
  t('기존 제목 규격기를 그대로 쓴다 (접두사·접미사 일관성)',
    /buildTitle/.test(src) && /youtubeMeta/.test(src));

  const meta = require(path.join(ROOT, 'api', '_lib', 'youtubeMeta.js'));
  const made = meta.buildTitle({ title: strip('조니워커 변우석 스토리.mp4'), tags: [] });
  t('조니워커 변우석 스토리.mp4 → 사람이 읽을 제목',
    made === '[ CELEBRITY ] 조니워커 변우석 스토리 | PAP MAGAZINE', made);
  t('_압축 접미사가 제목에 안 남는다', strip('라쁠레뜨 팝업_압축.mp4') === '라쁠레뜨 팝업',
    strip('라쁠레뜨 팝업_압축.mp4'));
  t('제목에 < > 가 남지 않는다', strip('<오디세이> 현장.mp4') === '오디세이 현장',
    strip('<오디세이> 현장.mp4'));

  /* ── 날짜 접두어 (2026-08-22) ─────────────────────────────
     08-22 첫 자동 업로드가 `[ NEWS ] 0821 팔라스 | PAP MAGAZINE` 로 나갔다.
     파일 정리용 날짜가 공개 제목에 그대로 실렸다. */
  t('0821 팔라스.MOV → 날짜를 뗀다', strip('0821 팔라스.MOV') === '팔라스', strip('0821 팔라스.MOV'));
  t('구분자 없는 붙임도 뗀다', strip('0821팔라스.mp4') === '팔라스', strip('0821팔라스.mp4'));
  t('YYMMDD 도 뗀다', strip('260821 팔라스 팝업.mp4') === '팔라스 팝업', strip('260821 팔라스 팝업.mp4'));
  t('YYYY-MM-DD 도 뗀다', strip('2026-08-21 팔라스.mp4') === '팔라스', strip('2026-08-21 팔라스.mp4'));
  t('08-21 · 08.21 형태도 뗀다',
    strip('08-21 팔라스.mp4') === '팔라스' && strip('08.21 팔라스.mp4') === '팔라스',
    strip('08-21 팔라스.mp4') + ' / ' + strip('08.21 팔라스.mp4'));

  /* 숫자로 시작한다고 무조건 떼면 진짜 제목이 잘린다. 날짜로 말이 될 때만 뗀다. */
  t('1987 컬렉션 — 월이 19 라 날짜가 아니다, 안 뗀다',
    strip('1987 컬렉션.mp4') === '1987 컬렉션', strip('1987 컬렉션.mp4'));
  t('2026 가을 — 월이 20 이라 날짜가 아니다, 안 뗀다',
    strip('2026 가을 컬렉션.mp4') === '2026 가을 컬렉션', strip('2026 가을 컬렉션.mp4'));
  t('제목이 통째로 날짜면 되돌린다 (뗄 게 안 남는다)',
    strip('0821.mp4') === '0821', strip('0821.mp4'));

  t('사본 표시를 걷어낸다',
    strip('팔라스 사본.mp4') === '팔라스' && strip('팔라스 (1).mp4') === '팔라스',
    strip('팔라스 사본.mp4') + ' / ' + strip('팔라스 (1).mp4'));
  t('밑줄·가운뎃줄은 띄어쓰기로', strip('팔라스 - 서울 팝업.mp4') === '팔라스 서울 팝업',
    strip('팔라스 - 서울 팝업.mp4'));
  t('제목이 100자를 넘지 않는다 (유튜브 하드 상한)',
    meta.buildTitle({ title: '가'.repeat(200), tags: [] }).length <= 100);
}

console.log('\n[2] 임시 파일 차단을 새 경로도 탄다');
{
  t('shouldSkip 을 실제로 부른다', /drive\.shouldSkip\(f\.name/.test(src));
  const dv = require(path.join(ROOT, 'api', '_lib', 'driveVideos.js'));
  t('.압축중 파일은 여기서도 막힌다', !!dv.shouldSkip('.압축중_51606_스토리.mp4', '', 'youtube'));
  t('.DS_Store 도 막힌다', !!dv.shouldSkip('.DS_Store', '', 'youtube'));
  t('정상 파일은 통과한다', !dv.shouldSkip('라쁠레뜨 팝업.mp4', '', 'youtube'));
  t('상한 초과는 사유를 남긴다 (조용히 버리지 않는다)', /상한 초과/.test(src));
}

console.log('\n[3] 기존 경로와 안 겹친다');
{
  t('하위 폴더 id 를 이름으로 찾는다', /findSubfolderId/.test(src));
  t('이름으로 찾는 함수가 실제로 있다', /async function findSubfolderId/.test(dsrc));
  t('NFC 정규화로 비교한다 (맥은 한글을 NFD 로 저장한다)', /normalize\('NFC'\)/.test(dsrc));
  t('listVideos 가 폴더를 인자로 받는다', /async function listVideos\(inFolder\)/.test(dsrc));
  t('기본 폴더는 그대로다 (기존 크론 영향 없음)', /inFolder \|\| folderId\(\)/.test(dsrc));
  t('폴더가 없으면 실패가 아니라 정상 종료', /폴더가 아직 없음/.test(src));
  t("'없음' 과 '접근 실패' 를 구분한다",
    /drive lookup failed/.test(src) && /폴더가 아직 없음/.test(src));
}

console.log('\n[4] 기록·중복 방지');
{
  t('drive_file_id 로 중복을 거른다', /doneIdsFrom/.test(src));
  t('찜(claim)으로 동시 실행을 막는다', /claimDriveFile\('youtube_posts'/.test(src));
  t('기사 연결 없이 기록한다 (article_id null)', /article_id: null/.test(src));
  t('기록 실패를 500 으로 알린다 (삼키지 않는다)', /error: 'record failed'/.test(src));
  t('한 회차에 한 건만 올린다', /한 회차에 한 건/.test(src));
  t('기본 공개 상태는 비공개다 (YOUTUBE_PUBLIC 로만 공개)',
    /YOUTUBE_PUBLIC === '1'/.test(src) && /isPublic \? 'public' : 'private'/.test(src));
}

console.log('\n[5] 성장 헌법 3항 — 외부 링크 계측');
{
  t('사이트 링크에 utm 이 붙는다', /utm_source=youtube/.test(src));
  t('IG 링크는 계측 경로(/ig/)를 탄다', /\/ig\/youtube/.test(src));
  t('IG 직링크를 쓰지 않는다', !/instagram\.com/.test(src));
}

console.log('\n[6] 크론 등재');
{
  const c = vj.crons.find((x) => x.path === '/api/cron/drive-story-shorts');
  t('크론에 등재됐다', !!c);
  t('10분 주기다', !!c && /\/10 /.test(c.schedule), c && c.schedule);
  const paths = ['/api/cron/drive-youtube-post', '/api/cron/youtube-post', '/api/cron/drive-story-shorts'];
  const mins = vj.crons.filter((x) => paths.includes(x.path))
    .map((x) => String(x.schedule).split(' ')[0].split('-')[0]);
  t('유튜브 API 를 쓰는 크론 3개가 서로 다른 분에 돈다',
    mins.length === 3 && new Set(mins).size === 3, mins.join(','));
}

console.log('\n' + (fail ? '❌' : '✅') + ' ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
