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
  var submitBtn = overlay.querySelector('.w-submit');
  if(submitBtn){
    submitBtn.setAttribute('data-edit-id', postId);
    submitBtn.textContent = L[lang].submitBtn || 'Update';
  }
};

// Override submitPost to handle edit mode
var _origSubmitPost = window.submitPost;
window.submitPost = function(){
  var overlay = document.getElementById('writeOverlay');
  var submitBtn = overlay ? overlay.querySelector('.w-submit') : null;
  var editId = submitBtn ? submitBtn.getAttribute('data-edit-id') : null;

  if(editId){
    // Edit mode
    if(!alertLogin()) return;
    var title = document.getElementById('postTitle').value.trim();
    var content = document.getElementById('postContent').innerHTML.trim();
    var catSel = document.getElementById('postCategory');
    var category = catSel ? catSel.value : 'free';
    if(!title || !content){ alert(lang==='ko'?'제목과 내용을 입력하세요':'Please enter title and content'); return; }

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
  var url = window.location.origin + '/community.html?post=' + postId;

  if(navigator.share){
    navigator.share({ title: 'PAP Magazine — ' + title, url: url }).catch(function(){});
  } else {
    // Fallback: copy to clipboard
    navigator.clipboard.writeText(url).then(function(){
      showToast(lang==='ko'?'링크가 복사되었습니다':'Link copied to clipboard');
    }).catch(function(){
      // Final fallback
      var inp = document.createElement('input');
      inp.value = url;
      document.body.appendChild(inp);
      inp.select();
      document.execCommand('copy');
      document.body.removeChild(inp);
      showToast(lang==='ko'?'링크가 복사되었습니다':'Link copied to clipboard');
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
        showToast(lang==='ko'?'신고가 접수되었습니다':'Report submitted successfully');
      } else {
        showToast(data.message || 'Error');
      }
    }).catch(function(){
      document.getElementById('reportModal').remove();
      showToast(lang==='ko'?'신고가 접수되었습니다':'Report submitted');
    });
  } else {
    document.getElementById('reportModal').remove();
    showToast(lang==='ko'?'신고가 접수되었습니다 (데모)':'Report submitted (demo)');
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
      html += '<button onclick="editPost(\''+id+'\')" style="color:#2563eb">✎ '+(lang==='ko'?'수정':'Edit')+'</button>';
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
      if(btn){ btn.textContent = lang==='ko'?'팔로우':'Follow'; btn.setAttribute('data-following','false'); btn.classList.remove('following'); }
    });
  } else {
    // Follow
    fetch('/api/community/follows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ targetId: targetId })
    }).then(function(r){ return r.json(); }).then(function(){
      if(btn){ btn.textContent = lang==='ko'?'팔로잉':'Following'; btn.setAttribute('data-following','true'); btn.classList.add('following'); }
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
  fetch('/api/community/notifications', { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var items = data.notifications || [];
      var html = '<div style="position:fixed;top:0;right:0;bottom:0;width:360px;max-width:100vw;background:#fff;z-index:10003;box-shadow:-4px 0 24px rgba(0,0,0,.15);overflow-y:auto;font-family:Montserrat,sans-serif" id="notifPanel">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px;border-bottom:1px solid #eee"><h3 style="margin:0;font-size:14px;font-weight:700;letter-spacing:.05em">'+(lang==='ko'?'알림':'NOTIFICATIONS')+'</h3><button onclick="document.getElementById(\'notifPanel\').remove();document.getElementById(\'notifOverlayBg\').remove()" style="background:none;border:none;font-size:20px;cursor:pointer">×</button></div>';

      if(items.length === 0){
        html += '<div style="padding:40px 20px;text-align:center;color:#999;font-size:12px">'+(lang==='ko'?'알림이 없습니다':'No notifications')+'</div>';
      } else {
        var typeIcons = { like:'❤️', comment:'💬', follow:'👤', project_apply:'📋', project_accepted:'✅', project_rejected:'❌', dm:'✉️', mention:'@' };
        var typeTexts = {
          ko: { like:'님이 좋아요를 눌렀습니다',comment:'님이 댓글을 남겼습니다',follow:'님이 팔로우하기 시작했습니다',project_apply:'님이 프로젝트에 지원했습니다',project_accepted:'프로젝트 지원이 수락되었습니다',project_rejected:'프로젝트 지원이 거절되었습니다',dm:'님이 메시지를 보냈습니다',mention:'님이 언급했습니다' },
          en: { like:'liked your post',comment:'commented on your post',follow:'started following you',project_apply:'applied to your project',project_accepted:'Your application was accepted',project_rejected:'Your application was rejected',dm:'sent you a message',mention:'mentioned you' }
        };
        var texts = typeTexts[lang] || typeTexts.en;

        items.forEach(function(n){
          var icon = typeIcons[n.type] || '🔔';
          var text = texts[n.type] || n.message || '';
          var actorName = n.actor ? n.actor.name : '';
          html += '<div style="padding:14px 20px;border-bottom:1px solid #f5f5f5;'+(n.read?'':'background:#fafafa')+';cursor:pointer" onclick="handleNotifClick(\''+n.type+'\',\''+n.targetType+'\',\''+n.targetId+'\')">';
          html += '<div style="display:flex;gap:10px;align-items:flex-start">';
          html += '<span style="font-size:16px">'+icon+'</span>';
          html += '<div style="flex:1"><div style="font-size:12px;line-height:1.5"><strong>'+escHtml(actorName)+'</strong> '+escHtml(text)+'</div>';
          html += '<div style="font-size:10px;color:#999;margin-top:4px">'+timeAgo(n.createdAt)+'</div></div></div></div>';
        });
      }
      html += '</div>';
      html += '<div id="notifOverlayBg" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:10002;background:rgba(0,0,0,.3)" onclick="document.getElementById(\'notifPanel\').remove();this.remove()"></div>';
      document.body.insertAdjacentHTML('beforeend', html);

      // Mark all as read
      fetch('/api/community/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ all: true })
      }).then(function(){ loadNotifications(); });
    });
};

