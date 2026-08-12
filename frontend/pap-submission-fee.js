/* pap-submission-fee.js — 서브미션 일회성 결제(기본료·애드온) 공용 모듈
 * 2026-07-22 최초 · 2026-08-10 Paddle → PayPal Orders 전환
 * 예전엔 submission.html 인라인에만 있던 결제 로직을 추출해 submission.html 과 mypage.html 이
 * 함께 쓴다(단일 소스 — 두 곳에 복제하면 돈 관련 코드가 갈라져 불일치 위험). 클래식 스크립트로
 * 전역 함수(_payT, _baseFeeApprovalBlock, payBaseFee, papPayOneTime)를 노출한다.
 * PayPal JS SDK(www.paypal.com/sdk/js) 와 PAP(pap-api.js),
 * /api/subscriptions/paypal-config 에 의존한다.
 * 결제 확정은 서버(/api/submissions/paypal-capture)가 PayPal 원본을 다시 읽어
 * 금액까지 대조한 뒤에 한다 — 브라우저의 '성공' 은 신뢰하지 않는다. */
'use strict';
// ═══════════════════════════════════════════════════════════════════════
// SUBMISSION ONE-TIME PAYMENT (PayPal Orders) — 2026-08-10
// 승인된 유료(paid_few_looks €380) / 브랜디드(branded €790) 서브미션의 '기본료'를
// PayPal 버튼 오버레이로 결제한다. 확정은 서버 캡처 엔드포인트의 몫 — 프론트는 안내만.
// 발행은 여전히 수동(도메니코). 추가옵션(PayPal 정적 링크)은 별개로 유지.
// ─── i18n (9개 언어, 초안 / DRAFT) ──────────────────────────────────────
//   payBaseFeeBtn / payBasePaid / payBaseUnavailable ... 문구는 도메니코 확정 전
//   초안입니다. 금액(€380/€790)은 {amt} 로 주입. 최종 카피 확정 대기.
var _PAY_I18N = {
  ko:{ payCaptureUnconfirmed:'결제가 이미 처리되었을 수 있습니다. 다시 결제하지 마시고 contact@pap-magazine.com 으로 연락 주세요. 확인 후 바로 처리해 드립니다.', payBaseIntro:'게재를 확정하려면 아래에서 기본 게재료를 결제해 주세요.', payBaseFeeBtn:'기본 게재료 {amt} 결제하기', payBasePaid:'결제 완료 · 게재 대기', payBasePaidHint:'기본 게재료 결제가 확인되었습니다. PAP 편집팀이 게재를 진행합니다.', payBaseUnavailable:'결제가 아직 준비되지 않았습니다. 잠시 후 다시 시도하거나 PAP에 문의해 주세요.', paySdkMissing:'결제 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.', payLoginFirst:'결제하려면 먼저 로그인해 주세요.', payCompleteOptimistic:'결제가 접수되었습니다! 확인되면 상태가 업데이트됩니다.', payGenericError:'결제창을 여는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
  en:{ payCaptureUnconfirmed:'Your payment may already have gone through. Please do not pay again. Email contact@pap-magazine.com and we will sort it out right away.', payBaseIntro:'To confirm publication, please pay the base publication fee below.', payBaseFeeBtn:'Pay base fee {amt}', payBasePaid:'Paid · awaiting publication', payBasePaidHint:'Your base publication fee has been confirmed. PAP will proceed with publication.', payBaseUnavailable:'Payment is not available yet. Please try again shortly or contact PAP.', paySdkMissing:'Payment module failed to load. Please refresh the page.', payLoginFirst:'Please sign in first to pay.', payCompleteOptimistic:'Payment received! Your status will update once confirmed.', payGenericError:'Something went wrong opening the checkout. Please try again shortly.' },
  de:{ payCaptureUnconfirmed:'Ihre Zahlung ist möglicherweise bereits erfolgt. Bitte zahlen Sie nicht erneut. Schreiben Sie an contact@pap-magazine.com, wir klären das sofort.', payBaseIntro:'Um die Veröffentlichung zu bestätigen, zahlen Sie bitte unten die Grundgebühr.', payBaseFeeBtn:'Grundgebühr {amt} zahlen', payBasePaid:'Bezahlt · Veröffentlichung ausstehend', payBasePaidHint:'Ihre Grundgebühr wurde bestätigt. PAP wird die Veröffentlichung fortsetzen.', payBaseUnavailable:'Zahlung ist noch nicht verfügbar. Bitte versuchen Sie es später erneut oder kontaktieren Sie PAP.', paySdkMissing:'Zahlungsmodul konnte nicht geladen werden. Bitte Seite neu laden.', payLoginFirst:'Bitte zuerst anmelden, um zu zahlen.', payCompleteOptimistic:'Zahlung erhalten! Ihr Status wird nach Bestätigung aktualisiert.', payGenericError:'Beim Öffnen des Checkouts ist ein Fehler aufgetreten. Bitte erneut versuchen.' },
  it:{ payCaptureUnconfirmed:'Il pagamento potrebbe essere già andato a buon fine. Non pagare di nuovo. Scrivi a contact@pap-magazine.com e risolviamo subito.', payBaseIntro:'Per confermare la pubblicazione, paga la tariffa base qui sotto.', payBaseFeeBtn:'Paga la tariffa base {amt}', payBasePaid:'Pagato · in attesa di pubblicazione', payBasePaidHint:'La tua tariffa base è stata confermata. PAP procederà con la pubblicazione.', payBaseUnavailable:'Il pagamento non è ancora disponibile. Riprova a breve o contatta PAP.', paySdkMissing:'Impossibile caricare il modulo di pagamento. Ricarica la pagina.', payLoginFirst:'Accedi prima di pagare.', payCompleteOptimistic:'Pagamento ricevuto! Lo stato si aggiornerà una volta confermato.', payGenericError:'Si è verificato un errore nell’apertura del checkout. Riprova a breve.' },
  fr:{ payCaptureUnconfirmed:'Votre paiement a peut-être déjà été effectué. Ne payez pas une seconde fois. Écrivez à contact@pap-magazine.com, nous réglons cela immédiatement.', payBaseIntro:'Pour confirmer la publication, veuillez payer les frais de base ci-dessous.', payBaseFeeBtn:'Payer les frais de base {amt}', payBasePaid:'Payé · en attente de publication', payBasePaidHint:'Vos frais de base ont été confirmés. PAP procédera à la publication.', payBaseUnavailable:'Le paiement n’est pas encore disponible. Réessayez bientôt ou contactez PAP.', paySdkMissing:'Le module de paiement n’a pas pu se charger. Veuillez rafraîchir la page.', payLoginFirst:'Veuillez vous connecter pour payer.', payCompleteOptimistic:'Paiement reçu ! Votre statut sera mis à jour une fois confirmé.', payGenericError:'Une erreur est survenue à l’ouverture du paiement. Veuillez réessayer.' },
  es:{ payCaptureUnconfirmed:'Es posible que su pago ya se haya realizado. No vuelva a pagar. Escriba a contact@pap-magazine.com y lo resolvemos enseguida.', payBaseIntro:'Para confirmar la publicación, pague la tarifa base a continuación.', payBaseFeeBtn:'Pagar tarifa base {amt}', payBasePaid:'Pagado · pendiente de publicación', payBasePaidHint:'Su tarifa base ha sido confirmada. PAP procederá con la publicación.', payBaseUnavailable:'El pago aún no está disponible. Inténtelo de nuevo pronto o contacte con PAP.', paySdkMissing:'No se pudo cargar el módulo de pago. Actualice la página.', payLoginFirst:'Inicie sesión primero para pagar.', payCompleteOptimistic:'¡Pago recibido! Su estado se actualizará una vez confirmado.', payGenericError:'Ocurrió un error al abrir el pago. Inténtelo de nuevo pronto.' },
  ja:{ payCaptureUnconfirmed:'お支払いはすでに完了している可能性があります。重ねてのお支払いはなさらず、contact@pap-magazine.com までご連絡ください。すぐに確認いたします。', payBaseIntro:'掲載を確定するには、以下から基本掲載料をお支払いください。', payBaseFeeBtn:'基本掲載料 {amt} を支払う', payBasePaid:'支払い完了 · 掲載待ち', payBasePaidHint:'基本掲載料の支払いが確認されました。PAPが掲載を進めます。', payBaseUnavailable:'決済はまだ利用できません。しばらくしてから再度お試しいただくか、PAPにお問い合わせください。', paySdkMissing:'決済モジュールの読み込みに失敗しました。ページを再読み込みしてください。', payLoginFirst:'お支払いには先にログインしてください。', payCompleteOptimistic:'お支払いを受け付けました！確認され次第ステータスが更新されます。', payGenericError:'決済画面を開く際に問題が発生しました。しばらくしてから再度お試しください。' },
  zh:{ payCaptureUnconfirmed:'您的付款可能已经完成。请不要重复支付，请发送邮件至 contact@pap-magazine.com，我们会立即处理。', payBaseIntro:'如需确认刊登，请在下方支付基本刊登费。', payBaseFeeBtn:'支付基本刊登费 {amt}', payBasePaid:'已支付 · 等待刊登', payBasePaidHint:'您的基本刊登费已确认。PAP 将继续刊登。', payBaseUnavailable:'支付暂未开放。请稍后重试或联系 PAP。', paySdkMissing:'支付模块加载失败。请刷新页面。', payLoginFirst:'请先登录再支付。', payCompleteOptimistic:'已收到付款！确认后状态将更新。', payGenericError:'打开支付时出错。请稍后重试。' },
  ru:{ payCaptureUnconfirmed:'Возможно, оплата уже прошла. Пожалуйста, не платите повторно. Напишите на contact@pap-magazine.com, мы всё уладим сразу.', payBaseIntro:'Чтобы подтвердить публикацию, оплатите базовый сбор ниже.', payBaseFeeBtn:'Оплатить базовый сбор {amt}', payBasePaid:'Оплачено · ожидает публикации', payBasePaidHint:'Ваш базовый сбор подтверждён. PAP приступит к публикации.', payBaseUnavailable:'Оплата пока недоступна. Повторите попытку позже или свяжитесь с PAP.', paySdkMissing:'Не удалось загрузить платёжный модуль. Обновите страницу.', payLoginFirst:'Войдите, чтобы оплатить.', payCompleteOptimistic:'Платёж получен! Статус обновится после подтверждения.', payGenericError:'Произошла ошибка при открытии оплаты. Повторите попытку позже.' }
};
// 결제 일시중단 안내 (2026-08-10 · Paddle 폐쇄 → PayPal 전환 공백 대응).
// _PAY_I18N 9개 블록을 건드리지 않도록 독립 사전으로 둔다.
var _PAY_PAUSED = {
  ko:'결제 시스템을 교체하는 중입니다. 곧 다시 열립니다 — 급하시면 contact@pap-magazine.com 으로 연락 주세요. 게재 순서는 그대로 유지됩니다.',
  en:'We are switching payment providers. Payment will reopen shortly — email contact@pap-magazine.com if urgent. Your place in the publication queue is kept.',
  de:'Wir wechseln unseren Zahlungsanbieter. Die Zahlung wird in Kürze wieder möglich sein — bei Dringlichkeit: contact@pap-magazine.com. Ihr Platz in der Warteschlange bleibt erhalten.',
  it:'Stiamo cambiando fornitore di pagamento. Il pagamento riaprirà a breve — per urgenze: contact@pap-magazine.com. Il tuo posto in coda è mantenuto.',
  fr:'Nous changeons de prestataire de paiement. Le paiement rouvrira sous peu — urgences : contact@pap-magazine.com. Votre place dans la file est conservée.',
  es:'Estamos cambiando de proveedor de pago. El pago se reabrirá en breve — urgencias: contact@pap-magazine.com. Su lugar en la cola se mantiene.',
  ja:'決済システムを切り替え中です。まもなく再開します — お急ぎの場合は contact@pap-magazine.com へ。掲載の順番はそのまま維持されます。',
  zh:'我们正在更换支付服务商。支付将很快恢复 — 如有急事请联系 contact@pap-magazine.com。您的刊登排序保持不变。',
  ru:'Мы меняем платёжного провайдера. Оплата скоро возобновится — срочные вопросы: contact@pap-magazine.com. Ваше место в очереди сохраняется.'
};
function _paySubPausedMsg(){
  var l; try{ l=localStorage.getItem('pap-lang')||'en'; }catch(_){ l='en'; }
  return _PAY_PAUSED[l] || _PAY_PAUSED.en;
}
// Resolve a payment i18n key against the current pap-lang (English fallback),
// interpolating {amt}. Kept separate from _t/L so this DRAFT copy stays isolated.
function _payT(k,amt){
  // 2026-07-20 (도메니코 지시) — 안내문 전체가 9개 언어로 다국어화되어, 기본 게재료
  // 블록도 브라우저 언어에 맞춘다 (_PAY_I18N 9개 언어 사전 사용).
  var lang; try{ lang=localStorage.getItem('pap-lang')||'en'; }catch(_){ lang='en'; }
  var d=_PAY_I18N[lang]||_PAY_I18N.en;
  var s=(d&&d[k])||(_PAY_I18N.en&&_PAY_I18N.en[k])||k;
  if(amt) s=s.replace(/\{amt\}/g, amt);
  return s;
}
// Build the approval-block base-fee sub-block. Returns '' for free / legacy /
// unknown types (safe no-op). Pure string builder — no side effects.
//   paid_few_looks → €380 · branded → €790
function _baseFeeApprovalBlock(submissionId, submissionType, paymentStatus){
  if(submissionType!=='paid_few_looks' && submissionType!=='branded') return '';
  var amt = submissionType==='branded' ? '€790' : '€380';
  // 이미 결제됨(서버 payment_status) 또는 이번 세션에서 방금 결제 완료(로컬 잠금 플래그)
  // → 버튼 대신 '결제 완료 · 게재 대기' 상태. 로컬 플래그는 checkout.completed 시 설정되어
  //   같은 세션에서 모달을 다시 열어도 버튼이 재노출되지 않게 한다(이중청구 방지).
  var _locallyPaid=false;
  try{ _locallyPaid = !!(window._papSubFeePaidLocal && window._papSubFeePaidLocal[submissionId]); }catch(_){}
  if(paymentStatus==='paid' || _locallyPaid){
    return _baseFeePaidHtml();
  }
  // 미결제 → PayPal 결제 버튼. onclick 인자는 UUID + 고정 유형값이라 안전.
  // 컨테이너/버튼에 id 부여 → checkout.completed 콜백이 이 박스를 즉시 '결제 완료'로 교체.
  return '<div id="_baseFeeBox_'+submissionId+'" style="margin:0 0 16px;padding:16px 18px;background:rgba(201,168,106,.06);border:1px solid rgba(201,168,106,.35);border-radius:2px">'+
           '<div style="font-size:12px;color:rgba(255,255,255,.8);margin-bottom:12px">'+_payT('payBaseIntro')+'</div>'+
           '<button type="button" id="_baseFeeBtn_'+submissionId+'" onclick="payBaseFee(\''+submissionId+'\',\''+submissionType+'\')" '+
             'style="display:inline-block;background:#c9a86a;color:#000;border:none;padding:13px 30px;font-size:12px;font-weight:700;letter-spacing:.08em;cursor:pointer;border-radius:2px">'+
             _payT('payBaseFeeBtn', amt)+'</button>'+
         '</div>';
}
// Green '결제 완료 · 게재 대기' state — reused by the approval block (paid) and by
// the checkout.completed lock (session-level double-charge guard).
function _baseFeePaidHtml(){
  return '<div style="margin:0 0 16px;padding:14px 16px;background:rgba(100,200,150,.08);border:1px solid rgba(100,200,150,.35);border-radius:2px">'+
           '<div style="font-size:12px;font-weight:700;color:rgba(120,220,160,.95);letter-spacing:.04em;margin-bottom:4px">✓ '+_payT('payBasePaid')+'</div>'+
           '<div style="font-size:12px;color:rgba(255,255,255,.6)">'+_payT('payBasePaidHint')+'</div>'+
         '</div>';
}
// Lock a submission's base-fee button after a completed checkout — sets the
// session paid flag and swaps the button box for the paid state so a second
// click can't open a second PayPal order (real re-charge). Server capture
// idempotency protects the DB; this protects the wallet within the session.
function _lockBaseFeeButton(submissionId){
  if(!submissionId) return;
  try{ window._papSubFeePaidLocal = window._papSubFeePaidLocal || {}; window._papSubFeePaidLocal[submissionId]=true; }catch(_){}
  try{
    var box=document.getElementById('_baseFeeBox_'+submissionId);
    if(box) box.outerHTML=_baseFeePaidHtml();
  }catch(_){}
}
// 2026-07-21 근본수정 (도메니코 QA 재발) — 결제 로그인 판정을 '서버 진실'로 통일.
// pap_auth httpOnly 쿠키만 있고 localStorage 토큰이 없는 세션(OAuth 쿠키→토큰 교환
// 실패·Safari ITP 로 localStorage 유실·401 로 토큰만 지워진 경우 등)에서 기존 게이트는
// isLoggedIn()=localStorage 토큰 유무 만 봤기에 '로그인 필요'로 잘못 막혔다. 서버는
// 쿠키로도 인증하므로(api/_lib/auth.js verifyToken: Bearer > pap_auth 쿠키), 로컬 신호가
// 비면 서버에 직접 물어(user 를) 복구한다. 진짜 비로그인이면 null → 안내 후 차단.
async function _resolvePayUser(){
  // 근본원인(2026-07-21 확정, 라이브 실측): pap-api.js 의 PAP 는
  //   const PAP = (function(){ ... })();
  // 로 선언돼 전역 '렉시컬 바인딩'으로만 존재한다. 클래식 스크립트에서 const/let 은
  // window 속성이 되지 않으므로 window.PAP 는 '항상' undefined 다(맨이름 PAP 는 정상).
  // 그래서 결제부의 `window.PAP && ...` 가드가 늘 거짓이 되어, 토큰·캐시·세션이 모두
  // 정상인 로그인 사용자도 '로그인 필요'로 막혔다. → 반드시 맨이름 PAP 를 typeof 가드로 쓴다.
  var _P = (typeof PAP!=='undefined' && PAP && PAP.auth) ? PAP : null;
  // 1) 로컬 캐시(pap-user)
  var user=null;
  try{ user=(_P&&_P.auth.getUser)?_P.auth.getUser():null; }catch(_){}
  if(user&&user.id) return user;
  // 2) 토큰은 있으나 캐시가 빈 경우 → refreshUser (Bearer 경로)
  try{
    if(_P&&_P.auth.isLoggedIn&&_P.auth.isLoggedIn()&&_P.auth.refreshUser){
      var u=await _P.auth.refreshUser(); if(u&&u.id) return u;
    }
  }catch(_){}
  // 3) 쿠키 전용 세션 → 서버에 직접 확인. credentials:'same-origin' 로 pap_auth 쿠키 전송.
  //    request() 를 우회한 raw fetch — 401 시 request() 의 자동 /auth 리다이렉트 부작용을
  //    피하고, 여기서 조용히 null 반환해 호출부가 토스트로 부드럽게 처리하도록 한다.
  try{
    var r=await fetch('/api/auth/me',{headers:{'X-Requested-With':'XMLHttpRequest'},credentials:'same-origin'});
    if(r.ok){ var j=await r.json(); if(j&&j.user&&j.user.id) return j.user; }
  }catch(_){}
  return null;
}
// ── PayPal 일회성 결제 (2026-08-10) ────────────────────────────────
// Paddle 폐쇄로 전환. 구독(Subscriptions)과 다른 API 다 — 요청마다 금액을 싣는다.
//
// ⚠️ 금액은 이 파일에 없다. 서버(/api/submissions/paypal-order)가 저장된
//    submissionType 으로 산출한다. 브라우저는 "무엇을" 만 말하고 "얼마" 는 못 말한다.
//    (Paddle 시절 클라이언트가 유형을 위조해 싼 값을 낼 수 있던 구멍을 없앤 것)
// ⚠️ 결제 확정도 서버(/api/submissions/paypal-capture)가 PayPal 원본을 다시 읽어
//    금액까지 대조한 뒤에 한다. 브라우저의 "성공했어요" 는 신뢰하지 않는다.

var _PP_SDK_LOADED = null;
function _loadPayPalSdkOnce(clientId){
  if (window.paypal && window._papPPSdkKey === clientId) return Promise.resolve();
  if (_PP_SDK_LOADED) return _PP_SDK_LOADED;
  _PP_SDK_LOADED = new Promise(function(resolve, reject){
    var el = document.createElement('script');
    // 일회성 결제는 intent=capture. 구독용 vault/subscription 조합과 다르다.
    el.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(clientId)
           + '&currency=EUR&intent=capture&components=buttons';
    el.onload = function(){ window._papPPSdkKey = clientId; resolve(); };
    el.onerror = function(){ _PP_SDK_LOADED = null; reject(new Error('sdk')); };
    document.head.appendChild(el);
  });
  return _PP_SDK_LOADED;
}

/**
 * 서브미션 일회성 결제 오버레이.
 * @param {{submissionId:string, kind:'submission_fee'|'submission_addon', addon?:string}} opts
 * 전역 노출 — submission.html 의 애드온 버튼도 이 함수를 쓴다.
 */
async function papPayOneTime(opts){
  function fail(msgKey){ try{ if(typeof PAP!=='undefined'&&PAP.ui&&PAP.ui.toast) PAP.ui.toast(_payT(msgKey||'payGenericError'),'error'); }catch(_){ } }

  // 이중 제출 방지 — 2026-08-07 lia.line 이 2분 간격 중복 결제로 €17.98 을 냈다.
  if (window._papOneTimeBusy) return;
  window._papOneTimeBusy = true;
  var overlay = null;
  function close(){ window._papOneTimeBusy = false; if(overlay){ overlay.remove(); overlay=null; } }

  try{
    var user = await _resolvePayUser();
    if(!user){ close(); if(typeof PAP!=='undefined') PAP.ui.toast(_payT('payLoginFirst'),'error'); return; }

    var cfg=null;
    try{ cfg = await fetch('/api/subscriptions/paypal-config',{headers:{'X-Requested-With':'XMLHttpRequest'}}).then(function(r){return r.ok?r.json():null;}); }catch(_){}
    if(cfg && cfg.paused){ close(); if(typeof PAP!=='undefined') PAP.ui.toast(_paySubPausedMsg(),'error'); return; }
    if(!cfg || !cfg.clientId){ close(); fail('payBaseUnavailable'); return; }

    await _loadPayPalSdkOnce(cfg.clientId);

    overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto';
    overlay.innerHTML='<div style="background:#fff;color:#111;max-width:420px;width:100%;border-radius:4px;padding:26px 24px 20px;position:relative">'
      +'<button id="_ppx" aria-label="close" style="position:absolute;top:10px;right:12px;background:none;border:none;font-size:22px;line-height:1;cursor:pointer;color:#666">&times;</button>'
      +'<div style="font-size:14px;font-weight:700;letter-spacing:.04em;margin:0 0 18px">PAP MAGAZINE</div>'
      +'<div id="_ppbtn"></div>'
      +'<div id="_ppwait" style="display:none;font-size:13px;line-height:1.7;color:#333;padding:8px 0"></div>'
      +'</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#_ppx').addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target===overlay) close(); });

    window.paypal.Buttons({
      style:{ layout:'vertical', shape:'rect' },
      createOrder: function(){
        return fetch('/api/submissions/paypal-order',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
          credentials:'same-origin',
          body:JSON.stringify({ submission_id:opts.submissionId, kind:opts.kind||'submission_fee', addon:opts.addon||null })
        }).then(function(r){ return r.json(); }).then(function(j){
          if(!j || !j.id) throw new Error(j && j.code ? j.code : 'order_failed');
          return j.id;
        });
      },
      onApprove: function(data){
        var b=document.getElementById('_ppbtn'), w=document.getElementById('_ppwait');
        if(b) b.style.display='none';
        if(w){ w.textContent=_payT('payCompleteOptimistic'); w.style.display='block'; }
        // 확정은 서버가 한다 — 여기서 성공을 선언하지 않는다.
        return fetch('/api/submissions/paypal-capture',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
          credentials:'same-origin',
          body:JSON.stringify({ order_id:data.orderID })
        }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
          .then(function(res){
            if(!res.ok){
              // 🔴 2026-08-12 — 캡처 단계의 실패에 "다시 시도" 를 말하면 안 된다.
              // 돈이 이미 나갔을 수 있고, 다시 누르면 새 주문이 생겨 진짜로 두 번
              // 청구된다. 서버가 code 로 안전 여부를 알려준다:
              //   capture_failed · order_lookup_failed · not_approved → 돈 안 나감(재시도 안전)
              //   paid_but_unconfirmed                               → 돈 나갔을 수 있음(재시도 금지)
              //   already_paid                                       → 이미 결제됨(청구 안 됨)
              var code = (res.j && res.j.code) || '';
              if(code === 'already_paid'){
                if((opts.kind||'submission_fee')==='submission_fee') _lockBaseFeeButton(opts.submissionId);
                fail('payBasePaid'); close();
                setTimeout(function(){ try{ window.location.reload(); }catch(_){ } }, 1500);
                return;
              }
              var safeToRetry = (code==='capture_failed' || code==='order_lookup_failed' || code==='not_approved');
              fail(safeToRetry ? 'payGenericError' : 'payCaptureUnconfirmed');
              close();
              return;
            }
            try{ if(typeof PAP!=='undefined'&&PAP.ui&&PAP.ui.toast) PAP.ui.toast(_payT('payCompleteOptimistic'),'success'); }catch(_){ }
            if((opts.kind||'submission_fee')==='submission_fee') _lockBaseFeeButton(opts.submissionId);
            close();
            setTimeout(function(){ try{ window.location.reload(); }catch(_){ } }, 1200);
          }).catch(function(){
            // 응답을 못 받았다 = 서버가 캡처했는지 알 수 없다. 안전한 쪽으로 말한다.
            fail('payCaptureUnconfirmed'); close();
          });
      },
      onCancel: function(){ close(); },
      onError: function(err){ try{ console.error('[paypal one-time]', err); }catch(_){ } fail('payGenericError'); close(); }
    }).render('#_ppbtn');
  }catch(e){
    try{ console.error('papPayOneTime error:', e); }catch(_){ }
    close();
    fail(e && e.message==='sdk' ? 'paySdkMissing' : 'payGenericError');
  }
}
try{ window.papPayOneTime = papPayOneTime; }catch(_){ }

/** 기본 게재료 결제 — 승인 블록의 버튼이 부른다. */
async function payBaseFee(submissionId, submissionType){
  return papPayOneTime({ submissionId: submissionId, kind: 'submission_fee' });
}
