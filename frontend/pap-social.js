/**
 * PAP Social Module — Comments + Ratings (Supabase-backed)
 * ---------------------------------------------------------
 * - Comments on editorials & articles
 * - 1-5 star ratings on editorials
 * - Creator profile average rating
 *
 * Storage: Supabase Postgres via @supabase/supabase-js (loaded via CDN)
 * Falls back to localStorage when Supabase client is unavailable
 * (e.g., offline, SDK load failure).
 *
 * Public API:
 *   PAPSocial.renderEditorialSocial(containerEl, editorialTitle)
 *   PAPSocial.renderArticleSocial(containerEl, articleSlug, articleTitle)
 *   PAPSocial.getCreatorAvgRating(creatorHandle) -> Promise<{avg,count,...}>
 *   PAPSocial.currentUser() -> {id,name,handle} | null
 */

// 2026-08-05 — 에디토리얼 카드 링크 언어 접두어 헬퍼 (다인, 3차 라운드).
// 문제: 아래 카드 생성기들이 항상 '/editorial/<slug>' (한국어 정본) 을 써서,
// /en·/ja 페이지에서 SSR 이 올바르게 심어 둔 <a href="/en/editorial/..."> 를
// 클라이언트 렌더가 덮어썼다. 크롤러가 JS 실행 후 보는 내부 링크 그래프가
// 통째로 한국어로 되돌아간다(2026-08-05 라이브 확인).
// 제약: 무조건 접두어를 붙이면 안 된다 — api/seo/editorial/[slug].js 는
// 번역이 없는 항목에 대해 302(→/en) 를 내므로 "리디렉션이 포함된 페이지"가
// 다시 늘어난다. 그래서 /api/editorials/untranslated?lang=xx 로 '번역 없는
// 예외 목록'만 받아 제외한다(실측 최대 16편 — 응답 수십 바이트).
// 정의는 idempotent — 어느 파일이 먼저 로드돼도 안전하다.
if (!window._papLangPrefix) {
  window._papLangPrefix = function(){
    try{
      var m = String(location.pathname||'').match(/^\/(en|it|fr|es|ja|de|zh|ru)(\/|$)/);
      if (m) return '/' + m[1];
      if (window.__papDeepLinkLang) return '/' + window.__papDeepLinkLang;
    }catch(_){}
    return '';
  };
}
if (!window._papEdHref) {
  // null = 아직 미도착. 미도착일 땐 접두어를 붙이지 않는다(안전측 = 기존 동작).
  window.__papEdMissing = window.__papEdMissing || null;

  window._papEdHref = function(slugOrId){
    var base = '/editorial/' + encodeURIComponent(slugOrId);
    var p = window._papLangPrefix ? window._papLangPrefix() : '';
    if (!p) return base;                 // 한국어 정본
    if (p === '/en') return p + base;    // en 은 DB 원본 필드 — 항상 존재, 302 없음
    var miss = window.__papEdMissing;
    if (!miss) return base;
    return miss.has(String(slugOrId)) ? base : p + base;
  };

  // 예외 목록이 늦게 도착하면 이미 그려진 카드의 href 를 올려준다.
  // 대상은 우리가 심은 data-paped 앵커로 한정 — 다른 링크는 건드리지 않는다.
  window._papEdUpgradeHrefs = function(){
    try{
      var list = document.querySelectorAll('a[data-paped]');
      for (var i = 0; i < list.length; i++){
        var s = list[i].getAttribute('data-paped');
        if (s) list[i].setAttribute('href', window._papEdHref(s));
      }
    }catch(_){}
  };

  (function _papEdLoadMissing(){
    var p = window._papLangPrefix ? window._papLangPrefix() : '';
    if (!p || p === '/en') return;       // ko·en 은 조회 자체가 불필요
    if (window.__papEdMissingLoading) return;
    window.__papEdMissingLoading = true;
    try{
      fetch('/api/editorials/untranslated?lang=' + encodeURIComponent(p.slice(1)))
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){
          if (!j) return;
          var keys = [];
          (j.slugs || []).forEach(function(s){ keys.push(String(s)); });
          (j.ids   || []).forEach(function(s){ keys.push(String(s)); });
          window.__papEdMissing = new Set(keys);
          window._papEdUpgradeHrefs();
        })
        .catch(function(){ /* 실패 시 미도착 상태 유지 = 기존 동작 */ });
    }catch(_){}
  })();
}

