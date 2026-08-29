/**
 * PAP Community V2 — Feature Enhancement Module
 * -----------------------------------------------
 * Loads AFTER community.html's inline script.
 * Overrides/extends existing functions to add:
 *
 * Phase 1: Post edit, Share, Report, Pin, AI matching, Project management
 * Phase 2: Follow, Notifications, DM, Profile, Moderation
 * Phase 3: Badges, Moodboard, Collaboration board
 */
(function(){
'use strict';

// ── _withLang(url) — append the active community language as ?lang= ────
// Server endpoints (posts, moodboards, comments, members) auto-translate
// UGC fields when this param is present. Same-lang and short-text are
// short-circuited server-side, and translations are DB-cached so the cost
// is a one-time charge per (content, target-lang) pair.
function _withLang(url){
  var l = (typeof lang !== 'undefined' && lang) || (function(){
    try { return localStorage.getItem('pap-lang') || 'ko'; } catch(e){ return 'ko'; }
  })();
  var sep = url.indexOf('?') === -1 ? '?' : '&';
  return url + sep + 'lang=' + encodeURIComponent(l);
}

// ── 9-language UI strings (2026-07-26) ──────────────────────────────
// Community feed UI was ko/en only. _cL(ko,en) resolves the active PAP
// language (it/fr/es/ja/zh/ru/de) via _CV_I18N; ko/en literals at each
// call site stay as exact fallbacks. Keyed by the Korean source string.
var _CV_I18N = {"제목과 내용을 입력하세요":{"it":"Inserisci titolo e contenuto","fr":"Veuillez saisir le titre et le contenu","es":"Introduce el título y el contenido","ja":"タイトルと内容を入力してください","zh":"请输入标题和内容","ru":"Введите заголовок и текст","de":"Bitte Titel und Inhalt eingeben"},"링크가 복사되었습니다":{"it":"Link copiato negli appunti","fr":"Lien copié dans le presse-papiers","es":"Enlace copiado al portapapeles","ja":"リンクをコピーしました","zh":"链接已复制到剪贴板","ru":"Ссылка скопирована в буфер обмена","de":"Link in die Zwischenablage kopiert"},"신고가 접수되었습니다":{"it":"Segnalazione inviata","fr":"Signalement envoyé","es":"Reporte enviado","ja":"報告を受け付けました","zh":"举报已提交","ru":"Жалоба отправлена","de":"Meldung übermittelt"},"신고가 접수되었습니다 (데모)":{"it":"Segnalazione inviata (demo)","fr":"Signalement envoyé (démo)","es":"Reporte enviado (demo)","ja":"報告を受けけました（デモ）","zh":"举报已提交（演示）","ru":"Жалоба отправлена (демо)","de":"Meldung übermittelt (Demo)"},"수정":{"it":"Modifica","fr":"Modifier","es":"Editar","ja":"編集","zh":"编辑","ru":"Изменить","de":"Bearbeiten"},"팔로우":{"it":"Segui","fr":"Suivre","es":"Seguir","ja":"フォロー","zh":"关注","ru":"Подписаться","de":"Folgen"},"팔로잉":{"it":"Segui già","fr":"Abonné","es":"Siguiendo","ja":"フォロー中","zh":"已关注","ru":"Вы подписаны","de":"Abonniert"},"멤버 프로필에서 메시지를 보낼 수 있어요":{"it":"Puoi inviare un messaggio dal profilo di un membro","fr":"Vous pouvez envoyer un message depuis le profil d'un membre","es":"Puedes enviar un mensaje desde el perfil de un miembro","ja":"メンバーのプロフィールからメッセージを送れます","zh":"您可以从任何成员的个人资料发送消息","ru":"Вы можете отправить сообщение из профиля любого участника","de":"Sie können über jedes Mitgliedsprofil eine Nachricht senden"},"첫 메시지를 보내보세요":{"it":"Invia il tuo primo messaggio","fr":"Envoyez votre premier message","es":"Envía tu primer mensaje","ja":"最初のメッセージを送ってみましょう","zh":"发送你的第一条消息","ru":"Отправьте первое сообщение","de":"Senden Sie Ihre erste Nachricht"},"메시지가 없습니다":{"it":"Ancora nessun messaggio","fr":"Aucun message pour l'instant","es":"Aún no hay mensajes","ja":"メッセージはまだありません","zh":"暂无消息","ru":"Сообщений пока нет","de":"Noch keine Nachrichten"},"수신자 정보가 없어요":{"it":"Nessun destinatario — chiudi e riapri la chat","fr":"Aucun destinataire — fermez et rouvrez la conversation","es":"Sin destinatario — cierra y vuelve a abrir el chat","ja":"受信者がいません — チャットを閉じて再度開いてください","zh":"无收件人 — 请关闭并重新打开聊天","ru":"Нет получателя — закройте и снова откройте чат","de":"Kein Empfänger — Chat schließen und erneut öffnen"},"이 카드는 데모 데이터예요 — 디렉토리에서 회원을 찾아 메시지를 보내주세요":{"it":"Questa scheda è un dato demo — trova membri nella scheda Directory per inviare messaggi","fr":"Cette carte est une donnée de démo — trouvez des membres dans l'onglet Répertoire pour envoyer des messages","es":"Esta tarjeta es de demostración — busca miembros en la pestaña Directorio para enviar mensajes","ja":"このカードはデモデータです — ディレクトリタブでメンバーを探してメッセージを送ってください","zh":"此卡片为演示数据 — 请在目录标签中查找成员以发送消息","ru":"Эта карточка — демо-данные — найдите участников во вкладке «Каталог», чтобы отправлять сообщения","de":"Diese Karte enthält Demodaten — finden Sie Mitglieder im Tab „Verzeichnis“, um Nachrichten zu senden"},"메시지":{"it":"Messaggio","fr":"Message","es":"Mensaje","ja":"メッセージ","zh":"消息","ru":"Сообщение","de":"Nachricht"},"불러오는 중…":{"it":"Caricamento…","fr":"Chargement…","es":"Cargando…","ja":"読み込み中…","zh":"加载中…","ru":"Загрузка…","de":"Wird geladen…"},"회원":{"it":"Membro","fr":"Membre","es":"Miembro","ja":"会員","zh":"会员","ru":"Участник","de":"Mitglied"},"무드보드":{"it":"Bacheche","fr":"Tableaux","es":"Tableros","ja":"ボード","zh":"灵感板","ru":"Доски","de":"Boards"},"팔로워":{"it":"Follower","fr":"Abonnés","es":"Seguidores","ja":"フォロワー","zh":"粉丝","ru":"Подписчики","de":"Follower"},"스크랩":{"it":"Salvati","fr":"Enregistrements","es":"Guardados","ja":"スクラップ","zh":"收藏","ru":"Сохранённое","de":"Sammlungen"},"본인 프로필":{"it":"Il tuo profilo","fr":"Votre profil","es":"Tu perfil","ja":"自分のプロフィール","zh":"你的个人资料","ru":"Ваш профиль","de":"Ihr Profil"},"웹사이트 ↗":{"it":"Sito web ↗","fr":"Site web ↗","es":"Sitio web ↗","ja":"ウェブサイト ↗","zh":"网站 ↗","ru":"Сайт ↗","de":"Website ↗"},"최근 무드보드":{"it":"Bacheche recenti","fr":"Tableaux récents","es":"Tableros recientes","ja":"最近のムードボード","zh":"最近的灵感板","ru":"Недавние доски","de":"Neueste Moodboards"},"최근 스크랩":{"it":"Salvati recenti","fr":"Enregistrements récents","es":"Guardados recientes","ja":"最近のスクラップ","zh":"最近的收藏","ru":"Недавно сохранённое","de":"Neueste Sammlungen"},"아직 활동이 없어요":{"it":"Ancora nessuna attività","fr":"Aucune activité pour l'instant","es":"Aún no hay actividad","ja":"まだ活動がありません","zh":"暂无动态","ru":"Пока нет активности","de":"Noch keine Aktivität"},"새 뱃지 획득를 닭":{"it":"Nuovo badge: ","fr":"Nouveau badge : ","es":"Nueva insignia: ","ja":"新しいバッジ進: ","zh":"获得新徽章: ","ru":"Новый значок: ","de":"Neues Abzeichen: "},"제목을 입력하세요":{"it":"Inserisci un titolo","fr":"Saisissez un titre","es":"Introduce un título","ja":"タイトルを入力してください","zh":"请输入标题","ru":"Введите заголовок","de":"Titel eingeben"}," 보냜":{"it":" bacheche","fr":" tableaux","es":" tableros","ja":" ボード","zh":" 个灵感板","ru":" досок","de":" Boards"}," 스킬랩":{"it":" salvati","fr":" enregistrements","es":" guardados","ja":" スクラップ","zh":" 个收藏","ru":" сохранённых","de":" Sammlungen"},"원문 보기":{"it":"Vedi originale","fr":"Voir l'original","es":"Ver original","ja":"原文を見る","zh":"查看原文","ru":"Показать оригинал","de":"Original anzeigen"},"댓글":{"it":"Commenti","fr":"Commentaires","es":"Comentarios","ja":"コメント","zh":"评论","ru":"Комментарии","de":"Kommentare"},"댓글 불러오는 중...":{"it":"Caricamento commenti...","fr":"Chargement des commentaires...","es":"Cargando comentarios...","ja":"コメントを��み込み中...","zh":"正在加载评论...","ru":"Загрузка комментариев...","de":"Kommentare werden geladen..."},"이 보드에 대한 생각을 남겨보세요...":{"it":"Lascia un pensiero su questa bacheca...","fr":"Partagez votre avis sur ce tableau...","es":"Deja tu opinión sobre este tablero...","ja":"このボードについての考えを残してください...","zh":"分享你对这个灵感板的想法...","ru":"Оставьте мысль об этой доске...","de":"Teilen Sie Ihre Gedanken zu diesem Board..."},"등록":{"it":"Pubblica","fr":"Publier","es":"Publicar","ja":"投稿","zh":"发布","ru":"Опубликовать","de":"Posten"},"아직 댓글이 없어요. 첫 댓글을 남겨보세요.":{"it":"Ancora nessun commento. Sii il primo.","fr":"Aucun commentaire. Soyez le premier.","es":"Aún no hay comentarios. Sé el primero.","ja":"まだコメントがありません。最初のコメントを残しましょう。","zh":"还没有评论。来抢沙发吧。","ru":"Пока нет комментариев. Будьте первым.","de":"Noch keine Kommentare. Seien Sie der Erste."},"댓글을 삭제할까요?":{"it":"Eliminare questo commento?","fr":"Supprimer ce commentaire ?","es":"¿Eliminar este comentario?","ja":"このコメントを削除しますか？","zh":"删除这条评论？","ru":"Удалить этот комментарий?","de":"Diesen Kommentar löschen?"},"번역 보기":{"it":"Vedi traduzione","fr":"Voir la traduction","es":"Ver traducción","ja":"翻訳を見る","zh":"查看翻译","ru":"Показать перевод","de":"Übersetzung anzeigen"},"이미지 파일만 업로드할 수 있어요":{"it":"Sono supportati solo file immagine","fr":"Seuls les fichiers image sont pris en charge","es":"Solo se admiten archivos de imagen","ja":"画像ファイルのみアップロードできます","zh":"仅支持图片文件","ru":"Поддерживаются только изображения","de":"Nur Bilddateien werden unterstützt"},"업로드 실패":{"it":"Caricamento non riuscito","fr":"Échec du téléversement","es":"Error al subir","ja":"アップロード失敗","zh":"上传失败","ru":"Ошибка загрузки","de":"Upload fehlgeschlagen"},"이미지 URL을 입력하세요":{"it":"Inserisci un URL immagine","fr":"Saisissez une URL d'image","es":"Introduce una URL de imagen","ja":"画像URLを入力してください","zh":"请输入图片URL","ru":"Введите URL изображения","de":"Bild-URL eingeben"}};
function _cLang(){ return (typeof lang!=='undefined'&&lang) || (function(){try{return localStorage.getItem('pap-lang')||'ko';}catch(e){return 'ko';}})(); }
function _cL(ko,en){ var l=_cLang(); if(l==='ko') return ko; var m=_CV_I18N[ko]; if(m&&m[l]) return m[l]; return en; }


// ── Robust login check (fixes alertLogin timing bug) ────────────────────
// Background: the page-level alertLogin() in community.html only checks
// SB.user, which Supabase populates ASYNCHRONOUSLY on init. If a user
// clicks an action button before SB session retrieval completes, alertLogin
// thinks they're logged out and redirects to auth.html — which then
// redirects them to mypage.html (because they ARE actually logged in via
// PAP cookie-based JWT). Net result: clicking "+ 스크랩 추가" lands the
// user on mypage instead of opening the scrap modal.
//
// _canActLocal trusts the pap-token localStorage key (synchronously
// available from page load — set by PAP.auth on cookie-JWT login). Used by
// the new playground primitives (scrapbook, moodboard create, editorial
// bridge). Older functions still use alertLogin(); fixing them is a
// separate concern (some have flow that *does* want a redirect).
function _canActLocal(){
  try {
    if(typeof isLoggedIn === 'function' && isLoggedIn()) return true;
    if(typeof SB !== 'undefined' && SB.user) return true;
    if(localStorage.getItem('pap-token')) return true;
  } catch(e) {}
  if(typeof showToast === 'function'){
    showToast((typeof lang !== 'undefined' && lang === 'ko')
      ? '로그인이 필요합니다'
      : 'Login required');
  }
  return false;
}

// ======================================================================
// PHASE 1: CORE FEATURE COMPLETION
// ======================================================================

// ── 1.1 POST EDIT ──
window.editPost = function(postId){
  var post = allPosts.find(function(p){ return p.id == postId; });
  if(!post) return;
  // Check ownership
  if(SB.user && post._userId && post._userId !== SB.user.id) return;

  var overlay = document.getElementById('writeOverlay');
  if(!overlay) return;
  overlay.classList.add('active');
  document.getElementById('postTitle').value = typeof post.title==='object' ? tPost(post.title,post) : post.title;
  document.getElementById('postContent').innerHTML = typeof post.content==='object' ? tPost(post.content,post) : post.content;
  var catSel = document.getElementById('postCategory');
  if(catSel) catSel.value = post.cat || 'free';

  // Change submit button to update mode
  var submitBtn = overlay.querySelector('.write-submit');
  if(submitBtn){
    submitBtn.setAttribute('data-edit-id', postId);
    submitBtn.textContent = L[lang].submitBtn || 'Update';
  }
};

// Override submitPost to handle edit mode
var _origSubmitPost = window.submitPost;
window.submitPost = function(){
  var overlay = document.getElementById('writeOverlay');
  var submitBtn = overlay ? overlay.querySelector('.write-submit') : null;
  var editId = submitBtn ? submitBtn.getAttribute('data-edit-id') : null;

  if(editId){
    // Edit mode
    if(!alertLogin()) return;
    var title = document.getElementById('postTitle').value.trim();
    var content = document.getElementById('postContent').innerHTML.trim();
    var catSel = document.getElementById('postCategory');
    var category = catSel ? catSel.value : 'free';
    if(!title || !content){ alert(_cL('제목과 내용을 입력하세요','Please enter title and content')); return; }

    if(SB.client){
      SB.updatePost(editId, { title: title, content: content, category: category }).then(function(updated){
        if(updated){
          var post = allPosts.find(function(p){ return p.id == editId; });
          if(post){
            post.title = { [lang]: title };
            post.content = { [lang]: content };
            post.cat = category;
          }
          submitBtn.removeAttribute('data-edit-id');
          closeWrite();
          updatePostTable();
        }
      });
    } else {
      var post = allPosts.find(function(p){ return p.id == editId; });
      if(post){
        post.title = { [lang]: title };
        post.content = { [lang]: content };
        post.cat = category;
      }
      submitBtn.removeAttribute('data-edit-id');
      closeWrite();
      updatePostTable();
    }
  } else {
    _origSubmitPost();
  }
};

// ── 1.2 SHARE FUNCTION ──
window.sharePost = function(postId){
  var post = allPosts.find(function(p){ return p.id == postId; });
  if(!post) return;
  var title = typeof post.title==='object' ? tPost(post.title,post) : post.title;
  var url = window.location.origin + '/community?post=' + postId;

  if(navigator.share){
    navigator.share({ title: 'PAP Magazine — ' + title, url: url }).catch(function(){});
  } else {
    // Fallback: copy to clipboard
    navigator.clipboard.writeText(url).then(function(){
      showToast(_cL('링크가 복사되었습니다','Link copied to clipboard'));
    }).catch(function(){
      // Final fallback
      var inp = document.createElement('input');
      inp.value = url;
      document.body.appendChild(inp);
      inp.select();
      document.execCommand('copy');
      document.body.removeChild(inp);
      showToast(_cL('링크가 복사되었습니다','Link copied to clipboard'));
    });
  }
};

// ── 1.3 REPORT FUNCTION ──
window.reportContent = function(targetType, targetId){
  if(!alertLogin()) return;
  var reasons = {
    ko: ['스팸 또는 광고','부적절한 콘텐츠','혐오 발언','저작권 침해','기타'],
    en: ['Spam or advertising','Inappropriate content','Hate speech','Copyright infringement','Other'],
    it: ['Spam o pubblicità','Contenuto inappropriato','Incitamento all\'odio','Violazione copyright','Altro'],
    fr: ['Spam ou publicité','Contenu inapproprié','Discours haineux','Violation droits d\'auteur','Autre'],
    es: ['Spam o publicidad','Contenido inapropiado','Discurso de odio','Violación de copyright','Otro'],
    ja: ['スパムまたは広告','不適切なコンテンツ','ヘイトスピーチ','著作権侵害','その他'],
    zh: ['垃圾或广告','不当内容','仇恨言论','版权侵犯','其他'],
    ru: ['Спам или реклама','Неуместный контент','Разжигание ненависти','Нарушение авторских прав','Другое']
  };
  var r = reasons[lang] || reasons.en;
  var titles = { ko:'신고 사유를 선택하세요',en:'Select a reason',it:'Seleziona un motivo',fr:'Sélectionnez un motif',es:'Seleccione un motivo',ja:'理由を選択してください',zh:'请选择举报原因',ru:'Выберите причину' };

  var html = '<div id="reportModal" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:10002;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-family:Montserrat,sans-serif">';
  html += '<div style="background:#fff;padding:32px;max-width:400px;width:90%">';
  html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 16px;letter-spacing:.05em">'+(titles[lang]||titles.en)+'</h3>';
  r.forEach(function(reason, i){
    html += '<label style="display:block;padding:10px 0;font-size:13px;cursor:pointer;border-bottom:1px solid #eee"><input type="radio" name="reportReason" value="'+escHtml(reason)+'" style="margin-right:8px"'+(i===0?' checked':'')+'>'+escHtml(reason)+'</label>';
  });
  html += '<div style="display:flex;gap:12px;margin-top:20px">';
  html += '<button onclick="document.getElementById(\'reportModal\').remove()" style="flex:1;padding:10px;font-size:11px;font-weight:700;letter-spacing:.1em;background:transparent;border:1.5px solid #000;cursor:pointer;font-family:Montserrat,sans-serif">'+(L[lang].cancelBtn||'CANCEL')+'</button>';
  html += '<button onclick="submitReport(\''+targetType+'\',\''+targetId+'\')" style="flex:1;padding:10px;font-size:11px;font-weight:700;letter-spacing:.1em;background:#000;color:#fff;border:1.5px solid #000;cursor:pointer;font-family:Montserrat,sans-serif">'+(L[lang].btnReport||'REPORT')+'</button>';
  html += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
};

window.submitReport = function(targetType, targetId){
  var selected = document.querySelector('input[name="reportReason"]:checked');
  if(!selected) return;
  var reason = selected.value;

  if(SB.client){
    fetch('/api/community/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ target_type: targetType, target_id: targetId, reason: reason })
    }).then(function(r){ return r.json(); }).then(function(data){
      document.getElementById('reportModal').remove();
      if(data.report){
        showToast(_cL('신고가 접수되었습니다','Report submitted successfully'));
      } else {
        showToast(data.message || 'Error');
      }
    }).catch(function(){
      document.getElementById('reportModal').remove();
      showToast(_cL('신고가 접수되었습니다','Report submitted'));
    });
  } else {
    document.getElementById('reportModal').remove();
    showToast(_cL('신고가 접수되었습니다 (데모)','Report submitted (demo)'));
  }
};

// ── 1.4 PIN POST (admin) ──
window.togglePin = function(postId){
  var post = allPosts.find(function(p){ return p.id == postId; });
  if(!post) return;
  var newPinned = !post.pinned;

  if(SB.client){
    fetch('/api/community/posts/' + postId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ pinned: newPinned })
    }).then(function(r){ return r.json(); }).then(function(data){
      if(data.post){
        post.pinned = newPinned;
        updatePostTable();
        openPost(postId);
      }
    });
  } else {
    post.pinned = newPinned;
    updatePostTable();
    openPost(postId);
  }
};

