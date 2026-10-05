/**
 * X → 인스타 유도 (2026-10-03, 도메니코 "전부 적용해줘")
 *
 * 실측: 지효 루부탱 트윗 2,972 뷰·349 좋아요·147 RT 에 답글 인스타 링크 클릭 8명.
 * 리트윗으로 퍼지는 건 영상이지 답글이 아니다. 그래서 세 가지:
 *   ① X 영상은 예고편(앞 7초) + 워터마크 + 엔드카드 @pap_magazine   (xTeaser)
 *   ② 영상 트윗 본문 마지막에 링크 없는 안내 줄                    (xPost.withIgHandle)
 *   ③ 같은 주제 연속 트윗은 창 안에 1건                              (xTopicGuard)
 * 이 파일은 그 셋이 제자리에 있는지와 순수 로직을 본다. ffmpeg 실행은
 * 여기서 안 한다(맥 바이너리는 리눅스 VM 에서 못 돈다) — 합성 영상으로
 * 한 번 실측했다(12초→7초, 6초는 안 자름, 카드 보임).
 */
'use strict';
delete process.env.ANTHROPIC_API_KEY;
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const teaser = require('../api/_lib/xTeaser');
const guard = require('../api/_lib/xTopicGuard');
const xPost = require('../api/_lib/xPost');

// ── ① 예고편 계획 ────────────────────────────────────────────
{
  const long = teaser.plan(32);
  t('긴 영상: 7초로 자르고 5.5초부터 카드', long.trimmed && long.outSeconds === 7 && long.cardAt === 5.5);
  const short = teaser.plan(8);
  t('짧은 영상(8초): 자르지 않고 끝 1.5초만 카드', !short.trimmed && short.outSeconds === null && short.cardAt === 6.5);
  const unknown = teaser.plan(null);
  t('길이 모름: 자르지 않고 카드도 없음(워터마크만)', !unknown.trimmed && unknown.outSeconds === null && unknown.cardAt === -1);
  const f = teaser.buildFilter(long);
  t('필터: 워터마크는 전 구간, 카드는 enable 식', /\[0:v\]\[wm\]overlay=0:0/.test(f) && /enable='gte\(t,5\.50\)'/.test(f));
  t('필터: 정지 PNG 에 fade 를 걸지 않는다(카드가 영영 투명해지는 실측 버그)', !/fade=/.test(f));
  const f2 = teaser.buildFilter(unknown);
  t('카드 없는 필터는 입력 2개로 끝난다', !/\[2:v\]/.test(f2) && /\[v\]$/.test(f2));
  process.env.X_TEASER = 'off';
  t('X_TEASER=off 면 꺼진다', teaser.isEnabled() === false);
  delete process.env.X_TEASER;
  t('기본은 켜짐', teaser.isEnabled() === true);
  process.env.X_TEASER_SECONDS = '99';
  t('X_TEASER_SECONDS 범위 밖이면 기본 7', teaser.teaserSeconds() === 7);
  process.env.X_TEASER_SECONDS = '10';
  t('X_TEASER_SECONDS=10 반영', teaser.teaserSeconds() === 10);
  delete process.env.X_TEASER_SECONDS;
}

// ── ① mp4 길이 읽기 (mvhd) — mp4-mute.test 와 같은 최소 박스 ─────
{
  const box = (type, payload) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + payload.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, payload]); };
  const mvhd = (timescale, duration) => { const b = Buffer.alloc(100); b.writeUInt32BE(timescale, 12); b.writeUInt32BE(duration, 16); return box('mvhd', b); };
  const mp4 = Buffer.concat([box('ftyp', Buffer.from('isom0000', 'latin1')), box('moov', mvhd(1000, 12000)), box('mdat', Buffer.alloc(16))]);
  t('mvhd 에서 길이 12초', teaser.mp4Duration(mp4) === 12);
  t('moov 없으면 null', teaser.mp4Duration(Buffer.from('garbage')) === null);
}

