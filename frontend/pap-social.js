/**
 * PAP Social Module — Comments + Ratings
 * ---------------------------------------
 * Phase 1: localStorage-based (demo)
 * Phase 2: Replace storage adapter with Firebase calls
 *
 * Public API:
 *   PAPSocial.renderEditorialSocial(containerEl, editorialTitle)
 *   PAPSocial.renderArticleSocial(containerEl, articleSlug, articleTitle)
 *   PAPSocial.getCreatorAvgRating(creatorHandle) -> {avg:Number, count:Number}
 *   PAPSocial.currentUser() -> {id,name,handle} | null
 */
(function(global){
  'use strict';

  // ======== STORAGE ADAPTER (swap with Firebase later) ========
  var STORAGE = {
    KEY_COMMENTS: 'pap-comments-v1',
    KEY_RATINGS:  'pap-ratings-v1',
    _readAll: function(key){ try{ return JSON.parse(localStorage.getItem(key)||'[]'); }catch(e){ return []; } },
    _writeAll: function(key,arr){ try{ localStorage.setItem(key, JSON.stringify(arr)); }catch(e){} },
    listComments: function(targetType, targetId){
      var all = this._readAll(this.KEY_COMMENTS);
      return all.filter(function(c){ return c.targetType===targetType && c.targetId===targetId; })
                .sort(function(a,b){ return b.ts - a.ts; });
    },
    addComment: function(targetType, targetId, text, user){
      var all = this._readAll(this.KEY_COMMENTS);
      var c = {
        id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
        targetType: targetType,
        targetId: targetId,
        userId: user.id,
        userName: user.name,
        userHandle: user.handle||'',
        text: text,
        ts: Date.now()
      };
      all.push(c);
      this._writeAll(this.KEY_COMMENTS, all);
      return c;
    },
    deleteComment: function(commentId, userId){
      var all = this._readAll(this.KEY_COMMENTS);
      var filtered = all.filter(function(c){ return !(c.id===commentId && c.userId===userId); });
      if(filtered.length !== all.length){
        this._writeAll(this.KEY_COMMENTS, filtered);
        return true;
      }
      return false;
    },
    setRating: function(editorialTitle, userId, score){
      var all = this._readAll(this.KEY_RATINGS);
      var existing = all.find(function(r){ return r.editorialTitle===editorialTitle && r.userId===userId; });
      if(existing){
        existing.score = score;
        existing.ts = Date.now();
      } else {
        all.push({
          id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
          editorialTitle: editorialTitle,
          userId: userId,
          score: score,
          ts: Date.now()
        });
      }
      this._writeAll(this.KEY_RATINGS, all);
    },
    getRating: function(editorialTitle, userId){
      var all = this._readAll(this.KEY_RATINGS);
      var found = all.find(function(r){ return r.editorialTitle===editorialTitle && r.userId===userId; });
      return found ? found.score : 0;
    },
    getRatingStats: function(editorialTitle){
      var all = this._readAll(this.KEY_RATINGS);
      var matched = all.filter(function(r){ return r.editorialTitle===editorialTitle; });
      if(matched.length===0) return {avg:0,count:0};
      var sum = matched.reduce(function(a,r){ return a+r.score; }, 0);
      return { avg: +(sum/matched.length).toFixed(1), count: matched.length };
    },
    getAllRatings: function(){
      return this._readAll(this.KEY_RATINGS);
    }
  };

  // ======== CURRENT USER ========
  function currentUser(){
    try{
      var u = localStorage.getItem('pap-user');
      if(!u) return null;
      var parsed = JSON.parse(u);
      if(!parsed) return null;
      return {
        id: parsed.id || parsed.email || parsed.username || 'anon',
        name: parsed.name || parsed.username || (parsed.email||'').split('@')[0] || 'User',
        handle: parsed.handle || parsed.username || ''
      };
    }catch(e){ return null; }
  }

  function isLoggedIn(){ return !!currentUser(); }

  // ======== UTILITIES ========
  function escapeHTML(s){
    return String(s||'').replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function timeAgo(ts){
    var diff = (Date.now() - ts) / 1000;
    if(diff < 60) return '방금 전';
    if(diff < 3600) return Math.floor(diff/60) + '분 전';
    if(diff < 86400) return Math.floor(diff/3600) + '시간 전';
    if(diff < 2592000) return Math.floor(diff/86400) + '일 전';
    return new Date(ts).toISOString().slice(0,10);
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
    var stats = STORAGE.getRatingStats(editorialTitle);
    var myScore = user ? STORAGE.getRating(editorialTitle, user.id) : 0;

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
      h += '  <span class="pap-rating-me-label">나의 평점:</span>';
      h += '  <div class="pap-rating-stars pap-rating-input" data-editorial="'+escapeHTML(editorialTitle)+'">'+starHTML(myScore,true)+'</div>';
      h += '  <span class="pap-rating-my-score">'+(myScore>0?(myScore+'점'):'미평가')+'</span>';
      h += '</div>';
    } else {
      h += '<div class="pap-rating-me pap-login-hint">로그인하시면 별점을 남길 수 있습니다 · <a href="auth.html">로그인</a></div>';
    }
    h += '</div>';

    container.innerHTML = h;

    // Attach handlers
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
          STORAGE.setRating(editorialTitle, user.id, s);
          renderRatingBlock(container, editorialTitle);
        });
      });
    }
  }

  // ======== COMMENTS UI ========
  function renderCommentsBlock(container, targetType, targetId){
    var user = currentUser();
    var comments = STORAGE.listComments(targetType, targetId);

    var h = '<div class="pap-social-section pap-comments-block">';
    h += '<div class="pap-social-label">COMMENTS <span class="pap-comments-count">('+comments.length+')</span></div>';

    if(user){
      h += '<div class="pap-comment-form">';
      h += '  <div class="pap-comment-user">'+escapeHTML(user.name)+'</div>';
      h += '  <textarea class="pap-comment-input" placeholder="댓글을 남겨주세요" maxlength="1000"></textarea>';
      h += '  <button class="pap-comment-submit">등록</button>';
      h += '</div>';
    } else {
      h += '<div class="pap-login-hint">댓글 작성은 로그인이 필요합니다 · <a href="auth.html">로그인</a></div>';
    }

    h += '<div class="pap-comments-list">';
    if(comments.length===0){
      h += '<div class="pap-comments-empty">아직 댓글이 없습니다. 첫 댓글을 남겨주세요.</div>';
    } else {
      comments.forEach(function(c){
        var canDelete = user && user.id === c.userId;
        h += '<div class="pap-comment-item" data-comment-id="'+c.id+'">';
        h += '  <div class="pap-comment-head">';
        h += '    <span class="pap-comment-author">'+escapeHTML(c.userName)+'</span>';
        h += '    <span class="pap-comment-time">'+timeAgo(c.ts)+'</span>';
        if(canDelete){
          h += '    <button class="pap-comment-delete" data-id="'+c.id+'" title="삭제">✕</button>';
        }
        h += '  </div>';
        h += '  <div class="pap-comment-text">'+escapeHTML(c.text).replace(/\n/g,'<br>')+'</div>';
        h += '</div>';
      });
    }
    h += '</div></div>';

    container.innerHTML = h;

    // Submit handler
    if(user){
      var submitBtn = container.querySelector('.pap-comment-submit');
      var input = container.querySelector('.pap-comment-input');
      submitBtn.addEventListener('click', function(){
        var txt = (input.value||'').trim();
        if(!txt) return;
        STORAGE.addComment(targetType, targetId, txt, user);
        input.value='';
        renderCommentsBlock(container, targetType, targetId);
      });
    }

    // Delete handlers
    container.querySelectorAll('.pap-comment-delete').forEach(function(btn){
      btn.addEventListener('click', function(){
        if(!confirm('이 댓글을 삭제하시겠습니까?')) return;
        var u = currentUser();
        if(!u) return;
        STORAGE.deleteComment(btn.getAttribute('data-id'), u.id);
        renderCommentsBlock(container, targetType, targetId);
      });
    });
  }

  // ======== EDITORIAL SOCIAL (rating + comments) ========
  function renderEditorialSocial(container, editorialTitle){
    if(!container) return;
    container.innerHTML = '<div class="pap-social-wrap"><div id="pap-rating-slot"></div><div id="pap-comments-slot"></div></div>';
    renderRatingBlock(container.querySelector('#pap-rating-slot'), editorialTitle);
    renderCommentsBlock(container.querySelector('#pap-comments-slot'), 'editorial', editorialTitle);
  }

  // ======== ARTICLE SOCIAL (comments only) ========
  function renderArticleSocial(container, articleSlug, articleTitle){
    if(!container) return;
    container.innerHTML = '<div class="pap-social-wrap"><div id="pap-comments-slot"></div></div>';
    renderCommentsBlock(container.querySelector('#pap-comments-slot'), 'article', articleSlug || articleTitle);
  }

  // ======== CREATOR AVERAGE RATING ========
  // Given a creator's handle (e.g., "@photographer"), compute average rating
  // across all editorials where this creator is credited (credits.h or fashion).
  function getCreatorAvgRating(creatorHandle){
    if(typeof edDetails === 'undefined') return {avg:0, count:0};
    var handle = (creatorHandle||'').toLowerCase();
    // Find editorials where this creator appears
    var creatorEditorials = [];
    for(var title in edDetails){
      var ed = edDetails[title];
      var found = false;
      (ed.credits||[]).forEach(function(cr){
        (cr.h||[]).forEach(function(h){
          if(h.toLowerCase() === handle) found = true;
        });
      });
      (ed.fashion||[]).forEach(function(h){
        if(h.toLowerCase() === handle) found = true;
      });
      if(found) creatorEditorials.push(title);
    }

    if(creatorEditorials.length===0) return {avg:0, count:0, editorials:0};

    // Aggregate all ratings for those editorials
    var totalSum = 0;
    var totalCount = 0;
    var ratedEditorials = 0;
    creatorEditorials.forEach(function(t){
      var stats = STORAGE.getRatingStats(t);
      if(stats.count>0){
        totalSum += stats.avg * stats.count;
        totalCount += stats.count;
        ratedEditorials++;
      }
    });

    if(totalCount===0) return {avg:0, count:0, editorials:creatorEditorials.length, ratedEditorials:0};
    return {
      avg: +(totalSum/totalCount).toFixed(1),
      count: totalCount,
      editorials: creatorEditorials.length,
      ratedEditorials: ratedEditorials
    };
  }

  // ======== EXPORT ========
  global.PAPSocial = {
    renderEditorialSocial: renderEditorialSocial,
    renderArticleSocial: renderArticleSocial,
    getCreatorAvgRating: getCreatorAvgRating,
    currentUser: currentUser,
    isLoggedIn: isLoggedIn,
    starHTML: starHTML,
    _storage: STORAGE // for debugging
  };

})(window);
