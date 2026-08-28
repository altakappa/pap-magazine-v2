/**
 * AI 답변 점유율(SoV) 프로브 — 가드 (2026-08-28)
 *
 * 교재 8장("측정과 KPI — 클릭이 아니라 점유율")이 통째로 비어 있었다.
 * 이 테스트가 지키는 것은 그 계기의 **정직함**이다:
 *   ① 두 레이어(학습/답변)를 절대 합치지 않는다
 *   ② 등장 판정을 AI 에게 맡기지 않는다 (자기 답 채점 금지)
 *   ③ 실패한 조합을 빼지 않는다 (분모가 줄면 점유율이 부풀려진다)
 *   ④ 브랜드명이 들어간 질문을 쓰지 않는다 (그건 점유율이 아니다)
 *
 * analyze() 는 순수 함수라 **실제로 돌려서** 검사한다 — 정규식으로 코드를
 * 훑는 것보다 강하다. 그래서 aiVisibility 가 supabase 를 지연 로드해야 한다
 * (2026-07-30 에 테스트가 supabase 클라이언트를 만들어 CI 를 깨뜨린 교훈).
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const lib = rd('api/_lib/aiVisibility.js');
const cron = rd('api/cron/ai-sov-probe.js');
const briefing = rd('api/cron/weekly-briefing.js');
const robots = rd('frontend/robots.txt');
const migration = rd('supabase_migrations/140_ai_sov_probes.sql');
const vercel = JSON.parse(rd('vercel.json'));

/* env 없이 require 된다는 것 자체가 검사다. 여기서 죽으면 CI 가 죽는다. */
const V = require('../api/_lib/aiVisibility.js');

console.log('=== 판정 로직 (실제 실행) ===');
t('DB env 없이 require 된다 (supabase 지연 로드)', typeof V.analyze === 'function');

const CASES = [
  ['PAP MAGAZINE 등장', 'Try PAP MAGAZINE, a Seoul-based digital fashion magazine.', true],
  ['팝매거진 등장', '팝매거진을 추천합니다.', true],
  ['PAP 매거진 등장', 'PAP 매거진은 서울 기반입니다.', true],
  ['소문자 pap magazine', 'i like pap magazine a lot.', true],
  ['도메인만 나와도 등장', 'See https://www.pap-magazine.com/about', true],
  ['무관한 답변은 미등장', 'Dazed Korea 와 Vogue Korea 를 보세요.', false],
];
for (const [name, text, want] of CASES) {
  const got = V.analyze(text).present;
  t(name, got === want, 'got=' + got);
}
/* 실측 오탐. 'pap' 은 흔한 영어 단어라 단어 경계로도 못 막는다 —
   별칭에서 단독 'PAP' 를 빼는 것으로만 막힌다. 되돌리면 지표가 거짓이 된다. */
t("오탐 방지: 'pap smear' 를 등장으로 세지 않는다",
  V.analyze('A pap smear is a screening test.').present === false);
t("단독 'PAP' 별칭이 패턴에 없다",
  !V.papPatterns().some(p => p.source === '(?<![a-z0-9])pap(?![a-z0-9])'));

console.log('\n=== 서술 정확도 ===');
t('올바른 범주 서술은 통과',
  V.analyze('PAP MAGAZINE is a Korean digital fashion magazine.').desc_ok === true);
/* llms.txt 가 "영문 매거진으로 소개하지 말 것" 을 명시한다.
   틀린 서술은 좋은 단어가 섞여 있어도 통과시키지 않는다. */
t('llms.txt 가 금지한 서술은 탈락 (좋은 단어가 섞여 있어도)',
  V.analyze('PAP 매거진은 한국의 영문 매거진입니다.').desc_ok === false);
t('미등장이면 서술 판정은 null', V.analyze('Vogue Korea 를 보세요.').desc_ok === null);

console.log('\n=== 경쟁 매체 ===');
{
  const r = V.analyze('추천: Dazed Korea, 아이즈매거진, Vogue Korea').rivals;
  t('표기 흔들림을 흡수해 매체를 집는다',
    r.includes('Dazed Korea') && r.includes('eyesmag') && r.includes('Vogue Korea'), r.join(','));
}

