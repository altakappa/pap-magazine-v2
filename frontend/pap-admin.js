// PAP Magazine — Admin harness (extracted from admin.html inline <script> per HARNESS_CHECKLIST.md mission 5)
//
// Owns: admin dashboard, member management, content CRUD (editorials/news/film/shorts),
//       submissions/pull-letters review, banner/interstitial/community management,
//       static page editing (about/business/contact), media upload helpers.
//
// Dependencies (must load BEFORE this file):
//   - pap-api.js       — exposes window.PAP namespace, used at boot for auth check
//                        (PAP.auth.isLoggedIn / PAP.auth.getUser)
//
// Public surface: top-level function declarations attach to window in classic-script
// context, so all functions referenced by inline onclick handlers (go, loadMembers,
// renderMembers, ...) are auto-exposed.
//
// localStorage keys read/written:
//   pap-token (read)        — JWT for API calls
//   pap_admin_<key> (R/W)   — admin-only settings without DB (theme, last view, etc.)

// ======== API HELPERS ========
var API_BASE=window.location.origin+'/api';
function getToken(){return localStorage.getItem('pap-token');}
function apiHeaders(){return {'Authorization':'Bearer '+getToken(),'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'};}
async function apiGet(path){var r=await fetch(API_BASE+path,{headers:apiHeaders()});return r.json();}
async function apiPost(path,body){var r=await fetch(API_BASE+path,{method:'POST',headers:apiHeaders(),body:JSON.stringify(body)});return r.json();}
async function apiPut(path,body){var r=await fetch(API_BASE+path,{method:'PUT',headers:apiHeaders(),body:JSON.stringify(body)});return r.json();}
async function apiDelete(path){var r=await fetch(API_BASE+path,{method:'DELETE',headers:apiHeaders()});return r.json();}
function esc(s){var d=document.createElement('div');d.textContent=s||'';return d.innerHTML;}
function fmtDate(d){if(!d)return'—';var dt=new Date(d);return dt.toLocaleDateString('ko-KR',{month:'long',day:'numeric'});}

// ======== IMAGE UPLOAD ========
async function uploadFile(file){
  var fd=new FormData();
  fd.append('file',file);
  var r=await fetch(API_BASE+'/media/upload',{
    method:'POST',
    headers:{'Authorization':'Bearer '+getToken(),'X-Requested-With':'XMLHttpRequest'},
    body:fd
  });
  var res;
  try { res = await r.json(); } catch(_){ res = {}; }
  if(res.data && res.data.length>0) return res.data[0].url;
  // QA #100 follow-up — surface the server's real reason. The server now
  // returns { error, detail, file? } when the upload fails (Supabase
  // Storage rejection, formidable parse error, etc.). Combining them
  // gives the admin something actionable instead of "Upload failed".
  var msg = res.error || ('HTTP '+r.status);
  if(res.detail) msg += ' — ' + res.detail;
  if(res.supabaseStatus || res.supabaseError){
    var supa = '';
    if(res.supabaseError)  supa += res.supabaseError;
    if(res.supabaseStatus) supa += (supa ? ' ' : '') + res.supabaseStatus;
    if(supa) msg += ' [Supabase: '+supa+']';
  }
  if(res.file) msg += ' ('+res.file+(res.fileSize ? ', '+(res.fileSize/1024).toFixed(0)+'KB' : '')+')';
  // Log full response for debugging (admin DevTools)
  console.error('[uploadFile] failed', r.status, res);
  throw new Error(msg);
}
async function uploadFiles(files){
  var urls=[];
  for(var i=0;i<files.length;i++){
    var url=await uploadFile(files[i]);
    urls.push(url);
  }
  return urls;
}

// ======== LOCAL STORAGE HELPERS (for settings without DB) ========
function lsGet(key,def){try{var v=localStorage.getItem('pap_admin_'+key);return v?JSON.parse(v):def;}catch(e){return def;}}
function lsSet(key,val){try{localStorage.setItem('pap_admin_'+key,JSON.stringify(val));}catch(e){}}

// Admin auth + role check
document.addEventListener('DOMContentLoaded',function(){
  var now=new Date();var dd=document.getElementById('dashDate');if(dd)dd.textContent=now.getFullYear()+'년 '+(now.getMonth()+1)+'월 '+now.getDate()+'일';
  if(typeof PAP!=='undefined'){
    if(!PAP.auth.isLoggedIn()){
      window.location.href='auth.html?redirect=admin';
      return;
    }
    var user=PAP.auth.getUser();
    // QA #169 — admin page is accessible to BOTH 대표 ('admin') and 스태프
    // ('staff'). The UI itself is gated per-action below.
    if(!user || (user.role!=='admin' && user.role!=='staff')){
      document.body.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Montserrat,sans-serif;color:#fff;background:#000;flex-direction:column"><h1 style="font-size:18px;letter-spacing:.15em">ACCESS DENIED</h1><p style="margin-top:12px;font-size:12px;color:rgba(255,255,255,.4)">Admin privileges required.</p><a href="index.html" style="margin-top:24px;color:#fff;font-size:11px;letter-spacing:.1em">← BACK TO MAGAZINE</a></div>';
      return;
    }
    // Expose role globally so per-button gates below don't have to fetch.
    window._papRole = user.role;
    window._papIsMainAdmin = (user.role === 'admin');
    _applyRoleVisibility(user.role);
  }
  // Auto-load dashboard stats
  loadDashboardStats();
});

// QA #169 — show/hide elements based on current admin role.
// CSS selectors used:
//   [data-role-main]  → visible to '대표' only (main admin, role='admin')
//   [data-role-any]   → visible to both '대표' and '스태프'
// Also populates the sidebar role badge. Called once on DOMContentLoaded
// and again whenever a modal that contains role-gated buttons opens (the
// review modal stays in the DOM but its buttons are toggled here).
function _applyRoleVisibility(role){
  var isMain = (role === 'admin');
  document.querySelectorAll('[data-role-main]').forEach(function(el){
    el.style.display = isMain ? '' : 'none';
  });
  // Staff-only notice block inside the review modal
  var notice = document.getElementById('reviewStaffNotice');
  if(notice) notice.style.display = isMain ? 'none' : '';
  // Sidebar role badge
  var badge = document.getElementById('sbRoleBadge');
  if(badge){
    if(isMain){
      badge.textContent = '대표 관리자';
      badge.style.color = '#fff';
      badge.style.borderColor = 'rgba(180,180,255,.4)';
    } else if(role === 'staff'){
      badge.textContent = '스태프';
      badge.style.color = 'rgba(255,180,80,.95)';
      badge.style.borderColor = 'rgba(255,180,80,.35)';
    }
    badge.style.display = 'block';
  }
}

// ======== MEMBER MANAGEMENT (Supabase) ========
var allMembers=[];
var memberFilter='all';
var _apiBase=(window.PAP_CONFIG&&window.PAP_CONFIG.API_BASE)||'/api';

async function loadMembers(){
  var tbody=document.getElementById('memberTableBody');
  tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text4);padding:40px">불러오는 중...</td></tr>';
  try{
    var resp=await fetch(_apiBase+'/admin/members',{
      headers:{'Authorization':'Bearer '+localStorage.getItem('pap-token'),'X-Requested-With':'XMLHttpRequest'}
    });
    var data=await resp.json();
    if(!resp.ok) throw new Error((data.detail||data.message||'API returned '+resp.status));
    allMembers=data.members||data||[];
    updateMemberStats();
    renderMembers();
  }catch(e){
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:#ff6b6b;padding:40px">⚠ 회원 데이터를 불러올 수 없습니다.<br><small style="color:var(--text4)">백엔드 API 연결을 확인하세요.</small></td></tr>';
  }
}

function updateMemberStats(){
  var total=allMembers.length;
  var free=allMembers.filter(m=>{var p=m.subscriptionPlan||m.subscription_plan||'free';return p==='free';}).length;
  var std=allMembers.filter(m=>{var p=m.subscriptionPlan||m.subscription_plan||'';return p.indexOf('standard')>-1;}).length;
  var prem=allMembers.filter(m=>{var p=m.subscriptionPlan||m.subscription_plan||'';return p.indexOf('premium')>-1;}).length;
  var susp=allMembers.filter(m=>{var s=m.subscriptionStatus||m.subscription_status||'';return s==='suspended';}).length;
  document.getElementById('statTotal').textContent=total;
  document.getElementById('statFree').textContent=free;
  document.getElementById('statStandard').textContent=std;
  document.getElementById('statPremium').textContent=prem;
  document.getElementById('statSuspended').textContent=susp;
}

function _getMemberPlan(m){return m.subscriptionPlan||m.subscription_plan||'free';}
function _getMemberStatus(m){return m.subscriptionStatus||m.subscription_status||'inactive';}
function _getMemberRole(m){return m.role||'member';}

function renderMembers(){
  var searchVal=(document.getElementById('memberSearch')?document.getElementById('memberSearch').value:'').toLowerCase().trim();
  var roleVal=document.getElementById('memberRoleFilter')?document.getElementById('memberRoleFilter').value:'all';
  var statusVal=document.getElementById('memberStatusFilter')?document.getElementById('memberStatusFilter').value:'all';

  var filtered=allMembers.filter(function(m){
    // Plan filter
    if(memberFilter!=='all'){
      var plan=_getMemberPlan(m);
      if(memberFilter==='free'&&plan!=='free') return false;
      if(memberFilter!=='free'&&plan.indexOf(memberFilter)===-1) return false;
    }
    // Role filter
    if(roleVal!=='all'&&_getMemberRole(m)!==roleVal) return false;
    // Status filter
    if(statusVal!=='all'&&_getMemberStatus(m)!==statusVal) return false;
    // Search filter
    if(searchVal){
      var hay=((m.name||'')+(m.email||'')+(m.instagram||'')).toLowerCase();
      if(hay.indexOf(searchVal)===-1) return false;
    }
    return true;
  });

  var tbody=document.getElementById('memberTableBody');
  if(!filtered.length){tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text4);padding:40px">회원이 없습니다</td></tr>';return;}
  var h='';
  var esc=function(s){var d=document.createElement('div');d.textContent=s||'';return d.innerHTML;};
  var roleLabels={admin:'관리자',contributor:'기여자',member:'회원'};
  var statusLabels={active:'활성',inactive:'비활성',suspended:'정지',cancelled:'취소'};
  // Joined-date formatter (shared by table / modal / CSV export).
  // mode = 'short' (table cell, compact)  → "26.05.02 19:23"
  //        'long'  (detail modal)         → "2026년 5월 2일 (토) 오후 7:23:45"
  //        'iso'   (CSV)                  → "2026-05-02 19:23:45" (KST, no Z)
  // Using the user's local timezone so the admin sees signup time in their
  // own clock — matches the way they'd remember when a member registered.
  if(typeof window._formatJoinedDateTime!=='function'){
    window._formatJoinedDateTime=function(raw,mode){
      if(!raw) return '—';
      var d=new Date(raw);
      if(isNaN(d.getTime())) return '—';
      var pad=function(n){return n<10?'0'+n:''+n;};
      if(mode==='iso'){
        return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+
               ' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
      }
      if(mode==='short'){
        // YY.MM.DD HH:mm — fits in narrow table column
        return String(d.getFullYear()).slice(-2)+'.'+pad(d.getMonth()+1)+'.'+pad(d.getDate())+
               ' '+pad(d.getHours())+':'+pad(d.getMinutes());
      }
      // long
      try{
        return d.toLocaleString('ko-KR',{
          year:'numeric',month:'long',day:'numeric',weekday:'short',
          hour:'2-digit',minute:'2-digit',second:'2-digit'
        });
      }catch(e){
        return d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일 '+
               pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
      }
    };
  }
  for(var i=0;i<filtered.length;i++){
    var m=filtered[i];
    var plan=_getMemberPlan(m);
    var status=_getMemberStatus(m);
    var role=_getMemberRole(m);
    var planCls=plan.indexOf('premium')>-1?'b-premium':plan.indexOf('standard')>-1?'b-standard':'b-free';
    var planLabel=plan.indexOf('premium')>-1?'Premium':plan.indexOf('standard')>-1?'Standard':'Free';
    var statusCls=status==='active'?'b-active':status==='suspended'?'b-suspended':'b-inactive';
    var statusLabel=statusLabels[status]||status;
    var roleLabel=roleLabels[role]||role;
    // Members table — show date + time so admins can audit signup activity
    // precisely. Uses Korean locale so 'AM/PM' renders as 오전/오후.
    var date=_formatJoinedDateTime(m.joinedAt||m.created_at,'short');
    var mid=m.id;
    h+='<tr>';
    h+='<td>'+esc(m.name)+'</td>';
    h+='<td style="font-size:11px">'+esc(m.email)+'</td>';
    h+='<td><span class="badge b-role-'+role+'">'+esc(roleLabel)+'</span></td>';
    h+='<td><span class="badge '+planCls+'">'+planLabel+'</span></td>';
    h+='<td><span class="badge '+statusCls+'">'+statusLabel+'</span></td>';
    h+='<td style="font-size:11px">'+date+'</td>';
    h+='<td><button class="btn btn-sm" onclick="openMemberModal(\''+mid+'\')">편집</button></td>';
    h+='</tr>';
  }
  tbody.innerHTML=h;
}

function filterMembers(plan,btn){
  memberFilter=plan;
  document.querySelectorAll('#t-users .tbl-top .tf').forEach(function(b){b.classList.remove('on');});
  if(btn) btn.classList.add('on');
  renderMembers();
}

function exportMembersCSV(){
  if(!allMembers.length){alert('내보낼 데이터가 없습니다.');return;}
  var rows=[['이름','이메일','역할','위치','구독플랜','구독상태','가입일']];
  allMembers.forEach(function(m){
    rows.push([m.name||'',m.email||'',_getMemberRole(m),m.location||'',_getMemberPlan(m),_getMemberStatus(m),_formatJoinedDateTime(m.joinedAt||m.created_at,'iso')]);
  });
  var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='pap_members_'+new Date().toISOString().split('T')[0]+'.csv';a.click();
}

/* ── Member Edit Modal ── */
function openMemberModal(memberId){
  var m=allMembers.find(function(x){return x.id===memberId;});
  if(!m){alert('회원 정보를 찾을 수 없습니다.');return;}
  document.getElementById('memberEditId').value=m.id;
  document.getElementById('memberEditName').textContent=m.name||'(이름 없음)';
  document.getElementById('memberEditEmail').textContent=m.email||'—';
  document.getElementById('memberEditInsta').textContent=m.instagram||'—';
  document.getElementById('memberEditLocation').textContent=m.location||'—';
  // Member detail modal — full date + time down to the second.
  document.getElementById('memberEditJoined').textContent=_formatJoinedDateTime(m.joinedAt||m.created_at,'long');
  document.getElementById('memberEditCounts').textContent='투고 '+(m.submissionCount||0)+'건 / Pull-Letter '+(m.pullletterCount||0)+'건';
  document.getElementById('memberEditRole').value=_getMemberRole(m);
  document.getElementById('memberEditPlan').value=_getMemberPlan(m);
  document.getElementById('memberEditStatus').value=_getMemberStatus(m);
  document.getElementById('memberModalTitle').textContent=(m.name||m.email)+' 회원 관리';
  // Hide suspend/delete for elevated roles (main admin OR staff)
  var memberRole = _getMemberRole(m);
  var isElevated = (memberRole === 'admin' || memberRole === 'staff');
  document.getElementById('memberSuspendBtn').style.display=isElevated?'none':'';
  document.getElementById('memberDeleteBtn').style.display=isElevated?'none':'';
  // QA #169 — role select is read-only for staff (only main admin can
  // promote/demote). Plan + status stay editable so staff can still
  // resolve billing issues.
  // QA #181 — additionally lock role select when editing ONESELF and
  // currently 'admin'. Otherwise the backend would 400 with a confusing
  // "본인 권한 변경 불가" message after the save round-trip. Locking up
  // front + showing an inline hint makes the constraint obvious BEFORE
  // the editor wastes time changing the dropdown.
  var roleSel = document.getElementById('memberEditRole');
  var roleLock = document.getElementById('memberEditRoleLock');
  var isMain = window._papIsMainAdmin === true;
  var meId = null;
  try{
    var me = (typeof PAP !== 'undefined' && PAP.auth && PAP.auth.getUser) ? PAP.auth.getUser() : null;
    meId = me && me.id ? String(me.id) : null;
  }catch(_){ meId = null; }
  var isSelf = !!(meId && String(m.id) === meId);
  var isSelfAdminLock = isSelf && memberRole === 'admin';
  if(roleSel) roleSel.disabled = !isMain || isSelfAdminLock;
  if(roleLock){
    if(!isMain){
      roleLock.textContent = '대표 관리자만 변경 가능';
      roleLock.style.display = '';
    }else if(isSelfAdminLock){
      roleLock.textContent = '본인 계정의 대표 관리자 권한은 직접 해제할 수 없습니다';
      roleLock.style.display = '';
    }else{
      roleLock.style.display = 'none';
    }
  }
  // Suspend/delete buttons disabled for staff (main-admin only on backend)
  if(!isMain){
    document.getElementById('memberSuspendBtn').style.display = 'none';
    document.getElementById('memberDeleteBtn').style.display  = 'none';
  }
  document.getElementById('memberModal').classList.add('show');
}

function closeMemberModal(){
  document.getElementById('memberModal').classList.remove('show');
}

async function saveMemberEdit(){
  var id=document.getElementById('memberEditId').value;
  var role=document.getElementById('memberEditRole').value;
  var plan=document.getElementById('memberEditPlan').value;
  var status=document.getElementById('memberEditStatus').value;
  if(!id) return;
  // QA #169 — only the main admin is allowed to send a role change. For
  // staff we omit the field entirely so the backend (which gates role
  // changes behind requireMainAdmin) never sees it.
  // QA #181 — also OMIT role from the body when the dropdown didn't
  // change. Sending an unchanged role still triggers the backend's
  // self-demotion guard if the editor happens to be editing themselves,
  // which is needless friction when they only wanted to tweak plan /
  // status. Compare against the currently-loaded value on allMembers.
  var origMember = allMembers.find(function(x){return x.id===id;});
  var origRole = origMember ? _getMemberRole(origMember) : null;
  var body = { memberId: id, subscriptionPlan: plan, subscriptionStatus: status };
  if (window._papIsMainAdmin === true && role && role !== origRole) {
    body.role = role;
  }
  try{
    var resp=await fetch(_apiBase+'/admin/member-update',{
      method:'PATCH',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('pap-token'),'X-Requested-With':'XMLHttpRequest'},
      body:JSON.stringify(body)
    });
    var data=await resp.json();
    if(!resp.ok) throw new Error(data.message||'Update failed');
    // Update local data
    var m=allMembers.find(function(x){return x.id===id;});
    if(m){m.role=role;m.subscriptionPlan=plan;m.subscription_plan=plan;m.subscriptionStatus=status;m.subscription_status=status;}
    updateMemberStats();
    renderMembers();
    closeMemberModal();
    alert('회원 정보가 업데이트되었습니다.');
  }catch(e){
    alert('오류: '+(e.message||'회원 정보 업데이트 실패'));
  }
}

async function suspendMemberFromModal(){
  var id=document.getElementById('memberEditId').value;
  var name=document.getElementById('memberEditName').textContent;
  if(!id) return;
  if(!confirm(name+' 회원을 정지하시겠습니까?\n정지된 회원은 서비스 이용이 제한됩니다.')) return;
  try{
    var resp=await fetch(_apiBase+'/admin/member-delete',{
      method:'DELETE',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('pap-token'),'X-Requested-With':'XMLHttpRequest'},
      body:JSON.stringify({memberId:id,action:'suspend'})
    });
    var data=await resp.json();
    if(!resp.ok) throw new Error(data.message||'Suspend failed');
    var m=allMembers.find(function(x){return x.id===id;});
    if(m){m.subscriptionStatus='suspended';m.subscription_status='suspended';}
    updateMemberStats();
    renderMembers();
    closeMemberModal();
    alert(name+' 회원이 정지되었습니다.');
  }catch(e){
    alert('오류: '+(e.message||'회원 정지 실패'));
  }
}

async function deleteMemberFromModal(){
  var id=document.getElementById('memberEditId').value;
  var name=document.getElementById('memberEditName').textContent;
  if(!id) return;
  if(!confirm('⚠ '+name+' 회원을 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
  if(!confirm('정말로 삭제하시겠습니까? 모든 데이터가 영구적으로 삭제됩니다.')) return;
  try{
    var resp=await fetch(_apiBase+'/admin/member-delete',{
      method:'DELETE',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('pap-token'),'X-Requested-With':'XMLHttpRequest'},
      body:JSON.stringify({memberId:id,action:'delete'})
    });
    var data=await resp.json();
    if(!resp.ok) throw new Error(data.message||'Delete failed');
    allMembers=allMembers.filter(function(x){return x.id!==id;});
    updateMemberStats();
    renderMembers();
    closeMemberModal();
    alert(name+' 회원이 삭제되었습니다.');
  }catch(e){
    alert('오류: '+(e.message||'회원 삭제 실패'));
  }
}

// Auto-load members when users tab is shown
function go(id,el,opts){
  opts = opts || {};
  // QA — sidebar links are `<a href="#" onclick="go(...)">`, which
  // means the browser's default action follows href="#" AFTER our
  // onclick runs, wiping `#admin/<id>` back to plain `#` and firing
  // a popstate that bounced us to home. Cancel that default by
  // pulling the live event off `window.event` (available inside
  // inline onclick handlers in every shipping browser) so the URL
  // we just pushed is what the address bar actually keeps.
  try {
    var _ev = (typeof window !== 'undefined' && window.event) ? window.event : null;
    if(_ev && _ev.preventDefault) _ev.preventDefault();
  } catch(_){}
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  var tab=document.getElementById('t-'+id);
  if(tab)tab.classList.add('on');
  document.querySelectorAll('.sb a').forEach(a=>a.classList.remove('on'));
  // QA — when entering via URL-hash (refresh / back-forward) the
  // caller can't pass `el`. Fall back to the matching sidebar anchor
  // so the highlighted item still tracks the visible section.
  if(el) {
    el.classList.add('on');
  } else {
    var sbLink = document.querySelector('.sb a[onclick*="go(\''+id+'\'"]');
    if(sbLink) sbLink.classList.add('on');
  }
  // Update the URL PATH so the current section survives a refresh,
  // accumulates real history entries, and is reachable via back /
  // forward. Skip when triggered FROM a popstate / initFromPath so
  // we don't double-push. Path-based routing requires a Vercel
  // rewrite (`/admin/:path*` → `/admin.html`) which is wired in
  // vercel.json — without it, refreshing /admin/editorials would
  // 404. Old `#admin/<id>` hash URLs are still recognised by the
  // init reader for backwards compat with anything bookmarked.
  if(!opts.skipHistory){
    var newPath = '/admin/' + id;
    if(window.location.pathname !== newPath){
      try { history.pushState({admin:id}, '', newPath); } catch(_){}
      // Defensive re-assert: if any default link action sneaks in
      // after our handler returns and rewrites the URL, put it
      // back without spawning an extra history entry.
      setTimeout(function(){
        if(window.location.pathname !== newPath){
          try { history.replaceState({admin:id}, '', newPath); } catch(_){}
        }
      }, 0);
    }
  }
  // Auto-load data when switching tabs
  if(id==='users'&&!allMembers.length) loadMembers();
  if(id==='editorials'&&!editorials.length) loadEditorials();
  if(id==='news') loadNews();
  if(id==='film') loadFilmsFromAPI();
  if(id==='submissions') loadSubmissions();
  if(id==='pullletters') loadPullLetters();
  if(id==='newpost'){
    // QA report: 새 게시글 작성 페이지에서 뒤로가기 후 다시 클릭 시
    // 이전 데이터가 남아있는 문제. Always reset on entry UNLESS the
    // caller is `editEditorial(...)` which sets editingEditorialId
    // synchronously BEFORE calling go('newpost'). Without that
    // sentinel, every navigation to the form (including back/forward
    // and re-clicking "+ 새 에디토리얼") starts in a guaranteed-empty
    // state — a same-route re-entry behaves like a fresh mount.
    if(!editingEditorialId){
      _resetNewPostForm();
    }
  } else if(id !== 'newpost' && editingEditorialId){
    // Leaving the new-post route while still in an edit session?
    // Drop the sentinel so the next "+ 새 에디토리얼" click triggers
    // the reset above instead of inheriting stale edit state.
    editingEditorialId = null;
  }
}

// QA — URL-PATH routing for the admin SPA so each section has its
// own bookmarkable / refreshable / back-button-friendly URL.
//   /admin/editorials  → 에디토리얼 목록
//   /admin/users       → 회원 관리
//   /admin/newpost     → 새 게시글
// Refreshing any of those works because vercel.json rewrites every
// `/admin/*` path back to `/admin.html`. Anything outside the
// DOM-derived whitelist is ignored (defends against URL injection —
// only a-z / 0-9 / _ are accepted in the section id).
//
// The whitelist is BUILT FROM THE DOM — every `<div class="tab" id="t-X">`
// becomes a valid tab id `X`. Earlier versions hardcoded the list and
// went stale every time a new section was added.
function _getValidAdminTabs(){
  var ids = [];
  document.querySelectorAll('.tab[id^="t-"]').forEach(function(el){
    var id = el.id.slice(2); // strip "t-"
    if(id) ids.push(id);
  });
  return ids;
}
// Extract the section id from either format we accept:
//   • Path-based (current): /admin/editorials → "editorials"
//   • Hash-based (legacy):  /admin#admin/editorials → "editorials"
// Returns '' when neither matches so callers can decide how to fall
// back (init: no-op, popstate: ignore).
function _extractAdminSectionId(){
  // 1. Path form — strip "/admin/" prefix, take the first segment.
  var p = window.location.pathname || '';
  if(p.indexOf('/admin/') === 0){
    var rest = p.slice('/admin/'.length);
    var seg  = rest.split('/')[0] || '';
    seg = seg.replace(/[^a-z0-9_]/gi, '');
    if(seg) return seg;
  }
  // 2. Hash form — keeps old bookmarks working.
  var h = window.location.hash || '';
  if(h.indexOf('#admin/') === 0){
    var hid = h.slice('#admin/'.length).replace(/[^a-z0-9_]/gi, '');
    if(hid) return hid;
  }
  return '';
}
function _initAdminFromHash(){
  // Function name kept for back-compat with anything that may have
  // grabbed a reference to it; reads from path now (with hash
  // fallback) via _extractAdminSectionId.
  var id = _extractAdminSectionId();
  if(!id) return false;
  var valid = _getValidAdminTabs();
  if(valid.indexOf(id) < 0) return false;
  // skipHistory: caller already has the right URL; pushing again
  // would create a duplicate history entry.
  go(id, null, {skipHistory: true});
  return true;
}
window.addEventListener('popstate', function(){
  // Back / forward — only react when the new URL names a valid
  // admin section. If the URL is outside the admin namespace we
  // leave the visible tab alone. Earlier versions force-redirected
  // to 'home' here, which combined with the sidebar's `href="#"`
  // default action made every click bounce back to the home tab
  // right after rendering the requested one.
  var id = _extractAdminSectionId();
  if(id){
    _initAdminFromHash();
  }
});
// Run after the page's existing init has wired everything up so the
// sidebar links and tab elements are guaranteed to exist.
document.addEventListener('DOMContentLoaded', function(){
  // setTimeout 0 lets any other DOMContentLoaded handler (auth check,
  // sidebar build, etc.) finish first; otherwise sidebar links may
  // not be in the DOM yet when we try to highlight them.
  setTimeout(function(){ _initAdminFromHash(); }, 0);
});

function _resetNewPostForm(){
  // 1. Plain text / textarea inputs (QA #170 — include postIgCaption so
  // a leftover caption from the prior edit doesn't carry into a fresh
  // "+ 새 에디토리얼" session).
  ['postTitle','postSubtitle','postSlug','postTags','postVideoUrl','postDescription','postIgCaption'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.value = '';
  });
  var tp = document.getElementById('tagPreview');
  if(tp) tp.innerHTML = '';

  // 2. Thumbnail preview + file input
  var thumbPrev = document.getElementById('thumbPreview');
  if(thumbPrev){
    thumbPrev.innerHTML = '<div class="pe-upload-icon">📷</div>'
      + '<div class="pe-upload-text">클릭하여 이미지를 업로드하세요</div>'
      + '<div class="pe-upload-hint">JPG, PNG · 권장 1080×1350px</div>';
  }
  var thumbInput = document.getElementById('thumbInput');
  if(thumbInput) thumbInput.value = '';
  var thumbBox = document.getElementById('thumbUploadBox');
  if(thumbBox){
    thumbBox.classList.remove('has-thumb');
    thumbBox.dataset.existingUrl = '';
    thumbBox.removeAttribute('data-thumb-cleared');
  }

  // 3. Gallery — both the in-memory state and every rendered card
  if(typeof galleryImages !== 'undefined') galleryImages = [];
  if(typeof galleryCount  !== 'undefined') galleryCount  = 0;
  if(typeof galleryThumbNum !== 'undefined') galleryThumbNum = null;
  if(typeof galleryCoverNum !== 'undefined') galleryCoverNum = null;
  var grid = document.getElementById('galleryGrid');
  if(grid){
    grid.querySelectorAll('.pe-gallery-item').forEach(function(el){ el.remove(); });
  }
  var galFb = document.getElementById('galleryUploadFeedback');
  if(galFb) galFb.textContent = '';

  // 4. Credits — clear every row, then add one empty row + sync toolbar
  var creditsArea = document.getElementById('creditsArea');
  if(creditsArea){
    creditsArea.innerHTML = '';
    if(typeof addCredit === 'function') addCredit();
  }
  if(typeof _onCreditCheckChange === 'function') _onCreditCheckChange();

  // 5. Brands
  var brandsArea = document.getElementById('brandsArea');
  if(brandsArea) brandsArea.innerHTML = '';

  // 6. Per-image credits placeholder
  var imgCreditsArea = document.getElementById('imgCreditsArea');
  if(imgCreditsArea){
    imgCreditsArea.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:8px 0">위에서 화보 이미지를 추가하면 각 이미지마다 착장 크레딧을 입력할 수 있습니다.</div>';
  }

  // 7. Publish / schedule controls back to defaults
  var pub = document.getElementById('postPublish');
  if(pub) pub.checked = true;       // default: published
  var sched = document.getElementById('postSchedule');
  if(sched) sched.checked = false;
  var schedDate = document.getElementById('scheduleDate');
  if(schedDate) schedDate.value = '';
  var schedTime = document.getElementById('scheduleTime');
  if(schedTime) schedTime.value = '';
  var schedArea = document.getElementById('scheduleArea');
  if(schedArea) schedArea.style.display = 'none';
  // 7b. Manual publish-date picker — empty means "use 저장 시점"
  var pubDateE = document.getElementById('publishDate');
  if(pubDateE) pubDateE.value = '';
  var pubTimeE = document.getElementById('publishTime');
  if(pubTimeE) pubTimeE.value = '';

  // 8. Category select back to 'editorial'
  var catSelect = document.getElementById('postCategory');
  if(catSelect) catSelect.value = 'editorial';

  // 9. Validation summary / success panels from the previous save
  if(typeof _peClearAllErrors === 'function') _peClearAllErrors();
}
// Review submission tracking
var currentReviewSubmission=null;
var selectedCoverImageIndex=0;

function openModal(submissionId){
  if(submissionId){
    currentReviewSubmission={id:submissionId};
    selectedCoverImageIndex=0;
    // Populate modal with actual submission data if available
    loadSubmissionForReview(submissionId);
  }
  document.getElementById('reviewModal').classList.add('show');
}

function closeModal(){
  document.getElementById('reviewModal').classList.remove('show');
  currentReviewSubmission=null;
  selectedCoverImageIndex=0;
  // Reset translate state
  _reviewNoteOriginal=null;
  var rb=document.getElementById('reviewRestoreBtn');
  if(rb)rb.style.display='none';
  var tb=document.getElementById('reviewTranslateBtn');
  if(tb){tb.disabled=false;tb.textContent='영어로 변환';}
  // Reset download button label in case the user left mid-progress
  var db=document.getElementById('reviewDownloadBtn');
  if(db){db.disabled=false;db.textContent='⬇ 이미지 일괄 다운로드 (ZIP)';}
}

