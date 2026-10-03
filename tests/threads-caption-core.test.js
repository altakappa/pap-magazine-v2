/**
 * 스레드 = X 뼈대의 반말판 (2026-10-03, 도메니코 "트위터 말투의 반말 버전을 스레드로")
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
t('뼈대: 고유명사·열거·사실 말하고 멈춤', /고유명사를 그대로 부른다/.test(v.CAPTION_CORE) && /열거로 리듬/.test(v.CAPTION_CORE) && /사실을 말하고 멈춘다/.test(v.CAPTION_CORE));
t('뼈대: 마지막은 독자가 할 일(감상 금지)', /독자가 할 일/.test(v.CAPTION_CORE));
const src = fs.readFileSync(path.join(ROOT, 'api/_lib/papVoice.js'), 'utf8');
t('뼈대 문장이 파일에 한 번만 있다(복사본 없음)', (src.match(/고유명사를 그대로 부른다/g) || []).length === 1);

// 스레드 어미·호칭·모양
t('스레드: 반말 기본 "~어/~했어"', /"~어", "~했어"/.test(v.SOCIAL_VOICE) && /처음부터 끝까지 반말/.test(v.SOCIAL_VOICE));
t('스레드: 넘기기 다섯 꼴 반말판', /"지금 만나봐" \/ "꼭 직접 봐" \/ "~일지도" \/ "~아닐까" \/ "~해봐"/.test(v.SOCIAL_VOICE));
t('스레드: 호칭 스치니들·설명조 금지 유지', /스치니들/.test(v.SOCIAL_VOICE) && /설명조 반말을 쓰지 않는다/.test(v.SOCIAL_VOICE));
t('스레드: 모양(줄바꿈·마침표) 유지', /줄바꿈으로 나눈다/.test(v.SOCIAL_VOICE) && /마침표를 문장마다 찍지 않는다/.test(v.SOCIAL_VOICE));
t('스레드: 실캡션 반말 예시 2건', /비하인드 씬 지금 만나봐/.test(v.SOCIAL_VOICE) && /요리가 되면 어떤 맛일까$/m.test(v.SOCIAL_VOICE));
t('스레드 예시에 존댓말 어미가 없다', !/만나보세요|옮겨요|올랐어요|일까요/.test(v.SOCIAL_VOICE));
// X 어미
t('X: 넘기기 다섯 꼴 존댓말판 유지', /"지금 만나보세요." \/ "꼭 한번 직접 보시길."/.test(v.X_VOICE) && /처음부터 끝까지 존댓말/.test(v.X_VOICE));
t('X 예시에 반말 어미가 없다', !/만나봐\n|옮겨\n|어떤 맛일까\n/.test(v.X_VOICE));
// 안내 줄 규칙은 X 에만 (스레드는 코드가 안 붙인다)
t('"풀 영상은 인스타" 안내 줄 규칙은 X 에만', /안내 줄은 쓰지 않는다/.test(v.X_VOICE) && !/안내 줄은 쓰지 않는다/.test(v.SOCIAL_VOICE));

// threadsAutopost 쪽 — 시스템 프롬프트가 뼈대와 싸우지 않는다 + 본문 저장
const ta = fs.readFileSync(path.join(ROOT, 'api/_lib/threadsAutopost.js'), 'utf8');
t('스레드 시스템 프롬프트: 350자 규칙이 사라지고 뼈대(120자)와 맞는다', !/350자 이내/.test(ta) && /120자 안쪽/.test(ta));
t('스레드 시스템 프롬프트: 훅은 뼈대의 다섯 패턴', /다섯 패턴 중 하나/.test(ta));
t('올라간 본문을 threads_posts.text 에 남긴다', /text: bodyText \? String\(bodyText\)\.slice\(0, 2000\) : null/.test(ta));
t('마이그레이션 176 파일이 있고 ADD COLUMN text', /ADD COLUMN IF NOT EXISTS text text/.test(fs.readFileSync(path.join(ROOT, 'supabase_migrations/176_threads_posts_text.sql'), 'utf8')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