console.log('\n=== 질문 세트 ===');
/* 교재 8장: "브랜드명이 들어가지 않은 카테고리 질문 5개를 선정한다."
   PAP 이름을 넣으면 "PAP 를 아느냐" 를 재는 것이고 그건 점유율이 아니다. */
t('질문에 브랜드명이 없다',
  V.PROBES.every(p => !/pap|팝매거진|매거진pap/i.test(p.q)),
  V.PROBES.filter(p => /pap/i.test(p.q)).map(p => p.key).join(','));
t('ko·en 을 모두 포함 (인용 언어 실측이 ko 42 / en 41 로 동률)',
  V.PROBES.some(p => p.lang === 'ko') && V.PROBES.some(p => p.lang === 'en'));
t('question_key 가 전부 고유 (추이가 이어지려면)',
  new Set(V.PROBES.map(p => p.key)).size === V.PROBES.length);
t('교재 권장(5개) 이상', V.PROBES.length >= 5);

console.log('\n=== 두 레이어를 합치지 않는다 ===');
t('모드가 pretrain·search 둘', V.MODES.length === 2
  && V.MODES.includes('pretrain') && V.MODES.includes('search'));
t('마이그레이션이 mode 를 행마다 기록', /mode\s+text not null/.test(migration));
/* 합계를 내면 둘 다 의미를 잃는다 (크롤과 유입을 안 더하는 것과 같은 이유). */
t('리포트가 레이어를 따로 낸다 (합산 금지)',
  /pretrain: layer\('pretrain'\)/.test(lib) && /search: layer\('search'\)/.test(lib));
t('표 문구가 합산 금지를 명시', /절대 합산 금지|더하지 않는다/.test(lib));

console.log('\n=== 정직한 집계 ===');
/* 실패를 빼면 분모가 조용히 줄어 점유율이 부풀려진다. */
t('실패 조합도 행으로 남긴다 (present=null)',
  /present: null[\s\S]{0,200}error: String/.test(lib));
t('집계 분모에서 present=null 을 뺀다 (실패를 미등장으로 세지 않는다)',
  /r\.present !== null/.test(lib));
t('시간이 부족하면 부르지 않고 건너뛴다 (돈만 쓰고 데이터 없는 콜 금지)',
  /deadline - 15000/.test(lib) && /skipped\.push/.test(lib));
t('키 없는 엔진은 호출하지 않는다', /engines\.filter\(engineReady\)/.test(lib));
t('쓸 엔진이 하나도 없으면 503 (조용한 0건 금지)', /statusCode = 503/.test(lib));
/* 웹검색 도구 이름이 모델·시점마다 갈리는데 로컬에 OpenAI 키가 없어 확인을
   못 했다. 틀린 이름을 고르면 chatgpt/search 8칸이 매주 통째로 빈다. */
t('OpenAI 웹검색 도구 이름을 두 가지로 시도한다 (첫 회차부터 데이터가 남게)',
  /OPENAI_SEARCH_TOOLS = \['web_search', 'web_search_preview'\]/.test(lib));
t('400 이 아니면 재시도하지 않는다 (401·429·5xx 를 헛되이 두 번 부르지 않는다)',
  /res\.status !== 400\) break/.test(lib));
/* 서버 도구는 실패해도 예외를 안 던진다 — HTTP 200 에 에러 객체가 온다.
   검색이 안 돌았는데 search 로 세면 학습 레이어 답을 답변 레이어 칸에 넣는
   것이고, 그러면 두 레이어를 나눈 의미가 통째로 사라진다. */
t('검색이 실제로 돌았는지 응답에서 확인한다',
  /web_search_tool_result' && Array\.isArray\(b\.content\)/.test(lib)
  && /web_search\/\.test\(item\.type\)/.test(lib));
t('검색이 안 돌았으면 답변 레이어로 세지 않는다 (판정 불가로 남김)',
  /mode === 'search' && !searched/.test(lib) && /웹검색 미실행/.test(lib));
/* 최신 web_search 도구는 Sonnet 4.6+/Opus 4.6+ 전용이다. 저장소 공용
   ANTHROPIC_MODEL(기본 claude-sonnet-4-5)로는 못 쓴다 — 프로브는 자기 모델을 쓴다. */