// ======== BULK IMAGE DOWNLOAD ========
// One-click ZIP export of the submission's gallery so the editor can
// drop the same shoot into both the website (via the staged editorial)
// AND Instagram without re-fetching every asset by hand. Architecture:
//
//   1) file_urls on submissions point at Supabase Storage CDN (public).
//      We fetch each one in the browser — Vercel is never in the data
//      path, so the 4.5MB response-size limit doesn't apply.
//   2) Originals go into originals/ inside the ZIP, named 01_xxx.ext
//      so the IG carousel order matches the editorial sequence. The
//      cover image is force-renamed to 00_cover.ext so the editor knows
//      which to pin as the first slide.
//   3) When "인스타용 1080² 정사각 포함" is checked, each image is also
//      run through a Canvas centre-crop pipeline → 1080×1080 JPEG @0.92,
//      stored under instagram/ with the same numeric prefix.
//   4) JSZip generates the archive in-memory; an anchor click triggers
//      the browser save dialog.
//
// All async work is awaited sequentially with a progress label on the
// button so the editor knows the (potentially long) operation is alive.
async function downloadSubmissionImages(){
  var sub = currentReviewSubmission;
  if(!sub || !Array.isArray(sub.file_urls) || !sub.file_urls.length){
    alert('다운로드할 이미지가 없습니다.');
    return;
  }
  if(typeof JSZip === 'undefined'){
    alert('ZIP 라이브러리가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  var btn = document.getElementById('reviewDownloadBtn');
  var includeIG = !!(document.getElementById('reviewDownloadIG') || {}).checked;
  var coverIdx = (typeof selectedCoverImageIndex === 'number' && selectedCoverImageIndex >= 0) ? selectedCoverImageIndex : 0;
  var origLabel = btn ? btn.textContent : '';
  if(btn){ btn.disabled=true; btn.textContent='준비 중…'; }

  try{
    var zip = new JSZip();
    var origFolder = zip.folder('originals');
    var igFolder = includeIG ? zip.folder('instagram') : null;
    var total = sub.file_urls.length;
    var safeTitle = String(sub.title || 'submission').replace(/[^\w가-힣\-]+/g,'_').slice(0,60) || 'submission';

    for(var i=0; i<total; i++){
      var url = sub.file_urls[i];
      if(btn){ btn.textContent = '이미지 받는 중 ('+(i+1)+'/'+total+')…'; }
      var seq = (i===coverIdx ? '00_cover' : String(i+1).padStart(2,'0'));
      try{
        var blob = await _fetchAsBlob(url);
        var ext = _extFromUrlOrType(url, blob.type) || 'jpg';
        origFolder.file(seq + '.' + ext, blob);
        if(igFolder){
          var igBlob = await _cropToSquareBlob(blob, 1080);
          if(igBlob) igFolder.file(seq + '_1080.jpg', igBlob);
        }
      }catch(err){
        console.warn('Image ['+i+'] download failed:', url, err);
        // Don't abort the whole ZIP for one bad asset — drop a marker
        // file so the editor knows which slot was skipped.
        origFolder.file(seq + '.FAILED.txt', 'Could not fetch: ' + url + '\n' + (err && err.message || err));
      }
    }

    if(btn) btn.textContent='ZIP 생성 중…';
    var content = await zip.generateAsync({ type:'blob', compression:'STORE' }); // images are already compressed; STORE saves CPU
    var dlUrl = URL.createObjectURL(content);
    var a = document.createElement('a');
    a.href = dlUrl;
    a.download = safeTitle + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(dlUrl); }, 4000);
  }catch(err){
    console.error('Bulk download error:', err);
    alert('다운로드 중 오류가 발생했습니다: ' + (err && err.message || err));
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=origLabel || '⬇ 이미지 일괄 다운로드 (ZIP)'; }
  }
}

// Fetch a Storage CDN URL as a Blob. We use fetch + .blob() because it
// preserves the original MIME (important when the URL omits an extension
// — Supabase sometimes does this for uploads).
async function _fetchAsBlob(url){
  var resp = await fetch(url, { mode:'cors', credentials:'omit' });
  if(!resp.ok) throw new Error('HTTP '+resp.status);
  return await resp.blob();
}

// Centre-crop a Blob (any orientation) to a square JPEG of the given
// side length. Uses an offscreen canvas; returns null on decode failure.
function _cropToSquareBlob(blob, side){
  return new Promise(function(resolve){
    var img = new Image();
    var objUrl = URL.createObjectURL(blob);
    img.onload = function(){
      try{
        var sw = img.naturalWidth, sh = img.naturalHeight;
        var s = Math.min(sw, sh);
        var sx = (sw - s) / 2, sy = (sh - s) / 2;
        var cv = document.createElement('canvas');
        cv.width = side; cv.height = side;
        var ctx = cv.getContext('2d');
        // Black backdrop for any edge-case transparent PNGs
        ctx.fillStyle = '#000';
        ctx.fillRect(0,0,side,side);
        ctx.drawImage(img, sx, sy, s, s, 0, 0, side, side);
        cv.toBlob(function(out){
          URL.revokeObjectURL(objUrl);
          resolve(out);
        }, 'image/jpeg', 0.92);
      }catch(e){
        URL.revokeObjectURL(objUrl);
        console.warn('crop failed', e);
        resolve(null);
      }
    };
    img.onerror = function(){
      URL.revokeObjectURL(objUrl);
      resolve(null);
    };
    img.src = objUrl;
  });
}

// Pull a sensible filename extension from the URL or MIME. We prefer
// the URL's path extension (preserves .heic / .webp etc.) and fall
// back to a MIME → ext map for opaque URLs.
function _extFromUrlOrType(url, mime){
  var m = String(url || '').match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
  if(m) return m[1].toLowerCase();
  if(mime){
    if(mime.indexOf('jpeg')>-1) return 'jpg';
    if(mime.indexOf('png')>-1)  return 'png';
    if(mime.indexOf('webp')>-1) return 'webp';
    if(mime.indexOf('gif')>-1)  return 'gif';
    if(mime.indexOf('heic')>-1) return 'heic';
  }
  return 'jpg';
}

// ======== AI TRANSLATE (Korean → English review notes) ========
var _reviewNoteOriginal=null;
async function translateReviewNote(){
  var ta=document.getElementById('reviewNote');
  var btn=document.getElementById('reviewTranslateBtn');
  var restore=document.getElementById('reviewRestoreBtn');
  if(!ta||!btn)return;
  var src=(ta.value||'').trim();
  if(!src){ alert('번역할 한국어 의견을 먼저 입력하세요.'); return; }
  if(src.length>5000){ alert('번역 요청은 5000자까지 가능합니다.'); return; }
  _reviewNoteOriginal=ta.value;
  var origText=btn.textContent;
  btn.disabled=true; btn.textContent='번역 중…';
  try{
    var res=await apiPost('/translate',{ text: src, mode: 'review' });
    if(res&&res.data&&res.data.translated){
      ta.value=res.data.translated;
      btn.disabled=false; btn.textContent='다시 번역';
      if(restore)restore.style.display='inline-block';
    }else{
      var msg=(res&&res.error)||'번역에 실패했어요.';
      alert(msg);
      btn.disabled=false; btn.textContent=origText;
    }
  }catch(e){
    console.error('translate error',e);
    alert('번역 중 오류가 발생했어요: '+(e.message||''));
    btn.disabled=false; btn.textContent=origText;
  }
}
function restoreReviewNote(){
  var ta=document.getElementById('reviewNote');
  var restore=document.getElementById('reviewRestoreBtn');
  var btn=document.getElementById('reviewTranslateBtn');
  if(!ta)return;
  if(_reviewNoteOriginal!==null){
    ta.value=_reviewNoteOriginal;
    _reviewNoteOriginal=null;
  }
  if(restore)restore.style.display='none';
  if(btn){btn.disabled=false;btn.textContent='영어로 변환';}
}



async function loadSubmissionForReview(submissionId){
  try{
    var apiBase=window.PAP_CONFIG&&window.PAP_CONFIG.API_BASE||'/api';
    var token=localStorage.getItem('pap-token');
    var resp=await fetch(apiBase+'/submissions/'+submissionId,{
      headers:{'Authorization':'Bearer '+token,'X-Requested-With':'XMLHttpRequest'}
    });
    if(!resp.ok){
      var errBody=null; try{errBody=await resp.json();}catch(_){}
      throw new Error('Failed to load submission ('+resp.status+'): '+(errBody&&errBody.message||''));
    }
    var data=await resp.json();
    // Backend returns { submission: {...} }; tolerate { data } and bare object too.
    var sub=data.submission||data.data||data;
    if(sub&&sub.id){
      currentReviewSubmission=sub;
      populateReviewModal(sub);
      renderReviewImageGrid(sub.file_urls||[]);
      // QA #180 — fresh modal open starts with clean gallery state
      _resetGalleryDirty();
    }else{
      throw new Error('Empty submission payload');
    }
  }catch(err){
    console.error('Error loading submission:',err);
    document.getElementById('reviewModalHeader').textContent='불러오기 실패: '+err.message;
  }
}

// ─── Helpers for the editorial-style credit/fashion block ────────────────────
// Map technical role keys (from credits object) → display labels in PAP style
var REVIEW_ROLE_LABELS = {
  photo: 'Photographer', photographer: 'Photographer',
  photo_asst: 'Assisted by', photo_assist: 'Assisted by', photo_assistant: 'Assisted by', photographer_assist: 'Assisted by',
  styling: 'Style', stylist: 'Style',
  styling_asst: 'Style assist', styling_assist: 'Style assist', stylist_assist: 'Style assist',
  hair: 'Hair', hairstylist: 'Hair', hair_asst: 'Hair assist',
  mua: 'MUAH', makeup: 'MUAH', make_up: 'MUAH', makeup_asst: 'MUAH assist',
  muah: 'MUAH', muah_asst: 'MUAH assist',
  casting: 'Casting', casting_director: 'Casting',
  video: 'Video', videographer: 'Video', video_director: 'Video',
  director: 'Director', creative_director: 'Creative Director', art_director: 'Art Director',
  set_design: 'Set Design', set_designer: 'Set Design', set_designe_assist: 'Set Design assist',
  producer: 'Producer',
  starring: 'Starring', model: 'Starring',
};

function _extractHandle(s){
  if(typeof s!=='string')return '';
  var m=s.match(/@[\w._-]+/);
  if(m)return m[0];
  // No @ found — synthesize one from the name (lowercase, no spaces)
  var name=s.replace(/\s*\([^)]*\)\s*/g,'').trim();
  if(!name)return '';
  return '@'+name.toLowerCase().replace(/[^\w._-]/g,'');
}

function _normalizeRoleKey(k){
  return String(k||'').toLowerCase().replace(/[\s.]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
}

// Build the multi-line "Credit" block in PAP style:
//   Photographer @ps_ritabusa Assisted by @kajsawingsphotography
//   Style @irisrochalima
//   ...
function buildCreditBlock(desc){
  var credits=desc.credits||{};
  var lines=[];
  var seen={};

  // Pair each primary role with its assistant, if any.
  // Iterate in a stable, intuitive order rather than object-key order.
  var roleOrder=['photo','photographer','styling','stylist','hair','hairstylist','mua','makeup','muah','set_design','set_designer','casting','video','videographer','director','creative_director','art_director','producer'];
  // Append any keys not in the canonical order so nothing is lost.
  Object.keys(credits).forEach(function(k){
    var nk=_normalizeRoleKey(k);
    if(roleOrder.indexOf(nk)===-1) roleOrder.push(nk);
  });

  roleOrder.forEach(function(key){
    var nk=_normalizeRoleKey(key);
    if(seen[nk])return;
    // Assistant variants we want to fold under the primary
    var asstKeys=[nk+'_asst', nk+'_assist', nk+'_assistant', nk+'_assisted_by'];

    var primaryRaw=credits[key]||credits[nk];
    var primaryArr=Array.isArray(primaryRaw)?primaryRaw:(primaryRaw?[primaryRaw]:[]);
    var primaryHandles=primaryArr.map(_extractHandle).filter(Boolean);

    var asstHandles=[];
    asstKeys.forEach(function(ak){
      var raw=credits[ak];
      if(!raw)return;
      var arr=Array.isArray(raw)?raw:[raw];
      arr.map(_extractHandle).filter(Boolean).forEach(function(h){asstHandles.push(h);});
      seen[ak]=true;
    });

    if(!primaryHandles.length && !asstHandles.length){ seen[nk]=true; return; }

    var label=REVIEW_ROLE_LABELS[nk]||nk.replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});
    var line=label;
    if(primaryHandles.length) line+=' '+primaryHandles.join(' ');
    if(asstHandles.length) line+=' Assisted by '+asstHandles.join(' ');
    lines.push(line);
    seen[nk]=true;
  });

  // Models → "Starring @handle1 @handle2"
  if(Array.isArray(desc.models)&&desc.models.length){
    var modelHandles=[];
    desc.models.forEach(function(m){
      if(typeof m==='string'){ var h=_extractHandle(m); if(h)modelHandles.push(h); return; }
      if(m&&m.instagram){ modelHandles.push(_extractHandle(m.instagram)||m.instagram); }
      else if(m&&m.name){ modelHandles.push(_extractHandle(m.name)); }
      // Add agency handle inline if provided
      if(m&&m.agencyInstagram){
        var ah=_extractHandle(m.agencyInstagram);
        if(ah)modelHandles[modelHandles.length-1]+=' / '+ah;
      }
    });
    modelHandles=modelHandles.filter(Boolean);
    if(modelHandles.length) lines.push('Starring '+modelHandles.join(' '));
  }

  return lines.join('\n');
}

// Collect all unique brand instagrams across looks → "@a @b @c"
function buildFashionLine(desc){
  var looks=Array.isArray(desc.looks)?desc.looks:[];
  var ordered=[]; var seen={};
  looks.forEach(function(L){
    if(!L||!Array.isArray(L.items))return;
    L.items.forEach(function(it){
      var h='';
      if(it.instagram) h=_extractHandle(it.instagram);
      else if(it.brand) h=_extractHandle(it.brand);
      if(h&&!seen[h]){ seen[h]=true; ordered.push(h); }
    });
  });
  return ordered.join(' ');
}

function populateReviewModal(submission){
  var desc={};
  try{desc=submission.description?JSON.parse(submission.description):{};}catch(e){desc={};}
  var createdDate=submission.created_at?new Date(submission.created_at).toLocaleDateString('ko-KR',{month:'long',day:'numeric'}):'-';
  var submitterName=submission.submitterName||(submission.profiles&&submission.profiles.name)||desc.contactName||'—';
  var submitterEmail=submission.submitterEmail||(submission.profiles&&submission.profiles.email)||desc.contactEmail||'';
  var plan=submission.submitterPlan?' · '+submission.submitterPlan:'';
  var genreText=Array.isArray(desc.genre)&&desc.genre.length?' · '+desc.genre.join(', '):'';
  var imgCount=Array.isArray(submission.file_urls)?submission.file_urls.length:0;

  // Header (compact context strip)
  document.getElementById('reviewModalHeader').textContent=submitterName+' · '+createdDate+genreText+' · '+imgCount+' images';

  // Title
  document.getElementById('reviewModalTitle').textContent=submission.title||'Untitled';

  // Credit block — PAP editorial style
  var creditText=buildCreditBlock(desc);
  document.getElementById('reviewModalCredits').textContent=creditText||'—';

  // Fashion brands (unique handles across all looks)
  var fashionText=buildFashionLine(desc);
  document.getElementById('reviewModalFashion').textContent=fashionText||'—';

  // Statement
  document.getElementById('reviewModalStatement').textContent=desc.artistStatement||'—';

  // Video link
  var videoEl=document.getElementById('reviewModalVideo');
  if(desc.videoUrl){
    var safe=String(desc.videoUrl).replace(/"/g,'&quot;');
    videoEl.innerHTML='<a href="'+safe+'" target="_blank" rel="noopener noreferrer" style="color:var(--blue);word-break:break-all">'+esc(desc.videoUrl)+'</a>';
  }else{
    videoEl.textContent='—';
  }

  // Production (compact submitter info — name + email + plan)
  document.getElementById('reviewModalProduction').textContent=submitterName+(submitterEmail?' · '+submitterEmail:'')+plan;

  // Pre-select cover image from description
  if(typeof desc.coverImageIndex==='number')selectedCoverImageIndex=desc.coverImageIndex;
}



function buildLookCreditFor(idx, desc){
  var map=Array.isArray(desc.lookImageMap)?desc.lookImageMap:[];
  var looks=Array.isArray(desc.looks)?desc.looks:[];
  var entry=map[idx];
  // If explicit lookImageMap exists, use it
  if(entry&&typeof entry.lookN==='number'){
    var look=looks.find(function(L){return L&&L.n===entry.lookN;});
    if(!look||!Array.isArray(look.items)||!look.items.length) return { lookN: entry.lookN, items: [] };
    return { lookN: entry.lookN, items: look.items };
  }
  // Fallback: if no lookImageMap but looks array exists, map by index
  if(looks.length>0){
    // Try to find a look that covers this image index
    // Simple heuristic: distribute images across looks evenly, or 1:1 if counts match
    var totalImages=(desc.totalImages||10);
    var lookIdx=Math.min(Math.floor(idx*looks.length/totalImages), looks.length-1);
    var fallbackLook=looks[lookIdx];
    if(fallbackLook){
      return { lookN: fallbackLook.n||lookIdx+1, items: Array.isArray(fallbackLook.items)?fallbackLook.items:[] };
    }
  }
  return null;
}

// QA #180 — admin-side gallery curation. Tracked as a "dirty" flag so
// the "변경사항 저장" button enables only after the admin actually
// reorders / deletes / changes the cover. Working state lives on
// currentReviewSubmission.file_urls (mutated in place); on save we PATCH
// the submission and on cancel we discard by reloading from the server.
var _galleryDirty = false;
function _markGalleryDirty(){
  _galleryDirty = true;
  var saveBtn = document.getElementById('reviewSaveGalleryBtn');
  if(saveBtn){ saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
}
function _resetGalleryDirty(){
  _galleryDirty = false;
  var saveBtn = document.getElementById('reviewSaveGalleryBtn');
  if(saveBtn){ saveBtn.disabled = true; saveBtn.style.opacity = '.5'; }
}

function renderReviewImageGrid(fileUrls){
  var grid=document.getElementById('reviewImageGrid');
  grid.innerHTML='';
  if(!fileUrls||!Array.isArray(fileUrls)||fileUrls.length===0){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:20px">이미지가 없습니다</div>';
    return;
  }
  // Decode the description JSON once so we can cross-reference per-image looks
  var desc={};
  try{
    if(currentReviewSubmission&&currentReviewSubmission.description){
      desc=typeof currentReviewSubmission.description==='string'
        ? JSON.parse(currentReviewSubmission.description)
        : currentReviewSubmission.description;
    }
  }catch(e){desc={};}

  // Inject totalImages so fallback look mapping works
  if(!desc.totalImages) desc.totalImages=fileUrls.length;
  fileUrls.forEach(function(url,idx){
    var card=document.createElement('div');
    card.style.cssText='border:2px solid '+(idx===selectedCoverImageIndex?'var(--green)':'var(--border)')+';border-radius:6px;overflow:hidden;background:var(--surface);display:flex;flex-direction:column;transition:border-color .2s';
    if(idx===selectedCoverImageIndex)card.style.boxShadow='0 0 8px rgba(76,175,80,.4)';

    // QA #180 — drag/drop to reorder. Stores the dragged index on the
    // dataTransfer (text/plain) since some browsers reject custom MIME.
    card.setAttribute('draggable', 'true');
    card.dataset.galleryIdx = String(idx);
    card.addEventListener('dragstart', function(e){
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch(_){}
      card.style.opacity = '.45';
    });
    card.addEventListener('dragend', function(){ card.style.opacity = ''; });
    card.addEventListener('dragover', function(e){
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch(_){}
      card.style.outline = '2px dashed rgba(120,180,255,.7)';
    });
    card.addEventListener('dragleave', function(){ card.style.outline = ''; });
    card.addEventListener('drop', function(e){
      e.preventDefault();
      card.style.outline = '';
      var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      var to = idx;
      if(isNaN(from) || from === to) return;
      _galleryReorder(from, to);
    });

    // Image — click opens lightbox
    var imgWrap=document.createElement('div');
    imgWrap.style.cssText='position:relative;cursor:zoom-in;background:#0a0a0a';
    var img=document.createElement('img');
    img.src=url;
    img.loading='lazy';
    img.draggable = false;  // QA #180 — keep card-level drag intact
    img.style.cssText='width:100%;height:240px;object-fit:cover;display:block;-webkit-user-drag:none';
    imgWrap.appendChild(img);

    var idxLabel=document.createElement('div');
    idxLabel.textContent='#'+(idx+1);
    idxLabel.style.cssText='position:absolute;top:6px;left:6px;background:rgba(0,0,0,.65);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:3px';
    imgWrap.appendChild(idxLabel);

    // Star button — sets cover, doesn't open lightbox
    var starBtn=document.createElement('button');
    starBtn.innerHTML=idx===selectedCoverImageIndex?'★':'☆';
    starBtn.title='표지 이미지로 설정';
    starBtn.style.cssText='position:absolute;top:6px;right:6px;background:rgba(0,0,0,.65);color:'+(idx===selectedCoverImageIndex?'#ffd166':'#fff')+';border:none;font-size:16px;width:28px;height:28px;cursor:pointer;border-radius:50%;display:flex;align-items:center;justify-content:center';
    starBtn.onclick=function(e){ e.stopPropagation(); selectCoverImage(idx); _markGalleryDirty(); };
    imgWrap.appendChild(starBtn);

    // QA #180 — × delete button. Positioned mid-right so it doesn't
    // collide with the cover star. Confirms first because deletion
    // is destructive (no undo until 저장 — and even before save the
    // user has lost their picked-but-deleted images from the modal view).
    var delBtn = document.createElement('button');
    delBtn.innerHTML = '×';
    delBtn.title = '이 이미지를 갤러리에서 제거';
    delBtn.style.cssText = 'position:absolute;top:40px;right:6px;background:rgba(200,50,50,.85);color:#fff;border:none;font-size:18px;font-weight:700;width:28px;height:28px;cursor:pointer;border-radius:50%;display:flex;align-items:center;justify-content:center;line-height:1';
    delBtn.onclick = function(e){
      e.stopPropagation();
      if(!confirm('이 이미지를 갤러리에서 제거하시겠습니까?\n(서버에 저장된 원본은 "갤러리 변경사항 저장" 클릭 시까지 그대로 유지됩니다.)')) return;
      _galleryDelete(idx);
    };
    imgWrap.appendChild(delBtn);

    imgWrap.onclick=function(e){ e.stopPropagation(); openReviewLightbox(idx); };
    imgWrap.ondblclick=function(e){ e.stopPropagation(); openReviewLightbox(idx); };
    card.appendChild(imgWrap);

    // Look + brand credits panel
    var info=document.createElement('div');
    info.style.cssText='padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.55;border-top:1px solid var(--border);min-height:54px';
    var creditObj=buildLookCreditFor(idx,desc);
    if(creditObj){
      var head=document.createElement('div');
      head.textContent='LOOK '+creditObj.lookN;
      head.style.cssText='font-weight:700;font-size:10px;letter-spacing:.08em;color:var(--text3);margin-bottom:6px';
      info.appendChild(head);
      if(creditObj.items.length){
        creditObj.items.forEach(function(it){
          var line=document.createElement('div');
          var t=it.type||'';
          var b=it.brand||'';
          var ig=it.instagram||'';
          line.innerHTML=(t?'<span style="color:var(--text3)">'+esc(t)+':</span> ':'')+'<span style="color:var(--text)">'+esc(b||'—')+'</span>'+(ig?' <span style="color:var(--text3)">'+esc(ig)+'</span>':'');
          info.appendChild(line);
        });
      }else{
        var none=document.createElement('div');
        none.textContent='브랜드 크레딧 없음';
        none.style.color='var(--text3)';
        info.appendChild(none);
      }
    }else{
      info.innerHTML='<span style="color:var(--text3)">추가 이미지 (룩 정보 없음)</span>';
    }
    card.appendChild(info);

    grid.appendChild(card);
  });
}

function selectCoverImage(idx){
  selectedCoverImageIndex=idx;
  _markGalleryDirty();
  renderReviewImageGrid(currentReviewSubmission.file_urls||[]);
}

// QA #180 — drag/drop reorder. Swap entries in file_urls, keep the
// cover index pointing at the SAME image (not the same slot) so the
// admin's pick survives the move.
function _galleryReorder(from, to){
  if(!currentReviewSubmission || !Array.isArray(currentReviewSubmission.file_urls)) return;
  var urls = currentReviewSubmission.file_urls.slice();
  if(from < 0 || from >= urls.length || to < 0 || to >= urls.length) return;
  var moved = urls.splice(from, 1)[0];
  urls.splice(to, 0, moved);
  currentReviewSubmission.file_urls = urls;
  // Track cover index through the reorder
  if(selectedCoverImageIndex === from){
    selectedCoverImageIndex = to;
  } else if(from < selectedCoverImageIndex && to >= selectedCoverImageIndex){
    selectedCoverImageIndex--;
  } else if(from > selectedCoverImageIndex && to <= selectedCoverImageIndex){
    selectedCoverImageIndex++;
  }
  _markGalleryDirty();
  renderReviewImageGrid(urls);
}

// QA #180 — remove a single image from the working gallery. The
// original file in Supabase Storage is NOT deleted; we only drop the
// reference from submissions.file_urls when the admin clicks save.
function _galleryDelete(idx){
  if(!currentReviewSubmission || !Array.isArray(currentReviewSubmission.file_urls)) return;
  var urls = currentReviewSubmission.file_urls.slice();
  if(idx < 0 || idx >= urls.length) return;
  if(urls.length <= 1){
    alert('이미지는 최소 1장 이상 유지해야 합니다.');
    return;
  }
  urls.splice(idx, 1);
  currentReviewSubmission.file_urls = urls;
  if(selectedCoverImageIndex === idx){
    selectedCoverImageIndex = 0;
  } else if(idx < selectedCoverImageIndex){
    selectedCoverImageIndex--;
  }
  if(selectedCoverImageIndex >= urls.length) selectedCoverImageIndex = urls.length - 1;
  _markGalleryDirty();
  renderReviewImageGrid(urls);
}

// QA #180 — persist the curated gallery via PATCH /api/submissions/:id.
// Server-side enforces "subset of original" so we never send anything
// the admin didn't legitimately curate from the existing list.
async function saveGalleryChanges(){
  if(!currentReviewSubmission || !currentReviewSubmission.id) return;
  if(!_galleryDirty) return;
  var btn = document.getElementById('reviewSaveGalleryBtn');
  var orig = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = '저장 중…'; }
  try{
    var resp = await fetch('/api/submissions/' + currentReviewSubmission.id, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('pap-token') || ''),
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        file_urls: currentReviewSubmission.file_urls,
        coverImageIndex: selectedCoverImageIndex
      })
    });
    var data = await resp.json();
    if(!resp.ok) throw new Error(data.message || '저장 실패');
    // Adopt the canonical server copy so subsequent edits start from a
    // clean baseline (description.coverImageIndex + lookImageMap are
    // now in sync with the saved file_urls order).
    currentReviewSubmission = data.submission || currentReviewSubmission;
    try{
      var d = currentReviewSubmission.description
        ? (typeof currentReviewSubmission.description === 'string'
            ? JSON.parse(currentReviewSubmission.description)
            : currentReviewSubmission.description)
        : {};
      if(typeof d.coverImageIndex === 'number') selectedCoverImageIndex = d.coverImageIndex;
    }catch(_){}
    _resetGalleryDirty();
    if(btn){
      btn.textContent = '✓ 저장됨';
      setTimeout(function(){
        btn.textContent = orig || '💾 갤러리 변경사항 저장';
      }, 1500);
    }
    // Re-render so any look-image-map shuffles render correctly
    renderReviewImageGrid(currentReviewSubmission.file_urls || []);
  }catch(e){
    if(btn){
      btn.textContent = orig || '💾 갤러리 변경사항 저장';
      btn.disabled = false;
      btn.style.opacity = '1';
    }
    alert('갤러리 저장 실패: ' + (e && e.message ? e.message : e));
  }
}

// ======== REVIEW LIGHTBOX ========
var _reviewLbIdx=0;
function openReviewLightbox(idx){
  _reviewLbIdx=idx;
  _renderReviewLightbox();
  var lb=document.getElementById('reviewLightbox');
  lb.style.display='flex';
  // Prevent immediate close from same click event propagation
  setTimeout(function(){ document.addEventListener('keydown',_reviewLbKey); },50);
}
function closeReviewLightbox(e){
  // Only close when clicking the overlay background itself
  if(e&&e.target!==document.getElementById('reviewLightbox'))return;
  document.getElementById('reviewLightbox').style.display='none';
  document.removeEventListener('keydown',_reviewLbKey);
}
function stepReviewLightbox(delta){
  var urls=(currentReviewSubmission&&currentReviewSubmission.file_urls)||[];
  if(!urls.length)return;
  _reviewLbIdx=(_reviewLbIdx+delta+urls.length)%urls.length;
  _renderReviewLightbox();
}
function _reviewLbKey(e){
  if(e.key==='Escape')closeReviewLightbox();
  else if(e.key==='ArrowLeft')stepReviewLightbox(-1);
  else if(e.key==='ArrowRight')stepReviewLightbox(1);
}
function _renderReviewLightbox(){
  var urls=(currentReviewSubmission&&currentReviewSubmission.file_urls)||[];
  if(!urls.length)return;
  var idx=Math.max(0,Math.min(_reviewLbIdx,urls.length-1));
  document.getElementById('reviewLightboxImg').src=urls[idx];
  // Build caption with look + brand credits
  var desc={};
  try{
    if(currentReviewSubmission&&currentReviewSubmission.description){
      desc=typeof currentReviewSubmission.description==='string'
        ? JSON.parse(currentReviewSubmission.description)
        : currentReviewSubmission.description;
    }
  }catch(e){desc={};}
  var credit=buildLookCreditFor(idx,desc);
  var caption='#'+(idx+1)+' / '+urls.length;
  if(credit){
    caption+=' &nbsp;·&nbsp; <strong>Look '+credit.lookN+'</strong>';
    if(credit.items.length){
      caption+=' &nbsp;·&nbsp; '+credit.items.map(function(it){
        var t=it.type?esc(it.type)+': ':'';
        var b=esc(it.brand||'—');
        var ig=it.instagram?' <span style="color:rgba(255,255,255,.5)">'+esc(it.instagram)+'</span>':'';
        return t+b+ig;
      }).join(' &nbsp;/&nbsp; ');
    }
  }
  document.getElementById('reviewLightboxCaption').innerHTML=caption;
}

async function doReview(status){
  if(!currentReviewSubmission){
    alert('심사 대상 서브미션을 불러올 수 없습니다.');
    return;
  }
  var note=document.getElementById('reviewNote').value;
  var labels={approved:'승인',rejected:'거절',revision:'보완 요청'};

  // For 보완 요청 the admin note is the only useful signal to the submitter,
  // so warn if it's empty.
  if(status==='revision'&&!(note||'').trim()){
    alert('보완 요청은 어떤 부분을 수정해야 하는지 의견 작성이 필요해요. 심사 의견 칸에 구체적으로 작성해주세요.');
    return;
  }

  // QA #172 — approval email is no longer sent at the moment of ✓ 승인.
  // The admin first stages the editorial, then finalises copy/cover/IG
  // caption in the editorial modal, and ticks "✉️ 저장 시 승인 메일 발송"
  // there before pressing 저장. doReview's job is now strictly to flip
  // the submission status and (for approved) stage the draft.
  if(!confirm(labels[status]+' 처리하시겠습니까?\n의견: '+(note||'(없음)'))){
    return;
  }

  try{
    var apiBase=window.PAP_CONFIG&&window.PAP_CONFIG.API_BASE||'/api';
    var token=localStorage.getItem('pap-token');
    var payload={
      status:status,
      reviewNote:note,
      coverImageIndex:selectedCoverImageIndex
    };
    var resp=await fetch(apiBase+'/submissions/'+currentReviewSubmission.id+'/review',{
      method:'PUT',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},
      body:JSON.stringify(payload)
    });
    if(!resp.ok){
      var errData=await resp.json();
      throw new Error(errData.message||'심사 처리 실패');
    }
    var result=await resp.json();
    closeModal();
    // On approval the backend stages an editorial draft and returns its
    // id. Jump straight into the edit screen so the editor can polish
    // metadata while the submission's context is still fresh — beats
    // making them navigate back through 에디토리얼 관리 → 임시저장.
    if(status==='approved' && result && result.editorialId){
      try{
        await openEditorialEditor(result.editorialId);
        return;
      }catch(navErr){
        console.warn('Could not auto-open editorial editor:',navErr);
        alert('승인되었습니다. 에디토리얼 관리 → 임시저장 탭에서 편집할 수 있습니다.');
      }
    } else {
      alert('심사가 완료되었습니다.');
    }
    if(window.loadSubmissions) loadSubmissions();
  }catch(err){
    console.error('Review submission error:',err);
    alert('오류: '+err.message);
  }
}

// review.js stamps approved submissions with a marker like
// "[Staged as editorial id: <uuid>]" inside admin_notes. Pull the uuid
// back out so the submission row + review modal can deep-link to the
// editor. Returns null when the marker is missing (older approvals
// from before this flow shipped, or stage-as-editorial failures).
function _extractStagedEditorialId(notes){
  if(!notes || typeof notes !== 'string') return null;
  var m = notes.match(/\[Staged as editorial id:\s*([0-9a-f-]{36})\]/i);
  return m ? m[1] : null;
}

