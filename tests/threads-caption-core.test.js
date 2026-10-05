/**
 * 스레드 = X 뼈대의 반말판 (2026-10-03, 도메니코 "트위터 말투의 반말 버전을 스레드로")
 * → 2026-10-04 도메니코 "스레드에 말투가 퉁명한데 그냥 트위터랑 똑같은 말투로써줘".
 *   스레드도 X 와 같은 존댓말. 두 목소리는 papVoice.politeSocialVoice 한 함수에서 나온다.
 *
 * X 가 좋아진 건 뼈대(후킹 한 줄·고유명사·열거·사실 말하고 멈춤·넘기기·실캡션 예시)
 * 때문이다. 뼈대는 papVoice.CAPTION_CORE 한 곳에만 두고 X·스레드가 같이 쓴다.
 * 두 벌로 갈라지면 한쪽만 고쳐진다(2026-09-29 실측). 이 파일은 그 성질을 지킨다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const v = require('../api/_lib/papVoice');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

t('CAPTION_CORE 가 하나 있고 둘 다 그걸 품는다', typeof v.CAPTION_CORE === 'string' && v.SOCIAL_VOICE.includes(v.CAPTION_CORE) && v.X_VOICE.includes(v.CAPTION_CORE));
t('뼈대: 후킹 한 줄 다섯 패턴', /다섯 패턴 중 하나로만/.test(v.CAPTION_CORE));
t('뼈대: 고유명사·열거·사실 말하고 멈춤', /고유명사를 그대로 부른다/.test(v.CAPTION_CORE) && /열거\("A부터 B까지"\)는 재료가 있을 때 한 번/.test(v.CAPTION_CORE) && /사실을 말하고 멈춘다/.test(v.CAPTION_CORE));
t('뼈대: 느낌·평가로 끝내지 않는다, 사실로 끝나도 된다', /느낌이나 평가로 끝내지 않는다. 사실로 끝나도 된다/.test(v.CAPTION_CORE));
t('뼈대: 1~2문장 80자 (10/5 "간단명료")', /본문 1~2문장. 후킹 줄 포함 80자 안쪽/.test(v.CAPTION_CORE));
const src = fs.readFileSync(path.join(ROOT, 'api/_lib/papVoice.js'), 'utf8');
t('뼈대 문장이 파일에 한 번만 있다(복사본 없음)', (src.match(/고유명사를 그대로 부른다/g) || []).length === 1);

// 스레드 어미·호칭·모양 (2026-10-04 X 와 같은 존댓말)
t('스레드: 반말·존댓말 지시가 없다 (2026-10-05 평서체)', !/처음부터 끝까지 존댓말/.test(v.SOCIAL_VOICE) && !/처음부터 끝까지 반말/.test(v.SOCIAL_VOICE));
t('스레드: 넘기기 네 꼴 존댓말판 ("지금 만나보세요" 는 10/5 도메니코 지시로 제외)', /네 꼴 중 하나만 쓴다/.test(v.SOCIAL_VOICE) && /"꼭 한번 직접 보길." \/ "~일지도."/.test(v.SOCIAL_VOICE) && !/지금 만나보세요/.test(v.SOCIAL_VOICE));
t('스레드: 독자를 부르지 않는다 (평서체, 스치니들 없음)', /독자를 부르지 않는다/.test(v.SOCIAL_VOICE) && !/스치니들/.test(v.SOCIAL_VOICE));
t('스레드·X: 평서체 (2026-10-05)', /처음부터 끝까지 평서체/.test(v.SOCIAL_VOICE) && /처음부터 끝까지 평서체/.test(v.X_VOICE));
t('스레드: 퉁명함의 원인이던 모양 규칙(마침표 생략·조사 덜기)이 없다', !/마침표를 문장마다 찍지 않는다/.test(v.SOCIAL_VOICE) && !/조사와 서술어를 덜어낸다/.test(v.SOCIAL_VOICE));
t('스레드 예시는 평서체 (반말·존댓말 어미 없음)', !/만나봐\n|옮겨\n|옮겨요|공개했어요|올랐어요/.test(v.SOCIAL_VOICE) && /공개했다/.test(v.SOCIAL_VOICE) && /꼭 한번 직접 보길/.test(v.SOCIAL_VOICE) && /발렌티노가 도서관에서 꺼낸 안티라이브러리/.test(v.SOCIAL_VOICE));
t('스레드와 X 의 차이는 안내 줄과 모양 제목뿐', (() => { const a = v.SOCIAL_VOICE.split('\n'); return v.X_VOICE.split('\n').filter((l) => !a.includes(l)).length === 2; })());
// X 어미
t('X: 넘기기 네 꼴 평서체판', /네 꼴 중 하나만 쓴다/.test(v.X_VOICE) && !/지금 만나보세요/.test(v.X_VOICE) && /"꼭 한번 직접 보길." \/ "~일지도."/.test(v.X_VOICE));
t('스레드와 X 의 글자수 상한이 같다(완전히 똑같이)', /\(platform === 'x' \|\| platform === 'threads'\) \? 80 : 420/.test(fs.readFileSync(path.join(ROOT, 'api/_lib/socialHook.js'), 'utf8')));
t('X 예시는 평서체', !/만나봐\n|옮겨요|공개했어요/.test(v.X_VOICE) && /공개했다/.test(v.X_VOICE));
// 안내 줄 규칙은 X 에만 (스레드는 코드가 안 붙인다)
t('"풀 영상은 인스타" 안내 줄 규칙은 X 에만', /안내 줄은 쓰지 않는다/.test(v.X_VOICE) && !/안내 줄은 쓰지 않는다/.test(v.SOCIAL_VOICE));

// threadsAutopost 쪽 — 시스템 프롬프트가 뼈대와 싸우지 않는다 + 본문 저장
const ta = fs.readFileSync(path.join(ROOT, 'api/_lib/threadsAutopost.js'), 'utf8');
t('스레드 시스템 프롬프트: 350자 규칙이 사라지고 뼈대(80자)와 맞는다', !/350자 이내/.test(ta) && /80자 안쪽/.test(ta));
t('스레드 시스템 프롬프트: 훅은 뼈대의 다섯 패턴', /다섯 패턴 중 하나/.test(ta));
t('올라간 본문을 threads_posts.text 에 남긴다', /text: bodyText \? String\(bodyText\)\.slice\(0, 2000\) : null/.test(ta));
t('마이그레이션 176 파일이 있고 ADD COLUMN text', /ADD COLUMN IF NOT EXISTS text text/.test(fs.readFileSync(path.join(ROOT, 'supabase_migrations/176_threads_posts_text.sql'), 'utf8')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
