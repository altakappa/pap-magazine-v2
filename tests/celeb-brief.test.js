/**
 * 셀럽 속보 브리프 — 수신·파싱 계약 (2026-08-23 신설)
 *
 * 도메니코 흐름: 인스타 링크를 텔레그램으로 → 기사 이미지·캡션을 텔레그램으로 회신.
 *
 * 이 테스트가 지키는 것
 *   ① 링크를 형태에 상관없이 뽑는다 (p / reel / tv / username 포함형 / 추적 파라미터)
 *   ② 같은 메시지의 링크 여러 개는 **하나의 브리프**로 묶인다
 *   ③ 동영상은 이미지 나열에 섞지 않는다 (도메니코: "이미지로 나열")
 *   ④ 썸네일 제목은 2줄을 넘기면 자르지 않고 실패시킨다 (폰트 축소 금지)
 *   ⑤ webhook 이 fail-closed 다 — 시크릿 없으면 열리지 않는다
 *   ⑥ webhook 이 무거운 일을 하지 않는다 (텔레그램 재전송 → 중복 발송 방지)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cb = require('../api/_lib/celebBrief');
const WEBHOOK = fs.readFileSync(path.join(__dirname, '..', 'api/telegram/webhook.js'), 'utf8');
const WEBHOOK_CODE = WEBHOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CRON = fs.readFileSync(path.join(__dirname, '..', 'api/cron/celeb-brief.js'), 'utf8');
const CRON_CODE = CRON.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const VERCEL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

console.log('셀럽 속보 브리프');

/* ① */
t('링크를 형태 상관없이 뽑는다', () => {
  const text = [
    'https://www.instagram.com/p/ABC123def/',
    'https://instagram.com/reel/XyZ_-987/?igsh=abc123',
    'https://www.instagram.com/blackpinkofficial/p/QQQ111/',
    'https://www.instagram.com/tv/TvCode99/',
  ].join('\n');
  const links = cb.extractPostLinks(text);
  assert.strictEqual(links.length, 4, '4건이어야 함: ' + JSON.stringify(links));
  assert.strictEqual(links[0].shortcode, 'ABC123def');
  assert.strictEqual(links[1].shortcode, 'XyZ_-987', '추적 파라미터가 shortcode 를 오염시키면 안 된다');
  assert.strictEqual(links[2].username, 'blackpinkofficial', 'username 포함형에서 계정을 뽑아야 한다');
  assert.strictEqual(links[3].kind, 'tv');
});

t('같은 게시물이 두 번 나와도 한 번만 센다', () => {
  const links = cb.extractPostLinks('https://instagram.com/p/AAA/ 그리고 https://www.instagram.com/p/AAA/?x=1');
  assert.strictEqual(links.length, 1);
});

t('인스타가 아닌 링크는 무시한다', () => {
  assert.strictEqual(cb.extractPostLinks('https://example.com/p/AAA/ https://x.com/p/BBB').length, 0);
});

/* 계정 핸들 */
t('메시지의 @핸들을 뽑되 URL 안은 보지 않는다', () => {
  assert.strictEqual(cb.extractHandle('@jennierubyjane https://www.instagram.com/p/AAA/'), 'jennierubyjane');
  assert.strictEqual(cb.extractHandle('https://www.instagram.com/p/AAA/'), null);
});

/* ② */
t('한 메시지의 링크 여러 개는 하나의 브리프로 묶인다', () => {
  const p = cb.parseUpdate({ message: {
    message_id: 42, chat: { id: -100123 },
    text: '@bigbang https://www.instagram.com/p/A1/ https://www.instagram.com/p/B2/',
  } });
  assert.strictEqual(p.links.length, 2);
  assert.strictEqual(p.handle, 'bigbang');
  assert.strictEqual(p.chatId, '-100123');
  assert.strictEqual(p.messageId, 42);
});

t('메시지가 없는 업데이트는 조용히 무시한다', () => {
  assert.strictEqual(cb.parseUpdate({ poll_answer: {} }), null);
  assert.strictEqual(cb.parseUpdate(null), null);
});

/* ③ */
t('캐러셀은 순서대로 펴고 동영상은 뺀다', () => {
  const urls = cb.collectMediaUrls({
    media_type: 'CAROUSEL_ALBUM',
    children: { data: [
      { media_type: 'IMAGE', media_url: 'https://cdn/1.jpg' },
      { media_type: 'VIDEO', media_url: 'https://cdn/2.mp4' },
      { media_type: 'IMAGE', media_url: 'https://cdn/3.jpg' },
    ] },
  });
  assert.deepStrictEqual(urls, ['https://cdn/1.jpg', 'https://cdn/3.jpg']);
});

t('단일 동영상 게시물은 이미지가 0장이다', () => {
  assert.deepStrictEqual(
    cb.collectMediaUrls({ media_type: 'VIDEO', media_url: 'https://cdn/v.mp4', thumbnail_url: 'https://cdn/t.jpg' }),
    [],
  );
});

t('여러 게시물 이미지를 보낸 순서대로 나열하고 MAX_SLIDES(20장)에서 자른다', () => {
  // 2026-08-26 4887248 이 상한을 10 → 20(MAX_SLIDES)으로 올렸는데 이 테스트가
  // 10 을 하드코딩한 채 남아 스위트가 깨졌다. 상한의 진실원천은 celebBrief 의
  // MAX_SLIDES 하나 — 숫자를 다시 하드코딩하지 않고 그 값으로 검사한다.
  const a = Array.from({ length: 12 }, (_, i) => 'https://cdn/a' + i + '.jpg');
  const b = Array.from({ length: 12 }, (_, i) => 'https://cdn/b' + i + '.jpg');
  const merged = cb.mergeMediaUrls([a, b]);
  assert.strictEqual(merged.length, cb.MAX_SLIDES, '인스타 캐러셀 상한(MAX_SLIDES)');
  assert.strictEqual(cb.MAX_SLIDES, 20, 'MAX_SLIDES 가 20 이 아니면 판형 결정(4887248)과 어긋난다');
  assert.strictEqual(merged[0], 'https://cdn/a0.jpg');
  assert.strictEqual(merged[12], 'https://cdn/b0.jpg');
});

t('중복 이미지 URL 은 한 번만', () => {
  const merged = cb.mergeMediaUrls([['https://cdn/x.jpg'], ['https://cdn/x.jpg', 'https://cdn/y.jpg']]);
  assert.deepStrictEqual(merged, ['https://cdn/x.jpg', 'https://cdn/y.jpg']);
});

/* ④ */
t('제목이 2줄에 들어가면 줄로 나눈다', () => {
  const measure = (s) => s.length * 10;          // 글자당 10px 가정
  const lines = cb.wrapHeadline('일주일 뒤 만날 제니의 새 앨범', 130, measure);
  assert.ok(Array.isArray(lines) && lines.length <= 2, JSON.stringify(lines));
  assert.ok(lines.every((l) => measure(l) <= 130));
});

t('2줄을 넘으면 자르지 않고 null 을 준다 (폰트 축소 금지)', () => {
  const measure = (s) => s.length * 10;
  const long = '아주 긴 제목 이것은 절대로 두 줄 안에 들어가지 않는 아주 아주 긴 제목이다 정말로';
  assert.strictEqual(cb.wrapHeadline(long, 100, measure), null);
});

t('한 단어가 폭을 넘겨도 null 이다', () => {
  const measure = (s) => s.length * 10;
  assert.strictEqual(cb.wrapHeadline('가나다라마바사아자차카타파하', 50, measure), null);
});