// QA #188 — sends approval/rejected/revision test emails to the admin's
// own inbox so they can verify SMTP + see the live template before any
// real submitter triggers it. Reuses the same templates.submissionReview
// Complete pipeline as the live review flow, so a successful test is
// confirmation that real submitters will also receive the mail.
async function testSubmissionEmail(){
  var statuses = [
    { code:'approved',  label:'✓ 승인 (Approved)' },
    { code:'rejected',  label:'✕ 거절 (Rejected)' },
    { code:'revision',  label:'↻ 보완 요청 (Revision)' },
  ];
  // Build a quick prompt so the admin can pick one of the three. We
  // intentionally keep this as a window.prompt + alert pair (no modal)
  // because it's a developer-tool / verification feature, not part of
  // the routine flow.
  var choice = prompt(
    '본인 이메일로 어떤 상태의 미리보기 메일을 보낼까요?\n\n' +
    statuses.map(function(s,i){ return '  '+(i+1)+'. '+s.label; }).join('\n') +
    '\n  4. 셋 다 한 번씩\n\n번호 입력 (1-4):',
    '4'
  );
  if(!choice) return;
  var pickIdx = parseInt(choice, 10);
  if(isNaN(pickIdx) || pickIdx < 1 || pickIdx > 4){
    alert('1, 2, 3, 또는 4를 입력해주세요.');
    return;
  }
  var targets = (pickIdx === 4) ? statuses : [statuses[pickIdx-1]];

  // Optional: ask whether to override the recipient. Default = the
  // admin's own profile email (which the backend looks up).
  var customTo = prompt(
    '받는 이메일 (비워두면 본인 프로필 이메일로 발송):\n' +
    '※ 비공개 정보 노출 방지를 위해 본인 이메일만 권장합니다.',
    ''
  );
  if(customTo === null) return; // canceled

  var token = localStorage.getItem('pap-token') || '';
  var results = [];

  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    try {
      var body = {
        status: t.code,
        title: '[TEST] ' + t.label + ' Editorial',
      };
      if (customTo && customTo.trim()) body.to = customTo.trim();
      if (t.code === 'approved') {
        body.approvalDay = '15';
        body.approvalMonth = 'June';
      }
      var resp = await fetch(_apiBase+'/admin/submissions/test-email',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+token,
          'X-Requested-With':'XMLHttpRequest'
        },
        body: JSON.stringify(body)
      });
      var data = await resp.json();
      if(!resp.ok || !data.sent){
        results.push('✗ ' + t.label + ' — 실패: ' + (data.message || data.detail || resp.status));
      } else {
        results.push('✓ ' + t.label + ' → ' + data.to + ' (id: ' + (data.messageId||'').slice(-12) + ')');
      }
    } catch (e) {
      results.push('✗ ' + t.label + ' — 예외: ' + (e && e.message || e));
    }
  }

  alert('테스트 결과:\n\n' + results.join('\n') +
    '\n\n수 초 내에 받은편지함을 확인해주세요. 도착하지 않으면 스팸함도 확인하세요.');
}

// Fetch one editorial by id, drop it into the local cache, then open
// the edit form. Lets callers (post-approval auto-jump, "편집" button on
// approved submission rows) share one code path.
async function openEditorialEditor(editorialId){
  var resp=await apiGet('/editorials/'+editorialId);
  var ed=resp && (resp.data || resp);
  if(!ed || !ed.id) throw new Error('Editorial not found: '+editorialId);
  if(!Array.isArray(editorials)) editorials=[];
  // Replace any stale cached copy so editEditorial finds the fresh row.
  var idx=editorials.findIndex(function(e){return e.id===ed.id;});
  if(idx>=0) editorials[idx]=ed;
  else editorials.push(ed);
  // editEditorial sets editingEditorialId synchronously and calls
  // go('newpost') itself at the end, so the route's reset hook (which
  // skips when editingEditorialId is set) leaves our populated form alone.
  editEditorial(ed.id);
}

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

// ======== SUBMISSIONS MANAGEMENT ========
var currentSubFilter='';
// QA #174 — page-state tracking so admin can paginate. Reset to 1 on
// filter change so the user doesn't end up "stuck" on a page that
// doesn't exist for the new filter (e.g. moved from 전체 page 3 to
// 거절 which only has 1 page total).
var currentSubPage=1;
async function loadSubmissions(statusFilter, opts){
  if(statusFilter!==undefined && statusFilter!==currentSubFilter){
    currentSubFilter=statusFilter;
    currentSubPage=1;
  }
  // Allow callers (pagination buttons) to override the page without
  // changing the filter.
  if(opts && typeof opts.page === 'number') currentSubPage = Math.max(1, opts.page);

  var tb=document.getElementById('submissionListBody');
  if(!tb)return;
  tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px">불러오는 중...</td></tr>';
  try{
    var params=[];
    if(currentSubFilter) params.push('status='+encodeURIComponent(currentSubFilter));
    params.push('page='+currentSubPage);
    var query='?'+params.join('&');
    var result=await apiGet('/submissions'+query);
    var submissions=result.submissions||result.data||[];
    var totalPages=result.totalPages||1;
    var total=result.total||submissions.length;

    if(!submissions.length){
      tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px 0">서브미션이 없습니다</td></tr>';
      _renderSubPagination(currentSubPage, totalPages, total);
      return;
    }
    tb.innerHTML='';
    submissions.forEach(function(s){
      // QA #179 — server-derived display_status covers all five workflow
      // stages (대기중 / 보완요청 / 최종승인 / 업로드완료 / 거절) plus the
      // existing 보완완료 (resubmitted) overlay. Fall back to legacy
      // computation for older responses that don't include display_status.
      var ds = s.display_status;
      if (!ds) {
        if (s.status === 'pending' && s.resubmitted_at) ds = 'resubmitted';
        else if (s.status === 'approved' && s.linked_editorial && s.linked_editorial.status === 'published') ds = 'uploaded';
        else if (s.status === 'approved') ds = 'final_approved';
        else ds = s.status;
      }
      // QA #183 — every stage gets its own colour so the table can be
      // scanned visually. See admin.html .b-resubmitted / .b-uploaded.
      var statusMap = {
        pending:        { cls: 'b-pending',     label: '대기 중' },
        resubmitted:    { cls: 'b-resubmitted', label: '보완 완료' },
        revision:       { cls: 'b-revision',    label: '보완 요청' },
        final_approved: { cls: 'b-approved',    label: '최종 승인' },
        uploaded:       { cls: 'b-uploaded',    label: '업로드 완료' },
        rejected:       { cls: 'b-declined',    label: '거절' },
      };
      var sInfo = statusMap[ds] || { cls: 'b-pending', label: ds || '—' };
      var statusCls = sInfo.cls;
      var statusLabel = sInfo.label;
      var looks=s.file_urls?s.file_urls.length:'?';
      var plan=s.submitterPlan||'free';
      var planCls=plan.indexOf('premium')>-1?'b-premium':plan.indexOf('standard')>-1?'b-standard':'b-free';
      var planLabel=plan.indexOf('premium')>-1?'Premium':plan.indexOf('standard')>-1?'Standard':'Free';
      // For approved submissions, surface a deep-link to the staged
      // editorial's edit screen. Prefer linked_editorial.id (QA #172,
      // populated server-side from source_submission_id) over the legacy
      // [Staged as editorial id: …] marker we used to parse out of
      // admin_notes — both keep working so older rows aren't orphaned.
      var editorialId = (s.linked_editorial && s.linked_editorial.id)
        || _extractStagedEditorialId(s.admin_notes);
      var actionBtns='<button class="btn btn-sm" onclick="openModal(\''+s.id+'\')">심사</button>';
      if(s.status==='approved' && editorialId){
        // QA #179 — button label reflects current stage: 업로드완료 →
        // "에디토리얼 보기" (informational, already published);
        // 최종승인 (still draft) → "에디토리얼 편집" (work in progress).
        var btnLabel = ds === 'uploaded' ? '에디토리얼 보기' : '에디토리얼 편집';
        actionBtns += ' <button class="btn btn-sm btn-primary" onclick="openEditorialEditor(\''+editorialId+'\')" title="연결된 에디토리얼 편집 화면으로 이동">'+btnLabel+'</button>';
      }
      tb.innerHTML+='<tr><td class="td-title" onclick="openModal(\''+s.id+'\')">'+esc(s.title)+'</td><td>'+esc(s.submitterName||s.submitterEmail||'—')+'</td><td><span class="badge '+planCls+'">'+planLabel+'</span></td><td>'+looks+'</td><td>'+fmtDate(s.created_at)+'</td><td><span class="badge '+statusCls+'">'+statusLabel+'</span></td><td>'+actionBtns+'</td></tr>';
    });
    _renderSubPagination(currentSubPage, totalPages, total);
  }catch(err){
    tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:#ff6b6b;padding:40px">불러오기 실패</td></tr>';
    console.error('Error loading submissions:',err);
  }
}
// QA #174 — pagination bar rendered under the submissions table.
// Lives in <tfoot> on first call (or replaces existing tfoot on
// subsequent calls). Hides when there's only one page so the UI doesn't
// look busy for small accounts.
function _renderSubPagination(page, totalPages, total){
  var table=document.getElementById('submissionListBody');
  if(!table) return;
  var tableEl=table.closest('table');
  if(!tableEl) return;
  var existing=tableEl.querySelector('tfoot.sub-pagination');
  if(totalPages<=1){
    if(existing) existing.remove();
    return;
  }
  var prevDisabled = page<=1 ? 'disabled' : '';
  var nextDisabled = page>=totalPages ? 'disabled' : '';
  var html=
    '<tr><td colspan="7" style="padding:14px 12px;border-top:1px solid var(--border);background:var(--surface)">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text3)">'+
        '<span>총 <strong style="color:var(--text)">'+total+'</strong>건 · 페이지 <strong style="color:var(--text)">'+page+'</strong> / '+totalPages+'</span>'+
        '<span style="display:flex;gap:6px">'+
          '<button class="btn btn-sm" '+prevDisabled+' onclick="loadSubmissions(undefined,{page:'+(page-1)+'})">← 이전</button>'+
          '<button class="btn btn-sm" '+nextDisabled+' onclick="loadSubmissions(undefined,{page:'+(page+1)+'})">다음 →</button>'+
        '</span>'+
      '</div>'+
    '</td></tr>';
  if(existing){
    existing.innerHTML=html;
  }else{
    var tf=document.createElement('tfoot');
    tf.className='sub-pagination';
    tf.innerHTML=html;
    tableEl.appendChild(tf);
  }
}
function filterSubmissions(status,btn){
  btn.parentElement.querySelectorAll('.tf').forEach(function(f){f.classList.remove('on');});
  btn.classList.add('on');
  loadSubmissions(status);
}

// ======== PULL-LETTERS MANAGEMENT ========
// Two flows write to the same `pullletters` table:
//   - Legacy: /frontend/pullletter.html → multipart with file_urls (request_text)
//   - Community: /frontend/community.html → JSON with mood_board_id + structured fields
// Status values: 'pending' → 'accepted'/'approved' → 'issued' (PDF delivered) | 'rejected'
var currentPLFilter='';
var _allPullLetters=[];
async function loadPullLetters(statusFilter){
  if(statusFilter!==undefined)currentPLFilter=statusFilter;
  var tb=document.getElementById('pullletterListBody');
  if(!tb)return;
  tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:40px">불러오는 중...</td></tr>';
  try{
    var query=currentPLFilter?'?status='+currentPLFilter:'';
    var result=await apiGet('/pullletters'+query);
    var pls=result.pullLetters||[];
    _allPullLetters = pls;
    if(!pls.length){tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:40px 0">Pull-Letter 요청이 없습니다</td></tr>';return;}
    tb.innerHTML='';
    pls.forEach(function(pl){
      var statusMap = {
        pending:  { cls:'b-pending',  label:'대기 중' },
        accepted: { cls:'b-approved', label:'승인' },
        approved: { cls:'b-approved', label:'승인' },
        issued:   { cls:'b-approved', label:'발급 완료' },
        rejected: { cls:'b-declined', label:'거절' },
      };
      var s = statusMap[pl.status] || statusMap.pending;
      // Title: moodboard title (community flow) or first line of request_text (legacy)
      var title = pl.moodBoardTitle || ((pl.request_text||'').slice(0,60) + ((pl.request_text||'').length>60?'…':''));
      // Detail: shoot_purpose (community) or file count (legacy)
      var detail = pl.shoot_purpose
        ? (pl.shoot_purpose.slice(0,60) + (pl.shoot_purpose.length>60?'…':''))
        : ((pl.file_urls && pl.file_urls.length) ? (pl.file_urls.length+'개 파일') : '—');
      var actions = '<button class="btn btn-sm" onclick="openPullLetterReview(\''+pl.id+'\')">검토</button>';
      tb.innerHTML += '<tr>'
        + '<td>'+esc(pl.requesterName||pl.requesterEmail||'—')+'</td>'
        + '<td><strong>'+esc(title||'—')+'</strong>'+(detail?'<div style="font-size:10px;color:var(--text3);margin-top:2px">'+esc(detail)+'</div>':'')+'</td>'
        + '<td>'+(pl.mood_board_id ? '🔗 community' : (pl.file_urls?(pl.file_urls.length+'개'):'—'))+'</td>'
        + '<td>'+fmtDate(pl.created_at)+'</td>'
        + '<td><span class="badge '+s.cls+'">'+s.label+'</span></td>'
        + '<td>'+actions+'</td>'
        + '</tr>';
    });
  }catch(err){
    tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:#ff6b6b;padding:40px">불러오기 실패</td></tr>';
  }
}
function filterPullLetters(status,btn){
  btn.parentElement.querySelectorAll('.tf').forEach(function(f){f.classList.remove('on');});
  btn.classList.add('on');
  loadPullLetters(status);
}

// Inline review panel — opens a quick modal with all fields + PDF upload + actions.
function openPullLetterReview(id){
  var pl = _allPullLetters.find(function(x){ return x.id === id; });
  if(!pl){ alert('Not found'); return; }
  var bg = document.getElementById('plReviewBg');
  if(!bg){ bg = _createPullLetterReviewModal(); document.body.appendChild(bg); }
  bg.dataset.id = id;

  // ── Team credits block (structured team_info from new flow) ──
  var team = pl.team_info || {};
  function _teamRow(label, t){
    if(!t || !(t.name || t.instagram || t.portfolio)) return '';
    var parts = [];
    if(t.name) parts.push('<strong>'+esc(t.name)+'</strong>');
    if(t.instagram) parts.push('<a href="https://instagram.com/'+esc((t.instagram||'').replace(/^@/,''))+'" target="_blank" rel="noopener noreferrer">'+esc(t.instagram)+'</a>');
    if(t.portfolio) parts.push('<a href="'+esc(t.portfolio)+'" target="_blank" rel="noopener noreferrer">portfolio ↗</a>');
    return '<div class="plr-row"><label>'+esc(label)+'</label><div>'+parts.join(' · ')+'</div></div>';
  }
  var teamHtml = ''
    + _teamRow('Photographer (필수)',   team.photographer)
    + _teamRow('Stylist (필수)',         team.stylist)
    + _teamRow('Videographer (선택)',    team.videographer)
    + (team.contact ? '<div class="plr-row"><label>Contact</label><div>'+esc(team.contact.name||'—')+' · '+esc(team.contact.email||'')+'</div></div>' : '');
  if(Array.isArray(team.extras) && team.extras.length){
    teamHtml += team.extras.map(function(x){
      return '<div class="plr-row"><label>'+esc(x.role||'Other')+'</label><div>'+esc(x.name||'')+(x.instagram?(' · '+esc(x.instagram)):'')+'</div></div>';
    }).join('');
  }

  // ── Files block — proposal PDF (signed) + moodboard thumbnail grid ──
  var filesHtml = '';
  if(pl.proposalPdfSignedUrl){
    filesHtml += '<div class="plr-row"><label>📄 촬영시안 PDF</label><div><a href="'+esc(pl.proposalPdfSignedUrl)+'" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">Download proposal ↗</a></div></div>';
  } else if(pl.proposal_pdf_url){
    filesHtml += '<div class="plr-row"><label>촬영시안 PDF</label><div style="color:var(--text3)">Path: '+esc(pl.proposal_pdf_url)+' (signing failed)</div></div>';
  }
  if(pl.file_urls && pl.file_urls.length){
    filesHtml += '<div class="plr-row"><label>Mood board ('+pl.file_urls.length+')</label><div>'
      + pl.file_urls.slice(0,8).map(function(u){
          return '<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer"><img src="'+esc(u)+'" alt="" style="width:48px;height:48px;object-fit:cover;border:1px solid var(--border);margin-right:4px;margin-bottom:4px"></a>';
        }).join('')
      + (pl.file_urls.length > 8 ? '<span style="font-size:11px;color:var(--text3)">+ '+(pl.file_urls.length-8)+' more</span>' : '')
      + '</div></div>';
  }

  // ── Misc/legacy block ──
  var miscHtml = ''
    + (pl.request_text ? '<div class="plr-row"><label>Additional message</label><div style="white-space:pre-wrap">'+esc(pl.request_text)+'</div></div>' : '')
    + (pl.shoot_purpose && pl.shoot_purpose !== pl.request_text ? '<div class="plr-row"><label>Legacy purpose</label><div style="white-space:pre-wrap">'+esc(pl.shoot_purpose)+'</div></div>' : '');

  // ── Admin actions block (issued PDF status) ──
  var pdfStatusHtml = '';
  if(pl.pullLetterSignedUrl){
    pdfStatusHtml = '✅ Already issued — <a href="'+esc(pl.pullLetterSignedUrl)+'" target="_blank" rel="noopener noreferrer">Download issued letter ↗</a>';
  } else if(pl.pull_letter_url){
    pdfStatusHtml = 'Uploaded but signing failed: '+esc(pl.pull_letter_url);
  } else {
    pdfStatusHtml = 'Not yet issued';
  }

  var body = bg.querySelector('.plr-body');
  body.innerHTML = ''
    + '<div class="plr-row"><label>Requester</label><div>'+esc(pl.requesterName||'—')+' · '+esc(pl.requesterEmail||'')+'</div></div>'
    + teamHtml
    + filesHtml
    + miscHtml
    + '<div class="plr-row"><label>Admin notes (회원에게 표시됨)</label><textarea id="plrNotes" rows="3" style="width:100%;padding:8px 10px;border:1px solid var(--border);font-family:inherit;font-size:12px">'+esc(pl.admin_notes||'')+'</textarea></div>'
    + '<div class="plr-row"><label>발급 풀레터 PDF (admin upload)</label><div style="font-size:11px;color:var(--text3);margin-bottom:6px">'+pdfStatusHtml+'</div><input type="file" id="plrPdf" accept="application/pdf"></div>';
  bg.style.display = 'flex';
}
function closePullLetterReview(){
  var bg = document.getElementById('plReviewBg');
  if(bg) bg.style.display = 'none';
}
function _createPullLetterReviewModal(){
  var bg = document.createElement('div');
  bg.id = 'plReviewBg';
  bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:200;font-family:Montserrat,sans-serif';
  bg.innerHTML = '<div style="background:#fff;width:560px;max-width:96vw;max-height:90vh;overflow-y:auto;border:1px solid var(--border);padding:28px;position:relative">'
    + '<button onclick="closePullLetterReview()" style="position:absolute;top:14px;right:18px;background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3)">×</button>'
    + '<h3 style="font-size:14px;font-weight:700;letter-spacing:.05em;margin-bottom:18px">PULL-LETTER REVIEW</h3>'
    + '<div class="plr-body"></div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">'
      + '<button class="btn btn-sm" onclick="doPullLetterReview(\'approved\',null)">Approve</button>'
      + '<button class="btn btn-sm" onclick="doPullLetterReview(\'issued\',null)">Mark Issued (uploads PDF)</button>'
      + '<button class="btn btn-sm" onclick="doPullLetterReview(\'rejected\',null)">Reject</button>'
      + '<button class="btn btn-sm" onclick="doPullLetterReview(null,null)">Save notes only</button>'
    + '</div>';
  // Inline style for plr rows
  var style = document.createElement('style');
  style.textContent = '.plr-row{margin-bottom:14px}.plr-row label{display:block;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:4px}.plr-row > div{font-size:13px;color:var(--text2)}';
  document.head.appendChild(style);
  bg.addEventListener('click', function(e){ if(e.target === bg) closePullLetterReview(); });
  return bg;
}
async function _uploadPullLetterPdfIfPresent(id){
  var input = document.getElementById('plrPdf');
  if(!input || !input.files || input.files.length === 0) return null;
  var fd = new FormData();
  fd.append('pdf', input.files[0]);
  var r = await fetch((_apiBase||'/api')+'/pullletters/upload?id='+encodeURIComponent(id), {
    method:'POST',
    headers:{ 'Authorization':'Bearer '+localStorage.getItem('pap-token'), 'X-Requested-With':'XMLHttpRequest' },
    body: fd,
  });
  var j = await r.json();
  if(!r.ok) throw new Error(j.message || 'PDF upload failed');
  return j.pullLetterPath;
}
async function doPullLetterReview(status){
  var bg = document.getElementById('plReviewBg');
  var id = bg ? bg.dataset.id : null;
  if(!id) return;
  var labels = { approved:'승인', accepted:'승인', issued:'발급 완료', rejected:'거절' };
  if(status && !confirm('이 Pull-Letter를 '+(labels[status]||status)+' 처리하시겠습니까?')) return;
  try{
    var pdfPath = null;
    // 'issued' requires a PDF (or one already uploaded). For other statuses upload is optional.
    var pl = _allPullLetters.find(function(x){ return x.id === id; });
    if(status === 'issued'){
      pdfPath = await _uploadPullLetterPdfIfPresent(id);
      if(!pdfPath && !(pl && pl.pull_letter_url)){
        alert('"Mark Issued"는 PDF가 필요합니다. 먼저 파일을 첨부해주세요.');
        return;
      }
    } else {
      pdfPath = await _uploadPullLetterPdfIfPresent(id);
    }
    var notesEl = document.getElementById('plrNotes');
    var payload = { reviewNote: notesEl ? notesEl.value : '' };
    if(status) payload.status = status;
    if(pdfPath) payload.pullLetterPath = pdfPath;
    // If we only have notes/PDF (no status change), still need a status to satisfy the endpoint.
    // Reuse current status as a no-op so review.js validation passes.
    if(!payload.status){
      payload.status = (pl && pl.status) || 'pending';
    }
    var resp = await fetch((_apiBase||'/api')+'/pullletters/'+id+'/review', {
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('pap-token'),'X-Requested-With':'XMLHttpRequest'},
      body: JSON.stringify(payload),
    });
    if(!resp.ok){ var d=await resp.json(); throw new Error(d.message||'처리 실패'); }
    closePullLetterReview();
    loadPullLetters(currentPLFilter);
  }catch(e){
    alert('오류: '+(e.message||'Pull-Letter 처리 실패'));
  }
}

// ======== NEWS (ARTICLES) MANAGEMENT ========
// QA #199 — full edit lifecycle, three-status filter + scheduled posts.
// Mirrors the editorial list shipped in QA #196/#197 so news editors get
// the same affordances (저장된 글 수정, 상태별 탭, 예약 게시, 클릭 진입 편집).
var allArticles=[];                  // every row fetched (published+draft+scheduled, deduped)
var newsActiveStatus='all';          // which tab is currently selected
var editingArticleId=null;           // null → POST (new), uuid → PUT (edit)

async function loadNews(){
  var tb=document.getElementById('newsListBody');
  if(!tb)return;
  tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:40px">불러오는 중...</td></tr>';
  try{
    // Fan-out the three list calls so the page is fully populated in
    // one round-trip. Same pattern editorial admin uses since QA #196.
    var results = await Promise.all([
      apiGet('/articles?limit=100&status=published').catch(function(){return{data:[]};}),
      apiGet('/articles?limit=100&status=draft').catch(function(){return{data:[]};}),
      apiGet('/articles?limit=100&status=scheduled').catch(function(){return{data:[]};})
    ]);
    var published = results[0].data || [];
    var drafts    = results[1].data || [];
    var scheduled = results[2].data || [];

    // Scheduled rows ARE status='published' under the hood — tag them
    // with a virtual _virtualStatus so the renderer / filter can tell
    // them apart from already-live published rows without re-querying.
    scheduled.forEach(function(a){ a._virtualStatus='scheduled'; });

    // Dedupe by id (a scheduled row would otherwise show up in both
    // the published list AND the scheduled list).
    var byId = {};
    [].concat(published, drafts, scheduled).forEach(function(a){
      if(!a || !a.id) return;
      // Scheduled tag wins so the row keeps its purple "예약" badge.
      if(byId[a.id] && a._virtualStatus==='scheduled'){
        byId[a.id]._virtualStatus='scheduled';
      } else if(!byId[a.id]){
        byId[a.id] = a;
      }
    });
    allArticles = Object.values(byId);

    renderNews();
  }catch(e){
    tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:#ff6b6b;padding:40px">불러오기 실패</td></tr>';
  }
}

function _articleEffectiveStatus(a){
  if(a._virtualStatus==='scheduled') return 'scheduled';
  return a.status || 'published';
}

