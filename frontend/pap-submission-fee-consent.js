/**
 * pap-submission-fee-consent.js — 제출 직전 게재료 사전 고지 + 동의 게이트
 * 2026-08-12 (도메니코 지시)
 *
 * 왜 만들었나 — 실측
 *   승인됐는데 미결제인 유료 서브미션 18건 = €13,400.
 *   `payment_status='paid'` 인 서브미션은 전체 124건 중 0건이다.
 *   원인의 절반은 코드 버그였고(storedSubmissionType export 누락, 8/11 수정),
 *   나머지 절반은 **작가가 "돈이 나간다"는 사실을 제출 시점에 몰랐다는 것**이다.
 *
 *   기존 안내는 주황색 박스 한 줄이었다. 스크롤 중 지나칠 수 있고, 누르지 않아도
 *   제출이 되고, "언제 청구되는지" 를 말하지 않았다. 그래서 승인 메일을 받고 나서야
 *   €790 을 처음 알게 되고, 그대로 방치된다.
 *
 * 이 모듈이 하는 일
 *   제출 버튼을 누른 뒤 업로드가 시작되기 **전에** 막고, 다음을 명시적으로 알린다.
 *     1) 왜 유료로 분류됐는지 (룩 몇 개인지 / 어느 브랜드 한 종인지 — 구체적으로)
 *     2) 얼마인지 (€380 / €790)
 *     3) **PAP 가 수락한 경우에만 청구된다. 거절되면 0원이다.**
 *     4) 수락되면 MY SUBMISSIONS 에서 직접 결제하고, 결제해야 게재가 진행된다
 *     5) 결제하지 않으면 게재되지 않으며, 그때도 비용은 없다
 *     6) 무료로 만들려면 무엇을 바꾸면 되는지
 *   체크박스를 켜야만 [동의하고 제출] 이 열린다. [돌아가서 수정] 이 기본이다.
 *
 * 설계 원칙
 *   · 금액·판정은 여기서 계산하지 않는다. submission.html 의 _papClassifySubmission()
 *     (= 서버 api/_lib/submissionType.js 의 미러) 결과를 그대로 받는다. 두 곳이
 *     어긋나면 "안내한 금액"과 "청구된 금액"이 달라진다 — 그게 제일 나쁘다.
 *   · free 면 아무것도 뜨지 않는다. 무료 제출자를 겁주지 않는다.
 *   · 취소가 기본값이다. 오클릭으로 €790 에 동의되지 않는다.
 *
 * 사용법
 *   var ok = await window._papFeeConsent(_papClassifySubmission());
 *   if(!ok) return;   // 회원이 돌아가기를 골랐다
 */
