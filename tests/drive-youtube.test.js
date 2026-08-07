/**
 * 드라이브 → 유튜브 파이프라인 (2026-08-07 신설)
 *
 * 왜 필요했나 — 인스타 릴스 mp4 회수 실패율이 8/3부터 18% → 69% 로 뛰었다.
 * 라이선스 음원이 붙은 릴스는 Graph 가 media_url 을 아예 안 준다(영구).
 * 그래서 제작 시점 원본을 드라이브에 쌓고, 맥미니가 압축하고, 서버가 올린다.
 *
 * ⚠️ 이 파이프라인의 급소는 **매칭**이다. 파일명이 자유 형식이라
 * ("베이델리 규진") 틀리면 엉뚱한 영상이 공개 유튜브에 올라간다.
 * 아래 픽스처는 전부 2026-08-07 프로덕션 실데이터다 — 상상한 예시가 아니다.
 *
 * 여기서 지키는 것:
 *   ① 확신할 때만 붙인다 (점수 하한)
 *   ② 비슷한 기사가 둘이면 **거부한다** (마진) ← 오배치 방지의 핵심
 *   ③ 한글 파일명 ↔ 영문 태그를 로마자로 잇는다 (김무열↔kim moo-yul)
 *   ④ 상관없는 파일은 아무 데도 안 붙는다
 *   ⑤ 제외 규칙이 배포 없이 동작한다 (파일명 규칙 + env)
 *   ⑥ 조기 반환마다 cronNote 를 남긴다 (틱톡 21일 침묵 재발 방지)
 *   ⑦ 드라이브 원본은 음소거하지 않는다 (도메니코 결정)
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
stub('cronGuard.js', { withCronGuard: (_n, fn) => fn });
stub('youtube.js', { uploadVideo: async () => ({ id: 'x' }), getAccessToken: async () => 't' });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const ko = require(path.join(ROOT, 'api', '_lib', 'koMatch.js'));
const drive = require(path.join(ROOT, 'api', '_lib', 'driveVideos.js'));

/* 2026-08-07 프로덕션 articles 실데이터 (제목·태그 원문) */
const ARTS = [
  { id: 'A', title: '규진의 공항 패션, 베이델리로 완성한 꾸안꾸 스타일링',
    tags: ['kyujin', 'nmixx', 'beidelli', 'airport fashion', 'daily look', 'korean fashion', 'layering', 'casual style'] },
  { id: 'B', title: '엔믹스 규진, 베이델리 제주 애월 플래그십 오픈 현장 공개',
    tags: ['beidelli', 'nmixx', 'kyujin', 'jeju', 'aewol', 'flagship store', 'daily wear', 'korean fashion'] },
  { id: 'C', title: '아더에러와 버켄스탁, 실로 이은 두 번째 만남',
    tags: ['adererror', 'birkenstock', 'boston', 'collaboration', 'footwear', 'thread'] },
  { id: 'D', title: '페라가모 플래그십이 영화제 포토콜로 변한 순간',
    tags: ['ferragamo', 'nana', 'kim hee-ae', 'yoon seung-ah', 'kim moo-yul', 'cara bag', 'fw26', 'flagship seoul'] },
  { id: 'E', title: '페라가모의 카라백과 낭만적인 FW26',
    tags: ['ferragamo', 'cara bag', 'fw26', '1920s', 'tailoring'] },
  { id: 'F', title: '페라가모가 윌리 콜을 선택한 이유',
    tags: ['ferragamo', 'willie cole', 'shoe art', 'contemporary art'] },
  { id: 'G', title: '휴닝카이가 플래그십을 궁전으로 만든 밤',
    tags: ['hueningkai', 'ferragamo', 'fw26', 'cara bag', 'menswear'] },
  { id: 'H', title: '안효섭의 공항 패션이 왜 이리 아름다워',
    tags: ['ahn hyo-seop', 'juun.j', 'airport fashion', 'korean actor'] },
];
const pick = (f) => ko.matchArticle(f, ARTS);