function renderNews(){
  var tb=document.getElementById('newsListBody');
  if(!tb)return;

  // Counts roll up across all rows regardless of active filter so the
  // tab badges always show the global totals.
  var counts={all:allArticles.length, published:0, draft:0, scheduled:0};
  allArticles.forEach(function(a){
    var s=_articleEffectiveStatus(a);
    if(counts[s]!==undefined) counts[s]++;
  });
  var setCount=function(id,n){var el=document.getElementById(id);if(el)el.textContent=String(n||0);};
  setCount('newsAllCountBadge', counts.all);
  setCount('newsPublishedCountBadge', counts.published);
  setCount('newsDraftCountBadge', counts.draft);
  setCount('newsScheduledCountBadge', counts.scheduled);

  // Filter rows by the active tab. 'all' shows everything.
  var visible = allArticles.filter(function(a){
    if(newsActiveStatus==='all') return true;
    return _articleEffectiveStatus(a) === newsActiveStatus;
  });

  if(!visible.length){
    tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:40px 0">'+(newsActiveStatus==='all'?'뉴스가 없습니다':'해당 상태의 뉴스가 없습니다')+'</td></tr>';
    return;
  }
  tb.innerHTML='';
  visible.forEach(function(a){
    var st=_articleEffectiveStatus(a);
    var cls,label;
    if(st==='scheduled'){
      cls='b-scheduled';
      // Surface the scheduled-at time inline so the editor can see
      // exactly when each row will flip live.
      var when = a.scheduled_publish_at ? new Date(a.scheduled_publish_at) : null;
      var whenStr = when ? when.toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      label='⏰ 예약'+(whenStr?' · '+whenStr:'');
    } else if(st==='published'){
      cls='b-published'; label='공개';
    } else {
      cls='b-draft'; label='임시저장';
    }
    var shortId=a.id?a.id.substring(0,8):'—';
    // Row is clickable as a whole (matches editorial behavior); the
    // dedicated 편집 button stays for users who learned the editorial
    // pattern of clicking the explicit action.
    var safeTitle = esc(a.title||'(제목 없음)');
    tb.innerHTML+='<tr style="cursor:pointer" onclick="editArticle(\''+a.id+'\')"><td style="font-size:10px">'+shortId+'</td><td class="td-title">'+safeTitle+'</td><td><span class="badge '+cls+'">'+label+'</span></td><td>'+fmtDate(a.published_date||a.scheduled_publish_at)+'</td><td onclick="event.stopPropagation()"><button class="btn btn-sm" onclick="editArticle(\''+a.id+'\')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteArticle(\''+a.id+'\',\''+safeTitle.replace(/'/g,"\\'")+'\')">삭제</button></td></tr>';
  });
}

// QA #199 — status tab handler. Just flips the active filter and
// re-renders from the cached list (no extra network call).
function filterNewsByStatus(status){
  newsActiveStatus = status || 'all';
  var btns = document.querySelectorAll('#newsStatusFilters .tf');
  btns.forEach(function(b){
    if(b.getAttribute('data-status')===newsActiveStatus) b.classList.add('on');
    else b.classList.remove('on');
  });
  renderNews();
}

async function deleteArticle(id,title){
  if(!confirm('"'+title+'" 을 삭제하시겠습니까?'))return;
  try{await apiDelete('/articles/'+id);allArticles=allArticles.filter(function(a){return a.id!==id;});renderNews();alert('삭제되었습니다.');}catch(e){alert('삭제 실패');}
}

// QA #199 — entry points for the editor flow.
// `newNewsArticle()` is wired to the "+ 새 뉴스" button (replaces the
// raw go('newnews')) so we can wipe lingering edit state first.
// `editArticle(id)` opens the same editor pre-filled with the row's
// data so the existing form simply rebrands as "편집" and PUTs on save.

function newNewsArticle(){
  editingArticleId=null;
  _resetNewsEditorForm();
  _setNewsEditorMode(false, null);
  go('newnews');
}

async function editArticle(id){
  if(!id) return;
  try{
    // Always re-fetch the full row instead of trusting the list cache
    // — the list projection drops `content`/`gallery`/`credits` which
    // we absolutely need to populate the editor faithfully.
    var resp = await apiGet('/articles/'+id);
    var a = resp && resp.data;
    if(!a){ alert('뉴스를 찾을 수 없습니다.'); return; }
    editingArticleId = a.id;
    _resetNewsEditorForm();
    _hydrateNewsEditorForm(a);
    _setNewsEditorMode(true, a);
    go('newnews');
  } catch(e){
    alert('뉴스를 불러오지 못했습니다: '+(e && e.message ? e.message : ''));
  }
}

// Toggle the editor header / banner depending on new-vs-edit mode.
function _setNewsEditorMode(isEdit, article){
  var title = document.getElementById('newnewsModeTitle');
  if(title) title.textContent = isEdit ? '뉴스 편집' : '뉴스 작성';
  var banner = document.getElementById('newnewsEditBanner');
  var meta = document.getElementById('newnewsEditMeta');
  if(banner) banner.style.display = isEdit ? 'block' : 'none';
  if(meta && article){
    var bits = [];
    if(article.id) bits.push('ID '+article.id.substring(0,8));
    if(article.admin_edited_at) bits.push('마지막 편집 '+fmtDate(article.admin_edited_at));
    else if(article.updated_at) bits.push('업데이트 '+fmtDate(article.updated_at));
    meta.textContent = bits.join(' · ');
  } else if(meta){
    meta.textContent = '';
  }
}

// Clear the editor form back to a blank "new article" state.
function _resetNewsEditorForm(){
  var titleEl = document.getElementById('newnewsTitle');
  if(titleEl) titleEl.value = '';
  var thumb = document.getElementById('newnewsThumbUpload');
  if(thumb){
    // Restore the placeholder text + clear the file input.
    var fi = thumb.querySelector('input[type="file"]');
    if(fi) fi.value = '';
    thumb.classList.remove('has-thumb');
    thumb.innerHTML = '<input type="file" accept="image/*" style="display:none" onchange="previewNewsThumb(this)"><div class="pe-upload-text">클릭하여 썸네일 업로드</div>';
  }
  var thumbUrlEl = document.getElementById('newnewsThumbUrl');
  if(thumbUrlEl) thumbUrlEl.value = '';
  var blocks = document.getElementById('newsBlocks');
  if(blocks){
    // Leave a single empty text block so the editor doesn't open
    // completely barren the way it does on first render.
    blocks.innerHTML = '<div class="news-block" style="background:var(--surface);border:1px solid var(--border);padding:14px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="font-size:10px;font-weight:700;color:var(--text3)">블록 1 — 텍스트</span><button class="btn btn-sm btn-red" onclick="this.closest(\'.news-block\').remove()">삭제</button></div>'
      +'<textarea class="modal-ta" style="min-height:100px" placeholder="본문 텍스트를 입력하세요..."></textarea>'
      +'</div>';
  }
  newsBlockCount = 1;
  // Reset the status radio + hide the schedule input.
  var radios = document.getElementsByName('newnewsStatusOpt');
  if(radios && radios.length){
    for(var i=0;i<radios.length;i++) radios[i].checked = (radios[i].value === 'published');
  }
  var sched = document.getElementById('newnewsScheduledAt');
  if(sched) sched.value = '';
  toggleNewsScheduleInput();
}

// Hydrate the editor with an existing article's payload.
function _hydrateNewsEditorForm(a){
  var titleEl = document.getElementById('newnewsTitle');
  if(titleEl) titleEl.value = a.title || '';

  // Pre-fill the thumbnail URL + render a visible preview thumbnail
  // so the editor can SEE the existing image without re-uploading it.
  var thumb = document.getElementById('newnewsThumbUpload');
  var thumbUrlEl = document.getElementById('newnewsThumbUrl');
  if(thumbUrlEl) thumbUrlEl.value = a.thumbnail_url || '';
  if(thumb && a.thumbnail_url){
    thumb.innerHTML = '<input type="file" accept="image/*" style="display:none" onchange="previewNewsThumb(this)">'
      +'<img loading="lazy" src="'+esc(a.thumbnail_url)+'" style="max-width:200px;max-height:250px;object-fit:cover">'
      +'<div class="pe-upload-text" style="margin-top:8px">클릭하여 변경</div>';
    thumb.classList.add('has-thumb');
  }

  // Rehydrate content blocks. We persist them as a JSON-encoded array
  // in `content` (see saveNewsArticle below). Older articles may have
  // stored content as plain text or HTML, in which case we surface it
  // as a single text block so the editor still loads them.
  var blocks = document.getElementById('newsBlocks');
  if(blocks){
    blocks.innerHTML = '';
    newsBlockCount = 0;
    var parsed = null;
    try { parsed = a.content ? JSON.parse(a.content) : null; } catch(_){ parsed = null; }
    if(Array.isArray(parsed) && parsed.length){
      parsed.forEach(function(block){
        var type = block && block.type ? block.type : 'text';
        var content = block && block.content!==undefined ? block.content : '';
        _appendNewsBlock(type, content);
      });
    } else {
      // Legacy / non-block payload — show the raw text in a single
      // text block so it can be edited (and re-saved as blocks).
      _appendNewsBlock('text', a.content || '');
    }
  }

  // Status / schedule.
  var radios = document.getElementsByName('newnewsStatusOpt');
  var sched = document.getElementById('newnewsScheduledAt');
  var isScheduled = a._virtualStatus === 'scheduled'
    || (a.status === 'published' && a.scheduled_publish_at && new Date(a.scheduled_publish_at) > new Date());
  var pick = isScheduled ? 'scheduled' : (a.status === 'draft' ? 'draft' : 'published');
  if(radios){
    for(var i=0;i<radios.length;i++) radios[i].checked = (radios[i].value === pick);
  }
  if(sched && a.scheduled_publish_at){
    // <input type="datetime-local"> wants YYYY-MM-DDTHH:MM (local time).
    var d = new Date(a.scheduled_publish_at);
    var pad = function(n){return n<10?'0'+n:''+n;};
    sched.value = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  }
  toggleNewsScheduleInput();
}

// Append a block row to #newsBlocks pre-filled with `content`.
function _appendNewsBlock(type, content){
  newsBlockCount++;
  var area = document.getElementById('newsBlocks');
  if(!area) return;
  var div = document.createElement('div');
  div.className = 'news-block';
  div.style.cssText = 'background:var(--surface);border:1px solid var(--border);padding:14px';
  var label = ({text:'텍스트',image:'이미지',quote:'인용구',video:'영상'})[type] || '기타';
  var inner = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="font-size:10px;font-weight:700;color:var(--text3)">블록 '+newsBlockCount+' — '+label+'</span><button class="btn btn-sm btn-red" onclick="this.closest(\'.news-block\').remove()">삭제</button></div>';
  // Use a textContent-style fallback for the input value so any
  // single/double quotes in content don't break the attribute.
  if(type==='text'){
    var ta = document.createElement('textarea');
    ta.className='modal-ta';
    ta.style.cssText='min-height:100px';
    ta.placeholder='본문 텍스트를 입력하세요...';
    ta.value = content || '';
    div.innerHTML = inner;
    div.appendChild(ta);
  } else if(type==='image'){
    inner += '<div class="pe-upload" onclick="this.querySelector(\'input\').click()" style="padding:16px"><input type="file" accept="image/*" style="display:none"><div class="pe-upload-text">클릭하여 이미지 업로드</div></div>';
    var capInput = document.createElement('input');
    capInput.className='pe-input';
    capInput.placeholder='이미지 캡션 (선택)';
    capInput.style.marginTop='8px';
    capInput.value = content || '';
    div.innerHTML = inner;
    div.appendChild(capInput);
  } else if(type==='quote'){
    var qta = document.createElement('textarea');
    qta.className='modal-ta';
    qta.style.cssText='min-height:60px;font-style:italic';
    qta.placeholder='인용구 내용...';
    qta.value = content || '';
    div.innerHTML = inner;
    div.appendChild(qta);
    var srcInput = document.createElement('input');
    srcInput.className='pe-input';
    srcInput.placeholder='출처 (선택)';
    srcInput.style.marginTop='8px';
    div.appendChild(srcInput);
  } else if(type==='video'){
    var vInput = document.createElement('input');
    vInput.className='pe-input';
    vInput.placeholder='YouTube URL (예: https://youtube.com/watch?v=...)';
    vInput.value = content || '';
    div.innerHTML = inner;
    div.appendChild(vInput);
  } else {
    var oInput = document.createElement('input');
    oInput.className='pe-input';
    oInput.value = content || '';
    div.innerHTML = inner;
    div.appendChild(oInput);
  }
  area.appendChild(div);
}

// Show/hide the schedule input depending on the chosen status radio.
function toggleNewsScheduleInput(){
  var wrap = document.getElementById('newnewsScheduleWrap');
  if(!wrap) return;
  var radios = document.getElementsByName('newnewsStatusOpt');
  var picked = 'published';
  if(radios){
    for(var i=0;i<radios.length;i++){ if(radios[i].checked){ picked = radios[i].value; break; } }
  }
  wrap.style.display = (picked === 'scheduled') ? 'block' : 'none';
}

// Thumbnail upload preview — keeps the hidden URL field in sync.
function previewNewsThumb(input){
  if(!input || !input.files || !input.files[0]) return;
  var reader = new FileReader();
  reader.onload = function(e){
    var thumb = document.getElementById('newnewsThumbUpload');
    if(thumb){
      thumb.innerHTML = '<input type="file" accept="image/*" style="display:none" onchange="previewNewsThumb(this)">'
        +'<img loading="lazy" src="'+e.target.result+'" style="max-width:200px;max-height:250px;object-fit:cover">'
        +'<div class="pe-upload-text" style="margin-top:8px">클릭하여 변경</div>';
      thumb.classList.add('has-thumb');
    }
    // NOTE: in production this would upload to S3 + write the public
    // URL into newnewsThumbUrl. For now we keep the existing
    // base64 preview behavior so the editor at least shows the new
    // image; the hidden URL field is left untouched (so an edit that
    // re-uploads but never has the URL written falls back to the
    // existing thumbnail_url instead of clobbering it with raw base64).
  };
  reader.readAsDataURL(input.files[0]);
}

// POST EDITOR FUNCTIONS
function selectRadio(input){
  document.querySelectorAll('.pe-radio').forEach(r=>r.classList.remove('sel'));
  input.parentElement.classList.add('sel');
}

function previewThumb(input){
  if(input.files&&input.files[0]){
    var reader=new FileReader();
    reader.onload=function(e){
      document.getElementById('thumbPreview').innerHTML='<img loading="lazy" src="'+e.target.result+'" style="max-width:200px;max-height:250px;object-fit:cover"><div class="pe-upload-text" style="margin-top:8px">클릭하여 변경</div>';
      // Mark the wrapping .pe-upload as having a thumb so the X button
      // becomes visible (the X is hidden until is-current = true).
      var box=document.getElementById('thumbUploadBox');
      if(box) box.classList.add('has-thumb');
    };
    reader.readAsDataURL(input.files[0]);
  }
}

// QA — wipe the thumbnail preview + clear the file input. After this:
//   - savePost will skip the "upload thumbInput.files[0]" path
//   - finalThumb falls back to ★ gallery pick → first gallery image
//   - sets data-thumb-cleared on the box so editPost knows the admin
//     intentionally removed the saved cover (without this flag, the
//     code would think "no new file → keep existing URL").
function clearThumbnailInput(){
  var input=document.getElementById('thumbInput');
  if(input) input.value='';
  var prev=document.getElementById('thumbPreview');
  if(prev){
    prev.innerHTML='<div class="pe-upload-icon">📷</div>'
      + '<div class="pe-upload-text">클릭하여 이미지를 업로드하세요</div>'
      + '<div class="pe-upload-hint">JPG, PNG · 권장 1080×1350px</div>';
  }
  var box=document.getElementById('thumbUploadBox');
  if(box){
    box.classList.remove('has-thumb');
    box.setAttribute('data-thumb-cleared','1');
    // Wipe the stashed existing URL too — admin explicitly removed it.
    box.dataset.existingUrl = '';
  }
}

var galleryCount=0;
var galleryImages=[];
// galleryThumbNum → ★ row picked as the homepage CARD THUMBNAIL
//                   (small image, persisted as `thumbnail`).
// Defaults to null; the first uploaded image takes the role until
// the admin picks something else. Stored as data-img-num so
// reordering doesn't drift the selection.
// (galleryCoverNum kept for back-compat with any stale code paths;
//  no UI surfaces it any more — cover_image comes from the top
//  단독 "커버 이미지" upload section, not gallery.)
var galleryThumbNum=null;
var galleryCoverNum=null;

// ── Editorial gallery upload constants (admin-side validation) ──────────────
// QA #94 — bumped from 500KB to 2MB to match the editorial-quality budget
// we settled on for submission look images (QA #90). 2MB lets a properly
// exported 2000px JPEG at ~85% quality through; anything bigger is almost
// certainly an unprocessed export and gets blocked with a clear message.
var GALLERY_MAX_BYTES = 2 * 1024 * 1024;        // 2MB per image
// QA #95 — aspect-ratio constraint at upload time was removed. The 4:5
// shape now lives purely in the FRONTEND display layer (.ed-gallery-item
// uses aspect-ratio:4/5 + object-fit:contain) so any source ratio uploads
// fine and is letterboxed into the 4:5 box without cropping.

function _galleryFeedback(msg, kind){
  var el=document.getElementById('galleryUploadFeedback');
  if(!el) return;
  el.textContent=msg||'';
  el.style.color = (kind==='error') ? '#c62828'
                : (kind==='warn')  ? '#b86b00'
                : (kind==='ok')    ? '#2e7d32'
                :                    'var(--text3)';
}

function _validateGalleryFile(file){
  // Returns { ok: bool, blocked: bool, message: str }
  if(!file) return {ok:false, blocked:true, message:'파일을 읽을 수 없습니다.'};
  if(file.size > GALLERY_MAX_BYTES){
    var kb = Math.round(file.size/1024);
    var mb = (file.size/1024/1024).toFixed(2);
    return {ok:false, blocked:true,
      message:'"'+file.name+'" 용량 '+mb+'MB — 1장당 최대 2MB를 초과해 업로드 차단됨. 압축하거나 해상도를 줄여주세요.'};
  }
  return {ok:true, blocked:false, message:''};
}

// QA #85 — Rewritten with clearer per-file state isolation. Each file
// validates and reads INDEPENDENTLY: a single blocked file no longer
// pollutes the success path of valid files in the same or subsequent
// batches. Logic flow:
//   1. Reset feedback area (clear stale messages from previous batches).
//   2. Snapshot input.files into a local array, then clear input.value
//      IMMEDIATELY so the user can re-select the same file later.
//   3. For each file: validate size → if blocked, increment counter and
//      continue; if valid, read async then insert into DOM.
//   4. Summarize at the end of validation pass AND each async completion.
function _summarizeGalleryBatch(added, blocked){
  // QA #95 — removed the ratio-warn arm. Aspect ratio is no longer
  // evaluated at upload, so the only signal we surface here is added vs
  // blocked-by-size.
  var msgs=[];
  if(added>0)   msgs.push(added+'장 추가됨');
  if(blocked>0) msgs.push(blocked+'장 차단됨 (2MB 초과)');
  var kind = (blocked>0 && added===0) ? 'error'
           : (added>0  && blocked===0) ? 'ok'
           : (blocked>0)                ? 'warn'
           :                              'info';
  _galleryFeedback(msgs.join(' · '), kind);
}

function addGallery(input){
  if(!input || !input.files || !input.files.length) return;
  var grid=document.getElementById('galleryGrid');
  var addBtn=grid.querySelector('.pe-gallery-add');
  if(!grid || !addBtn){
    _galleryFeedback('갤러리 영역을 찾을 수 없습니다. 페이지를 새로고침해주세요.', 'error');
    return;
  }

  // Reset feedback so a stale error from a previous batch doesn't linger.
  _galleryFeedback('', 'info');

  // Snapshot files + clear input.value IMMEDIATELY so re-selecting the
  // same file fires onchange again. (Browsers suppress onchange when the
  // selected files list hasn't changed since the last assignment.)
  var files = Array.prototype.slice.call(input.files);
  input.value = '';

  // Per-batch counters — independent of any other batch.
  var added = 0;
  var blocked = 0;

  files.forEach(function(file){
    // STEP 1 — synchronous validation (size only). QA #95 confirmed: NO
    // aspect-ratio gate at this stage. The frontend layer (.ed-gallery-item)
    // contains any ratio into a 4:5 box at display time.
    var v = _validateGalleryFile(file);
    if(!v.ok){
      blocked++;
      _summarizeGalleryBatch(added, blocked);
      // Skip this file. We do NOT abort the loop — other files in the
      // same batch may still be valid and must be uploaded normally.
      return;
    }

    // STEP 2 — async file read. Closure here is naturally per-file
    // (forEach gives a fresh function scope), no IIFE needed.
    var num = ++galleryCount;
    var reader = new FileReader();

    reader.onerror = function(){
      // Read failed — typically a corrupt file or revoked permission.
      // Roll back the galleryCount we reserved.
      galleryCount--;
      blocked++;
      _galleryFeedback('"'+file.name+'" 파일을 읽을 수 없습니다.', 'error');
      _summarizeGalleryBatch(added, blocked);
    };

    reader.onload = function(e){
      var src = e.target.result;
      // Add to the data array
      galleryImages.push({num:num, src:src, credits:'', file:file, isUrl:false});
      // Add to the DOM
      var div = document.createElement('div');
      div.className = 'pe-gallery-item';
      div.setAttribute('data-img-num', num);
      div.setAttribute('draggable', 'true');
      // QA #94 — explicit draggable="false" on the inner <img>. Without it
      // some browsers (notably Safari) start a NATIVE image-drag for the
      // file URL when the user grabs the picture, which beats our HTML5
      // DnD reorder handler to it and the row never moves. CSS
      // pointer-events:none isn't always enough on its own.
      div.innerHTML = '<span class="pe-gallery-grip">⋮⋮</span>'
        + '<img loading="lazy" draggable="false" src="'+src+'">'
        // QA #182 — × no longer physically removes the row. It toggles
        // an "excluded from publish" flag; click again (the button
        // swaps to ↺) to re-include. Tooltip wording reflects that so
        // the editor isn't surprised by the card staying on screen.
        + '<button class="pe-gallery-del" onclick="removeGalleryImg('+num+')" title="이 이미지를 발행에서 제외 (실제 삭제는 아님)">×</button>'
        + '<button class="pe-gallery-thumb" onclick="event.stopPropagation();setGalleryThumb('+num+')" title="썸네일로 지정 (홈 카드 작은 이미지)" aria-label="썸네일로 지정">★</button>'
        + '<span class="pe-tag-thumb">THUMB</span>'
        + '<span class="pe-gallery-num">#'+num+'</span>';
      grid.insertBefore(div, addBtn);
      _wireGalleryItemDrag(div);
      updateImgCredits();
      added++;
      _summarizeGalleryBatch(added, blocked);
      // First image to land becomes the default ★ THUMB until the
      // admin picks something else. Saves an extra click for the
      // common case of "use the first photo for the home card".
      if(galleryThumbNum===null){ galleryThumbNum = num; _renderGalleryCoverState(); }
    };

    try {
      reader.readAsDataURL(file);
    } catch(err){
      galleryCount--;
      blocked++;
      _galleryFeedback('"'+file.name+'" 파일 처리 중 오류: '+(err && err.message || err), 'error');
      _summarizeGalleryBatch(added, blocked);
    }
  });

  // If every file in the batch was blocked synchronously, the loop has
  // already summarized. Otherwise the async onload paths will summarize
  // as their reads complete.
}

// QA #182 — soft delete. Originally this physically removed the row from
// DOM + galleryImages. The QA feedback (도메니코, 2026-05-27): "after
// approval, clicking × on an editorial image should not actually delete
// the image — it should only mark it as 'not for upload'". Rationale: the
// admin may want to re-include the image later, and immediate deletion
// throws away the credit row + ordering metadata. The replacement
// behaviour:
//   • × on an active image → mark `isExcluded = true`, dim the card,
//     swap the × button into a ↺ "복원" button.
//   • ↺ on an excluded image → flip `isExcluded` back to false.
//   • savePost filters out `isExcluded` rows before uploading, so the
//     published editorial only contains the kept images. Excluded files
//     that were never uploaded simply never make the network trip.
// The function name is kept (`removeGalleryImg`) so all existing inline
// onclick="removeGalleryImg(...)" handlers keep working without an HTML
// rewrite — the only change is the implementation semantics.
function removeGalleryImg(num){
  var hit = galleryImages.find(function(g){return g.num===num;});
  if(!hit) return;
  hit.isExcluded = !hit.isExcluded;

  // Apply the dim/strike-through state to the card and swap the button
  // label accordingly. We DO NOT removeChild — the card stays so it can
  // be re-included with one click.
  var el=document.querySelector('.pe-gallery-item[data-img-num="'+num+'"]');
  if(el){
    el.classList.toggle('is-excluded', !!hit.isExcluded);
    var btn = el.querySelector('.pe-gallery-del');
    if(btn){
      if(hit.isExcluded){
        btn.innerHTML = '↺';
        btn.title = '발행 제외 해제 (다시 포함)';
      }else{
        btn.innerHTML = '×';
        btn.title = '이 이미지를 발행에서 제외 (실제 삭제는 아님)';
      }
    }
  }

  // If the THUMB pick is now excluded, fall back to the first STILL-
  // INCLUDED image. (We don't auto-promote excluded items back when
  // their fallback is re-included — the admin can re-pick manually.)
  if(hit.isExcluded && galleryThumbNum === num){
    var firstKept = galleryImages.find(function(g){return !g.isExcluded;});
    galleryThumbNum = firstKept ? firstKept.num : null;
    _renderGalleryCoverState();
  }
  updateImgCredits();
}

// Mark the given gallery image (by data-img-num) as the homepage
// card THUMBNAIL. Saved into the `thumbnail` field on save.
function setGalleryThumb(num){
  galleryThumbNum = num;
  _renderGalleryCoverState();
}
// Stub kept for back-compat with any stale render path that might
// still wire up a ◆ button; modern paths emit only ★ so this is
// effectively dead code, but keeping it avoids ReferenceError if a
// cached HTML chunk somewhere still calls it.
function setGalleryCover(num){ /* no-op — ◆ removed from gallery */ }

function _renderGalleryCoverState(){
  // Single render pass updates the ★ thumb class on every row so
  // the visual outline + label always reflects current state.
  document.querySelectorAll('#galleryGrid .pe-gallery-item').forEach(function(el){
    var n = parseInt(el.getAttribute('data-img-num'),10);
    el.classList.toggle('is-thumb', n === galleryThumbNum);
    el.classList.remove('is-cover'); // ◆ no longer in use
  });
}

// ── Drag & drop reordering ────────────────────────────────────────────────
// Native HTML5 drag — works with the existing data-img-num attribute. The
// galleryImages array is re-sorted to match the visual DOM order on drop,
// so submitForm() reads the correct sequence when persisting the post.
var _gDragSrc=null;
function _wireGalleryItemDrag(el){
  el.addEventListener('dragstart', function(e){
    _gDragSrc = el;
    el.classList.add('dragging');
    try { e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', el.getAttribute('data-img-num')||''); } catch(_){}
  });
  el.addEventListener('dragend', function(){
    el.classList.remove('dragging');
    _gDragSrc=null;
    document.querySelectorAll('.pe-gallery-item.drag-over').forEach(function(n){n.classList.remove('drag-over');});
    _syncGalleryOrderFromDOM();
  });
  el.addEventListener('dragover', function(e){
    if(!_gDragSrc || _gDragSrc===el) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect='move'; } catch(_){}
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', function(){
    el.classList.remove('drag-over');
  });
  el.addEventListener('drop', function(e){
    e.preventDefault();
    el.classList.remove('drag-over');
    if(!_gDragSrc || _gDragSrc===el) return;
    var grid=document.getElementById('galleryGrid');
    var addBtn=grid.querySelector('.pe-gallery-add');
    // Decide whether to insert before or after target based on cursor position
    var rect=el.getBoundingClientRect();
    var insertAfter = (e.clientX - rect.left) > rect.width/2;
    if(insertAfter && el.nextSibling && el.nextSibling!==addBtn){
      grid.insertBefore(_gDragSrc, el.nextSibling);
    } else if(insertAfter){
      grid.insertBefore(_gDragSrc, addBtn);
    } else {
      grid.insertBefore(_gDragSrc, el);
    }
  });
}
function _syncGalleryOrderFromDOM(){
  var items=document.querySelectorAll('#galleryGrid .pe-gallery-item');
  var nextOrder=[];
  items.forEach(function(node){
    var n=parseInt(node.getAttribute('data-img-num'),10);
    var match=galleryImages.find(function(g){return g.num===n;});
    if(match) nextOrder.push(match);
  });
  if(nextOrder.length===galleryImages.length){
    galleryImages=nextOrder;
    updateImgCredits();
  }
}

function updateImgCredits(){
  var area=document.getElementById('imgCreditsArea');
  if(!area) return;
  area.innerHTML='';
  if(galleryImages.length===0){
    area.innerHTML='<div style="font-size:11px;color:var(--text3);padding:8px 0">위에서 화보 이미지를 추가하면 각 이미지마다 착장 크레딧을 입력할 수 있습니다.</div>';
    return;
  }
  galleryImages.forEach(function(img,i){
    var div=document.createElement('div');
    // QA #182 — dim the row for soft-deleted images so the admin sees
    // at a glance which credits won't appear in the published editorial.
    var excluded = !!img.isExcluded;
    div.style.cssText='display:flex;gap:8px;margin-bottom:8px;align-items:flex-start'
      + (excluded ? ';opacity:.4' : '');
    var excludedTag = excluded
      ? '<span style="display:inline-block;font-size:9px;font-weight:800;letter-spacing:.08em;background:#c62828;color:#fff;padding:2px 6px;border-radius:2px;margin-left:6px">발행 제외</span>'
      : '';
    div.innerHTML='<div style="flex-shrink:0;width:60px;height:75px;border:1px solid var(--border);overflow:hidden"><img loading="lazy" src="'+img.src+'" style="width:100%;height:100%;object-fit:cover'+(excluded?';filter:grayscale(1)':'')+'"></div>'
      +'<div style="flex:1">'
      +'<div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:4px">이미지 #'+img.num+' 착장 크레딧'+excludedTag+'</div>'
      +'<input class="pe-input" placeholder="@brand1 Jacket, @brand2 Pants, @brand3 Shoes..." style="padding:7px 10px;font-size:11px" value="'+(img.credits||'')+'" oninput="galleryImages['+i+'].credits=this.value">'
      +'<div style="font-size:9px;color:var(--text3);margin-top:3px">형식: @인스타그램 아이템명 (쉼표로 구분)</div>'
      +'</div>';
    area.appendChild(div);
  });
}

// ── Editorial credit roles ──────────────────────────────────────────────────
// Extended list driven by QA #82 — covers assistants and the long tail of
// production roles. The trailing __custom__ option swaps the select for a
// free-text input so editors can enter any role not in the list.
var EDITORIAL_CREDIT_ROLES = [
  'Photographer','Photographer assist',
  'Stylist','Stylist assist',
  'Make Up','Make Up assist',
  'Hair','Hair assist',
  'Set Design','Set Design assist',
  'Producer','Production assist',
  'Creative Director','Art Director','Casting Director',
  'Model','Starring','Talent Agency',
  'Video Director','Video assist','DOP / Cinematographer',
  'Editor','Colorist','Retouching',
  'Sound','Music','VFX',
  'Location','Special Thanks'
];
// QA #96 — credit roles are now MULTI-select. Each credit row owns an
// array of role strings (e.g. ['Hair','Make Up'] for the same person)
// instead of one role per row. The data layer stores it as
// `credits[i].roles = []` and the UI is a chip picker with checkboxes
// for the predefined roles plus a free-text input for custom roles.

// Read all role strings selected on a credit row. Predefined roles are
// pulled from checked checkboxes; custom roles come from the chip list
// (rendered via _renderRoleChips), tagged data-custom="1" to distinguish
// them from checkbox-driven chips.
function _readCreditRoles(row){
  if(!row) return [];
  var trigger=row.querySelector('.pe-role-trigger');
  if(!trigger) return [];
  var seen={};
  var out=[];
  trigger.querySelectorAll('.pe-role-chip').forEach(function(chip){
    var v=chip.getAttribute('data-role')||'';
    v = v.trim();
    if(v && !seen[v]){ seen[v]=1; out.push(v); }
  });
  return out;
}

// Backward-compat helper for any caller still expecting a single role
// string. Returns the first role joined to the rest by ', ' (e.g.
// 'Hair, Make Up') so display contexts always get something readable.
function _readCreditRole(row){
  return _readCreditRoles(row).join(', ');
}

function _renderRoleChips(trigger){
  if(!trigger) return;
  // Reads the data-roles JSON attribute (canonical store) and re-renders
  // chips + ticks predefined checkboxes accordingly.
  var rolesRaw=trigger.getAttribute('data-roles')||'[]';
  var roles=[];
  try { roles=JSON.parse(rolesRaw); } catch(_){ roles=[]; }
  if(!Array.isArray(roles)) roles=[];
  // Render chips
  var chipsHtml='';
  if(roles.length===0){
    chipsHtml='<span class="pe-role-placeholder">역할 선택…</span>';
  } else {
    chipsHtml=roles.map(function(r){
      return '<span class="pe-role-chip" data-role="'+esc(r)+'">'+esc(r)
        +'<button type="button" class="pe-chip-x" onclick="event.stopPropagation();_removeCreditRoleChip(this)" aria-label="역할 삭제">×</button></span>';
    }).join('');
  }
  trigger.innerHTML=chipsHtml;
  // Sync checkboxes inside the menu with the chip set
  var menu=trigger.parentElement.querySelector('.pe-role-menu');
  if(menu){
    menu.querySelectorAll('input[type="checkbox"]').forEach(function(cb){
      cb.checked = roles.indexOf(cb.value) >= 0;
    });
  }
}

function _setCreditRoles(trigger, roles){
  // Dedupe + drop empties before persisting.
  var seen={};
  var clean=[];
  (roles||[]).forEach(function(r){
    r=(r||'').trim();
    if(r && !seen[r]){ seen[r]=1; clean.push(r); }
  });
  trigger.setAttribute('data-roles', JSON.stringify(clean));
  _renderRoleChips(trigger);
}

function _toggleRoleMenu(trigger, force){
  var menu=trigger.parentElement.querySelector('.pe-role-menu');
  if(!menu) return;
  var willOpen = (typeof force==='boolean') ? force : !menu.classList.contains('open');
  // Close any other open menus first (single-open invariant).
  document.querySelectorAll('.pe-role-menu.open').forEach(function(m){
    if(m!==menu){ m.classList.remove('open'); }
  });
  document.querySelectorAll('.pe-role-trigger.open').forEach(function(t){
    if(t!==trigger){ t.classList.remove('open'); }
  });
  menu.classList.toggle('open', willOpen);
  trigger.classList.toggle('open', willOpen);
}

function _onCreditRoleCheckbox(cb){
  var wrap=cb.closest('.pe-credit-role-multi');
  if(!wrap) return;
  var trigger=wrap.querySelector('.pe-role-trigger');
  var current=[];
  try { current=JSON.parse(trigger.getAttribute('data-roles')||'[]'); } catch(_){}
  if(cb.checked){
    if(current.indexOf(cb.value)<0) current.push(cb.value);
  } else {
    current=current.filter(function(r){return r!==cb.value;});
  }
  _setCreditRoles(trigger, current);
}

function _onCreditRoleCustomKey(input, e){
  if(e.key!=='Enter') return;
  e.preventDefault();
  var wrap=input.closest('.pe-credit-role-multi');
  if(!wrap) return;
  var trigger=wrap.querySelector('.pe-role-trigger');
  var v=(input.value||'').trim();
  if(!v) return;
  var current=[];
  try { current=JSON.parse(trigger.getAttribute('data-roles')||'[]'); } catch(_){}
  current.push(v);
  _setCreditRoles(trigger, current);
  input.value='';
}

function _removeCreditRoleChip(btn){
  var chip=btn.closest('.pe-role-chip');
  if(!chip) return;
  var trigger=chip.closest('.pe-role-trigger');
  if(!trigger) return;
  var role=chip.getAttribute('data-role')||'';
  var current=[];
  try { current=JSON.parse(trigger.getAttribute('data-roles')||'[]'); } catch(_){}
  current=current.filter(function(r){return r!==role;});
  _setCreditRoles(trigger, current);
}

// Close any open role menu when clicking outside the picker. Wired once.
document.addEventListener('click', function(e){
  if(e.target.closest('.pe-credit-role-multi')) return;
  document.querySelectorAll('.pe-role-menu.open').forEach(function(m){m.classList.remove('open');});
  document.querySelectorAll('.pe-role-trigger.open').forEach(function(t){t.classList.remove('open');});
});

// Build the inner HTML of a credit row. `roles` may be a single role
// string (legacy) or an array of role strings (new). Both render the
// same chip-picker UI; legacy strings are wrapped to [string].
function _buildCreditRowInner(roles, name, ig){
  if(typeof roles === 'string') roles = roles ? [roles] : [];
  if(!Array.isArray(roles)) roles = [];
  name = name || '';
  ig   = ig   || '';
  // Build the predefined-role checkbox list. Custom roles (anything not
  // in EDITORIAL_CREDIT_ROLES) skip the checkbox layer and live purely
  // as chips.
  var checkboxes = EDITORIAL_CREDIT_ROLES.map(function(r){
    return '<label><input type="checkbox" value="'+esc(r)+'" onchange="_onCreditRoleCheckbox(this)">'+esc(r)+'</label>';
  }).join('');
  // QA — escape DOUBLE QUOTES in the JSON because data-roles uses
  // double-quote delimiters in the attribute. The shared esc() helper
  // only handles &, <, > (textContent → innerHTML), so JSON like
  // ["Photographer"] would land in the DOM as
  //   data-roles="["Photographer"]"  ← attribute closes at the first
  //   inner quote and getAttribute('data-roles') comes back as just `[`.
  // JSON.parse on that fails, the role chips render empty, and the
  // editor looks like the saved roles were lost. Replacing " with
  // &quot; keeps the attribute value intact end-to-end.
  var rolesJson = JSON.stringify(roles).replace(/"/g, '&quot;');
  // QA #97 — grip + checkbox at the start of every row. The grip is
  // visually distinct so admins know it's the drag handle (the whole
  // row is draggable, but the grip is the affordance). The checkbox
  // drives the bulk-delete toolbar via _onCreditCheckChange.
  return '<span class="pe-credit-grip" aria-hidden="true">⋮⋮</span>'
    +'<input type="checkbox" class="pe-credit-check" onchange="_onCreditCheckChange()">'
    +'<div class="pe-credit-role-multi">'
    +   '<div class="pe-role-trigger" data-roles="'+rolesJson+'" onclick="_toggleRoleMenu(this)" tabindex="0"></div>'
    +   '<div class="pe-role-menu" role="listbox">'
    +     checkboxes
    +     '<div class="pe-role-menu-divider"></div>'
    +     '<div class="pe-role-custom-wrap"><input type="text" placeholder="+ 직접 입력 후 Enter" onkeydown="_onCreditRoleCustomKey(this,event)"></div>'
    +   '</div>'
    + '</div>'
    +'<input class="pe-input pe-credit-name" placeholder="이름" value="'+esc(name)+'">'
    +'<input class="pe-input pe-credit-ig" placeholder="@instagram" value="'+esc(ig)+'">'
    +'<button class="btn btn-sm btn-red" onclick="_removeCreditRow(this)">삭제</button>';
}

// areaId — defaults to 'creditsArea' (editorial post editor). Pass
// 'filmCreditsArea' to drive the film modal's credits area. Toolbar
// element IDs are derived from areaId by replacing the 'Area' suffix:
//   creditsArea     → creditsCheckAll / creditsBulkDel / creditsSelCount
//   filmCreditsArea → filmCreditsCheckAll / filmCreditsBulkDel / filmCreditsSelCount
// Keeps both modals on the same code path — fewer copies to maintain.
function _creditsToolbarIds(areaId){
  var prefix = (areaId || 'creditsArea').replace(/Area$/, '');
  return {
    checkAll: prefix + 'CheckAll',
    bulkDel:  prefix + 'BulkDel',
    selCount: prefix + 'SelCount',
  };
}

function addCredit(areaId){
  areaId = areaId || 'creditsArea';
  var area=document.getElementById(areaId);
  if(!area) return;
  var row=document.createElement('div');
  row.className='pe-credit-row';
  row.setAttribute('draggable','true');
  row.innerHTML=_buildCreditRowInner([], '', '');
  area.appendChild(row);
  _wireCreditRowDrag(row, areaId);
  // Render chips for the freshly-attached trigger so the placeholder
  // shows ('역할 선택…') instead of an empty box.
  var trig=row.querySelector('.pe-role-trigger');
  if(trig) _renderRoleChips(trig);
  _onCreditCheckChange(areaId);
}

// ── QA #97 — Drag & drop reorder + bulk select on credit rows ──────────
// Mirror of the gallery-row pattern (_wireGalleryItemDrag): native HTML5
// DnD with a grip cell that acts as the visual affordance. DOM order IS
// the data order — savePost reads rows top-to-bottom, so reordering
// requires no extra state plumbing.
var _creditDragSrc=null;
function _wireCreditRowDrag(row, areaId){
  areaId = areaId || 'creditsArea';
  row.addEventListener('dragstart', function(e){
    _creditDragSrc=row;
    row.classList.add('dragging');
    try { e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', ''); } catch(_){}
  });
  row.addEventListener('dragend', function(){
    row.classList.remove('dragging');
    _creditDragSrc=null;
    document.querySelectorAll('#'+areaId+' .pe-credit-row.drag-over').forEach(function(n){n.classList.remove('drag-over');});
  });
  row.addEventListener('dragover', function(e){
    if(!_creditDragSrc || _creditDragSrc===row) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect='move'; } catch(_){}
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', function(){
    row.classList.remove('drag-over');
  });
  row.addEventListener('drop', function(e){
    e.preventDefault();
    row.classList.remove('drag-over');
    if(!_creditDragSrc || _creditDragSrc===row) return;
    var area=document.getElementById(areaId);
    if(!area) return;
    // Insert above target if cursor is in upper half, else below — feels
    // closer to the cursor than always-before-or-always-after.
    var rect=row.getBoundingClientRect();
    var insertAfter=(e.clientY-rect.top) > rect.height/2;
    if(insertAfter){
      if(row.nextSibling) area.insertBefore(_creditDragSrc, row.nextSibling);
      else area.appendChild(_creditDragSrc);
    } else {
      area.insertBefore(_creditDragSrc, row);
    }
  });
}

function _removeCreditRow(btn){
  var row=btn.closest('.pe-credit-row');
  // Auto-detect which area this row belongs to so removing a row from
  // the film modal doesn't touch the editorial toolbar (or vice versa).
  var area=row && row.closest('[id$="creditsArea"], #creditsArea');
  var areaId=area ? area.id : 'creditsArea';
  if(row) row.remove();
  _onCreditCheckChange(areaId);
}

// Bulk select state — driven entirely off DOM checkboxes so there's no
// shadow array to keep in sync. The toolbar reads counts on every change.
function _onCreditCheckChange(areaId){
  areaId = areaId || 'creditsArea';
  var ids = _creditsToolbarIds(areaId);
  var rows=document.querySelectorAll('#'+areaId+' .pe-credit-row');
  var checks=document.querySelectorAll('#'+areaId+' .pe-credit-check');
  var selected=0;
  checks.forEach(function(c){ if(c.checked) selected++; });
  var btn=document.getElementById(ids.bulkDel);
  var countEl=document.getElementById(ids.selCount);
  var allCb=document.getElementById(ids.checkAll);
  if(btn) btn.disabled = (selected===0);
  if(countEl) countEl.textContent = '('+selected+')';
  if(allCb){
    allCb.checked = (rows.length>0 && selected===rows.length);
    // Indeterminate state when partially selected
    allCb.indeterminate = (selected>0 && selected<rows.length);
  }
}

function _onCreditCheckAll(masterCb, areaId){
  areaId = areaId || 'creditsArea';
  var checks=document.querySelectorAll('#'+areaId+' .pe-credit-check');
  checks.forEach(function(c){ c.checked = masterCb.checked; });
  _onCreditCheckChange(areaId);
}

function bulkDeleteCredits(areaId){
  areaId = areaId || 'creditsArea';
  var checks=document.querySelectorAll('#'+areaId+' .pe-credit-check');
  var selectedRows=[];
  checks.forEach(function(c){
    if(c.checked){
      var row=c.closest('.pe-credit-row');
      if(row) selectedRows.push(row);
    }
  });
  if(selectedRows.length===0) return;
  if(!confirm(selectedRows.length+'개의 크레딧을 삭제하시겠습니까?')) return;
  selectedRows.forEach(function(r){ r.remove(); });
  _onCreditCheckChange(areaId);
}

function addBrand(){
  var area=document.getElementById('brandsArea');
  var row=document.createElement('div');
  row.className='pe-brand-row';
  row.innerHTML='<input class="pe-input pe-brand-name" placeholder="브랜드명 (예: Balenciaga)"><input class="pe-input pe-brand-ig" placeholder="@instagram"><button class="btn btn-sm btn-red" onclick="this.parentElement.remove()">삭제</button>';
  area.appendChild(row);
}

function toggleSchedule(){
  var pub=document.getElementById('postPublish');
  var sched=document.getElementById('postSchedule');
  var area=document.getElementById('scheduleArea');
  if(sched.checked){
    pub.checked=false;
    area.style.display='block';
    // Set default to tomorrow 9:00 AM
    var tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
    document.getElementById('scheduleDate').value=tomorrow.toISOString().split('T')[0];
  } else {
    area.style.display='none';
  }
}

// ── Manual publish-date controls ─────────────────────────────────────────────
// The 발행 날짜 picker overrides the auto "now" timestamp so admin can
// backdate or future-date a post's display timestamp without affecting
// the schedule-publish behaviour. Empty inputs → savePost falls back to
// new Date() at save time.
function _setPublishDateNow(){
  var d = new Date();
  var pad = function(n){ return n<10 ? '0'+n : ''+n; };
  var dateEl = document.getElementById('publishDate');
  var timeEl = document.getElementById('publishTime');
  if(dateEl) dateEl.value = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  if(timeEl) timeEl.value = pad(d.getHours())+':'+pad(d.getMinutes());
}
function _clearPublishDate(){
  var dateEl = document.getElementById('publishDate');
  var timeEl = document.getElementById('publishTime');
  if(dateEl) dateEl.value = '';
  if(timeEl) timeEl.value = '';
}
// Compose the saved ISO timestamp from the two pickers. Returns null
// when the date input is empty so savePost can pick its own fallback.
// Time defaults to 09:00 when only the date is filled — keeps the
// resulting timestamp visible in the user's local day.
function _readPublishDate(){
  var dateEl = document.getElementById('publishDate');
  var timeEl = document.getElementById('publishTime');
  var dv = (dateEl && dateEl.value || '').trim();
  if(!dv) return null;
  var tv = (timeEl && timeEl.value || '').trim() || '09:00';
  var iso = dv + 'T' + tv + ':00';
  var parsed = new Date(iso);
  if(isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

// ======== DASHBOARD STATS ========
// Render a simple SVG line+area chart for daily counts. `series` is [{date,count}, ...].
function renderTrendChart(svg, series){
  if(!svg||!Array.isArray(series)||!series.length)return;
  var w=600, h=100, pad=4;
  var max=Math.max(1, series.reduce(function(m,d){return Math.max(m,d.count||0);},0));
  var step=(w-pad*2)/(series.length-1||1);
  var pts=series.map(function(d,i){
    var x=pad+i*step;
    var y=h-pad-((d.count||0)/max)*(h-pad*2);
    return [x,y];
  });
  var lineD='M '+pts.map(function(p){return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' L ');
  var areaD=lineD+' L '+(w-pad)+','+(h-pad)+' L '+pad+','+(h-pad)+' Z';
  var lastIdx=series.length-1;
  var lastPt=pts[lastIdx];
  var firstDate=series[0].date, lastDate=series[lastIdx].date;
  svg.innerHTML=
    '<defs><linearGradient id="dashTrendGrad" x1="0" x2="0" y1="0" y2="1">'+
      '<stop offset="0%" stop-color="rgba(37,99,235,0.25)"/>'+
      '<stop offset="100%" stop-color="rgba(37,99,235,0)"/>'+
    '</linearGradient></defs>'+
    '<path d="'+areaD+'" fill="url(#dashTrendGrad)" stroke="none"/>'+
    '<path d="'+lineD+'" fill="none" stroke="var(--blue)" stroke-width="1.5"/>'+
    '<circle cx="'+lastPt[0]+'" cy="'+lastPt[1]+'" r="3" fill="var(--blue)"/>'+
    '<text x="'+pad+'" y="'+(h-pad+2)+'" font-size="9" fill="var(--text3)">'+firstDate.slice(5)+'</text>'+
    '<text x="'+(w-pad)+'" y="'+(h-pad+2)+'" font-size="9" fill="var(--text3)" text-anchor="end">'+lastDate.slice(5)+'</text>';
}

async function loadDashboardStats(){
  // Date in header
  var dashDate=document.getElementById('dashDate');
  if(dashDate)dashDate.textContent=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'});

  function setText(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  function fmtKRW(n){return '₩'+(n||0).toLocaleString('ko-KR');}

  try{
    var statsRes=await apiGet('/admin/stats');
    if(statsRes&&statsRes.message&&!statsRes.totals){throw new Error(statsRes.message);}

    var totals=statsRes.totals||{};
    var pc=statsRes.planCounts||{};
    var tm=statsRes.thisMonth||{};

    // Stat cards
    setText('dashMembers',totals.members||0);
    setText('dashMembersDelta','이번 달 +'+(tm.members||0));
    setText('dashEditorials',totals.editorialsPublished||0);
    setText('dashEditorialsDelta','이번 달 +'+(tm.editorials||0));
    setText('dashSubmissions',totals.submissionsPending||0);
    setText('dashSubmissionsDelta','이번 달 +'+(tm.submissions||0)+' 신규');
    setText('dashPullletters',totals.pullettersPending||0);
    setText('dashPulllettersDelta','이번 달 +'+(tm.pullletters||0)+' 신청');
    setText('dashStandard',pc.standard||0);
    setText('dashStandardBreakdown','월 '+(pc.standard_monthly||0)+' · 연 '+(pc.standard_yearly||0));
    setText('dashPremium',pc.premium||0);
    setText('dashPremiumBreakdown','월 '+(pc.premium_monthly||0)+' · 연 '+(pc.premium_yearly||0));
    setText('dashCommunity',totals.communityPosts||0);
    setText('dashRevenue',fmtKRW(statsRes.monthlyRevenue));
    setText('dashRevenueNote','활성 구독 '+(totals.activeSubscriptions||0)+'건');

    // Quick action badges
    setText('qaPendingSub',totals.submissionsPending||0);
    setText('qaPendingPl',totals.pullettersPending||0);

    // Monthly summary footer
    setText('dashMonthMembers',tm.members||0);
    setText('dashMonthEditorials',tm.editorials||0);
    setText('dashMonthSubmissions',tm.submissions||0);
    setText('dashMonthPullletters',tm.pullletters||0);

    // Recent submissions
    var subTb=document.getElementById('homeRecentSubmissions');
    if(subTb){
      var subs=statsRes.recentSubmissions||[];
      if(!subs.length){
        subTb.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:40px 0">서브미션이 없습니다</td></tr>';
      }else{
        subTb.innerHTML=subs.map(function(s){
          var statusBadge='<span class="badge b-'+(s.status||'pending')+'">'+esc(s.status||'pending')+'</span>';
          var looks=Array.isArray(s.file_urls)?s.file_urls.length:0;
          var name=esc(s.submitterName||s.submitterEmail||'—');
          var title=esc(s.title||'Untitled');
          var date=fmtDate(s.created_at);
          return '<tr><td class="td-title" onclick="go(\'submissions\');setTimeout(function(){openModal(\''+s.id+'\')},150)">'+title+'</td><td>'+name+'</td><td>'+looks+'</td><td>'+date+'</td><td>'+statusBadge+'</td></tr>';
        }).join('');
      }
    }

    // Recent members
    var memTb=document.getElementById('homeRecentMembers');
    if(memTb){
      var mems=statsRes.recentMembers||[];
      if(!mems.length){
        memTb.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:40px 0">회원이 없습니다</td></tr>';
      }else{
        memTb.innerHTML=mems.map(function(m){
          var role=m.role||'member';
          var roleBadge='<span class="badge b-role-'+role+'">'+esc(role)+'</span>';
          return '<tr><td>'+esc(m.display_name||'—')+'</td><td style="color:var(--text3);font-size:11px">'+esc(m.email||'—')+'</td><td>'+roleBadge+'</td><td>'+fmtDate(m.created_at)+'</td></tr>';
        }).join('');
      }
    }

    // Recent editorials
    var edTb=document.getElementById('homeRecentEditorials');
    if(edTb){
      var eds=statsRes.recentEditorials||[];
      if(!eds.length){
        edTb.innerHTML='<tr><td colspan="3" style="text-align:center;color:var(--text3);padding:40px 0">에디토리얼이 없습니다</td></tr>';
      }else{
        edTb.innerHTML=eds.map(function(e){
          var thumb=e.thumbnail||e.cover_image||'';
          var thumbHtml=thumb?'<img loading="lazy" class="td-thumb" src="'+esc(thumb)+'" style="width:30px;height:38px">':'<span style="color:var(--text3)">—</span>';
          return '<tr><td style="width:40px">'+thumbHtml+'</td><td class="td-title" style="max-width:200px;overflow:hidden;text-overflow:ellipsis" onclick="go(\'editorials\')">'+esc(e.title||'')+'</td><td>'+fmtDate(e.published_date)+'</td></tr>';
        }).join('');
      }
    }

    // Pull-letter trend
    var trend=statsRes.pullletterTrend||[];
    var trendTotal=trend.reduce(function(s,d){return s+(d.count||0);},0);
    setText('dashTrendSummary','총 '+trendTotal+'건');
    renderTrendChart(document.getElementById('dashTrendChart'),trend);
  }catch(e){
    console.error('Dashboard stats error:',e);
    var msg='불러오기 실패: '+esc(e.message||'');
    var subTb=document.getElementById('homeRecentSubmissions');
    if(subTb)subTb.innerHTML='<tr><td colspan="5" style="text-align:center;color:#ff6b6b;padding:40px 0">'+msg+'</td></tr>';
    var memTb=document.getElementById('homeRecentMembers');
    if(memTb)memTb.innerHTML='<tr><td colspan="4" style="text-align:center;color:#ff6b6b;padding:40px 0">'+msg+'</td></tr>';
    var edTb=document.getElementById('homeRecentEditorials');
    if(edTb)edTb.innerHTML='<tr><td colspan="3" style="text-align:center;color:#ff6b6b;padding:40px 0">'+msg+'</td></tr>';
  }
}

// ======== EDITORIAL CRUD (API) ========
var editorials=[];
var editingEditorialId=null;
// Status filter: 'all' | 'published' | 'draft'. Drafts are submissions
// that the editor approved but hasn't yet published, so the filter has
// to surface them clearly (they're invisible on the public site).
var edStatusFilter='all';

function setEditorialStatusFilter(s){
  edStatusFilter=(s==='published'||s==='draft')?s:'all';
  var btns=document.querySelectorAll('.ed-fbtn');
  for(var i=0;i<btns.length;i++){
    if(btns[i].getAttribute('data-status')===edStatusFilter) btns[i].classList.add('ed-fbtn-active');
    else btns[i].classList.remove('ed-fbtn-active');
  }
  renderEditorialList();
}

async function loadEditorials(){
  var tb=document.getElementById('edListBody');
  if(!tb)return;
  tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px">불러오는 중...</td></tr>';
  try{
    // QA #196 — pull THREE views in parallel: published (live now),
    // draft (임시저장), scheduled (예약됨 — published row whose
    // scheduled_publish_at is in the future). Without the scheduled
    // bucket the published-filter on the backend hides those rows for
    // both public AND admin, so the editor couldn't see / edit them.
    var results = await Promise.all([
      apiGet('/editorials?limit=100&status=published'),
      apiGet('/editorials?limit=100&status=draft'),
      apiGet('/editorials?limit=100&status=scheduled'),
    ]);
    var pub = results[0], draft = results[1], scheduled = results[2];
    // Tag scheduled rows with a synthetic _virtualStatus so the
    // render layer can show the right badge + filter button without
    // mutating the canonical status field.
    var schedRows = (scheduled.data || []).map(function(r){
      r._virtualStatus = 'scheduled';
      return r;
    });
    editorials = (pub.data || []).concat(draft.data || []).concat(schedRows);
    renderEditorialList();
  }catch(e){
    tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:#ff6b6b;padding:40px">불러오기 실패: '+esc(e.message)+'</td></tr>';
  }
}

function renderEditorialList(){
  var q=(document.getElementById('edSearchAdmin')?document.getElementById('edSearchAdmin').value:'').toLowerCase();
  // QA #196 — derive an effective status that takes the virtual
  // 'scheduled' bucket into account. Rows whose _virtualStatus is set
  // (server-tagged scheduled rows) get treated as 'scheduled' for both
  // filtering and rendering.
  function _effectiveStatus(e){
    if(e._virtualStatus) return e._virtualStatus;
    return e.status || 'published';
  }
  var filtered=editorials.filter(function(e){
    if(edStatusFilter!=='all'){
      if(_effectiveStatus(e)!==edStatusFilter)return false;
    }
    if(!q)return true;
    var tags=Array.isArray(e.tags)?e.tags.join(' '):e.tags||'';
    return (e.title||'').toLowerCase().indexOf(q)>-1||tags.toLowerCase().indexOf(q)>-1;
  });
  var draftCount=editorials.filter(function(e){return _effectiveStatus(e)==='draft';}).length;
  var schedCount=editorials.filter(function(e){return _effectiveStatus(e)==='scheduled';}).length;
  var dcb=document.getElementById('edDraftCountBadge');
  if(dcb) dcb.textContent=draftCount?('('+draftCount+')'):'';
  var scb=document.getElementById('edScheduledCountBadge');
  if(scb) scb.textContent=schedCount?('('+schedCount+')'):'';
  var tb=document.getElementById('edListBody');
  if(!tb) return;
  tb.innerHTML='';
  if(!filtered.length){tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px 0">에디토리얼이 없습니다</td></tr>';if(document.getElementById('edCountLabel'))document.getElementById('edCountLabel').textContent='0';return;}
  filtered.forEach(function(e){
    var tags=Array.isArray(e.tags)?e.tags:[];
    var tagBadges=tags.slice(0,3).map(function(t){return '<span class="pe-tag">'+esc(t)+'</span>';}).join(' ');
    var st=_effectiveStatus(e);
    // QA #196 — three-state badge palette:
    //   published → green (b-published)
    //   draft     → orange/yellow (b-draft)
    //   scheduled → purple (b-scheduled) so the editor can spot
    //               queued posts at a glance vs already-live ones.
    var cls, label;
    if(st==='scheduled'){
      cls='b-scheduled';
      // Show the queued publish time so the editor knows when it goes live.
      var when='';
      if(e.scheduled_publish_at){
        try{
          var d=new Date(e.scheduled_publish_at);
          if(!isNaN(d.getTime())){
            var mm=d.getMonth()+1, dd=d.getDate();
            var hh=d.getHours(), mn=d.getMinutes();
            var pad=function(n){return n<10?'0'+n:n;};
            when=' '+mm+'/'+dd+' '+pad(hh)+':'+pad(mn);
          }
        }catch(_){}
      }
      label='⏰ 예약'+when;
    }else if(st==='draft'){
      cls='b-draft'; label='임시저장';
    }else{
      cls='b-published'; label='공개';
    }
    var thumb=e.thumbnail||e.cover_image||'';
    var thumbHtml=thumb?'<img loading="lazy" class="td-thumb" src="'+esc(thumb)+'">':'—';
    var shortId=e.id?e.id.substring(0,8):'—';
    // Highlight non-live rows with a subtle background tint
    var rowStyle='';
    if(st==='draft')          rowStyle=' style="background:rgba(255,152,0,0.06)"';
    else if(st==='scheduled') rowStyle=' style="background:rgba(124,58,237,0.05)"';
    var safeTitle=esc(e.title).replace(/'/g,"\\'");
    var actions='<button class="btn btn-sm" onclick="editEditorial(\''+e.id+'\')">편집</button>';
    if(st==='draft'){
      actions+=' <button class="btn btn-sm btn-primary" onclick="publishEditorial(\''+e.id+'\',\''+safeTitle+'\')" title="이 에디토리얼을 공개 사이트에 노출합니다">발행 ▶</button>';
    }
    if(st==='scheduled'){
      // Manual publish-now option for scheduled rows. Useful when the
      // editor wants to ship early.
      actions+=' <button class="btn btn-sm btn-primary" onclick="publishScheduledNow(\''+e.id+'\',\''+safeTitle+'\')" title="예약된 발행 시간을 무시하고 지금 즉시 공개합니다">즉시 발행 ▶</button>';
    }
    actions+=' <button class="btn btn-sm btn-red" onclick="deleteEditorial(\''+e.id+'\',\''+safeTitle+'\')">삭제</button>';
    // Date column shows publish date for live posts, scheduled date for queued ones.
    var dateCell = st==='scheduled'
      ? '<span style="color:rgba(124,58,237,0.85);font-weight:600">예약: '+fmtDate(e.scheduled_publish_at)+'</span>'
      : fmtDate(e.published_date);
    tb.innerHTML+='<tr'+rowStyle+'><td style="font-size:10px">'+shortId+'</td><td>'+thumbHtml+'</td><td class="td-title" onclick="editEditorial(\''+e.id+'\')">'+esc(e.title)+'</td><td>'+tagBadges+'</td><td><span class="badge '+cls+'">'+label+'</span></td><td>'+dateCell+'</td><td>'+actions+'</td></tr>';
  });
  if(document.getElementById('edCountLabel')) document.getElementById('edCountLabel').textContent=editorials.length;
}

// QA #196 — manual "publish now" for a scheduled editorial.
// Clears scheduled_publish_at and bumps published_date to now() so
// the row immediately satisfies the public list's freshness gate.
async function publishScheduledNow(id, title){
  if(!confirm('"'+(title||'이 에디토리얼')+'"의 예약을 취소하고 지금 바로 공개할까요?')) return;
  try{
    var resp=await apiPut('/editorials/'+id, {
      status:'published',
      scheduled_publish_at: null,
      published_date: new Date().toISOString().slice(0,10),
    });
    if(resp && resp.error){ alert('발행 실패: '+resp.error); return; }
    await loadEditorials();
    if(typeof toast==='function') toast('지금 발행되었습니다');
  }catch(e){
    alert('발행 실패: '+(e&&e.message?e.message:'알 수 없는 오류'));
  }
}

// Flip a draft editorial to published. Drafts come from approved
// submissions and from the admin's own "save as draft" — both need an
// explicit click here before they show up on the public site.
// apiPut doesn't check r.ok, so the response may be {error:'...'} on
// failure — inspect it explicitly rather than blindly toasting success.
async function publishEditorial(id,title){
  if(!confirm('"'+(title||'이 에디토리얼')+'"을(를) 발행하시겠습니까?\n공개 사이트에 즉시 노출됩니다.')) return;
  try{
    var resp=await apiPut('/editorials/'+id,{status:'published'});
    if(resp && resp.error){
      alert('발행 실패: '+resp.error);
      return;
    }
    await loadEditorials();
    if(typeof toast==='function') toast('발행되었습니다');
  }catch(e){
    alert('발행 실패: '+(e&&e.message?e.message:'알 수 없는 오류'));
  }
}

// ── QA #170 — Instagram caption helpers (mirror review.js' server-side
// builder so the editor can re-run it after tweaking credits/brands).
// Format must match the server output verbatim:
//
//   'TITLE' exclusive for @pap_magazine published by @kangdm ㅡ link in bio
//
//   ————-
//   Role @handle Role @handle Role @handle …
//
//   Starring @model @agency
//
//   ————-
//   (KR) …
//
//   (EN) …
//
//   (IT) …
//
//   ————-
//   Full Story link🔎
//   https://www.pap-magazine.com/editorial/<slug>
//
//   Fashion by @brand1 @brand2 …
var _IG_PUBLISHER_HANDLE = '@kangdm';
var _IG_HOUSE_HANDLE     = '@pap_magazine';
var _IG_SEPARATOR        = '————- ';     // em-dash × 4 + hyphen + space
var _IG_SITE_BASE        = 'https://www.pap-magazine.com/editorial/';

function _igNormalizeHandle(s){
  if(!s) return '';
  var h = String(s).trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i,'')
    .replace(/\/$/,'');
  if(!h) return '';
  return h.charAt(0) === '@' ? h : '@' + h;
}
// Editorial role names already match PAP's house format (e.g. "Photography,
// Art Directing & Retouching") — render verbatim. Only fall back to
// Title-Case for snake/lowercase keys (legacy submission shape).
function _igRoleLabel(raw){
  var s = String(raw||'').trim();
  if(!s) return 'Credit';
  if(/^[a-z0-9_]+$/.test(s)){
    return s.replace(/_/g,' ').replace(/\b\w/g, function(c){return c.toUpperCase();});
  }
  return s;
}
function _igSlugify(title){
  var s = String(title||'').trim();
  if(!s) return '';
  return s.toLowerCase()
    .replace(/['"`]+/g,'')
    .replace(/[^\w\s가-힣-]+/g,'')
    .trim()
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-');
}
// Build caption from the currently-open editorial. ed shape:
//   { title, issue?, slug?, description?, description_en?,
//     credits: [{roles[], name, instagram, website}, …],
//     fashion: { brands: [{name, instagram}, …] } }
function _buildIgCaptionFromEditorial(ed){
  if(!ed) return '';
  var lines = [];
  var title = String(ed.title||'').trim();
  var slug  = ed.slug || _igSlugify(title);

  // 1) Header
  lines.push("'" + title + "' exclusive for " + _IG_HOUSE_HANDLE + ' published by ' + _IG_PUBLISHER_HANDLE + ' ㅡ link in bio');
  lines.push('');

  // 2) Credits (inline single line) + Starring
  lines.push(_IG_SEPARATOR);
  var credits = Array.isArray(ed.credits) ? ed.credits : [];
  var creditParts = [];
  var modelParts = [];
  credits.forEach(function(c){
    if(!c) return;
    var handle = _igNormalizeHandle(c.instagram || c.website || '');
    if(!handle) return;
    var role = (Array.isArray(c.roles) && c.roles.length ? c.roles[0] : c.role) || 'Credit';
    var label = _igRoleLabel(role);
    if(label === 'Starring' || /^Model$/i.test(label)){
      modelParts.push(handle);
      // If the credit row also carries the agency in website or a sibling
      // role, the editor can add it manually. Keep mapping simple here.
    }else{
      creditParts.push(label + ' ' + handle);
    }
  });
  if(creditParts.length) lines.push(creditParts.join(' '));
  if(modelParts.length){
    if(creditParts.length) lines.push('');
    lines.push('Starring ' + modelParts.join(' '));
  }
  lines.push('');

  // 3) Descriptions — three locales. (KR) from description (assumed
  // primary), (EN) from description_en if present, (IT) blank for admin
  // to fill.
  var descKo = (ed.description||'').trim();
  var descEn = (ed.description_en||'').trim();
  var descIt = (ed.description_it||'').trim();  // not currently stored; surface as empty
  lines.push(_IG_SEPARATOR);
  lines.push('(KR) ' + descKo);
  lines.push('');
  lines.push('(EN) ' + descEn);
  lines.push('');
  lines.push('(IT) ' + descIt);
  lines.push('');

  // 4) Full Story link
  lines.push(_IG_SEPARATOR);
  lines.push('Full Story link🔎');
  lines.push(_IG_SITE_BASE + slug);
  lines.push('');

  // 5) Brands — single line
  var brands = (ed.fashion && Array.isArray(ed.fashion.brands)) ? ed.fashion.brands : [];
  var seen = {};
  var brandHandles = [];
  brands.forEach(function(b){
    if(!b) return;
    var h = _igNormalizeHandle(b.instagram || b.name || '');
    if(!h) return;
    var key = h.toLowerCase();
    if(seen[key]) return;
    seen[key] = true;
    brandHandles.push(h);
  });
  if(brandHandles.length) lines.push('Fashion by ' + brandHandles.join(' '));

  return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
// Buttons in the editorial modal call into these. We rebuild a synthetic
// "ed" object from the live form so the regenerate button reflects any
// in-modal edits the user has made to credits/brands BEFORE saving.
function regenerateIgCaption(){
  var ed = _readEditorialFromForm();
  var caption = _buildIgCaptionFromEditorial(ed);
  var el = document.getElementById('postIgCaption');
  if(el){ el.value = caption; }
}

// QA #184 — POST /api/admin/editorials/:id/auto-generate. Calls Claude
// vision (or translate-mode if a source-submission artistStatement is
// linked) to fill description / description_en / instagram_caption.
//
// Two modes triggered by the same handler:
//   • overwrite=false → only fill empty slots (default; click on '🤖 AI 자동 생성')
//   • overwrite=true  → replace whatever's there (click on '🤖 강제 재생성')
// On success we pull the new values straight into the open editor form
// without a page reload so the admin can review/edit before saving.
async function aiAutoGenerateEditorial(overwrite){
  if(!editingEditorialId){
    alert('먼저 에디토리얼을 저장해주세요.\n신규 작성 중에는 AI 자동 생성을 사용할 수 없습니다.\n(임시저장 후 다시 시도하시면 됩니다.)');
    return;
  }
  if(overwrite){
    var existing = (document.getElementById('postDescription')||{}).value || '';
    if(existing.trim() && !confirm('기존 description / instagram_caption을 덮어쓰고 새로 생성합니다.\n계속할까요?')) return;
  }
  // Visual: lock the buttons + show progress on the AI button itself.
  var btn = document.getElementById('aiAutoGenBtn');
  var origLabel = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = '🤖 생성 중…'; btn.style.opacity = '.7'; }
  try{
    var resp = await fetch(_apiBase+'/admin/editorials/'+editingEditorialId+'/auto-generate',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+(localStorage.getItem('pap-token')||''),
        'X-Requested-With':'XMLHttpRequest'
      },
      body: JSON.stringify({ overwrite: !!overwrite })
    });
    var data = await resp.json();
    if(!resp.ok) throw new Error(data.message || ('Auto-generate failed: '+resp.status));

    // Update the form's fields with whatever the server now has stored.
    // Only swap a field if the server reports it was actually changed.
    var fu = data.fieldsUpdated || {};
    if(fu.description && document.getElementById('postDescription')){
      document.getElementById('postDescription').value = data.description || '';
    }
    if(fu.description_en && document.getElementById('postDescriptionEn')){
      document.getElementById('postDescriptionEn').value = data.description_en || '';
    }
    if(fu.instagram_caption && document.getElementById('postIgCaption')){
      document.getElementById('postIgCaption').value = data.instagram_caption || '';
    }

    var summary = [];
    if(fu.description)        summary.push('description (KR)');
    if(fu.description_en)     summary.push('description (EN)');
    if(fu.instagram_caption)  summary.push('instagram caption (KR/EN/IT)');
    if(summary.length){
      alert('✓ AI 자동 생성 완료\n채워진 필드: '+summary.join(', '));
    } else {
      alert('이미 모든 필드가 채워져 있어요.\n덮어쓰려면 "🤖 강제 재생성"을 사용하세요.');
    }
  }catch(e){
    console.error('aiAutoGenerateEditorial error:', e);
    alert('자동 생성 실패: '+(e && e.message || e));
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = origLabel || '🤖 AI 자동 생성'; btn.style.opacity = '1'; }
  }
}

// QA #184 — bulk fill for editorials that came back empty. Main admin
// only; backend caps to 25 per call. Useful for cleaning up legacy
// admin-created editorials (no submission to trigger auto-gen at the
// approval step).
async function aiAutoGenerateBulkEditorials(){
  if(window._papIsMainAdmin !== true){
    alert('일괄 자동 생성은 대표 관리자만 실행할 수 있습니다.');
    return;
  }
  var doOverwrite = confirm(
    '🤖 빈 에디토리얼 일괄 AI 자동 생성\n\n' +
    '대상: description / description_en / instagram_caption 중 하나라도 비어있는 에디토리얼\n' +
    '최대 25개씩 (Claude API rate limit). 더 있으면 다시 눌러주세요.\n\n' +
    '확인 → 빈 칸만 채움\n취소 → 작업 중단'
  );
  if(!doOverwrite) return;
  if(!confirm('진행하면 Claude API 호출 비용이 발생합니다 (대상 수 × 약 1회 호출).\n계속할까요?')) return;
  try{
    var resp = await fetch(_apiBase+'/admin/editorials/auto-generate-bulk',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+(localStorage.getItem('pap-token')||''),
        'X-Requested-With':'XMLHttpRequest'
      },
      body: JSON.stringify({ overwrite: false, onlyMissing: true, limit: 25 })
    });
    var data = await resp.json();
    if(!resp.ok) throw new Error(data.message || ('Bulk failed: '+resp.status));
    var msg = '✓ 일괄 자동 생성 완료\n\n' +
      '대상: '+data.processed+'개\n' +
      '업데이트됨: '+data.updated+'개\n' +
      '건너뜀: '+data.skipped+'개';
    if(data.errors && data.errors.length){
      msg += '\n실패: '+data.errors.length+'개 (자세한 내용은 콘솔 확인)';
      console.error('[bulk auto-gen] errors:', data.errors);
    }
    alert(msg);
    if(typeof loadEditorials === 'function') loadEditorials();
  }catch(e){
    console.error('aiAutoGenerateBulkEditorials error:', e);
    alert('일괄 자동 생성 실패: '+(e && e.message || e));
  }
}
async function copyIgCaption(btn){
  var el = document.getElementById('postIgCaption');
  if(!el || !el.value){
    if(typeof PAP !== 'undefined' && PAP.ui) PAP.ui.toast('복사할 캡션이 없습니다.', 'error');
    return;
  }
  try{
    await navigator.clipboard.writeText(el.value);
    var orig = btn ? btn.textContent : '';
    if(btn){ btn.textContent = '✓ 복사됨'; setTimeout(function(){ btn.textContent = orig || '📋 복사'; }, 1500); }
  }catch(_){
    // Fallback for older browsers / non-secure contexts: select + execCommand
    el.focus(); el.select();
    try { document.execCommand('copy'); } catch(__){}
  }
}
// Read the in-modal editorial state into a shape the IG builder understands.
// Mirrors the field collection in savePost (no DB roundtrip). Picks up
// the slug + description + description_en the admin may have just typed
// so the regenerate button reflects the latest pending edits.
function _readEditorialFromForm(){
  var title = (document.getElementById('postTitle')||{}).value || '';
  var issue = (document.getElementById('postSubtitle')||{}).value || '';
  var slug  = (document.getElementById('postSlug')||{}).value || '';
  var description    = (document.getElementById('postDescription')||{}).value || '';
  // description_en isn't surfaced as a separate input in the editorial
  // form yet — when it is, this picks it up automatically.
  var descriptionEn  = (document.getElementById('postDescriptionEn')||{}).value || '';
  var credits = [];
  document.querySelectorAll('#creditsArea .pe-credit-row').forEach(function(row){
    var nameEl = row.querySelector('.pe-credit-name');
    var igEl = row.querySelector('.pe-credit-ig');
    var roles = (typeof _readCreditRoles === 'function') ? _readCreditRoles(row) : [];
    var name = nameEl ? (nameEl.value||'').trim() : '';
    if(roles.length && name){
      credits.push({ roles:roles, name:name, instagram:(igEl?igEl.value:'').trim() });
    }
  });
  var brands = [];
  document.querySelectorAll('#brandsArea .pe-brand-row').forEach(function(row){
    var nameEl = row.querySelector('.pe-brand-name');
    var igEl = row.querySelector('.pe-brand-ig');
    if(nameEl && nameEl.value){
      brands.push({ name:nameEl.value, instagram:igEl?igEl.value:'' });
    }
  });
  return {
    title: title,
    issue: issue,
    slug: slug,
    description: description,
    description_en: descriptionEn,
    credits: credits,
    fashion: { brands: brands },
  };
}

function editEditorial(id){
  var ed=editorials.find(function(e){return e.id===id;});
  if(!ed)return;
  editingEditorialId=id;
  // Populate basic fields
  document.getElementById('postTitle').value=ed.title||'';
  document.getElementById('postSubtitle').value=ed.issue||'';
  // QA — restore the saved slug. Without this every edit dropped the
  // slug back to a blank input, so the user had to retype the URL
  // (or savePost would auto-regenerate it from the title and silently
  // change the public URL of an already-published editorial).
  if(document.getElementById('postSlug')) document.getElementById('postSlug').value = ed.slug || '';
  var tagsStr=Array.isArray(ed.tags)?ed.tags.join(', '):ed.tags||'';
  document.getElementById('postTags').value=tagsStr;
  var preview=document.getElementById('tagPreview');
  if(preview&&tagsStr)preview.innerHTML=tagsStr.split(',').map(function(t){return t.trim()?'<span class="pe-tag">'+t.trim()+'</span>':'';}).join('');
  if(document.getElementById('postVideoUrl'))document.getElementById('postVideoUrl').value=ed.url||'';
  if(document.getElementById('postDescription'))document.getElementById('postDescription').value=ed.description||'';
  // QA #170 — Instagram caption (seeded at submission approval).
  if(document.getElementById('postIgCaption'))document.getElementById('postIgCaption').value=ed.instagram_caption||'';
  document.getElementById('postPublish').checked=(ed.status==='published');

  // QA #172 — surface the "✉️ 저장 시 승인 메일 발송" section only when
  // this editorial was actually staged from a submission. Admin-created
  // editorials (no source) hide the area entirely — no submitter to
  // notify. If the email was already sent, the checkbox is disabled and
  // a small "이미 발송됨" badge is shown so the editor doesn't worry
  // about double-sending.
  var appBox = document.getElementById('editorialApprovalEmailArea');
  if(appBox){
    if(ed.source_submission_id){
      appBox.style.display = '';
      var sentNote = document.getElementById('editorialApprovalEmailSentNote');
      var chk = document.getElementById('editorialSendApprovalEmail');
      var dayEl = document.getElementById('editorialApprovalDay');
      var monthEl = document.getElementById('editorialApprovalMonth');
      var alreadySent = !!ed.approval_email_sent_at;
      if(chk){ chk.checked = false; chk.disabled = alreadySent; }
      if(sentNote){
        if(alreadySent){
          var when = '';
          try { when = new Date(ed.approval_email_sent_at).toLocaleString(); } catch(_){}
          sentNote.textContent = '이미 발송됨' + (when ? ' · ' + when : '');
          sentNote.style.display = '';
        } else {
          sentNote.style.display = 'none';
        }
      }
      if(dayEl) dayEl.value = '';
      if(monthEl) monthEl.value = '';
    } else {
      appBox.style.display = 'none';
    }
  }

  // ── Phase 4: rehydrate scheduled-publish UI when editing ──
  // If the editorial has a scheduled_publish_at value, tick the box and
  // pre-fill the date/time inputs (in browser local time, KST).
  var schedCb = document.getElementById('postSchedule');
  var schedDateEl = document.getElementById('scheduleDate');
  var schedTimeEl = document.getElementById('scheduleTime');
  if (schedCb) {
    schedCb.checked = !!ed.scheduled_publish_at;
    if (ed.scheduled_publish_at) {
      try {
        var sd = new Date(ed.scheduled_publish_at);
        if (!isNaN(sd.getTime())) {
          var pad = function(n){ return n < 10 ? '0' + n : '' + n; };
          if (schedDateEl) schedDateEl.value = sd.getFullYear() + '-' + pad(sd.getMonth() + 1) + '-' + pad(sd.getDate());
          if (schedTimeEl) schedTimeEl.value = pad(sd.getHours()) + ':' + pad(sd.getMinutes());
        }
      } catch(e) {}
    }
    if (typeof toggleSchedule === 'function') toggleSchedule();
  }

  // Pre-fill the manual 발행 날짜 picker with the post's saved
  // published_date so editing doesn't silently shift the timestamp
  // forward to "now" on every save.
  var pubDateEl = document.getElementById('publishDate');
  var pubTimeEl = document.getElementById('publishTime');
  if(pubDateEl) pubDateEl.value = '';
  if(pubTimeEl) pubTimeEl.value = '';
  if(ed.published_date){
    try {
      var pd = new Date(ed.published_date);
      if(!isNaN(pd.getTime())){
        var _pad = function(n){ return n < 10 ? '0' + n : '' + n; };
        if(pubDateEl) pubDateEl.value = pd.getFullYear() + '-' + _pad(pd.getMonth()+1) + '-' + _pad(pd.getDate());
        if(pubTimeEl) pubTimeEl.value = _pad(pd.getHours()) + ':' + _pad(pd.getMinutes());
      }
    } catch(e) {}
  }

  // Populate the top "커버 이미지" preview + show the X button so the
  // admin can clear the saved cover. data-thumb-cleared resets to '0'
  // since the admin hasn't taken any explicit clear action yet on
  // this load. (Element IDs still say "thumb*" historically but this
  // section now drives the cover_image DB field.)
  var thumbPrev=document.getElementById('thumbPreview');
  var thumbBox=document.getElementById('thumbUploadBox');
  if(thumbBox){ thumbBox.classList.remove('has-thumb'); thumbBox.setAttribute('data-thumb-cleared','0'); }
  if(thumbPrev&&(ed.cover_image||ed.thumbnail)){
    // Prefer cover_image; fall back to thumbnail for legacy posts that
    // only have the old field populated.
    var existingCoverUrl = ed.cover_image || ed.thumbnail;
    thumbPrev.innerHTML='<img loading="lazy" src="'+esc(existingCoverUrl)+'" style="max-width:200px;max-height:250px;object-fit:cover"><div class="pe-upload-text" style="margin-top:8px">클릭하여 변경</div>';
    if(thumbBox){
      thumbBox.classList.add('has-thumb');
      // Stash the saved URL so savePost can keep it when the admin
      // edits without picking a new file.
      thumbBox.dataset.existingUrl = existingCoverUrl;
    }
  } else if(thumbBox){
    thumbBox.dataset.existingUrl = '';
  }

  // Populate gallery
  galleryImages=[];galleryCount=0;galleryThumbNum=null;
  var grid=document.getElementById('galleryGrid');
  var addBtn=grid?grid.querySelector('.pe-gallery-add'):null;
  if(grid)grid.querySelectorAll('.pe-gallery-item').forEach(function(el){el.remove();});
  if(ed.gallery&&Array.isArray(ed.gallery)){
    ed.gallery.forEach(function(url,idx){
      galleryCount++;
      galleryImages.push({num:galleryCount,src:url,credits:'',isUrl:true});
      if(grid&&addBtn){
        var div=document.createElement('div');
        div.className='pe-gallery-item';
        div.setAttribute('data-img-num',galleryCount);
        div.setAttribute('draggable','true');
        // QA #94 — same draggable="false" defensive measure as in addGallery,
        // applied to the edit-post path so existing images can also be
        // re-ordered without the browser hijacking the drag for an image URL.
        div.innerHTML='<span class="pe-gallery-grip">⋮⋮</span>'
          +'<img loading="lazy" draggable="false" src="'+esc(url)+'">'
          // QA #182 — soft delete on the editorial edit path as well
          +'<button class="pe-gallery-del" onclick="removeGalleryImg('+galleryCount+')" title="이 이미지를 발행에서 제외 (실제 삭제는 아님)">×</button>'
          +'<button class="pe-gallery-thumb" onclick="event.stopPropagation();setGalleryThumb('+galleryCount+')" title="썸네일로 지정 (홈 카드 작은 이미지)" aria-label="썸네일로 지정">★</button>'
          +'<span class="pe-tag-thumb">THUMB</span>'
          +'<span class="pe-gallery-num">#'+galleryCount+'</span>';
        grid.insertBefore(div,addBtn);
        if(typeof _wireGalleryItemDrag === 'function') _wireGalleryItemDrag(div);
      }
    });
    updateImgCredits();
    // QA — restore the ★ THUMB (`thumbnail`) by matching the saved
    // URL against the loaded gallery items, falling back to the first
    // image so an old post with no thumb saved still gets one.
    // ◆ COVER picker was removed — cover_image now lives in the top
    // 커버 이미지 section (loaded into thumbPreview earlier).
    var savedThumbUrl = ed.thumbnail || '';
    if(savedThumbUrl){
      var thumbMatch = galleryImages.find(function(g){ return g.src === savedThumbUrl; });
      if(thumbMatch) galleryThumbNum = thumbMatch.num;
    }
    if(galleryImages.length && galleryThumbNum===null){
      galleryThumbNum = galleryImages[0].num;
    }
    _renderGalleryCoverState();
  }

  // Populate credits
  // QA #96 — load credits from EITHER the new array format
  // [{roles[], name, instagram}, ...] OR the legacy dict format
  // {role: {name, instagram}, ...} so we don't break existing posts.
  var creditsArea=document.getElementById('creditsArea');
  if(creditsArea && ed.credits){
    creditsArea.innerHTML='';
    var entries=[];
    if(Array.isArray(ed.credits)){
      // New format — pass through, normalising shape just in case.
      entries=ed.credits.map(function(c){
        var roles=Array.isArray(c.roles) ? c.roles
                : (c.role ? [c.role] : []);
        return {
          roles: roles,
          name: c.name || '',
          instagram: c.instagram || ''
        };
      });
    } else if(typeof ed.credits==='object'){
      // Legacy dict format — one role per entry. Wrap each into the new
      // shape so the editor presents a uniform chip picker UI.
      entries=Object.entries(ed.credits).map(function(e){
        var role=e[0]; var val=e[1];
        var name = (val && typeof val==='object') ? (val.name || '')
                 : (typeof val==='string' ? val : '');
        var ig   = (val && typeof val==='object') ? (val.instagram || '') : '';
        return { roles: role ? [role] : [], name: name, instagram: ig };
      });
    }
    entries.forEach(function(c){
      var row=document.createElement('div');
      row.className='pe-credit-row';
      row.setAttribute('draggable','true');
      row.innerHTML=_buildCreditRowInner(c.roles, c.name, c.instagram);
      creditsArea.appendChild(row);
      _wireCreditRowDrag(row);
      var trig=row.querySelector('.pe-role-trigger');
      if(trig) _renderRoleChips(trig);
    });
    _onCreditCheckChange();
  }

  // Populate brands
  var brandsArea=document.getElementById('brandsArea');
  if(brandsArea&&ed.fashion&&ed.fashion.brands&&Array.isArray(ed.fashion.brands)){
    brandsArea.innerHTML='';
    ed.fashion.brands.forEach(function(b){
      var row=document.createElement('div');row.className='pe-brand-row';
      row.innerHTML='<input class="pe-input pe-brand-name" placeholder="브랜드명" value="'+esc(b.name||'')+'"><input class="pe-input pe-brand-ig" placeholder="@instagram" value="'+esc(b.instagram||'')+'"><button class="btn btn-sm btn-red" onclick="this.parentElement.remove()">삭제</button>';
      brandsArea.appendChild(row);
    });
  }

  // Restore per-image fashion credits saved as fashion.imageCredits.
  // Stored shape: { img_1: "@brand1 Jacket, @brand2 Pants", img_2: ... }
  // savePost reads these from galleryImages[i].credits, so we drop them
  // back onto each gallery row (1-indexed key → 0-indexed array slot)
  // and re-render the imgCreditsArea so the inputs show their values.
  if(ed.fashion&&ed.fashion.imageCredits&&typeof ed.fashion.imageCredits==='object'){
    var creditsMap = ed.fashion.imageCredits;
    galleryImages.forEach(function(g, i){
      var key = 'img_' + (i + 1);
      if(creditsMap[key]) g.credits = creditsMap[key];
    });
    if(typeof updateImgCredits === 'function') updateImgCredits();
  }

  go('newpost');
}

async function deleteEditorial(id,title){
  if(!confirm('"'+title+'" 에디토리얼을 삭제하시겠습니까?')) return;
  try{
    await apiDelete('/editorials/'+id);
    editorials=editorials.filter(function(e){return e.id!==id;});
    renderEditorialList();
    alert('삭제되었습니다.');
  }catch(e){alert('삭제 실패: '+e.message);}
}

// ─── QA #100 — pre-save validation + error feedback ────────────────────
// Each helper is local to the new-post form. Errors live in two places:
//   1. inline under the offending field (red border + small message)
//   2. aggregated in #peSaveSummary at the top of the form, with each
//      bullet acting as a click-target that scrolls/focuses the field
function _peShowFieldError(fieldId, msg){
  var input=document.getElementById(fieldId);
  if(input && input.classList) input.classList.add('pe-input-error');
  var errId='peErr-'+fieldId;
  var errEl=document.getElementById(errId);
  if(!errEl){
    errEl=document.createElement('div');
    errEl.id=errId;
    errEl.className='pe-field-err';
    if(input && input.parentNode) input.parentNode.insertBefore(errEl, input.nextSibling);
  }
  if(errEl){
    errEl.textContent=msg;
    errEl.classList.add('visible');
  }
}
function _peClearAllErrors(){
  document.querySelectorAll('.pe-input-error').forEach(function(el){el.classList.remove('pe-input-error');});
  document.querySelectorAll('.pe-field-err.visible').forEach(function(el){el.classList.remove('visible');el.textContent='';});
  var summary=document.getElementById('peSaveSummary');
  if(summary){ summary.style.display='none'; summary.innerHTML=''; }
  var success=document.getElementById('peSaveSuccess');
  if(success){ success.style.display='none'; success.textContent=''; }
}

// Returns a list of {id, msg}. Empty list means the form is good to save.
function _peCollectValidationErrors(){
  var errs=[];
  var titleEl=document.getElementById('postTitle');
  var title=(titleEl && titleEl.value || '').trim();
  if(!title) errs.push({id:'postTitle', msg:'제목을 입력해 주세요.'});
  else if(title.length<2) errs.push({id:'postTitle', msg:'제목은 2자 이상이어야 합니다.'});
  else if(title.length>200) errs.push({id:'postTitle', msg:'제목은 200자 이내로 입력해 주세요.'});

  var catEl=document.getElementById('postCategory');
  var category=(catEl && catEl.value || '').trim();
  if(!category) errs.push({id:'postCategory', msg:'카테고리를 선택해 주세요.'});

  if(category==='editorial'){
    // Thumbnail: required for new editorials. Edit mode keeps the
    // existing thumbnail unless the user picks a new one — we read the
    // preview state to detect "has any thumb at all".
    var thumbInput=document.getElementById('thumbInput');
    var hasNewThumb = thumbInput && thumbInput.files && thumbInput.files[0];
    var thumbPreview=document.getElementById('thumbPreview');
    var hasExistingThumb = thumbPreview && thumbPreview.querySelector('img');
    if(!hasNewThumb && !hasExistingThumb){
      errs.push({id:'thumbInput', msg:'썸네일 이미지를 업로드해 주세요.'});
    }

    // Gallery: at least 1 image. galleryImages is the canonical source.
    if(typeof galleryImages==='undefined' || !galleryImages || galleryImages.length===0){
      errs.push({id:'galleryGrid', msg:'화보 이미지를 1장 이상 업로드해 주세요.'});
    }

    // Credits: at least one row with both roles[] and name. The QA #97
    // bulk-select toolbar leaves stale empty rows behind on purpose;
    // they don't count toward this check.
    var rows=document.querySelectorAll('#creditsArea .pe-credit-row');
    var validCredits=0;
    rows.forEach(function(row){
      var roles=(typeof _readCreditRoles==='function') ? _readCreditRoles(row) : [];
      var nameEl=row.querySelector('.pe-credit-name');
      var nameVal=(nameEl && nameEl.value || '').trim();
      if(roles.length>0 && nameVal) validCredits++;
    });
    if(validCredits===0){
      errs.push({id:'creditsArea', msg:'크레딧을 1개 이상 입력해 주세요. (역할 + 이름)'});
    }
  }

  // Schedule date: required and in the future when "예약 게시" is on.
  var scheduleCb=document.getElementById('postSchedule');
  if(scheduleCb && scheduleCb.checked){
    var dEl=document.getElementById('scheduleDate');
    if(!dEl || !dEl.value){
      errs.push({id:'scheduleDate', msg:'예약 게시 날짜를 선택해 주세요.'});
    } else {
      var t=(document.getElementById('scheduleTime') || {}).value || '09:00';
      var localDt=new Date(dEl.value+'T'+t+':00');
      if(isNaN(localDt.getTime())){
        errs.push({id:'scheduleDate', msg:'예약 날짜 형식이 올바르지 않습니다.'});
      } else if(localDt.getTime() <= Date.now()){
        errs.push({id:'scheduleDate', msg:'예약 날짜는 현재 시각 이후여야 합니다.'});
      }
    }
  }

  return errs;
}

function _peApplyValidationErrors(errs){
  errs.forEach(function(e){ _peShowFieldError(e.id, e.msg); });
  var summary=document.getElementById('peSaveSummary');
  if(summary){
    var listHtml = errs.map(function(e){
      // Each li is a click-target: scroll to + focus the matching field.
      return '<li onclick="_peJumpToField(\''+e.id+'\')">'+esc(e.msg)+'</li>';
    }).join('');
    summary.innerHTML = '<strong>저장 전 다음 항목을 확인해 주세요 ('+errs.length+'건)</strong><ul>'+listHtml+'</ul>';
    summary.style.display='block';
    summary.scrollIntoView({behavior:'smooth', block:'center'});
  }
  // Auto-focus the first offending field for keyboard users.
  if(errs.length>0) _peJumpToField(errs[0].id);
}
function _peJumpToField(fieldId){
  var el=document.getElementById(fieldId);
  if(!el) return;
  el.scrollIntoView({behavior:'smooth', block:'center'});
  if(typeof el.focus==='function'){
    // setTimeout so scrollIntoView animation finishes before focus jumps
    setTimeout(function(){ try{ el.focus(); }catch(_){} }, 350);
  }
}

// Map raw server / fetch errors to a specific Korean message so the
// user sees what to fix instead of a generic "Upload failed".
function _peFormatSaveError(e){
  var msg = (e && e.message) || '';
  // Supabase Storage / bucket-level errors (most common real causes
  // behind the old "Upload failed" mystery). The server now passes
  // `detail` through; we map the well-known phrases here.
  if(/row.?level\s*security|rls/i.test(msg))             return '저장소 권한 오류 (RLS). Supabase 버킷의 admin 정책을 확인해 주세요.';
  if(/bucket.*not.*found|bucket.*does.*not/i.test(msg))  return 'Supabase 버킷을 찾을 수 없습니다. 환경 설정을 확인해 주세요.';
  if(/payload.*too.*large|413/i.test(msg))               return '요청 본문이 너무 큽니다. 이미지를 더 압축해 주세요 (Vercel 4.5MB 한도).';
  if(/duplicate|already.*exists|conflict/i.test(msg))    return '이미 존재하는 항목입니다 (슬러그/파일명 중복 가능).';

  if(/storage\s*upload\s*failed/i.test(msg))             return '이미지 저장소(Supabase) 업로드 실패: '+msg;
  // QA #100 follow-up — don't pre-judge the cause as "size or format".
  // The user reported a 1.3MB JPEG (well within both client and server
  // limits) hitting this branch, which means the real cause was a
  // server-side condition — RLS, bucket config, etc. — the message had
  // hidden. Pass the raw detail through so it's actionable.
  if(/upload\s*failed/i.test(msg))                       return '이미지 업로드 실패: '+msg+' (서버 원인 — 콘솔 로그 또는 메시지 끝부분 참고)';
  if(/file too large|too large/i.test(msg))              return '파일 용량이 너무 큽니다. 1장당 2MB 이하로 압축해 주세요.';
  if(/invalid file|wrong format|unsupported|mime type not allowed|file type not allowed/i.test(msg)) return '지원하지 않는 파일 형식입니다 (JPG · PNG · WebP).';
  if(/title.*(required|null|empty)/i.test(msg))          return '제목이 누락되었습니다.';
  if(/network|fetch|failed to fetch|connection/i.test(msg)) return '네트워크 오류. 잠시 후 다시 시도해 주세요.';
  if(/unauthor|forbidden|401|403/i.test(msg))            return '권한이 없습니다. 다시 로그인 후 시도해 주세요.';
  if(/timeout/i.test(msg))                               return '서버 응답 지연. 이미지 용량이 큰 경우 압축 후 다시 시도해 주세요.';
  if(/429|too many requests|rate limit/i.test(msg))      return '업로드 요청이 너무 많습니다. 1분 후 다시 시도해 주세요. (서버 한도)';
  return msg ? ('저장 실패: '+msg) : '저장 중 알 수 없는 오류가 발생했습니다.';
}

function _peShowSaveSuccess(msg){
  var success=document.getElementById('peSaveSuccess');
  if(success){
    success.textContent=msg||'저장되었습니다.';
    success.style.display='block';
  }
}

// mode (optional): 'draft' forces status='draft' regardless of the
// 공개 checkbox, so the "임시저장" button always saves as a draft no
// matter what the publish toggle says. Default behaviour reads the
// checkbox as before.
async function savePost(mode){
  // Always start by clearing prior errors so re-clicks reflect current state.
  _peClearAllErrors();

  var errs=_peCollectValidationErrors();
  if(errs.length>0){
    _peApplyValidationErrors(errs);
    return;
  }

  var forceDraft = (mode === 'draft');
  var title=document.getElementById('postTitle').value.trim();
  var tags=document.getElementById('postTags')?document.getElementById('postTags').value:'';
  var catEl=document.getElementById('postCategory');
  var category=catEl?catEl.value:'editorial';
  var tagsArr=tags?tags.split(',').map(function(t){return t.trim();}).filter(Boolean):[];

  // QA #96 — credits are now an ARRAY of {roles[], name, instagram} so
  // a single person can hold multiple roles (e.g. Hair + Make Up) in one
  // entry. Empty rows (no name) are skipped; a row with no roles selected
  // is also skipped — there's no useful way to credit someone without
  // saying for what.
  var credits=[];
  document.querySelectorAll('#creditsArea .pe-credit-row').forEach(function(row){
    var nameEl=row.querySelector('.pe-credit-name');
    var igEl=row.querySelector('.pe-credit-ig');
    var roles=_readCreditRoles(row);
    var nameVal=(nameEl && nameEl.value || '').trim();
    if(roles.length>0 && nameVal){
      credits.push({
        roles: roles,
        name: nameVal,
        instagram: (igEl && igEl.value || '').trim()
      });
    }
  });

  // Build fashion/brands
  var fashion={brands:[]};
  document.querySelectorAll('#brandsArea .pe-brand-row').forEach(function(row){
    var name=row.querySelector('.pe-brand-name');
    var ig=row.querySelector('.pe-brand-ig');
    if(name&&name.value)fashion.brands.push({name:name.value,instagram:ig?ig.value:''});
  });

  // Image credits per gallery image
  var imgCreditsMap={};
  galleryImages.forEach(function(g,i){if(g.credits)imgCreditsMap['img_'+(i+1)]=g.credits;});
  if(Object.keys(imgCreditsMap).length)fashion.imageCredits=imgCreditsMap;

  // forceDraft: explicit "임시저장" button click — always save as draft.
  var isPublished = forceDraft ? false : document.getElementById('postPublish').checked;
  var subtitle=document.getElementById('postSubtitle')?document.getElementById('postSubtitle').value:'';
  var videoUrl=document.getElementById('postVideoUrl')?document.getElementById('postVideoUrl').value:'';

  // ── Phase 4: scheduled publish ──
  // If "예약 게시" is checked AND a date+time was provided, build an ISO timestamp.
  // Backend (api/editorials/index.js) hides editorials with future scheduled_publish_at
  // from the public list, so the post stays invisible to readers until the moment passes.
  var scheduledAt = null;
  var scheduleCb = document.getElementById('postSchedule');
  if (scheduleCb && scheduleCb.checked) {
    var dEl = document.getElementById('scheduleDate');
    var tEl = document.getElementById('scheduleTime');
    if (dEl && dEl.value) {
      var t = (tEl && tEl.value) ? tEl.value : '09:00';
      // Treat input as KST (browser local) — toISOString converts to UTC for storage.
      var localDt = new Date(dEl.value + 'T' + t + ':00');
      if (!isNaN(localDt.getTime())) scheduledAt = localDt.toISOString();
    }
  }

  // Show saving indicator
  // Visual feedback: disable BOTH save buttons while in flight so the
  // user can't click 저장 + 임시저장 in quick succession. Stash the
  // original labels so we can restore them in the finally branch (the
  // "임시저장" button shouldn't end up reading "저장").
  var saveBtns=document.querySelectorAll('#t-newpost .pe-actions .btn');
  var saveBtnLabels=[];
  saveBtns.forEach(function(b){
    saveBtnLabels.push(b.textContent);
    b.disabled=true;
  });
  var primaryBtn=document.querySelector('#t-newpost .pe-actions .btn-primary');
  if(primaryBtn) primaryBtn.textContent = forceDraft ? '임시저장 중...' : '저장 중...';

  try{
    // Upload thumbnail if new file selected
    var thumbUrl=null;
    var thumbInput=document.getElementById('thumbInput');
    if(thumbInput&&thumbInput.files&&thumbInput.files[0]){
      thumbUrl=await uploadFile(thumbInput.files[0]);
    }

    // Upload gallery images (only new files, keep existing URLs).
    // Track which resolved URL corresponds to the ★ THUMB pick so it
    // survives even when its file was freshly uploaded in this batch.
    // ◆ COVER picker was removed — cover_image is uploaded via the
    // dedicated top "커버 이미지" section instead, so no second pick.
    var galleryUrls=[];
    var thumbUrlPick=null;
    for(var i=0;i<galleryImages.length;i++){
      var g=galleryImages[i];
      // QA #182 — skip soft-deleted (× toggled) rows. They stay in the
      // local galleryImages array so the admin can re-include them
      // before save, but never get uploaded or written into file_urls
      // on the published editorial.
      if(g.isExcluded) continue;
      var resolvedUrl=null;
      if(g.isUrl){resolvedUrl=g.src;} // existing URL
      else if(g.file){resolvedUrl=await uploadFile(g.file);} // new file
      else if(g.src&&g.src.indexOf('http')===0){resolvedUrl=g.src;}
      if(resolvedUrl){
        galleryUrls.push(resolvedUrl);
        if(g.num === galleryThumbNum) thumbUrlPick = resolvedUrl;
      }
    }

    // Field mapping (UI label ↔ DB field):
    //   썸네일 (홈 카드 작은 이미지)         → DB `thumbnail`
    //     ↳ source: ★ 갤러리 선택 → 첫 갤러리 이미지 (fallback)
    //   커버   (에디토리얼 상세 최상단 큰 이미지) → DB `cover_image`
    //     ↳ source: 상단 "커버 이미지" 단독 업로드 → 기존 저장값 → 썸네일 (fallback)
    //
    // Variable names below (thumbUrl / existingThumbUrl / thumbBox)
    // historically referred to the separate top upload back when that
    // slot meant "thumbnail". The slot now feeds cover_image instead;
    // we keep the variable identifiers to avoid touching unrelated
    // code paths but the values flow into finalCover.
    var coverBox = document.getElementById('thumbUploadBox');
    var existingCoverUrl = (coverBox && coverBox.dataset && coverBox.dataset.existingUrl) || '';
    var finalThumb = thumbUrlPick || (galleryUrls.length ? galleryUrls[0] : null);
    var finalCover = thumbUrl || existingCoverUrl || finalThumb;

    var descriptionVal=document.getElementById('postDescription')?document.getElementById('postDescription').value:'';
    // QA #170 — Instagram caption (auto-seeded at submission approval;
    // editor may have tuned it in the textarea before saving). Empty
    // string means "user cleared it on purpose" — pass null so it shows
    // the generate button next time the editorial is opened.
    var igCaptionEl=document.getElementById('postIgCaption');
    var igCaptionVal=igCaptionEl ? (igCaptionEl.value||'').trim() : '';
    // QA — respect the slug the admin typed. Falls back to an
    // auto-generated slug from the title only when the input is empty
    // (matches the placeholder hint "비워두면 자동 생성됩니다"). The
    // previous version always overwrote with auto-generated, which
    // both ignored manual slugs and silently changed the public URL
    // of any edited editorial.
    var slugInput = document.getElementById('postSlug');
    var slugVal = (slugInput && slugInput.value || '').trim();
    var slugAuto = title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    // QA #176 — "예약 게시" implies status='published'. Without this
    // override, admin who tick 예약 게시 but leave "공개" unchecked end
    // up with status='draft' + scheduled_publish_at=future. Drafts are
    // hidden forever regardless of the schedule timestamp (the GET
    // handler's schedule gate only runs for status='published' rows),
    // so the editorial would silently never go live. Forcing
    // published here matches the admin's mental model ("예약 게시 =
    // publish on this date"). forceDraft (임시저장 button) still wins
    // — explicit "save as draft" trumps scheduling.
    var statusVal = isPublished || (!forceDraft && scheduledAt) ? 'published' : 'draft';

    var payload={
      title:title,
      slug:slugVal || slugAuto,
      tags:tagsArr,
      credits:credits,
      fashion:fashion,
      issue:subtitle||null,
      url:videoUrl||null,
      thumbnail:finalThumb||undefined,
      cover_image:finalCover||undefined,
      gallery:galleryUrls.length?galleryUrls:undefined,
      status: statusVal,
      // Manual publish date wins over the auto "now" timestamp.
      // _readPublishDate() returns null when the picker is empty, in
      // which case we fall back to the previous behaviour (저장 시점).
      // Drafts keep published_date NULL unless admin explicitly set one.
      // Scheduled rows also keep it NULL — published_date is stamped by
      // the editorial PUT handler when status flips from draft→published
      // for the first time (api/editorials/[id].js).
      published_date: (function(){
        var manual = (typeof _readPublishDate === 'function') ? _readPublishDate() : null;
        if(manual) return manual;
        // Scheduled = don't backdate; let the schedule timestamp speak.
        if(scheduledAt) return null;
        return statusVal === 'published' ? new Date().toISOString() : null;
      })(),
      description:descriptionVal||null,
      // QA #170 — empty string → null so the modal shows the "generate"
      // affordance on reopen instead of an empty textarea masquerading
      // as legitimate content.
      instagram_caption: igCaptionVal || null,
      scheduled_publish_at: scheduledAt
    };

    // QA #172 — approval email payload. Only attached when the admin
    // ticked the "저장 시 승인 메일 발송" checkbox in the editorial modal.
    // Backend is idempotent (approval_email_sent_at gate) so re-checking
    // after a successful send doesn't trigger a duplicate.
    var approvalChk = document.getElementById('editorialSendApprovalEmail');
    if(approvalChk && approvalChk.checked && !approvalChk.disabled){
      var dayInp = document.getElementById('editorialApprovalDay');
      var monthInp = document.getElementById('editorialApprovalMonth');
      payload.send_approval_email = true;
      payload.approval_day   = dayInp   ? (dayInp.value   || '').trim() : '';
      payload.approval_month = monthInp ? (monthInp.value || '').trim() : '';
      if(!payload.approval_day || !payload.approval_month){
        if(!confirm('승인 메일의 "around the () of ()" 자리가 비어있어요.\n빈 () 그대로 발송해도 될까요?')){
          return;
        }
      }
    }
    // Remove undefined keys
    Object.keys(payload).forEach(function(k){if(payload[k]===undefined)delete payload[k];});

    if(category==='editorial'){
      var successMsg;
      if(editingEditorialId){
        await apiPut('/editorials/'+editingEditorialId,payload);
        successMsg='에디토리얼이 수정되었습니다.';
      }else{
        await apiPost('/editorials',payload);
        successMsg='에디토리얼이 등록되었습니다.';
      }
      _peShowSaveSuccess(successMsg);
      editingEditorialId=null;
      // Wipe the form NOW so the next "+ 새 에디토리얼" click starts
      // truly empty even if the go('newpost') reset hook ever drifts.
      if(typeof _resetNewPostForm === 'function') _resetNewPostForm();
      loadEditorials();go('editorials');
    }else if(category==='news'){
      await apiPost('/articles',{title:title,subtitle:subtitle,tags:tagsArr,thumbnail_url:thumbUrl,credits:Object.entries(credits).map(function(c){return{role:c[0],name:c[1].name};}),status:isPublished?'published':'draft',published_date:isPublished?new Date().toISOString():null,category:'news'});
      alert('뉴스가 등록되었습니다.');
      loadNews();go('news');
    }else if(category==='film' || category==='shorts'){
      // Extract a clean 11-char YouTube id via the shared normaliser so
      // films/shorts created through the unified post form go through the
      // same validation as saveFilm() above. The previous in-place .replace
      // chain silently let through pasted bare URLs and Vimeo links, which
      // ended up stored verbatim in youtube_id and broke the iframe on the
      // detail page (QA #160 — "Selects" film).
      var _ytInfo = (typeof normaliseEmbedUrl === 'function') ? normaliseEmbedUrl(videoUrl) : null;
      var _ytId = null;
      if (_ytInfo && _ytInfo.provider === 'youtube') {
        _ytId = _ytInfo.src.split('/embed/')[1];
      } else if (/^[A-Za-z0-9_-]{11}$/.test(String(videoUrl||'').trim())) {
        _ytId = String(videoUrl).trim();
      } else {
        alert(
          '인식할 수 없는 YouTube URL입니다.\n\n' +
          '지원하는 형식:\n' +
          '  • https://www.youtube.com/watch?v=비디오ID\n' +
          '  • https://youtu.be/비디오ID\n' +
          '  • https://www.youtube.com/shorts/비디오ID\n' +
          '  • 11자 비디오 ID 직접 입력\n\n' +
          '입력하신 값: ' + (videoUrl||'(빈 값)')
        );
        return;
      }
      if (category==='film') {
        await apiPost('/films',{title:title,youtube_id:_ytId,thumbnail_url:thumbUrl,tags:tagsArr.join(', '),status:isPublished?'published':'draft',published_date:isPublished?new Date().toISOString():null});
        alert('필름이 등록되었습니다.');
        loadFilmsFromAPI();go('film');
      } else {
        await apiPost('/shorts',{title:title,youtube_id:_ytId,thumbnail_url:thumbUrl,tags:tagsArr.join(', '),status:isPublished?'published':'draft',published_date:isPublished?new Date().toISOString():null});
        alert('숏츠가 등록되었습니다.');
        loadShortsFromAPI();go('shorts');
      }
    }
  }catch(e){
    // QA #100 — translate the raw error into something specific so the
    // user knows what to fix. The summary panel above the form picks
    // up the message for visibility (alert is the legacy fallback).
    var friendly = _peFormatSaveError(e);
    var summary=document.getElementById('peSaveSummary');
    if(summary){
      summary.innerHTML='<strong>저장 실패</strong><ul><li>'+esc(friendly)+'</li></ul>';
      summary.style.display='block';
      summary.scrollIntoView({behavior:'smooth', block:'center'});
    }
    alert(friendly);
  }finally{
    saveBtns.forEach(function(b,i){
      b.disabled=false;
      if(saveBtnLabels[i] !== undefined) b.textContent = saveBtnLabels[i];
    });
  }
}

// TAG PREVIEW
document.addEventListener('DOMContentLoaded',function(){
  var tagInput=document.getElementById('postTags');
  if(tagInput){
    tagInput.addEventListener('input',function(){
      var preview=document.getElementById('tagPreview');
      var val=this.value;
      if(!val.trim()){preview.innerHTML='';return;}
      preview.innerHTML=val.split(',').map(function(t){return t.trim()?'<span class="pe-tag">'+t.trim()+'</span>':'';}).join('');
    });
  }
});

// ======== NEWS BLOCK BUILDER ========
// QA #199 — `addNewsBlock` now delegates to the shared _appendNewsBlock
// helper so the editor-create path uses the exact same DOM as edit-mode
// hydration. Without that, a block added by the editor renders with a
// slightly different shape than the same block hydrated from a saved
// payload, which broke the "edit a freshly-saved post" round-trip.
var newsBlockCount=1;
function addNewsBlock(type){
  _appendNewsBlock(type, '');
}

// QA #199 — collect every block back out of the DOM into a stable
// JSON shape ([{type, content}, ...]) for serializing into
// articles.content. The same shape is what _hydrateNewsEditorForm
// reads on edit, closing the round-trip.
function _collectNewsBlocks(){
  var blocks=[];
  document.querySelectorAll('#newsBlocks .news-block').forEach(function(block){
    // Block-type label sits in the small grey header — we keep the
    // legacy text matching since the labels are user-visible Korean.
    var headLabel = (block.querySelector('span') && block.querySelector('span').textContent) || '';
    var t = 'text';
    if(headLabel.indexOf('이미지')>=0) t = 'image';
    else if(headLabel.indexOf('인용구')>=0) t = 'quote';
    else if(headLabel.indexOf('영상')>=0) t = 'video';

    var ta = block.querySelector('textarea');
    var inp = block.querySelector('input.pe-input');
    var content = '';
    if(t==='text' || t==='quote'){
      content = ta ? ta.value : '';
    } else if(t==='image'){
      // Image caption sits in the pe-input; the actual uploaded file
      // would go through an upload pipeline (not in scope here).
      content = inp ? inp.value : '';
    } else if(t==='video'){
      content = inp ? inp.value : '';
    }
    blocks.push({type:t, content:content});
  });
  return blocks;
}

async function saveNewsArticle(){
  var titleEl=document.getElementById('newnewsTitle');
  if(!titleEl||!titleEl.value){alert('제목을 입력해 주세요.');return;}

  var blocks = _collectNewsBlocks();

  // Status + schedule. The three-way radio replaces the old single
  // "공개" checkbox so the editor can stage drafts and schedule posts
  // with the same affordance editorials already have.
  var picked = 'published';
  var radios = document.getElementsByName('newnewsStatusOpt');
  for(var i=0;i<radios.length;i++){ if(radios[i].checked){ picked = radios[i].value; break; } }
  var schedAt = null;
  if(picked === 'scheduled'){
    var schedEl = document.getElementById('newnewsScheduledAt');
    if(!schedEl || !schedEl.value){
      alert('예약 게시를 선택했지만 예약 일시가 비어 있습니다.');
      return;
    }
    // <input type="datetime-local"> gives back YYYY-MM-DDTHH:MM in
    // LOCAL time. Convert to ISO so the server stores UTC.
    schedAt = new Date(schedEl.value).toISOString();
    if(new Date(schedAt) <= new Date()){
      if(!confirm('예약 일시가 현재보다 과거입니다. 그래도 진행할까요?\n(과거 일시는 즉시 공개와 동일하게 동작합니다.)')) return;
    }
  }

  // Map the chosen radio onto the DB status field. Scheduled posts
  // are status='published' under the hood — the
  // scheduled_publish_at gate keeps them off the public list until
  // their time comes.
  var dbStatus = (picked === 'draft') ? 'draft' : 'published';

  // Reuse the existing thumbnail URL when editing without a new upload.
  var thumbUrlEl = document.getElementById('newnewsThumbUrl');
  var thumbUrl = thumbUrlEl ? thumbUrlEl.value : '';

  var payload = {
    title: titleEl.value,
    content: JSON.stringify(blocks),
    category: 'news',
    status: dbStatus,
    scheduled_publish_at: schedAt,
  };
  if(thumbUrl) payload.thumbnail_url = thumbUrl;

  // Only stamp published_date when actually going live now (not for
  // drafts or future-scheduled posts). The PUT handler also auto-stamps
  // on first draft→published transition for safety.
  if(picked === 'published'){
    payload.published_date = new Date().toISOString();
  }

  try{
    if(editingArticleId){
      await apiPut('/articles/'+editingArticleId, payload);
      alert('뉴스가 수정되었습니다.');
    } else {
      await apiPost('/articles', payload);
      alert('뉴스가 등록되었습니다.');
    }
    editingArticleId = null;
    loadNews();
    go('news');
  }catch(e){
    alert('저장 실패: '+(e && e.message ? e.message : ''));
  }
}

// ======== FILM CRUD (API) ========
var films=[];
var editFilmIdx=-1;
var editFilmId=null;

async function loadFilmsFromAPI(){
  var tb=document.getElementById('filmListBody');if(!tb)return;
  tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px">불러오는 중...</td></tr>';
  try{
    var pub=await apiGet('/films?limit=100&status=published');
    var draft=await apiGet('/films?limit=100&status=draft');
    films=(pub.data||[]).concat(draft.data||[]);
    renderFilms();
  }catch(e){
    tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:#ff6b6b;padding:40px">불러오기 실패</td></tr>';
  }
}

function renderFilms(){
  var tb=document.getElementById('filmListBody');if(!tb)return;tb.innerHTML='';
  if(!films.length){tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px 0">필름이 없습니다</td></tr>';return;}
  films.forEach(function(f,i){
    var yt=f.youtube_id||'';
    var thumb=f.thumbnail_url||('https://img.youtube.com/vi/'+yt+'/mqdefault.jpg');
    var st=f.status||'published';
    var shortId=f.id?f.id.substring(0,8):'—';
    tb.innerHTML+='<tr><td style="font-size:10px">'+shortId+'</td><td><img loading="lazy" class="td-thumb" src="'+esc(thumb)+'"></td><td class="td-title" onclick="openFilmModal('+i+')">'+esc(f.title)+'</td><td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">'+esc(yt)+'</td><td><span style="font-size:10px;color:var(--purple)">새 팝업창</span></td><td><span class="badge '+(st==='published'?'b-published':'b-draft')+'">'+(st==='published'?'공개':'비공개')+'</span></td><td><button class="btn btn-sm" onclick="openFilmModal('+i+')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteFilm('+i+')">삭제</button></td></tr>';
  });
}

// ── Film modal helpers ────────────────────────────────────────────────
// Slug autogeneration shared with the editorial form would be ideal but
// the editorial code does it inline inside savePost; this is the same
// pattern as that, scoped here to avoid touching the working post path.
function _filmSlugify(s){
  if(!s) return '';
  return String(s).toLowerCase().trim()
    .replace(/[À-ſ]/g, function(c){
      // Strip simple Latin diacritics — Postgres slug column doesn't
      // need them and admin search expects ASCII.
      var map = 'AAAAAAAECEEEEIIIIDNOOOOOOUUUUYTHsaaaaaaaeceeeeiiiidnoooooouuuuythy';
      return map[c.charCodeAt(0) - 0x00C0] || '';
    })
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// Populate the "연결된 에디토리얼" dropdown from /api/editorials. Cached
// across modal opens so admin doesn't refetch on every edit.
var _filmRelatedEdCache = null;
async function _populateFilmRelatedEditorial(selectedId){
  var sel = document.getElementById('filmRelatedEditorial');
  if(!sel) return;
  // Always reset to base option + selected entry until the API answers.
  sel.innerHTML = '<option value="">— 없음 —</option>';
  try {
    if (!_filmRelatedEdCache) {
      var r = await apiGet('/editorials?status=published&limit=100');
      _filmRelatedEdCache = (r && (r.data || r.editorials || r)) || [];
      if (!Array.isArray(_filmRelatedEdCache)) _filmRelatedEdCache = [];
    }
    _filmRelatedEdCache.forEach(function(ed){
      var opt = document.createElement('option');
      opt.value = ed.id;
      opt.textContent = ed.title || ed.slug || ed.id;
      sel.appendChild(opt);
    });
    if (selectedId) sel.value = selectedId;
  } catch(e){
    console.warn('[films] failed to load editorials list:', e && e.message);
  }
}

// File-input handler for the film thumbnail upload affordance — runs the
// same /api/media/upload roundtrip the editorial form uses, then drops
// the resulting URL into #filmThumb so saveFilm picks it up.
async function _onFilmThumbFile(input){
  if(!input.files || !input.files[0]) return;
  var prev = document.getElementById('filmThumbPreview');
  var origHtml = prev ? prev.innerHTML : '';
  if(prev) prev.innerHTML = '<span class="pe-upload-text">업로드 중…</span>';
  try {
    var url = await uploadFile(input.files[0]);
    document.getElementById('filmThumb').value = url;
    if(prev){
      prev.innerHTML = '<img loading="lazy" src="'+esc(url)+'" style="max-height:60px;max-width:100px;object-fit:cover;border-radius:2px"><span class="pe-upload-text" style="margin-left:8px">업로드 완료 — 클릭하여 변경</span>';
    }
  } catch(e){
    if(prev) prev.innerHTML = origHtml;
    alert('업로드 실패: ' + (e && e.message));
  }
  input.value = '';
}

function _resetFilmModalFields(){
  document.getElementById('filmTitle').value='';
  document.getElementById('filmYouTube').value='';
  document.getElementById('filmThumb').value='';
  document.getElementById('filmSlug').value='';
  document.getElementById('filmDate').value=new Date().toISOString().slice(0,10);
  document.getElementById('filmCatsCustom').value='';
  document.querySelectorAll('#filmCatsArea input[name="filmCat"]').forEach(function(cb){cb.checked=false;});
  // QA #164 — publish state radio group + scheduled_publish_at picker.
  // Default to "공개" (= status='published', scheduled_publish_at=null) so
  // the existing UX of "new film immediately public" stays unchanged for
  // anyone who doesn't touch the radio group.
  var _pubPublished = document.getElementById('filmPublishMode_published');
  if (_pubPublished) _pubPublished.checked = true;
  var _schedAt = document.getElementById('filmScheduledAt');
  if (_schedAt) _schedAt.value = '';
  if (typeof toggleFilmSchedule === 'function') toggleFilmSchedule();
  // Legacy hidden checkbox — kept truthy to satisfy any code path that
  // still reads it before the cached JS reloads.
  document.getElementById('filmActive').checked=true;
  document.getElementById('filmCreditsArea').innerHTML='';
  addCredit('filmCreditsArea');   // one blank row
  var thumbPrev = document.getElementById('filmThumbPreview');
  if(thumbPrev) thumbPrev.innerHTML = '<span class="pe-upload-icon" style="font-size:18px">📷</span><span class="pe-upload-text" style="margin-left:8px">또는 파일 업로드 (JPG · PNG · WebP)</span>';
}

function openFilmModal(idx){
  editFilmIdx=idx;
  editFilmId=idx>=0&&films[idx]?films[idx].id:null;
  document.getElementById('filmModalTitle').textContent=idx>=0?'필름 편집':'필름 추가';

  _resetFilmModalFields();

  if(idx>=0){
    var f = films[idx];
    document.getElementById('filmTitle').value = f.title || '';
    document.getElementById('filmYouTube').value = f.youtube_id || '';
    document.getElementById('filmThumb').value = f.thumbnail_url || '';
    document.getElementById('filmSlug').value = f.slug || '';
    document.getElementById('filmDate').value = (f.published_date || '').slice(0,10) || new Date().toISOString().slice(0,10);
    // QA #164 — restore publish state from the row. Precedence:
    //   status='draft'                                 → 임시저장
    //   status='published' + scheduled_publish_at future → 예약 게시
    //   status='published' (otherwise)                  → 공개
    var _modeId = 'filmPublishMode_published';
    if (f.status !== 'published') _modeId = 'filmPublishMode_draft';
    else if (f.scheduled_publish_at && new Date(f.scheduled_publish_at).getTime() > Date.now()) {
      _modeId = 'filmPublishMode_scheduled';
    }
    var _modeEl = document.getElementById(_modeId);
    if (_modeEl) _modeEl.checked = true;
    var _schedInput = document.getElementById('filmScheduledAt');
    if (_schedInput && f.scheduled_publish_at) {
      // Convert ISO timestamp → datetime-local value (YYYY-MM-DDTHH:mm).
      try {
        var _d = new Date(f.scheduled_publish_at);
        var _p = function(n){ return n < 10 ? '0' + n : '' + n; };
        _schedInput.value = _d.getFullYear() + '-' + _p(_d.getMonth()+1) + '-' + _p(_d.getDate()) + 'T' + _p(_d.getHours()) + ':' + _p(_d.getMinutes());
      } catch(_) { _schedInput.value = ''; }
    } else if (_schedInput) {
      _schedInput.value = '';
    }
    if (typeof toggleFilmSchedule === 'function') toggleFilmSchedule();
    document.getElementById('filmActive').checked = (f.status==='published');

    // Categories — tick predefined boxes, dump the rest into the custom textbox.
    var predefined = ['Behind the Scenes','Campaign','Documentary','Interview','Performance','Music Video','Short Film','Trailer'];
    var custom = [];
    var fcats = Array.isArray(f.categories) ? f.categories : (f.categories ? [String(f.categories)] : []);
    fcats.forEach(function(c){
      var cb = document.querySelector('#filmCatsArea input[name="filmCat"][value="'+c.replace(/"/g,'\\"')+'"]');
      if(cb) cb.checked = true;
      else if(c && predefined.indexOf(c) === -1) custom.push(c);
    });
    document.getElementById('filmCatsCustom').value = custom.join(', ');

    // Credits — rebuild rows from saved JSONB. Clear the blank row first
    // so we don't end up with a phantom empty row above the loaded ones.
    var creditsArea = document.getElementById('filmCreditsArea');
    creditsArea.innerHTML = '';
    var creditsList = Array.isArray(f.credits) ? f.credits : [];
    if (creditsList.length === 0) {
      addCredit('filmCreditsArea');   // keep one blank row for editing
    } else {
      creditsList.forEach(function(c){
        var row = document.createElement('div');
        row.className = 'pe-credit-row';
        row.setAttribute('draggable','true');
        var roles = c.roles || (c.role ? [c.role] : []);
        row.innerHTML = _buildCreditRowInner(roles, c.name || '', c.instagram || '');
        creditsArea.appendChild(row);
        _wireCreditRowDrag(row, 'filmCreditsArea');
        var trig = row.querySelector('.pe-role-trigger');
        if(trig) _renderRoleChips(trig);
      });
      _onCreditCheckChange('filmCreditsArea');
    }

    // Existing thumb URL preview
    if (f.thumbnail_url) {
      var prev = document.getElementById('filmThumbPreview');
      if(prev){
        prev.innerHTML = '<img loading="lazy" src="'+esc(f.thumbnail_url)+'" style="max-height:60px;max-width:100px;object-fit:cover;border-radius:2px"><span class="pe-upload-text" style="margin-left:8px">현재 썸네일 — 클릭하여 변경</span>';
      }
    }

    // Related editorial — populate dropdown then select current value
    _populateFilmRelatedEditorial(f.related_editorial_id || '');
  } else {
    _populateFilmRelatedEditorial('');
  }

  document.getElementById('filmModal').classList.add('show');
}
function closeFilmModal(){document.getElementById('filmModal').classList.remove('show');}

// QA #164 — toggle the schedule date-time wrap based on the selected
// publish radio. Called by onchange on each radio + when the modal opens.
// Idempotent: safe to call before the DOM is fully built.
function toggleFilmSchedule(){
  var mode = (document.querySelector('input[name="filmPublishMode"]:checked') || {}).value;
  var wrap = document.getElementById('filmScheduleWrap');
  if (!wrap) return;
  wrap.style.display = (mode === 'scheduled') ? '' : 'none';
}

async function saveFilm(){
  var title=document.getElementById('filmTitle').value.trim();
  var yt=document.getElementById('filmYouTube').value.trim();
  if(!title||!yt){alert('제목과 YouTube URL을 입력해 주세요.');return;}
  // Use the shared normaliseEmbedUrl helper (pap-utils.js) so films stay in
  // sync with the editorial detail-page renderer. Films store the raw 11-char
  // YouTube id in films.youtube_id, so we pull it from the embed src when
  // normalisation succeeds.
  //
  // QA #160 — previously the `else` branch passed the raw input through as
  // `ytId`, which let malformed URLs (e.g. youtube.com/{id} bare-path,
  // Vimeo links) be saved verbatim into the youtube_id column. The detail
  // page then built `youtube-nocookie.com/embed/<that-raw-url>` and the
  // iframe stayed blank. Now we hard-reject anything normaliseEmbedUrl
  // can't squeeze a YouTube id out of so future rows are guaranteed to
  // be in the shape the renderer expects.
  var info = (typeof normaliseEmbedUrl === 'function') ? normaliseEmbedUrl(yt) : null;
  var ytId = null;
  if (info && info.provider === 'youtube') {
    ytId = info.src.split('/embed/')[1];
  } else if (/^[A-Za-z0-9_-]{11}$/.test(yt)) {
    // Bare 11-char id pasted directly — normaliseEmbedUrl already accepts
    // this, but keep the explicit branch so the rejection message below is
    // never confusing for that case.
    ytId = yt;
  } else {
    alert(
      '인식할 수 없는 YouTube URL입니다.\n\n' +
      '지원하는 형식:\n' +
      '  • https://www.youtube.com/watch?v=비디오ID\n' +
      '  • https://youtu.be/비디오ID\n' +
      '  • https://www.youtube.com/shorts/비디오ID\n' +
      '  • 11자 비디오 ID 직접 입력 (예: dQw4w9WgXcQ)\n\n' +
      '입력하신 값: ' + yt
    );
    return;
  }
  if (!ytId || !/^[A-Za-z0-9_-]{11}$/.test(ytId)) {
    // Last-line defence: even if a future regex change accidentally returns
    // a non-id-shaped value, refuse to save it. Better to nag the admin
    // than to ship another broken row.
    alert('YouTube 비디오 ID를 추출하지 못했습니다. URL을 다시 확인해주세요.');
    return;
  }

  // Slug — explicit value wins; else auto-derive from title.
  var slug = (document.getElementById('filmSlug').value || '').trim() || _filmSlugify(title);

  // Categories — predefined checkboxes + custom comma-list. Default to
  // ['Film'] so the existing public GET ?category=film filter keeps working
  // when the admin ticks nothing.
  //
  // Custom entries get a light Title Case normalisation (first letter upper,
  // rest as-typed) so the lookup buckets don't fragment into "editorial" /
  // "Editorial" / "EDITORIAL" three-ways. Multi-word inputs like "Behind
  // the Scenes" are left intact past the first letter — predictable rule,
  // no surprising lowercase-of-Scenes.
  function _normCategory(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  var cats = [];
  document.querySelectorAll('#filmCatsArea input[name="filmCat"]:checked').forEach(function(cb){ cats.push(cb.value); });
  var customRaw = (document.getElementById('filmCatsCustom').value || '').trim();
  if (customRaw) {
    customRaw.split(',').map(function(s){return _normCategory(s);}).filter(Boolean).forEach(function(c){
      if (cats.indexOf(c) < 0) cats.push(c);
    });
  }
  if (cats.length === 0) cats = ['Film'];

  var pubDate = document.getElementById('filmDate').value || new Date().toISOString().slice(0,10);

  // Credits — same shape the editorial form serializes. Empty rows skipped.
  var credits = [];
  document.querySelectorAll('#filmCreditsArea .pe-credit-row').forEach(function(row){
    var nameEl = row.querySelector('.pe-credit-name');
    var igEl   = row.querySelector('.pe-credit-ig');
    var roles  = _readCreditRoles(row);
    var nameVal = (nameEl && nameEl.value || '').trim();
    if (roles.length > 0 && nameVal) {
      credits.push({ roles: roles, name: nameVal, instagram: (igEl && igEl.value || '').trim() });
    }
  });

  var relEd = (document.getElementById('filmRelatedEditorial').value || '').trim() || null;
  var thumb = (document.getElementById('filmThumb').value || '').trim() || null;

  // QA #164 — publish state from radio group. Three outcomes:
  //   "published" → status=published, scheduled_publish_at=null
  //   "draft"     → status=draft,     scheduled_publish_at=null
  //   "scheduled" → status=published, scheduled_publish_at=<future ISO>
  //                 (matches the editorial pattern — the cron / public
  //                 GET hide the row until now() crosses the timestamp)
  var pubModeEl = document.querySelector('input[name="filmPublishMode"]:checked');
  var pubMode = pubModeEl ? pubModeEl.value : 'published';
  var status, scheduledIso = null;
  if (pubMode === 'draft') {
    status = 'draft';
  } else if (pubMode === 'scheduled') {
    var schedRaw = (document.getElementById('filmScheduledAt').value || '').trim();
    if (!schedRaw) {
      alert('예약 게시를 선택하셨습니다. 예약 일시를 입력해주세요.');
      return;
    }
    var schedDate = new Date(schedRaw);
    if (isNaN(schedDate.getTime())) {
      alert('예약 일시 형식이 올바르지 않습니다.');
      return;
    }
    if (schedDate.getTime() <= Date.now()) {
      // Past timestamp → just go live immediately (warn so the admin sees
      // why their "future" didn't take, then save as plain published).
      if (!confirm('예약 일시가 현재보다 과거입니다. 즉시 공개로 저장할까요?')) return;
      status = 'published';
    } else {
      status = 'published';
      scheduledIso = schedDate.toISOString();
    }
  } else {
    status = 'published';
  }

  var payload = {
    title: title,
    youtube_id: ytId,
    thumbnail_url: thumb,
    published_date: pubDate,
    categories: cats,
    credits: credits,
    slug: slug || null,
    status: status,
    scheduled_publish_at: scheduledIso,
    related_editorial_id: relEd,
  };

  try{
    if(editFilmId){
      await apiPut('/films/'+editFilmId, payload);
      alert('필름이 수정되었습니다.');
    } else {
      await apiPost('/films', payload);
      alert('필름이 등록되었습니다.');
    }
    closeFilmModal();
    loadFilmsFromAPI();
  }catch(e){
    alert('저장 실패: ' + (e && e.message));
  }
}

async function deleteFilm(i){
  if(!films[i])return;
  if(!confirm('"'+films[i].title+'" 을 삭제하시겠습니까?'))return;
  try{await apiDelete('/films/'+films[i].id);films.splice(i,1);renderFilms();alert('삭제되었습니다.');}catch(e){alert('삭제 실패');}
}

// ======== SHORTS CRUD ========
var shortsList=[];
var editShortsIdx=-1;
function renderShorts(){
  var tb=document.getElementById('shortsListBody');if(!tb)return;tb.innerHTML='';
  shortsList.forEach(function(s,i){
    tb.innerHTML+='<tr><td>'+s.id+'</td><td class="td-title" onclick="openShortsModal('+i+')">'+s.title+'</td><td style="font-size:11px">youtube.com/shorts/'+s.yt+'</td><td><span style="font-size:10px;color:var(--green)">'+s.play+'</span></td><td><span class="badge '+(s.active?'b-published':'b-draft')+'">'+(s.active?'공개':'비공개')+'</span></td><td><button class="btn btn-sm" onclick="openShortsModal('+i+')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteShorts('+i+')">삭제</button></td></tr>';
  });
}
function openShortsModal(idx){
  editShortsIdx=idx;
  document.getElementById('shortsModalTitle').textContent=idx>=0?'숏츠 편집':'숏츠 추가';
  if(idx>=0){var s=shortsList[idx];document.getElementById('shortsTitle').value=s.title;document.getElementById('shortsYouTube').value=s.yt;document.getElementById('shortsActive').checked=s.active;}
  else{document.getElementById('shortsTitle').value='';document.getElementById('shortsYouTube').value='';document.getElementById('shortsActive').checked=true;}
  document.querySelectorAll('#shortsModal .pe-radio').forEach(function(r){r.classList.remove('sel');});
  document.querySelector('#shortsModal .pe-radio').classList.add('sel');
  document.getElementById('shortsModal').classList.add('show');
}
function closeShortsModal(){document.getElementById('shortsModal').classList.remove('show');}
function saveShorts(){
  var title=document.getElementById('shortsTitle').value;var yt=document.getElementById('shortsYouTube').value;
  if(!title||!yt){alert('제목과 YouTube URL을 입력해 주세요.');return;}
  var ytId=yt.replace(/.*[?&]v=([^&]+).*/,'$1').replace(/.*youtu\.be\//,'').replace(/.*shorts\//,'');if(ytId.indexOf('http')>-1)ytId=yt;
  var play='메인 화면 인라인';document.querySelectorAll('#shortsModal input[name=shortsPlayType]').forEach(function(r){if(r.checked)play=r.value==='inline'?'메인 화면 인라인':'확대 재생';});
  var obj={title:title,yt:ytId,play:play,active:document.getElementById('shortsActive').checked};
  if(editShortsIdx>=0){obj.id=shortsList[editShortsIdx].id;shortsList[editShortsIdx]=obj;}
  else{obj.id=shortsList.length?Math.max.apply(null,shortsList.map(function(s){return s.id;}))+1:1;shortsList.push(obj);}
  renderShorts();closeShortsModal();
}
function deleteShorts(i){if(!confirm('"'+shortsList[i].title+'" 을 삭제하시겠습니까?'))return;shortsList.splice(i,1);renderShorts();}
renderShorts();

// ======== CATEGORY CRUD ========
var categories=[
  {id:1,nameKo:'에디토리얼',nameEn:'Editorial',slug:'editorial',order:1,active:true},
  {id:2,nameKo:'뉴스',nameEn:'News',slug:'news',order:2,active:true},
  {id:3,nameKo:'필름',nameEn:'Film',slug:'film',order:3,active:true},
  {id:4,nameKo:'숏츠',nameEn:'Shorts',slug:'shorts',order:4,active:true}
];
var editCatIdx=-1;

function renderCats(){
  var tb=document.getElementById('catTableBody');
  tb.innerHTML='';
  categories.forEach(function(c,i){
    tb.innerHTML+='<tr><td>'+c.order+'</td><td>'+c.nameKo+'</td><td>'+c.nameEn+'</td><td>'+c.slug+'</td><td>'+(c.active?'✓':'✗')+'</td><td><button class="btn btn-sm" onclick="openCatModal('+i+')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteCat('+i+')">삭제</button></td></tr>';
  });
}

function openCatModal(idx){
  editCatIdx=idx;
  if(idx>=0){
    var c=categories[idx];
    document.getElementById('catModalTitle').textContent='카테고리 편집';
    document.getElementById('catNameKo').value=c.nameKo;
    document.getElementById('catNameEn').value=c.nameEn;
    document.getElementById('catSlug').value=c.slug;
    document.getElementById('catOrder').value=c.order;
    document.getElementById('catActive').checked=c.active;
  } else {
    document.getElementById('catModalTitle').textContent='카테고리 추가';
    document.getElementById('catNameKo').value='';
    document.getElementById('catNameEn').value='';
    document.getElementById('catSlug').value='';
    document.getElementById('catOrder').value=categories.length+1;
    document.getElementById('catActive').checked=true;
  }
  document.getElementById('catModal').classList.add('show');
}

function closeCatModal(){document.getElementById('catModal').classList.remove('show');}

function saveCat(){
  var obj={
    nameKo:document.getElementById('catNameKo').value,
    nameEn:document.getElementById('catNameEn').value,
    slug:document.getElementById('catSlug').value||document.getElementById('catNameEn').value.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
    order:Number(document.getElementById('catOrder').value),
    active:document.getElementById('catActive').checked
  };
  if(!obj.nameKo||!obj.nameEn){alert('한국어와 영어 이름을 모두 입력해 주세요.');return;}
  if(editCatIdx>=0){
    obj.id=categories[editCatIdx].id;
    categories[editCatIdx]=obj;
  } else {
    obj.id=categories.length?Math.max(...categories.map(c=>c.id))+1:1;
    categories.push(obj);
  }
  categories.sort(function(a,b){return a.order-b.order;});
  renderCats();
  closeCatModal();
}

function deleteCat(idx){
  if(!confirm('"'+categories[idx].nameKo+'" 카테고리를 삭제하시겠습니까?\n이 카테고리에 속한 게시글이 있으면 먼저 이동시켜야 합니다.')) return;
  categories.splice(idx,1);
  renderCats();
}

renderCats();

// ======== BANNER CRUD ========
var banners=[];
var currentBannerFilter='메인';
var editBannerIdx=-1;

function renderBanners(){
  var tb=document.getElementById('bannerTableBody');
  tb.innerHTML='';
  banners.forEach(function(b,i){
    if(b.type!==currentBannerFilter) return;
    tb.innerHTML+='<tr><td>'+b.order+'</td><td><img loading="lazy" class="td-thumb" src="'+b.img+'" style="width:80px;height:40px"></td><td>'+b.titleKo+'</td><td>'+b.link+'</td><td>'+(b.active?'✓':'✗')+'</td><td><button class="btn btn-sm" onclick="openBannerModal('+i+')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteBanner('+i+')">삭제</button></td></tr>';
  });
}

function filterBanners(type,el){
  currentBannerFilter=type;
  el.parentElement.querySelectorAll('.tf').forEach(function(f){f.classList.remove('on');});
  el.classList.add('on');
  renderBanners();
}

function openBannerModal(idx){
  editBannerIdx=idx;
  // Reset radio
  document.querySelectorAll('#bannerModal .pe-radio').forEach(function(r){r.classList.remove('sel');});
  if(idx>=0){
    var b=banners[idx];
    document.getElementById('bannerModalTitle').textContent='배너 편집';
    document.getElementById('bannerTitleKo').value=b.titleKo;
    document.getElementById('bannerTitleEn').value=b.titleEn;
    document.getElementById('bannerLink').value=b.link;
    document.getElementById('bannerOrder').value=b.order;
    document.getElementById('bannerActive').checked=b.active;
    document.getElementById('bannerStart').value=b.start||'';
    document.getElementById('bannerEnd').value=b.end||'';
    // Set type radio
    document.querySelectorAll('#bannerModal input[name=bannerType]').forEach(function(r){
      if(r.value===b.type){r.checked=true;r.parentElement.classList.add('sel');}
    });
    document.getElementById('bannerImgPreview').innerHTML='<img loading="lazy" src="'+b.img+'" style="max-width:100%;max-height:120px;object-fit:cover"><div class="pe-upload-text" style="margin-top:6px;font-size:10px">클릭하여 변경</div>';
    document.getElementById('bannerDateRow').style.display=b.type==='이벤트'?'grid':'none';
  } else {
    document.getElementById('bannerModalTitle').textContent='배너 추가';
    document.getElementById('bannerTitleKo').value='';
    document.getElementById('bannerTitleEn').value='';
    document.getElementById('bannerLink').value='';
    document.getElementById('bannerOrder').value=banners.filter(function(b){return b.type===currentBannerFilter}).length+1;
    document.getElementById('bannerActive').checked=true;
    document.getElementById('bannerStart').value='';
    document.getElementById('bannerEnd').value='';
    document.getElementById('bannerImgPreview').innerHTML='<div class="pe-upload-text">클릭하여 배너 이미지 업로드</div><div class="pe-upload-hint">권장: 1920×600px 이상</div>';
    // Set current filter type
    document.querySelectorAll('#bannerModal input[name=bannerType]').forEach(function(r){
      if(r.value===currentBannerFilter){r.checked=true;r.parentElement.classList.add('sel');}
    });
    document.getElementById('bannerDateRow').style.display=currentBannerFilter==='이벤트'?'grid':'none';
  }
  // Show/hide date row based on type
  document.querySelectorAll('#bannerModal input[name=bannerType]').forEach(function(r){
    r.addEventListener('change',function(){document.getElementById('bannerDateRow').style.display=this.value==='이벤트'?'grid':'none';});
  });
  document.getElementById('bannerModal').classList.add('show');
}

function closeBannerModal(){document.getElementById('bannerModal').classList.remove('show');}

function previewBannerImg(input){
  if(input.files&&input.files[0]){
    var reader=new FileReader();
    reader.onload=function(e){
      document.getElementById('bannerImgPreview').innerHTML='<img loading="lazy" src="'+e.target.result+'" style="max-width:100%;max-height:120px;object-fit:cover"><div class="pe-upload-text" style="margin-top:6px;font-size:10px">클릭하여 변경</div>';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function saveBanner(){
  var type='메인';
  document.querySelectorAll('#bannerModal input[name=bannerType]').forEach(function(r){if(r.checked) type=r.value;});
  var obj={
    type:type,
    titleKo:document.getElementById('bannerTitleKo').value,
    titleEn:document.getElementById('bannerTitleEn').value,
    link:document.getElementById('bannerLink').value,
    order:Number(document.getElementById('bannerOrder').value),
    active:document.getElementById('bannerActive').checked,
    start:document.getElementById('bannerStart').value,
    end:document.getElementById('bannerEnd').value
  };
  if(!obj.titleKo){alert('제목을 입력해 주세요.');return;}
  if(editBannerIdx>=0){
    obj.id=banners[editBannerIdx].id;
    obj.img=banners[editBannerIdx].img;
    banners[editBannerIdx]=obj;
  } else {
    obj.id=banners.length?Math.max(...banners.map(b=>b.id))+1:1;
    obj.img='https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/yo_10_c3a703df29.jpg'; // placeholder
    banners.push(obj);
  }
  currentBannerFilter=obj.type;
  // Update filter buttons
  document.querySelectorAll('#t-banners .tf').forEach(function(f){
    f.classList.remove('on');
    if(f.textContent===currentBannerFilter) f.classList.add('on');
  });
  renderBanners();
  closeBannerModal();
}

function deleteBanner(idx){
  if(!confirm('"'+banners[idx].titleKo+'" 배너를 삭제하시겠습니까?')) return;
  banners.splice(idx,1);
  renderBanners();
}

renderBanners();

// ======== LOADING IMAGES ========
var loadingImgs=[];
function renderLoadingImgs(){
  var grid=document.getElementById('loadingGrid');if(!grid)return;
  grid.innerHTML='';
  loadingImgs.forEach(function(img,i){
    grid.innerHTML+='<div style="width:150px;background:var(--surface);border:1px solid var(--border);padding:10px;text-align:center"><img loading="lazy" src="'+img.url+'" style="width:100%;height:110px;object-fit:cover;margin-bottom:8px;border:1px solid var(--border)"><div style="font-size:10px;font-weight:600;margin-bottom:8px;color:'+(img.active?'var(--green)':'var(--red)')+'">'+(img.active?'✓ 활성':'✗ 비활성')+'</div><div style="display:flex;gap:4px;justify-content:center"><button class="btn btn-sm" onclick="loadingImgs['+i+'].active=!loadingImgs['+i+'].active;renderLoadingImgs()">'+(img.active?'비활성화':'활성화')+'</button><button class="btn btn-sm btn-red" onclick="if(confirm(\'삭제하시겠습니까?\')){loadingImgs.splice('+i+',1);renderLoadingImgs();}">삭제</button></div></div>';
  });
}
function addLoadingImg(){
  alert('이미지 업로드 (실제 운영 시 S3에 업로드됩니다)');
  loadingImgs.push({id:Date.now(),url:'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_9a20ac2301.jpg',active:true});
  renderLoadingImgs();
}
renderLoadingImgs();

// ======== COMPANY INFO (About / Business / Contact) ========
var companyImages={about:[],business:[],contact:[]};

function renderCompanyImages(page){
  var container=document.getElementById(page+'Images');
  if(!container) return;
  container.innerHTML='';
  (companyImages[page]||[]).forEach(function(url,i){
    container.innerHTML+='<div class="pe-gallery-item" style="width:120px;height:80px"><img loading="lazy" src="'+url+'" style="width:100%;height:100%;object-fit:cover"><button class="pe-gallery-del" onclick="removeCompanyImage(\''+page+'\','+i+')">×</button></div>';
  });
  container.innerHTML+='<div class="pe-gallery-add" style="width:120px;height:80px" onclick="addCompanyImage(\''+page+'\')"><span>+ 추가</span></div>';
}

function addCompanyImage(page){
  var input=document.createElement('input');
  input.type='file';input.accept='image/*';
  input.onchange=function(){
    if(this.files&&this.files[0]){
      var reader=new FileReader();
      reader.onload=function(e){
        companyImages[page].push(e.target.result);
        renderCompanyImages(page);
      };
      reader.readAsDataURL(this.files[0]);
    }
  };
  input.click();
}

function removeCompanyImage(page,idx){
  if(!confirm('이 이미지를 삭제하시겠습니까?')) return;
  companyImages[page].splice(idx,1);
  renderCompanyImages(page);
}

function saveCompanyInfo(page){
  var labels={about:'회사 소개',business:'비즈니스',contact:'문의하기'};
  var koEl=document.getElementById(page+'Ko');
  var enEl=document.getElementById(page+'En');
  if(!koEl||!enEl){alert('오류가 발생했습니다.');return;}
  var ko=koEl.value.trim();
  var en=enEl.value.trim();
  if(!ko&&!en){alert('콘텐츠를 입력해 주세요.');return;}
  var imgCount=companyImages[page].length;
  var msg='✓ '+labels[page]+' 페이지가 저장되었습니다.\n\n';
  msg+='한국어: '+ko.substring(0,50)+(ko.length>50?'...':'')+'\n';
  msg+='영어: '+en.substring(0,50)+(en.length>50?'...':'')+'\n';
  msg+='이미지: '+imgCount+'개\n\n';
  msg+='→ 실제 운영 시: API를 통해 DB에 저장되고 프론트엔드에 즉시 반영됩니다.';
  alert(msg);
}

renderCompanyImages('about');
renderCompanyImages('business');
renderCompanyImages('contact');

// ======== MENU CATEGORIES (Hamburger Nav) ========
var menuCats=[
  {id:1,name:'COMMUNITY',link:'community.html',style:'빨간색 (강조)',active:true,order:1},
  {id:2,name:'EDITORIAL',link:'#editorials',style:'기본 (검정)',active:true,order:2},
  {id:3,name:'ARTICLE',link:'#',style:'기본 (검정)',active:true,order:3},
  {id:4,name:'FILM',link:'#films',style:'기본 (검정)',active:true,order:4}
];

function renderMenuCats(){
  var tb=document.getElementById('menuCatBody');
  tb.innerHTML='';
  menuCats.sort(function(a,b){return a.order-b.order;});
  menuCats.forEach(function(m,i){
    tb.innerHTML+='<tr><td>'+m.order+'</td><td style="font-weight:700;letter-spacing:.04em'+(m.style.indexOf('빨간')>-1?';color:var(--red)':'')+'">'+m.name+'</td><td><input class="pe-input" value="'+m.link+'" style="width:200px;padding:5px 8px" onchange="menuCats['+i+'].link=this.value"></td><td><select class="pe-select" style="width:140px;padding:5px 8px" onchange="menuCats['+i+'].style=this.value;renderMenuCats()"><option'+(m.style.indexOf('기본')>-1?' selected':'')+'>기본 (검정)</option><option'+(m.style.indexOf('빨간')>-1?' selected':'')+'>빨간색 (강조)</option><option'+(m.style.indexOf('회색')>-1?' selected':'')+'>회색 (비활성)</option></select></td><td><label class="pe-check" style="justify-content:center"><input type="checkbox" '+(m.active?'checked':'')+' onchange="menuCats['+i+'].active=this.checked"></label></td><td><button class="btn btn-sm" onclick="editMenuCat('+i+')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteMenuCat('+i+')">삭제</button></td></tr>';
  });
}

function addMenuCat(){
  var name=prompt('메뉴 이름을 입력하세요 (예: BEAUTY, INTERVIEW):');
  if(!name) return;
  var link=prompt('링크 URL을 입력하세요 (예: #beauty, beauty.html):','#');
  menuCats.push({id:Date.now(),name:name.toUpperCase(),link:link||'#',style:'기본 (검정)',active:true,order:menuCats.length+1});
  renderMenuCats();
}

function editMenuCat(i){
  var name=prompt('메뉴 이름:',menuCats[i].name);
  if(name) menuCats[i].name=name.toUpperCase();
  var order=prompt('순서 (숫자):',menuCats[i].order);
  if(order) menuCats[i].order=Number(order);
  renderMenuCats();
}

function deleteMenuCat(i){
  if(!confirm('"'+menuCats[i].name+'" 메뉴를 삭제하시겠습니까?')) return;
  menuCats.splice(i,1);
  renderMenuCats();
}

renderMenuCats();

// ======== COVER SETTINGS ========
var coverSlides=[];

function renderCovers(){
  var el=document.getElementById('coverList');
  el.innerHTML='';
  coverSlides.forEach(function(s,i){
    el.innerHTML+='<div style="background:var(--surface);border:1px solid var(--border);padding:20px;margin-bottom:12px;display:flex;gap:20px;align-items:flex-start">'
      +'<div style="flex-shrink:0;position:relative;cursor:pointer" onclick="changeCoverImg('+i+')">'
      +'<img loading="lazy" src="'+s.img+'" style="width:180px;height:110px;object-fit:cover;border:1px solid var(--border)">'
      +'<div style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;font-size:9px;padding:2px 6px">변경</div></div>'
      +'<div style="flex:1">'
      +'<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center"><span style="font-size:10px;font-weight:700;color:var(--text3);width:50px">발행호</span><input class="pe-input" value="'+s.issue+'" style="padding:6px 10px" onchange="coverSlides['+i+'].issue=this.value"></div>'
      +'<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center"><span style="font-size:10px;font-weight:700;color:var(--text3);width:50px">제목</span><input class="pe-input" value="'+s.title+'" style="padding:6px 10px" onchange="coverSlides['+i+'].title=this.value"></div>'
      +'<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center"><span style="font-size:10px;font-weight:700;color:var(--text3);width:50px">링크</span><input class="pe-input" value="'+(s.link||'')+'" placeholder="클릭 시 이동할 URL (선택)" style="padding:6px 10px" onchange="coverSlides['+i+'].link=this.value"></div>'
      +'<div style="display:flex;gap:6px;align-items:center">'
      +'<label class="pe-check"><input type="checkbox" '+(s.active?'checked':'')+' onchange="coverSlides['+i+'].active=this.checked"> 활성</label>'
      +'<div style="flex:1"></div>'
      +'<button class="btn btn-sm" onclick="moveCover('+i+',-1)">↑</button>'
      +'<button class="btn btn-sm" onclick="moveCover('+i+',1)">↓</button>'
      +'<button class="btn btn-sm btn-red" onclick="deleteCover('+i+')">삭제</button>'
      +'</div></div></div>';
  });
}

function changeCoverImg(i){
  var input=document.createElement('input');
  input.type='file';input.accept='image/*';
  input.onchange=function(){
    if(this.files&&this.files[0]){
      var reader=new FileReader();
      reader.onload=function(e){coverSlides[i].img=e.target.result;renderCovers();};
      reader.readAsDataURL(this.files[0]);
    }
  };
  input.click();
}

function addCoverSlide(){
  coverSlides.push({id:Date.now(),img:'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/yo_10_c3a703df29.jpg',issue:'NEW ISSUE',title:'새 커버',link:'',active:true});
  renderCovers();
}

function deleteCover(i){
  if(!confirm('이 커버 슬라이드를 삭제하시겠습니까?')) return;
  coverSlides.splice(i,1);
  renderCovers();
}

function moveCover(i,dir){
  var j=i+dir;
  if(j<0||j>=coverSlides.length) return;
  var tmp=coverSlides[i];
  coverSlides[i]=coverSlides[j];
  coverSlides[j]=tmp;
  renderCovers();
}

renderCovers();

// ======== SHORTS API ========
async function loadShortsFromAPI(){
  var tb=document.getElementById('shortsListBody');if(!tb)return;
  tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:40px">불러오는 중...</td></tr>';
  try{
    var pub=await apiGet('/shorts?limit=100&status=published');
    var draft=await apiGet('/shorts?limit=100&status=draft');
    shortsList=(pub.data||[]).concat(draft.data||[]);
    renderShortsFromAPI();
  }catch(e){
    tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:40px 0">숏츠가 없습니다</td></tr>';
  }
}
function renderShortsFromAPI(){
  var tb=document.getElementById('shortsListBody');if(!tb)return;tb.innerHTML='';
  if(!shortsList.length){tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:40px 0">숏츠가 없습니다</td></tr>';return;}
  shortsList.forEach(function(s,i){
    var yt=s.youtube_id||s.yt||'';
    var st=s.status||'published';
    tb.innerHTML+='<tr><td style="font-size:10px">'+(s.id?s.id.substring(0,8):'—')+'</td><td class="td-title" onclick="openShortsModal('+i+')">'+esc(s.title)+'</td><td style="font-size:11px">'+esc(yt)+'</td><td><span style="font-size:10px;color:var(--green)">메인 화면 인라인</span></td><td><span class="badge '+(st==='published'?'b-published':'b-draft')+'">'+(st==='published'?'공개':'비공개')+'</span></td><td><button class="btn btn-sm" onclick="openShortsModal('+i+')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteShortsAPI('+i+')">삭제</button></td></tr>';
  });
}
async function deleteShortsAPI(i){
  if(!shortsList[i])return;
  if(!confirm('"'+shortsList[i].title+'" 을 삭제하시겠습니까?'))return;
  try{await apiDelete('/shorts/'+shortsList[i].id);shortsList.splice(i,1);renderShortsFromAPI();}catch(e){alert('삭제 실패');}
}

// ======== COMMUNITY API ========
async function loadCommunity(){
  var postsTb=document.querySelector('#t-community tbody');
  var statEls=document.querySelectorAll('#t-community .stat-n');
  try{
    var res=await apiGet('/community/posts?page=1');
    var posts=res.data||res.posts||[];
    var total=res.pagination?res.pagination.total:posts.length;
    if(statEls[0])statEls[0].textContent=total;
    if(!posts.length){postsTb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px 0">게시글이 없습니다</td></tr>';return;}
    postsTb.innerHTML='';
    posts.forEach(function(p){
      var author=p.profiles?p.profiles.name:'—';
      postsTb.innerHTML+='<tr><td class="td-title">'+esc(p.title||'')+'</td><td>'+esc(author)+'</td><td>'+esc(p.tag||'')+'</td><td>'+(p.likes_count||0)+'</td><td>'+(p.comments_count||0)+'</td><td>'+(p.views_count||0)+'</td><td>'+fmtDate(p.created_at)+'</td><td><button class="btn btn-sm btn-red" onclick="deleteCommunityPost(\''+p.id+'\')">삭제</button></td></tr>';
    });
  }catch(e){
    if(postsTb)postsTb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px 0">게시글이 없습니다</td></tr>';
  }
}
async function deleteCommunityPost(id){
  if(!confirm('이 게시글을 삭제하시겠습니까?'))return;
  try{await apiDelete('/community/posts/'+id);loadCommunity();}catch(e){alert('삭제 실패');}
}

// ======== SUBSCRIPTIONS ========
async function loadSubscriptions(){
  var statEls=document.querySelectorAll('#t-subscriptions .stat-n');
  try{
    // Use member data for subscription stats
    if(!allMembers.length){
      var resp=await apiGet('/admin/members');
      allMembers=resp.members||resp||[];
    }
    var std=allMembers.filter(function(m){return m.subscription_plan&&m.subscription_plan.indexOf('standard')>-1;}).length;
    var prem=allMembers.filter(function(m){return m.subscription_plan&&m.subscription_plan.indexOf('premium')>-1;}).length;
    if(statEls[0])statEls[0].textContent=std;
    if(statEls[1])statEls[1].textContent=prem;
  }catch(e){console.error('Subscriptions load error:',e);}
}

// ======== PAGINATION SUPPORT ========
var edPage=1,newsPage=1,filmPage=1;
async function loadEditorialsPage(page){
  edPage=page||1;
  var tb=document.getElementById('edListBody');if(!tb)return;
  tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px">불러오는 중...</td></tr>';
  try{
    var pub=await apiGet('/editorials?limit=25&page='+edPage+'&status=published');
    var draft=edPage===1?await apiGet('/editorials?limit=25&status=draft'):{data:[]};
    editorials=(pub.data||[]).concat(draft.data||[]);
    renderEditorialList();
    var totalPages=pub.pagination?pub.pagination.pages:1;
    renderPagination('edPaginationArea',edPage,totalPages,function(p){loadEditorialsPage(p);});
  }catch(e){tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:#ff6b6b;padding:40px">불러오기 실패</td></tr>';}
}
function renderPagination(containerId,current,total,callback){
  var el=document.getElementById(containerId);
  if(!el){
    // Create pagination area
    var parent=document.getElementById('edListBody');
    if(!parent)return;
    var wrap=parent.closest('.tbl-wrap');
    if(!wrap)return;
    el=document.createElement('div');
    el.id=containerId;
    el.style.cssText='padding:12px 18px;display:flex;gap:4px;justify-content:center;border-top:1px solid var(--border)';
    wrap.appendChild(el);
  }
  if(total<=1){el.innerHTML='';return;}
  var h='';
  if(current>1)h+='<button class="btn btn-sm" onclick="window._pgCb'+containerId+'('+(current-1)+')">← 이전</button>';
  h+='<span style="padding:5px 10px;font-size:11px;color:var(--text3)">'+current+' / '+total+'</span>';
  if(current<total)h+='<button class="btn btn-sm" onclick="window._pgCb'+containerId+'('+(current+1)+')">다음 →</button>';
  el.innerHTML=h;
  window['_pgCb'+containerId]=callback;
}

// ======== SETTINGS PERSISTENCE (localStorage) ========
// Save banners, covers, loading images, menu cats to localStorage
function saveBannerOrig(){saveBanner();}
var _origSaveBanner=null;
function persistSettings(){
  lsSet('banners',banners);
  lsSet('coverSlides',coverSlides);
  lsSet('loadingImgs',loadingImgs);
  lsSet('menuCats',menuCats);
}
// Load settings from localStorage on init
(function(){
  var b=lsGet('banners',null);if(b&&b.length)banners=b;
  var c=lsGet('coverSlides',null);if(c&&c.length)coverSlides=c;
  var l=lsGet('loadingImgs',null);if(l&&l.length)loadingImgs=l;
  var m=lsGet('menuCats',null);if(m&&m.length)menuCats=m;
  renderBanners();renderCovers();renderLoadingImgs();renderMenuCats();
})();
// Override save functions to also persist
var _origSaveBannerFn=saveBanner;
saveBanner=function(){_origSaveBannerFn();persistSettings();};
var _origSaveCat=saveCat;
saveCat=function(){_origSaveCat();persistSettings();};
var _origAddCoverSlide=addCoverSlide;
addCoverSlide=function(){_origAddCoverSlide();persistSettings();};
var _origDeleteCover=deleteCover;
deleteCover=function(i){_origDeleteCover(i);persistSettings();};
var _origDeleteBanner=deleteBanner;
deleteBanner=function(i){_origDeleteBanner(i);persistSettings();};
var _origAddMenuCat=addMenuCat;
addMenuCat=function(){_origAddMenuCat();persistSettings();};
var _origDeleteMenuCat=deleteMenuCat;
deleteMenuCat=function(i){_origDeleteMenuCat(i);persistSettings();};
var _origAddLoadingImg=addLoadingImg;
addLoadingImg=function(){_origAddLoadingImg();persistSettings();};

// ======== UPDATED GO FUNCTION FOR NEW SECTIONS ========
var _originalGo=go;
go=function(id,el){
  _originalGo(id,el);
  if(id==='shorts') loadShortsFromAPI();
  if(id==='community') loadCommunity();
  if(id==='subscriptions') loadSubscriptions();
  if(id==='intads') renderAds();
};

// ======== INTERSTITIAL AD MANAGEMENT (backend-driven) ========
// All ads now live in Supabase (table: interstitial_ads). The admin reads
// /api/admin/ads (which returns ALL ads, including inactive ones) and writes
// via POST/PUT/DELETE. The public /api/ads endpoint only returns active ones
// and is consumed by pap-app.js / pap-ads.js across every page.
var intAds=[];
var editAdId=null; // UUID of the ad being edited; null when creating

async function renderAds(){
  var tb=document.getElementById('adTableBody');
  if(!tb)return;
  tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px 0">로딩 중…</td></tr>';
  try{
    var res=await apiGet('/admin/ads');
    intAds=(res&&res.ads)?res.ads:[];
  }catch(e){
    console.error('[ads] load failed',e);
    tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--red);padding:40px 0">광고 목록을 불러오지 못했습니다</td></tr>';
    return;
  }
  var activeCount=intAds.filter(function(a){return a.active}).length;
  var ct=document.getElementById('adCount');if(ct)ct.textContent=intAds.length;
  var ac=document.getElementById('adActiveCount');if(ac)ac.textContent=activeCount;
  if(intAds.length===0){
    tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px 0">광고를 추가하세요</td></tr>';
    return;
  }
  // Backend already returns ads sorted by sort_order, created_at
  tb.innerHTML='';
  intAds.forEach(function(ad,i){
    var thumb=ad.type==='video'
      ?(ad.poster?'<img loading="lazy" src="'+esc(ad.poster)+'" style="width:80px;height:50px;object-fit:cover">':'<div style="width:80px;height:50px;background:#222;display:flex;align-items:center;justify-content:center;font-size:9px;color:#666">VIDEO</div>')
      :'<img loading="lazy" src="'+esc(ad.src)+'" style="width:80px;height:50px;object-fit:cover">';
    var linkText=ad.link||'';
    var shortLink=linkText.length>25?linkText.substring(0,25)+'...':linkText;
    tb.innerHTML+='<tr>'+
      '<td>'+(ad.sort_order||i+1)+'</td>'+
      '<td>'+thumb+'</td>'+
      '<td><span style="display:inline-block;padding:2px 8px;font-size:9px;font-weight:700;letter-spacing:.1em;border-radius:2px;background:'+(ad.type==='video'?'var(--purple)':'var(--blue)')+';color:#fff">'+(ad.type==='video'?'VIDEO':'IMAGE')+'</span></td>'+
      '<td style="font-weight:600">'+esc(ad.brand||'—')+'</td>'+
      '<td style="font-size:11px;color:var(--text2)">'+esc(shortLink)+'</td>'+
      '<td>'+(ad.duration||3)+'초</td>'+
      '<td>'+(ad.active?'<span style="color:var(--green);font-weight:700">✓</span>':'<span style="color:var(--red)">✗</span>')+'</td>'+
      '<td><button class="btn btn-sm" onclick="openAdModal(\''+ad.id+'\')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteAd(\''+ad.id+'\')">삭제</button></td>'+
    '</tr>';
  });
}

function toggleAdPoster(){
  var isVideo=false;
  document.querySelectorAll('#adModal input[name=adType]').forEach(function(r){if(r.checked&&r.value==='video')isVideo=true;});
  document.getElementById('adPosterSection').style.display=isVideo?'block':'none';
}

function openAdModal(id){
  editAdId=id||null;
  document.querySelectorAll('#adModal .pe-radio').forEach(function(r){r.classList.remove('sel');});
  // Reset upload status
  var us=document.getElementById('adUploadStatus');if(us)us.textContent='';
  var ps=document.getElementById('adPosterUploadStatus');if(ps)ps.textContent='';
  var fileInput=document.getElementById('adFile');if(fileInput)fileInput.value='';
  var posterInput=document.getElementById('adPosterFile');if(posterInput)posterInput.value='';
  if(id){
    var ad=intAds.find(function(a){return a.id===id});
    if(!ad){alert('광고를 찾을 수 없습니다.');return;}
    document.getElementById('adModalTitle').textContent='광고 편집';
    document.getElementById('adBrand').value=ad.brand||'';
    document.getElementById('adSrc').value=ad.src||'';
    document.getElementById('adPoster').value=ad.poster||'';
    document.getElementById('adLink').value=ad.link||'';
    document.getElementById('adDuration').value=ad.duration||3;
    document.getElementById('adOrder').value=ad.sort_order||0;
    document.getElementById('adActive').checked=ad.active!==false;
    document.querySelectorAll('#adModal input[name=adType]').forEach(function(r){
      if(r.value===(ad.type||'image')){r.checked=true;r.parentElement.classList.add('sel');}
    });
  } else {
    document.getElementById('adModalTitle').textContent='광고 추가';
    document.getElementById('adBrand').value='';
    document.getElementById('adSrc').value='';
    document.getElementById('adPoster').value='';
    document.getElementById('adLink').value='';
    document.getElementById('adDuration').value=3;
    document.getElementById('adOrder').value=intAds.length+1;
    document.getElementById('adActive').checked=true;
    document.querySelectorAll('#adModal input[name=adType]').forEach(function(r){
      if(r.value==='image'){r.checked=true;r.parentElement.classList.add('sel');}
    });
  }
  toggleAdPoster();
  document.getElementById('adPreviewSection').style.display='none';
  document.getElementById('adModal').classList.add('show');
}

function closeAdModal(){document.getElementById('adModal').classList.remove('show');}

function previewAd(){
  var src=document.getElementById('adSrc').value.trim();
  if(!src){alert('이미지/비디오 URL을 입력하세요.');return;}
  var box=document.getElementById('adPreviewBox');
  var isVideo=false;
  document.querySelectorAll('#adModal input[name=adType]').forEach(function(r){if(r.checked&&r.value==='video')isVideo=true;});
  if(isVideo){
    box.innerHTML='<video src="'+src+'" style="max-width:100%;max-height:180px" controls muted></video>';
  } else {
    box.innerHTML='<img src="'+src+'" style="max-width:100%;max-height:180px;object-fit:contain">';
  }
  document.getElementById('adPreviewSection').style.display='block';
}

// ── Ad-creative file upload (signed URL → direct PUT to Supabase) ──
async function _uploadAdCreative(file){
  // 1) Ask the API for a signed upload URL.
  var meta=await apiPost('/admin/ads/upload-url',{name:file.name,type:file.type,size:file.size});
  if(!meta||!meta.signedUrl){
    throw new Error((meta&&meta.message)||'업로드 URL 생성 실패');
  }
  // 2) PUT the binary directly to Supabase Storage. This bypasses the
  //    Vercel 4.5 MB body limit and lets us push videos up to 50 MB.
  var put=await fetch(meta.signedUrl,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
  if(!put.ok){
    var t=await put.text().catch(function(){return ''});
    throw new Error('Storage 업로드 실패 ('+put.status+') '+t);
  }
  return meta.publicUrl||'';
}

async function uploadAdFile(input){
  var file=input&&input.files&&input.files[0];
  if(!file)return;
  var status=document.getElementById('adUploadStatus');
  status.textContent='업로드 중… ('+Math.round(file.size/1024)+' KB)';
  status.style.color='var(--text3)';
  try{
    var url=await _uploadAdCreative(file);
    document.getElementById('adSrc').value=url;
    // Auto-detect video and switch the type radio
    if(file.type&&file.type.indexOf('video/')===0){
      document.querySelectorAll('#adModal input[name=adType]').forEach(function(r){
        r.checked=(r.value==='video');
        if(r.checked){r.parentElement.classList.add('sel');}else{r.parentElement.classList.remove('sel');}
      });
      toggleAdPoster();
    }
    status.textContent='✓ 업로드 완료';
    status.style.color='var(--green)';
  }catch(e){
    console.error('[ads] upload failed',e);
    status.textContent='✗ '+(e.message||'업로드 실패');
    status.style.color='var(--red)';
  }
}

async function uploadAdPosterFile(input){
  var file=input&&input.files&&input.files[0];
  if(!file)return;
  var status=document.getElementById('adPosterUploadStatus');
  status.textContent='업로드 중… ('+Math.round(file.size/1024)+' KB)';
  status.style.color='var(--text3)';
  try{
    var url=await _uploadAdCreative(file);
    document.getElementById('adPoster').value=url;
    status.textContent='✓ 업로드 완료';
    status.style.color='var(--green)';
  }catch(e){
    console.error('[ads] poster upload failed',e);
    status.textContent='✗ '+(e.message||'업로드 실패');
    status.style.color='var(--red)';
  }
}

async function saveAd(){
  var type='image';
  document.querySelectorAll('#adModal input[name=adType]').forEach(function(r){if(r.checked)type=r.value;});
  var brand=document.getElementById('adBrand').value.trim();
  var src=document.getElementById('adSrc').value.trim();
  var poster=document.getElementById('adPoster').value.trim();
  var link=document.getElementById('adLink').value.trim();
  var duration=parseInt(document.getElementById('adDuration').value)||3;
  var sort_order=parseInt(document.getElementById('adOrder').value)||0;
  var active=document.getElementById('adActive').checked;
  if(!src){alert('이미지/비디오 파일을 업로드하거나 URL을 입력하세요.');return;}
  if(!brand){alert('브랜드명을 입력하세요.');return;}
  var payload={type:type,src:src,poster:poster,link:link,brand:brand,duration:duration,sort_order:sort_order,active:active};
  try{
    var res;
    if(editAdId){
      res=await apiPut('/admin/ads/'+editAdId,payload);
    } else {
      res=await apiPost('/admin/ads',payload);
    }
    if(res&&res.message&&!res.ad){
      alert('저장 실패: '+res.message);
      return;
    }
    closeAdModal();
    await renderAds();
  }catch(e){
    console.error('[ads] save failed',e);
    alert('저장 실패: '+(e.message||e));
  }
}

async function deleteAd(id){
  if(!confirm('이 광고를 삭제하시겠습니까?'))return;
  try{
    var res=await apiDelete('/admin/ads/'+id);
    if(res&&res.message&&!res.ok){
      alert('삭제 실패: '+res.message);
      return;
    }
    await renderAds();
  }catch(e){
    console.error('[ads] delete failed',e);
    alert('삭제 실패: '+(e.message||e));
  }
}