window.handleNotifClick = function(type, targetType, targetId){
  var panel = document.getElementById('notifPanel');
  var bg = document.getElementById('notifOverlayBg');
  if(panel) panel.remove();
  if(bg) bg.remove();
  if(targetType === 'post') openPost(targetId);
  if(type === 'dm' || targetType === 'message') openDMPanel();
  if(type === 'follow') goTab('directory', document.querySelector('[onclick*="directory"]'));
};

// ── 2.3 DM (Direct Messages) ──
window.openDMPanel = function(){
  if(!alertLogin()) return;
  fetch('/api/community/messages?list=conversations', { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var convs = data.conversations || [];
      var html = '<div id="dmPanel" style="position:fixed;top:0;right:0;bottom:0;width:400px;max-width:100vw;background:#fff;z-index:10003;box-shadow:-4px 0 24px rgba(0,0,0,.15);display:flex;flex-direction:column;font-family:Montserrat,sans-serif">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px;border-bottom:1px solid #eee;flex-shrink:0"><h3 style="margin:0;font-size:14px;font-weight:700;letter-spacing:.05em">'+(lang==='ko'?'메시지':'MESSAGES')+'</h3><button onclick="document.getElementById(\'dmPanel\').remove();document.getElementById(\'dmOverlayBg\').remove()" style="background:none;border:none;font-size:20px;cursor:pointer">×</button></div>';
      html += '<div id="dmConvList" style="flex:1;overflow-y:auto">';

      if(convs.length === 0){
        html += '<div style="padding:40px 20px;text-align:center;color:#999;font-size:12px">'+(lang==='ko'?'메시지가 없습니다':'No messages yet')+'</div>';
      } else {
        convs.forEach(function(c){
          var other = c.otherUser || {};
          var av = (other.name||'??').split(' ').map(function(w){return w[0];}).join('').substring(0,2);
          var lastMsg = c.lastMessage ? c.lastMessage.content.substring(0,40) : '';
          var unread = c.unreadCount > 0 ? '<span style="background:#000;color:#fff;font-size:9px;padding:2px 6px;border-radius:10px;margin-left:auto">'+c.unreadCount+'</span>' : '';
          html += '<div style="padding:14px 20px;border-bottom:1px solid #f5f5f5;cursor:pointer;display:flex;gap:12px;align-items:center" onclick="openConversation(\''+c.id+'\',\''+escHtml(other.name||'User')+'\')">';
          html += '<div style="width:40px;height:40px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">'+av+'</div>';
          html += '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600">'+escHtml(other.name||'User')+'</div>';
          html += '<div style="font-size:11px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(lastMsg)+'</div></div>'+unread+'</div>';
        });
      }
      html += '</div></div>';
      html += '<div id="dmOverlayBg" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:10002;background:rgba(0,0,0,.3)" onclick="document.getElementById(\'dmPanel\').remove();this.remove()"></div>';
      document.body.insertAdjacentHTML('beforeend', html);
    }).catch(function(){ showToast('Failed to load messages'); });
};

