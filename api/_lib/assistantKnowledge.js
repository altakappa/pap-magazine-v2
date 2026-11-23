/**
 * 상담봇이 근거로 쓰는 것 — 사실 카드 + 안내문 + 콘텐츠 조회 (2026-11-23)
 *
 * ■ 왜 숫자를 따로 두나
 * 이 봇은 "뭐든 물어보면 답하는" 봇이다(도메니코 결정). 범위는 넓어도 되지만
 * **숫자는 지어내면 안 된다** — €380·€790·구독가·무료 게재 조건은 우리 이름으로
 * 하는 약속이다. 그래서 숫자는 검색해서 찾아 쓰게 두지 않고 FACTS 에 고정해
 * 매번 그대로 넣는다. 모델이 고를 여지를 없앤다.
 *
 * ■ 그리고 이 파일은 '다섯 번째 가격표' 가 되면 안 된다
 * 저장소에 구독가 단일 상수 파일은 없다. €5.49 같은 리터럴이 subscribe·auth·
 * magazine·pap-i18n 에 흩어져 있고, tests/subscription-price-single-source.test.js
 * 가 "전부 같은가" 를 정규식으로 지킨다. 여기에 가격을 또 적으면 장소가 하나 더
 * 느는 것이므로, **그 테스트에 이 파일을 함께 넣었다**(6절). 가격을 바꾸면서
 * 봇을 빠뜨리면 하네스가 빨개진다. 이번 주에 고친 사고들이 전부 이 모양이었다 —
 * 미디어키트 링크(두 곳), 업로드 꼬리표(두 곳), 캐시버스트(열 곳).
 *
 * ■ 고칠 수 있게 둔다
 * 운영 중 문구를 바꿀 일이 생기면 site_settings.assistant_knowledge 로 덮어쓴다
 * (어드민 → /api/settings). DB 값이 없으면 아래 코드가 쓰인다. 값이 깨져 있으면
 * 조용히 코드로 돌아간다 — 설정 하나 잘못 저장했다고 봇이 벙어리가 되면 안 된다.
 */

'use strict';

/* ── 사실 카드 ──────────────────────────────────────────────────────────
   여기 있는 숫자만 답에 쓸 수 있다. 바꿀 때는 price-single-source 테스트가
   가리키는 다른 파일들도 같이 바꿔야 한다. */
const FACTS = {
  membership: {
    standardMonthly: '€5.49',
    standardYearly: '€54.90',
    premiumMonthly: '€8.99',
    premiumYearly: '€89.90',
    yearlyNote: '연간은 월간 × 10 — 두 달이 무료인 셈이다.',
    currency: 'EUR 하나뿐이다. PayPal 은 플랜당 통화가 하나라 현지 통화가 없다.',
  },
  editorial: {
    freeRule: '패션 에디토리얼은 룩 3개 이상 + 서로 다른 의상 브랜드 3종 이상이면 무료 게재.',
    beautyRule: '뷰티 에디토리얼은 룩·브랜드 요건이 없고 무료 게재.',
    paidBelow: '€380',
    branded: '€790',
    chargeTiming: '게재가 확정된 경우에만 청구한다. 거절되면 비용은 0이다.',
    waiver: '연간 프리미엄 회원은 구독 1년당 €380 건 하나가 면제된다(브랜디드 €790 은 제외).',
    images: '전체 6장 이상. JPG 권장(가장 긴 변 2000px, 1600×2000 권장).',
    language: '제목·작가노트·크레딧 등 제출 내용은 영어로 적는다.',
  },
  article: {
    fee: '무료로 제출하고 무료로 게재된다.',
    promo: '홍보성 글만 브랜디드로 보고 €790 이 적용된다. 판정은 심사 뒤에 하며, 제출 시점에는 아무것도 청구되지 않는다.',
    length: '영어 800단어 이상 또는 한국어 1,600자 이상.',
    images: '대표 이미지 1장 + 본문 이미지 최대 9장. JPG·PNG·WebP, 장당 25MB 이내.',
    language: '영어 또는 한국어로 쓴다.',
  },
  tip: {
    fee: '비용도 사례금도 없다.',
    reward: '채택되면 기사에 크레딧이 들어가고 PAP 프리미엄 1개월이 제공된다.',
    rule: '본인이 직접 목격하고 촬영한 사진·영상만 받는다. 퍼온 영상은 제보가 아니다.',
    purge: '보낸 파일은 도착 7일 뒤 삭제된다. 채택되면 그 전에 기사용 사본을 남긴다.',
  },
  review: {
    normal: '최대 7영업일',
    premium: '프리미엄 회원은 2영업일 이내',
    publish: '승인 뒤 게재까지 2~3주',
  },
  perks: {
    languages: '게재물은 웹사이트에 9개 언어로 실린다.',
    instagram: '@pap_magazine (38만 명 이상)에 팀 크레딧과 함께 올라간다.',
    pick: '이달의 에디터스 픽에 선정되면 한 달간 홈 상단에 걸린다.',
    collaborators: '연간 프리미엄 제출자는 인스타그램 공동작업자를 최대 5명까지 지정할 수 있다.',
    pullLetter: '프리미엄 회원은 월 1회 PAP 풀레터(샘플 대여·협조 요청 공문)를 신청할 수 있다.',
  },
  about: {
    who: 'PAP 매거진은 서울에서 발행하는 아트 기반 패션·뷰티·컬쳐 매거진이고, 밀라노에 데스크를 두고 있다.',
    tracks: '제출 경로는 셋이다 — 에디토리얼(완성된 화보), 아티클(긴 글), 제보(직접 촬영한 특종).',
    advertising: '광고·협업 단가는 미디어키트에 있다.',
  },
  links: {
    submissions: '/submissions',
    editorial: '/submission/editorial',
    article: '/submission/article',
    tip: '/submission/tip',
    subscribe: '/subscribe',
    mediakit: '/mediakit',
    business: '/business',
    contact: '/contact',
    email: 'contact@pap-magazine.com',
  },
};