// ── 1.5 AI MATCHING (real logic using directory data) ──
window.runMatch = function(){
  document.getElementById('aiForm').style.display='none';
  document.getElementById('aiLoad').style.display='block';

  var myRole = document.getElementById('aiRole') ? document.getElementById('aiRole').value : '';
  var myLoc = document.getElementById('aiLoc') ? document.getElementById('aiLoc').value : '';
  var lookingFor = document.getElementById('aiSeek') ? document.getElementById('aiSeek').value : '';

  // Get selected aesthetics
  var myAes = [];
  document.querySelectorAll('#aiAes input:checked, .ai-aes-checkboxes input:checked').forEach(function(cb){ myAes.push(cb.value); });
  if(myAes.length === 0){
    document.querySelectorAll('.ai-aes-opt.sel, .ai-tag.active').forEach(function(el){ myAes.push(el.textContent.trim()); });
  }

  setTimeout(function(){
    document.getElementById('aiLoad').style.display='none';

    // Score each directory member
    var scored = DD.map(function(d){
      var score = 0;

      // Role match (looking for this role)
      if(lookingFor && d.r.toLowerCase().includes(lookingFor.toLowerCase())) score += 35;

      // Not same role as me (complementary)
      if(myRole && d.r.toLowerCase() !== myRole.toLowerCase()) score += 10;

      // Location match
      if(myLoc){
        var locLower = myLoc.toLowerCase();
        if(d.l.toLowerCase().includes(locLower)) score += 25;
        else {
          // Country-level match
          var dCountry = d.l.split(',').pop().trim().toLowerCase();
          if(locLower.includes(dCountry) || dCountry.includes(locLower)) score += 10;
        }
      }

      // Aesthetic overlap
      if(myAes.length > 0){
        var overlap = d.a.filter(function(a){ return myAes.some(function(m){ return m.toLowerCase() === a.toLowerCase(); }); });
        score += Math.min(30, overlap.length * 15);
      }

      // Activity bonus
      score += Math.min(10, Math.floor(d.c / 10));

      // Normalize to 0-100
      score = Math.min(98, Math.max(15, score));

      return { d: d, s: score };
    });

    // Sort by score descending, take top 5
    scored.sort(function(a,b){ return b.s - a.s; });
    var matches = scored.slice(0, 5);

    var h = '<div class="ai-res-title">Top Matches</div>';
    matches.forEach(function(m){
      h += '<div class="ai-card">';
      h += '<div class="ai-score '+(m.s>75?'hi':m.s>50?'md':'lo')+'">'+m.s+'%</div>';
      h += '<div class="ai-info">';
      h += '<div class="ai-info-name" onclick="openProfile(\''+escHtml(m.d.n)+'\',event)" style="cursor:pointer">'+escHtml(m.d.n)+'</div>';
      h += '<div class="ai-info-role">'+escHtml(m.d.r.toUpperCase())+' · '+escHtml(m.d.l)+'</div>';
      var reasons = [];
      if(lookingFor && m.d.r.toLowerCase().includes(lookingFor.toLowerCase())) reasons.push('Role match');
      if(myLoc && m.d.l.toLowerCase().includes(myLoc.toLowerCase())) reasons.push('Location match');
      var aesOverlap = myAes.length > 0 ? m.d.a.filter(function(a){ return myAes.some(function(x){ return x.toLowerCase()===a.toLowerCase(); }); }) : [];
      if(aesOverlap.length > 0) reasons.push('Shared: '+aesOverlap.join(', '));
      h += '<div class="ai-info-why">'+(reasons.length>0?reasons.join(' · '):'Activity-based match')+'</div>';
      h += '<div class="ai-info-tags">'+m.d.a.map(function(x){return '<span>'+escHtml(x)+'</span>';}).join('')+'</div>';
      h += '</div>';
      h += '<button class="ai-connect" onclick="sendDM(null,\''+escHtml(m.d.n)+'\')">CONNECT</button>';
      h += '</div>';
    });
    h += '<div style="text-align:center;margin-top:24px"><button class="ai-go" style="max-width:200px" onclick="resetAi()">SEARCH AGAIN</button></div>';
    document.getElementById('aiRes').innerHTML = h;
    document.getElementById('aiRes').style.display = 'block';
  }, 1800);
};

