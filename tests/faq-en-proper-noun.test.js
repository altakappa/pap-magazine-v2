'use strict';
/**
 * 영문 FAQ 번역의 고유명사 치환 방지 (2026-10-30)
 *
 * 사고: 한국어 FAQ 는 정확한데 영문에서 다른 실존 대상으로 바뀌어 발행됐다.
 *   마뗑킴 → Maison Margiela · 비제로원 → Serpenti Viper · 롤로 주아이 → Rolo Tomassi
 * 실제 발행된 문장: "Maison Margiela is a fashion brand launched in Seoul in 2011
 * by designer Kim Mateng." 한글 음차를 '원래 철자로' 되돌리라는 지시만 있으니
 * 모델이 비슷하게 들리는 유명 브랜드로 매핑한 것이다.
 * 방어는 두 겹이다 — (1) 모르면 음차 그대로, (2) 이미 영어로 발행된 제목을
 * 정답 표기로 함께 넘긴다. 둘 다 사라지지 않게 지킨다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

const src = R('api/_lib/faqEnBackfill.js');

t('한글 음차를 다른 유명 이름으로 바꾸지 말라고 명시한다',
  /never swap in a different, better-known name/.test(src));
t('실제로 나갔던 세 건을 반례로 박아둔다',
  /마뗑킴 is Matin Kim \(NOT Maison Margiela\)/.test(src) &&
  /비제로원 is B\.zero1 \(NOT Serpenti Viper\)/.test(src) &&
  /롤로 주아이 is Lolo Zouai \(NOT Rolo Tomassi\)/.test(src));
t('확신이 없으면 음차 그대로 두는 쪽이 안전하다고 지시한다',
  /not certain which real-world entity/.test(src) &&
  /transliterate it phonetically and leave it there/.test(src));
t('기존 규칙(원래 철자 유지·없는 사실 추가 금지)도 남아 있다',
  /Keep person names, brand names, agency names and @handles in their original spelling\./.test(src) &&
  /Do not add facts that are not in the Korean source\./.test(src));

t('정답지: 영문 제목을 조회 열에 넣는다',
  /\.select\('id, faq, title_en'\)/.test(src));
t('정답지: 영문 제목을 배치 payload 로 넘긴다',
  /out\.push\(\{ id: r\.id, faq: f, en_title: r\.title_en \|\| '' \}\)/.test(src));
t('프롬프트가 en_title 이 무엇인지 설명하고 그대로 쓰라고 한다',
  /"en_title" is this item title as already published in English/.test(src) &&
  /canonical English spelling — reuse it exactly/.test(src));

/* buildPrompt 는 순수 함수다 — payload 만 받는다. 실제로 en_title 이 프롬프트
   문자열에 실려 나가는지 호출해서 확인한다(정규식만으로는 못 잡는다).
   단, 이 모듈은 _lib/supabase.js 를 끌고 오고 그건 로컬에서 env 가 없어
   'supabaseUrl is required.' 로 죽는다. 가짜 모듈을 require.cache 에 먼저 꽂는다. */
const Module = require('module');
function inject(filePath, exports) {
  const m = new Module(filePath, null);
  m.filename = filePath; m.loaded = true; m.exports = exports;
  require.cache[filePath] = m;
}
inject(require.resolve('../api/_lib/supabase.js'), { supabaseAdmin: {} });
const { buildPrompt } = require('../api/_lib/faqEnBackfill');
const prompt = buildPrompt([{ id: 'x', faq: [{ q: '마뗑킴은 어떤 브랜드인가요?', a: '마뗑킴은 서울 브랜드입니다.' }], en_title: "Momo's Winter Cafe Look, Styled in Matin Kim" }]);
t('완성된 프롬프트에 영문 제목이 실제로 들어간다', /Matin Kim/.test(prompt));
t('완성된 프롬프트에 치환 금지 규칙이 실제로 들어간다', /NOT Maison Margiela/.test(prompt));
t('JSONL 출력 계약은 그대로다', /Output one JSON object per line \(JSONL\)/.test(prompt));

t('테스트 스크립트 등록', /faq-en-proper-noun\.test\.js/.test(R('package.json')));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
