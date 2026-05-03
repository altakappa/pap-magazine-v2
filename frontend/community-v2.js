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
        var typeIcons = { like:'❤️', comment:'💬', follow:'👤', project_apply:'📋', project_accepted:'✅', project_rejected:'❌', dm:'✉️', mention:'@' };
        var typeTexts = {
          ko: { like:'님이 좋아요를 눌렀습니다',comment:'님이 댓글을 남겼습니다',follow:'님이 팔로우하기 시작했습니다',project_apply:'님이 프로젝트에 지원했습니다',project_accepted:'프로젝트 지원이 수락되었습니다',project_rejected:'프로젝트 지원이 거절되었습니다',dm:'님이 메시지를 보냈습니다',mention:'님이 언급했습니다' },
          en: { like:'liked your post',comment:'commented on your post',follow:'started following you',project_apply:'applied to your project',project_accepted:'Your application was accepted',project_rejected:'Your application was rejected',dm:'sent you a message',mention:'mentioned you' }
        };
        var texts = typeTexts[lang] || typeTexts.en;
        var html = '';
        items.forEach(function(n){
          var icon = typeIcons[n.type] || '🔔';
          var text = texts[n.type] || n.message || '';
          var actorName = n.actor ? n.actor.name : '';
          var av = actorName ? actorName.split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase() : '?';
          html += '<div class="notif-item'+(n.read?'':' unread')+'" onclick="handleNotifClick(\''+n.type+'\',\''+(n.targetType||'')+'\',\''+(n.targetId||'')+'\')">';
          html += '<div class="notif-av">'+av+'</div>';
          html += '<div class="notif-body"><div class="notif-text"><strong>'+escHtml(actorName)+'</strong> '+escHtml(text)+'</div>';
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
  if(targetType === 'post') openPost(targetId);
  if(type === 'dm' || targetType === 'message') openDMPanel();
  if(type === 'follow') goTab('directory', document.querySelector('[onclick*="directory"]'));
};

// ── 2.3 DM (Direct Messages) ──
window.openDMPanel = function(){
  if(!alertLogin()) return;
  var panel = document.getElementById('dmPanel');
  var overlay = document.getElementById('dmOverlay');
  if(!panel) return;
  panel.classList.add('active');
  if(overlay) overlay.classList.add('active');
  // Show conv list, hide chat
  document.getElementById('dmConvList').style.display = '';
  document.getElementById('dmChat').style.display = 'none';

  fetch('/api/community/messages?list=conversations', { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var convs = data.conversations || [];
      var list = document.getElementById('dmConvList');
      if(!list) return;

      if(convs.length === 0){
        list.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text4);font-size:12px">'+(L[lang]&&L[lang].dmEmpty||'No conversations')+'</div>';
      } else {
        var html = '';
        convs.forEach(function(c){
          var other = c.otherUser || {};
          var av = (other.name||'??').split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase();
          var lastMsg = c.lastMessage ? c.lastMessage.content.substring(0,40) : '';
          var unread = c.unreadCount > 0 ? '<span class="dm-unread">'+c.unreadCount+'</span>' : '';
          html += '<div class="dm-conv-item" onclick="openConversation(\''+c.id+'\',\''+escHtml(other.name||'User')+'\')">';
          html += '<div class="dm-conv-av">'+av+'</div>';
          html += '<div class="dm-conv-info"><div class="dm-conv-name">'+escHtml(other.name||'User')+'</div>';
          html += '<div class="dm-conv-last">'+escHtml(lastMsg)+'</div></div>'+unread+'</div>';
        });
        list.innerHTML = html;
      }
    }).catch(function(){ showToast('Failed to load messages'); });
};

window.closeDMPanel = function(){
  var panel = document.getElementById('dmPanel');
  var overlay = document.getElementById('dmOverlay');
  if(panel) panel.classList.remove('active');
  if(overlay) overlay.classList.remove('active');
};