// ── 1.5 ENHANCED openPost() — add Edit/Share/Report/Pin buttons ──
var _prevOpenPost = window.openPost;
window.openPost = function(id){
  _prevOpenPost(id);

  var post = allPosts.find(function(p){ return p.id == id; });
  if(!post) return;

  // Enhance action bar
  var actionBar = document.querySelector('.detail-action-bar');
  if(actionBar){
    var isOwner = SB.user && (post._userId === SB.user.id || post.author === (SB.user.email||'').split('@')[0]);
    var html = '';
    html += '<button onclick="toggleLikePost(\''+id+'\')">▲ '+escHtml(L[lang].btnScrap||'Save')+'</button>';
    html += '<button onclick="sharePost(\''+id+'\')">'+escHtml(L[lang].btnShare||'Share')+'</button>';
    html += '<button onclick="reportContent(\'post\',\''+id+'\')">'+escHtml(L[lang].btnReport||'Report')+'</button>';
    if(isOwner){
      html += '<button onclick="editPost(\''+id+'\')" style="color:#2563eb">✎ '+(_cL('수정','Edit'))+'</button>';
    }
    actionBar.innerHTML = html;
  }
};


// ======================================================================
// PHASE 2: SOCIAL FEATURES
// ======================================================================

// ── 2.1 FOLLOW / UNFOLLOW ──
window.followUser = function(targetId, targetName, btn){
  if(!alertLogin()) return;
  var isFollowing = btn && btn.getAttribute('data-following') === 'true';

  if(isFollowing){
    // Unfollow
    fetch('/api/community/follows?targetId=' + targetId, {
      method: 'DELETE', credentials: 'include'
    }).then(function(){
      if(btn){ btn.textContent = _cL('팔로우','Follow'); btn.setAttribute('data-following','false'); btn.classList.remove('following'); }
    });
  } else {
    // Follow
    fetch('/api/community/follows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ targetId: targetId })
    }).then(function(r){ return r.json(); }).then(function(){
      if(btn){ btn.textContent = _cL('팔로잉','Following'); btn.setAttribute('data-following','true'); btn.classList.add('following'); }
    });
  }
};

// ── 2.2 NOTIFICATIONS ──
window.loadNotifications = function(){
  if(!SB.user) return;
  fetch('/api/community/notifications?unreadOnly=true', { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var badge = document.getElementById('notifBadge');
      if(badge){
        var count = data.unreadCount || 0;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
      }
    }).catch(function(){});
};

window.openNotifications = function(){
  if(!alertLogin()) return;
  var panel = document.getElementById('notifPanel');
  if(!panel) return;
  // Toggle panel visibility
  if(panel.classList.contains('active')){
    panel.classList.remove('active');
    return;
  }
  panel.classList.add('active');

  fetch('/api/community/notifications', { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var items = data.notifications || [];
      var list = document.getElementById('notifList');
      if(!list) return;

      if(items.length === 0){
        list.innerHTML = '<div class="notif-empty">'+(L[lang]&&L[lang].notifEmpty||'No new notifications')+'</div>';
      } else {
        var typeIcons = { like:'❤️', comment:'💬', follow:'👤', project_apply:'📋', project_accepted:'✅', project_rejected:'❌', dm:'✉️', mention:'@', inspiration:'✨', scrap:'📌' };
        // For 'like' specifically, the meaning depends on target_type
        // (post like vs moodboard vote). Frontend splits the message below.
        var typeTexts = {it:{like:"ha messo mi piace al tuo post",like_mood_board:"ha messo mi piace alla tua bacheca",comment:"ha commentato il tuo post",follow:"ha iniziato a seguirti",project_apply:"si è candidato al tuo progetto",project_accepted:"La tua candidatura è stata accettata",project_rejected:"La tua candidatura è stata rifiutata",dm:"ti ha inviato un messaggio",mention:"ti ha menzionato",inspiration:"ha creato una nuova bacheca ispirata alla tua",scrap:"ha salvato la tua bacheca nel suo scrapbook"},fr:{like:"a aimé votre publication",like_mood_board:"a aimé votre moodboard",comment:"a commenté votre publication",follow:"a commencé à vous suivre",project_apply:"a postulé à votre projet",project_accepted:"Votre candidature a été acceptée",project_rejected:"Votre candidature a été refusée",dm:"vous a envoyé un message",mention:"vous a mentionné",inspiration:"a créé un nouveau tableau inspiré du vôtre",scrap:"a enregistré votre moodboard dans son carnet"},es:{like:"le gustó tu publicación",like_mood_board:"le gustó tu moodboard",comment:"comentó tu publicación",follow:"empezó a seguirte",project_apply:"se postuló a tu proyecto",project_accepted:"Tu solicitud fue aceptada",project_rejected:"Tu solicitud fue rechazada",dm:"te envió un mensaje",mention:"te mencionó",inspiration:"creó un nuevo tablero inspirado en el tuyo",scrap:"guardó tu moodboard en su álbum"},ja:{like:"があなたの投稿にいいねしました",like_mood_board:"があなたのムードボードにいいねしました",comment:"があなたの投稿にコメントしました",follow:"があなたをフォローしました",project_apply:"があなたのプロジェクトに応募しました",project_accepted:"応募が承認されました",project_rejected:"応募が却下されました",dm:"があなたにメッセージを送りました",mention:"があなたをメンションしました",inspiration:"があなたのボードから着想を得て新しいボードを作成しました",scrap:"があなたのムードボードをスクラップブックに保存しました"},zh:{like:"赞了你的帖子",like_mood_board:"赞了你的灵感板",comment:"评论了你的帖子",follow:"关注了你",project_apply:"申请加入你的项目",project_accepted:"你的申请已被接受",project_rejected:"你的申请已被拒绝",dm:"给你发了一条消息",mention:"提到了你",inspiration:"受你的灵感板启发创建了新板",scrap:"把你的灵感板保存到收藏册"},ru:{like:"понравился ваш пост",like_mood_board:"понравился ваш мудборд",comment:"прокомментировал ваш пост",follow:"подписался на вас",project_apply:"откликнулся на ваш проект",project_accepted:"Ваша заявка принята",project_rejected:"Ваша заявка отклонена",dm:"отправил вам сообщение",mention:"упомянул вас",inspiration:"создал новую доску, вдохновившись вашей",scrap:"сохранил ваш мудборд в свой альбом"},de:{like:"gefällt dein Beitrag",like_mood_board:"gefällt dein Moodboard",comment:"hat deinen Beitrag kommentiert",follow:"folgt dir jetzt",project_apply:"hat sich für dein Projekt beworben",project_accepted:"Deine Bewerbung wurde angenommen",project_rejected:"Deine Bewerbung wurde abgelehnt",dm:"hat dir eine Nachricht gesendet",mention:"hat dich erwähnt",inspiration:"hat ein neues Board erstellt, inspiriert von deinem",scrap:"hat dein Moodboard in seinem Sammelalbum gespeichert"},
          ko: { like:'님이 좋아요를 눌렀습니다', like_mood_board:'님이 당신의 무드보드를 좋아합니다', comment:'님이 댓글을 남겼습니다', follow:'님이 팔로우하기 시작했습니다', project_apply:'님이 프로젝트에 지원했습니다', project_accepted:'프로젝트 지원이 수락되었습니다', project_rejected:'프로젝트 지원이 거절되었습니다', dm:'님이 메시지를 보냈습니다', mention:'님이 언급했습니다', inspiration:'님이 당신의 보드에서 영감받아 새 보드를 만들었어요', scrap:'님이 당신의 무드보드를 스크랩북에 저장했어요' },
          en: { like:'liked your post', like_mood_board:'liked your moodboard', comment:'commented on your post', follow:'started following you', project_apply:'applied to your project', project_accepted:'Your application was accepted', project_rejected:'Your application was rejected', dm:'sent you a message', mention:'mentioned you', inspiration:'created a new board inspired by yours', scrap:'saved your moodboard to their scrapbook' }
        };
        var texts = typeTexts[lang] || typeTexts.en;
        var html = '';
        items.forEach(function(n){
          var icon = typeIcons[n.type] || '🔔';
          // 'like' on a mood_board reads naturally as "liked your moodboard"
          // — fall through to plain 'like' if no specialized variant exists.
          var keyed = (n.type && n.targetType) ? (n.type + '_' + n.targetType) : null;
          var text = (keyed && texts[keyed]) || texts[n.type] || n.message || '';
          var actorName = n.actor ? n.actor.name : '';
          var actorId = (n.actor && n.actor.id) || '';
          var av = actorName ? actorName.split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase() : '?';
          // event.stopPropagation on the actor name keeps the row's
          // click-through (handleNotifClick) from also firing.
          var actorBlock = actorId
            ? '<a href="#" onclick="event.preventDefault();event.stopPropagation();openProfile(\''+actorId+'\')" style="color:inherit;text-decoration:underline;text-underline-offset:2px"><strong>'+escHtml(actorName)+'</strong></a>'
            : '<strong>'+escHtml(actorName)+'</strong>';
          html += '<div class="notif-item'+(n.read?'':' unread')+'" onclick="handleNotifClick(\''+n.type+'\',\''+(n.targetType||'')+'\',\''+(n.targetId||'')+'\')">';
          html += '<div class="notif-av">'+av+'</div>';
          html += '<div class="notif-body"><div class="notif-text">'+actorBlock+' '+escHtml(text)+'</div>';
          html += '<div class="notif-time">'+timeAgo(n.createdAt)+'</div></div>';
          html += '<span class="notif-icon">'+icon+'</span></div>';
        });
        list.innerHTML = html;
      }

      // Mark all as read
      fetch('/api/community/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ all: true })
      }).then(function(){ loadNotifications(); });
    }).catch(function(){});
};

window.markAllRead = function(){
  fetch('/api/community/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ all: true })
  }).then(function(){
    loadNotifications();
    var list = document.getElementById('notifList');
    if(list) list.querySelectorAll('.notif-item').forEach(function(el){ el.classList.remove('unread'); });
  }).catch(function(){});
};

