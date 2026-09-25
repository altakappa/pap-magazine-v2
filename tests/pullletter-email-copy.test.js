/*
 * pullletter-email-copy.test.js  (2026-09-25, 도메니코)
 *
 * "우리가 의상 전달 조율을 왜해줘? 풀레터 요청자가 풀레터를 가지고 직접
 *  원하는 pr업체나 협력업체에가서 요청을 하는거야"
 *
 * 풀레터 메일(접수·승인·반려·발급)이 PAP 가 쇼룸과 의상 전달을 조율한다고
 * 약속하던 문구를 9개 언어에서 걷어냈다. 이 테스트는 그 약속이 다시 들어오지
 * 않게 막고, 승인·발급 메일에 "신청자가 직접 브랜드·쇼룸·PR 에 가져간다"는
 * 안내가 언어마다 들어 있는지 확인한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL ' + msg); } }

const { templates } = require(path.join(ROOT, 'api/_lib/email.js'));
const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];
// 언어별 "촬영이 원활하도록 돕는다" 표지어 (2026-09-25 도메니코: 구체적 사용법 대신
// "이 레터로 촬영이 원활히 진행되도록 도움을 받을 수 있다" 는 톤)
const DIRECT = { ko: '원활', en: 'smoothly', it: 'senza intoppi', fr: 'bon déroulement', es: 'sin contratiempos', ja: 'スムーズ', zh: '顺利', ru: 'гладко', de: 'reibungslos' };

// 1) 소스에 PAP 가 전달·재고를 조율한다는 옛 약속이 남아 있지 않다
const src = fs.readFileSync(path.join(ROOT, 'api/_lib/email.js'), 'utf8');
const BANNED = [
  'coordinate the delivery', 'coordinate with the relevant showrooms', 'piece availability',
  '쇼룸과 의상 전달 일정을 조율', '관련 쇼룸과 조율', '제품 대여 가능 여부',
  'Coordineremo la consegna', 'Nous coordonnerons la livraison', 'Coordinaremos la entrega',
  'ショールームと衣装のお届けを調整', '与 showroom 协调服装的交付', 'согласуем доставку', 'Wir koordinieren die Lieferung',
  // 구체적 사용법 안내도 넣지 않는다 (도메니코 2026-09-25)
  'Loans and delivery are arranged', '대여와 전달은', '의상 대여를 요청',
];
BANNED.forEach(function (b) { ok(src.indexOf(b) === -1, 'banned phrase still present: ' + b); });

// 2) 승인·발급·접수 메일이 언어마다 "직접 가져간다" 를 말한다
LANGS.forEach(function (lang) {
  const u = { name: 'Tester' };
  const acc = templates.pullletterAccepted(u, '', lang).html;
  const iss = templates.pullletterIssued(u, '', lang).html;
  const rec = templates.pullletterReceived(u, lang).html;
  ok(acc.indexOf(DIRECT[lang]) !== -1, lang + ' accepted mail lacks smooth-shoot line');
  ok(iss.indexOf(DIRECT[lang]) !== -1, lang + ' issued mail lacks smooth-shoot line');
  ok(rec.indexOf(DIRECT[lang]) !== -1, lang + ' received mail lacks smooth-shoot line');
  ok(/PDF/.test(acc) && /PDF/.test(rec), lang + ' accepted/received should mention the PDF letter');
});

// 3) 풀레터 페이지가 it/fr/ja/zh 에서 "피드백·컨설팅 서비스" 로 잘못 설명하지 않는다
const html = fs.readFileSync(path.join(ROOT, 'frontend/pullletter.html'), 'utf8');
['servizio di consulenza', 'service de consultation', 'コンサルティングサービス', '专业咨询服务', 'Il feedback pull-letter', 'Le feedback pull-letter', 'フルレターフィードバック', 'Pull-Letter反馈']
  .forEach(function (b) { ok(html.indexOf(b) === -1, 'pullletter.html still describes it as: ' + b); });

console.log('pullletter-email-copy: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
