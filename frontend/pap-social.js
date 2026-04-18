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
(function(global){
  'use strict';

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
      return 'auth.html?mode=login&return=' + encodeURIComponent(here);
    }catch(e){
      return 'auth.html?mode=login';
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
    if(diff < 60) return '방금 전';
    if(diff < 3600) return Math.floor(diff/60) + '분 전';
    if(diff < 86400) return Math.floor(diff/3600) + '시간 전';
    if(diff < 2592000) return Math.floor(diff/86400) + '일 전';
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

  function sbAddComment(targetType, targetId, text, user, parentId){
    var sb = initSupabase();
    if(!sb) return Promise.reject(new Error('Supabase not available'));
    var payload = {
      target_type: targetType,
      target_id: targetId,
      user_id: user.id,
      user_name: user.name,
      user_handle: user.handle||null,
      text: text
    };
    if(parentId) payload.parent_id = parentId;
    return sb.from('comments').insert([payload]).select().then(function(res){
      if(res.error) throw res.error;
      return res.data && res.data[0];
    });
  }

  function sbDeleteRating(editorialTitle, userId){
    var sb = initSupabase();
    if(!sb) return Promise.reject(new Error('Supabase not available'));
    return sb.from('ratings').delete()
      .eq('editorial_title', editorialTitle)
      .eq('user_id', userId)
      .then(function(res){ if(res.error) throw res.error; return true; });
  }

  function sbDeleteComment(commentId, userId){
    var sb = initSupabase();
    if(!sb) return Promise.reject(new Error('Supabase not available'));
    return sb.from('comments').delete().eq('id', commentId).eq('user_id', userId)
      .then(function(res){ if(res.error) throw res.error; return true; });
  }

  function sbSetRating(editorialTitle, userId, score){
    var sb = initSupabase();
    if(!sb) return Promise.reject(new Error('Supabase not available'));
    // UPSERT: insert or update on conflict (editorial_title, user_id)
    return sb.from('ratings').upsert([{
      editorial_title: editorialTitle,
      user_id: userId,
      score: score,
      updated_at: new Date().toISOString()
    }], { onConflict: 'editorial_title,user_id' })
    .then(function(res){ if(res.error) throw res.error; return true; });
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
      '<div class="pap-rating-me pap-login-hint">별점 불러오는 중...</div>'+
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
        h += '  <span class="pap-rating-me-label">나의 평점:</span>';
        h += '  <div class="pap-rating-stars pap-rating-input" data-editorial="'+escapeHTML(editorialTitle)+'">'+starHTML(myScore,true)+'</div>';
        h += '  <span class="pap-rating-my-score">'+(myScore>0?(myScore+'점'):'미평가')+'</span>';
        if(myScore>0){
          h += '  <button class="pap-rating-delete" title="별점 삭제">별점 취소</button>';
        }
        h += '</div>';
      } else {
        h += '<div class="pap-rating-me pap-login-hint">로그인하시면 별점을 남길 수 있습니다 · <a href="'+_loginUrl()+'">로그인</a></div>';
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
              alert('별점 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
              st.style.pointerEvents='';
            });
          });
        });
      }

      // Delete rating button
      var delBtn = container.querySelector('.pap-rating-delete');
      if(delBtn && user){
        delBtn.addEventListener('click', function(){
          if(!confirm('내 별점을 취소하시겠습니까?')) return;
          delBtn.disabled = true;
          sbDeleteRating(editorialTitle, user.id).then(function(){
            renderRatingBlock(container, editorialTitle);
          }).catch(function(err){
            console.error('[PAPSocial] rating delete failed:', err);
            alert('별점 취소에 실패했습니다.');
            delBtn.disabled = false;
          });
        });
      }
    }).catch(function(err){
      console.error('[PAPSocial] rating load failed:', err);
      container.innerHTML = '<div class="pap-social-section"><div class="pap-social-label">RATING</div>'+
        '<div class="pap-login-hint">별점을 불러오지 못했습니다. 페이지를 새로고침해 주세요.</div></div>';
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
      h += '    <button class="pap-comment-delete" data-id="'+c.id+'" title="삭제">✕</button>';
    }
    h += '  </div>';
    h += '  <div class="pap-comment-text">'+escapeHTML(c.text).replace(/\n/g,'<br>')+'</div>';
    h += '  <div class="pap-comment-actions">';
    if(canReply){
      h += '<button class="pap-comment-reply-btn" data-id="'+c.id+'">답글</button>';
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
      '<div class="pap-comments-empty">댓글 불러오는 중...</div>'+
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
        h += '  <textarea class="pap-comment-input" placeholder="댓글을 남겨주세요" maxlength="1000"></textarea>';
        h += '  <button class="pap-comment-submit">등록</button>';
        h += '</div>';
      } else {
        h += '<div class="pap-login-hint">댓글 작성은 로그인이 필요합니다 · <a href="'+_loginUrl()+'">로그인</a></div>';
      }

      h += '<div class="pap-comments-list">';
      if(topLevel.length===0){
        h += '<div class="pap-comments-empty">아직 댓글이 없습니다. 첫 댓글을 남겨주세요.</div>';
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
          submitBtn.textContent = '등록 중...';
          sbAddComment(targetType, targetId, txt, user, null).then(function(){
            input.value='';
            renderCommentsBlock(container, targetType, targetId);
          }).catch(function(err){
            console.error('[PAPSocial] comment submit failed:', err);
            alert('댓글 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.');
            submitBtn.disabled = false;
            submitBtn.textContent = '등록';
          });
        });
      }

      // Delete handlers
      container.querySelectorAll('.pap-comment-delete').forEach(function(btn){
        btn.addEventListener('click', function(){
          if(!confirm('이 댓글을 삭제하시겠습니까? 달린 답글도 함께 삭제됩니다.')) return;
          var u = currentUser();
          if(!u) return;
          btn.disabled = true;
          sbDeleteComment(btn.getAttribute('data-id'), u.id).then(function(){
            renderCommentsBlock(container, targetType, targetId);
          }).catch(function(err){
            console.error('[PAPSocial] delete failed:', err);
            alert('삭제에 실패했습니다.');
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
            btn.textContent='답글';
            return;
          }
          // Close other open reply forms
          container.querySelectorAll('.pap-reply-form-slot').forEach(function(s){ s.innerHTML=''; });
          container.querySelectorAll('.pap-comment-reply-btn').forEach(function(b){ b.textContent='답글'; });
          btn.textContent='취소';
          // Render reply form
          slot.innerHTML = '<div class="pap-reply-form">'+
            '<div class="pap-comment-user">'+escapeHTML(user.name)+'</div>'+
            '<textarea class="pap-comment-input pap-reply-input" placeholder="답글을 남겨주세요" maxlength="1000"></textarea>'+
            '<button class="pap-comment-submit pap-reply-submit">답글 등록</button>'+
          '</div>';
          var replyInput = slot.querySelector('.pap-reply-input');
          var replySubmit = slot.querySelector('.pap-reply-submit');
          replyInput.focus();
          replySubmit.addEventListener('click', function(){
            var txt = (replyInput.value||'').trim();
            if(!txt) return;
            replySubmit.disabled = true;
            replySubmit.textContent = '등록 중...';
            sbAddComment(targetType, targetId, txt, user, parentId).then(function(){
              renderCommentsBlock(container, targetType, targetId);
            }).catch(function(err){
              console.error('[PAPSocial] reply submit failed:', err);
              alert('답글 등록에 실패했습니다.');
              replySubmit.disabled = false;
              replySubmit.textContent = '답글 등록';
            });
          });
        });
      });
    }).catch(function(err){
      console.error('[PAPSocial] comments load failed:', err);
      container.innerHTML = '<div class="pap-social-section"><div class="pap-social-label">COMMENTS</div>'+
        '<div class="pap-login-hint">댓글을 불러오지 못했습니다.</div></div>';
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
  // Returns Promise<{avg,count,editorials,ratedEditorials}>
  function getCreatorAvgRating(creatorHandle){
    if(typeof edDetails === 'undefined'){
      return Promise.resolve({avg:0,count:0,editorials:0,ratedEditorials:0});
    }
    var handle = (creatorHandle||'').toLowerCase();
    var creatorEditorials = [];
    for(var title in edDetails){
      var ed = edDetails[title];
      var found = false;
      (ed.credits||[]).forEach(function(cr){
        (cr.h||[]).forEach(function(h){ var k=typeof h==='object'&&h.id?h.id:h; if((k||'').toLowerCase() === handle) found = true; });
      });
      (ed.fashion||[]).forEach(function(h){ var k=typeof h==='object'&&h.id?h.id:h; if((k||'').toLowerCase() === handle) found = true; });
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