window.handleNotifClick = function(type, targetType, targetId){
  var panel = document.getElementById('notifPanel');
  if(panel) panel.classList.remove('active');
  if(targetType === 'post') { if(typeof openPost === 'function') openPost(targetId); return; }
  if(targetType === 'mood_board' && targetId) {
    // Go to moodboard tab + open the board detail overlay
    if(typeof goTab === 'function') goTab('moodboard', document.querySelector('[onclick*="moodboard"]'));
    if(typeof openMoodboard === 'function') setTimeout(function(){ openMoodboard(targetId); }, 100);
    return;
  }
  if(type === 'dm' || targetType === 'message') { openDMPanel(); return; }
  if(type === 'follow') {
    var dirEl = document.querySelector('[onclick*="directory"]');
    if(typeof goTab === 'function' && dirEl) goTab('directory', dirEl);
  }
};

// ── 2.3 DM (Direct Messages) ──────────────────────────────────────────
// Bug fixes from previous version:
//   - sendDMFromInput was sending recipientId=convId (wrong — API needs the
//     other user's id); we now store recipientId on chat dataset.
//   - sendDM(userId, name) didn't actually open the conversation; now it
//     looks up existing conversation with that user OR opens a new-chat view.
//   - alertLogin replaced with _canActLocal (timing-bug-free).

function _dmShowEmptyConvList(){
  var list = document.getElementById('dmConvList');
  if(!list) return;
  list.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text4);font-size:12px">'
    + (L[lang]&&L[lang].dmEmpty||'No conversations')
    + '<div style="margin-top:12px;font-size:11px;color:var(--text4)">'
    + (_cL('멤버 프로필에서 메시지를 보낼 수 있어요','Send a message from any member profile'))
    + '</div></div>';
}

function _dmRenderConvList(convs){
  var list = document.getElementById('dmConvList');
  if(!list) return;
  if(!convs || convs.length === 0){ _dmShowEmptyConvList(); return; }
  var html = '';
  convs.forEach(function(c){
    var other = c.otherUser || {};
    var name = other.name || 'User';
    var av = name.split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase();
    var lastMsg = c.lastMessage ? c.lastMessage.content.substring(0,50) : '';
    var lastTime = c.lastMessage ? (typeof timeAgo==='function' ? timeAgo(c.lastMessage.createdAt) : '') : '';
    var unread = c.unreadCount > 0 ? '<span class="dm-unread">'+c.unreadCount+'</span>' : '';
    var safeName = escHtml(name).replace(/'/g, '&#39;');
    var otherId = (other.id || '').replace(/'/g, '');
    // Avatar click opens profile (stop propagation so the conversation
    // doesn't also open). Row click still opens the conversation.
    html += '<div class="dm-conv-item" onclick="openConversation(\''+c.id+'\',\''+otherId+'\',\''+safeName+'\')">';
    var avClick = otherId ? 'event.stopPropagation();openProfile(\''+otherId+'\')' : '';
    html += '<div class="dm-conv-av"'+(avClick?' onclick="'+avClick+'" style="cursor:pointer"':'')+'>'+av+'</div>';
    html += '<div class="dm-conv-info"><div class="dm-conv-name">'+escHtml(name)+'</div>';
    html += '<div class="dm-conv-last">'+escHtml(lastMsg)+'</div></div>';
    html += '<div class="dm-conv-meta">'+(lastTime?'<div class="dm-conv-time">'+lastTime+'</div>':'')+unread+'</div></div>';
  });
  list.innerHTML = html;
}

function _dmFetchConvList(){
  return fetch('/api/community/messages?list=conversations', { credentials:'include' })
    .then(function(r){ return r.json(); });
}

window.openDMPanel = function(){
  if(!_canActLocal()) return;
  var panel = document.getElementById('dmPanel');
  var overlay = document.getElementById('dmOverlay');
  if(!panel) return;
  panel.classList.add('active');
  if(overlay) overlay.classList.add('active');
  document.getElementById('dmConvList').style.display = '';
  document.getElementById('dmChat').style.display = 'none';

  var list = document.getElementById('dmConvList');
  if(list) list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text4);font-size:11px">Loading...</div>';
  _dmFetchConvList()
    .then(function(data){ _dmRenderConvList(data.conversations || []); })
    .catch(function(){ showToast('Failed to load messages'); });
};

window.closeDMPanel = function(){
  var panel = document.getElementById('dmPanel');
  var overlay = document.getElementById('dmOverlay');
  if(panel) panel.classList.remove('active');
  if(overlay) overlay.classList.remove('active');
};

// Open a specific conversation. convId may be empty for "new conversation"
// — the first sent message will create the conversation row server-side.
window.openConversation = function(convId, otherUserId, otherName){
  var convListEl = document.getElementById('dmConvList');
  var chat = document.getElementById('dmChat');
  if(convListEl) convListEl.style.display = 'none';
  if(!chat) return;
  chat.style.display = 'flex';
  chat.dataset.convId = convId || '';
  chat.dataset.recipientId = otherUserId || '';
  chat.dataset.otherName = otherName || 'User';

  var header = document.getElementById('dmChatHeader');
  if(header){
    var nameBlock = otherUserId
      ? '<a href="#" onclick="event.preventDefault();openProfile(\''+otherUserId+'\')" style="color:inherit;text-decoration:underline;text-underline-offset:2px"><strong>'+escHtml(otherName||'User')+'</strong></a>'
      : '<strong>'+escHtml(otherName||'User')+'</strong>';
    header.innerHTML = '<button class="dm-back-btn" onclick="openDMPanel()">←</button>'+nameBlock;
  }

  var msgContainer = document.getElementById('dmMessages');
  if(!msgContainer) return;

  if(!convId){
    msgContainer.innerHTML = '<div class="dm-empty" style="text-align:center;padding:40px 20px;color:var(--text4);font-size:11px">'
      + (_cL('첫 메시지를 보내보세요','Send your first message'))
      + '</div>';
    var input = document.getElementById('dmInput');
    if(input) input.focus();
    return;
  }

  msgContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text4);font-size:11px">Loading...</div>';
  fetch('/api/community/messages?conversationId=' + encodeURIComponent(convId), { credentials:'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var msgs = data.messages || [];
      if(msgs.length === 0){
        msgContainer.innerHTML = '<div class="dm-empty" style="text-align:center;padding:20px;color:var(--text4);font-size:11px">'+(_cL('메시지가 없습니다','No messages yet'))+'</div>';
      } else {
        var html = '';
        msgs.forEach(function(m){
          var cls = m.isMine ? 'dm-msg sent' : 'dm-msg received';
          html += '<div class="'+cls+'"><div class="dm-bubble">'+escHtml(m.content)+'</div></div>';
        });
        msgContainer.innerHTML = html;
      }
      msgContainer.scrollTop = msgContainer.scrollHeight;
      var input = document.getElementById('dmInput');
      if(input) input.focus();
    }).catch(function(){ msgContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text4)">Error loading messages</div>'; });
};

// Send message — uses chat.dataset.recipientId (correct user id, NOT convId).
// First message in a new conversation creates the conversation server-side
// and the response gives us back the new convId.
window.sendDMFromInput = function(){
  var input = document.getElementById('dmInput');
  if(!input || !input.value.trim()) return;
  var content = input.value.trim();
  var chat = document.getElementById('dmChat');
  if(!chat) return;
  var recipientId = chat.dataset.recipientId;
  if(!recipientId){
    showToast(_cL('수신자 정보가 없어요','No recipient — close and re-open the chat'));
    return;
  }
  input.value = '';

  // Optimistic: append + clear empty-state placeholder if present
  var msgList = document.getElementById('dmMessages');
  if(msgList){
    var placeholder = msgList.querySelector('.dm-empty');
    if(placeholder) placeholder.remove();
    msgList.insertAdjacentHTML('beforeend', '<div class="dm-msg sent"><div class="dm-bubble">'+escHtml(content)+'</div></div>');
    msgList.scrollTop = msgList.scrollHeight;
  }

  fetch('/api/community/messages', {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ recipientId: recipientId, content: content })
  }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(out){
      if(!out.ok){
        showToast(out.j.message || 'Failed to send');
        return;
      }
      // First message in a new conversation — store the new convId so
      // subsequent sends/refreshes hit the right thread.
      if(!chat.dataset.convId && out.j.message && out.j.message.conversationId){
        chat.dataset.convId = out.j.message.conversationId;
      }
    }).catch(function(){ showToast('Failed to send'); });
};

// Start (or resume) a DM with a specific user. Called from member profile,
// directory, etc. If a conversation already exists, opens it; otherwise
// shows a fresh chat pane and the first message creates the conversation.
window.sendDM = function(userId, userName){
  if(!_canActLocal()) return;
  if(!userId){
    // Called from demo / placeholder data with no real user id (e.g. AI
    // matching cards). Surface a clear message instead of a confusing
    // login prompt.
    showToast(_cL('이 카드는 데모 데이터예요 — 디렉토리에서 회원을 찾아 메시지를 보내주세요','This card is demo data — find members in the Directory tab to send messages'));
    return;
  }

  var panel = document.getElementById('dmPanel');
  var overlay = document.getElementById('dmOverlay');
  if(panel) panel.classList.add('active');
  if(overlay) overlay.classList.add('active');
  document.getElementById('dmConvList').style.display = '';
  document.getElementById('dmChat').style.display = 'none';

  // Look up existing conversation; if none, open new-chat view
  _dmFetchConvList()
    .then(function(data){
      var convs = data.conversations || [];
      var existing = null;
      for(var i=0;i<convs.length;i++){
        var c = convs[i];
        if(c.otherUser && c.otherUser.id === userId){ existing = c; break; }
      }
      if(existing){
        openConversation(existing.id, userId, (existing.otherUser && existing.otherUser.name) || userName);
      } else {
        openConversation('', userId, userName || 'User');
      }
    })
    .catch(function(){ openConversation('', userId, userName || 'User'); });
};

// ── 2.4 ENHANCED PROFILE POPUP — real member data via /api/community/members/:id ──
//
// Two flows coexist:
//   (A) Real member: openProfile(uuid) — fetches /api/community/members/:id
//       and renders bio/role/links + recent moodboards + recent scraps
//       + working follow/DM buttons (real userId).
//   (B) Legacy demo: openProfile('Judith Moreno') — falls through to the
//       hardcoded sample dict in community.html. Kept so older inline call
//       sites (post comments, AI matching cards) don't break.
//
// Routing rule: if first arg is a UUID-like string (8-4-4-4-12 hex), treat
// as member id; otherwise treat as legacy display name.

var _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var _origOpenProfile = window.openProfile;

window.openProfile = function(idOrName, e){
  if(e && typeof e.stopPropagation === 'function') e.stopPropagation();
  if(typeof idOrName === 'string' && _UUID_RE.test(idOrName)){
    return openMemberProfile(idOrName);
  }
  // Legacy demo-data path
  if(typeof _origOpenProfile === 'function') _origOpenProfile(idOrName, e);
  // Inject the same Follow/DM button pair (no real userId — buttons will
  // show informative toasts instead of acting).
  _attachLegacyProfileActions(idOrName);
};

function _attachLegacyProfileActions(name){
  var popup = document.getElementById('profilePopupBg');
  if(!popup || !popup.classList.contains('active')) return;
  var btnContainer = document.getElementById('ppActionBtns');
  if(btnContainer) return;
  var levelEl = document.getElementById('ppLevel');
  if(!levelEl) return;
  var btns = document.createElement('div');
  btns.id = 'ppActionBtns';
  btns.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:center';
  btns.innerHTML = ''
    + '<button onclick="followUser(null,\''+escHtml(name)+'\',this)" style="padding:8px 20px;font-size:10px;font-weight:700;letter-spacing:.1em;background:#000;color:#fff;border:1px solid #000;cursor:pointer;font-family:Montserrat,sans-serif">'+(_cL('팔로우','FOLLOW'))+'</button>'
    + '<button onclick="sendDM(null,\''+escHtml(name)+'\')" style="padding:8px 20px;font-size:10px;font-weight:700;letter-spacing:.1em;background:transparent;color:#000;border:1px solid #000;cursor:pointer;font-family:Montserrat,sans-serif">'+(_cL('메시지','MESSAGE'))+'</button>';
  levelEl.parentNode.insertBefore(btns, levelEl.nextSibling);
}