// ── ② 본문 안내 줄 ───────────────────────────────────────────
{
  const body = '지효가 크리스찬 루부탱 파리 쇼에 다녀왔어요\n\n본문.\n\n#PAPMAGAZINE';
  const v = xPost.withIgHandle(body, 'video');
  t('영상이면 태그 줄 앞에 안내 줄', v === '지효가 크리스찬 루부탱 파리 쇼에 다녀왔어요\n\n본문.\n\n풀 영상은 인스타 pap_magazine\n\n#PAPMAGAZINE');
  t('안내 줄에 @ 가 없다(X 멘션으로 엉뚱한 계정에 걸리지 않게)', !/@/.test(xPost.IG_HANDLE_LINE) && /pap_magazine/.test(xPost.IG_HANDLE_LINE));
  t('안내 줄에 링크가 없다(도달 억제 회피)', !/https?:\/\//.test(xPost.IG_HANDLE_LINE));
  t('이미지 트윗은 그대로', xPost.withIgHandle(body, 'image') === body);
  t('두 번 넣지 않는다', xPost.withIgHandle(v, 'video') === v);
  const near = '가'.repeat(124) + '\n\n#PAPMAGAZINE';            // 248+2+12 = 262: 끼우면 293(초과), 태그 자리에 넣으면 279(통과)
  t('넘치면 태그 줄 자리에 안내 줄(브랜드는 pap_magazine 으로 남는다)', xPost.withIgHandle(near, 'video') === '가'.repeat(124) + '\n\n' + xPost.IG_HANDLE_LINE);
  const fat = '가'.repeat(135) + '\n\n#PAPMAGAZINE';            // 270+14: 어느 쪽도 안 들어간다
  t('그래도 넘치면 안 넣는다(트윗을 잃지 않는다)', xPost.withIgHandle(fat, 'video') === fat);
  const hook = require('../api/_lib/socialHook');
  t('X 글자수 상한 115 (가중 280 - 태그 - 안내 줄 역산)', hook._limitFor ? hook._limitFor('x') === 115 : /\(platform === 'x' \|\| platform === 'threads'\) \? 115 : 420/.test(fs.readFileSync(path.join(ROOT, 'api/_lib/socialHook.js'), 'utf8')));
}

// ── ③ 주제 가드 순수 로직 ────────────────────────────────────
{
  const a = ['jihyo', 'twice', 'christian louboutin', 'paris fashion week', 'kpop', 'leather jacket'];
  const b = ['Jihyo', 'TWICE', 'christian louboutin', 'paris fashion week', 'ss27', 'kpop fashion'];
  const c = ['hyunjin', 'stray kids', 'dior', 'paris fashion week', 'kpop fashion'];
  t('앞 3개 태그가 지문', JSON.stringify(guard.tagKey(a)) === JSON.stringify(['jihyo', 'twice', 'christian louboutin']));
  t('같은 사람·같은 쇼 → 겹침', guard.overlaps(guard.tagKey(a), guard.tagKey(b)));
  t('다른 사람·다른 브랜드, 같은 패션위크 → 안 겹침(범용 태그 제외)', !guard.overlaps(guard.tagKey(a), guard.tagKey(c)));
  t('범용 태그만 있는 기사는 지문이 비어 비교 자체를 안 한다', guard.tagKey(['kpop', 'fashion show', 'paris']).length === 0);
  // DB 주입 — 창 안에 같은 주제가 있으면 clash
  const fakeDb = (xrows, arts) => ({
    from(table) {
      const chain = { _t: table };
      const self = () => chain;
      ['select', 'eq', 'is', 'not', 'gte', 'order', 'limit', 'in'].forEach((m) => { chain[m] = self; });
      chain.then = (res) => res({ data: table === 'x_posts' ? xrows : arts });
      return chain;
    },
  });
  (async () => {
    const r1 = await guard.recentClash(a, { db: fakeDb([{ article_id: 1 }], [{ id: 1, slug: 'jihyo-louboutin', tags: b }]) });
    t('창 안 같은 주제 → clash', r1.clash === true && r1.with === 'jihyo-louboutin');
    const r2 = await guard.recentClash(a, { db: fakeDb([{ article_id: 2 }], [{ id: 2, slug: 'hyunjin-dior', tags: c }]) });
    t('창 안 다른 주제 → 통과', r2.clash === false);
    const r3 = await guard.recentClash(a, { db: fakeDb([], []) });
    t('창 안 트윗 없음 → 통과', r3.clash === false);
    const r4 = await guard.recentClash(a, { db: { from() { throw new Error('db down'); } } });
    t('조회 실패 → 막지 않는다', r4.clash === false);

    // ── 배선 — sync-instagram 이 셋을 실제로 쓰는가 ────────────
    const sync = fs.readFileSync(path.join(ROOT, 'api/cron/sync-instagram.js'), 'utf8');
    t('sync-instagram: 미디어 업로드에 teaser 옵션', /uploadArticleMedia\(row, \{\}, \{ teaser: true \}\)/.test(sync));
    t('sync-instagram: 본문에 withIgHandle', /withIgHandle\(gen\.body, xMedia\.kind\)/.test(sync));
    t('sync-instagram: 주제 가드 호출', /recentClash\(generated\.tags\)/.test(sync));
    t('sync-instagram: postTweet 에 articleId(가드의 지문 재료)', (sync.match(/articleId: inserted\.id/g) || []).length >= 2);
    const xp = fs.readFileSync(path.join(ROOT, 'api/_lib/xPost.js'), 'utf8');
    t('xPost: 영상이면 makeTeaser 를 거친다', /opts\.teaser/.test(xp) && /makeTeaser\(buf\)/.test(xp));
    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const fn = vj.functions['api/cron/sync-instagram.js'] || {};
    t('vercel.json: sync-instagram 에 폰트 자산 포함(엔드카드 글자)', /_assets\/celeb/.test(String(fn.includeFiles || '')));
    t('vercel.json: sync-instagram maxDuration 유지(120)', fn.maxDuration === 120);
    const pv = fs.readFileSync(path.join(ROOT, 'api/_lib/papVoice.js'), 'utf8');
    t('X_VOICE: 마지막 문장은 다섯 꼴로만, 안내 줄은 모델이 쓰지 않음', /네 꼴 중 하나로 끝낸다/.test(pv) && !/지금 만나보세요/.test(require('../api/_lib/papVoice').X_VOICE) && /안내 줄은 쓰지 않는다. 코드가 붙인다/.test(pv));

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  })();
}
