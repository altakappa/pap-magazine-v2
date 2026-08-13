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
 *     4) 제출과 동시에 결제 '승인'(돈 묶기)이 일어난다 — 청구가 아니다
 *     5) 승인을 마치지 않으면 심사가 시작되지 않으며, 그때도 비용은 없다
 *
 * 🔴 2026-08-13 — 문구를 실제 동작에 맞췄다.
 *   이 파일은 8/12 승인후결제 전환과 같은 날 따로 쓰였고, 옛 흐름("수락되면 MY
 *   SUBMISSIONS 에서 직접 결제")을 말하고 있었다. 실제로는 제출하는 그 자리에서
 *   결제 승인을 요구한다. 실측(프리뷰)에서 확인: 동의하고 제출 → 즉시 PayPal 창.
 *   "나중에 내면 된다" 고 읽은 작가가 곧바로 카드 요구를 만나면 신뢰가 깨진다.
 *   48시간 SLA(넘기면 자동 해제)도 같이 명시한다 — 우리가 지켜야 할 약속이므로
 *   작가에게 먼저 말해두는 편이 낫다.
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
      when: 'PAP 편집팀이 <b>2일 안에</b> 심사합니다. <b>수락한 경우에만</b> 청구되고, 거절되면 <b>한 푼도 청구되지 않습니다.</b> 2일 안에 심사하지 못하면 묶인 금액은 <b>자동으로 해제</b>됩니다.',
      howLabel: '지금 무엇이 일어나나요',
      how: '제출과 동시에 <b>결제 승인</b>을 진행합니다. 금액이 <b>묶이기만 하고 청구되지는 않습니다.</b> PAP 가 수락하면 그때 자동으로 청구되고, 거절하면 <b>즉시 해제</b>됩니다.',
      ifNotLabel: '승인을 마치지 않으면',
      ifNot: '심사가 시작되지 않습니다. 비용은 발생하지 않으며, <b>MY SUBMISSIONS</b> 에서 언제든 이어서 승인하실 수 있습니다.',
      fixLabel: '무료로 제출하려면',
      fixFewLooks: '룩을 4개 이상으로 늘려 주세요.',
      fixBranded: '여러 브랜드의 의상을 섞어 구성해 주세요. 한 브랜드 옷으로만 이루어진 화보는 브랜디드 콘텐츠로 봅니다.',
      whyFewLooks: '지금 룩이 {n}개입니다. 무료 게재는 룩 4개 이상부터입니다.',
      whyBrandOne: '모든 룩의 의상 크레딧이 <b>{brand}</b> 한 브랜드입니다.',
      whyBrandShared: '모든 룩에 같은 브랜드가 공통으로 들어가 있습니다: <b>{brands}</b>',
      whyBrandGeneric: '특정 브랜드 중심으로 구성된 화보입니다.',
      agree: '위 내용을 읽고 이해했습니다. 지금 {fee} 결제 승인을 진행하고, PAP 가 수락하면 청구되는 데 동의합니다.',
      back: '돌아가서 수정',
      go: '동의하고 제출',
    },
    en: {
      title: 'Before you submit — a publication fee may apply',
      whyLabel: 'Why is this paid',
      feeLabel: 'Publication fee',
      whenLabel: 'When are you charged',
      when: 'The PAP editorial team reviews <b>within 2 days</b>. You are charged <b>only if it is accepted</b>; if it is declined, <b>you are charged nothing.</b> If we do not review within 2 days, the hold is <b>released automatically.</b>',
      howLabel: 'What happens now',
      how: 'Submitting also starts a <b>payment authorization</b>. The amount is <b>only held, not charged.</b> If PAP accepts, it is charged then; if PAP declines, the hold is <b>released immediately.</b>',
      ifNotLabel: 'If you do not complete the authorization',
      ifNot: 'Review does not begin. You are charged nothing, and you can finish the authorization any time from <b>MY SUBMISSIONS</b>.',
      fixLabel: 'To submit for free',
      fixFewLooks: 'Add looks so that you have 4 or more.',
      fixBranded: 'Mix garments from several brands. A set built entirely from one label is treated as branded content.',
      whyFewLooks: 'You currently have {n} look(s). Free publication starts at 4 looks.',
      whyBrandOne: 'Every garment credit across your looks is one brand: <b>{brand}</b>.',
      whyBrandShared: 'The same brand appears in every look: <b>{brands}</b>',
      whyBrandGeneric: 'This set is built around a single brand.',
      agree: 'I have read and understood the above. I authorize a hold of {fee} now, to be charged only if PAP accepts my submission.',
      back: 'Go back and edit',
      go: 'Agree and submit',
    },
    it: {
      title: 'Prima di inviare — potrebbe essere previsto un costo di pubblicazione',
      whyLabel: 'Perché è a pagamento',
      feeLabel: 'Costo di pubblicazione',
      whenLabel: 'Quando viene addebitato',
      when: 'Il team editoriale PAP esamina <b>entro 2 giorni</b>. Ti viene addebitato <b>solo se accettato</b>; se rifiutato, <b>non ti viene addebitato nulla.</b> Se non esaminiamo entro 2 giorni, il blocco viene <b>rilasciato automaticamente.</b>',
      howLabel: 'Cosa succede ora',
      how: "Con l'invio parte anche un'<b>autorizzazione di pagamento</b>. L'importo viene <b>solo bloccato, non addebitato.</b> Se PAP accetta, viene addebitato in quel momento; se rifiuta, il blocco viene <b>rilasciato subito.</b>",
      ifNotLabel: "Se non completi l'autorizzazione",
      ifNot: "La revisione non inizia. Non ti viene addebitato nulla e puoi completare l'autorizzazione quando vuoi da <b>MY SUBMISSIONS</b>.",
      fixLabel: 'Per inviare gratuitamente',
      fixFewLooks: 'Aggiungi look fino ad averne almeno 4.',
      fixBranded: 'Mescola capi di più marchi. Un servizio costruito interamente su un solo marchio è considerato branded content.',
      whyFewLooks: 'Al momento hai {n} look. La pubblicazione gratuita parte da 4 look.',
      whyBrandOne: "Tutti i credits d'abbigliamento dei tuoi look sono di un solo marchio: <b>{brand}</b>.",
      whyBrandShared: 'Lo stesso marchio compare in ogni look: <b>{brands}</b>',
      whyBrandGeneric: 'Questo servizio è costruito attorno a un solo marchio.',
      agree: 'Ho letto e compreso quanto sopra. Autorizzo ora un blocco di {fee}, che sarà addebitato solo se PAP accetta il mio invio.',
      back: 'Torna e modifica',
      go: 'Accetto e invio',
    },
    fr: {
      title: "Avant d'envoyer — des frais de publication peuvent s'appliquer",
      whyLabel: 'Pourquoi est-ce payant',
      feeLabel: 'Frais de publication',
      whenLabel: 'Quand êtes-vous facturé',
      when: "L'équipe éditoriale PAP examine <b>sous 2 jours</b>. Vous n'êtes débité <b>que si l'envoi est accepté</b> ; en cas de refus, <b>rien ne vous est facturé.</b> Sans examen sous 2 jours, le blocage est <b>levé automatiquement.</b>",
      howLabel: 'Ce qui se passe maintenant',
      how: "L'envoi lance aussi une <b>autorisation de paiement</b>. Le montant est <b>seulement bloqué, pas débité.</b> Si PAP accepte, il est débité à ce moment-là ; en cas de refus, le blocage est <b>levé immédiatement.</b>",
      ifNotLabel: "Si vous ne terminez pas l'autorisation",
      ifNot: "L'examen ne commence pas. Rien ne vous est facturé et vous pouvez terminer l'autorisation à tout moment depuis <b>MY SUBMISSIONS</b>.",
      fixLabel: 'Pour envoyer gratuitement',
      fixFewLooks: "Ajoutez des looks pour en avoir au moins 4.",
      fixBranded: "Mélangez des vêtements de plusieurs marques. Une série entièrement construite autour d'une seule marque est considérée comme du contenu de marque.",
      whyFewLooks: 'Vous avez actuellement {n} look(s). La publication gratuite commence à 4 looks.',
      whyBrandOne: 'Tous les crédits vêtements de vos looks portent une seule marque : <b>{brand}</b>.',
      whyBrandShared: 'La même marque apparaît dans chaque look : <b>{brands}</b>',
      whyBrandGeneric: "Cette série est construite autour d'une seule marque.",
      agree: "J'ai lu et compris ce qui précède. J'autorise dès maintenant un blocage de {fee}, débité uniquement si PAP accepte mon envoi.",
      back: 'Revenir et modifier',
      go: "J'accepte et j'envoie",
    },
    es: {
      title: 'Antes de enviar — puede aplicarse una tarifa de publicación',
      whyLabel: 'Por qué es de pago',
      feeLabel: 'Tarifa de publicación',
      whenLabel: 'Cuándo se cobra',
      when: 'El equipo editorial de PAP revisa <b>en un plazo de 2 días</b>. Solo se te cobra <b>si se acepta</b>; si se rechaza, <b>no se te cobra nada.</b> Si no revisamos en 2 días, la retención se <b>libera automáticamente.</b>',
      howLabel: 'Qué ocurre ahora',
      how: 'Al enviar también se inicia una <b>autorización de pago</b>. El importe <b>solo queda retenido, no se cobra.</b> Si PAP acepta, se cobra en ese momento; si lo rechaza, la retención se <b>libera de inmediato.</b>',
      ifNotLabel: 'Si no completas la autorización',
      ifNot: 'La revisión no comienza. No se te cobra nada y puedes completar la autorización cuando quieras desde <b>MY SUBMISSIONS</b>.',
      fixLabel: 'Para enviar gratis',
      fixFewLooks: 'Añade looks hasta tener 4 o más.',
      fixBranded: 'Combina prendas de varias marcas. Un editorial construido solo con una marca se considera contenido de marca.',
      whyFewLooks: 'Ahora tienes {n} look(s). La publicación gratuita empieza en 4 looks.',
      whyBrandOne: 'Todos los créditos de ropa de tus looks son de una sola marca: <b>{brand}</b>.',
      whyBrandShared: 'La misma marca aparece en todos los looks: <b>{brands}</b>',
      whyBrandGeneric: 'Este editorial está construido en torno a una sola marca.',
      agree: 'He leído y entendido lo anterior. Autorizo ahora una retención de {fee}, que se cobrará solo si PAP acepta mi envío.',
      back: 'Volver y editar',
      go: 'Acepto y envío',
    },
    de: {
      title: 'Vor dem Einreichen — es kann eine Veröffentlichungsgebühr anfallen',
      whyLabel: 'Warum kostenpflichtig',
      feeLabel: 'Veröffentlichungsgebühr',
      whenLabel: 'Wann wird abgerechnet',
      when: 'Das PAP-Redaktionsteam prüft <b>innerhalb von 2 Tagen</b>. Abgebucht wird <b>nur bei Annahme</b>; bei Ablehnung wird <b>nichts berechnet.</b> Ohne Prüfung innerhalb von 2 Tagen wird die Reservierung <b>automatisch aufgehoben.</b>',
      howLabel: 'Was jetzt passiert',
      how: 'Mit dem Absenden startet auch eine <b>Zahlungsautorisierung</b>. Der Betrag wird <b>nur reserviert, nicht abgebucht.</b> Bei Annahme wird er dann abgebucht; bei Ablehnung wird die Reservierung <b>sofort aufgehoben.</b>',
      ifNotLabel: 'Wenn Sie die Autorisierung nicht abschließen',
      ifNot: 'Die Prüfung beginnt nicht. Es entstehen keine Kosten, und Sie können die Autorisierung jederzeit unter <b>MY SUBMISSIONS</b> abschließen.',
      fixLabel: 'Kostenlos einreichen',
      fixFewLooks: 'Ergänzen Sie Looks auf mindestens 4.',
      fixBranded: 'Mischen Sie Kleidung mehrerer Marken. Eine Strecke ausschließlich mit einem Label gilt als Branded Content.',
      whyFewLooks: 'Sie haben derzeit {n} Look(s). Kostenlose Veröffentlichung beginnt ab 4 Looks.',
      whyBrandOne: 'Alle Kleidungs-Credits Ihrer Looks stammen von einer Marke: <b>{brand}</b>.',
      whyBrandShared: 'Dieselbe Marke erscheint in jedem Look: <b>{brands}</b>',
      whyBrandGeneric: 'Diese Strecke ist um eine einzelne Marke herum aufgebaut.',
      agree: 'Ich habe das Obige gelesen und verstanden. Ich autorisiere jetzt eine Reservierung von {fee}, die nur bei Annahme durch PAP abgebucht wird.',
      back: 'Zurück und bearbeiten',
      go: 'Zustimmen und einreichen',
    },
    ja: {
      title: '送信前のご確認 — 掲載料が発生する場合があります',
      whyLabel: '有料になる理由',
      feeLabel: '掲載料',
      whenLabel: '課金されるタイミング',
      when: 'PAP編集チームが<b>2日以内</b>に審査します。<b>受理した場合にのみ</b>請求され、不採用の場合は<b>一切請求されません。</b>2日以内に審査できなかった場合、確保した金額は<b>自動的に解除</b>されます。',
      howLabel: '今なにが起こりますか',
      how: '提出と同時に<b>決済の承認</b>を行います。金額は<b>確保されるだけで、請求はされません。</b>PAP が受理した時点で請求され、不採用の場合は<b>即座に解除</b>されます。',
      ifNotLabel: '承認を完了しない場合',
      ifNot: '審査が始まりません。費用は発生せず、<b>MY SUBMISSIONS</b> からいつでも承認を続けられます。',
      fixLabel: '無料で提出するには',
      fixFewLooks: 'ルックを4つ以上にしてください。',
      fixBranded: '複数ブランドの衣装を組み合わせてください。1ブランドのみで構成された作品はブランデッドコンテンツとみなします。',
      whyFewLooks: '現在ルックが{n}件です。無料掲載はルック4件以上からです。',
      whyBrandOne: 'すべてのルックの衣装クレジットが<b>{brand}</b>の1ブランドです。',
      whyBrandShared: 'すべてのルックに同じブランドが含まれています：<b>{brands}</b>',
      whyBrandGeneric: '特定のブランドを中心に構成された作品です。',
      agree: '上記を読み、理解しました。いま {fee} の承認（確保）を行い、PAP が受理した場合にのみ請求されることに同意します。',
      back: '戻って修正',
      go: '同意して送信',
    },
    zh: {
      title: '提交前确认 — 可能产生刊登费',
      whyLabel: '为什么收费',
      feeLabel: '刊登费',
      whenLabel: '何时收费',
      when: 'PAP 编辑团队将在 <b>2 天内</b>完成审核。<b>仅在录用时</b>扣款；若未录用，<b>不会收取任何费用。</b>若 2 天内未完成审核，冻结金额将<b>自动解除。</b>',
      howLabel: '现在会发生什么',
      how: '提交的同时会进行<b>支付授权</b>。金额<b>仅被冻结，不会扣款。</b>PAP 录用后才会扣款；若未录用，冻结将<b>立即解除。</b>',
      ifNotLabel: '若未完成授权',
      ifNot: '审核不会开始。不会产生任何费用，您可以随时在 <b>MY SUBMISSIONS</b> 中继续完成授权。',
      fixLabel: '免费投稿的方法',
      fixFewLooks: '请将造型增加到 4 组以上。',
      fixBranded: '请混合多个品牌的服装。整组仅使用单一品牌的作品视为品牌内容。',
      whyFewLooks: '当前为 {n} 组造型。免费刊登需 4 组以上。',
      whyBrandOne: '所有造型的服装署名均为同一品牌：<b>{brand}</b>。',
      whyBrandShared: '每组造型中都出现同一品牌：<b>{brands}</b>',
      whyBrandGeneric: '本组作品围绕单一品牌构成。',
      agree: '我已阅读并理解以上内容。我同意现在冻结 {fee}，仅在 PAP 录用时扣款。',
      back: '返回修改',
      go: '同意并提交',
    },
    ru: {
      title: 'Перед отправкой — может взиматься плата за публикацию',
      whyLabel: 'Почему платно',
      feeLabel: 'Плата за публикацию',
      whenLabel: 'Когда списывается',
      when: 'Редакция PAP рассматривает заявку <b>в течение 2 дней</b>. Списание происходит <b>только при принятии</b>; при отказе <b>с вас ничего не спишут.</b> Если мы не рассмотрим заявку за 2 дня, резерв <b>снимается автоматически.</b>',
      howLabel: 'Что происходит сейчас',
      how: 'Вместе с отправкой начинается <b>авторизация платежа</b>. Сумма <b>только резервируется, а не списывается.</b> Если PAP примет заявку, тогда и спишется; при отказе резерв <b>снимается сразу.</b>',
      ifNotLabel: 'Если не завершить авторизацию',
      ifNot: 'Рассмотрение не начнётся. Плата не взимается, и вы можете завершить авторизацию в любой момент в разделе <b>MY SUBMISSIONS</b>.',
      fixLabel: 'Чтобы подать бесплатно',
      fixFewLooks: 'Добавьте образы, чтобы их было не менее 4.',
      fixBranded: 'Смешайте одежду нескольких брендов. Съёмка целиком из одного бренда считается брендированным контентом.',
      whyFewLooks: 'Сейчас у вас {n} образ(ов). Бесплатная публикация начинается с 4 образов.',
      whyBrandOne: 'Все кредиты одежды во всех образах — один бренд: <b>{brand}</b>.',
      whyBrandShared: 'Один и тот же бренд есть в каждом образе: <b>{brands}</b>',
      whyBrandGeneric: 'Съёмка построена вокруг одного бренда.',
      agree: 'Я прочитал(а) и понял(а) изложенное выше. Я разрешаю зарезервировать {fee} сейчас; списание произойдёт только если PAP примет мою заявку.',
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