window.openConversation = function(convId, otherName){
  // Hide conv list, show chat
  document.getElementById('dmConvList').style.display = 'none';
  var chat = document.getElementById('dmChat');
  chat.style.display = 'flex';
  chat.dataset.convId = convId;

  var header = document.getElementById('dmChatHeader');
  header.innerHTML = '<button class="dm-back-btn" onclick="openDMPanel()">←</button><strong>'+escHtml(otherName)+'</strong>';

  var msgContainer = document.getElementById('dmMessages');
  msgContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text4);font-size:11px">Loading...</div>';

  fetch('/api/community/messages?conversationId=' + convId, { credentials: 'include' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var msgs = data.messages || [];
      var html = '';
      msgs.forEach(function(m){
        var cls = m.isMine ? 'dm-msg sent' : 'dm-msg received';
        html += '<div class="'+cls+'"><div class="dm-bubble">'+escHtml(m.content)+'</div></div>';
      });
      msgContainer.innerHTML = html || '<div style="text-align:center;padding:20px;color:var(--text4);font-size:11px">No messages yet</div>';
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }).catch(function(){ msgContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text4)">Error loading messages</div>'; });
};

window.sendDMFromInput = function(convIdArg){
  var input = document.getElementById('dmInput');
  if(!input || !input.value.trim()) return;
  var content = input.value.trim();
  input.value = '';
  var chat = document.getElementById('dmChat');
  var convId = convIdArg || (chat ? chat.dataset.convId : null);

  // Add message to UI immediately
  var msgList = document.getElementById('dmMessages');
  if(msgList){
    msgList.insertAdjacentHTML('beforeend', '<div class="dm-msg sent"><div class="dm-bubble">'+escHtml(content)+'</div></div>');
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
  var container = document.getElementById('moodGrid');
  if(!container) return;
  fetch('/api/community/moodboards')
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
  if(!alertLogin()) return;
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
  if(!title){ showToast(lang==='ko'?'제목을 입력하세요':'Enter a title'); return; }
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
  fetch('/api/community/moodboards?id=' + encodeURIComponent(boardId), { credentials:'include' })
    .then(function(r){ return r.json(); })
    .then(function(b){
      if(!b || !b.title){ showToast('Board not found'); return; }
      var ov = document.getElementById('moodDetailOverlay');
      if(!ov) return;
      var body = document.getElementById('moodDetailBody');
      var html = '';
      html += '<div class="md-head">';
      html += '<h2 class="md-title">'+escHtml(b.title)+'</h2>';
      html += '<div class="md-meta">'+escHtml(b.author && b.author.name || '')+' · '+(b.items?b.items.length:0)+' items · ♥ '+(b.voteCount||0)+'</div>';
      if(b.inspiredBy){
        html += '<div class="md-inspired" onclick="closeMoodDetail();openMoodboard(\''+b.inspiredBy.id+'\')" style="cursor:pointer">';
        html += '✨ '+(L[lang]&&L[lang].moodInspiredByLabel||'Inspired by')+' '+escHtml(b.inspiredBy.title)+(b.inspiredBy.authorName?(' — '+escHtml(b.inspiredBy.authorName)):'');
        html += '</div>';
      }
      if(b.description) html += '<p class="md-desc">'+escHtml(b.description)+'</p>';
      if(b.tags && b.tags.length){
        html += '<div class="md-tags">'+b.tags.map(function(t){return '<span class="mood-tag">'+escHtml(t)+'</span>';}).join('')+'</div>';
      }
      // Action buttons row (inspired-by chain, editorial bridge).
      // Pull-letter button is added by PR B (premium-only feature).
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
      body.innerHTML = html;
      ov.classList.add('active');
    }).catch(function(){ showToast('Failed to load board'); });
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

window.closeMoodDetail = function(){
  var ov = document.getElementById('moodDetailOverlay');
  if(ov) ov.classList.remove('active');
};

// ── Mission 5: Editorial bridge ─────────────────────────────────────────
// Sends the user to /submission.html with the moodboard ID prefilled.
// submission.html reads ?moodboard= and pulls the board's images/title to
// pre-fill the form so the member doesn't re-enter context they already
// captured in the moodboard.
window.bridgeToEditorial = function(boardId){
  if(!alertLogin()) return;
  window.location.href = '/submission.html?moodboard=' + encodeURIComponent(boardId);
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

window.openAddScrap = function(){
  if(typeof alertLogin === 'function' && !alertLogin()) return;
  var bg = document.getElementById('addScrapBg');
  if(!bg) return;
  document.getElementById('addScrapImage').value = '';
  document.getElementById('addScrapNote').value = '';
  document.getElementById('addScrapSource').value = '';
  bg.classList.add('active');
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
    showToast(lang==='ko'?'이미지 URL을 입력하세요':'Enter an image URL');
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