window.openConversation = function(convId, otherName){
  var list = document.getElementById('dmConvList');
  if(!list) return;

  fetch('/api/community/messages?conversationId=' + convId, { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var msgs = data.messages || [];
      var html = '<div style="padding:12px 16px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:8px"><button onclick="openDMPanel()" style="background:none;border:none;font-size:16px;cursor:pointer">←</button><strong style="font-size:12px">'+escHtml(otherName)+'</strong></div>';
      html += '<div id="dmMsgList" style="flex:1;overflow-y:auto;padding:16px">';
      msgs.forEach(function(m){
        var align = m.isMine ? 'flex-end' : 'flex-start';
        var bg = m.isMine ? '#000' : '#f0f0f0';
        var color = m.isMine ? '#fff' : '#000';
        html += '<div style="display:flex;justify-content:'+align+';margin-bottom:8px"><div style="background:'+bg+';color:'+color+';padding:8px 14px;max-width:75%;font-size:12px;line-height:1.5;border-radius:12px">'+escHtml(m.content)+'</div></div>';
      });
      html += '</div>';
      html += '<div style="padding:12px;border-top:1px solid #eee;display:flex;gap:8px;flex-shrink:0"><input id="dmInput" style="flex:1;padding:8px 12px;border:1px solid #ddd;font-size:12px;font-family:Montserrat,sans-serif" placeholder="'+(lang==='ko'?'메시지 입력...':'Type a message...')+'" onkeypress="if(event.key===\'Enter\')sendDMFromInput(\''+convId+'\')"><button onclick="sendDMFromInput(\''+convId+'\')" style="padding:8px 16px;background:#000;color:#fff;border:none;font-size:11px;font-weight:700;cursor:pointer;font-family:Montserrat,sans-serif">'+(lang==='ko'?'전송':'SEND')+'</button></div>';

      var panel = document.getElementById('dmPanel');
      if(panel){
        // Replace content below header
        list.outerHTML = '<div id="dmConvList" style="flex:1;display:flex;flex-direction:column;overflow:hidden">'+html+'</div>';
        // Scroll to bottom
        setTimeout(function(){
          var ml = document.getElementById('dmMsgList');
          if(ml) ml.scrollTop = ml.scrollHeight;
        },50);
      }
    });
};

window.sendDMFromInput = function(convId){
  var input = document.getElementById('dmInput');
  if(!input || !input.value.trim()) return;
  var content = input.value.trim();
  input.value = '';

  // Add message to UI immediately
  var msgList = document.getElementById('dmMsgList');
  if(msgList){
    msgList.insertAdjacentHTML('beforeend', '<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><div style="background:#000;color:#fff;padding:8px 14px;max-width:75%;font-size:12px;line-height:1.5;border-radius:12px">'+escHtml(content)+'</div></div>');
    msgList.scrollTop = msgList.scrollHeight;
  }

  fetch('/api/community/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ recipientId: convId, content: content })
  }).catch(function(){});
};

window.sendDM = function(userId, userName){
  if(!alertLogin()) return;
  if(!userId && userName){
    // Demo mode or directory contact
    showToast((lang==='ko'?'메시지를 보내려면 로그인이 필요합니다':'Login required to send messages'));
    return;
  }
  openDMPanel();
};

