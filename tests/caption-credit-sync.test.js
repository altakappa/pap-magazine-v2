/**
 * 크레딧 수정 → 인스타 캡션 크레딧 줄 동기화 (2026-10-15)
 * 실측: 'Her Name Is Regina' 1회차 수정(Stylist→Stylist Director ×2, Agency→Talent Agency) 뒤에도
 * instagram_caption 은 옛 역할 그대로였고 텔레그램엔 캡션이 오지 않았다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }
const { syncCaptionCredits, captionSyncAlert } = require('../api/_lib/captionCreditSync');

const CAP = [
  "전통 의상을 입은 여자가, 마침내 해방된다", '',
  "'Her Name Is Regina' — PAP 매거진 오리지널 에디토리얼", 'Published by @kangdm', '',
  'Photographer @blackeyedmarti', 'Stylist @claudia_piras', 'LIGHTING ASSISTANT @framingpeople_',
  'Stylist @_.fefferico._', 'Stylist @_.gaabriiii._', 'Agency @lucioaru', 'Starring @marxjja', '',
  'FOR MORE EDITORIALS | @pap_magazine', '', 'Fashion by @agolde @skims @topshop @normakamali', '', '#패션화보',
].join('\n');
const B = [
  { name: 'Martina', roles: ['Photographer'], instagram: '@blackeyedmarti' },
  { name: 'Claudia', roles: ['Stylist'], instagram: '@claudia_piras' },
  { name: 'Aurelio', roles: ['LIGHTING ASSISTANT'], instagram: '@framingpeople_' },
  { name: 'Federico', roles: ['Stylist'], instagram: '@_.fefferico._' },
  { name: 'Gabriele', roles: ['Stylist'], instagram: '@_.gaabriiii._' },
  { name: 'Maria', roles: ['Starring'], instagram: '@marxjja' },
  { name: 'Lucio', roles: ['Agency'], instagram: '@lucioaru' },
];
const clone = (x) => JSON.parse(JSON.stringify(x));

console.log('[1] 실측 재현 — Her Name Is Regina 1회차');
const A = clone(B); A[3].roles = ['Stylist Director']; A[4].roles = ['Stylist Director']; A[6].roles = ['Talent Agency'];
const r = syncCaptionCredits(CAP, B, A);
t('Stylist → Stylist Director (2줄)', /\nStylist Director @_\.fefferico\._\n/.test(r.caption) && /\nStylist Director @_\.gaabriiii\._\n/.test(r.caption));
t("Agency → Talent Agency (정규화표가 같은 값으로 묶어도 '바뀜' 으로 본다)", /\nTalent Agency @lucioaru\n/.test(r.caption) && !/\nAgency @lucioaru/.test(r.caption));
t('바뀐 줄 3개, 못 찾은 것 0', r.changed.length === 3 && r.unresolved.length === 0, JSON.stringify(r));
t('안 바뀐 사람 줄은 그대로 (LIGHTING ASSISTANT 대문자 유지 · Stylist @claudia_piras)', /\nLIGHTING ASSISTANT @framingpeople_\n/.test(r.caption) && /\nStylist @claudia_piras\n/.test(r.caption));
t('크레딧 밖(훅·제목·Published by·Starring·FOR MORE·Fashion by·태그)은 한 글자도 안 바뀜',
  r.caption.replace(/Stylist Director @_\.fefferico\._/, 'Stylist @_.fefferico._').replace(/Stylist Director @_\.gaabriiii\._/, 'Stylist @_.gaabriiii._').replace('Talent Agency @lucioaru', 'Agency @lucioaru') === CAP);

console.log('[2] 추가 · 삭제 · 핸들 변경 · 브랜드');
const A2 = clone(B); A2.push({ name: 'New', roles: ['Retoucher'], instagram: '@newone' });
const r2 = syncCaptionCredits(CAP, B, A2);
t('새 사람은 크레딧 블록 마지막 줄 다음 (Starring 앞) · 역할은 정규화표(Retoucher→Retouching)', /Agency @lucioaru\nRetouching @newone\nStarring @marxjja/.test(r2.caption), r2.caption);
const A3 = clone(B).filter((x) => x.instagram !== '@claudia_piras');
const r3 = syncCaptionCredits(CAP, B, A3);
t('빠진 사람 줄은 삭제', !/claudia_piras/.test(r3.caption) && r3.changed.length === 1);
const A4 = clone(B); A4[1].instagram = '@claudia.piras.new';
const r4 = syncCaptionCredits(CAP, B, A4);
t('핸들 변경 = 옛 줄 삭제 + 새 줄 추가', !/@claudia_piras\b/.test(r4.caption) && /Stylist @claudia\.piras\.new/.test(r4.caption));
const r5 = syncCaptionCredits(CAP, B, B, { beforeBrands: [{ instagram: '@agolde' }, { instagram: '@skims' }, { instagram: '@topshop' }, { instagram: '@normakamali' }], afterBrands: [{ instagram: '@agolde' }, { instagram: '@skims' }, { instagram: '@topshop' }, { instagram: '@gucci' }] });
t('브랜드 바뀌면 Fashion by 줄 교체', /\nFashion by @agolde @skims @topshop @gucci\n/.test(r5.caption));
const r6 = syncCaptionCredits(CAP, B, B, { beforeBrands: [{ instagram: '@agolde' }], afterBrands: [{ instagram: '@agolde' }] });
t('아무것도 안 바뀌면 캡션 그대로 · changed 0', r6.caption === CAP && r6.changed.length === 0);
t('캡션이 비면 아무것도 안 함', syncCaptionCredits('', B, A).changed.length === 0);
const r7 = syncCaptionCredits('Photographer @blackeyedmarti', B, A);
t('줄을 못 찾은 변경은 unresolved 로 (조용히 빼먹지 않는다)', r7.unresolved.length === 3, JSON.stringify(r7.unresolved));

console.log('[3] 텔레그램 문구');
const al = captionSyncAlert('Her Name Is Regina', r, 'https://www.pap-magazine.com/editorial/her-name-is-regina');
t('바뀐 줄만 "옛 → 새" 로', /Stylist @_\.fefferico\._ → Stylist Director @_\.fefferico\._/.test(al) && /Agency @lucioaru → Talent Agency @lucioaru/.test(al));
t('전문은 다음 메시지라고 안내', /다음 메시지 = 고친 캡션 전문/.test(al));
t('못 찾은 줄이 있으면 경고', /자리를 못 찾음/.test(captionSyncAlert('x', r7)));

console.log('[4] 배선');
const ce = rd('api/editorials/[id]/credits.js');
t('instagram_caption 을 읽는다', /credits_history, instagram_caption'\)/.test(ce));
t('같은 update 에 instagram_caption (바뀌었을 때만)', /\.\.\.\(captionChanged \? \{ instagram_caption: capSync\.caption \} : \{\}\)/.test(ce));
t('요약 1통 + 캡션 전문 1통', /captionSyncAlert\(ed\.title, capSync/.test(ce) && /if \(captionChanged\) await sendTextToTelegramSafe\(capSync\.caption\)/.test(ce));
const ts = rd('api/editorials/telegram-send.js');
t('telegram-send ?only=caption — 캡션만 재전송', /only\) \|\| ''\) === 'caption'/.test(ts) && /sendTextToTelegramSafe\(cap\)/.test(ts));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