console.log('\n[1] 실파일 매칭 — 드라이브에 실제로 올라온 5건');
t('"아더에러 버켄스탁" → C (단독으로 닮음)', pick('아더에러 버켄스탁.mp4').matched?.id === 'C');
t('"공항패션 규진" → A (공항패션+규진 둘 다 가진 유일한 기사)', pick('공항패션 규진.mp4').matched?.id === 'A');
t('"페라가모 휴닝카이" → G', pick('페라가모 휴닝카이.mp4').matched?.id === 'G');
t('"페라가모 나나 김무열 윤승아 김희애" → D (셀럽 4명이 태그와 일치)',
  pick('페라가모 나나 김무열 윤승아 김희애.mp4').matched?.id === 'D',
  pick('페라가모 나나 김무열 윤승아 김희애.mp4').reason);

console.log('\n[2] ⭐️ 애매하면 거부한다 — 이게 오배치를 막는 유일한 장치');
const amb = pick('베이델리 규진.mp4');
t('"베이델리 규진" 은 두 기사에 똑같이 맞으므로 거부', amb.matched === null, amb.reason);
t('거부 사유에 애매한 후보들이 담긴다', /애매/.test(amb.reason) && /베이델리/.test(amb.reason));
t('1등과 2등이 실제로 동점이었음', amb.score === amb.runnerUp && amb.score === 1);
t('마진을 0 으로 낮추면 붙는다 = 마진이 유일한 방어선임을 증명',
  ko.matchArticle('베이델리 규진.mp4', ARTS, { margin: 0 }).matched !== null);

console.log('\n[3] 상관없는 파일은 아무 데도 안 붙는다');
t('무관한 이름 → 거부', pick('전혀 상관없는 파일.mp4').matched === null);
t('날짜+막연한 말 → 거부', pick('0807 페라가모 셀럽.mp4').matched === null,
  pick('0807 페라가모 셀럽.mp4').reason);
t('빈 이름 → 거부', ko.matchArticle('.mp4', ARTS).matched === null);
t('기사 목록이 비면 거부', ko.matchArticle('아더에러 버켄스탁.mp4', []).matched === null);

console.log('\n[4] 한글 ↔ 영문 태그 다리 (로마자)');
const bridge = (koName, tag) => ko.dice(ko.phon(ko.romanize(koName)), ko.phon(tag));
t('나나 ↔ nana', bridge('나나', 'nana') >= 0.99);
t('김무열 ↔ kim moo-yul', bridge('김무열', 'kim moo-yul') >= 0.9, bridge('김무열', 'kim moo-yul'));
t('윤승아 ↔ yoon seung-ah', bridge('윤승아', 'yoon seung-ah') >= 0.9);
t('김희애 ↔ kim hee-ae', bridge('김희애', 'kim hee-ae') >= 0.9);
t('규진 ↔ kyujin', bridge('규진', 'kyujin') >= 0.99);
t('다른 사람끼리는 안 붙는다 (나나 vs kim moo-yul)', bridge('나나', 'kim moo-yul') < 0.5);
t('다른 사람끼리는 안 붙는다 (규진 vs hueningkai)', bridge('규진', 'hueningkai') < 0.5);

console.log('\n[5] 토큰 분해');
t('날짜 조각(0807)은 버린다', !ko.fileTokens('0807 페라가모 셀럽.mp4').includes('0807'));
t('확장자는 버린다', !ko.fileTokens('테스트.MOV').join('').includes('MOV'));
t('한 글자는 버린다', ko.fileTokens('가 페라가모.mp4').length === 1);
t('밑줄·하이픈도 구분자', ko.fileTokens('페라가모_나나-김무열.mp4').length === 3);
t('"공항 패션" 과 "공항패션" 을 같게 본다', ko.squash('공항 패션') === ko.squash('공항패션'));

