// PAP Magazine — 유튜브 재생목록(카테고리) 배치 + 설명 재동기화 (2026-09-23)
//
// 도메니코: "밀란패션위크에서 올라간 영상은 Fashion Week 카테고리에 넣어줘.
//            너가 올리는 영상들이 각각 카테고리안에 배치가 잘되어있어야해" + "설명수정 해줘"
//
// 실측 기사(9/22 밀라노 패션위크 업로드분)로 판정을 고정한다.
// Run with `node tests/youtube-playlist.test.js` (npm test 에 연결).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { pickCategory, matchPlaylist, fileNameFromDetail, retitle } = require('../api/_lib/ytPlaylist');

let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { console.log('  ✓ ' + l); passed++; } else { console.log('  ✗ ' + l + (d ? ' — ' + d : '')); failed++; } }

console.log('\n[1] 밀라노 패션위크 영상은 전부 FASHION_WEEK');
const mfw = [
  { title: '트와이스 사나, 프라다 쇼에서 밀라노를 사로잡다', tags: ['sana', 'twice', 'prada', 'milan fashion week'], category: 'News' },
  { title: '런웨이를 벗어난 세 사람, 프라다 애프터파티', tags: ['prada', 'after party', 'milan fashion week', 'celebrity'], category: 'News' },
  { title: '디젤 보이 윤호, 글렘 마틴스의 마지막 컬렉션 현장을 기록하다', tags: ['yunho', 'ateez', 'diesel', 'milan fashion week'], category: 'News' },
  { title: '밀라노행 프라다 앰버서더, 공항부터 달랐다', tags: ['prada', 'airport fashion', 'milan fashion week'], category: 'Fashion' },
];
for (const a of mfw) ok(a.title, pickCategory(a) === 'FASHION_WEEK', pickCategory(a));

console.log('\n[2] 태그가 빠진 NG컷은 사람이 정한 값(hint)이 이긴다');
const ng = { title: '디젤 인터뷰 속 윤호의 귀여운 NG컷 공개', tags: ['yunho', 'ateez', 'behind the scenes'], category: 'News' };
ok('hint 없으면 FASHION_WEEK 아님(태그에 신호 없음)', pickCategory(ng) !== 'FASHION_WEEK', pickCategory(ng));
ok('hint=FASHION_WEEK 면 FASHION_WEEK', pickCategory(ng, 'fashion_week') === 'FASHION_WEEK');
ok('모르는 hint 는 무시', pickCategory(ng, 'XYZ') === pickCategory(ng));

console.log('\n[3] 기사 없는 영상(스토리·부계정)은 파일명으로 판정');
ok('파일명에 패션위크', pickCategory({ title: '', tags: [] }, null, '0923_밀라노 패션위크 스트리트.mp4') === 'FASHION_WEEK');
ok('detail 에서 drive 파일명 추출', fileNameFromDetail('drive:0922_사나.mp4 · sub:@x/y') === '0922_사나.mp4');
ok('detail 에서 story 파일명 추출', fileNameFromDetail('story:0826_에트로.mp4') === '0826_에트로.mp4');

console.log('\n[4] 재생목록 이름 매칭 (없으면 null, 새로 만들지 않음)');
const pls = [{ id: 'P1', title: 'Fashion Week' }, { id: 'P2', title: 'FASHION' }, { id: 'P3', title: 'CELEBRITY' }, { id: 'P4', title: 'Milan Fashion Week 2026 SS' }];
ok('FASHION_WEEK → 가장 일반적인 Fashion Week', (matchPlaylist('FASHION_WEEK', pls) || {}).id === 'P1');
ok('FASHION 은 Fashion Week 를 잡지 않는다', (matchPlaylist('FASHION', pls) || {}).id === 'P2');
ok('CELEBRITY', (matchPlaylist('CELEBRITY', pls) || {}).id === 'P3');
ok('없는 카테고리는 null', matchPlaylist('BEAUTY', pls) === null);
ok('한글 이름도 잡는다', (matchPlaylist('FASHION_WEEK', [{ id: 'K', title: '패션위크' }]) || {}).id === 'K');

console.log('\n[5] 제목 재작성은 접두사를 지킨다 (피날레 사고)');
const t = retitle('[ Milan Fashion Week ] 디젤 떠난 글렌 마틴스, 마지막 쇼 뒤 향한 곳 | PAP MAGAZINE', '글렌 마틴스의 마지막 쇼, 축제가 된 이유');
ok('접두사 유지', t.startsWith('[ Milan Fashion Week ] 글렌 마틴스의 마지막 쇼'), t);
ok('접미사 한 번만', (t.match(/PAP MAGAZINE/g) || []).length === 1, t);
ok('100자 이하', retitle('[ CELEBRITY ] x', 'ㄱ'.repeat(200)).length <= 100);

console.log('\n[6] 연결: 스코프·크론·스케줄');
const ysrc = fs.readFileSync(path.join(ROOT, 'api/_lib/youtube.js'), 'utf8');
ok('youtube.force-ssl 스코프', /youtube\.force-ssl/.test(ysrc));
ok('기존 스코프 유지(upload·readonly·drive·webmasters)', /youtube\.upload/.test(ysrc) && /youtube\.readonly/.test(ysrc) && /drive\.readonly/.test(ysrc) && /webmasters\.readonly/.test(ysrc));
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
ok('vercel.json 에 youtube-organize 등록', (vj.crons || []).some((c) => c.path === '/api/cron/youtube-organize'));
const csrc = fs.readFileSync(path.join(ROOT, 'api/cron/youtube-organize.js'), 'utf8');
ok('cronGuard 로 감쌈', /withCronGuard\('youtube-organize'/.test(csrc));
ok('재생목록을 만들지 않는다(playlists.insert 없음)', !/\/playlists\?part=snippet['"]?,\s*\{\s*method: 'POST'/.test(ysrc) && !/createPlaylist/.test(ysrc + csrc));
ok('권한 부족이면 재인증 안내 후 멈춘다', /needsReauth/.test(csrc) && /api\/youtube\/oauth/.test(csrc));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