/** 사실 카드를 모델에게 줄 평문으로 편다. 숫자는 여기서만 나온다. */
function factSheet(f) {
  const m = f.membership, e = f.editorial, a = f.article, t = f.tip, r = f.review, p = f.perks, b = f.about, L = f.links;
  return [
    '[PAP 사실 카드 — 아래 숫자와 규칙만 사용할 것. 여기 없는 수치는 "모른다"고 답할 것]',
    '',
    '◆ PAP', b.who, b.tracks,
    '',
    '◆ 멤버십 (통화: ' + m.currency + ')',
    '스탠다드 월간 ' + m.standardMonthly + ' · 스탠다드 연간 ' + m.standardYearly,
    '프리미엄 월간 ' + m.premiumMonthly + ' · 프리미엄 연간 ' + m.premiumYearly,
    m.yearlyNote,
    '',
    '◆ 에디토리얼 제출',
    e.freeRule, e.beautyRule,
    '요건에 못 미치는 패션 에디토리얼은 유료 심사 ' + e.paidBelow + '.',
    '한 브랜드를 알리는 성격이면 브랜디드 ' + e.branded + '.',
    e.chargeTiming, e.waiver, e.images, e.language,
    '',
    '◆ 아티클 기고',
    a.fee, a.promo, a.length, a.images, a.language,
    '',
    '◆ 제보',
    t.rule, t.fee, t.reward, t.purge,
    '',
    '◆ 심사·게재',
    '심사 ' + r.normal + ' (' + r.premium + '). ' + r.publish + '.',
    '',
    '◆ 게재되면',
    p.languages, p.instagram, p.pick, p.collaborators, p.pullLetter,
    '',
    '◆ 광고', b.advertising, '미디어키트: ' + L.mediakit + ' · 비즈니스 안내: ' + L.business,
    '',
    '◆ 링크',
    '제출 안내 ' + L.submissions + ' · 에디토리얼 ' + L.editorial + ' · 아티클 ' + L.article + ' · 제보 ' + L.tip,
    '멤버십 ' + L.subscribe + ' · 문의 ' + L.contact + ' (' + L.email + ')',
  ].join('\n');
}

/** site_settings 덮어쓰기를 읽는다. 없거나 깨졌으면 코드 값으로 돌아간다. */
async function loadKnowledge(db) {
  let facts = FACTS;
  let extra = '';
  try {
    const { data } = await db.from('site_settings')
      .select('value').eq('key', 'assistant_knowledge').maybeSingle();
    const v = data && data.value;
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    if (parsed && typeof parsed === 'object') {
      /* 깊은 병합은 하지 않는다 — 부분 덮어쓰기가 섞이면 어느 숫자가 살아 있는지
         아무도 모르게 된다. 섹션 통째로만 갈아 끼운다. */
      for (const k of Object.keys(FACTS)) {
        if (parsed[k] && typeof parsed[k] === 'object') {
          facts = Object.assign({}, facts, { [k]: parsed[k] });
        }
      }
      if (typeof parsed.extra === 'string') extra = parsed.extra.slice(0, 4000);
    }
  } catch (e) {
    console.warn('[assistant] 지식 설정을 읽지 못해 코드 값을 쓴다:', e && e.message);
  }
  return { facts, sheet: factSheet(facts) + (extra ? '\n\n◆ 추가 안내\n' + extra : '') };
}

