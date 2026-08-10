/* pap-submission-fee.js — 서브미션 '기본료' Paddle 결제 공용 모듈 (2026-07-22, 구조개편 Phase 2)
 * 예전엔 submission.html 인라인에만 있던 결제 로직을 추출해 submission.html 과 mypage.html 이
 * 함께 쓴다(단일 소스 — 두 곳에 복제하면 돈 관련 코드가 갈라져 불일치 위험). 클래식 스크립트로
 * 전역 함수(_payT, _baseFeeApprovalBlock, payBaseFee 등)를 노출한다. Paddle SDK(cdn.paddle.com)
 * 와 PAP(pap-api.js), /api/subscriptions/paddle-config 에 의존하며, 결제 확정은 웹훅 몫이다. */
'use strict';
// ═══════════════════════════════════════════════════════════════════════
// SUBMISSION BASE-FEE PAYMENT (Paddle) — 2b (2026-07-19)
// 승인된 유료(paid_few_looks €380) / 브랜디드(branded €790) 서브미션의 '기본료'를
// Paddle 오버레이로 결제한다. 결제 확정은 웹훅(키퍼 담당)의 몫 — 프론트는 낙관적 안내만.
// 발행은 여전히 수동(도메니코). 추가옵션(PayPal 정적 링크)은 별개로 유지.
// ─── i18n (9개 언어, 초안 / DRAFT) ──────────────────────────────────────
//   payBaseFeeBtn / payBasePaid / payBaseUnavailable ... 문구는 도메니코 확정 전
//   초안입니다. 금액(€380/€790)은 {amt} 로 주입. 최종 카피 확정 대기.
var _PAY_I18N = {
  ko:{ payBaseIntro:'게재를 확정하려면 아래에서 기본 게재료를 결제해 주세요.', payBaseFeeBtn:'기본 게재료 {amt} 결제하기', payBasePaid:'결제 완료 · 게재 대기', payBasePaidHint:'기본 게재료 결제가 확인되었습니다. PAP 편집팀이 게재를 진행합니다.', payBaseUnavailable:'결제가 아직 준비되지 않았습니다. 잠시 후 다시 시도하거나 PAP에 문의해 주세요.', paySdkMissing:'결제 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.', payLoginFirst:'결제하려면 먼저 로그인해 주세요.', payCompleteOptimistic:'결제가 접수되었습니다! 확인되면 상태가 업데이트됩니다.', payGenericError:'결제창을 여는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
  en:{ payBaseIntro:'To confirm publication, please pay the base publication fee below.', payBaseFeeBtn:'Pay base fee {amt}', payBasePaid:'Paid · awaiting publication', payBasePaidHint:'Your base publication fee has been confirmed. PAP will proceed with publication.', payBaseUnavailable:'Payment is not available yet. Please try again shortly or contact PAP.', paySdkMissing:'Payment module failed to load. Please refresh the page.', payLoginFirst:'Please sign in first to pay.', payCompleteOptimistic:'Payment received! Your status will update once confirmed.', payGenericError:'Something went wrong opening the checkout. Please try again shortly.' },
  de:{ payBaseIntro:'Um die Veröffentlichung zu bestätigen, zahlen Sie bitte unten die Grundgebühr.', payBaseFeeBtn:'Grundgebühr {amt} zahlen', payBasePaid:'Bezahlt · Veröffentlichung ausstehend', payBasePaidHint:'Ihre Grundgebühr wurde bestätigt. PAP wird die Veröffentlichung fortsetzen.', payBaseUnavailable:'Zahlung ist noch nicht verfügbar. Bitte versuchen Sie es später erneut oder kontaktieren Sie PAP.', paySdkMissing:'Zahlungsmodul konnte nicht geladen werden. Bitte Seite neu laden.', payLoginFirst:'Bitte zuerst anmelden, um zu zahlen.', payCompleteOptimistic:'Zahlung erhalten! Ihr Status wird nach Bestätigung aktualisiert.', payGenericError:'Beim Öffnen des Checkouts ist ein Fehler aufgetreten. Bitte erneut versuchen.' },
  it:{ payBaseIntro:'Per confermare la pubblicazione, paga la tariffa base qui sotto.', payBaseFeeBtn:'Paga la tariffa base {amt}', payBasePaid:'Pagato · in attesa di pubblicazione', payBasePaidHint:'La tua tariffa base è stata confermata. PAP procederà con la pubblicazione.', payBaseUnavailable:'Il pagamento non è ancora disponibile. Riprova a breve o contatta PAP.', paySdkMissing:'Impossibile caricare il modulo di pagamento. Ricarica la pagina.', payLoginFirst:'Accedi prima di pagare.', payCompleteOptimistic:'Pagamento ricevuto! Lo stato si aggiornerà una volta confermato.', payGenericError:'Si è verificato un errore nell’apertura del checkout. Riprova a breve.' },
  fr:{ payBaseIntro:'Pour confirmer la publication, veuillez payer les frais de base ci-dessous.', payBaseFeeBtn:'Payer les frais de base {amt}', payBasePaid:'Payé · en attente de publication', payBasePaidHint:'Vos frais de base ont été confirmés. PAP procédera à la publication.', payBaseUnavailable:'Le paiement n’est pas encore disponible. Réessayez bientôt ou contactez PAP.', paySdkMissing:'Le module de paiement n’a pas pu se charger. Veuillez rafraîchir la page.', payLoginFirst:'Veuillez vous connecter pour payer.', payCompleteOptimistic:'Paiement reçu ! Votre statut sera mis à jour une fois confirmé.', payGenericError:'Une erreur est survenue à l’ouverture du paiement. Veuillez réessayer.' },
  es:{ payBaseIntro:'Para confirmar la publicación, pague la tarifa base a continuación.', payBaseFeeBtn:'Pagar tarifa base {amt}', payBasePaid:'Pagado · pendiente de publicación', payBasePaidHint:'Su tarifa base ha sido confirmada. PAP procederá con la publicación.', payBaseUnavailable:'El pago aún no está disponible. Inténtelo de nuevo pronto o contacte con PAP.', paySdkMissing:'No se pudo cargar el módulo de pago. Actualice la página.', payLoginFirst:'Inicie sesión primero para pagar.', payCompleteOptimistic:'¡Pago recibido! Su estado se actualizará una vez confirmado.', payGenericError:'Ocurrió un error al abrir el pago. Inténtelo de nuevo pronto.' },
  ja:{ payBaseIntro:'掲載を確定するには、以下から基本掲載料をお支払いください。', payBaseFeeBtn:'基本掲載料 {amt} を支払う', payBasePaid:'支払い完了 · 掲載待ち', payBasePaidHint:'基本掲載料の支払いが確認されました。PAPが掲載を進めます。', payBaseUnavailable:'決済はまだ利用できません。しばらくしてから再度お試しいただくか、PAPにお問い合わせください。', paySdkMissing:'決済モジュールの読み込みに失敗しました。ページを再読み込みしてください。', payLoginFirst:'お支払いには先にログインしてください。', payCompleteOptimistic:'お支払いを受け付けました！確認され次第ステータスが更新されます。', payGenericError:'決済画面を開く際に問題が発生しました。しばらくしてから再度お試しください。' },
  zh:{ payBaseIntro:'如需确认刊登，请在下方支付基本刊登费。', payBaseFeeBtn:'支付基本刊登费 {amt}', payBasePaid:'已支付 · 等待刊登', payBasePaidHint:'您的基本刊登费已确认。PAP 将继续刊登。', payBaseUnavailable:'支付暂未开放。请稍后重试或联系 PAP。', paySdkMissing:'支付模块加载失败。请刷新页面。', payLoginFirst:'请先登录再支付。', payCompleteOptimistic:'已收到付款！确认后状态将更新。', payGenericError:'打开支付时出错。请稍后重试。' },
  ru:{ payBaseIntro:'Чтобы подтвердить публикацию, оплатите базовый сбор ниже.', payBaseFeeBtn:'Оплатить базовый сбор {amt}', payBasePaid:'Оплачено · ожидает публикации', payBasePaidHint:'Ваш базовый сбор подтверждён. PAP приступит к публикации.', payBaseUnavailable:'Оплата пока недоступна. Повторите попытку позже или свяжитесь с PAP.', paySdkMissing:'Не удалось загрузить платёжный модуль. Обновите страницу.', payLoginFirst:'Войдите, чтобы оплатить.', payCompleteOptimistic:'Платёж получен! Статус обновится после подтверждения.', payGenericError:'Произошла ошибка при открытии оплаты. Повторите попытку позже.' }
};
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
  // 미결제 → Paddle 오버레이 버튼. onclick 인자는 UUID + 고정 유형값이라 안전.
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
// click can't open a second Paddle transaction (real re-charge). Webhook
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
// Open the Paddle checkout overlay for a submission's base fee.
// Mirrors pap-api.js checkoutIntl pattern: paddle-config → Paddle.Initialize →
// Paddle.Checkout.open. customData.kind='submission_fee' 로 웹훅(키퍼)이 처리.
async function payBaseFee(submissionId, submissionType){
  try{
    if(typeof Paddle==='undefined'){
      if(typeof PAP!=='undefined') PAP.ui.toast(_payT('paySdkMissing'),'error');
      return;
    }
    // 이중청구 방지 — 이번 세션에서 이미 결제 완료된 서브미션이면 오버레이를 다시 열지 않는다.
    // (웹훅 멱등은 DB 중복만 막고 실제 2번째 tx=재청구는 못 막으므로 클릭 진입점에서 차단.)
    try{
      if(window._papSubFeePaidLocal && window._papSubFeePaidLocal[submissionId]){
        if(typeof PAP!=='undefined') PAP.ui.toast(_payT('payBasePaidHint'),'success');
        _lockBaseFeeButton(submissionId);
        return;
      }
    }catch(_){}
    // 2026-07-21 근본수정 — 로그인 판정을 서버 진실(_resolvePayUser)로 통일.
    // 쿠키 전용 세션(토큰 유실)에서도 서버가 인증하면 결제를 막지 않는다.
    var user = await _resolvePayUser();
    if(!user){
      if(typeof PAP!=='undefined') PAP.ui.toast(_payT('payLoginFirst'),'error');
      return;
    }
    // paddle-config 소비 — clientToken + submissionFees{paid_few_looks,branded}.
    // 계약 정합(2026-07-19): 키퍼 paddle-config 응답 키는 `submissionFees` (과업 지시서의
    // 가정 `submissionFeePrices`가 아님). 실제 키에 맞춤. 키 없으면 안전 처리.
    var cfg=null;
    try{ cfg = await fetch('/api/subscriptions/paddle-config',{headers:{'X-Requested-With':'XMLHttpRequest'}}).then(function(r){return r.ok?r.json():null;}); }catch(_){}
    if(!cfg || !cfg.clientToken){
      if(typeof PAP!=='undefined') PAP.ui.toast(_payT('payBaseUnavailable'),'error');
      return;
    }
    var fees = cfg.submissionFees || cfg.submissionFeePrices || {};
    var priceId = fees[submissionType] || '';
    if(!priceId){
      // 도메니코 Paddle 미설정(price ID 없음) → 안내 후 중단 (버튼 안전 처리).
      if(typeof PAP!=='undefined') PAP.ui.toast(_payT('payBaseUnavailable'),'error');
      return;
    }
    if(!window._papPaddleInitSub){
      if(cfg.environment==='sandbox'){ try{ Paddle.Environment.set('sandbox'); }catch(_){} }
      Paddle.Initialize({
        token: cfg.clientToken,
        eventCallback: function(ev){
          // 확정은 webhook(payment_status=paid)이 담당 — 여기선 낙관적 안내 + 세션 잠금.
          if(ev && ev.name==='checkout.completed'){
            // 완료된 결제의 submission_id 를 event custom_data 로 식별(폴백: 마지막 in-flight).
            var _sid='', _kind='';
            try{ _sid = (ev.data && ev.data.custom_data && ev.data.custom_data.submission_id) || ''; _kind = (ev.data && ev.data.custom_data && ev.data.custom_data.kind) || ''; }catch(_){}
            if(!_sid){ try{ _sid = window._papSubFeeInFlight || ''; }catch(_){ _sid=''; } }
            // 버튼 잠금은 기본료(submission_fee)에만 — 부가서비스(addon) 완료가
            // 기본료 버튼을 잘못 잠그지 않게 kind 로 구분 (2026-07-20).
            if(_sid && _kind!=='submission_addon') _lockBaseFeeButton(_sid);
            try{ if(typeof PAP!=='undefined'&&PAP.ui&&PAP.ui.toast) PAP.ui.toast(_payT('payCompleteOptimistic'),'success'); }catch(_){}
          }
        }
      });
      window._papPaddleInitSub=true;
    }
    // checkout.completed 콜백이 잠글 대상을 식별할 수 있게 in-flight submission_id 기록.
    try{ window._papSubFeeInFlight = submissionId; }catch(_){}
    Paddle.Checkout.open({
      items:[{ priceId: priceId, quantity:1 }],
      customer: user.email?{ email:user.email }:undefined,
      customData:{ submission_id:submissionId, submission_type:submissionType, user_id:user.id, kind:'submission_fee' },
      settings:{ displayMode:'overlay', theme:'dark', locale:(function(){try{return localStorage.getItem('pap-lang')||'en';}catch(_){return 'en';}})() }
    });
  }catch(e){
    console.error('payBaseFee error:',e);
    try{ if(typeof PAP!=='undefined') PAP.ui.toast(_payT('payGenericError'),'error'); }catch(_){}
  }
}

