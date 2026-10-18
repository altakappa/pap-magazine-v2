/**
 * X 다이제스트의 인스타 링크를 ig-out 경유로 (2026-10-18 도메니코, 첨부 이미지 "pap-magazine.com/api/ig-out?src…" 형식)
 * 실측 14일: social-digest X 글 24건이 https://www.instagram.com/pap_magazine/ 직링크 → 클릭 0 계측.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }
const copy = require('../api/_lib/digestCopy');

t('X 링크 = ig-out?src=x_digest&to=profile → 공식 프로필', copy.X_IG_LINK === 'https://www.pap-magazine.com/api/ig-out?src=x_digest&to=profile&url=' + encodeURIComponent('https://www.instagram.com/pap_magazine/'), copy.X_IG_LINK);
t('ig-out 화이트리스트에 x_digest (없으면 other 로 뭉개진다)', /'x_digest'/.test(rd('api/ig-out.js')));
t('igFirstLink 채널에 x_digest', /'x_digest'/.test(rd('api/_lib/igFirstLink.js')));
const dc = rd('api/_lib/digestCopy.js');
t('X·PAP 갈래만 계측 링크 (스레드·페퍼릿은 종전 그대로)', /\(platform === 'x' && bucket !== PEPPERIT_BUCKET\) \? X_IG_LINK : igUrlFor\(bucket\)/.test(dc));
t("social-digest X 글은 x_posts.kind 'digest'", /xPost\.postTweet\(text, \{ kind: 'digest' \}\)/.test(rd('api/cron/social-digest.js')));

(async () => {
  const PICK = { bucket: 'celeb', label: '셀럽 소식', days: 3, items: [{ source: 'article', id: '1', title: '제니, 새 화보' }] };
  const x = await copy.build(PICK, 'x');
  t('X 실제 문안 끝이 ig-out 링크', x.text.trim().endsWith(copy.X_IG_LINK), x.text);
  t('X 문안에 instagram.com 직링크 없음', !/\nhttps:\/\/www\.instagram\.com/.test(x.text));
  const th = await copy.build(PICK, 'threads');
  t('스레드는 종전 직링크 그대로', th.text.trim().endsWith(copy.IG_URL));
  const pp = await copy.build({ bucket: 'pepperit', label: '페퍼릿', days: 3, items: [{ source: 'article', id: '2', title: 'x' }] }, 'x');
  t('페퍼릿 X 는 종전 그대로 (@pepperitmag)', !pp || pp.text.trim().endsWith(copy.IG_URLS.pepperit), pp && pp.text);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
