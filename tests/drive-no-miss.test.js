/**
 * 드라이브 영상 빠짐없이 올리기 (2026-10-08, 도메니코 "틱톡과 유튜브에 빠짐없이 올라가게해줘")
 *
 * 실측 누락 넷을 그대로 재현한다 (api/_lib/driveNoMiss.js 머리말):
 *  ① 같은 행사 기사 여럿 → 동점 거부 (지효×루부탱 3편, 샤넬 건호 2편)
 *  ② 붙일 기사 없음 → 영구 대기 (질 샌더 쇼)
 *  ③ 압축 전 .mov 를 먼저 집어 중복 (몽클레르·분크)
 *  ④ 원본이 드라이브에 안 들어옴 (니요·리모와) → 알림
 * Run: node tests/drive-no-miss.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const n = require(path.join(ROOT, 'api', '_lib', 'driveNoMiss.js'));
const k = require(path.join(ROOT, 'api', '_lib', 'koMatch.js'));
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail !== undefined) console.log('     ', detail); }
}
const A = (id, title, cap, date) => ({ id, title, instagram_caption: cap + '\nx', published_date: date, tags: [], content: '' });

console.log('\n=== ① 동점 해소 ===');
const jihyo = [
  A('j1', '크리스찬 루부탱이 파리로 부른 지효', '루부탱이 선택한 그녀, 지효', '2026-10-02'),
  A('j2', '지효가 파리에서 만난 크리스찬 루부탱의 영원한 젊음', '지효와 함께라면 영원한 청춘', '2026-10-02'),
  A('j3', '지효, 크리스찬 루부탱 쇼장에서 포착된 골져스한 순간', '지효 언니 너무 골져스해요', '2026-10-02'),
];
const raw = k.matchArticle('1002_크리스찬루부탱 지효 인터뷰.mp4', jihyo);
t('(전제) koMatch 단독으로는 동점 거부', !raw.matched && /사람이 골라야/.test(raw.reason), raw.reason);
const r1 = n.matchOrTieBreak('1002_크리스찬루부탱 지효 인터뷰.mp4', jihyo, new Set(['j1']));
t('이미 영상 있는 기사(j1)는 건너뛰고 고른다', r1.matched && r1.matched.id !== 'j1' && r1.tieBreak, r1.reason);
const r2 = n.matchOrTieBreak('1002_크리스찬루부탱 쇼장안 지효 사진포즈.mp4', jihyo, new Set(['j1', 'j2']));
t('하나만 남으면 그 기사', r2.matched && r2.matched.id === 'j3', r2.matched && r2.matched.id);
const r3 = n.matchOrTieBreak('1002_크리스찬루부탱 지효 인터뷰.mp4', jihyo, new Set(['j1', 'j2', 'j3']));
t('동점 기사가 전부 영상 있으면 올리지 않는다 (중복 의심)', !r3.matched && r3.allTaken && /이미 영상 있음/.test(r3.reason), r3.reason);
t('중복 의심은 사람이 골라야 묶음에 안 들어간다',
  /\[중복 의심 1\]/.test(k.groupUnmatched([{ name: 'x.mp4', reason: r3.reason }])),
  k.groupUnmatched([{ name: 'x.mp4', reason: r3.reason }]));

const chanel = [
  A('c1', '코르티스 건호, 파리에서 샤넬을 입다', '샤넬 입은 건호? 일단 박수부터 칠게요', '2026-10-05'),
  A('c2', '샤넬이 부르면 건호는 파리로 간다', '파리에서 다시 만난 건호와 샤넬', '2026-10-06'),
];
const r4 = n.matchOrTieBreak('1005_샤넬 건호 영상.mp4', chanel, new Set());
t('둘 다 비어 있으면 파일 날짜(1005)와 같은 날 기사', r4.matched && r4.matched.id === 'c1', r4.matched && r4.matched.id);
const r5 = n.matchOrTieBreak('1006_샤넬 건호 영상.mp4', chanel, new Set());
t('파일 날짜가 1006 이면 1006 기사', r5.matched && r5.matched.id === 'c2', r5.matched && r5.matched.id);
const r6 = n.matchOrTieBreak('1002_지효와 함께라면 영원한 청춘.mp4', jihyo, new Set());
t('확신 매칭(캡션 일치)은 그대로 — 동점 해소를 타지 않는다', r6.matched && r6.matched.id === 'j2' && !r6.tieBreak);
t('넘겨준 매칭 함수를 쓴다 (크론 테스트의 가짜 koMatch 존중)',
  n.matchOrTieBreak('a', [], new Set(), { matchArticle: () => ({ matched: { id: 'mock' }, reason: '' }) }).matched.id === 'mock');
t('파일 날짜 해석', JSON.stringify(n.fileMonthDay('1005_샤넬')) === '{"m":10,"d":5}' && n.fileMonthDay('1987 컬렉션') === null);

console.log('\n=== ② 기사 없는 파일은 기다린 뒤 파일명으로 ===');
const now = Date.parse('2026-10-08T10:00:00Z');
const hAgo = (h) => new Date(now - h * 3600000).toISOString();
const files = [
  { id: 'f1', name: '1007_시모네 벨로티의 두 번째 질 샌더.mp4', modifiedAt: hAgo(29) },
  { id: 'f2', name: 'copy_10510695-9B2A-468A-BB55-036B6F643180.mp4', modifiedAt: hAgo(40) },
  { id: 'f3', name: '1008_방금 들어온 영상.mp4', modifiedAt: hAgo(1) },
  { id: 'f4', name: '1005_샤넬 건호 영상.mp4', modifiedAt: hAgo(50) },
];
const unmatched = [
  { name: files[0].name, reason: '가장 닮은 기사도 0.40 (기준 0.6) — 닮은 게 없음' },
  { name: files[1].name, reason: '파일명 낱말이 어느 기사에도 안 걸림 (copy)' },
  { name: files[2].name, reason: '파일명 낱말이 어느 기사에도 안 걸림 (방금)' },
  { name: files[3].name, reason: '같은 사건 기사가 여럿 (1.00 vs 1.00) — 사람이 골라야 한다: x' },
];
const title = (nm) => String(nm).replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/^\d{4}_/, '');
const fb = n.pickFallback(unmatched, files, now, title);
t('6시간 넘은 사람 이름 파일을 고른다', fb && fb.file.id === 'f1' && fb.title === '시모네 벨로티의 두 번째 질 샌더', fb && fb.file.id);
t('copy_UUID 는 공개 제목이 되면 안 되므로 고르지 않는다', !n.isHumanTitle('copy_10510695-9B2A-468A-BB55-036B6F643180'));
t('IMG_1234 도 안 된다', !n.isHumanTitle('IMG_1234'));
t('방금 들어온 파일(1시간)은 아직 기다린다', !n.pickFallback([unmatched[2]], files, now, title));
t('동점(사람이 골라야)은 대체 업로드 사유가 아니다', !n.isNoArticleReason(unmatched[3].reason));
t('중복 의심도 대체 업로드 사유가 아니다', !n.isNoArticleReason('같은 사건 기사 2편이 전부 이미 영상 있음 — 중복 의심'));

console.log('\n=== ③ 압축 전 .mov · 방금 들어온 파일 ===');
const mNow = Date.parse('2026-10-05T10:20:00Z');
t('10분 된 .mov 는 기다린다 (몽클레르 Re/Icons 중복)',
  !!n.settlingReason({ name: '1005_몽클레르 Re/Icons.mov', modifiedAt: '2026-10-05T10:10:00Z' }, mNow));
t('1분 된 mp4 도 기다린다 (동기화 중)',
  !!n.settlingReason({ name: 'a.mp4', modifiedAt: '2026-10-05T10:19:00Z' }, mNow));
t('10분 된 mp4 는 바로 간다', n.settlingReason({ name: 'a.mp4', modifiedAt: '2026-10-05T10:10:00Z' }, mNow) === null);
t('2시간 된 .mov 는 간다 (압축기가 안 돌아도 결국 올라간다)',
  n.settlingReason({ name: 'a.MOV', modifiedAt: '2026-10-05T08:20:00Z' }, mNow) === null);
t('시각을 모르면 막지 않는다', n.settlingReason({ name: 'a.mov' }, mNow) === null);

console.log('\n=== ④ 원본이 안 들어온 영상 기사 ===');
const arts = [
  { id: 'ny', title: 'R&B 싱어 니요, 지용킴 팝업에서 고른 피스는', created_at: hAgo(25), instagram_caption: '니요, 지용킴 팝업에\n@x' },
  { id: 'ok', title: '다 올라간 기사', created_at: hAgo(30), instagram_caption: 'ok' },
  { id: 'new', title: '방금 나온 기사', created_at: hAgo(2), instagram_caption: 'new' },
  { id: 'wait', title: '파일은 와서 대기 중', created_at: hAgo(10), instagram_caption: 'w' },
  { id: 'ytonly', title: '유튜브만 올라감', created_at: hAgo(12), instagram_caption: 'y' },
];
const d = n.judgeMissingSources(arts, new Set(['ok', 'ytonly']), new Set(['ok']), new Set(['wait']), { now });
const ids = d.missing.map((x) => x.id).sort().join(',');
t('빠진 것만 잡는다 (니요 · 유튜브만 있는 기사)', ids === 'ny,ytonly', ids);
const ny = d.missing.find((x) => x.id === 'ny');
t('넣을 파일명은 캡션 첫 줄', ny && ny.fileName === '니요, 지용킴 팝업에', ny && ny.fileName);
t('어느 채널이 빠졌는지 말한다', ny && ny.channels.join() === '유튜브,틱톡' && d.missing.find((x) => x.id === 'ytonly').channels.join() === '틱톡');

console.log('\n=== 배선 (규칙 한 벌) ===');
const yt = R('api/cron/drive-youtube-post.js');
const tk = R('api/cron/drive-tiktok-post.js');
const tkd = R('api/_lib/tiktokDrive.js');
const pw = R('api/cron/pipeline-watch.js');
t('유튜브 크론이 동점 해소를 쓴다', /noMiss\.matchOrTieBreak\(f\.name, articles, takenYt, \{ matchArticle \}\)/.test(yt));
t('틱톡 크론이 동점 해소를 쓴다', /noMiss\.matchOrTieBreak\(f\.name, articles, takenTt, \{ matchArticle \}\)/.test(tk));
t('릴스 양보 판단도 같은 함수 (틱톡 두 크론의 판단이 갈리지 않게)', /noMiss\.matchOrTieBreak\(f\.name, articles, taken, \{ matchArticle \}\)/.test(tkd));
t('유튜브·틱톡 둘 다 대체 업로드를 한다', /noMiss\.pickFallback\(/.test(yt) && /noMiss\.pickFallback\(/.test(tk));
t('유튜브·틱톡 둘 다 압축 대기를 지킨다', /noMiss\.settlingReason\(f, Date\.now\(\)\)/.test(yt) && /noMiss\.settlingReason\(/.test(tkd));
t('대체 업로드는 기록에서 구분된다 (fallback:)', /'fallback:'/.test(yt) && /'fallback:'/.test(tk));
t('틱톡 대체 게시는 없는 기사 URL 을 적지 않는다', /else if \(!art\.noArticle\) lines\.push\('▶ 기사 전문/.test(tk));
t('감시가 원본 누락을 본다', /async function checkVideoSources/.test(pw) && /noMiss\.judgeMissingSources/.test(pw));
t('같은 기사로 두 번 알리지 않는다 (새로 빠진 것만)', /const fresh = d\.missing\.filter\(\(x\) => !seen\.has\(x\.id\)\)/.test(pw));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ drive-no-miss tests FAILED'); process.exit(1); }
console.log('✅ drive-no-miss tests passed');