// ── 2.4 ENHANCED PROFILE POPUP — with follow button and real badges ──
var _origOpenProfile = window.openProfile;
window.openProfile = function(name, e){
  _origOpenProfile(name, e);

  var popup = document.getElementById('profilePopupBg');
  if(!popup || !popup.classList.contains('active')) return;

  // Add follow + message buttons if not already present
  var btnContainer = document.getElementById('ppActionBtns');
  if(!btnContainer){
    var levelEl = document.getElementById('ppLevel');
    if(levelEl){
      var btns = document.createElement('div');
      btns.id = 'ppActionBtns';
      btns.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:center';
      btns.innerHTML = '<button onclick="followUser(null,\''+escHtml(name)+'\',this)" style="padding:8px 20px;font-size:10px;font-weight:700;letter-spacing:.1em;background:#000;color:#fff;border:1px solid #000;cursor:pointer;font-family:Montserrat,sans-serif">'+(lang==='ko'?'팔로우':'FOLLOW')+'</button><button onclick="sendDM(null,\''+escHtml(name)+'\')" style="padding:8px 20px;font-size:10px;font-weight:700;letter-spacing:.1em;background:transparent;color:#000;border:1px solid #000;cursor:pointer;font-family:Montserrat,sans-serif">'+(lang==='ko'?'메시지':'MESSAGE')+'</button>';
      levelEl.parentNode.insertBefore(btns, levelEl.nextSibling);
    }
  }
};


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
        showToast('🏆 ' + (lang==='ko'?'새 뱃지 획득: ':'New badge: ') + b);
      });
    }
  }).catch(function(){});
};

// ── 3.2 MOODBOARD — Inspiration Board tab ──
window.loadMoodboards = function(){
  fetch('/api/community/moodboards')
    .then(function(r){ return r.json(); })
    .then(function(data){
      var boards = data.boards || [];
      var container = document.getElementById('moodboardGrid');
      if(!container) return;
      if(boards.length === 0){
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;font-size:12px">'+(lang==='ko'?'아직 무드보드가 없습니다. 첫 번째 무드보드를 만들어보세요!':'No mood boards yet. Create the first one!')+'</div>';
        return;
      }
      var html = '';
      boards.forEach(function(b){
        html += '<div class="mood-card" style="cursor:pointer">';
        html += '<div class="mood-preview" style="display:grid;grid-template-columns:1fr 1fr;gap:2px;aspect-ratio:1;overflow:hidden">';
        (b.previewImages||[]).forEach(function(img){
          html += '<div style="background:url('+escHtml(img)+') center/cover;min-height:80px"></div>';
        });
        for(var i=(b.previewImages||[]).length; i<4; i++){
          html += '<div style="background:#f0f0f0;min-height:80px"></div>';
        }
        html += '</div>';
        html += '<div style="padding:12px"><div style="font-size:12px;font-weight:600">'+escHtml(b.title)+'</div>';
        html += '<div style="font-size:10px;color:#999;margin-top:4px">'+escHtml(b.author.name)+' · ❤️ '+b.voteCount+' · '+b.itemCount+' items</div>';
        if(b.tags && b.tags.length){
          html += '<div style="margin-top:6px">'+b.tags.map(function(t){return '<span style="font-size:9px;padding:2px 6px;background:#f5f5f5;margin-right:4px">'+escHtml(t)+'</span>';}).join('')+'</div>';
        }
        html += '</div></div>';
      });
      container.innerHTML = html;
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
function initV2(){
  // Periodically check notifications (every 60s)
  if(SB.user){
    loadNotifications();
    setInterval(loadNotifications, 60000);
    // Check badges on load
    setTimeout(checkBadges, 3000);
  }

  // Listen for auth changes
  document.addEventListener('pap-auth-changed', function(){
    if(SB.user){
      loadNotifications();
      checkBadges();
    }
  });
}

// Run after a short delay to ensure main script has initialized
setTimeout(initV2, 500);

})();