/* 캡션 */
t('캡션이 PAP 인스타 실제 형식이다', () => {
  /* 실측 근거: articles.instagram_caption · 2026-07 이후 393건
       2번째 줄 @멘션 96% · 크레딧 이모지 98% · FOR MORE 69% · URL 0% · 해시태그 2% */
  const c = cb.buildBriefCaption({
    hook: '28일 제니 신곡 발표 예정',
    bodyKo: '국문 본문.', bodyEn: 'English body.',
    mentions: ['jennierubyjane', 'oddatelier'], creditKind: 'photo',
  });
  const L = c.split('\n');
  assert.strictEqual(L[0], '28일 제니 신곡 발표 예정', '첫 줄은 후킹 한 줄');
  assert.strictEqual(L[1], '@jennierubyjane @oddatelier', '둘째 줄은 계정 멘션');
  assert.ok(c.includes('\n\nFOR MORE ARTICLES | @pap_magazine\n\n'), '고정 문구 위치가 다르다');
  assert.ok(c.indexOf('국문 본문.') < c.indexOf(cb.FOR_MORE), '국문이 고정 문구 앞이다');
  assert.ok(c.indexOf('English body.') > c.indexOf(cb.FOR_MORE), '영문이 고정 문구 뒤다');
  assert.ok(c.trimEnd().endsWith('📸 @jennierubyjane @oddatelier'), '크레딧이 맨 끝이 아니다');
});

t('영상이면 크레딧 이모지가 🎥 다', () => {
  const c = cb.buildBriefCaption({ hook: 'h', bodyKo: 'k', mentions: ['x'], creditKind: 'video' });
  assert.ok(c.includes('🎥 @x') && !c.includes('📸'), '영상 크레딧이 사진 이모지로 나간다');
});