console.log('\n[6] 제외 규칙 — 배포 없이 뺄 수 있어야 한다');
t("'_' 로 시작하면 보류", !!drive.shouldSkip('_페라가모 휴닝카이.mp4', ''));
t("이름에 '보류' 가 있으면 제외", !!drive.shouldSkip('페라가모 보류.mp4', ''));
t("이름에 'skip' 이 있으면 제외", !!drive.shouldSkip('ferragamo skip.mp4', ''));
t('제외 목록(env)에 걸리면 제외', !!drive.shouldSkip('페라가모 휴닝카이.mp4', '휴닝카이'));
t('제외 목록 여러 개 중 하나만 걸려도 제외', !!drive.shouldSkip('공항패션 규진.mp4', '휴닝카이,규진'));
t('평범한 이름은 통과', drive.shouldSkip('아더에러 버켄스탁.mp4', '휴닝카이') === null);
t('제외 사유가 사람이 읽을 수 있게 나온다', /휴닝카이/.test(drive.shouldSkip('페라가모 휴닝카이.mp4', '휴닝카이')));

// 2026-08-07: 도메니코의 지시는 "**유튜브에는** 휴닝카이는 빼도 돼" 였는데
// 전역 목록으로 만들어 틱톡에서까지 빠졌다. '어디서 빼라'를 '전부에서 빼라'로
// 넓혀 읽은 것이다. 채널별 목록을 강제한다.
{
  const save = { g: process.env.DRIVE_VIDEO_SKIP, y: process.env.DRIVE_VIDEO_SKIP_YOUTUBE, k: process.env.DRIVE_VIDEO_SKIP_TIKTOK };
  process.env.DRIVE_VIDEO_SKIP = '';
  process.env.DRIVE_VIDEO_SKIP_YOUTUBE = '휴닝카이';
  delete process.env.DRIVE_VIDEO_SKIP_TIKTOK;
  t('유튜브 전용 목록은 유튜브에서만 막는다', !!drive.shouldSkip('페라가모 휴닝카이.mp4', null, 'youtube'));
  t('유튜브 전용 목록이 틱톡을 막지 않는다', drive.shouldSkip('페라가모 휴닝카이.mp4', null, 'tiktok') === null);
  t('채널을 안 넘기면 전용 목록은 적용되지 않는다', drive.shouldSkip('페라가모 휴닝카이.mp4', null) === null);
  process.env.DRIVE_VIDEO_SKIP_TIKTOK = '아더에러';
  t('틱톡 전용 목록은 틱톡에서만 막는다',
    !!drive.shouldSkip('아더에러 버켄스탁.mp4', null, 'tiktok')
    && drive.shouldSkip('아더에러 버켄스탁.mp4', null, 'youtube') === null);
  process.env.DRIVE_VIDEO_SKIP = '전체제외';
  t('전역 목록은 두 채널 모두 막는다',
    !!drive.shouldSkip('전체제외 x.mp4', null, 'tiktok') && !!drive.shouldSkip('전체제외 x.mp4', null, 'youtube'));
  t('사유에 어느 채널인지 적힌다', /youtube 제외 목록/.test(drive.shouldSkip('페라가모 휴닝카이.mp4', null, 'youtube')));
  if (save.g === undefined) delete process.env.DRIVE_VIDEO_SKIP; else process.env.DRIVE_VIDEO_SKIP = save.g;
  if (save.y === undefined) delete process.env.DRIVE_VIDEO_SKIP_YOUTUBE; else process.env.DRIVE_VIDEO_SKIP_YOUTUBE = save.y;
  if (save.k === undefined) delete process.env.DRIVE_VIDEO_SKIP_TIKTOK; else process.env.DRIVE_VIDEO_SKIP_TIKTOK = save.k;
}
t('유튜브 크론이 채널을 넘긴다',
  /shouldSkip\(f\.name, null, 'youtube'\)/.test(fs.readFileSync(path.join(ROOT, 'api', 'cron', 'drive-youtube-post.js'), 'utf8')));

console.log('\n[7] 침묵 방지 — 조기 반환마다 cronNote');
const src = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'drive-youtube-post.js'), 'utf8');
const RET = 'return res.status(200).json(';
const rets = [];
for (let i = src.indexOf(RET); i !== -1; i = src.indexOf(RET, i + 1)) {
  const end = src.indexOf('});', i);
  rets.push(src.slice(i, end === -1 ? i + 500 : end + 3));
}
t('200 반환이 여러 갈래 존재', rets.length >= 4, rets.length);
t('모든 200 반환이 note(res, …) 를 통과한다',
  rets.every((r) => r.indexOf('note(res,') !== -1),
  rets.filter((r) => r.indexOf('note(res,') === -1).map((r) => r.slice(0, 80)));
