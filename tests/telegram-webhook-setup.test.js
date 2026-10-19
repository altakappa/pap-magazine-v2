/**
 * 텔레그램 웹훅 등록 관리자 라우트 회귀 (2026-10-19)
 * 9/10 부터 봇 수신 0건. 토큰이 env 에만 있어 setWebhook 을 사람이 못 돌렸다. 지킬 것:
 * 관리자 전용 · 토큰/시크릿 응답 미노출(마스킹) · webhook.js 와 같은 env(TELEGRAM_WEBHOOK_SECRET) ·
 * allowed_updates=message · 쌓인 업데이트 버리지 않음 · 등록 URL 고정.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const src = R('api/admin/telegram-webhook-setup.js');
const SUPA = path.join(ROOT, 'api', '_lib', 'supabase.js');
require.cache[SUPA] = { id: SUPA, filename: SUPA, loaded: true, exports: { supabaseAdmin: { from: () => ({}) }, supabase: {} } };
const mod = require('../api/admin/telegram-webhook-setup.js');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

t('관리자 세션 필수', /requireAdmin\(req, res\)/.test(src));
t('등록 URL 이 webhook 라우트', mod.WEBHOOK_URL === 'https://www.pap-magazine.com/api/telegram/webhook' && fs.existsSync(path.join(ROOT, 'api/telegram/webhook.js')));
t('webhook.js 와 같은 시크릿 env 를 쓴다', /TELEGRAM_WEBHOOK_SECRET/.test(src) && /TELEGRAM_WEBHOOK_SECRET/.test(R('api/telegram/webhook.js')));
t('secret_token 으로 등록', /secret_token: secret/.test(src));
t('message 업데이트만', /allowed_updates: \['message'\]/.test(src));
t('쌓인 업데이트를 버리지 않는다', /drop_pending_updates: false/.test(src));
t('토큰이 응답 JSON 에 실리지 않는다', !/json\(\{[^}]*token/.test(src));
t('시크릿은 마스킹만', /secret: mask\(secret\)/.test(src));
t('시크릿 미설정이면 등록 거부 (fail-closed 와 정합)', /TELEGRAM_WEBHOOK_SECRET 미설정 — 등록해도/.test(src));
const s = mod.summarize({ url: mod.WEBHOOK_URL, pending_update_count: 3, last_error_date: 1792400000, last_error_message: 'x' });
t('summarize: 여기 등록 여부·대기 수·마지막 오류', s.registered_here === true && s.pending_update_count === 3 && /^2026-/.test(s.last_error_date) && s.last_error_message === 'x');
t('summarize: 다른 URL 이면 registered_here=false', mod.summarize({ url: 'https://old.example/hook' }).registered_here === false);

// 같은 날 신설: IG 토큰 scopes 진단 (?token=1). 토큰 값은 응답에 싣지 않는다.
const diag = R('api/admin/instagram-diagnose.js');
t('IG 진단 ?token=1 이 debug_token 으로 scopes 를 본다', /query \|\| \{\}\)\.token === '1'/.test(diag) && /debug_token\?/.test(diag));
t('게시 권한 유무를 can_publish 로 명시', /can_publish: scopes\.includes\('instagram_content_publish'\)/.test(diag));
t('토큰 값이 응답에 실리지 않는다', !/json\(\{[^}]*\btok\b/.test(diag));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ telegram-webhook-setup tests FAILED'); process.exit(1); }
console.log('✅ telegram-webhook-setup tests passed');