// Real-member profile — fetches data and populates the popup with the same
// shell elements (ppName/ppRole/ppAvatar/ppPosts/etc.) plus a NEW
// `ppExtraSection` container for moodboards + scraps.
window.openMemberProfile = function(userId){
  if(!userId) return;
  var popup = document.getElementById('profilePopupBg');
  if(!popup) return;
  popup.dataset.memberId = userId; // for _refreshCommunityUgc on lang change
  popup.classList.add('active');

  // Show a tiny loading state while we fetch
  var nameEl = document.getElementById('ppName');
  if(nameEl) nameEl.textContent = (_cL('불러오는 중…','Loading…'));

  fetch(_withLang('/api/community/members/' + encodeURIComponent(userId)), { credentials:'include' })
    .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(out){
      if(!out.ok){ showToast(out.j.message || 'Failed to load profile'); return; }
      _renderMemberProfile(out.j);
    }).catch(function(){ showToast('Failed to load profile'); });
};

function _renderMemberProfile(data){
  var p = data.profile || {};
  var c = data.counts || {};
  var name = p.name || 'Member';
  var initials = name.split(' ').map(function(w){ return w[0]; }).join('').substring(0,2).toUpperCase();

  // Top section — name/role/avatar
  var nameEl = document.getElementById('ppName');
  if(nameEl) nameEl.textContent = name;
  var roleEl = document.getElementById('ppRole');
  if(roleEl) roleEl.textContent = p.role || (_cL('회원','Member'));
  var avEl = document.getElementById('ppAvatar');
  if(avEl){
    if(p.avatarUrl){ avEl.innerHTML = '<img src="'+escHtml(p.avatarUrl)+'" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">'; }
    else { avEl.textContent = initials; }
  }
  var levelEl = document.getElementById('ppLevel');
  if(levelEl){
    var planLabel = '';
    if(p.subscriptionPlan && p.subscriptionPlan.indexOf('premium') === 0) planLabel = '● PREMIUM';
    else if(p.subscriptionPlan && p.subscriptionPlan.indexOf('standard') === 0) planLabel = '● STANDARD';
    levelEl.textContent = planLabel;
    levelEl.className = 'profile-popup-level ' + (planLabel ? 'lvl-premium' : '');
  }

  // Stats — replace the "posts/followers/likes" trio with our richer set
  var statPosts = document.getElementById('ppPosts');
  if(statPosts){ statPosts.textContent = (c.moodboards != null) ? c.moodboards : (c.posts || 0); }
  var statFol = document.getElementById('ppFollowers');
  if(statFol){ statFol.textContent = c.followers || 0; }
  var statLikes = document.getElementById('ppLikes');
  if(statLikes){ statLikes.textContent = c.scraps || 0; }
  // Update labels via existing data-i18n attributes when possible
  var labels = document.querySelectorAll('.profile-popup-stat-label');
  if(labels.length >= 3){
    labels[0].textContent = _cL('무드보드','Boards');
    labels[1].textContent = _cL('팔로워','Followers');
    labels[2].textContent = _cL('스크랩','Scraps');
  }

  // Action buttons (real userId — Follow/DM actually work)
  var oldBtns = document.getElementById('ppActionBtns');
  if(oldBtns) oldBtns.remove();
  if(levelEl){
    var btns = document.createElement('div');
    btns.id = 'ppActionBtns';
    btns.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:center';
    if(!data.isSelf){
      var followLabel = data.isFollowing
        ? (_cL('팔로잉','FOLLOWING'))
        : (_cL('팔로우','FOLLOW'));
      var followStyle = data.isFollowing ? 'background:transparent;color:#000' : 'background:#000;color:#fff';
      btns.innerHTML = ''
        + '<button data-uid="'+escHtml(p.id)+'" data-following="'+(data.isFollowing?'true':'false')+'" onclick="followUser(this.dataset.uid,\''+escHtml(name).replace(/'/g,"")+'\',this)" style="padding:8px 20px;font-size:10px;font-weight:700;letter-spacing:.1em;'+followStyle+';border:1px solid #000;cursor:pointer;font-family:Montserrat,sans-serif">'+followLabel+'</button>'
        + '<button onclick="sendDM(\''+escHtml(p.id)+'\',\''+escHtml(name).replace(/'/g,"")+'\')" style="padding:8px 20px;font-size:10px;font-weight:700;letter-spacing:.1em;background:transparent;color:#000;border:1px solid #000;cursor:pointer;font-family:Montserrat,sans-serif">'+(_cL('메시지','MESSAGE'))+'</button>';
    } else {
      btns.innerHTML = '<div style="font-size:11px;color:var(--text4);padding:8px">'+(_cL('본인 프로필','Your profile'))+'</div>';
    }
    levelEl.parentNode.insertBefore(btns, levelEl.nextSibling);
  }

  // Bio / location / instagram / website — extra info section
  var ppWorks = document.getElementById('ppWorks');
  if(ppWorks){
    var extraHtml = '';
    if(p.bio){
      extraHtml += '<div class="pp-bio" style="font-size:13px;line-height:1.6;color:var(--text2);padding:0 32px 16px;text-align:center">'+escHtml(p.bio)+'</div>';
    }
    var links = [];
    if(p.location)  links.push('<span>📍 '+escHtml(p.location)+'</span>');
    if(p.instagram) links.push('<a href="https://instagram.com/'+escHtml(p.instagram.replace(/^@/,''))+'" target="_blank" rel="noopener noreferrer" style="color:var(--text3);text-decoration:none">'+escHtml(p.instagram)+'</a>');
    if(p.website)   links.push('<a href="'+escHtml(p.website)+'" target="_blank" rel="noopener noreferrer" style="color:var(--text3);text-decoration:none">'+(_cL('웹사이트 ↗','Website ↗'))+'</a>');
    if(links.length){
      extraHtml += '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:14px;font-size:12px;color:var(--text3);padding:0 32px 16px">'+links.join('<span style="color:var(--text4)">·</span>')+'</div>';
    }

    // Recent moodboards section
    var boards = data.recentMoodboards || [];
    if(boards.length){
      extraHtml += '<div class="pp-section-title" style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);padding:18px 32px 10px;border-top:1px solid var(--border);margin-top:8px">'+(_cL('최근 무드보드','Recent moodboards'))+'</div>';
      extraHtml += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;padding:0 32px 16px">';
      boards.slice(0,6).forEach(function(b){
        var bg = b.previewImage ? 'background-image:url('+escHtml(b.previewImage)+');background-size:cover;background-position:center' : 'background:var(--surface2)';
        var safeTitle = escHtml(b.title||'Untitled');
        extraHtml += '<div title="'+safeTitle+'" onclick="closeProfile();goTab(\'moodboard\',document.querySelector(\'[onclick*=\\\"moodboard\\\"]\'));setTimeout(function(){openMoodboard(\''+b.id+'\')},120)" style="aspect-ratio:1/1;border-radius:6px;cursor:pointer;'+bg+'"></div>';
      });
      extraHtml += '</div>';
    }

    // Recent scraps section
    var scraps = data.recentScraps || [];
    if(scraps.length){
      extraHtml += '<div class="pp-section-title" style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);padding:8px 32px 10px;border-top:1px solid var(--border)">'+(_cL('최근 스크랩','Recent scraps'))+'</div>';
      extraHtml += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:0 32px 24px">';
      scraps.slice(0,8).forEach(function(s){
        var click = s.sourceUrl
          ? "window.open('"+escHtml(s.sourceUrl).replace(/'/g,'')+"','_blank','noopener,noreferrer')"
          : '';
        extraHtml += '<img src="'+escHtml(s.imageUrl)+'" alt="" loading="lazy" onclick="'+click+'" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:3px;cursor:pointer" onerror="this.style.opacity=\'.3\'">';
      });
      extraHtml += '</div>';
    }

    if(!boards.length && !scraps.length){
      extraHtml += '<div style="text-align:center;padding:32px;font-size:12px;color:var(--text4)">'+(_cL('아직 활동이 없어요','No activity yet'))+'</div>';
    }

    ppWorks.innerHTML = extraHtml;
  }
}


// ======================================================================
// PHASE 3: DIFFERENTIATION FEATURES
// ======================================================================

// ── 3.1 BADGE SYSTEM — Check badges on actions ──
window.checkBadges = function(){
  if(!SB.client || !SB.user) return;
  fetch('/api/community/badges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  }).then(function(r){ return r.json(); }).then(function(data){
    if(data.awarded && data.awarded.length > 0){
      data.awarded.forEach(function(b){
        showToast('🏆 ' + (_cL('새 뱃지 획득: ','New badge: ')) + b);
      });
    }
  }).catch(function(){});
};

// ── 3.2 MOODBOARD — Inspiration Board tab ──
window.loadMoodboards = function(){
  var container = document.getElementById('moodGrid');
  if(!container) return;
  fetch(_withLang('/api/community/moodboards'))
    .then(function(r){ return r.json(); })
    .then(function(data){
      var boards = data.boards || [];
      if(boards.length === 0){
        container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text4)"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="margin-bottom:12px;opacity:.4"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><p style="font-size:12px">'+(L[lang]&&L[lang].moodEmpty||'No moodboards yet')+'</p></div>';
        return;
      }
      var html = '';
      boards.forEach(function(b){
        html += '<div class="mood-card">';
        html += '<div class="mood-preview">';
        (b.previewImages||[]).slice(0,4).forEach(function(img){
          html += '<div class="mood-img" style="background-image:url('+escHtml(img)+')"></div>';
        });
        for(var i=(b.previewImages||[]).length; i<4; i++){
          html += '<div class="mood-img mood-img-empty"></div>';
        }
        html += '</div>';
        html += '<div class="mood-caption"><div class="mood-title">'+escHtml(b.title)+'</div>';
        html += '<div class="mood-meta">'+escHtml(b.author.name)+' · '+b.itemCount+' items</div></div>';
        html += '<div class="mood-footer"><button class="mood-vote-btn" onclick="event.stopPropagation();voteMoodboard(\''+b.id+'\',this)">♥ '+b.voteCount+'</button>';
        if(b.tags && b.tags.length){
          html += '<div class="mood-tags">'+b.tags.slice(0,3).map(function(t){return '<span class="mood-tag">'+escHtml(t)+'</span>';}).join('')+'</div>';
        }
        html += '</div></div>';
      });
      container.innerHTML = html;
    }).catch(function(){
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text4);font-size:12px">Failed to load moodboards</div>';
    });
};