t('실패 경로도 note 를 남긴다', /note\(res, '업로드 실패/.test(src) && /note\(res, '크론 예외/.test(src));
t('매칭 실패도 조용히 넘기지 않는다', /매칭 실패/.test(src));

console.log('\n[8] 드라이브 원본은 음소거하지 않는다 (도메니코 2026-08-07 결정)');
t('muteMp4 를 쓰지 않는다', src.indexOf('muteMp4') === -1);
t('기존 릴스 경로(youtube-post)는 음소거를 유지한다',
  fs.readFileSync(path.join(ROOT, 'api', 'cron', 'youtube-post.js'), 'utf8').indexOf('muteMp4') !== -1);

console.log('\n[9] 배선·안전장치');
t('크론이 vercel.json 에 등록됨',
  (require(path.join(ROOT, 'vercel.json')).crons || []).some((c) => c.path === '/api/cron/drive-youtube-post'));
t('상한 100MB (Vercel 120초·1GB 안)', require(path.join(ROOT, 'api', 'cron', 'drive-youtube-post.js')).MAX_BYTES === 100 * 1024 * 1024);
t('drive_file_id 로 중복 업로드를 막는다', /onConflict: 'drive_file_id'/.test(src));
t('실패 기록은 재시도를 허용한다', /status !== 'failed'/.test(src));
// 2026-08-07 사고 재발 방지: 유튜브엔 올라갔는데 DB 기록이 조용히 실패해
// 크론이 같은 영상을 2시간마다 다시 올릴 뻔했다. 기록 실패는 반드시 시끄러워야 한다.
t('DB 기록 실패를 삼키지 않는다', /const \{ error: recErr \}/.test(src) && /if \(recErr\)/.test(src));
t('기록 실패 시 500 으로 떨어진다', /error: 'record failed'/.test(src));
t('기록 실패 문구가 중복 업로드 위험을 말한다', /반복 업로드될 수 있음/.test(src));
t('마이그레이션 108 이 부분 인덱스를 전체 유니크로 바꾼다', (() => {
  const m = fs.readFileSync(path.join(ROOT, 'supabase_migrations', '108_youtube_posts_drive_file_full_unique.sql'), 'utf8');
  return /drop index if exists youtube_posts_drive_file_id_key/.test(m)
    && /create unique index[\s\S]*\(drive_file_id\);/.test(m)
    && !/where drive_file_id is not null/i.test(m.split('create unique index')[1] || '');
})());
{
  const dsrc = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'driveVideos.js'), 'utf8');
  // 403 은 원인이 둘인데 구글이 같은 코드로 준다. 2026-08-07 실제로 이걸 안 갈라놔서
  // "재인증하세요" 라는 틀린 안내를 보고 시간을 버렸다. 두 갈래를 강제한다.
  t('403 중 API 미사용 설정을 따로 구분한다', /has not been used in project\|is disabled/.test(dsrc), 'API disabled 분기 없음');
  t('API 미사용 설정일 때 재인증하라고 하지 않는다', /스코프·재인증 문제가 아닙니다/.test(dsrc));
  t('그 경우 프로젝트 번호를 알려준다', /프로젝트 번호/.test(dsrc));
  t('스코프 부족일 때만 재인증을 안내한다', /스코프가 없습니다[\s\S]{0,80}youtube\/oauth/.test(dsrc));
}
t("하위 '원본/' 폴더는 안 본다 (압축 전 카메라 원본)",
  /mimeType !== 'application\/vnd\.google-apps\.folder'/.test(fs.readFileSync(path.join(ROOT, 'api', '_lib', 'driveVideos.js'), 'utf8')));
t('YouTube 스코프에 drive.readonly 가 추가됨',
  /drive\.readonly/.test(fs.readFileSync(path.join(ROOT, 'api', '_lib', 'youtube.js'), 'utf8')));

console.log('\n' + (fail ? '❌' : '✅') + ` ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
