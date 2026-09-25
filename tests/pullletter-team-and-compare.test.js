'use strict';
/**
 * 풀레터·유료 전환 우회 유도 3가지 (2026-09-25, 도메니코 "이렇게만 적용하자").
 *  1. 풀레터 팀원: 회원이면 직접 알림, 아니면 신청자 발급 메일에 "팀원에게 알려 주세요" + 가입 링크
 *     (팀원은 이름·인스타만 있고 이메일이 없다. 모르는 주소로 홍보 메일을 보내지 않는다)
 *  2. €380 유료 안내 화면에 "연간 프리미엄이면 1회 면제 + 풀레터 12회" 비교 한 줄
 *  3. 크리에이터 월간 소식·성적표의 풀레터 링크 클릭을 따로 잰다 (utm_content · 도착 페이지 계측)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];

(async () => {
  console.log('=== 1. 팀원 정리 ===');
  const TC = require(path.join(ROOT, 'api/_lib/pullletterTeamCopy.js'));
  t('인스타 아이디 정리: @·대문자·주소 → 아이디', TC.normHandle('@Lou.Mc_Laren') === 'lou.mc_laren' && TC.normHandle('https://www.instagram.com/abc_d/') === 'abc_d' && TC.normHandle('x y') === '' && TC.normHandle(null) === '');
  t('team_info → 팀원 (신청자 contact 제외, 빈 칸 제외)',
    JSON.stringify(TC.teamMembers({ contact: { name: 'A', email: 'a@b' }, stylist: { name: 'Lou', instagram: '@loumc' }, videographer: { name: '' } })) === JSON.stringify([{ role: 'stylist', name: 'Lou', handle: 'loumc' }]));
  t('이상한 team_info 에도 안 터진다', TC.teamMembers(null).length === 0 && TC.teamMembers([1, 2]).length === 0 && TC.teamMembers('x').length === 0);
  t('문구 9개 언어 (알림 · 초대 · 역할)', LANGS.every((l) => TC.TEAM_NOTICE[l] && TC.TEAM_INVITE[l] && TC.ROLE[l] && TC.ROLE[l]._));

  const { planTeam } = require(path.join(ROOT, 'api/_lib/pullletterTeam.js'));
  const mkDb = (rows, fail) => ({ from: () => ({ select() { return this; }, in(k, v) { this.asked = v; return Promise.resolve(fail ? { data: null, error: { message: 'down' } } : { data: rows.filter((r) => v.includes(r.instagram)), error: null }); } }) });
  const pl = { id: 'pl1', user_id: 'req', team_info: {
    contact: { name: 'James Morris', email: 'j@x.y' },
    photographer: { name: 'James Morris', instagram: '@jm' },
    stylist: { name: 'Lou', instagram: '@LouMc' },
    videographer: { name: 'Ana Kim', instagram: '@ana' },
    model: { name: 'james morris' },
    hair: { name: 'Lou', instagram: '@loumc' },
  } };
  const rows = [{ id: 'm1', email: 'lou@x.y', instagram: 'loumc', name: 'Lou' }, { id: 'req', email: 'r@x', instagram: 'jm' }, { id: 'noemail', instagram: 'ana2' }];
  const r = await planTeam(mkDb(rows), pl);
  t('회원인 팀원 → 알림 대상 (한 사람은 한 번)', r.members.length === 1 && r.members[0].profile.id === 'm1' && r.members[0].role === 'stylist');
  t('신청자 본인(같은 회원 · contact 와 같은 이름)은 빠진다', !r.members.some((m) => m.profile.id === 'req') && !r.inviteNames.some((n) => /james/i.test(n)));
  t('회원 아닌 팀원 → 초대 이름 목록', JSON.stringify(r.inviteNames) === JSON.stringify(['Ana Kim']));
  const down = await planTeam(mkDb(rows, true), pl);
  const origWarn = console.warn; console.warn = () => {};
  console.warn = origWarn;
  t('회원 조회 실패 → 알림 없이 전부 초대 목록 (발급은 계속)', down.members.length === 0 && down.inviteNames.includes('Lou') && down.inviteNames.includes('Ana Kim'));

  console.log('\n=== 2. 메일 ===');
  const { templates } = require(path.join(ROOT, 'api/_lib/email.js'));
  const withInv = templates.pullletterIssued({ name: 'Kim' }, '', 'ko', { title: 'Blue', id: 'abcd1234-ef56', inviteNames: ['Ana Kim', '<b>x</b>'] });
  t('발급 메일: 팀원 블록 + 가입 링크(utm pl_team_invite, 풀레터 번호)', withInv.html.includes('팀원에게도 알려 주세요') && withInv.html.includes('Ana Kim')
    && /auth\?mode=signup&utm_source=pl_team_invite&utm_medium=email&utm_campaign=pl-abcd1234/.test(withInv.html));
  t('팀원 이름은 이스케이프', !withInv.html.includes('<b>x</b>') && withInv.html.includes('&lt;b&gt;x&lt;/b&gt;'));
  const noInv = templates.pullletterIssued({ name: 'Kim' }, '', 'ko', { title: 'Blue', id: 'x' });
  t('초대할 팀원이 없으면 블록 없음', !noInv.html.includes('팀원에게도 알려 주세요') && !noInv.html.includes('pl_team_invite'));
  t('9개 언어 발급 메일에 그 언어 블록', LANGS.every((l) => templates.pullletterIssued({ name: 'A' }, '', l, { id: 'p', inviteNames: ['Ana'] }).html.includes(TC.TEAM_INVITE[l].title)));
  const n = templates.pullletterTeamNotice({ name: 'Lou' }, { requester: 'James', title: 'Blue', role: 'stylist', id: 'abcd1234' }, 'ko');
  t('팀원 알림 (ko): 제목 · 신청자 · 역할 한국어 · 링크 utm pl_team_notice',
    n.subject === '회원님 이름이 PAP 공식 풀레터에 올라갔습니다' && n.html.includes('James님') && n.html.includes('스타일리스트') && /utm_source=pl_team_notice&utm_medium=email&utm_campaign=pl-abcd1234#mp-pullletters/.test(n.html));
  t('팀원 알림 9개 언어, 역할이 그 언어', LANGS.every((l) => { const m = templates.pullletterTeamNotice({ name: 'L' }, { requester: 'J', role: 'photographer', id: 'x' }, l); return m.subject === TC.TEAM_NOTICE[l].subject && m.html.includes(TC.ROLE[l].photographer); }));
  t('모르는 역할 → "팀원"', templates.pullletterTeamNotice({}, { role: 'catering' }, 'ko').html.includes('팀원'));

  console.log('\n=== 3. 발급 흐름 (review.js) ===');
  const rv = R('api/pullletters/[id]/review.js');
  t('바꾸기 전 상태를 읽고, 처음 발급될 때만 팀원 알림', /select\('status'\)\.eq\('id', id\)\.maybeSingle\(\)/.test(rv) && /const firstIssue = status === 'issued' && !\(before && before\.status === 'issued'\)/.test(rv) && /if \(firstIssue\) \{\s*for \(const m of plan\.members\)/.test(rv));
  t('상태 읽기가 update 보다 앞', rv.indexOf("select('status')") < rv.indexOf('.update(update)'));
  t('발급 메일에 초대 이름 목록 · 풀레터 번호', /pullletterIssued\(\{ name: profile\.name \}, reviewNote, _lang, \{ title: pullLetter\.title, id: pullLetter\.id, inviteNames: plan\.inviteNames \}\)/.test(rv));
  t('팀원 알림은 팀원 자기 언어로', /pullletterTeamNotice\([\s\S]{0,300}resolveEmailLang\(m\.profile\)\)/.test(rv));
  t('팀원 알림 실패가 심사를 깨지 않는다', /catch \(_e\) \{ console\.error\('\[pullletter-review\] 팀원 알림 실패/.test(rv));

  console.log('\n=== 4. €380 비교 한 줄 ===');
  const sub = R('frontend/submission.html');
  const sp = R('frontend/subscribe.html');
  const yp = (sp.match(/prem_y:([\d.]+)/) || [])[1];
  t('구독 페이지 연간 프리미엄 가격이 89.90 (문구와 같은 값)', yp === '89.90');
  const langs = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh'];
  const got = langs.map((l) => { const m = sub.match(new RegExp('\\n' + l + ":\\{paidCompareYearly:'((?:[^'\\\\]|\\\\.)*)'")); return m ? m[1] : ''; });
  t('사전 8개 언어(페이지가 가진 언어 전부)에 비교 문구', got.every(Boolean), langs.filter((l, i) => !got[i]).join(','));
  t('문구마다 €380 · 89.90/89,90 · 12 · 구독 링크(utm submission_paid_compare)', got.every((s) => s.includes('€380') && /89[.,]90/.test(s) && /12/.test(s) && s.includes('/subscribe?utm_source=submission_paid_compare&utm_medium=web')));
  const fn = sub.slice(sub.indexOf('function _renderSubmissionTypeNotice'), sub.indexOf('// ─── PER-LOOK IMAGE AUDIT'));
  t('€380 유형에만 (브랜디드 €790 · 기타 장르 제외) · 이미 연간이면 안 보임',
    /key!=='submissionTypeBranded' && key!=='submissionTypeOtherGenre' && window\._papYearlyPremium!==true/.test(fn) && /cmp\.innerHTML=_t\('paidCompareYearly'\)/.test(fn));
  t('원래 안내 문구는 그대로 textContent (비교 줄만 HTML)', /box\.textContent=txt;/.test(fn));

  console.log('\n=== 5. 풀레터 링크 클릭 재기 ===');
  const em = R('api/_lib/email.js');
  t('월간 소식 · 성적표 풀레터 링크에 utm_content=pullletter (두 곳)', (em.match(/mypage\?\$\{utm\}&utm_content=pullletter#mp-pullletters/g) || []).length === 2);
  t('도착 페이지(마이페이지 · 가입 · 서브미션)가 유입을 기록한다 (pap-inclick)', ['frontend/mypage.html', 'frontend/auth.html', 'frontend/submission.html'].every((f) => R(f).includes('<script src="/pap-inclick.js?v=4" defer></script>')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