// Moodboard create — supports `inspiredById` to chain off another board.
// Items are entered as one image URL per line in a textarea.
window.createMoodboard = function(inspiredById){
  if(!_canActLocal()) return;
  var bg = document.getElementById('createMoodboardBg');
  if(!bg) return;
  document.getElementById('cmTitle').value = '';
  document.getElementById('cmDescription').value = '';
  document.getElementById('cmTags').value = '';
  document.getElementById('cmImages').value = '';
  document.getElementById('cmInspiredId').value = inspiredById || '';
  var inspiredHint = document.getElementById('cmInspiredHint');
  if(inspiredHint){
    inspiredHint.style.display = inspiredById ? '' : 'none';
  }
  bg.classList.add('active');
};
window.closeCreateMoodboard = function(){
  var bg = document.getElementById('createMoodboardBg');
  if(bg) bg.classList.remove('active');
};
window.submitMoodboard = function(){
  var title = (document.getElementById('cmTitle').value||'').trim();
  if(!title){ showToast(_cL('제목을 입력하세요','Enter a title')); return; }
  var description = (document.getElementById('cmDescription').value||'').trim();
  var tagsRaw = (document.getElementById('cmTags').value||'').trim();
  var imagesRaw = (document.getElementById('cmImages').value||'').trim();
  var inspiredById = (document.getElementById('cmInspiredId').value||'').trim();

  var tags = tagsRaw ? tagsRaw.split(',').map(function(t){ return t.trim(); }).filter(Boolean) : [];
  var items = imagesRaw
    ? imagesRaw.split('\n').map(function(u){ return u.trim(); }).filter(Boolean).map(function(u){ return { imageUrl: u }; })
    : [];

  var body = { title: title, description: description, tags: tags, items: items };
  if(inspiredById) body.inspiredById = inspiredById;

  fetch('/api/community/moodboards', {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify(body),
  }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(out){
      if(!out.ok){ showToast(out.j.message || 'Failed'); return; }
      closeCreateMoodboard();
      if(typeof loadMoodboards === 'function') loadMoodboards();
    }).catch(function(){ showToast('Failed to create'); });
};

window.voteMoodboard = function(boardId, btn){
  if(!alertLogin()) return;
  fetch('/api/community/moodboards', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'include',
    body: JSON.stringify({action:'vote',boardId:boardId})
  }).then(function(r){return r.json();}).then(function(d){
    if(btn) btn.textContent = '♥ '+(d.voteCount||0);
  }).catch(function(){});
};


// ======================================================================
// UTILITY
// ======================================================================