(function () {
  'use strict';

  var FEE = { branded: '€790', paid_few_looks: '€380' };

  var T = {
    ko: {
      title: '제출 전 확인 — 게재료가 발생할 수 있습니다',
      whyLabel: '왜 유료인가요',
      feeLabel: '게재료',
      whenLabel: '언제 청구되나요',
      when: 'PAP 편집팀이 심사해서 <b>수락한 경우에만</b> 청구됩니다. 거절되면 <b>한 푼도 청구되지 않습니다.</b>',
      howLabel: '결제 방법',
      how: '수락되면 이메일로 알려드립니다. 로그인 후 <b>MY SUBMISSIONS</b> 에서 직접 결제하시면 됩니다. 결제가 확인된 뒤에 게재가 진행됩니다.',
      ifNotLabel: '결제하지 않으면',
      ifNot: '게재되지 않습니다. 그 경우에도 비용은 발생하지 않으며, 언제든 다시 제출하실 수 있습니다.',
      fixLabel: '무료로 제출하려면',
      fixFewLooks: '룩을 4개 이상으로 늘려 주세요.',
      fixBranded: '여러 브랜드의 의상을 섞어 구성해 주세요. 한 브랜드 옷으로만 이루어진 화보는 브랜디드 콘텐츠로 봅니다.',
      whyFewLooks: '지금 룩이 {n}개입니다. 무료 게재는 룩 4개 이상부터입니다.',
      whyBrandOne: '모든 룩의 의상 크레딧이 <b>{brand}</b> 한 브랜드입니다.',
      whyBrandShared: '모든 룩에 같은 브랜드가 공통으로 들어가 있습니다: <b>{brands}</b>',
      whyBrandGeneric: '특정 브랜드 중심으로 구성된 화보입니다.',
      agree: '위 내용을 읽고 이해했습니다. PAP 가 수락하면 {fee} 를 결제하겠습니다.',
      back: '돌아가서 수정',
      go: '동의하고 제출',
    },
    en: {
      title: 'Before you submit — a publication fee may apply',
      whyLabel: 'Why is this paid',
      feeLabel: 'Publication fee',
      whenLabel: 'When are you charged',
      when: 'Only if the PAP editorial team reviews and <b>accepts</b> your submission. If it is declined, <b>you are charged nothing.</b>',
      howLabel: 'How to pay',
      how: 'If accepted, we email you. Sign in and pay from <b>MY SUBMISSIONS</b>. Publication proceeds once the payment is confirmed.',
      ifNotLabel: 'If you do not pay',
      ifNot: 'The work is not published. You are still charged nothing, and you may submit again at any time.',
      fixLabel: 'To submit for free',
      fixFewLooks: 'Add looks so that you have 4 or more.',
      fixBranded: 'Mix garments from several brands. A set built entirely from one label is treated as branded content.',
      whyFewLooks: 'You currently have {n} look(s). Free publication starts at 4 looks.',
      whyBrandOne: 'Every garment credit across your looks is one brand: <b>{brand}</b>.',
      whyBrandShared: 'The same brand appears in every look: <b>{brands}</b>',
      whyBrandGeneric: 'This set is built around a single brand.',
      agree: 'I have read and understood the above. If PAP accepts my submission, I agree to pay {fee}.',
      back: 'Go back and edit',
      go: 'Agree and submit',
    },
    it: {
      title: 'Prima di inviare — potrebbe essere previsto un costo di pubblicazione',
      whyLabel: 'Perché è a pagamento',
      feeLabel: 'Costo di pubblicazione',
      whenLabel: 'Quando viene addebitato',
      when: 'Solo se il team editoriale PAP esamina e <b>accetta</b> il tuo invio. Se viene rifiutato, <b>non ti viene addebitato nulla.</b>',
      howLabel: 'Come pagare',
      how: 'Se accettato, ti scriviamo via email. Accedi e paga da <b>MY SUBMISSIONS</b>. La pubblicazione procede una volta confermato il pagamento.',
      ifNotLabel: 'Se non paghi',
      ifNot: "Il lavoro non viene pubblicato. Anche in quel caso non ti viene addebitato nulla e puoi inviare di nuovo quando vuoi.",
      fixLabel: 'Per inviare gratuitamente',
      fixFewLooks: 'Aggiungi look fino ad averne almeno 4.',
      fixBranded: 'Mescola capi di più marchi. Un servizio costruito interamente su un solo marchio è considerato branded content.',
      whyFewLooks: 'Al momento hai {n} look. La pubblicazione gratuita parte da 4 look.',
      whyBrandOne: "Tutti i credits d'abbigliamento dei tuoi look sono di un solo marchio: <b>{brand}</b>.",
      whyBrandShared: 'Lo stesso marchio compare in ogni look: <b>{brands}</b>',
      whyBrandGeneric: 'Questo servizio è costruito attorno a un solo marchio.',
      agree: 'Ho letto e compreso quanto sopra. Se PAP accetta il mio invio, accetto di pagare {fee}.',
      back: 'Torna e modifica',
      go: 'Accetto e invio',
    },
    fr: {
      title: "Avant d'envoyer — des frais de publication peuvent s'appliquer",
      whyLabel: 'Pourquoi est-ce payant',
      feeLabel: 'Frais de publication',
      whenLabel: 'Quand êtes-vous facturé',
      when: "Uniquement si l'équipe éditoriale PAP examine et <b>accepte</b> votre envoi. En cas de refus, <b>rien ne vous est facturé.</b>",
      howLabel: 'Comment payer',
      how: 'Si votre envoi est accepté, nous vous écrivons par email. Connectez-vous et payez depuis <b>MY SUBMISSIONS</b>. La publication démarre une fois le paiement confirmé.',
      ifNotLabel: 'Si vous ne payez pas',
      ifNot: "L'œuvre n'est pas publiée. Rien ne vous est facturé pour autant, et vous pouvez soumettre à nouveau quand vous le souhaitez.",
      fixLabel: 'Pour envoyer gratuitement',
      fixFewLooks: "Ajoutez des looks pour en avoir au moins 4.",
      fixBranded: "Mélangez des vêtements de plusieurs marques. Une série entièrement construite autour d'une seule marque est considérée comme du contenu de marque.",
      whyFewLooks: 'Vous avez actuellement {n} look(s). La publication gratuite commence à 4 looks.',
      whyBrandOne: 'Tous les crédits vêtements de vos looks portent une seule marque : <b>{brand}</b>.',
      whyBrandShared: 'La même marque apparaît dans chaque look : <b>{brands}</b>',
      whyBrandGeneric: "Cette série est construite autour d'une seule marque.",
      agree: "J'ai lu et compris ce qui précède. Si PAP accepte mon envoi, j'accepte de payer {fee}.",
      back: 'Revenir et modifier',
      go: "J'accepte et j'envoie",
    },
    es: {
      title: 'Antes de enviar — puede aplicarse una tarifa de publicación',
      whyLabel: 'Por qué es de pago',
      feeLabel: 'Tarifa de publicación',
      whenLabel: 'Cuándo se cobra',
      when: 'Solo si el equipo editorial de PAP revisa y <b>acepta</b> tu envío. Si se rechaza, <b>no se te cobra nada.</b>',
      howLabel: 'Cómo pagar',
      how: 'Si se acepta, te avisamos por email. Inicia sesión y paga desde <b>MY SUBMISSIONS</b>. La publicación continúa una vez confirmado el pago.',
      ifNotLabel: 'Si no pagas',
      ifNot: 'La obra no se publica. Tampoco se te cobra nada y puedes volver a enviarla cuando quieras.',
      fixLabel: 'Para enviar gratis',
      fixFewLooks: 'Añade looks hasta tener 4 o más.',
      fixBranded: 'Combina prendas de varias marcas. Un editorial construido solo con una marca se considera contenido de marca.',
      whyFewLooks: 'Ahora tienes {n} look(s). La publicación gratuita empieza en 4 looks.',
      whyBrandOne: 'Todos los créditos de ropa de tus looks son de una sola marca: <b>{brand}</b>.',
      whyBrandShared: 'La misma marca aparece en todos los looks: <b>{brands}</b>',
      whyBrandGeneric: 'Este editorial está construido en torno a una sola marca.',
      agree: 'He leído y entendido lo anterior. Si PAP acepta mi envío, acepto pagar {fee}.',
      back: 'Volver y editar',
      go: 'Acepto y envío',
    },
    de: {
      title: 'Vor dem Einreichen — es kann eine Veröffentlichungsgebühr anfallen',
      whyLabel: 'Warum kostenpflichtig',
      feeLabel: 'Veröffentlichungsgebühr',
      whenLabel: 'Wann wird abgerechnet',
      when: 'Nur wenn das PAP-Redaktionsteam Ihre Einreichung prüft und <b>annimmt</b>. Bei Ablehnung wird <b>nichts berechnet.</b>',
      howLabel: 'Bezahlung',
      how: 'Bei Annahme melden wir uns per E-Mail. Melden Sie sich an und zahlen Sie unter <b>MY SUBMISSIONS</b>. Die Veröffentlichung erfolgt nach bestätigter Zahlung.',
      ifNotLabel: 'Wenn Sie nicht zahlen',
      ifNot: 'Die Arbeit wird nicht veröffentlicht. Auch dann entstehen keine Kosten, und Sie können jederzeit erneut einreichen.',
      fixLabel: 'Kostenlos einreichen',
      fixFewLooks: 'Ergänzen Sie Looks auf mindestens 4.',
      fixBranded: 'Mischen Sie Kleidung mehrerer Marken. Eine Strecke ausschließlich mit einem Label gilt als Branded Content.',
      whyFewLooks: 'Sie haben derzeit {n} Look(s). Kostenlose Veröffentlichung beginnt ab 4 Looks.',
      whyBrandOne: 'Alle Kleidungs-Credits Ihrer Looks stammen von einer Marke: <b>{brand}</b>.',
      whyBrandShared: 'Dieselbe Marke erscheint in jedem Look: <b>{brands}</b>',
      whyBrandGeneric: 'Diese Strecke ist um eine einzelne Marke herum aufgebaut.',
      agree: 'Ich habe das Obige gelesen und verstanden. Wenn PAP meine Einreichung annimmt, zahle ich {fee}.',
      back: 'Zurück und bearbeiten',
      go: 'Zustimmen und einreichen',
    },
    ja: {
      title: '送信前のご確認 — 掲載料が発生する場合があります',
      whyLabel: '有料になる理由',
      feeLabel: '掲載料',
      whenLabel: '課金されるタイミング',
      when: 'PAP編集チームが審査し<b>受理した場合にのみ</b>請求されます。不採用の場合は<b>一切請求されません。</b>',
      howLabel: 'お支払い方法',
      how: '受理された場合はメールでご連絡します。ログインのうえ<b>MY SUBMISSIONS</b>からお支払いください。入金確認後に掲載を進めます。',
      ifNotLabel: 'お支払いがない場合',
      ifNot: '掲載されません。その場合も費用は発生せず、いつでも再提出いただけます。',
      fixLabel: '無料で提出するには',
      fixFewLooks: 'ルックを4つ以上にしてください。',
      fixBranded: '複数ブランドの衣装を組み合わせてください。1ブランドのみで構成された作品はブランデッドコンテンツとみなします。',
      whyFewLooks: '現在ルックが{n}件です。無料掲載はルック4件以上からです。',
      whyBrandOne: 'すべてのルックの衣装クレジットが<b>{brand}</b>の1ブランドです。',
      whyBrandShared: 'すべてのルックに同じブランドが含まれています：<b>{brands}</b>',
      whyBrandGeneric: '特定のブランドを中心に構成された作品です。',
      agree: '上記を読み、理解しました。PAPが受理した場合、{fee}をお支払いします。',
      back: '戻って修正',
      go: '同意して送信',
    },
    zh: {
      title: '提交前确认 — 可能产生刊登费',
      whyLabel: '为什么收费',
      feeLabel: '刊登费',
      whenLabel: '何时收费',
      when: '仅在 PAP 编辑团队审核并<b>录用</b>时收费。若未录用，<b>不会收取任何费用。</b>',
      howLabel: '如何支付',
      how: '录用后我们会发送邮件通知。登录后在 <b>MY SUBMISSIONS</b> 中支付。确认付款后开始刊登。',
      ifNotLabel: '如果不支付',
      ifNot: '作品不会刊登。届时同样不产生任何费用，您可以随时重新投稿。',
      fixLabel: '免费投稿的方法',
      fixFewLooks: '请将造型增加到 4 组以上。',
      fixBranded: '请混合多个品牌的服装。整组仅使用单一品牌的作品视为品牌内容。',
      whyFewLooks: '当前为 {n} 组造型。免费刊登需 4 组以上。',
      whyBrandOne: '所有造型的服装署名均为同一品牌：<b>{brand}</b>。',
      whyBrandShared: '每组造型中都出现同一品牌：<b>{brands}</b>',
      whyBrandGeneric: '本组作品围绕单一品牌构成。',
      agree: '我已阅读并理解以上内容。若 PAP 录用，我同意支付 {fee}。',
      back: '返回修改',
      go: '同意并提交',
    },
    ru: {
      title: 'Перед отправкой — может взиматься плата за публикацию',
      whyLabel: 'Почему платно',
      feeLabel: 'Плата за публикацию',
      whenLabel: 'Когда списывается',
      when: 'Только если редакция PAP рассмотрит и <b>примет</b> вашу заявку. При отказе <b>с вас ничего не спишут.</b>',
      howLabel: 'Как оплатить',
      how: 'В случае принятия мы напишем на email. Войдите и оплатите в разделе <b>MY SUBMISSIONS</b>. Публикация начнётся после подтверждения оплаты.',
      ifNotLabel: 'Если вы не оплатите',
      ifNot: 'Работа не будет опубликована. Плата при этом не взимается, и вы можете подать заявку снова в любой момент.',
      fixLabel: 'Чтобы подать бесплатно',
      fixFewLooks: 'Добавьте образы, чтобы их было не менее 4.',
      fixBranded: 'Смешайте одежду нескольких брендов. Съёмка целиком из одного бренда считается брендированным контентом.',
      whyFewLooks: 'Сейчас у вас {n} образ(ов). Бесплатная публикация начинается с 4 образов.',
      whyBrandOne: 'Все кредиты одежды во всех образах — один бренд: <b>{brand}</b>.',
      whyBrandShared: 'Один и тот же бренд есть в каждом образе: <b>{brands}</b>',
      whyBrandGeneric: 'Съёмка построена вокруг одного бренда.',
      agree: 'Я прочитал(а) и понял(а) изложенное выше. Если PAP примет мою заявку, я согласен(на) оплатить {fee}.',
      back: 'Вернуться и изменить',
      go: 'Согласен и отправить',
    },
  };

  function lang() {
    var l;
    try { l = localStorage.getItem('pap-lang'); } catch (_) { l = null; }
    return (l && T[l]) ? l : 'en';
  }
  function t(key) { var d = T[lang()] || T.en; return (d[key] != null) ? d[key] : (T.en[key] || ''); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 왜 유료인지를 "이 제출본의 사실"로 설명한다. 일반론은 안 읽힌다.
  function whyText(r) {
    if (r.submissionType === 'paid_few_looks') {
      return t('whyFewLooks').replace('{n}', String(r.realLookCount == null ? 0 : r.realLookCount));
    }
    var brands = Array.isArray(r.clothingBrands) ? r.clothingBrands : [];
    if (r.singleClothingBrand && brands.length === 1) {
      return t('whyBrandOne').replace('{brand}', esc(brands[0]));
    }
    var shared = Array.isArray(r.sharedBrands) ? r.sharedBrands : [];
    if (shared.length) {
      return t('whyBrandShared').replace('{brands}', esc(shared.join(', ')));
    }
    return t('whyBrandGeneric');
  }

  function row(label, html) {
    return '<div style="margin-bottom:14px">'
      + '<div style="font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,.45);margin-bottom:4px">' + esc(label) + '</div>'
      + '<div style="font-size:13px;line-height:1.65;color:rgba(255,255,255,.88)">' + html + '</div>'
      + '</div>';
  }

  /**
   * @param {object} r  _papClassifySubmission() 결과
   * @returns {Promise<boolean>} true = 제출 진행, false = 돌아가서 수정
   */
  window._papFeeConsent = function (r) {
    // 무료 제출자에게는 아무것도 띄우지 않는다.
    if (!r || (r.submissionType !== 'branded' && r.submissionType !== 'paid_few_looks')) {
      return Promise.resolve(true);
    }
    var fee = FEE[r.submissionType] || '';

    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.id = '_papFeeConsentBack';
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.82);'
        + 'display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';

      back.innerHTML =
        '<div style="max-width:560px;width:100%;background:#0d0d0d;border:1px solid rgba(255,179,71,.45);'
        + 'border-radius:3px;padding:28px 26px;box-shadow:0 24px 80px rgba(0,0,0,.7)">'
        + '<div style="font-size:15px;font-weight:700;letter-spacing:.02em;color:#ffb347;margin-bottom:6px">'
        + esc(t('title')) + '</div>'
        + '<div style="font-size:30px;font-weight:700;color:#fff;letter-spacing:.02em;margin:10px 0 20px">'
        + esc(fee) + '</div>'
        + row(t('whyLabel'), whyText(r))
        + row(t('whenLabel'), t('when'))
        + row(t('howLabel'), t('how'))
        + row(t('ifNotLabel'), t('ifNot'))
        + row(t('fixLabel'), esc(r.submissionType === 'paid_few_looks' ? t('fixFewLooks') : t('fixBranded')))
        + '<label style="display:flex;gap:10px;align-items:flex-start;margin:20px 0 18px;cursor:pointer">'
        + '<input type="checkbox" id="_papFeeAgree" style="margin-top:3px;width:16px;height:16px;flex:none;cursor:pointer">'
        + '<span style="font-size:13px;line-height:1.6;color:#fff">'
        + esc(t('agree').replace('{fee}', fee)) + '</span></label>'
        + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
        + '<button type="button" id="_papFeeBack" style="flex:1;min-width:150px;padding:13px;background:none;'
        + 'border:1px solid rgba(255,255,255,.32);color:#fff;font-size:12px;letter-spacing:.1em;cursor:pointer">'
        + esc(t('back')) + '</button>'
        + '<button type="button" id="_papFeeGo" disabled style="flex:1;min-width:150px;padding:13px;'
        + 'background:#ffb347;border:1px solid #ffb347;color:#000;font-size:12px;letter-spacing:.1em;'
        + 'font-weight:700;cursor:not-allowed;opacity:.35">'
        + esc(t('go')) + '</button>'
        + '</div></div>';

      document.body.appendChild(back);
      var prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      var chk = back.querySelector('#_papFeeAgree');
      var go = back.querySelector('#_papFeeGo');
      var no = back.querySelector('#_papFeeBack');

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        document.body.style.overflow = prevOverflow;
        if (back.parentNode) back.parentNode.removeChild(back);
        resolve(result);
      }
      // 체크해야만 열린다. 오클릭으로 €790 에 동의되지 않는다.
      chk.addEventListener('change', function () {
        go.disabled = !chk.checked;
        go.style.cursor = chk.checked ? 'pointer' : 'not-allowed';
        go.style.opacity = chk.checked ? '1' : '.35';
      });
      go.addEventListener('click', function () { if (chk.checked) close(true); });
      no.addEventListener('click', function () { close(false); });
      // 바깥 클릭·ESC 는 "돌아가기". 취소가 기본값이다.
      back.addEventListener('click', function (e) { if (e.target === back) close(false); });
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(false); } }
      document.addEventListener('keydown', onKey, true);

      setTimeout(function () { try { chk.focus(); } catch (_) {} }, 30);
    });
  };
})();