t('URL 을 넣지 않고, 태그를 기계적으로 나열하지 않는다 (실측 URL 0%)', () => {
  const c = cb.buildBriefCaption({
    hook: 'h', bodyKo: 'k', bodyEn: 'e', mentions: ['x'], creditKind: 'photo',
  });
  assert.ok(!/https?:\/\//.test(c), '인스타 캡션의 링크는 클릭되지 않는다 — 실제 캡션엔 0건이다');
  assert.ok(!/#[A-Za-z가-힣]/.test(c), '해시태그를 나열하지 않는다');
});

t('광고·협찬 표기를 우리가 붙이지 않는다', () => {
  /* 도메니코 2026-08-23: "협찬은 너에게 맡기지 않아." */
  const c = cb.buildBriefCaption({ hook: '한남에서 만난 산산기어', bodyKo: 'k', bodyEn: 'e', mentions: ['x'], sponsored: true });
  assert.strictEqual(c.split('\n')[0], '한남에서 만난 산산기어', 'sponsored 를 줘도 표기를 붙이면 안 된다');
  assert.ok(!/#제작지원|#광고/.test(c));
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/celebBrief.js'), 'utf8');
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/제작지원|#광고/.test(code), '협찬 표기 로직이 코드에 남아 있다');
});

t('후킹에서 해시태그를 벗긴다 (도메니코 2026-08-23 지시)', () => {
  /* 실측상 셀럽기사 22% 가 문장 안에 태그를 녹여 쓰지만, 도메니코가
     "그거는 더 이상하다" 고 물렸다. 실측이 곧 정답은 아니다. */
  const cases = [
    ['무대 위의 #태용 은 언제나 강하다', '무대 위의 태용은 언제나 강하다'],
    ['#랄프로렌 과 #김우빈 오늘도 완벽하십니다', '랄프로렌과 김우빈 오늘도 완벽하십니다'],
    ['#젠틀몬스터 의 채소 밭으로 오이데~', '젠틀몬스터의 채소 밭으로 오이데~'],
    ['밀라노 힙스터들의 유니폼, #써네이 의 마지막 장', '밀라노 힙스터들의 유니폼, 써네이의 마지막 장'],
    ['28일 제니 신곡 발표 예정', '28일 제니 신곡 발표 예정'],
  ];
  for (const [inp, want] of cases) {
    assert.strictEqual(cb.stripHashtags(inp), want, '입력: ' + inp);
  }
  const c = cb.buildBriefCaption({ hook: '무대 위의 #태용 은 언제나 강하다', bodyKo: 'k', bodyEn: 'e', mentions: ['x'] });
  assert.strictEqual(c.split('\n')[0], '무대 위의 태용은 언제나 강하다');
  assert.ok(!/#/.test(c.split('\n')[0]), '후킹에 # 이 남았다');
});

t('캡션 어디에도 해시태그가 없다', () => {
  const c = cb.buildBriefCaption({
    hook: '#랄프로렌 과 #김우빈', bodyKo: 'k', bodyEn: 'e', mentions: ['x'], creditKind: 'photo',
  });
  assert.ok(!/#[0-9A-Za-z가-힣_]/.test(c), '해시태그가 남았다:\n' + c);
});

t('영문이 비면 크론이 사람에게 알린다 (실측 100% 병기)', () => {
  assert.ok(/missingEn/.test(CRON_CODE), '영문 누락을 감지하지 않는다');
  assert.ok(/영문 누락/.test(CRON), '영문이 빠져도 아무도 모른다');
  assert.ok(!/if \(missingEn\)[\s\S]{0,80}return await fail/.test(CRON_CODE),
    '영문이 없다고 브리프를 막으면 안 된다 — 국문이라도 있는 게 낫다');
});

t('게시물 캡션에서 @핸들을 뽑는다', () => {
  const m = cb.extractMentions('협업 @oddatelier 과 @Jennierubyjane, 그리고 @oddatelier 재등장 @a', 5);
  assert.deepStrictEqual(m, ['oddatelier', 'jennierubyjane'], '중복·1글자 핸들이 걸러져야 한다');
});

t('크론이 소스 계정을 멘션 맨 앞에 둔다', () => {
  assert.ok(/const mentions = \[rows\[0\]\.username\]/.test(CRON_CODE), '소스 계정이 빠지면 크레딧이 틀린다');
  assert.ok(/creditKind: items\[0\]\.type === 'video' \? 'video' : 'photo'/.test(CRON_CODE),
    '영상인데 📸 로 나가면 크레딧이 거짓이 된다');
  assert.ok(/bodyEn: enShort/.test(CRON_CODE), '영문 본문이 빠지면 국문만 나간다');
});

t('캡션에 HTML 이 남지 않는다 (인스타에 그대로 붙여넣는 글이다)', () => {
  const c = cb.buildBriefCaption({
    title: '제목',
    body: '첫 단락 <b>강조</b>.<br><br>둘째 단락 &#39;따옴표&#39; &amp; 앰퍼샌드.<br><br>셋째 단락.',
    tags: ['제니'], sourceHandle: 'x', permalink: 'https://i/p/A/',
  });
  assert.ok(!/<[a-z/]/i.test(c), 'HTML 태그가 남았다: ' + c);
  assert.ok(!/&(amp|lt|gt|quot|#0?39|nbsp);/i.test(c), 'HTML 엔티티가 남았다: ' + c);
  assert.ok(c.includes("'따옴표'") && c.includes('& 앰퍼샌드'), '엔티티가 원래 글자로 안 돌아왔다');
  assert.ok(c.includes('첫 단락 강조.\n\n둘째 단락'), '<br><br> 가 빈 줄 하나로 안 바뀌었다');
  assert.ok(!/\n{3,}/.test(c), '빈 줄이 세 줄 이상 연속된다');
});

t('텔레그램 캡션 상한을 넘으면 자르지 않고 따로 보낸다', () => {
  const long = '제목\n\n' + 'ㄱ'.repeat(2000);
  const r = cb.splitCaptionForTelegram(long);
  assert.ok(r.caption.length <= cb.TELEGRAM_CAPTION_MAX);
  assert.strictEqual(r.caption, '제목');
  assert.strictEqual(r.overflow, long, '본문 전문은 손실 없이 남아야 한다');
});

t('상한 이내면 그대로 캡션에 싣는다', () => {
  const r = cb.splitCaptionForTelegram('짧은 캡션');
  assert.strictEqual(r.caption, '짧은 캡션');
  assert.strictEqual(r.overflow, '');
});

/* ⑤ */
t('시크릿 미설정이면 fail-closed (503)', () => {
  assert.ok(/TELEGRAM_WEBHOOK_SECRET/.test(WEBHOOK_CODE), '시크릿 검사가 없다');
  assert.ok(/if \(!secret\)[\s\S]{0,200}?503/.test(WEBHOOK_CODE),
    '시크릿이 없을 때 503 으로 닫혀야 한다 (열어두면 공개 엔드포인트가 된다)');
  assert.ok(/x-telegram-bot-api-secret-token/.test(WEBHOOK_CODE), '헤더 대조가 없다');
});

t('허용 chat_id 밖의 메시지는 큐에 안 넣는다', () => {
  assert.ok(/allowedChats\(\)/.test(WEBHOOK_CODE) && /chat_not_allowed/.test(WEBHOOK_CODE));
});

/* ⑥ */
t('webhook 은 AI·렌더·전송 같은 무거운 일을 하지 않는다', () => {
  for (const forbidden of ['anthropic', 'papVoice', 'sharp', 'sendMediaGroup', 'sendGroup']) {
    assert.ok(!WEBHOOK_CODE.includes(forbidden),
      'webhook 이 무거운 일을 한다: ' + forbidden + ' — 텔레그램 재전송 시 중복 발송이 된다');
  }
});

t('큐 적재는 중복을 무시하는 upsert 다', () => {
  assert.ok(/onConflict: 'batch_key,shortcode'/.test(WEBHOOK_CODE), 'onConflict 키가 다르다');
  assert.ok(/ignoreDuplicates: true/.test(WEBHOOK_CODE), '재전송 시 중복 적재된다');
});

t('처리 실패도 200 으로 답한다 (텔레그램 무한 재전송 방지)', () => {
  assert.ok(/큐 적재 실패[\s\S]{0,200}?OK\(res/.test(WEBHOOK), '큐 실패 시 200 이 아니면 텔레그램이 계속 재전송한다');
});


/* ⑦ 처리 크론 계약 */

t('크론이 vercel.json 에 등재돼 있다', () => {
  const c = (VERCEL.crons || []).find((x) => x.path === '/api/cron/celeb-brief');
  assert.ok(c, '만들어놓고 안 돌면 없는 것과 같다');
  assert.ok(/^\*\/\d+ /.test(c.schedule), '주기 형식이 이상하다: ' + c.schedule);
});

t('에셋이 함수 번들에 포함된다', () => {
  const fn = (VERCEL.functions || {})['api/cron/celeb-brief.js'];
  assert.ok(fn && fn.includeFiles && fn.includeFiles.includes('api/_assets/celeb'),
    '폰트·심볼이 번들에 안 들어가면 Vercel 에서 렌더가 죽는다');
});

t('CRON_SECRET 또는 관리자만 실행할 수 있다', () => {
  assert.ok(/CRON_SECRET/.test(CRON_CODE) && /requireAdmin/.test(CRON_CODE),
    '/api/cron/* 은 공개 URL 이다');
});

t('조기 반환마다 cronNote 를 남긴다', () => {
  assert.ok(/res\.locals = res\.locals \|\| \{\}/.test(CRON_CODE), 'res.locals 를 만들지 않으면 마지막 줄에서 넘어진다');
  /* 줄 단위로 보면 여러 줄에 걸친 return 을 오탐한다. 반환문 **하나씩**
     떼어내 그 안에 note(res,) 가 있는지 본다. */
  const chunks = CRON_CODE.split('return res.status(200)').slice(1);
  assert.ok(chunks.length >= 3, '200 반환 지점이 너무 적다 — 검사 의미 없음');
  for (const c of chunks) {
    const stmt = c.slice(0, c.indexOf(';') + 1 || 400);
    assert.ok(/note\(res,/.test(stmt), 'cronNote 없는 조기 반환: ' + stmt.replace(/\s+/g, ' ').slice(0, 90));
  }
});

t('썸네일은 1장만 — 나머지는 원본 그대로', () => {
  assert.ok(/renderThumb\(cover,/.test(CRON_CODE), '커버에 디자인을 안 입힌다');
  /* 브리프 만드는 구간(withCronGuard 이후)에서만 센다. 게시 구간(runPublish)은
     같은 커버를 다시 렌더하므로 파일 전체로 세면 2가 된다. */
  const briefPart = CRON_CODE.split("withCronGuard('celeb-brief'")[1] || '';
  const renderCalls = (briefPart.match(/renderThumb\(/g) || []).length;
  assert.strictEqual(renderCalls, 1, '도메니코 규칙: 썸네일만 디자인, 나머지는 아무 디자인도 안 입힌다');
  assert.ok(/const rest = items\[0\]\.type === 'image' \? items\.slice\(1\) : items;/.test(CRON_CODE),
    '나머지는 원본 그대로 이어붙여야 한다');
});

/* ⑨ 영상 (2026-08-23 도메니코: "영상은 불가능해?") */
t('영상 게시물도 받는다 — 커버에만 디자인, 영상은 원본', () => {
  const items = cb.collectMediaItems({
    media_type: 'VIDEO', media_url: 'https://cdn/v.mp4', thumbnail_url: 'https://cdn/t.jpg',
  });
  assert.deepStrictEqual(items, [{ type: 'video', url: 'https://cdn/v.mp4', thumb: 'https://cdn/t.jpg' }]);
  assert.strictEqual(cb.pickCoverUrl(items), 'https://cdn/t.jpg', '커버는 영상의 프레임을 쓴다');
});

t('판형은 실측으로 고른다 — pickVariant(items, firstDim) 가 렌더러까지 전달된다', () => {
  // 2026-08-26 4887248 이 "type=video → 무조건 reels" 를 실측 비율 기반
  // pickVariant 로 바꿨는데 이 테스트가 옛 삼항식을 정규식으로 고정한 채
  // 남아 스위트가 깨졌다. pickVariant 의 동작 자체(9:16→reels, 4:5→feed,
  // 실측 실패 시 reels 폴백)는 celeb-brief-ratio-gate.test.js 가 검사한다.
  // 여기서는 cron 이 그 단일 진실원천을 쓰고 렌더러에 전달하는지만 고정한다.
  assert.ok(/const variant = celebBrief\.pickVariant\(items, firstDim\);/.test(CRON_CODE),
    '판형 결정이 pickVariant(실측) 를 거치지 않는다');
  assert.ok(/\{ variant, focusTop: gen\.cover_focus_top \}/.test(CRON_CODE),
    '판형·얼굴 위치가 렌더러에 안 전달된다 (피드 4:5 크롭에서 얼굴이 잘린다)');
});

t('영상이 첫 장이면 영상 본체도 함께 보낸다', () => {
  assert.ok(/items\[0\]\.type === 'image' \? items\.slice\(1\) : items/.test(CRON_CODE),
    '영상일 때 items 를 통째로 넘기지 않으면 영상이 빠진다 (커버 프레임만 가는 사고)');
});

t('캐러셀에서 사진·영상 순서가 유지된다', () => {
  const items = cb.collectMediaItems({
    media_type: 'CAROUSEL_ALBUM',
    children: { data: [
      { media_type: 'IMAGE', media_url: 'https://cdn/1.jpg' },
      { media_type: 'VIDEO', media_url: 'https://cdn/2.mp4', thumbnail_url: 'https://cdn/2t.jpg' },
      { media_type: 'IMAGE', media_url: 'https://cdn/3.jpg' },
    ] },
  });
  assert.deepStrictEqual(items.map((i) => i.type), ['image', 'video', 'image']);
  assert.strictEqual(cb.pickCoverUrl(items), 'https://cdn/1.jpg', '커버는 첫 장이다');
});

t('커버로 쓸 게 하나도 없으면 사람에게 알린다', () => {
  const items = cb.collectMediaItems({ media_type: 'VIDEO', media_url: 'https://cdn/v.mp4' });  // thumb 없음
  assert.strictEqual(cb.pickCoverUrl(items), null);
  assert.ok(/쓸 수 있는 사진·영상을 못 찾았습니다/.test(CRON), '실패 안내가 없다');
});

t('큰 영상을 조용히 빼지 않는다', () => {
  assert.ok(/VIDEO_MAX_BYTES/.test(CRON_CODE), '텔레그램 50MB 상한 방어가 없다');
  assert.ok(/영상 ' \+ tooBig \+ '건은 뺐습니다/.test(CRON), '뺀 사실을 캡션에 적어야 한다');
});

t('사진·영상을 한 묶음으로 보낸다', () => {
  assert.ok(/sendMediaToTelegram\(media,/.test(CRON_CODE), '사진 전용 전송을 쓰면 영상이 사진으로 나간다');
  const TG = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/telegram.js'), 'utf8');
  assert.ok(/sendVideo/.test(TG) && /type: isVid \? 'video' : 'photo'/.test(TG),
    '텔레그램 쪽에 영상 경로가 없다');
});

t('자동 발행이 없다 — 기사 INSERT 는 사람 명령 경로(runWebPublish)에만', () => {
  /* 2026-08-23 정밀화: "웹만" 웹 게시가 생기면서 기사 INSERT 가 크론에 들어왔다.
     단 그 경로는 status=web_queued 에서만 돌고, 그 상태는 웹훅이 도메니코의
     "웹만" 명령을 받았을 때만 만든다 — 발행 판단은 여전히 사람이다.
     지키는 것: 브리프 생성 경로(사람 명령 밖)에는 INSERT 가 없어야 한다. */
  const webStart = CRON_CODE.indexOf('async function runWebPublish');
  const webEnd = CRON_CODE.indexOf('async function runPublish');
  assert.ok(webStart >= 0 && webEnd > webStart, 'runWebPublish 경계를 못 찾았다');
  const outside = CRON_CODE.slice(0, webStart) + CRON_CODE.slice(webEnd);
  assert.ok(!/from\('articles'\)[\s\S]{0,80}\.insert/.test(outside),
    '사람 명령 밖에서 기사를 DB 에 넣는다 — 07-20 스팸의 재림');
  assert.ok(!/media_publish/.test(CRON_CODE), '인스타 게시는 igPublish 경유(도메니코 "올려")만');
  assert.ok(/eq\('status', 'web_queued'\)/.test(CRON_CODE),
    'runWebPublish 진입이 web_queued 로 제한되지 않았다');
});

t('한 메시지의 링크는 합치되, 서로 다른 게시물은 섞지 않는다 (batch_key 묶음)', () => {
  /* 2026-08-24 수정: 예전엔 "같은 채팅 + 5분 창" 으로 묶어서, 자동감시로 서로 다른
     게시물이 동시에 들어오면 한 덩어리로 뭉쳐 영상·기사가 섞였다(디올 기사에 아이스파
     영상이 붙은 사고). 이제 batch_key 로만 묶는다 — 한 메시지의 링크(수동)·한 게시물
     (자동감시)이 각각 하나의 batch_key 이므로, 합칠 건 합치고 섞을 건 섞지 않는다. */
  assert.ok(/r\.batch_key === head0\.batch_key/.test(CRON_CODE),
    'batch_key 로 묶지 않으면 동시에 온 다른 게시물이 한 브리프로 섞인다');
  assert.ok(!/r\.chat_id === head0\.chat_id && new Date\(r\.created_at\)/.test(CRON_CODE),
    '옛 "같은 채팅 + 시간창" 묶기가 남아 있으면 자동감시 동시 도착이 다시 뭉친다');
});

t('실패해도 사람에게 알린다 (무응답이 가장 나쁜 실패)', () => {
  assert.ok(/셀럽 속보 브리프 실패/.test(CRON), '실패 알림 문구가 없다');
  assert.ok(/status: 'queued', error:/.test(CRON_CODE), '실패 시 다시 큐로 돌려 재시도해야 한다');
  assert.ok(/MAX_ATTEMPTS/.test(CRON_CODE), '무한 재시도 방지 장치가 없다');
});


/* ⑧ 즉시 응답 (2026-08-23 도메니코: "링크를 받자마자 빠른 속도로") */
t('webhook 이 큐에 넣은 직후 처리 크론을 깨운다', () => {
  assert.ok(/wakeProcessor\(\)/.test(WEBHOOK_CODE), '즉시 깨우기가 없다 — 최악 10분을 기다리게 된다');
  assert.ok(/\?now=1/.test(WEBHOOK_CODE), '깨울 때 now=1 이 없으면 합치기 대기에 걸려 아무것도 안 한다');
  assert.ok(/Bearer ' \+ secret/.test(WEBHOOK_CODE), 'CRON_SECRET 없이는 크론이 관리자 인증을 요구한다');
});

t('깨우기를 콜드스타트 전에 끊지 않는다 (2026-08-23 사고)', () => {
  /* 2.5초로 끊었더니 크론 런타임 로그에 호출 흔적이 아예 없었다.
     abort 는 요청을 놓아주는 게 아니라 취소하는 것이다. */
  assert.ok(/waitUntil/.test(WEBHOOK_CODE), 'waitUntil 경로가 없다 — 정석은 끊지 않고 백그라운드로 보내는 것');
  assert.ok(/require\('@vercel\/functions'\)/.test(WEBHOOK_CODE), 'waitUntil 을 어디서도 가져오지 않는다');
  const m = WEBHOOK_CODE.match(/CELEB_BRIEF_WAKE_TIMEOUT_MS \|\| (\d+)/);
  assert.ok(m, '폴백 상한이 없다');
  assert.ok(Number(m[1]) >= 8000, '폴백 상한이 콜드스타트보다 짧다 (' + m[1] + 'ms) — 또 안 깨어난다');
});

t('waitUntil 패키지가 없어도 동작한다 (지연 로드 + 폴백)', () => {
  const top = WEBHOOK_CODE.split('\n').filter((l) => /^(const|let|var)\s.*require\(/.test(l));
  assert.ok(!top.some((l) => /@vercel\/functions/.test(l)),
    '최상단에서 로드하면 패키지가 없을 때 webhook 전체가 죽는다');
  assert.ok(/catch \(_e\) \{[\s\S]{0,40}return null;/.test(WEBHOOK_CODE), '없을 때 폴백이 없다');
});

t('깨우기가 실패해도 스케줄 안전망이 남아 있다', () => {
  const c = (VERCEL.crons || []).find((x) => x.path === '/api/cron/celeb-brief');
  assert.ok(c, '스케줄이 없으면 깨우기 실패 = 영영 처리 안 됨');
  assert.ok(!/return res\.status\(50\d\)[\s\S]{0,80}wake/.test(WEBHOOK_CODE), '깨우기 실패로 500 을 내면 텔레그램이 재전송한다');
});

t('now=1 이면 합치기 대기를 건너뛴다', () => {
  assert.ok(/nowMode/.test(CRON_CODE), 'now 모드가 없다');
  assert.ok(/if \(!nowMode && age < BATCH_WAIT_MS\)/.test(CRON_CODE), '대기 검사를 건너뛰지 않으면 즉시 깨워도 소용없다');
});

t('겹쳐 돌아도 브리프가 두 번 안 나간다 (원자적 클레임)', () => {
  assert.ok(/\.eq\('status', 'queued'\)\.in\('id', wantIds\)\.select\('id'\)/.test(CRON_CODE),
    'select→update 로 나누면 즉시 깨우기와 스케줄이 같은 행을 집어 두 번 전송된다');
  assert.ok(/다른 실행이 이미 가져감/.test(CRON), '클레임 실패 시 조용히 빠지는 경로가 없다');
});


/* ⑩ 댓글 / 대댓글 (2026-08-23 도메니코: 댓글=질문 · 대댓글=해시태그) */
t('본문 마지막 독자 질문을 떼어 댓글로 옮긴다', () => {
  const r = cb.splitClosingQuestion('첫 단락.<br><br>둘째 단락. 당신은 어떤 마음으로 재생 버튼을 누를 것인가?');
  assert.strictEqual(r.question, '당신은 어떤 마음으로 재생 버튼을 누를 것인가?');
  assert.strictEqual(r.body, '첫 단락.\n\n둘째 단락.', '본문에 질문이 남으면 캡션과 댓글이 겹친다');
});

t('물음표로 안 끝나면 억지로 질문을 만들지 않는다', () => {
  const r = cb.splitClosingQuestion('첫 단락.<br><br>딱 일주일만 더 기다려보자.');
  assert.strictEqual(r.question, '');
  assert.strictEqual(r.body, '첫 단락.\n\n딱 일주일만 더 기다려보자.', '본문을 건드리면 안 된다');
});

t('해시태그는 5개, 기사 내용에서 뽑는다 (도메니코 2026-08-23)', () => {
  const block = cb.buildHashtagBlock({ tags: ['제니', '블랙핑크', 'fallen angel', 'k-pop', '뮤직비디오', '여름'] });
  const tags = block.split(' ');
  assert.strictEqual(tags.length, cb.HASHTAG_COUNT, '5개가 아니다: ' + tags.length);
  assert.strictEqual(tags[0], '#PAPMAGAZINE', '#PAPMAGAZINE 이 1번이 아니다');
  assert.ok(tags.includes('#제니') && tags.includes('#블랙핑크'), '기사 태그가 안 들어갔다: ' + block);
  assert.ok(tags.includes('#FALLENANGEL'), '공백이 든 태그가 안 붙었다 (해시태그는 공백에서 끊긴다)');
  assert.ok(!tags.includes('#여름'), '5개를 넘겼다');
  assert.strictEqual(new Set(tags).size, tags.length, '중복 태그가 있다');
});

t('영문은 대문자, 한글은 그대로', () => {
  assert.strictEqual(cb.normalizeTag('fallen angel'), 'FALLENANGEL');
  assert.strictEqual(cb.normalizeTag('#K-Pop'), 'KPOP');
  assert.strictEqual(cb.normalizeTag('케이팝 화보'), '케이팝화보');
  assert.strictEqual(cb.normalizeTag('   '), '');
});

t('기사 태그가 없으면 셀럽 공용 풀로 채운다 (빈 대댓글보다 낫다)', () => {
  const block = cb.buildHashtagBlock({ tags: [] });
  const tags = block.split(' ');
  assert.strictEqual(tags.length, cb.HASHTAG_COUNT);
  assert.strictEqual(tags[0], '#PAPMAGAZINE');
});

t('크론이 기사 태그를 넘긴다', () => {
  assert.ok(/tags: gen\.tags/.test(CRON_CODE), '공용 풀만 돌려쓰면 기사와 무관한 태그가 달린다');
  assert.ok(!/seed: rows\[0\]\.shortcode/.test(CRON_CODE), '옛 로테이션 시드가 남아 있다');
});

t('캡션은 해시태그 없이, 태그는 대댓글로만', () => {
  const c = cb.buildComments({ question: '당신은 어떤가?', seed: 'S' });
  assert.strictEqual(c.comment, '당신은 어떤가요?');
  assert.ok(c.reply.startsWith('#PAPMAGAZINE'), '대댓글이 해시태그 블록이 아니다');
  const cap = cb.buildBriefCaption({ hook: 'h', bodyKo: 'k', bodyEn: 'e', mentions: ['x'] });
  assert.ok(!/#[0-9A-Za-z가-힣_]/.test(cap), '캡션에 해시태그가 남았다 (볼트 톤앤매너: 셀럽 캡션엔 안 붙인다)');
});

t('댓글은 우리가 단다 — 브리프에는 검토용으로만 보여준다', () => {
  /* 도메니코 2026-08-23: "댓글은 내가 다는 게 아니라 기사가 올라가고 나서
     즉시 너가 직접 다는 거야." 게시 경로에 addComment 가 있는 건 그대로고,
     텔레그램 라벨이 '붙여넣으세요' 처럼 읽히지 않게 못박는다. */
  assert.ok(/splitClosingQuestion\(gen\.body_ko\)/.test(CRON_CODE), '질문을 떼어내지 않는다');
  assert.ok(/halveBody\(koSplit\.body\)/.test(CRON_CODE), '질문이 캡션에 그대로 남는다');
  assert.ok(/게시하면 아래가 자동으로 달립니다/.test(CRON), '자동으로 달린다는 안내가 없다 — 손으로 달아야 하는 줄 안다');
  assert.ok(/💬 댓글/.test(CRON) && /↳ 대댓글/.test(CRON), '무엇이 댓글이고 대댓글인지 구분이 없다');
  const pubPart = CRON_CODE.split('async function runPublish')[1].split('module.exports')[0];
  assert.ok(/addComment\(mediaId, pub\.comment\)/.test(pubPart), '게시 후 댓글을 안 단다');
  assert.ok(/replyToComment\(cid, pub\.reply\)/.test(pubPart), '대댓글을 안 단다');
});


/* ⑪ 캡션 길이 · 영상 커버 (2026-08-23) */
t('캡션 본문을 절반으로 줄인다 (단락 단위)', () => {
  const body = ['가'.repeat(100), '나'.repeat(100), '다'.repeat(100), '라'.repeat(100)].join('\n\n');
  const h = cb.halveBody(body);
  assert.ok(h.text.length <= body.length * 0.6, '절반 근처로 안 줄었다: ' + h.text.length);
  assert.strictEqual(h.paras, 2);
  assert.ok(h.text.startsWith('가'), '앞 단락(리드)을 남겨야 한다');
  assert.ok(!/[다라]/.test(h.text), '뒤 단락이 남았다');
  assert.ok(!/\n\n$/.test(h.text), '끝에 빈 줄이 남았다');
});

t('단락 중간에서 자르지 않는다', () => {
  const h = cb.halveBody('한 단락뿐이고 꽤 길다.'.repeat(20));
  assert.strictEqual(h.paras, 1, '단락이 하나면 통째로 남긴다');
  assert.ok(h.text.endsWith('길다.'), '문장 중간에서 잘렸다');
});

t('영문 단락 수를 국문에 맞춘다', () => {
  const ko = cb.halveBody(['가'.repeat(80), '나'.repeat(80), '다'.repeat(80)].join('\n\n'));
  const en = cb.takeParagraphs('P1.<br><br>P2.<br><br>P3.', ko.paras);
  assert.strictEqual(en.split('\n\n').length, ko.paras, '국·영문 단락 수가 어긋난다');
});

t('크론이 캡션에 줄인 본문을 쓴다', () => {
  assert.ok(/halveBody\(koSplit\.body\)/.test(CRON_CODE), '본문을 줄이지 않는다');
  assert.ok(/bodyKo: koShort\.text/.test(CRON_CODE), '캡션이 원본 본문을 쓴다');
  assert.ok(/takeParagraphs\(gen\.body_en, koShort\.paras\)/.test(CRON_CODE), '영문 단락 수를 안 맞춘다');
});

t('영상 미리보기에 디자인 커버를 얹는다', () => {
  assert.ok(/thumb: videoThumb/.test(CRON_CODE), '영상에 커버가 안 붙는다');
  assert.ok(/resize\(\{ width: 320 \}\)/.test(CRON_CODE),
    '텔레그램 thumbnail 은 320px 이하 JPEG 여야 한다 — 원본을 넘기면 무시된다');
  const TG = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/telegram.js'), 'utf8');
  assert.ok(/form\.append\('thumbnail'/.test(TG), 'sendVideo 에 thumbnail 이 없다');
  assert.ok(/m\.thumbnail = 'attach:\/\/' \+ tn/.test(TG), 'sendMediaGroup 에 thumbnail 이 없다');
});

t('커버 축소가 실패해도 브리프는 나간다', () => {
  assert.ok(/영상 커버 축소 실패\(커버 없이 진행\)/.test(CRON), '커버 실패가 전체를 막으면 안 된다');
});


t('영상 해상도를 재서 기록한다 (크롭이 필요한지 숫자로 본다)', () => {
  assert.ok(/mp4Dimensions/.test(CRON_CODE), '영상 해상도를 안 잰다');
  assert.ok(/video_sizes: videoSizes/.test(CRON_CODE), '기록에 남지 않으면 나중에 확인할 수 없다');
  assert.ok(/0\.5625/.test(CRON_CODE), '9:16 기준값이 없다');
  /* 2026-08-28 — 경고 문구가 "9:16 아님"에서 판형 기준으로 바뀌었다.
     지키려는 것은 문구가 아니라 "비율이 안 맞으면 조용히 넘어가지 않는다"이다. */
  assert.ok(/비율 못 맞춘 영상/.test(CRON), '비율을 못 맞췄을 때 알리지 않는다');
  const MUTE = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/mp4Mute.js'), 'utf8');
  assert.ok(/function mp4Dimensions/.test(MUTE) && /mp4Dimensions,/.test(MUTE), 'mp4Dimensions 가 없거나 export 안 됐다');
});

t('해상도 읽기가 실패해도 브리프는 나간다', () => {
  assert.ok(/영상 해상도 읽기 실패/.test(CRON), '해상도 실패가 전체를 막으면 안 된다');
});


/* ⑫ 게시 (2026-08-23 도메니코: "게시 기능을 만들어줘") */
const PUB = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/igPublish.js'), 'utf8');
const PUB_CODE = PUB.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

t('게시 명령을 좁게 판정한다 (잘못 올리는 게 안 올리는 것보다 나쁘다)', () => {
  for (const yes of ['올려', '올려줘', '게시해줘', '업로드', 'publish', 'GO', '올려.']) {
    const r = cb.parsePublishCommand(yes);
    assert.ok(r && r.num === null && r.web === false, '명령인데 아니라고 함: ' + yes);
  }
  for (const no of ['올려도 될까?', '올리지 마', '제니 기사 좋다', '', '나중에 올려줄래',
                    '올려 https://www.instagram.com/p/A/']) {
    assert.strictEqual(cb.parsePublishCommand(no), false, '명령이 아닌데 명령이라 함: ' + no);
  }
});

t('브리프 번호를 지정할 수 있다 — "올려 12" (동시 도착 모호성 해소)', () => {
  /* 자동 감시(2026-08-23)로 브리프가 한꺼번에 여러 건 오는 게 정상이 됐다.
     "올려"가 최신 것을 집으면 보고 있던 것과 다른 게 올라간다. */
  assert.deepStrictEqual(cb.parsePublishCommand('올려 12'), { num: 12, web: false });
  assert.deepStrictEqual(cb.parsePublishCommand('올려 #7'), { num: 7, web: false });
  assert.deepStrictEqual(cb.parsePublishCommand('게시해줘 3'), { num: 3, web: false });
  assert.strictEqual(cb.parsePublishCommand('12'), false, '숫자만으로는 명령이 아니다');
  assert.strictEqual(cb.parsePublishCommand('올리지 마 12'), false);
});

t('웹훅이 여러 후보일 때 목록을 되물어본다 (임의로 고르지 않는다)', () => {
  assert.ok(/ambiguous_publish/.test(WEBHOOK_CODE), '모호성 분기가 없다 — 최신 것을 집으면 사고다');
  assert.ok(/limit\(5\)/.test(WEBHOOK_CODE), '후보를 여러 건 조회하지 않는다');
  assert.ok(/eq\('id', wantNum\)/.test(WEBHOOK_CODE), '번호 지정 경로가 없다');
});

t('크론이 브리프 번호를 항상 알려준다 (번호를 모르면 지정을 못 한다)', () => {
  assert.ok(/브리프 #' \+ rows\[0\]\.id/.test(CRON_CODE), '브리프 메시지에 번호가 없다');
});

t('링크가 있으면 게시 명령이 아니다 (새 브리프 요청이다)', () => {
  const p = cb.parseUpdate({ message: { message_id: 1, chat: { id: 7 },
    text: '올려 @x https://www.instagram.com/p/AAA/' } });
  assert.strictEqual(p.publishCommand, false);
  assert.strictEqual(p.links.length, 1);
});

t('스스로 게시하는 경로가 없다 (절대 규칙)', () => {
  /* publish_queued 로 넘기는 곳은 webhook 의 사람 명령 분기 하나뿐이어야 한다. */
  const marks = (WEBHOOK_CODE.match(/'publish_queued'/g) || []).length;
  assert.ok(marks >= 1, 'webhook 에 게시 접수가 없다');
  assert.ok(/parsed\.publishCommand/.test(WEBHOOK_CODE), '사람 명령 없이 게시가 접수된다');
  assert.ok(!/status: 'publish_queued'/.test(CRON_CODE.replace(/status: 'publish_queued' \}\)\.eq\('id', row\.id\)/g, '')),
    '크론이 스스로 게시 대기로 넘기는 코드가 있다');
  assert.ok(!/publishReel|publishPhotos/.test(CRON_CODE.split('async function runPublish')[0]),
    '브리프 생성 경로에서 게시 API 를 부른다');
});

t('게시도 원자적으로 찜한다 (두 번 올리지 않는다)', () => {
  assert.ok(/\.update\(\{ status: 'publishing' \}\)[\s\S]{0,120}\.eq\('status', 'publish_queued'\)[\s\S]{0,40}\.select\('id'\)/.test(CRON_CODE),
    '게시 클레임이 원자적이지 않다 — 같은 브리프가 두 번 올라간다');
  assert.ok(/다른 실행이 이미 게시 중/.test(CRON), '경합 시 조용히 빠지는 경로가 없다');
});

t('게시는 됐는데 댓글이 실패한 경우를 성공으로 뭉개지 않는다', () => {
  assert.ok(/commentWarn/.test(CRON_CODE), '댓글 실패를 구분하지 않는다');
  assert.ok(/댓글\/해시태그 실패/.test(CRON), '댓글 실패가 사람에게 안 알려진다');
});

t('릴스는 커버를 지정해 올린다', () => {
  assert.ok(/cover_url/.test(PUB_CODE), '릴스 표지가 인스타 자동 프레임이 된다');
  assert.ok(/media_type: 'REELS'/.test(PUB_CODE), '릴스 경로가 없다');
  assert.ok(/publishReel\(videoUrl, pub\.caption, coverUrl\)/.test(CRON_CODE), '커버를 안 넘긴다');
});

t('컨테이너 준비를 기다리고, ERROR 는 즉시 포기한다', () => {
  assert.ok(/status_code/.test(PUB_CODE), '컨테이너 상태를 안 본다');
  assert.ok(/'ERROR' \|\| last === 'EXPIRED'/.test(PUB_CODE), 'ERROR 인데 계속 기다린다');
  assert.ok(/컨테이너 준비 시간 초과/.test(PUB), '무한 대기 방지가 없다');
});

t('게시 라이브러리가 토큰을 오류 메시지에 싣지 않는다', () => {
  assert.ok(/function graphError/.test(PUB_CODE), '오류 정리 함수가 없다');
  const errFn = PUB_CODE.split('function graphError')[1].split('\n}')[0];
  assert.ok(!/token/.test(errFn), '오류 메시지에 토큰이 들어간다');
});

t('무거운 의존은 지연 로드다', () => {
  const top = PUB_CODE.split('\n').filter((l) => /^(const|let|var)\s.*require\(/.test(l));
  assert.ok(!top.some((l) => /supabase/.test(l)), '최상단에서 supabase 를 로드한다 (CI 가 죽는다)');
});


/* ⑬ 영상에 디자인 굽기 (2026-08-23 도메니코: "앞 2-3초") */
const VOV = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/videoOverlay.js'), 'utf8');
const VOV_CODE = VOV.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

t('기본은 꺼져 있고 환경변수로만 켠다 (되돌릴 길을 먼저 둔다)', () => {
  const vo = require('../api/_lib/videoOverlay');
  const before = process.env.CELEB_BURN_OVERLAY;
  delete process.env.CELEB_BURN_OVERLAY;
  assert.strictEqual(vo.isEnabled(), false, '환경변수 없이 켜져 있다');
  process.env.CELEB_BURN_OVERLAY = 'on';
  assert.strictEqual(vo.isEnabled(), true);
  if (before === undefined) delete process.env.CELEB_BURN_OVERLAY; else process.env.CELEB_BURN_OVERLAY = before;
  assert.ok(/videoOverlay\.isEnabled\(\)/.test(CRON_CODE), '크론이 스위치를 안 본다');
});

t('한 번의 인코딩으로 9:16 크롭 + 전체 구간 오버레이', () => {
  /* 도메니코 2026-08-23: 처음엔 "앞 2-3초" 였다가 실물을 보고
     "섬네일은 3초 후에 사라지지 않고 계속 유지하자" 로 바꿨다. */
  const vo = require('../api/_lib/videoOverlay');
  const f = vo.buildFilter(vo.DEFAULTS);
  assert.ok(/scale=1080:1920:force_original_aspect_ratio=increase/.test(f), '확대가 없다');
  assert.ok(/crop=1080:1920/.test(f), '크롭이 없다');
  assert.strictEqual(vo.DEFAULTS.seconds, 0, '0 이어야 전체 구간이다');
  assert.ok(!/fade=out/.test(f), '전체 구간인데 페이드아웃이 남아 있다');
  assert.ok(!/enable=/.test(f), '전체 구간인데 시간 제한이 남아 있다');
  assert.ok(/\[bg\]\[ov\]overlay=0:0\[v\]/.test(f), '오버레이가 안 얹힌다');
});

t('앞 N초 모드로 되돌릴 수 있다', () => {
  /* 도메니코가 한 번 바꿨으니 또 바꿀 수 있다 — 되돌릴 길을 남겨 둔다. */
  const vo = require('../api/_lib/videoOverlay');
  const f = vo.buildFilter({ ...vo.DEFAULTS, seconds: 3 });
  assert.ok(/fade=out:st=2\.40:d=0\.60:alpha=1/.test(f), '페이드아웃이 없다');
  assert.ok(/enable='lte\(t,3\)'/.test(f), '시간 제한이 없다');
});

t('굽기가 실패해도 원본으로 브리프는 나간다', () => {
  /* burnIntro 안에서는 던져도 되지만(검증·ffmpeg 오류), **밖으로 새면 안 된다**.
     catch 가 null 을 돌려주는지로 본다. */
  const body = VOV_CODE.split('async function burnIntro')[1] || '';
  assert.ok(/catch \(e\) \{[\s\S]{0,200}return null;/.test(body),
    'burnIntro 의 catch 가 null 을 돌려주지 않는다 — 예외가 밖으로 새면 브리프가 통째로 죽는다');
  const vo2 = require('../api/_lib/videoOverlay');
  assert.strictEqual(typeof vo2.burnIntro, 'function');
  assert.ok(/원본으로 진행/.test(CRON), '크론에 원본 폴백이 없다');
  assert.ok(/굽기 실패/.test(CRON), '굽기 실패가 사람에게 안 알려진다');
});

t('임시 파일을 반드시 지운다', () => {
  assert.ok(/finally \{[\s\S]{0,160}rmSync/.test(VOV_CODE), 'finally 에서 임시 폴더를 안 지운다 — /tmp 가 찬다');
});

t('오디오는 다시 만들지 않는다', () => {
  assert.ok(/'-c:a', 'copy'/.test(VOV_CODE), '오디오를 재인코딩하면 인스타 음원이 상한다');
});

t('굽기는 브리프 때 한 번만 — 게시는 저장본을 쓴다', () => {
  assert.ok(/burnedVideoUrl/.test(CRON_CODE), '구운 영상을 보관하지 않는다');
  assert.ok(/let videoUrl = pub\.burnedVideoUrl \|\| null;/.test(CRON_CODE),
    '게시가 저장본을 안 쓰면 다시 굽게 되고, 릴스 폴링 180초와 합쳐 함수 상한을 넘는다');
  const pubPart = CRON_CODE.split('async function runPublish')[1].split('module.exports')[0];
  assert.ok(!/burnIntro/.test(pubPart), '게시 경로에서 다시 굽는다');
});

t('인코딩 상한이 함수 상한보다 짧다', () => {
  const vo = require('../api/_lib/videoOverlay');
  const fn = VERCEL.functions['api/cron/celeb-brief.js'];
  assert.ok(fn && fn.maxDuration, '함수 상한이 없다');
  assert.ok(vo.DEFAULTS.timeoutMs / 1000 < fn.maxDuration,
    '인코딩 상한(' + vo.DEFAULTS.timeoutMs / 1000 + 's)이 함수 상한(' + fn.maxDuration + 's) 이상이다');
});

t('오버레이는 썸네일과 같은 조판을 쓴다 (두 벌로 갈리지 않게)', () => {
  const TH = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/celebThumb.js'), 'utf8');
  assert.ok(/function _layers\(/.test(TH), '공통 조판 함수가 없다');
  assert.ok(/renderOverlay/.test(TH) && /_layers\(titleKo, titleEn, opts\)/.test(TH),
    'renderOverlay 가 공통 조판을 안 쓴다');
});

t('댓글은 존댓말로 나간다', () => {
  /* 도메니코 2026-08-23: "댓글은 존댓말로 써줘."
     기사 마무리 문장(News 60건 실측)에 실제로 쓰인 어미는 ~는가 / ~가 / ~까 세 갈래뿐이다. */
  assert.strictEqual(cb.toPolite('당신의 하루는 어떤 리듬으로 흐르고 있는가?'),
    '당신의 하루는 어떤 리듬으로 흐르고 있나요?');
  assert.strictEqual(cb.toPolite('여러분이 기억하는 가장 따뜻한 순간은 언제인가.'),
    '여러분이 기억하는 가장 따뜻한 순간은 언제인가요?');
  assert.strictEqual(cb.toPolite('당신도 이 무대를 견뎌낼 수 있었을까'),
    '당신도 이 무대를 견뎌낼 수 있었을까요?');
});

t('이미 존댓말이면 두 번 붙이지 않는다', () => {
  assert.strictEqual(cb.toPolite('이 룩, 저장할 이유가 있었나요?'), '이 룩, 저장할 이유가 있었나요?');
  assert.strictEqual(cb.toPolite('어떻게 보셨나요'), '어떻게 보셨나요?');
  assert.strictEqual(cb.toPolite('무엇을 기대하십니까?'), '무엇을 기대하십니까?');
});

t('모르는 어미는 건드리지 않는다 (억지 변형 금지)', () => {
  const odd = '알 수 없는 어미로 끝나는 문장이다';
  assert.strictEqual(cb.toPolite(odd), odd);
  assert.strictEqual(cb.toPolite(''), '');
  assert.strictEqual(cb.toPolite(null), '');
});

t('buildComments 가 존댓말 변환을 거친다 (원문 그대로 새면 안 된다)', () => {
  const c = cb.buildComments({ question: '이 조합, 당신이라면 소화할 수 있는가?', tags: ['셀럽패션'] });
  assert.ok(/나요\?$/.test(c.comment), '반말 어미가 그대로 나갔다: ' + c.comment);
  assert.ok(!/는가\?/.test(c.comment), '~는가 가 남아 있다');
});

t('minLines=2 — 한 줄에 들어가도 두 줄로 앉힌다', () => {
  /* 도메니코 2026-08-23: "섬네일 타이틀은 이전처럼 두 줄로."
     조판이 2줄 전제라(국문 baseline 아래 고정 위치에 영문을 그린다)
     국문이 1줄로 떨어지면 국문과 영문 사이가 한 줄 벌어진다. */
  const m = (s) => [...s].reduce((a, c) => a + (/[가-힣]/.test(c) ? 64 : 34), 0);
  const out = cb.wrapHeadline('지수가 선택한 하루의 리듬', 860, m, 2, 2);
  assert.strictEqual(out.length, 2, '두 줄이 아니다: ' + JSON.stringify(out));
  assert.deepStrictEqual(out, ['지수가 선택한', '하루의 리듬']);
});

t('minLines 를 안 주면 예전대로 한 줄 (하위호환)', () => {
  const m = (s) => [...s].reduce((a, c) => a + (/[가-힣]/.test(c) ? 64 : 34), 0);
  assert.deepStrictEqual(cb.wrapHeadline('지수가 선택한 하루의 리듬', 860, m, 2), ['지수가 선택한 하루의 리듬']);
});

t('쪼갤 단어가 하나뿐이면 억지로 자르지 않는다', () => {
  const m = (s) => s.length * 30;
  assert.deepStrictEqual(cb.wrapHeadline('BIGBANG', 860, m, 2, 2), ['BIGBANG']);
});

t('두 줄 강제가 한계폭을 깨지 않는다', () => {
  const m = (s) => [...s].reduce((a, c) => a + (/[가-힣]/.test(c) ? 64 : 34), 0);
  ['BTS는 왜 제미나이를 불렀나', '색을 지우자 엔하이픈이 선명해졌다', '다시 움직이기 시작한 빅뱅의 시간'].forEach((t0) => {
    const out = cb.wrapHeadline(t0, 860, m, 2, 2);
    assert.strictEqual(out.length, 2, t0 + ' 가 두 줄이 아니다');
    out.forEach((l) => assert.ok(m(l) <= 860, '한계폭을 넘었다: ' + l));
  });
});

/* ─── 대댓글 해시태그: 인물·브랜드 포커스 (도메니코 2026-08-23) ─────────── */

t('대댓글은 인물·브랜드를 영문·한글 병기로 단다', () => {
  const c = cb.buildComments({
    question: '어떤가?',
    entities: [{ ko: '지수', en: 'JISOO' }, { ko: '블랙핑크', en: 'BLACKPINK' }],
  });
  assert.strictEqual(c.reply, '#PAPMAGAZINE #JISOO #지수 #BLACKPINK #블랙핑크');
});

t('주체가 있으면 일반 키워드는 섞지 않는다', () => {
  const c = cb.buildComments({
    question: '어떤가?',
    entities: [{ ko: '지수', en: 'JISOO' }],
    tags: ['sportychic', 'pinkstyling', 'athleisure'],
  });
  assert.ok(!/SPORTYCHIC|PINKSTYLING|ATHLEISURE/.test(c.reply),
    '스타일 키워드가 섞였다 — 인물·브랜드에 포커스가 아니다: ' + c.reply);
});

t('한글 표기가 없는 브랜드는 영문만 단다', () => {
  const c = cb.buildComments({ question: '어떤가?', entities: [{ ko: '', en: 'SKYLRK' }] });
  assert.strictEqual(c.reply, '#PAPMAGAZINE #SKYLRK');
});

t('주체를 하나도 못 뽑으면 예전 방식으로 메운다 (빈 대댓글 방지)', () => {
  const c = cb.buildComments({ question: '어떤가?', entities: [], tags: ['셀럽패션'] });
  const tags = c.reply.split(' ');
  assert.strictEqual(tags.length, cb.HASHTAG_COUNT);
  assert.ok(tags.includes('#셀럽패션'), '기사 태그를 안 썼다: ' + c.reply);
});

t('기사가 질문으로 안 끝나도 댓글이 비지 않는다', () => {
  /* 실측: News 기사의 67% 만 질문으로 끝난다. 나머지 33% 는 댓글이 비었고,
     댓글이 비면 addComment 가 실패해 **대댓글 해시태그까지 통째로 못 달렸다**.
     브리프 9·10번이 실제로 그렇게 나갔다. */
  const c = cb.buildComments({
    question: '',
    fallbackQuestion: '당신의 하루는 어떤 리듬으로 흐르는가?',
    entities: [{ ko: '지수', en: 'JISOO' }],
  });
  assert.ok(c.comment, '댓글이 비었다');
  assert.ok(/나요\?$/.test(c.comment), '존댓말 변환이 안 됐다: ' + c.comment);
});

t('기사 질문이 있으면 그걸 우선한다', () => {
  const c = cb.buildComments({ question: '이 룩 어떤가?', fallbackQuestion: '다른 질문인가?' });
  assert.ok(/이 룩/.test(c.comment), '기사 질문을 안 썼다: ' + c.comment);
});

t('크론이 주체와 예비 질문을 넘긴다', () => {
  assert.ok(/entities: gen\.entities/.test(CRON_CODE), '주체를 안 넘기면 해시태그가 스타일 키워드로 돌아간다');
  assert.ok(/fallbackQuestion: gen\.comment_question/.test(CRON_CODE), '예비 질문을 안 넘기면 댓글이 빈다');
});

t('기사 생성 프롬프트가 주체와 질문을 요구한다', () => {
  const IMP = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/instagramImport.js'), 'utf8');
  assert.ok(/"entities"/.test(IMP), '프롬프트에 entities 가 없다');
  assert.ok(/"comment_question"/.test(IMP), '프롬프트에 comment_question 이 없다');
  assert.ok(/entities: Array\.isArray\(parsed\.entities\)/.test(IMP), 'entities 파싱이 없다');
  assert.ok(/comment_question: String\(parsed\.comment_question/.test(IMP), 'comment_question 파싱이 없다');
});

t('게시 실패한 건도 "올려" 로 다시 잡힌다', () => {
  /* 2026-08-23: 권한 부족으로 실패하자 그 행이 publish_failed 로 굳었고,
     토큰을 고쳐도 "올려" 가 그 건을 못 집었다 (엉뚱한 옛 브리프가 잡혔다). */
  /* 2026-08-23 후보 집합이 CAND 변수로 이동 (웹 게시 분기) — 정의를 검사한다 */
  assert.ok(/\['done', 'publish_failed', 'web_published', 'web_publish_failed'\]/.test(WEBHOOK_CODE),
    '실패한 건을 재시도 대상에서 빠뜨렸다');
  assert.ok(/\.in\('status', CAND\)/.test(WEBHOOK_CODE), '후보 집합을 조회에 안 쓴다');
});

t('게시 실패 메시지가 할 일을 알려준다', () => {
  assert.ok(/function publishHint/.test(CRON_CODE), 'publishHint 가 없다');
  assert.ok(/instagram_content_publish/.test(CRON_CODE), '권한 오류 안내가 없다');
  assert.ok(/publishHint\(msg\)/.test(CRON_CODE), '실패 알림에 안내를 안 붙였다');
});

/* ─── 웹 전용 게시 "웹만" (도메니코 2026-08-23: 인사이트 걱정 없이 웹에만) ─── */

t('"웹만" 계열이 웹 게시 명령으로 파싱된다', () => {
  assert.deepStrictEqual(cb.parsePublishCommand('웹만'), { num: null, web: true });
  assert.deepStrictEqual(cb.parsePublishCommand('웹만 12'), { num: 12, web: true });
  assert.deepStrictEqual(cb.parsePublishCommand('웹에 올려'), { num: null, web: true });
  assert.deepStrictEqual(cb.parsePublishCommand('올려'), { num: null, web: false });
  assert.strictEqual(cb.parsePublishCommand('웹 보여줘'), false);
});

t('웹훅이 웹 게시를 web_queued 로 넘긴다 (직접 발행하지 않는다)', () => {
  assert.ok(/toWeb \? 'web_queued' : 'publish_queued'/.test(WEBHOOK_CODE), '웹 타깃 분기가 없다');
  assert.ok(/web_publish_failed/.test(WEBHOOK_CODE), '웹 실패 건 재시도 경로가 없다');
});

t('웹 게시가 sync-instagram 과 같은 재료를 쓴다 (기사 모양 한 벌)', () => {
  assert.ok(/runWebPublish/.test(CRON_CODE), '웹 게시 함수가 없다');
  assert.ok(/buildArticleRow\(post, gen, \{ status: 'published'/.test(CRON_CODE),
    'buildArticleRow 를 안 쓰면 기사 스키마가 갈라진다');
  assert.ok(/archiveImagesToStorage\(post, 10, 'celeb-web'\)/.test(CRON_CODE),
    'CDN 만료 대비 영구 보관이 없다');
});

t('웹 게시는 인스타 발행 코드를 부르지 않는다', () => {
  const start = CRON_CODE.indexOf('async function runWebPublish');
  const end = CRON_CODE.indexOf('async function runPublish');
  assert.ok(start >= 0 && end > start, '함수 경계를 못 찾았다');
  const body = CRON_CODE.slice(start, end);
  assert.ok(!/igPublish|publishReel|publishPhotos|addComment/.test(body),
    '웹 전용 경로에 인스타 발행이 섞였다');
});

t('브리프가 gen 전문을 보관한다 (웹 게시 때 검토본 그대로)', () => {
  assert.ok(/gen: \{\s*title_ko: gen\.title_ko/.test(CRON_CODE),
    'gen 미보관 — 웹 게시가 도메니코가 본 것과 다른 글을 만든다');
});

t('중복 웹 기사를 만들지 않는다 (source_instagram_post_id 선조회)', () => {
  assert.ok(/eq\('source_instagram_post_id', row\.shortcode\)/.test(CRON_CODE));
});

console.log('\n셀럽 속보 브리프: ' + n + '건 통과');