window.showToast = function(msg){
  var existing = document.getElementById('papToast');
  if(existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'papToast';
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:12px 24px;font-size:12px;font-family:Montserrat,sans-serif;z-index:10005;letter-spacing:.03em;animation:bnFadeIn .3s ease';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function(){ toast.style.animation = 'bnFadeOut .3s ease forwards'; setTimeout(function(){ toast.remove(); },300); },2500);
};

// ======================================================================
// INIT V2
// ======================================================================
// PHASE 4: PLATFORM INSIGHTS (Behance + Are.na + The Dots + BoF)
// ======================================================================

// ── 4.1 Featured Creators (BoF 500-style) ──
window.loadFeaturedCreators = function(){
  var container = document.getElementById('featuredCreators');
  if(!container) return;
  fetch('/api/community/featured-creators', { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var creators = data.creators || [];
      if(creators.length === 0){
        container.innerHTML = '<div style="text-align:center;padding:20px 0;font-size:11px;color:var(--text4)">'+(L[lang]&&L[lang].featuredEmpty||'Featured creators coming soon')+'</div>';
        return;
      }
      var html = '';
      creators.forEach(function(c){
        var av = (c.name||'??').substring(0,2).toUpperCase();
        html += '<div class="sw-item" onclick="openProfile(\''+c.id+'\')">';
        html += '<div class="sw-av">'+av+'</div>';
        html += '<div><div class="sw-nm">'+escHtml(c.name)+'</div>';
        html += '<div class="sw-sub">'+escHtml(c.role||'')+'</div></div></div>';
      });
      container.innerHTML = html;
    }).catch(function(){});
};

// ── 4.1b Discovery surfaces (mission D — trending boards / active creators / recent scraps) ──
// Single API call hydrates 3 sidebar widgets. Public read; works for
// logged-out visitors too (gives them a reason to sign up).
window.loadDiscovery = function(){
  fetch(_withLang('/api/community/discovery'), { credentials:'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      _renderTrendingMoodboards((data && data.trendingMoodboards) || []);
      _renderActiveCreators((data && data.activeCreators) || []);
      _renderRecentScraps((data && data.recentScraps) || []);
    }).catch(function(){ /* silent — empty states already shown */ });
};

function _renderTrendingMoodboards(boards){
  var el = document.getElementById('trendingMoodboards');
  if(!el) return;
  if(!boards.length){
    el.innerHTML = '<div style="text-align:center;padding:14px 0;font-size:11px;color:var(--text4)">'+(L[lang]&&L[lang].trendingMoodboardsEmpty||'No boards yet')+'</div>';
    return;
  }
  var html = '';
  boards.forEach(function(b){
    var thumb = b.previewImage ? 'background-image:url('+escHtml(b.previewImage)+')' : '';
    var safeTitle = escHtml(b.title||'Untitled');
    var authorName = escHtml((b.author && b.author.name) || '');
    html += '<div class="sw-mood-item" onclick="goTab(\'moodboard\',document.querySelector(\'[onclick*=\\\"moodboard\\\"]\'));setTimeout(function(){openMoodboard(\''+b.id+'\')},100)">';
    html += '<div class="sw-mood-thumb" style="'+thumb+'"></div>';
    html += '<div class="sw-mood-info"><div class="sw-mood-title">'+safeTitle+'</div>';
    html += '<div class="sw-mood-meta">'+authorName+(b.voteCount?(' · ♥ '+b.voteCount):'')+'</div></div>';
    html += '</div>';
  });
  el.innerHTML = html;
}

function _renderActiveCreators(creators){
  var el = document.getElementById('activeCreators');
  if(!el) return;
  if(!creators.length){
    el.innerHTML = '<div style="text-align:center;padding:14px 0;font-size:11px;color:var(--text4)">'+(L[lang]&&L[lang].activeCreatorsEmpty||'Activity coming soon')+'</div>';
    return;
  }
  var html = '';
  creators.forEach(function(c){
    var name = c.name || 'User';
    var av = name.split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase();
    var totals = [];
    if(c.moodboardCount) totals.push(c.moodboardCount + (_cL(' 보드',' boards')));
    if(c.scrapCount) totals.push(c.scrapCount + (_cL(' 스크랩',' scraps')));
    // Pass real userId (UUID) so openProfile takes the rich-member path
    var safeId = (c.id || '').replace(/'/g, '');
    var safeName = escHtml(name).replace(/'/g, '');
    html += '<div class="sw-item" onclick="openProfile(\''+(safeId || safeName)+'\')">';
    html += '<div class="sw-av">'+av+'</div>';
    html += '<div><div class="sw-nm">'+escHtml(name)+'</div>';
    html += '<div class="sw-sub">'+totals.join(' · ')+'</div></div></div>';
  });
  el.innerHTML = html;
}

function _renderRecentScraps(scraps){
  var el = document.getElementById('recentScraps');
  if(!el) return;
  if(!scraps.length){
    el.innerHTML = '<div style="text-align:center;padding:14px 0;font-size:11px;color:var(--text4);grid-column:1/-1">'+(L[lang]&&L[lang].recentScrapsEmpty||'Scraps gathering')+'</div>';
    return;
  }
  // Show 4-col grid of latest scraps. Click → scrapbook tab of that user
  // (fallback: just open the source URL if available).
  var html = '';
  scraps.slice(0, 8).forEach(function(s){
    var alt = escHtml((s.author && s.author.name) || '');
    var clickHandler = s.sourceUrl
      ? "window.open('"+escHtml(s.sourceUrl).replace(/'/g,'')+"','_blank','noopener,noreferrer')"
      : "goTab('scrapbook',document.querySelector('[onclick*=\\\"scrapbook\\\"]'))";
    html += '<img src="'+escHtml(s.imageUrl)+'" alt="'+alt+'" title="'+alt+'" loading="lazy" onclick="'+clickHandler+'" onerror="this.style.opacity=\'.3\'">';
  });
  el.innerHTML = html;
}

// ── 4.2 Moodboard Channel Filter (Are.na-style) ──
window.filterMoodChannel = function(channel, btn){
  // Update active state
  var btns = document.querySelectorAll('.mood-channel');
  btns.forEach(function(b){ b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  // Reload moodboards with channel filter
  if(typeof loadMoodboards === 'function') loadMoodboards(channel);
};

// Extend loadMoodboards to support channel filter
var _origLoadMoodboards = window.loadMoodboards;
window.loadMoodboards = function(channel){
  var grid = document.getElementById('moodGrid');
  if(!grid) return;
  var url = '/api/community/moodboards';
  if(channel && channel !== 'all') url += '?channel=' + encodeURIComponent(channel);
  fetch(url, { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var boards = data.boards || [];
      if(boards.length === 0){
        grid.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text4);font-size:13px;grid-column:1/-1">'+(L[lang]&&L[lang].moodEmpty||'No inspiration boards yet')+'</div>';
        return;
      }
      var html = '';
      boards.forEach(function(b){
        html += '<div class="mood-card" onclick="openMoodboard(\''+b.id+'\')">';
        html += '<div class="mood-preview">';
        var imgs = b.previewImages || [];
        if(imgs.length > 0){
          imgs.slice(0,3).forEach(function(img){
            html += '<div class="mood-img" style="background-image:url('+escHtml(img)+')"></div>';
          });
        } else {
          html += '<div class="mood-img mood-img-empty"></div>';
        }
        html += '</div>';
        html += '<div class="mood-caption"><div class="mood-title">'+escHtml(b.title)+'</div>';
        if(b.inspiredById){
          html += '<span class="mood-tag" title="Inspired by another board" style="background:rgba(255,255,255,.12)">✨ '+(L[lang]&&L[lang].moodInspiredBy||'Inspired')+'</span> ';
        }
        if(b.channel) html += '<span class="mood-tag">'+escHtml(b.channel)+'</span> ';
        html += '<span style="font-size:11px;color:var(--text3)">'+escHtml(b.itemCount||0)+' items</span></div>';
        html += '<div class="mood-footer"><button class="mood-vote-btn" onclick="event.stopPropagation();voteMoodboard(\''+b.id+'\',this)">♥ '+b.voteCount+'</button>';
        if(b.tags && b.tags.length > 0){
          html += '<div class="mood-tags">'+b.tags.slice(0,3).map(function(t){return '<span class="mood-tag">'+escHtml(t)+'</span>';}).join('')+'</div>';
        }
        html += '</div></div>';
      });
      grid.innerHTML = html;
    }).catch(function(){ showToast('Failed to load boards'); });
};

// ── 4.3 AI Archive Search ──
window.searchArchive = function(){
  var input = document.getElementById('aiSearchInput');
  if(!input || !input.value.trim()) return;
  var query = input.value.trim();
  showToast('Searching PAP archive for "' + query + '"...');
  // Future: integrate with AI backend
  fetch('/api/community/search?q=' + encodeURIComponent(query), { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      // Show results in a dedicated area or redirect
      if(data.results && data.results.length > 0){
        showToast(data.results.length + ' results found');
      } else {
        showToast('No results found. Try different keywords.');
      }
    }).catch(function(){ showToast('Search is coming soon'); });
};

// ── 4.4 Profile Milestones (Behance-style) ──
window.loadMilestones = function(userId){
  var container = document.getElementById('ppMilestoneList');
  var section = document.getElementById('ppMilestones');
  if(!container || !section) return;
  fetch('/api/community/milestones?userId=' + userId, { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var milestones = data.milestones || [];
      if(milestones.length === 0){
        section.style.display = 'none';
        return;
      }
      section.style.display = '';
      var icons = { editorial: '📸', collaboration: '🤝', badge: '🏆', project: '📋', community: '💬' };
      var html = '';
      milestones.forEach(function(m){
        var icon = icons[m.type] || '⭐';
        html += '<div class="milestone-item">';
        html += '<div class="milestone-icon">'+icon+'</div>';
        html += '<div class="milestone-info">';
        html += '<div class="milestone-name">'+escHtml(m.title)+'</div>';
        if(m.description) html += '<div class="milestone-desc">'+escHtml(m.description)+'</div>';
        html += '<div class="milestone-date">'+timeAgo(m.date)+'</div>';
        html += '</div></div>';
      });
      container.innerHTML = html;
    }).catch(function(){ section.style.display = 'none'; });
};

// ── 4.5 Community Survey ──
window.openSurvey = function(){
  showToast(L[lang]&&L[lang].cvSoon||'Community survey coming soon!');
};

// ── 4.6 Membership Tier Display ──
window.loadMembershipTier = function(){
  var badge = document.getElementById('membershipBadge');
  var label = document.getElementById('membershipLabel');
  if(!badge || !label || !SB.user) return;
  fetch('/api/community/membership', { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if(data.tier && data.tier !== 'free'){
        badge.style.display = '';
        label.textContent = data.tier.charAt(0).toUpperCase() + data.tier.slice(1);
        badge.className = 'membership-indicator tier-' + data.tier;
      }
    }).catch(function(){});
};

// ── 4.6b Open Moodboard detail ──
// Fetches the board (items + inspired_by ancestor) and renders into the
// moodboard detail overlay. Includes Editorial bridge (mission 5) and
// Pull-letter request (separate PR) entry points.
window.openMoodboard = function(boardId){
  fetch(_withLang('/api/community/moodboards?id=' + encodeURIComponent(boardId)), { credentials:'include' })
    .then(function(r){ return r.json(); })
    .then(function(b){
      if(!b || !b.title){ showToast('Board not found'); return; }
      var ov = document.getElementById('moodDetailOverlay');
      if(!ov) return;
      var body = document.getElementById('moodDetailBody');
      var html = '';
      html += '<div class="md-head" data-board-id="'+b.id+'">';
      html += '<h2 class="md-title" data-original="'+escHtml(b.titleOriginal||b.title||'')+'" data-translated="'+escHtml(b.title||'')+'">'+escHtml(b.title)+'</h2>';
      var authorName = (b.author && b.author.name) || '';
      var authorId = (b.author && b.author.id) || '';
      var authorBlock = authorId
        ? '<a href="#" onclick="event.preventDefault();closeMoodDetail();openProfile(\''+authorId+'\')" style="color:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer">'+escHtml(authorName)+'</a>'
        : escHtml(authorName);
      html += '<div class="md-meta">'+authorBlock+' · '+(b.items?b.items.length:0)+' items · ♥ '+(b.voteCount||0)+'</div>';
      if(b.inspiredBy){
        html += '<div class="md-inspired" onclick="closeMoodDetail();openMoodboard(\''+b.inspiredBy.id+'\')" style="cursor:pointer">';
        html += '✨ '+(L[lang]&&L[lang].moodInspiredByLabel||'Inspired by')+' '+escHtml(b.inspiredBy.title)+(b.inspiredBy.authorName?(' — '+escHtml(b.inspiredBy.authorName)):'');
        html += '</div>';
      }
      if(b.description) html += '<p class="md-desc" data-original="'+escHtml(b.descriptionOriginal||b.description||'')+'" data-translated="'+escHtml(b.description||'')+'">'+escHtml(b.description)+'</p>';
      // "원문 보기" / "View original" toggle — only when server actually
      // translated something (titleOriginal !== title or description differs)
      if(b.translated){
        html += '<button class="md-orig-toggle" data-mode="translated" onclick="_toggleMoodboardOriginal(this)" style="margin-top:6px;padding:4px 10px;font-size:11px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.7);border-radius:999px;cursor:pointer;font-family:Montserrat,sans-serif">🌐 '+(_cL('원문 보기','View original'))+'</button>';
      }
      if(b.tags && b.tags.length){
        html += '<div class="md-tags">'+b.tags.map(function(t){return '<span class="mood-tag">'+escHtml(t)+'</span>';}).join('')+'</div>';
      }
      // Action buttons row (inspired-by chain, editorial bridge).
      // Pull-letter intentionally NOT here — community moodboards are for
      // expressing personal aesthetic; pull-letter is a separate formal flow
      // at /pullletter that requires team info + 촬영시안 PDF.
      html += '<div class="md-actions" id="mdActions">';
      html += '<button class="md-action-btn" onclick="createMoodboard(\''+b.id+'\')">✨ '+(L[lang]&&L[lang].moodInspireBtn||'이 보드에서 영감받기')+'</button>';
      html += '<button class="md-action-btn" onclick="bridgeToEditorial(\''+b.id+'\')">📸 '+(L[lang]&&L[lang].moodEditorialBtn||'에디토리얼로 제안')+'</button>';
      html += '</div>';
      html += '</div>';
      // Items grid
      html += '<div class="md-items">';
      (b.items||[]).forEach(function(it){
        html += '<div class="md-item"><img src="'+escHtml(it.imageUrl)+'" alt="" loading="lazy">';
        if(it.caption) html += '<div class="md-cap">'+escHtml(it.caption)+'</div>';
        html += '</div>';
      });
      html += '</div>';

      // Comment thread — list + input. Loaded asynchronously after the
      // detail body is mounted so the modal opens immediately.
      html += '<div class="md-comments-section" data-board-id="'+b.id+'">';
      html += '  <h3 class="md-comments-title">'+(_cL('댓글','Comments'))+'</h3>';
      html += '  <div class="md-comments-list" id="mdCommentsList">'
            +    '<div style="color:rgba(255,255,255,.4);font-size:12px;padding:10px 0">'+(_cL('댓글 불러오는 중...','Loading comments...'))+'</div>'
            +  '</div>';
      html += '  <div class="md-comment-input-row">';
      html += '    <input type="text" class="md-comment-input" id="mdCommentInput" maxlength="2000" placeholder="'+(_cL('이 보드에 대한 생각을 남겨보세요...','Leave a thought about this board...'))+'" onkeypress="if(event.key===\'Enter\')submitMoodboardComment(\''+b.id+'\')">';
      html += '    <button class="md-comment-send" onclick="submitMoodboardComment(\''+b.id+'\')">'+(_cL('등록','Post'))+'</button>';
      html += '  </div>';
      html += '</div>';

      body.innerHTML = html;
      ov.classList.add('active');
      loadMoodboardComments(b.id);
    }).catch(function(){ showToast('Failed to load board'); });
};

// Load comments for a mood board — public read (no auth needed)
window.loadMoodboardComments = function(boardId){
  var listEl = document.getElementById('mdCommentsList');
  if(!listEl) return;
  fetch(_withLang('/api/community/moodboard-comments?boardId=' + encodeURIComponent(boardId)), { credentials:'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var comments = (data && data.comments) || [];
      _renderMoodboardComments(comments);
    }).catch(function(){
      listEl.innerHTML = '<div style="color:rgba(255,255,255,.4);font-size:12px;padding:10px 0">Failed to load comments</div>';
    });
};

function _renderMoodboardComments(comments){
  var listEl = document.getElementById('mdCommentsList');
  if(!listEl) return;
  if(!comments || comments.length === 0){
    listEl.innerHTML = '<div class="md-comments-empty" style="color:rgba(255,255,255,.4);font-size:12px;padding:10px 0">'+(_cL('아직 댓글이 없어요. 첫 댓글을 남겨보세요.','No comments yet. Be the first.'))+'</div>';
    return;
  }
  var html = '';
  var myId = (typeof SB !== 'undefined' && SB.user) ? SB.user.id : null;
  comments.forEach(function(c){
    var name = (c.author && c.author.name) || 'User';
    var initials = name.split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase();
    var timeStr = (typeof timeAgo === 'function') ? timeAgo(c.createdAt) : '';
    var canDelete = myId && c.author && c.author.id === myId;
    html += '<div class="md-comment" data-id="'+c.id+'">';
    html += '  <div class="md-comment-av">'+initials+'</div>';
    html += '  <div class="md-comment-body">';
    html += '    <div class="md-comment-meta"><strong>'+escHtml(name)+'</strong> <span class="md-comment-time">'+timeStr+'</span>'
          + (canDelete ? '<button class="md-comment-del" onclick="deleteMoodboardComment(\''+c.id+'\')" title="Delete">×</button>' : '')
          + '</div>';
    var cOrig = (c.contentOriginal != null) ? c.contentOriginal : c.content;
    html += '    <div class="md-comment-content" data-original="'+escHtml(cOrig)+'" data-translated="'+escHtml(c.content)+'">'+escHtml(c.content)+'</div>';
    html += '  </div>';
    html += '</div>';
  });
  listEl.innerHTML = html;
}

window.submitMoodboardComment = function(boardId){
  if(!_canActLocal()) return;
  var input = document.getElementById('mdCommentInput');
  if(!input) return;
  var content = input.value.trim();
  if(!content) return;
  input.value = '';

  fetch('/api/community/moodboard-comments', {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ boardId: boardId, content: content }),
  }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(out){
      if(!out.ok){ showToast(out.j.message || 'Failed'); input.value = content; return; }
      // Append the new comment without reloading everything
      var listEl = document.getElementById('mdCommentsList');
      if(!listEl) return;
      var emptyEl = listEl.querySelector('.md-comments-empty');
      if(emptyEl) listEl.innerHTML = '';
      var c = out.j.comment;
      var name = (c.author && c.author.name) || 'You';
      var initials = name.split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase();
      var timeStr = (typeof timeAgo === 'function') ? timeAgo(c.createdAt) : '';
      var html = '<div class="md-comment" data-id="'+c.id+'">'
        + '<div class="md-comment-av">'+initials+'</div>'
        + '<div class="md-comment-body">'
        + '  <div class="md-comment-meta"><strong>'+escHtml(name)+'</strong> <span class="md-comment-time">'+timeStr+'</span>'
        + '    <button class="md-comment-del" onclick="deleteMoodboardComment(\''+c.id+'\')" title="Delete">×</button>'
        + '  </div>'
        + '  <div class="md-comment-content">'+escHtml(c.content)+'</div>'
        + '</div></div>';
      listEl.insertAdjacentHTML('beforeend', html);
    }).catch(function(){
      showToast('Failed to post comment');
      input.value = content;
    });
};

window.deleteMoodboardComment = function(commentId){
  if(!confirm(_cL('댓글을 삭제할까요?','Delete this comment?'))) return;
  fetch('/api/community/moodboard-comments?id=' + encodeURIComponent(commentId), {
    method:'DELETE', credentials:'include',
  }).then(function(r){
    if(r.ok){
      var el = document.querySelector('.md-comment[data-id="'+commentId+'"]');
      if(el) el.remove();
      var listEl = document.getElementById('mdCommentsList');
      if(listEl && !listEl.querySelector('.md-comment')){
        // Show empty state again
        listEl.innerHTML = '<div class="md-comments-empty" style="color:rgba(255,255,255,.4);font-size:12px;padding:10px 0">'+(_cL('아직 댓글이 없어요. 첫 댓글을 남겨보세요.','No comments yet. Be the first.'))+'</div>';
      }
    } else {
      showToast('Failed to delete');
    }
  }).catch(function(){ showToast('Failed to delete'); });
};

// ── 4.7 Team Tags rendering helper (The Dots-style) ──
window.renderTeamTags = function(team){
  if(!team || team.length === 0) return '';
  var html = '<div class="proj-team">';
  var shown = team.slice(0,4);
  shown.forEach(function(m){
    var initials = (m.name||'?').substring(0,1).toUpperCase();
    html += '<div class="proj-team-av" title="'+escHtml(m.name)+' — '+escHtml(m.role||'')+'">'+initials+'</div>';
  });
  if(team.length > 4){
    html += '<div class="proj-team-more">+' + (team.length - 4) + '</div>';
  }
  html += '</div>';
  return html;
};

// Toggle the moodboard title/description (and visible comments) between
// translated and original. Reads pre-stashed data-original/data-translated
// from the rendered HTML so no extra fetch is needed.
window._toggleMoodboardOriginal = function(btn){
  var head = btn.closest('.md-head');
  if(!head) return;
  var nextMode = btn.dataset.mode === 'translated' ? 'original' : 'translated';
  btn.dataset.mode = nextMode;
  var title = head.querySelector('.md-title');
  var desc  = head.querySelector('.md-desc');
  if(title) title.textContent = title.dataset[nextMode] || title.textContent;
  if(desc)  desc.textContent  = desc.dataset[nextMode]  || desc.textContent;
  // Also flip every comment that has an .md-comment-content with both data sets
  document.querySelectorAll('.md-comment-content[data-original][data-translated]').forEach(function(el){
    el.textContent = el.dataset[nextMode] || el.textContent;
  });
  // Update label
  btn.innerHTML = '🌐 ' + (nextMode === 'original'
    ? (_cL('번역 보기','View translation'))
    : (_cL('원문 보기','View original')));
};

window.closeMoodDetail = function(){
  var ov = document.getElementById('moodDetailOverlay');
  if(ov) ov.classList.remove('active');
};

// ── Mission 5: Editorial bridge ─────────────────────────────────────────
// Sends the user to /submission with the moodboard ID prefilled.
// submission.html reads ?moodboard= and pulls the board's images/title to
// pre-fill the form so the member doesn't re-enter context they already
// captured in the moodboard.
window.bridgeToEditorial = function(boardId){
  if(!_canActLocal()) return;
  window.location.href = '/submission?moodboard=' + encodeURIComponent(boardId);
};

// ── 4.7 SCRAPBOOK — personal visual collection (web-native curation) ──
// Lightweight masonry grid. Loads caller's own scrapbook by default; pass
// userId to view someone else's. Public-readable, owner-mutable.
window.loadScraps = function(userId){
  var grid = document.getElementById('scrapGrid');
  if(!grid) return;
  var url = '/api/community/scraps';
  if(userId) url += '?userId=' + encodeURIComponent(userId);
  fetch(url, { credentials:'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var scraps = (data && data.scraps) || [];
      if(scraps.length === 0){
        grid.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text4);grid-column:1/-1"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="margin-bottom:12px;opacity:.4"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><p style="font-size:12px">'+(L[lang]&&L[lang].scrapEmpty||'No scraps yet')+'</p></div>';
        return;
      }
      var canEdit = !userId || (SB.user && userId === SB.user.id);
      var html = '';
      scraps.forEach(function(s){
        html += '<div class="scrap-card" data-id="'+s.id+'">';
        var img = '<img src="'+escHtml(s.imageUrl)+'" alt="" loading="lazy" onerror="this.style.opacity=\'.3\'">';
        if(s.sourceUrl){
          html += '<a href="'+escHtml(s.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+img+'</a>';
        } else {
          html += img;
        }
        if(s.note) html += '<div class="scrap-note">'+escHtml(s.note)+'</div>';
        if(canEdit) html += '<button class="scrap-del" title="Delete" onclick="deleteScrap(\''+s.id+'\',this)">×</button>';
        html += '</div>';
      });
      grid.innerHTML = html;
    }).catch(function(){
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text4);font-size:12px;grid-column:1/-1">Failed to load scraps</div>';
    });
};

// Upload zone helpers — converge file picker, drag-drop, paste, and URL
// input into a single preview. Auto-fills addScrapImage when a file is
// uploaded so submitScrap() can use the existing URL-based POST path.
function _scrapShowPreview(url){
  var img = document.getElementById('scrapPreviewImg');
  var prev = document.getElementById('scrapDropPreview');
  var empty = document.getElementById('scrapDropEmpty');
  if(!img || !prev || !empty) return;
  img.src = url;
  prev.style.display = '';
  empty.style.display = 'none';
}
function _scrapClearPreview(){
  var img = document.getElementById('scrapPreviewImg');
  var prev = document.getElementById('scrapDropPreview');
  var empty = document.getElementById('scrapDropEmpty');
  var urlInput = document.getElementById('addScrapImage');
  if(img) img.src = '';
  if(prev) prev.style.display = 'none';
  if(empty) empty.style.display = '';
  if(urlInput) urlInput.value = '';
  var f = document.getElementById('addScrapFile');
  if(f) f.value = '';
}
window._scrapClearPreview = _scrapClearPreview;

function _scrapPreviewFromUrl(url){
  // Live URL input — show preview if it looks like an image URL
  if(!url) { _scrapClearPreview(); return; }
  if(/^https?:\/\//i.test(url)) _scrapShowPreview(url);
}
window._scrapPreviewFromUrl = _scrapPreviewFromUrl;

function _scrapSetUploading(on){
  var u = document.getElementById('scrapDropUploading');
  var empty = document.getElementById('scrapDropEmpty');
  var prev = document.getElementById('scrapDropPreview');
  if(u) u.style.display = on ? '' : 'none';
  if(on){
    if(empty) empty.style.display = 'none';
    if(prev) prev.style.display = 'none';
  }
}
function _scrapUploadFile(file){
  if(!file) return;
  if(!file.type || !/^image\//.test(file.type)){
    showToast(_cL('이미지 파일만 업로드할 수 있어요','Only image files supported'));
    return;
  }
  _scrapSetUploading(true);
  var fd = new FormData();
  fd.append('file', file);
  var token = localStorage.getItem('pap-token');
  fetch('/api/community/scrap-upload', {
    method:'POST',
    headers: token ? { 'Authorization':'Bearer '+token } : {},
    credentials:'include',
    body: fd,
  }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(out){
      _scrapSetUploading(false);
      if(!out.ok){
        showToast(out.j.message || (_cL('업로드 실패','Upload failed')));
        var empty = document.getElementById('scrapDropEmpty');
        if(empty) empty.style.display = '';
        return;
      }
      // Fill the URL input + show preview — submitScrap() then uses the URL
      var urlInput = document.getElementById('addScrapImage');
      if(urlInput) urlInput.value = out.j.url;
      _scrapShowPreview(out.j.url);
    }).catch(function(){
      _scrapSetUploading(false);
      showToast(_cL('업로드 실패','Upload failed'));
      var empty = document.getElementById('scrapDropEmpty');
      if(empty) empty.style.display = '';
    });
}
window._scrapHandleFiles = function(files){
  if(files && files.length > 0) _scrapUploadFile(files[0]);
};

// Wire drag-drop on the drop zone + paste on the modal (modal must be open).
function _scrapWireOnce(){
  var zone = document.getElementById('scrapDropZone');
  if(!zone || zone.dataset.wired) return;
  zone.dataset.wired = '1';
  ['dragenter','dragover'].forEach(function(ev){
    zone.addEventListener(ev, function(e){
      e.preventDefault();
      zone.style.borderColor = 'var(--accent, var(--pap-red))';
      zone.style.background = 'rgba(137,23,23,.04)';
    });
  });
  ['dragleave','dragend','drop'].forEach(function(ev){
    zone.addEventListener(ev, function(e){
      e.preventDefault();
      zone.style.borderColor = '';
      zone.style.background = '';
    });
  });
  zone.addEventListener('drop', function(e){
    var files = e.dataTransfer && e.dataTransfer.files;
    if(files && files.length > 0) _scrapUploadFile(files[0]);
  });
}
function _scrapWirePaste(){
  // Paste handler — only active while the modal is open
  if(window._scrapPasteHandler) return;
  window._scrapPasteHandler = function(e){
    var bg = document.getElementById('addScrapBg');
    if(!bg || !bg.classList.contains('active')) return;
    var items = e.clipboardData && e.clipboardData.items;
    if(!items) return;
    for(var i=0;i<items.length;i++){
      if(items[i].type && items[i].type.indexOf('image/') === 0){
        var file = items[i].getAsFile();
        if(file){ e.preventDefault(); _scrapUploadFile(file); return; }
      }
    }
  };
  document.addEventListener('paste', window._scrapPasteHandler);
}

window.openAddScrap = function(){
  if(!_canActLocal()) return;
  var bg = document.getElementById('addScrapBg');
  if(!bg) return;
  document.getElementById('addScrapImage').value = '';
  document.getElementById('addScrapNote').value = '';
  document.getElementById('addScrapSource').value = '';
  var f = document.getElementById('addScrapFile');
  if(f) f.value = '';
  _scrapClearPreview();
  bg.classList.add('active');
  _scrapWireOnce();
  _scrapWirePaste();
};

window.closeAddScrap = function(){
  var bg = document.getElementById('addScrapBg');
  if(bg) bg.classList.remove('active');
};

window.submitScrap = function(){
  var imageUrl = (document.getElementById('addScrapImage').value || '').trim();
  var note     = (document.getElementById('addScrapNote').value || '').trim();
  var src      = (document.getElementById('addScrapSource').value || '').trim();
  if(!imageUrl){
    showToast(_cL('이미지 URL을 입력하세요','Enter an image URL'));
    return;
  }
  fetch('/api/community/scraps', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    credentials:'include',
    body: JSON.stringify({ imageUrl: imageUrl, note: note || null, sourceUrl: src || null, sourceType: src ? 'external' : 'upload' }),
  }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(out){
      if(!out.ok){ showToast(out.j.message || 'Failed to save'); return; }
      closeAddScrap();
      loadScraps();
    }).catch(function(){ showToast('Failed to save'); });
};

window.deleteScrap = function(id, btn){
  if(!confirm((L[lang]&&L[lang].scrapDelConfirm)||'Delete?')) return;
  fetch('/api/community/scraps?id='+encodeURIComponent(id), {
    method:'DELETE', credentials:'include',
  }).then(function(r){
    if(r.ok){
      var card = btn && btn.closest('.scrap-card');
      if(card) card.remove();
    } else {
      showToast('Failed to delete');
    }
  }).catch(function(){ showToast('Failed to delete'); });
};

// ======================================================================
// ── _refreshCommunityUgc — called by setLang to re-fetch translatable
// content in the new language. Safe to call repeatedly. ───────────────
window._refreshCommunityUgc = function(){
  try {
    // 1) Moodboard tab grid (if visible)
    if(typeof loadMoodboards === 'function'){
      var mTab = document.getElementById('t-moodboard');
      if(mTab && mTab.classList.contains('active')) loadMoodboards();
    }
    // 2) Discovery sidebar (always visible on desktop)
    if(typeof loadDiscovery === 'function') loadDiscovery();
    // 3) Open moodboard detail (re-fetch + re-render)
    var mdOv = document.getElementById('moodDetailOverlay');
    if(mdOv && mdOv.classList.contains('active')){
      // Re-extract id from comments section
      var sec = document.querySelector('.md-comments-section[data-board-id]');
      var id = sec && sec.getAttribute('data-board-id');
      if(id && typeof openMoodboard === 'function') openMoodboard(id);
    }
    // 4) Open profile popup (re-fetch using id stashed on the popup root)
    var pp = document.getElementById('profilePopupBg');
    if(pp && pp.classList.contains('active') && pp.dataset.memberId){
      if(typeof openMemberProfile === 'function') openMemberProfile(pp.dataset.memberId);
    }
  } catch(e){ /* swallow — language switch must never break */ }
};

function initV2(){
  // Periodically check notifications (every 60s)
  if(SB.user){
    loadNotifications();
    setInterval(loadNotifications, 60000);
    // Check badges on load
    setTimeout(checkBadges, 3000);
    // Load membership tier
    loadMembershipTier();
  }

  // Load featured creators for sidebar
  loadFeaturedCreators();
  // Load discovery surfaces (trending moodboards, active creators, recent scraps)
  if(typeof loadDiscovery === 'function') loadDiscovery();

  // Listen for auth changes
  document.addEventListener('pap-auth-changed', function(){
    if(SB.user){
      loadNotifications();
      checkBadges();
      loadMembershipTier();
    }
  });
}

// Run after a short delay to ensure main script has initialized
setTimeout(initV2, 500);

})();