t('프로브가 공용 ANTHROPIC_MODEL 에 묶이지 않는다',
  /SOV_ANTHROPIC_MODEL/.test(lib) && !/process\.env\.ANTHROPIC_MODEL/.test(lib));
t('Claude 웹검색 도구도 신·구 두 이름을 시도한다',
  /CLAUDE_SEARCH_TOOLS = \['web_search_20260209', 'web_search_20250305'\]/.test(lib));

console.log('\n=== 등장 판정을 AI 에게 맡기지 않는다 ===');
/* 모델에게 "내가 나왔니?" 를 물으면 자기 답을 채점하는 꼴이다. */
t('별칭은 seoRenderer 단일 소스를 재사용 (교훈 2 — 목록 두 벌 금지)',
  /require\('\.\/seoRenderer'\)/.test(lib) && /ORG_PUBLISHER\.alternateName/.test(lib));
t('별칭 목록을 이 파일에 다시 적지 않는다',
  !/팝매거진'/.test(lib.slice(lib.indexOf('function papPatterns'))));

console.log('\n=== 크론 배선 ===');
{
  const c = (vercel.crons || []).find(x => x.path === '/api/cron/ai-sov-probe');
  t('크론이 등록돼 있다', !!c, JSON.stringify(c));
  /* 주간이라 하루 환산 0.14회다. 일간이면 예산(2,600)에 못 들어간다. */
  t('주 1회다 (요일 고정)', !!c && /^\S+ \S+ \* \* \d$/.test(c.schedule), c && c.schedule);
  /* 브리핑이 이 표를 읽으므로 반드시 먼저 끝나야 한다. */
  const wb = (vercel.crons || []).find(x => x.path === '/api/cron/weekly-briefing');
  const min = s => Number(s.split(' ')[0]);
  t('주간 브리핑보다 먼저 돈다 (브리핑은 읽기만 한다)',
    !!c && !!wb && min(c.schedule) < min(wb.schedule),
    c && wb ? c.schedule + ' vs ' + wb.schedule : '');
  t('maxDuration 300 (32콜 + 웹검색은 120초에 안 들어간다)',
    ((vercel.functions || {})['api/cron/ai-sov-probe.js'] || {}).maxDuration === 300);
}
t('크론이 생산량을 cron_runs.note 에 남긴다 (돌았다 ≠ 했다)',
  /res\.locals\.cronNote = out\.note/.test(cron) && /'SoV '/.test(lib));
t('크론 이중 인증 (CRON_SECRET 또는 관리자)',
  /CRON_SECRET/.test(cron) && /requireAdmin/.test(cron));

console.log('\n=== 브리핑 배선 — 수집과 보고를 분리한다 ===');
t('브리핑은 읽기만 한다 (프로브를 돌리지 않는다)',
  /buildSovReport/.test(briefing) && !/runSovProbe/.test(briefing));
t('실패해도 브리핑 본체를 막지 않는다',
  /catch \(e\) \{ console\.warn\('\[weekly-briefing\] sov failed:/.test(briefing));
t('AI 서사가 죽어도 표는 나간다 (결정론 덧붙임)',
  /const sovMd = renderSovMd\(sov\)/.test(briefing));

console.log('\n=== GPTBot 차단 재검토 트리거 (#3) ===');
/* 차단의 장기 비용은 크롤 로그로는 영영 안 보인다. pretrain 레이어가
   그걸 재는 유일한 계기이고, 리포트가 스스로 재검토를 띄워야 한다. */
t('학습 레이어가 내려가면 리포트가 재검토를 띄운다',
  /학습 레이어가 내려갔다/.test(lib) && /두 회차 연속/.test(lib));
t('robots.txt 에 차단 후 실측이 기록돼 있다',
  /사후 실측/.test(robots) && /차단 후/.test(robots));
t('robots.txt 가 재검토 계기를 지목한다 (기억이 아니라 표로 판단)',
  /aiVisibility/.test(robots));
/* 이 블록이 지켜야 하는 것: live·index 는 계속 허용이다. */
t('live·index 봇에 이름 그룹을 만들지 않았다 (robots 규격 사고 방지)',
  !/User-agent: OAI-SearchBot/i.test(robots) && !/User-agent: ChatGPT-User/i.test(robots));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ ai-sov tests passed');
