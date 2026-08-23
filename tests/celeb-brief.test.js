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

t('여러 게시물 이미지를 보낸 순서대로 나열하고 10장에서 자른다', () => {
  const a = Array.from({ length: 7 }, (_, i) => 'https://cdn/a' + i + '.jpg');
  const b = Array.from({ length: 7 }, (_, i) => 'https://cdn/b' + i + '.jpg');
  const merged = cb.mergeMediaUrls([a, b]);
  assert.strictEqual(merged.length, 10, '인스타 캐러셀 상한');
  assert.strictEqual(merged[0], 'https://cdn/a0.jpg');
  assert.strictEqual(merged[7], 'https://cdn/b0.jpg');
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
t('캡션은 제목·본문·태그·출처 순서로 만든다', () => {
  const c = cb.buildBriefCaption({
    title: '제목', body: '본문', tags: ['제니', '#블랙핑크'],
    sourceHandle: '@jennierubyjane', permalink: 'https://www.instagram.com/p/A1/',
  });
  const parts = c.split('\n\n');
  assert.strictEqual(parts[0], '제목');
  assert.strictEqual(parts[1], '본문');
  assert.strictEqual(parts[2], '#제니 #블랙핑크', '태그에 # 를 중복으로 붙이면 안 된다');
  assert.ok(parts[3].includes('출처 @jennierubyjane'));
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
const CRON = fs.readFileSync(path.join(__dirname, '..', 'api/cron/celeb-brief.js'), 'utf8');
const CRON_CODE = CRON.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const VERCEL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

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
  assert.ok(/renderThumb\(first,/.test(CRON_CODE), '첫 장에 디자인을 안 입힌다');
  const renderCalls = (CRON_CODE.match(/renderThumb\(/g) || []).length;
  assert.strictEqual(renderCalls, 1, '도메니코 규칙: 썸네일만 디자인, 나머지는 아무 디자인도 안 입힌다');
  assert.ok(/mediaUrls\.slice\(1\)/.test(CRON_CODE), '2장부터는 원본을 그대로 받아야 한다');
});

t('발행하지 않는다 — DB 기사 INSERT 도, 인스타 게시도 없다', () => {
  assert.ok(!/from\('articles'\)[\s\S]{0,80}\.insert/.test(CRON_CODE), '기사를 DB 에 넣으면 안 된다 (발행 판단은 도메니코)');
  assert.ok(!/media_publish/.test(CRON_CODE), '인스타 게시는 도메니코가 직접 한다');
});

t('링크를 나눠 보내도 한 브리프로 합친다', () => {
  assert.ok(/BATCH_WINDOW_MS/.test(CRON_CODE), '메시지가 갈리면 기사도 갈린다');
  assert.ok(/r\.chat_id === head0\.chat_id/.test(CRON_CODE), '같은 채팅 기준으로 묶어야 한다');
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

t('깨우기는 응답을 끝까지 기다리지 않는다 (재전송 방지)', () => {
  assert.ok(/AbortSignal\.timeout\(WAKE_TIMEOUT_MS\)/.test(WEBHOOK_CODE), '타임아웃이 없으면 텔레그램이 재전송한다');
  assert.ok(/TimeoutError' \|\| name === 'AbortError'/.test(WEBHOOK_CODE), '타임아웃을 실패로 보면 안 된다 — 요청은 이미 나갔다');
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

console.log('\n셀럽 속보 브리프: ' + n + '건 통과');