(function(global){
  'use strict';

  // ======== i18n (login hints + empty-state messages) ========
  // Self-contained — does not depend on pap-app.js's T table being
  // available, so this module also works on pages that don't ship the
  // full app (e.g. articles.html, mypage.html if they ever use this).
  var _PAP_SOC_I18N = {
    ko:{loginToRate:'로그인하시면 별점을 남길 수 있습니다',loginToComment:'댓글 작성은 로그인이 필요합니다',noComments:'아직 댓글이 없습니다. 첫 댓글을 남겨주세요.',login:'로그인',commentPh:'댓글을 남겨주세요',submit:'등록',rateCancel:'별점 취소',rateDeleteTitle:'별점 삭제',ratingCtaQ:'이 화보가 마음에 드셨나요?',ratingLoading:'별점 불러오는 중...',ratingAvg:'평균',ratingCountSuffix:'명 참여',ratingNone:'아직 평가가 없어요. 첫 별점을 남겨보세요!',ratingMine:'내 평점',ratingScoreSuffix:'점',relatedHeading:'이것도 좋아할 거예요',timeJustNow:'방금 전',timeMinAgo:'분 전',timeHourAgo:'시간 전',timeDayAgo:'일 전',myRatingLabel:'나의 평점:',notRated:'미평가',ratingSaveFail:'별점 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.',ratingDeleteConfirm:'내 별점을 취소하시겠습니까?',ratingDeleteFail:'별점 취소에 실패했습니다.',ratingLoadFail:'별점을 불러오지 못했습니다. 페이지를 새로고침해 주세요.',commentDeleteTitle:'삭제',reply:'답글',commentsLoading:'댓글 불러오는 중...',submitting:'등록 중...',commentSubmitFail:'댓글 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.',commentDeleteConfirm:'이 댓글을 삭제하시겠습니까? 달린 답글도 함께 삭제됩니다.',commentDeleteFail:'삭제에 실패했습니다.',cancel:'취소',replyPh:'답글을 남겨주세요',replySubmit:'답글 등록',replySubmitFail:'답글 등록에 실패했습니다.',commentsLoadFail:'댓글을 불러오지 못했습니다.'},
    en:{loginToRate:'Sign in to leave a rating',loginToComment:'Sign in to leave a comment',noComments:'No comments yet. Be the first to comment.',login:'Sign In',commentPh:'Leave a comment',submit:'Post',rateCancel:'Remove rating',rateDeleteTitle:'Delete rating',ratingCtaQ:'Did you enjoy this editorial?',ratingLoading:'Loading rating...',ratingAvg:'Avg',ratingCountSuffix:' ratings',ratingNone:'No ratings yet. Be the first!',ratingMine:'Your rating',ratingScoreSuffix:'',relatedHeading:'You might also like',timeJustNow:'just now',timeMinAgo:'m ago',timeHourAgo:'h ago',timeDayAgo:'d ago',myRatingLabel:'Your rating:',notRated:'Not rated',ratingSaveFail:'Failed to save your rating. Please try again shortly.',ratingDeleteConfirm:'Remove your rating?',ratingDeleteFail:'Failed to remove rating.',ratingLoadFail:'Could not load ratings. Please refresh the page.',commentDeleteTitle:'Delete',reply:'Reply',commentsLoading:'Loading comments...',submitting:'Posting...',commentSubmitFail:'Failed to post comment. Please try again shortly.',commentDeleteConfirm:'Delete this comment? Its replies will be deleted too.',commentDeleteFail:'Failed to delete.',cancel:'Cancel',replyPh:'Write a reply',replySubmit:'Post reply',replySubmitFail:'Failed to post reply.',commentsLoadFail:'Could not load comments.'},
    it:{ratingCtaQ:"Ti è piaciuto questo editoriale?",ratingLoading:"Caricamento valutazione...",ratingAvg:"Media",ratingCountSuffix:" valutazioni",ratingNone:"Ancora nessuna valutazione. Sii il primo!",ratingMine:"La tua valutazione",ratingScoreSuffix:" pt",relatedHeading:"Potrebbe interessarti anche",timeJustNow:"proprio ora",timeMinAgo:" min fa",timeHourAgo:" h fa",timeDayAgo:" g fa",myRatingLabel:"La tua valutazione:",notRated:"Non valutato",ratingSaveFail:"Impossibile salvare la valutazione. Riprova tra poco.",ratingDeleteConfirm:"Rimuovere la tua valutazione?",ratingDeleteFail:"Impossibile rimuovere la valutazione.",ratingLoadFail:"Impossibile caricare le valutazioni. Aggiorna la pagina.",commentDeleteTitle:"Elimina",reply:"Rispondi",commentsLoading:"Caricamento commenti...",submitting:"Pubblicazione...",commentSubmitFail:"Impossibile pubblicare il commento. Riprova tra poco.",commentDeleteConfirm:"Eliminare questo commento? Anche le risposte verranno eliminate.",commentDeleteFail:"Eliminazione non riuscita.",cancel:"Annulla",replyPh:"Scrivi una risposta",replySubmit:"Pubblica risposta",replySubmitFail:"Impossibile pubblicare la risposta.",commentsLoadFail:"Impossibile caricare i commenti.",loginToRate:'Accedi per lasciare una valutazione',loginToComment:'Accedi per lasciare un commento',noComments:'Nessun commento. Lascia il primo commento.',login:'Accedi',commentPh:'Lascia un commento',submit:'Pubblica',rateCancel:'Rimuovi valutazione',rateDeleteTitle:'Elimina valutazione'},
    fr:{ratingCtaQ:"Avez-vous aimé cet éditorial ?",ratingLoading:"Chargement de la note...",ratingAvg:"Moy.",ratingCountSuffix:" notes",ratingNone:"Aucune note pour l'instant. Soyez le premier !",ratingMine:"Votre note",ratingScoreSuffix:" pts",relatedHeading:"Vous aimerez aussi",timeJustNow:"à l'instant",timeMinAgo:" min",timeHourAgo:" h",timeDayAgo:" j",myRatingLabel:"Votre note :",notRated:"Non noté",ratingSaveFail:"Échec de l'enregistrement de la note. Réessayez bientôt.",ratingDeleteConfirm:"Supprimer votre note ?",ratingDeleteFail:"Échec de la suppression de la note.",ratingLoadFail:"Impossible de charger les notes. Actualisez la page.",commentDeleteTitle:"Supprimer",reply:"Répondre",commentsLoading:"Chargement des commentaires...",submitting:"Publication...",commentSubmitFail:"Échec de la publication du commentaire. Réessayez bientôt.",commentDeleteConfirm:"Supprimer ce commentaire ? Ses réponses seront aussi supprimées.",commentDeleteFail:"Échec de la suppression.",cancel:"Annuler",replyPh:"Écrire une réponse",replySubmit:"Publier la réponse",replySubmitFail:"Échec de la publication de la réponse.",commentsLoadFail:"Impossible de charger les commentaires.",loginToRate:'Connectez-vous pour laisser une note',loginToComment:'Connectez-vous pour laisser un commentaire',noComments:'Aucun commentaire pour le moment. Soyez le premier à commenter.',login:'Connexion',commentPh:'Laissez un commentaire',submit:'Publier',rateCancel:'Retirer la note',rateDeleteTitle:'Supprimer la note'},
    es:{ratingCtaQ:"¿Te ha gustado este editorial?",ratingLoading:"Cargando valoración...",ratingAvg:"Media",ratingCountSuffix:" valoraciones",ratingNone:"Aún no hay valoraciones. ¡Sé el primero!",ratingMine:"Tu valoración",ratingScoreSuffix:" pts",relatedHeading:"También te puede gustar",timeJustNow:"ahora mismo",timeMinAgo:" min",timeHourAgo:" h",timeDayAgo:" d",myRatingLabel:"Tu valoración:",notRated:"Sin valorar",ratingSaveFail:"No se pudo guardar tu valoración. Inténtalo de nuevo en un momento.",ratingDeleteConfirm:"¿Eliminar tu valoración?",ratingDeleteFail:"No se pudo eliminar la valoración.",ratingLoadFail:"No se pudieron cargar las valoraciones. Actualiza la página.",commentDeleteTitle:"Eliminar",reply:"Responder",commentsLoading:"Cargando comentarios...",submitting:"Publicando...",commentSubmitFail:"No se pudo publicar el comentario. Inténtalo de nuevo en un momento.",commentDeleteConfirm:"¿Eliminar este comentario? Sus respuestas también se eliminarán.",commentDeleteFail:"No se pudo eliminar.",cancel:"Cancelar",replyPh:"Escribe una respuesta",replySubmit:"Publicar respuesta",replySubmitFail:"No se pudo publicar la respuesta.",commentsLoadFail:"No se pudieron cargar los comentarios.",loginToRate:'Inicia sesión para dejar una valoración',loginToComment:'Inicia sesión para dejar un comentario',noComments:'Aún no hay comentarios. Sé el primero en comentar.',login:'Iniciar Sesión',commentPh:'Deja un comentario',submit:'Publicar',rateCancel:'Quitar valoración',rateDeleteTitle:'Eliminar valoración'},
    ja:{ratingCtaQ:"このエディトリアルは楽しめましたか？",ratingLoading:"評価を読み込み中...",ratingAvg:"平均",ratingCountSuffix:"件の評価",ratingNone:"まだ評価がありません。最初の評価を！",ratingMine:"あなたの評価",ratingScoreSuffix:"点",relatedHeading:"こちらもおすすめ",timeJustNow:"たった今",timeMinAgo:"分前",timeHourAgo:"時間前",timeDayAgo:"日前",myRatingLabel:"あなたの評価:",notRated:"未評価",ratingSaveFail:"評価を保存できませんでした。しばらくしてからもう一度お試しください。",ratingDeleteConfirm:"評価を削除しますか？",ratingDeleteFail:"評価を削除できませんでした。",ratingLoadFail:"評価を読み込めませんでした。ページを更新してください。",commentDeleteTitle:"削除",reply:"返信",commentsLoading:"コメントを読み込み中...",submitting:"投稿中...",commentSubmitFail:"コメントを投稿できませんでした。しばらくしてからもう一度お試しください。",commentDeleteConfirm:"このコメントを削除しますか？返信もすべて削除されます。",commentDeleteFail:"削除できませんでした。",cancel:"キャンセル",replyPh:"返信を書く",replySubmit:"返信を投稿",replySubmitFail:"返信を投稿できませんでした。",commentsLoadFail:"コメントを読み込めませんでした。",loginToRate:'ログインすると評価を残せます',loginToComment:'コメント投稿にはログインが必要です',noComments:'まだコメントがありません。最初のコメントを残してください。',login:'ログイン',commentPh:'コメントを残してください',submit:'投稿',rateCancel:'評価を取り消す',rateDeleteTitle:'評価を削除'},
    zh:{ratingCtaQ:"喜欢这篇编辑内容吗？",ratingLoading:"正在加载评分...",ratingAvg:"平均",ratingCountSuffix:" 条评分",ratingNone:"暂无评分。来做第一个吧！",ratingMine:"你的评分",ratingScoreSuffix:"分",relatedHeading:"你可能还喜欢",timeJustNow:"刚刚",timeMinAgo:"分钟前",timeHourAgo:"小时前",timeDayAgo:"天前",myRatingLabel:"你的评分：",notRated:"未评分",ratingSaveFail:"评分保存失败。请稍后再试。",ratingDeleteConfirm:"删除你的评分？",ratingDeleteFail:"删除评分失败。",ratingLoadFail:"无法加载评分。请刷新页面。",commentDeleteTitle:"删除",reply:"回复",commentsLoading:"正在加载评论...",submitting:"发布中...",commentSubmitFail:"评论发布失败。请稍后再试。",commentDeleteConfirm:"删除这条评论？其回复也将被删除。",commentDeleteFail:"删除失败。",cancel:"取消",replyPh:"写回复",replySubmit:"发布回复",replySubmitFail:"回复发布失败。",commentsLoadFail:"无法加载评论。",loginToRate:'登录后可以评分',loginToComment:'发表评论需要登录',noComments:'暂无评论。来发表第一条评论吧。',login:'登录',commentPh:'留下评论',submit:'发布',rateCancel:'取消评分',rateDeleteTitle:'删除评分'},
    ru:{ratingCtaQ:"Понравился этот материал?",ratingLoading:"Загрузка оценки...",ratingAvg:"Сред.",ratingCountSuffix:" оценок",ratingNone:"Оценок пока нет. Будьте первым!",ratingMine:"Ваша оценка",ratingScoreSuffix:" б.",relatedHeading:"Вам также может понравиться",timeJustNow:"только что",timeMinAgo:" мин назад",timeHourAgo:" ч назад",timeDayAgo:" дн назад",myRatingLabel:"Ваша оценка:",notRated:"Без оценки",ratingSaveFail:"Не удалось сохранить оценку. Повторите попытку позже.",ratingDeleteConfirm:"Удалить вашу оценку?",ratingDeleteFail:"Не удалось удалить оценку.",ratingLoadFail:"Не удалось загрузить оценки. Обновите страницу.",commentDeleteTitle:"Удалить",reply:"Ответить",commentsLoading:"Загрузка комментариев...",submitting:"Публикация...",commentSubmitFail:"Не удалось опубликовать комментарий. Повторите попытку позже.",commentDeleteConfirm:"Удалить этот комментарий? Ответы к нему тоже будут удалены.",commentDeleteFail:"Не удалось удалить.",cancel:"Отмена",replyPh:"Написать ответ",replySubmit:"Отправить ответ",replySubmitFail:"Не удалось отправить ответ.",commentsLoadFail:"Не удалось загрузить комментарии.",loginToRate:'Войдите, чтобы оставить оценку',loginToComment:'Войдите, чтобы оставить комментарий',noComments:'Комментариев пока нет. Будьте первым.',login:'Войти',commentPh:'Оставьте комментарий',submit:'Отправить',rateCancel:'Убрать оценку',rateDeleteTitle:'Удалить оценку'},
    de:{ratingCtaQ:"Hat Ihnen dieses Editorial gefallen?",ratingLoading:"Bewertung wird geladen...",ratingAvg:"Ø",ratingCountSuffix:" Bewertungen",ratingNone:"Noch keine Bewertungen. Seien Sie der Erste!",ratingMine:"Ihre Bewertung",ratingScoreSuffix:" Pkt.",relatedHeading:"Das könnte Ihnen auch gefallen",timeJustNow:"gerade eben",timeMinAgo:" Min.",timeHourAgo:" Std.",timeDayAgo:" Tg.",myRatingLabel:"Ihre Bewertung:",notRated:"Nicht bewertet",ratingSaveFail:"Bewertung konnte nicht gespeichert werden. Bitte versuchen Sie es gleich erneut.",ratingDeleteConfirm:"Ihre Bewertung entfernen?",ratingDeleteFail:"Bewertung konnte nicht entfernt werden.",ratingLoadFail:"Bewertungen konnten nicht geladen werden. Bitte aktualisieren Sie die Seite.",commentDeleteTitle:"Löschen",reply:"Antworten",commentsLoading:"Kommentare werden geladen...",submitting:"Wird gepostet...",commentSubmitFail:"Kommentar konnte nicht gepostet werden. Bitte versuchen Sie es gleich erneut.",commentDeleteConfirm:"Diesen Kommentar löschen? Die Antworten werden ebenfalls gelöscht.",commentDeleteFail:"Löschen fehlgeschlagen.",cancel:"Abbrechen",replyPh:"Antwort schreiben",replySubmit:"Antwort posten",replySubmitFail:"Antwort konnte nicht gepostet werden.",commentsLoadFail:"Kommentare konnten nicht geladen werden.",loginToRate:'Melde dich an, um zu bewerten',loginToComment:'Melde dich an, um zu kommentieren',noComments:'Noch keine Kommentare. Sei der Erste.',login:'Anmelden',commentPh:'Kommentar hinterlassen',submit:'Posten',rateCancel:'Bewertung entfernen',rateDeleteTitle:'Bewertung löschen'}
  };
  function _papSocLang(){
    try { var l = localStorage.getItem('pap-lang'); return (l && _PAP_SOC_I18N[l]) ? l : 'ko'; }
    catch(e){ return 'ko'; }
  }
  function _papSocT(key){
    var l = _papSocLang();
    var d = _PAP_SOC_I18N[l] || _PAP_SOC_I18N.ko;
    return d[key] || _PAP_SOC_I18N.ko[key] || key;
  }

  // ======== SUPABASE CONFIG ========
  var SUPABASE_URL = 'https://igcazquhkwxtqsaqpznx.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8Q19ICgnEqkrjH2hPvwgbA_9pSVDh55';
  var supabaseClient = null;

  function initSupabase(){
    if(supabaseClient) return supabaseClient;
    try{
      if(typeof global.supabase !== 'undefined' && global.supabase.createClient){
        supabaseClient = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false }
        });
      }
    }catch(e){ console.warn('[PAPSocial] Supabase init failed:', e); }
    return supabaseClient;
  }

  // ======== LOCAL CACHE (for immediate UI, then sync with server) ========
  var CACHE = {
    comments: {}, // key: type:id -> [comments]
    ratings: {},  // key: editorialTitle -> {avg,count,myScore}
    creatorRatings: {} // key: handle -> {avg,count,...}
  };

  // ======== CURRENT USER ========
  function currentUser(){
    try{
      var u = localStorage.getItem('pap-user');
      if(!u) return null;
      var parsed = JSON.parse(u);
      if(!parsed) return null;
      return {
        id: String(parsed.id || parsed.email || parsed.username || 'anon'),
        name: parsed.name || parsed.username || (parsed.email||'').split('@')[0] || 'User',
        handle: parsed.handle || parsed.username || ''
      };
    }catch(e){ return null; }
  }
  function isLoggedIn(){ return !!currentUser(); }

  // Build login URL that returns to the current page (including hash)
  function _loginUrl(){
    try{
      var here = location.pathname + location.search + location.hash;
      return '/auth?mode=login&return=' + encodeURIComponent(here);
    }catch(e){
      return '/auth?mode=login';
    }
  }

  // ======== UTILITIES ========
  function escapeHTML(s){
    return String(s||'').replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function timeAgo(ts){
    var t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
    var diff = (Date.now() - t) / 1000;
    if(diff < 60) return _papSocT('timeJustNow');
    if(diff < 3600) return Math.floor(diff/60) + _papSocT('timeMinAgo');
    if(diff < 86400) return Math.floor(diff/3600) + _papSocT('timeHourAgo');
    if(diff < 2592000) return Math.floor(diff/86400) + _papSocT('timeDayAgo');
    return new Date(t).toISOString().slice(0,10);
  }

  // ======== SUPABASE DATA LAYER ========
  function sbListComments(targetType, targetId){
    var sb = initSupabase();
    if(!sb) return Promise.resolve([]);
    return sb.from('comments')
      .select('*')
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .order('created_at', { ascending: true })
      .then(function(res){
        if(res.error){ console.warn('[PAPSocial] listComments error:', res.error); return []; }
        return (res.data||[]).map(function(row){
          return {
            id: row.id,
            targetType: row.target_type,
            targetId: row.target_id,
            userId: row.user_id,
            userName: row.user_name,
            userHandle: row.user_handle,
            text: row.text,
            parentId: row.parent_id || null,
            ts: new Date(row.created_at).getTime()
          };
        });
      });
  }

  // ── 쓰기 경로는 전부 서버 API(/api/social/*) 경유 ──
  // Supabase anon 키에는 auth.uid()가 없어 RLS로 "본인만" 검증이 불가능하다.
  // 서버가 PAP JWT(pap-token)를 검증하고 service_role로 대신 쓴다. (2026-07 A-2)
  function _socialApi(method, path, body){
    var headers = { 'Content-Type': 'application/json' };
    try{
      var token = localStorage.getItem('pap-token');
      if(token) headers['Authorization'] = 'Bearer ' + token;
    }catch(e){}
    return fetch(path, {
      method: method,
      headers: headers,
      credentials: 'same-origin', // httpOnly pap_auth 쿠키 폴백
      body: body ? JSON.stringify(body) : undefined
    }).then(function(res){
      if(!res.ok){
        return res.json().catch(function(){ return {}; }).then(function(j){
          throw new Error(j.message || ('Request failed: ' + res.status));
        });
      }
      return res.json();
    });
  }

  function sbAddComment(targetType, targetId, text, user, parentId){
    var payload = {
      target_type: targetType,
      target_id: targetId,
      user_name: user.name,
      user_handle: user.handle||null,
      text: text
    };
    if(parentId) payload.parent_id = parentId;
    return _socialApi('POST', '/api/social/comments', payload).then(function(j){
      return j && j.comment;
    });
  }

  function sbDeleteRating(editorialTitle, userId){
    return _socialApi('DELETE', '/api/social/ratings', { editorial_title: editorialTitle })
      .then(function(){ return true; });
  }

  function sbDeleteComment(commentId, userId){
    return _socialApi('DELETE', '/api/social/comments', { id: commentId })
      .then(function(){ return true; });
  }

  function sbSetRating(editorialTitle, userId, score){
    return _socialApi('POST', '/api/social/ratings', {
      editorial_title: editorialTitle,
      score: score
    }).then(function(){ return true; });
  }

  function sbGetMyRating(editorialTitle, userId){
    var sb = initSupabase();
    if(!sb) return Promise.resolve(0);
    return sb.from('ratings')
      .select('score')
      .eq('editorial_title', editorialTitle)
      .eq('user_id', userId)
      .limit(1)
      .then(function(res){
        if(res.error || !res.data || res.data.length===0) return 0;
        return res.data[0].score;
      });
  }

  function sbGetRatingStats(editorialTitle){
    var sb = initSupabase();
    if(!sb) return Promise.resolve({avg:0,count:0});
    return sb.from('editorial_rating_stats')
      .select('avg_score,rating_count')
      .eq('editorial_title', editorialTitle)
      .limit(1)
      .then(function(res){
        if(res.error || !res.data || res.data.length===0) return {avg:0,count:0};
        return { avg: parseFloat(res.data[0].avg_score)||0, count: res.data[0].rating_count||0 };
      });
  }

  function sbGetAllStats(){
    var sb = initSupabase();
    if(!sb) return Promise.resolve([]);
    return sb.from('editorial_rating_stats').select('*')
      .then(function(res){
        if(res.error) return [];
        return res.data || [];
      });
  }

  // ======== RATING UI ========
  function starHTML(score, interactive){
    var h = '';
    for(var i=1; i<=5; i++){
      var filled = i <= Math.round(score);
      h += '<span class="pap-star '+(filled?'pap-star-on':'')+'" data-score="'+i+'" style="cursor:'+(interactive?'pointer':'default')+'">★</span>';
    }
    return h;
  }

  function renderRatingBlock(container, editorialTitle){
    var user = currentUser();

    // Show skeleton first
    container.innerHTML = '<div class="pap-social-section pap-rating-block">'+
      '<div class="pap-social-label">RATING</div>'+
      '<div class="pap-rating-row"><div class="pap-rating-avg"><span class="pap-rating-num">—</span></div></div>'+
      '<div class="pap-rating-me pap-login-hint">'+_papSocT('ratingLoading')+'</div>'+
    '</div>';

    Promise.all([
      sbGetRatingStats(editorialTitle),
      user ? sbGetMyRating(editorialTitle, user.id) : Promise.resolve(0)
    ]).then(function(results){
      var stats = results[0];
      var myScore = results[1] || 0;

      var h = '<div class="pap-social-section pap-rating-block">';
      h += '<div class="pap-social-label">RATING</div>';
      h += '<div class="pap-rating-row">';
      h += '  <div class="pap-rating-avg">';
      h += '    <span class="pap-rating-num">'+(stats.count>0?stats.avg.toFixed(1):'—')+'</span>';
      h += '    <span class="pap-rating-count">('+stats.count+')</span>';
      h += '  </div>';
      h += '  <div class="pap-rating-stars pap-rating-avg-stars">'+starHTML(stats.avg,false)+'</div>';
      h += '</div>';

      if(user){
        h += '<div class="pap-rating-me">';
        h += '  <span class="pap-rating-me-label">'+_papSocT('myRatingLabel')+'</span>';
        h += '  <div class="pap-rating-stars pap-rating-input" data-editorial="'+escapeHTML(editorialTitle)+'">'+starHTML(myScore,true)+'</div>';
        h += '  <span class="pap-rating-my-score">'+(myScore>0?(myScore+_papSocT('ratingScoreSuffix')):_papSocT('notRated'))+'</span>';
        if(myScore>0){
          h += '  <button class="pap-rating-delete" title="'+_papSocT('rateDeleteTitle')+'">'+_papSocT('rateCancel')+'</button>';
        }
        h += '</div>';
      } else {
        h += '<div class="pap-rating-me pap-login-hint">'+_papSocT('loginToRate')+' · <a rel="nofollow" href="'+_loginUrl()+'">'+_papSocT('login')+'</a></div>';
      }
      h += '</div>';

      container.innerHTML = h;

      var input = container.querySelector('.pap-rating-input');
      if(input && user){
        var stars = input.querySelectorAll('.pap-star');
        stars.forEach(function(st){
          st.addEventListener('mouseenter', function(){
            var s = parseInt(st.getAttribute('data-score'),10);
            stars.forEach(function(x,i){ x.classList.toggle('pap-star-hover', i<s); });
          });
          st.addEventListener('mouseleave', function(){
            stars.forEach(function(x){ x.classList.remove('pap-star-hover'); });
          });
          st.addEventListener('click', function(){
            var s = parseInt(st.getAttribute('data-score'),10);
            st.style.pointerEvents='none';
            sbSetRating(editorialTitle, user.id, s).then(function(){
              renderRatingBlock(container, editorialTitle);
            }).catch(function(err){
              console.error('[PAPSocial] rating save failed:', err);
              alert(_papSocT('ratingSaveFail'));
              st.style.pointerEvents='';
            });
          });
        });
      }

      // Delete rating button
      var delBtn = container.querySelector('.pap-rating-delete');
      if(delBtn && user){
        delBtn.addEventListener('click', function(){
          if(!confirm(_papSocT('ratingDeleteConfirm'))) return;
          delBtn.disabled = true;
          sbDeleteRating(editorialTitle, user.id).then(function(){
            renderRatingBlock(container, editorialTitle);
          }).catch(function(err){
            console.error('[PAPSocial] rating delete failed:', err);
            alert(_papSocT('ratingDeleteFail'));
            delBtn.disabled = false;
          });
        });
      }
    }).catch(function(err){
      console.error('[PAPSocial] rating load failed:', err);
      container.innerHTML = '<div class="pap-social-section"><div class="pap-social-label">RATING</div>'+
        '<div class="pap-login-hint">'+_papSocT('ratingLoadFail')+'</div></div>';
    });
  }

  // ======== COMMENTS UI ========
  function _renderCommentItem(c, user, isReply){
    var canDelete = user && user.id === c.userId;
    var canReply = !!user && !isReply; // only allow replies on top-level (2-level nesting)
    var h = '<div class="pap-comment-item'+(isReply?' pap-comment-reply':'')+'" data-comment-id="'+c.id+'">';
    h += '  <div class="pap-comment-head">';
    h += '    <span class="pap-comment-author">'+escapeHTML(c.userName)+'</span>';
    h += '    <span class="pap-comment-time">'+timeAgo(c.ts)+'</span>';
    if(canDelete){
      h += '    <button class="pap-comment-delete" data-id="'+c.id+'" title="'+_papSocT('commentDeleteTitle')+'">✕</button>';
    }
    h += '  </div>';
    h += '  <div class="pap-comment-text">'+escapeHTML(c.text).replace(/\n/g,'<br>')+'</div>';
    h += '  <div class="pap-comment-actions">';
    if(canReply){
      h += '<button class="pap-comment-reply-btn" data-id="'+c.id+'">'+_papSocT('reply')+'</button>';
    }
    h += '  </div>';
    h += '  <div class="pap-reply-form-slot" data-parent="'+c.id+'"></div>';
    h += '</div>';
    return h;
  }

  function renderCommentsBlock(container, targetType, targetId){
    var user = currentUser();

    container.innerHTML = '<div class="pap-social-section pap-comments-block">'+
      '<div class="pap-social-label">COMMENTS</div>'+
      '<div class="pap-comments-empty">'+_papSocT('commentsLoading')+'</div>'+
    '</div>';

    sbListComments(targetType, targetId).then(function(comments){
      // Separate top-level comments and replies
      var topLevel = [];
      var repliesByParent = {};
      comments.forEach(function(c){
        if(c.parentId){
          if(!repliesByParent[c.parentId]) repliesByParent[c.parentId] = [];
          repliesByParent[c.parentId].push(c);
        } else {
          topLevel.push(c);
        }
      });
      // Sort top-level desc (newest first), replies asc (oldest first)
      topLevel.sort(function(a,b){ return b.ts - a.ts; });

      var h = '<div class="pap-social-section pap-comments-block">';
      h += '<div class="pap-social-label">COMMENTS <span class="pap-comments-count">('+comments.length+')</span></div>';

      if(user){
        h += '<div class="pap-comment-form">';
        h += '  <div class="pap-comment-user">'+escapeHTML(user.name)+'</div>';
        h += '  <textarea class="pap-comment-input" placeholder="'+_papSocT('commentPh')+'" maxlength="1000"></textarea>';
        h += '  <button class="pap-comment-submit">'+_papSocT('submit')+'</button>';
        h += '</div>';
      } else {
        h += '<div class="pap-login-hint">'+_papSocT('loginToComment')+' · <a rel="nofollow" href="'+_loginUrl()+'">'+_papSocT('login')+'</a></div>';
      }

      h += '<div class="pap-comments-list">';
      if(topLevel.length===0){
        h += '<div class="pap-comments-empty">'+_papSocT('noComments')+'</div>';
      } else {
        topLevel.forEach(function(c){
          h += '<div class="pap-comment-thread">';
          h += _renderCommentItem(c, user, false);
          var replies = repliesByParent[c.id] || [];
          if(replies.length>0){
            h += '<div class="pap-replies-list">';
            replies.forEach(function(r){ h += _renderCommentItem(r, user, true); });
            h += '</div>';
          }
          h += '</div>';
        });
      }
      h += '</div></div>';

      container.innerHTML = h;

      // Top-level submit
      if(user){
        var submitBtn = container.querySelector('.pap-comment-form .pap-comment-submit');
        var input = container.querySelector('.pap-comment-form .pap-comment-input');
        submitBtn.addEventListener('click', function(){
          var txt = (input.value||'').trim();
          if(!txt) return;
          submitBtn.disabled = true;
          submitBtn.textContent = _papSocT('submitting');
          sbAddComment(targetType, targetId, txt, user, null).then(function(){
            input.value='';
            renderCommentsBlock(container, targetType, targetId);
          }).catch(function(err){
            console.error('[PAPSocial] comment submit failed:', err);
            alert(_papSocT('commentSubmitFail'));
            submitBtn.disabled = false;
            submitBtn.textContent = _papSocT('submit');
          });
        });
      }

      // Delete handlers
      container.querySelectorAll('.pap-comment-delete').forEach(function(btn){
        btn.addEventListener('click', function(){
          if(!confirm(_papSocT('commentDeleteConfirm'))) return;
          var u = currentUser();
          if(!u) return;
          btn.disabled = true;
          sbDeleteComment(btn.getAttribute('data-id'), u.id).then(function(){
            renderCommentsBlock(container, targetType, targetId);
          }).catch(function(err){
            console.error('[PAPSocial] delete failed:', err);
            alert(_papSocT('commentDeleteFail'));
            btn.disabled = false;
          });
        });
      });

      // Reply button handlers
      container.querySelectorAll('.pap-comment-reply-btn').forEach(function(btn){
        btn.addEventListener('click', function(){
          var parentId = btn.getAttribute('data-id');
          var slot = container.querySelector('.pap-reply-form-slot[data-parent="'+parentId+'"]');
          if(!slot) return;
          // Toggle: if already has form, remove it
          if(slot.querySelector('.pap-reply-form')){
            slot.innerHTML='';
            btn.textContent=_papSocT('reply');
            return;
          }
          // Close other open reply forms
          container.querySelectorAll('.pap-reply-form-slot').forEach(function(s){ s.innerHTML=''; });
          container.querySelectorAll('.pap-comment-reply-btn').forEach(function(b){ b.textContent=_papSocT('reply'); });
          btn.textContent=_papSocT('cancel');
          // Render reply form
          slot.innerHTML = '<div class="pap-reply-form">'+
            '<div class="pap-comment-user">'+escapeHTML(user.name)+'</div>'+
            '<textarea class="pap-comment-input pap-reply-input" placeholder="'+_papSocT('replyPh')+'" maxlength="1000"></textarea>'+
            '<button class="pap-comment-submit pap-reply-submit">'+_papSocT('replySubmit')+'</button>'+
          '</div>';
          var replyInput = slot.querySelector('.pap-reply-input');
          var replySubmit = slot.querySelector('.pap-reply-submit');
          replyInput.focus();
          replySubmit.addEventListener('click', function(){
            var txt = (replyInput.value||'').trim();
            if(!txt) return;
            replySubmit.disabled = true;
            replySubmit.textContent = _papSocT('submitting');
            sbAddComment(targetType, targetId, txt, user, parentId).then(function(){
              renderCommentsBlock(container, targetType, targetId);
            }).catch(function(err){
              console.error('[PAPSocial] reply submit failed:', err);
              alert(_papSocT('replySubmitFail'));
              replySubmit.disabled = false;
              replySubmit.textContent = _papSocT('replySubmit');
            });
          });
        });
      });
    }).catch(function(err){
      console.error('[PAPSocial] comments load failed:', err);
      container.innerHTML = '<div class="pap-social-section"><div class="pap-social-label">COMMENTS</div>'+
        '<div class="pap-login-hint">'+_papSocT('commentsLoadFail')+'</div></div>';
    });
  }

  // ======== EDITORIAL SOCIAL (rating + comments) ========
  function renderEditorialSocial(container, editorialTitle){
    if(!container) return;
    // 참여율 개선 (2026-07) — 별점은 본문 상단 CTA(renderEditorialRatingCta)로
    // 이전했다. 이 하단 슬롯은 이제 댓글만 렌더한다. 두 위젯이 같은 ratings
    // 테이블을 중복 표시하지 않도록 rating-slot 을 제거.
    container.innerHTML = '<div class="pap-social-wrap"><div id="pap-comments-slot"></div></div>';
    renderCommentsBlock(container.querySelector('#pap-comments-slot'), 'editorial', editorialTitle);
  }

  // ======== EDITORIAL RATING CTA (본문 상단, 참여율 개선 2026-07) ========
  // 하단 소셜 블록에서 분리한 별점 위젯. 데이터 계층(sbGetRatingStats /
  // sbGetMyRating / sbSetRating, editorial_title 기준)은 그대로 재사용한다.
  // - PAP 브랜드 레드(#891717) 별 5개 (스타일은 pap-social.css)
  // - "이 화보가 마음에 드셨나요?" + 평균 평점·참여 수
  // - 비로그인 상태에서 별 클릭 → 기존 로그인 흐름(_loginUrl, return 경로 포함)
  function renderEditorialRatingCta(container, editorialTitle){
    if(!container) return;
    var user = currentUser();

    // Skeleton (빈 별 + 문구) — 데이터 로딩 중 레이아웃 점프 방지.
    container.innerHTML = '<div class="pap-ed-rating-cta">'
      + '<div class="pap-ed-rating-cta-q">'+_papSocT('ratingCtaQ')+'</div>'
      + '<div class="pap-ed-rating-cta-stars">'+starHTML(0,false)+'</div>'
      + '<div class="pap-ed-rating-cta-meta">'+_papSocT('ratingLoading')+'</div>'
      + '</div>';

    Promise.all([
      sbGetRatingStats(editorialTitle),
      user ? sbGetMyRating(editorialTitle, user.id) : Promise.resolve(0)
    ]).then(function(results){
      var stats   = results[0];
      var myScore = results[1] || 0;
      // 내가 평가했으면 내 별점을, 아니면 평균을 별로 표시.
      var shownScore = myScore > 0 ? myScore : stats.avg;

      var meta;
      if(stats.count > 0){
        meta = _papSocT('ratingAvg') + ' ' + stats.avg.toFixed(1)
             + ' · ' + stats.count + _papSocT('ratingCountSuffix');
      } else {
        meta = _papSocT('ratingNone');
      }
      if(myScore > 0){
        meta += ' · <b>' + _papSocT('ratingMine') + ' ' + myScore + _papSocT('ratingScoreSuffix') + '</b>';
      }

      container.innerHTML = '<div class="pap-ed-rating-cta'+(myScore>0?' is-rated':'')+'">'
        + '<div class="pap-ed-rating-cta-q">'+_papSocT('ratingCtaQ')+'</div>'
        + '<div class="pap-ed-rating-cta-stars" data-editorial="'+escapeHTML(editorialTitle)+'">'+starHTML(shownScore,true)+'</div>'
        + '<div class="pap-ed-rating-cta-meta">'+meta+'</div>'
        + '</div>';

      var wrap = container.querySelector('.pap-ed-rating-cta-stars');
      if(!wrap) return;
      var stars = wrap.querySelectorAll('.pap-star');
      stars.forEach(function(st){
        st.addEventListener('mouseenter', function(){
          var s = parseInt(st.getAttribute('data-score'),10);
          stars.forEach(function(x,i){ x.classList.toggle('pap-star-hover', i<s); });
        });
        st.addEventListener('mouseleave', function(){
          stars.forEach(function(x){ x.classList.remove('pap-star-hover'); });
        });
        st.addEventListener('click', function(){
          var s = parseInt(st.getAttribute('data-score'),10);
          // 비로그인 → 로그인/가입으로 유도 (로그인 후 이 화보로 복귀).
          if(!user){ try{ location.href = _loginUrl(); }catch(e){} return; }
          wrap.style.pointerEvents = 'none';
          sbSetRating(editorialTitle, user.id, s).then(function(){
            renderEditorialRatingCta(container, editorialTitle);
          }).catch(function(err){
            console.error('[PAPSocial] rating save failed:', err);
            alert(_papSocT('ratingSaveFail'));
            wrap.style.pointerEvents = '';
          });
        });
      });
    }).catch(function(err){
      console.error('[PAPSocial] rating CTA load failed:', err);
      // 실패 시 CTA 를 조용히 숨김 — 본문 상단이라 깨진 위젯을 남기지 않는다.
      container.innerHTML = '';
    });
  }

  // ======== RELATED EDITORIALS (체류시간 개선 2026-07) ========
  // related_editorials(target_id uuid, match_count int) RPC 를 현재 화보 id 로
  // 호출해 임베딩 유사도 상위 4편을 렌더한다. 임베딩이 없는 화보는 RPC 가
  // 빈 결과를 주므로 그 경우 섹션 자체를 숨긴다.
  function renderRelatedEditorials(container, editorialId){
    if(!container) return;
    function hide(){ container.hidden = true; container.style.display = 'none'; container.innerHTML = ''; }
    var sb = initSupabase();
    if(!sb || !editorialId){ hide(); return; }

    sb.rpc('related_editorials', { target_id: editorialId, match_count: 4 })
      .then(function(res){
        if(res.error){ console.warn('[PAPSocial] related_editorials error:', res.error); hide(); return; }
        var rows = (res.data || []).filter(function(r){ return r && r.slug; });
        if(!rows.length){ hide(); return; }

        var cards = rows.map(function(r){
          var t     = escapeHTML(r.title || '');
          var cover = escapeHTML(r.cover_image || '');
          var slug  = escapeHTML(r.slug || '');
          // data-* 는 escapeHTML 로 인용부호가 인코딩돼 속성 안전. 클릭 시
          // getAttribute 로 원본을 복원해 _papOpenRelatedEd 에 넘긴다.
          return '<a class="pap-related-ed-card" href="'+window._papEdHref(r.slug)+'"'
            + ' data-paped="'+slug+'"'
            + ' data-title="'+t+'" data-cover="'+cover+'" data-slug="'+slug+'">'
            + '<div class="pap-related-ed-thumb"><img src="'+cover+'" alt="'+t+'" loading="lazy"></div>'
            + '<div class="pap-related-ed-title">'+t+'</div>'
            + '</a>';
        }).join('');

        container.innerHTML = '<div class="pap-related-ed-heading">'+_papSocT('relatedHeading')+'</div>'
          + '<div class="pap-related-ed-grid">'+cards+'</div>';
        container.hidden = false;
        container.style.display = '';

        // 썸네일 로드 처리 — 진짜 실패(naturalWidth 0)한 이미지만 숨기고,
        // lazy 로딩 중 일시적 error 로 숨겨졌던 이미지는 load 시 되살린다.
        // (인라인 onerror 로 opacity 를 끄면 정상 이미지가 영구히 숨는 버그가 있었음.)
        container.querySelectorAll('.pap-related-ed-thumb img').forEach(function(im){
          im.addEventListener('load', function(){ im.style.visibility=''; });
          im.addEventListener('error', function(){ if(!im.naturalWidth) im.style.visibility='hidden'; });
          if(im.complete){ im.style.visibility = im.naturalWidth ? '' : 'hidden'; }
        });

        // 클릭: 캐시(edDetails)에 있으면 SPA 인앱 오픈, 없으면 정식 경로 하드 이동.
        // 핸들러는 pap-content-editorial.js 가 window 에 정의(_papOpenRelatedEd).
        container.querySelectorAll('.pap-related-ed-card').forEach(function(a){
          a.addEventListener('click', function(ev){
            if(typeof global._papOpenRelatedEd === 'function'){
              return global._papOpenRelatedEd(ev,
                a.getAttribute('data-title') || '',
                a.getAttribute('data-cover') || '',
                a.getAttribute('data-slug') || '');
            }
            // 폴백: 앵커 기본 이동(/editorial/<slug>) 허용.
          });
        });
      })
      .catch(function(err){ console.warn('[PAPSocial] related_editorials failed:', err); hide(); });
  }

  // ======== ARTICLE SOCIAL (comments only) ========
  function renderArticleSocial(container, articleSlug, articleTitle){
    if(!container) return;
    container.innerHTML = '<div class="pap-social-wrap"><div id="pap-comments-slot"></div></div>';
    renderCommentsBlock(container.querySelector('#pap-comments-slot'), 'article', articleSlug || articleTitle);
  }

  // ======== CREATOR AVERAGE RATING ========
  // Returns Promise<{avg,count,editorials,ratedEditorials}>
  function getCreatorAvgRating(creatorHandle){
    if(typeof edDetails === 'undefined'){
      return Promise.resolve({avg:0,count:0,editorials:0,ratedEditorials:0});
    }
    var handle = (creatorHandle||'').toLowerCase();
    var creatorEditorials = [];
    // Coerce a credit/fashion entry into a lowercase handle string. Entries
    // can be plain strings ("@brand") or objects ({n:"Name", id:"@brand"}),
    // and an object with an empty .id used to fall through the old ternary
    // to the object itself — calling .toLowerCase() on the object then
    // threw TypeError, which propagated up through openCreatorPopup and
    // killed the credit-name click flow. Now we always return a string.
    function _entryHandle(h){
      if(h && typeof h === 'object'){
        return (typeof h.id === 'string' ? h.id : '').toLowerCase();
      }
      if(typeof h === 'string') return h.toLowerCase();
      return '';
    }
    for(var title in edDetails){
      var ed = edDetails[title];
      var found = false;
      (ed.credits||[]).forEach(function(cr){
        (cr.h||[]).forEach(function(h){ if(_entryHandle(h) === handle) found = true; });
      });
      (ed.fashion||[]).forEach(function(h){ if(_entryHandle(h) === handle) found = true; });
      if(found) creatorEditorials.push(title);
    }
    if(creatorEditorials.length===0){
      return Promise.resolve({avg:0,count:0,editorials:0,ratedEditorials:0});
    }

    return sbGetAllStats().then(function(allStats){
      var map = {};
      (allStats||[]).forEach(function(s){ map[s.editorial_title]=s; });
      var totalSum = 0, totalCount = 0, ratedEditorials = 0;
      creatorEditorials.forEach(function(t){
        var s = map[t];
        if(s && s.rating_count>0){
          totalSum += (parseFloat(s.avg_score)||0) * s.rating_count;
          totalCount += s.rating_count;
          ratedEditorials++;
        }
      });
      if(totalCount===0){
        return { avg:0, count:0, editorials:creatorEditorials.length, ratedEditorials:0 };
      }
      return {
        avg: +(totalSum/totalCount).toFixed(1),
        count: totalCount,
        editorials: creatorEditorials.length,
        ratedEditorials: ratedEditorials
      };
    });
  }

  // ======== EXPORT ========
  global.PAPSocial = {
    renderEditorialSocial: renderEditorialSocial,
    renderEditorialRatingCta: renderEditorialRatingCta,
    renderRelatedEditorials: renderRelatedEditorials,
    renderArticleSocial: renderArticleSocial,
    getCreatorAvgRating: getCreatorAvgRating,
    currentUser: currentUser,
    isLoggedIn: isLoggedIn,
    starHTML: starHTML,
    _init: initSupabase
  };

  // Auto-init when Supabase SDK is available
  if(typeof global.supabase !== 'undefined'){
    initSupabase();
  } else {
    // Wait for SDK to load
    var waitCount = 0;
    var waitInterval = setInterval(function(){
      if(typeof global.supabase !== 'undefined'){
        initSupabase();
        clearInterval(waitInterval);
      } else if(waitCount++ > 50){ // 5s timeout
        console.warn('[PAPSocial] Supabase SDK did not load within 5s');
        clearInterval(waitInterval);
      }
    }, 100);
  }

})(window);