/* ── 기사·에디토리얼 찾기 ────────────────────────────────────────────────
   임베딩을 쓰지 않는다. OpenAI 크레딧이 11/02 부터 죽어 있고, 그걸 기다릴
   이유가 없다. 제목 부분일치만으로도 "그 기사 있어요?" 는 답할 수 있다.
   크레딧이 돌아오면 이 함수만 의미 검색으로 갈아 끼우면 된다. */

const STOP = new Set(['about', 'have', 'has', 'does', 'did', 'what', 'when', 'where', 'which',
  'your', 'you', 'with', 'the', 'any', 'are', 'can', 'for', 'from', 'that', 'this', 'their',
  'article', 'articles', 'editorial', 'editorials', 'magazine', 'please', 'there', 'tell', 'show',
  'read', 'find', 'write', 'written', 'published', 'publish', 'story', 'stories', 'piece',
  '기사', '에디토리얼', '매거진', '있나요', '있어요', '있는지', '알려줘', '알려주세요', '관련',
  '대한', '대해', '무엇', '어떤', '혹시', '그리고', '보여줘', '찾아줘']);

/* 라틴 문자는 3자 이상만 받는다. ILIKE 는 **부분일치**라 'do' 를 넣으면 %do% 가
   London·Dolce·Window 를 전부 긁어 온다. 두 글자로도 뜻이 서는 한글·CJK 는 2자부터.
   (실측: 'do you have articles about quiet luxury' 에서 do·you 가 그대로 통과했다) */
function longEnough(tok) {
  if (/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(tok)) return tok.length >= 2;
  return tok.length >= 3;
}

function keywords(q, max) {
  const toks = String(q || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => longEnough(s) && !STOP.has(s.toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const t of toks) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= (max || 4)) break;
  }
  return out;
}

/** 제목에 키워드가 들어간 발행물을 찾는다. 못 찾으면 빈 배열 — 지어내지 않는다.
 *
 *  2026-11-23 실측으로 고침: 처음엔 title 만 봤는데 `title` 은 **한국어 정본**이다.
 *  'luxury' 로 세어 보니 title 0건 · title_en 19건이었다(발행 3,485편 전부 title_en
 *  보유). 영어로 물으면 기사를 영영 못 찾는 상태였다. slug 도 함께 본다 — 영문
 *  슬러그가 사실상 또 하나의 영어 제목이라 브랜드명이 잘 걸린다.
 *  답에 보여줄 제목은 묻는 사람의 언어에 맞춘다 — 한국어로 물었는데 영어 제목을
 *  돌려주면 그 자체로 틀린 답처럼 보인다. */
async function findContent(db, question, limit, lang) {
  const words = keywords(question, 4);
  if (!words.length) return [];
  const pat = words.map((w) => '%' + w.replace(/[%_,()]/g, '') + '%').filter((p) => p.length > 2);
  if (!pat.length) return [];
  const ko = String(lang || '') === 'ko';
  const orFor = (cols) => cols.flatMap((c) => pat.map((p) => c + '.ilike.' + p)).join(',');

  async function look(table, cols, prefix, take) {
    try {
      const { data } = await db.from(table)
        .select('title, title_en, slug')
        .eq('status', 'published')
        .or(orFor(cols))
        .limit(take);
      return (data || [])
        .filter((r) => r && r.slug)
        .map((r) => ({
          kind: table === 'articles' ? 'article' : 'editorial',
          title: (ko ? (r.title || r.title_en) : (r.title_en || r.title)) || r.slug,
          url: prefix + r.slug,
        }));
    } catch (_) {
      return [];   /* 조회 실패가 답변 자체를 막을 이유는 없다 */
    }
  }

  const cols = ['title', 'title_en', 'slug'];
  const arts = await look('articles', cols, '/article/', (limit || 8));
  const eds = await look('editorials', cols, '/editorial/', 4);
  return arts.concat(eds).slice(0, limit || 8);
}

module.exports = { FACTS, factSheet, loadKnowledge, findContent, keywords };
