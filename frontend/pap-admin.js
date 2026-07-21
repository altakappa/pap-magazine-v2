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
async function apiPatch(path,body){var r=await fetch(API_BASE+path,{method:'PATCH',headers:apiHeaders(),body:JSON.stringify(body)});return r.json();}
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
  // QA #254 v3 — initial sync of insta logo status badge (defer so
  // the function definition below is registered first).
  setTimeout(function(){
    if (typeof _papInstaUpdateLogoStatusUI === 'function') _papInstaUpdateLogoStatusUI();
  }, 0);
  if(typeof PAP!=='undefined'){
    if(!PAP.auth.isLoggedIn()){
      window.location.href='/auth?redirect=admin';
      return;
    }
    var user=PAP.auth.getUser();
    // QA #169 — admin page is accessible to BOTH 대표 ('admin') and 스태프
    // ('staff'). The UI itself is gated per-action below.
    if(!user || (user.role!=='admin' && user.role!=='staff')){
      document.body.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Montserrat,sans-serif;color:#fff;background:#000;flex-direction:column"><h1 style="font-size:18px;letter-spacing:.15em">ACCESS DENIED</h1><p style="margin-top:12px;font-size:12px;color:rgba(255,255,255,.4)">Admin privileges required.</p><a href="/" style="margin-top:24px;color:#fff;font-size:11px;letter-spacing:.1em">← BACK TO MAGAZINE</a></div>';
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

// QA #218 — three-role model (Main Admin / Sub Admin / Member). The
// legacy 'contributor' key is mapped onto 'member' so old DB rows or
// API responses still render correctly without the role appearing in
// any UI selector.
//   admin       → 대표 관리자 (Red)
//   staff       → 서브 관리자 (Blue)
//   member      → 일반 회원 (Gray)
//   contributor → (legacy alias for member)
var PAP_ROLE_META = {
  admin:  { label: '대표 관리자', short: '대표', cls: 'b-role-admin',  sbCls: 'sb-role-admin' },
  staff:  { label: '서브 관리자', short: '서브', cls: 'b-role-staff',  sbCls: 'sb-role-staff' },
  member: { label: '일반 회원',   short: '회원', cls: 'b-role-member', sbCls: 'sb-role-member' },
};
function papRoleMeta(role){
  if (role === 'contributor') return PAP_ROLE_META.member; // QA #218 legacy alias
  return PAP_ROLE_META[role] || PAP_ROLE_META.member;
}
window.PAP_ROLE_META = PAP_ROLE_META;
window.papRoleMeta = papRoleMeta;

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
  // QA #217 — sidebar role badge driven by the shared meta map. Strips
  // any prior inline colour overrides so the CSS class wins (the old
  // implementation set color/borderColor inline and broke the new
  // unified palette).
  var badge = document.getElementById('sbRoleBadge');
  if(badge){
    var meta = papRoleMeta(role);
    badge.textContent = meta.label;
    badge.className = 'badge ' + meta.sbCls;
    badge.style.color = '';
    badge.style.background = '';
    badge.style.borderColor = '';
    badge.style.display = 'block';
  }
}

// ======== MEMBER MANAGEMENT (Supabase) ========
var allMembers=[];
var memberFilter='all';
var _apiBase=(window.PAP_CONFIG&&window.PAP_CONFIG.API_BASE)||'/api';

// QA #325 — 회원 목록 페이지네이션 상태. `/admin/members` 는 서버측
// 페이지네이션을 지원하지 않으므로 클라이언트에서 filtered 배열을 slice.
// perPage 값은 localStorage 에 저장해서 새로고침해도 유지.
var _memberLimit = (function(){
  try {
    var saved = parseInt(localStorage.getItem('pap-member-limit'), 10);
    if(saved === 10 || saved === 30 || saved === 50 || saved === 100) return saved;
  } catch(_){}
  return 30;
})();
var _memberPage = 1;

function setMemberLimit(n){
  n = parseInt(n, 10);
  if(!n || [10,30,50,100].indexOf(n) === -1) n = 30;
  _memberLimit = n;
  try { localStorage.setItem('pap-member-limit', String(n)); } catch(_){}
  _memberPage = 1; // perPage 바뀌면 첫 페이지로 리셋
  renderMembers();
}
window.setMemberLimit = setMemberLimit;

function goMemberPage(p){
  p = parseInt(p, 10);
  if(!p || p < 1) p = 1;
  _memberPage = p;
  renderMembers();
  // 목록 상단으로 스크롤 — 대량 페이지 이동 시 사용자 위치 유지 UX.
  var top = document.querySelector('#t-users .tbl-wrap');
  if(top && top.scrollIntoView) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.goMemberPage = goMemberPage;

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

// QA #325 — 검색/필터 컨트롤이 이전에 renderMembers 를 직접 호출했지만,
// 페이지 상태를 함께 리셋하려면 반드시 이 wrapper 를 거쳐야 함.
// (검색어 입력 후 3페이지에 머무르면 "결과 없음" 처럼 보이는 UX 버그 방지)
function renderMembersFiltered(){
  _memberPage = 1;
  renderMembers();
}
window.renderMembersFiltered = renderMembersFiltered;

// 현재 검색/필터를 만족하는 회원 배열 반환 (렌더링 + 페이지네이터 공용).
function _computeFilteredMembers(){
  var searchVal=(document.getElementById('memberSearch')?document.getElementById('memberSearch').value:'').toLowerCase().trim();
  var roleVal=document.getElementById('memberRoleFilter')?document.getElementById('memberRoleFilter').value:'all';
  var statusVal=document.getElementById('memberStatusFilter')?document.getElementById('memberStatusFilter').value:'all';
  return allMembers.filter(function(m){
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
}

function renderMembers(){
  var filtered = _computeFilteredMembers();

  var tbody=document.getElementById('memberTableBody');
  // 페이지네이션 상태 정규화 — filter 로 전체 페이지 수가 줄어 현재 페이지가
  // 넘어가면 마지막 페이지로 붙임 (예: 3페이지 보다가 검색해서 총 2페이지).
  var total = filtered.length;
  var totalPages = Math.max(1, Math.ceil(total / _memberLimit));
  if(_memberPage > totalPages) _memberPage = totalPages;
  if(_memberPage < 1) _memberPage = 1;

  if(!total){
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text4);padding:40px">회원이 없습니다</td></tr>';
    _renderMemberPagination(_memberPage, totalPages, total);
    return;
  }

  var startIdx = (_memberPage - 1) * _memberLimit;
  var endIdx = Math.min(total, startIdx + _memberLimit);
  var pageSlice = filtered.slice(startIdx, endIdx);
  var h='';
  var esc=function(s){var d=document.createElement('div');d.textContent=s||'';return d.innerHTML;};
  // QA #217 — use the shared role-meta map so member table labels match
  // the sidebar badge and the public site exactly.
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
  for(var i=0;i<pageSlice.length;i++){
    var m=pageSlice[i];
    var plan=_getMemberPlan(m);
    var status=_getMemberStatus(m);
    var role=_getMemberRole(m);
    var planCls=plan.indexOf('premium')>-1?'b-premium':plan.indexOf('standard')>-1?'b-standard':'b-free';
    var planLabel=plan.indexOf('premium')>-1?'Premium':plan.indexOf('standard')>-1?'Standard':'Free';
    var statusCls=status==='active'?'b-active':status==='suspended'?'b-suspended':'b-inactive';
    var statusLabel=statusLabels[status]||status;
    // QA #217 — drive label + badge class from the shared meta map.
    var _roleMeta = papRoleMeta(role);
    var roleLabel = _roleMeta.label;
    var roleCls = _roleMeta.cls;
    // Members table — show date + time so admins can audit signup activity
    // precisely. Uses Korean locale so 'AM/PM' renders as 오전/오후.
    var date=_formatJoinedDateTime(m.joinedAt||m.created_at,'short');
    var mid=m.id;
    h+='<tr>';
    h+='<td>'+esc(m.name)+'</td>';
    h+='<td style="font-size:11px">'+esc(m.email)+'</td>';
    // QA #219 — creator recognition chip rendered next to the role badge.
    // Distinct purple icon-led tag so the admin can scan creators at a
    // glance; the tooltip carries the precise creator_since date.
    var creatorChip = '';
    if (m.isCreator) {
      var sinceStr = '';
      try {
        var _cs = m.creatorSince ? new Date(m.creatorSince) : null;
        if(_cs && !isNaN(_cs.getTime())){
          sinceStr = _cs.getFullYear() + '-' +
            String(_cs.getMonth()+1).padStart(2,'0') + '-' +
            String(_cs.getDate()).padStart(2,'0');
        }
      } catch(_){}
      creatorChip = ' <span class="badge" title="크리에이터 인증'+(sinceStr?' · '+sinceStr:'')+'" style="margin-left:4px;background:#7c3aed;color:#fff;border-color:#7c3aed;font-weight:700">🎨 크리에이터</span>';
    }
    h+='<td><span class="badge '+roleCls+'">'+esc(roleLabel)+'</span>'+creatorChip+'</td>';
    h+='<td><span class="badge '+planCls+'">'+planLabel+'</span></td>';
    h+='<td><span class="badge '+statusCls+'">'+statusLabel+'</span></td>';
    h+='<td style="font-size:11px">'+date+'</td>';
    h+='<td><button class="btn btn-sm" onclick="openMemberModal(\''+mid+'\')">편집</button></td>';
    h+='</tr>';
  }
  tbody.innerHTML=h;
  _renderMemberPagination(_memberPage, totalPages, total);
}

// QA #325 — 회원 목록 페이지네이터 (서브미션 페이지네이터와 동일한 레이아웃).
// tfoot 을 재사용해서 매 렌더마다 innerHTML 만 갈아치우는 방식.
function _renderMemberPagination(page, totalPages, total){
  var tbody = document.getElementById('memberTableBody');
  if(!tbody) return;
  var tableEl = tbody.closest('table');
  if(!tableEl) return;
  var existing = tableEl.querySelector('tfoot.member-pagination');

  // 페이지 번호 윈도우 — 활성 페이지 좌우 2개씩, 총 <=7 개.
  var WINDOW_RADIUS = 2;
  var pages = [];
  if(totalPages <= 7){
    for(var i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    var lo = Math.max(2, page - WINDOW_RADIUS);
    var hi = Math.min(totalPages - 1, page + WINDOW_RADIUS);
    if(lo > 2) pages.push('…');
    for(var j = lo; j <= hi; j++) pages.push(j);
    if(hi < totalPages - 1) pages.push('…');
    pages.push(totalPages);
  }

  var jump = function(p){ return 'onclick="goMemberPage('+p+')"'; };
  var btnBase = 'display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:28px;padding:0 8px;border:1px solid var(--border2);background:#fff;color:var(--text);font-size:11px;cursor:pointer;border-radius:3px';
  var btnActive = 'background:var(--purple);color:#fff;border-color:var(--purple);font-weight:700';
  var btnDisabled = 'opacity:.4;cursor:not-allowed';
  var ellipsis = '<span style="padding:0 6px;color:var(--text3)">…</span>';

  var numHtml = pages.map(function(p){
    if(p === '…') return ellipsis;
    var style = btnBase + (p === page ? ';' + btnActive : '');
    return '<button type="button" style="'+style+'" '+jump(p)+'>'+p+'</button>';
  }).join('');

  var firstStyle = btnBase + (page <= 1 ? ';' + btnDisabled : '');
  var prevStyle  = btnBase + (page <= 1 ? ';' + btnDisabled : '');
  var nextStyle  = btnBase + (page >= totalPages ? ';' + btnDisabled : '');
  var lastStyle  = btnBase + (page >= totalPages ? ';' + btnDisabled : '');

  var limitOptions = [10,30,50,100].map(function(n){
    var sel = n === _memberLimit ? ' selected' : '';
    return '<option value="'+n+'"'+sel+'>'+n+'개</option>';
  }).join('');

  var startIdx = total ? ((page - 1) * _memberLimit + 1) : 0;
  var endIdx = Math.min(total, page * _memberLimit);
  var rangeLabel = total
    ? ('<strong style="color:var(--text)">'+startIdx+'-'+endIdx+'</strong> / 총 <strong style="color:var(--text)">'+total+'</strong>명')
    : '결과 없음';

  var html =
    '<tr><td colspan="7" style="padding:14px 12px;border-top:1px solid var(--border);background:var(--surface)">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text3)">'+
        '<span>'+rangeLabel+'</span>'+
        '<span style="display:flex;gap:4px;align-items:center">'+
          '<button type="button" style="'+firstStyle+'" '+(page<=1?'disabled':jump(1))+' title="첫 페이지">«</button>'+
          '<button type="button" style="'+prevStyle+'" '+(page<=1?'disabled':jump(page-1))+' title="이전">‹</button>'+
          numHtml +
          '<button type="button" style="'+nextStyle+'" '+(page>=totalPages?'disabled':jump(page+1))+' title="다음">›</button>'+
          '<button type="button" style="'+lastStyle+'" '+(page>=totalPages?'disabled':jump(totalPages))+' title="마지막 페이지">»</button>'+
        '</span>'+
        '<span style="display:flex;align-items:center;gap:6px">'+
          '<label style="color:var(--text3)">페이지당</label>'+
          '<select onchange="setMemberLimit(this.value)" style="background:#fff;border:1px solid var(--border2);padding:5px 8px;border-radius:3px;font-size:11px;cursor:pointer">'+limitOptions+'</select>'+
        '</span>'+
      '</div>'+
    '</td></tr>';
  if(existing){
    existing.innerHTML = html;
  } else {
    var tf = document.createElement('tfoot');
    tf.className = 'member-pagination';
    tf.innerHTML = html;
    tableEl.appendChild(tf);
  }
}

function filterMembers(plan,btn){
  memberFilter=plan;
  document.querySelectorAll('#t-users .tbl-top .tf').forEach(function(b){b.classList.remove('on');});
  if(btn) btn.classList.add('on');
  _memberPage = 1; // QA #325 — 상단 필터 변경 시 첫 페이지로 리셋
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
    // QA #203 — when the backend signals that the target's JWT was
    // invalidated (role change), make the consequences explicit so the
    // admin knows the affected user must re-login for the new role to
    // take effect on the client.
    if (data && data.tokenInvalidated){
      alert('회원 권한이 변경되었습니다.\n\n'
        + '⚠ 해당 회원은 자동 로그아웃되었으며,\n'
        + '   다시 로그인해야 새 권한이 적용됩니다.\n\n'
        + '(현재 그 회원이 보고 있는 페이지는 다음 API 요청 시 401을 받아 로그인 화면으로 이동합니다.)');
    } else {
      alert('회원 정보가 업데이트되었습니다.');
    }
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

// QA(관리자 페이지) — 라우트/메뉴 전환 시 이전 화면의 모달·폼·에러 등
// 세션성 UI 가 잔존해 새 페이지에 겹쳐 보이던 문제 수정. go() 진입 시
// 열려 있던 모든 오버레이를 닫고 임시 상태를 초기화한다.
function _closeTransientAdminUI(){
  try {
    // pe-modal 계열(로딩 이미지 / 매거진 발행호 / 내비 메뉴) 오버레이 닫기
    document.querySelectorAll('.pe-modal').forEach(function(m){
      m.classList.remove('show');
      m.style.display = 'none';
    });
    // modal-bg 계열 오버레이 닫기
    document.querySelectorAll('.modal-bg.show').forEach(function(m){
      m.classList.remove('show');
    });
    // 로딩 이미지 등록 폼의 에러/상태 문구 초기화 — 다른 페이지로 이월 방지
    var errEl = document.getElementById('loadImgFormError');
    if(errEl){ errEl.style.display = 'none'; errEl.textContent = ''; }
    var stEl = document.getElementById('loadingUploadStatus');
    if(stEl){ stEl.textContent = ''; }
  } catch(_){}
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
  // QA(관리자 페이지) — 페이지 전환 시 이전 화면의 잔존 모달/폼/에러 제거·초기화
  _closeTransientAdminUI();
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
  // QA #252 — film editor lifecycle. Same shape as 'newpost' below:
  //   • entering 'newfilm' without editFilmId set ⇒ fresh form
  //   • leaving 'newfilm' while editFilmId is set ⇒ drop the sentinel
  //     so the next "+ 새 필름" click starts blank
  if(id==='newfilm'){
    if(typeof editFilmId !== 'undefined' && !editFilmId){
      if(typeof _resetFilmModalFields === 'function') _resetFilmModalFields();
      var filmTitleEl = document.getElementById('filmModalTitle');
      if(filmTitleEl){
        var auditBtn = document.getElementById('filmAuditBtn');
        filmTitleEl.firstChild && (filmTitleEl.firstChild.textContent = '필름 작성 ');
        // Hide the "수정 이력 보기" button on new-film entries — no id yet.
        if(auditBtn) auditBtn.style.display = 'none';
      }
    } else if(typeof editFilmId !== 'undefined' && editFilmId){
      var _auditBtn = document.getElementById('filmAuditBtn');
      if(_auditBtn) _auditBtn.style.display = '';
    }
  } else if(id !== 'newfilm' && typeof editFilmId !== 'undefined' && editFilmId){
    // Leaving the film editor while in an edit session — drop the
    // sentinel so the next "+ 새 필름" click triggers a fresh form.
    editFilmId = null;
    editFilmIdx = -1;
  }
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
      // QA #209 — hide the audit panel when creating a brand-new post;
      // there's no row to fetch history for yet.
      var auditPanel = document.getElementById('contentAuditPanel');
      if(auditPanel) auditPanel.style.display = 'none';
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

// ─── SUBMISSION-TYPE BADGE (표시 전용 / display-only) ────────────────────────
// The authoritative submission type is computed server-side
// (api/_lib/submissionType.js) and persisted inside the description JSON as
// `submissionType` ('free' | 'paid_few_looks' | 'branded'). These helpers only
// SURFACE that value in the admin UI so the editor can see the policy tier +
// indicative price at a glance. No schema/API/gate change — pure read+display.
//   paid_few_looks → 유료 · 소수 룩 €345 (강조: standard tone)
//   branded        → 브랜디드 €720      (강조: premium tone)
//   free / 값없음(구버전) / 알 수 없음 → 미표시(뱃지 없음) — 안전 처리
function _submissionTypeBadge(submissionType){
  var map={
    paid_few_looks: { cls:'b-standard', label:'유료 · 소수 룩 €345' },
    branded:        { cls:'b-premium',  label:'브랜디드 €720' }
  };
  var info=map[submissionType];
  if(!info) return '';
  return '<span class="badge '+info.cls+'" title="서브미션 유형 (표시 전용)">'+info.label+'</span>';
}
// Safely read submissionType out of a submission's description (string or object).
function _submissionTypeOf(s){
  if(!s) return '';
  var d=s.description;
  if(typeof d==='string'){ try{ d=JSON.parse(d); }catch(_){ return ''; } }
  return (d&&d.submissionType)||'';
}
function _isFeeRequiredType(t){
  var k=String(t==null?'':t).trim().toLowerCase().replace(/[\s-]+/g,'_');
  return k==='branded'||k==='paid_few_looks'||k==='few_looks'||k==='fewlooks';
}
// 게재료 미결제 서브미션의 에디토리얼 편집 진입 가드 (정책 A, 2026-07-21 QA).
// 하드 차단이 아니라 경고 — 오프라인/사전협의 결제를 관리자가 확인했으면 진행 가능.
function openEditorialEditorGuarded(editorialId){
  if(!window.confirm('\u26a0\ufe0f 이 서브미션은 게재료(브랜디드/유료)가 미결제 상태입니다.\n결제 완료가 확인되지 않았습니다. 그래도 에디토리얼 편집을 진행하시겠습니까?')) return;
  openEditorialEditor(editorialId);
}

// ─── PAYMENT-STATUS BADGE (표시 전용 / display-only) — 2b (2026-07-19) ────────
// 유료/브랜디드 서브미션 기본료의 결제 상태를 SURFACE 만 한다 (컬럼 payment_status).
// 결제 확정은 Paddle 웹훅(키퍼)이 payment_status 를 갱신 — 어드민은 읽기+표시 전용.
//   paid            → 결제완료 · €<실결제액> · 게재대기 (green)
//   awaiting_payment→ 결제대기                          (amber)
//   none / 값없음    → 미표시 (뱃지 없음) — 안전 처리
// 라벨은 코드 고정값 · payment_status 는 화이트리스트로만 매핑 → innerHTML 안전.
// paidAmount(유로 cents, 정수) 를 병기해 도메니코가 유형 뱃지의 기대금액
// (예: 브랜디드 €720)과 실결제액을 비교, 과소결제(€345만 결제 등)를 인지할 수 있게.
// cents→euros 는 /100, 정수 유로로 표기. 값 없거나 비정상이면 금액 생략(기존 라벨).
function _paymentStatusBadge(paymentStatus, paidAmount, submissionType){
  function _span(bg,bd,fg,label,title){
    return '<span title="'+(title||'결제 상태 (표시 전용)')+'" style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.02em;padding:2px 8px;border-radius:3px;background:'+bg+';border:1px solid '+bd+';color:'+fg+'">'+label+'</span>';
  }
  if(paymentStatus==='paid'){
    var cents=Number(paidAmount); var label='결제완료 · 게재대기';
    if(isFinite(cents) && cents>0){ label='결제완료 · \u20ac'+Math.round(cents/100)+' · 게재대기'; }
    return _span('rgba(100,200,150,.14)','rgba(100,200,150,.5)','rgba(140,230,180,.98)',label);
  }
  // 유료/브랜디드인데 아직 미결제 → 관리자 경고 (정책 A, 2026-07-21 QA)
  if(_isFeeRequiredType(submissionType)){
    return _span('rgba(220,80,80,.16)','rgba(220,80,80,.6)','rgba(240,150,150,.98)','\u26a0 미결제','게재료 미결제 — 편집 전 결제 확인 필요');
  }
  if(paymentStatus==='awaiting_payment'){
    return _span('rgba(201,168,106,.14)','rgba(201,168,106,.5)','rgba(220,190,130,.98)','결제대기');
  }
  var _t=String(submissionType==null?'':submissionType).trim().toLowerCase();
  if(_t==='free'){
    return _span('rgba(255,255,255,.05)','rgba(255,255,255,.16)','rgba(255,255,255,.5)','결제 불필요');
  }
  return '';
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
  var _hdr=document.getElementById('reviewModalHeader');
  _hdr.textContent=submitterName+' · '+createdDate+genreText+' · '+imgCount+' images';
  // Submission-type badge (표시 전용). textContent above already cleared any
  // prior badge from a previously-reviewed submission, so we just append.
  // Badge markup is code-controlled (fixed labels) — safe to set via innerHTML.
  var _typeBadge=_submissionTypeBadge(desc.submissionType);
  if(_typeBadge){
    var _b=document.createElement('span');
    _b.style.marginLeft='8px';
    _b.innerHTML=_typeBadge;
    _hdr.appendChild(_b);
  }
  // Payment-status badge (표시 전용) — 유료/브랜디드 기본료 결제 상태 + 실결제액. 옆에 나란히.
  var _payBadge=_paymentStatusBadge(submission.payment_status, submission.paid_amount, desc.submissionType);
  if(_payBadge){
    var _pb=document.createElement('span');
    _pb.style.marginLeft='8px';
    _pb.innerHTML=_payBadge;
    _hdr.appendChild(_pb);
  }

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

// QA #300 — 이미지 순서 변경/삭제 시 description.fashion.imageCredits 의
// 1-인덱스 키 (img_1, img_2, ...) 도 함께 재정렬. 서버 PATCH 핸들러
// (api/submissions/[id].js QA #215) 와 동일한 URL-기반 매핑 로직을
// 클라이언트에도 적용해서 (a) lightbox/미리보기가 깨진 인덱스로 그려지
// 않게 하고 (b) 운영자가 저장 누르지 않고 바로 "최종 승인"을 눌렀을 때
// editorial 로 잘못된 매핑이 전파되지 않게.
//
// originalUrls: splice 직전 배열
// nextUrls:     splice 직후 배열 (current state)
function _reindexFashionImageCredits(originalUrls, nextUrls){
  if(!currentReviewSubmission) return;
  // description 은 보통 객체로 도착하지만 일부 레거시 row 가 문자열로
  // 들고 있을 수도 있어 모두 안전하게 처리.
  var desc = currentReviewSubmission.description;
  if(typeof desc === 'string'){
    try { desc = JSON.parse(desc); } catch(_) { desc = {}; }
  }
  if(!desc || typeof desc !== 'object') return;
  var fashion = desc.fashion;
  if(!fashion || typeof fashion !== 'object') return;
  var oldCredits = fashion.imageCredits;
  if(!oldCredits || typeof oldCredits !== 'object') return;

  var newCredits = {};
  for(var newIdx = 0; newIdx < nextUrls.length; newIdx++){
    var url = nextUrls[newIdx];
    var origIdx = originalUrls.indexOf(url);
    if(origIdx >= 0){
      var oldKey = 'img_' + (origIdx + 1);
      if(oldCredits[oldKey]){
        newCredits['img_' + (newIdx + 1)] = oldCredits[oldKey];
      }
    }
  }
  fashion.imageCredits = newCredits;
  desc.fashion = fashion;
  currentReviewSubmission.description = desc;
}

// QA #180 — drag/drop reorder. Swap entries in file_urls, keep the
// cover index pointing at the SAME image (not the same slot) so the
// admin's pick survives the move.
// QA #300 — fashion.imageCredits 도 같이 재정렬 (위 헬퍼).
function _galleryReorder(from, to){
  if(!currentReviewSubmission || !Array.isArray(currentReviewSubmission.file_urls)) return;
  var originalUrls = currentReviewSubmission.file_urls.slice();
  var urls = originalUrls.slice();
  if(from < 0 || from >= urls.length || to < 0 || to >= urls.length) return;
  var moved = urls.splice(from, 1)[0];
  urls.splice(to, 0, moved);
  currentReviewSubmission.file_urls = urls;
  // QA #300 — fashion 키 재정렬을 file_urls 갱신 직후에 호출.
  _reindexFashionImageCredits(originalUrls, urls);
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
// QA #300 — 삭제된 URL 의 fashion 크레딧도 함께 제거 + 나머지 키 재정렬.
function _galleryDelete(idx){
  if(!currentReviewSubmission || !Array.isArray(currentReviewSubmission.file_urls)) return;
  var originalUrls = currentReviewSubmission.file_urls.slice();
  var urls = originalUrls.slice();
  if(idx < 0 || idx >= urls.length) return;
  if(urls.length <= 1){
    alert('이미지는 최소 1장 이상 유지해야 합니다.');
    return;
  }
  urls.splice(idx, 1);
  currentReviewSubmission.file_urls = urls;
  // QA #300 — 삭제된 인덱스의 imageCredits 도 자동 제거되고 나머지는 재정렬.
  // _reindexFashionImageCredits 가 originalUrls.indexOf(url) 로 매핑하므로
  // 삭제된 URL 은 자연스럽게 newCredits 에서 제외됨.
  _reindexFashionImageCredits(originalUrls, urls);
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
      // QA #300 — description 도 함께 보내서 client 가 재정렬한
      // description.fashion.imageCredits 가 server 에 반영되도록.
      // server PATCH 핸들러는 originalUrls(DB) vs nextUrls(요청) 비교로
      // 자체 재정렬도 하지만, 이미 client 가 재정렬한 description 을
      // 같이 보내면 client/server 양쪽 결과가 일치함을 보장.
      body: JSON.stringify({
        file_urls: currentReviewSubmission.file_urls,
        coverImageIndex: selectedCoverImageIndex,
        description: currentReviewSubmission.description
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

  // QA #300 — 갤러리 dirty 상태 자동 저장. 운영자가 이미지 삭제/순서
  // 변경 후 "💾 갤러리 변경사항 저장" 을 누르지 않고 곧바로 ✓ 승인을
  // 눌렀을 때 변경분이 손실 + fashion.imageCredits 매핑이 어긋난 채
  // editorial 로 전파되는 시나리오 방지. saveGalleryChanges 가 PATCH 로
  // file_urls + description 을 동기화한 후 review 진행.
  try{
    if(typeof _galleryDirty !== 'undefined' && _galleryDirty && typeof saveGalleryChanges === 'function'){
      await saveGalleryChanges();
    }
  } catch(_){
    // saveGalleryChanges 가 alert 으로 실패 처리하므로 여기선 무시 ─ 다만
    // dirty 가 남아있으면 review 도 중단해서 사용자 데이터 보호.
    if(typeof _galleryDirty !== 'undefined' && _galleryDirty){
      return;
    }
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
// QA #212 — per-page size, persisted to localStorage so the admin's
// preferred density (10/30/50/100) survives reloads. Default 50.
var currentSubLimit = (function(){
  try {
    var saved = parseInt(localStorage.getItem('pap-sub-limit'));
    if(saved === 10 || saved === 30 || saved === 50 || saved === 100) return saved;
  } catch(_){}
  return 50;
})();
function setSubLimit(n){
  n = parseInt(n);
  if(!n || [10,30,50,100].indexOf(n) === -1) n = 50;
  currentSubLimit = n;
  try { localStorage.setItem('pap-sub-limit', String(n)); } catch(_){}
  currentSubPage = 1; // reset to first page so the user doesn't land past the new tail
  loadSubmissions();
}
window.setSubLimit = setSubLimit;

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
    params.push('limit='+currentSubLimit);
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
        // 게재료 미결제 게이트 (정책 A, 2026-07-21 QA) — 유료/브랜디드 미결제면 편집 진입에 경고
        var _unpaidFee = _isFeeRequiredType(_submissionTypeOf(s)) && s.payment_status !== 'paid';
        if(ds !== 'uploaded' && _unpaidFee){
        actionBtns += ' <button class="btn btn-sm btn-primary" style="border-color:#dc2626;color:#fca5a5" onclick="openEditorialEditorGuarded(\''+editorialId+'\')" title="게재료 미결제 — 클릭 시 경고 후 진행">\u26a0 '+btnLabel+'</button>';
        } else {
        actionBtns += ' <button class="btn btn-sm btn-primary" onclick="openEditorialEditor(\''+editorialId+'\')" title="연결된 에디토리얼 편집 화면으로 이동">'+btnLabel+'</button>';
        }
      }
      // QA #211 — rejected rows surface days-to-auto-purge + recover button.
      // Hard delete happens 30 days after rejected_at via a daily cron;
      // the admin can flip status back to 'pending' to cancel.
      var rejectedInfo = '';
      if(s.status==='rejected' && s.rejected_at){
        var rejAt = new Date(s.rejected_at);
        if(!isNaN(rejAt.getTime())){
          var daysSince = Math.floor((Date.now() - rejAt.getTime()) / (24*60*60*1000));
          var daysLeft = 30 - daysSince;
          if(daysLeft > 0){
            rejectedInfo = '<div style="margin-top:4px;font-size:10px;color:#dc2626;font-weight:600">⏳ '+daysLeft+'일 후 자동 삭제</div>';
            actionBtns += ' <button class="btn btn-sm" style="border-color:#16a34a;color:#16a34a" onclick="recoverRejectedSubmission(\''+s.id+'\')" title="거절 상태에서 복구하여 다시 검토 대기열로 이동">↩ 복구</button>';
          } else {
            rejectedInfo = '<div style="margin-top:4px;font-size:10px;color:#dc2626;font-weight:600">⚠️ 삭제 예정</div>';
          }
        }
      }
      // Submission-type badge (표시 전용) — shown under the status badge so paid
      // / branded submissions stand out; free & 구버전(값 없음) rows show nothing.
      var typeBadge=_submissionTypeBadge(_submissionTypeOf(s));
      // Payment-status badge (표시 전용) — 유형 뱃지 아래에 함께 노출 (+실결제액).
      var payBadge=_paymentStatusBadge(s.payment_status, s.paid_amount, _submissionTypeOf(s));
      var badgeStack=(typeBadge||payBadge)?'<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">'+typeBadge+payBadge+'</div>':'';
      tb.innerHTML+='<tr><td class="td-title" onclick="openModal(\''+s.id+'\')">'+esc(s.title)+'</td><td>'+esc(s.submitterName||s.submitterEmail||'—')+'</td><td><span class="badge '+planCls+'">'+planLabel+'</span></td><td>'+looks+'</td><td>'+fmtDate(s.created_at)+'</td><td><span class="badge '+statusCls+'">'+statusLabel+'</span>'+rejectedInfo+badgeStack+'</td><td>'+actionBtns+'</td></tr>';
    });
    _renderSubPagination(currentSubPage, totalPages, total);
  }catch(err){
    tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:#ff6b6b;padding:40px">불러오기 실패</td></tr>';
    console.error('Error loading submissions:',err);
  }
}
// QA #212 — number-based pagination with first/prev/next/last + page
// numbers + per-page selector. Always renders so the per-page dropdown
// stays accessible even when the list fits on one page.
//
// Layout (single row):
//   [총 N건 · X-Y]  [<< < 1 2 [3] 4 5 > >>]  [페이지당: 50 ▾]
//
// Page-number window: shows up to 7 numbers centred on the current page.
// Ellipses fill in when the total exceeds the window so the bar stays
// the same width regardless of dataset size.
function _renderSubPagination(page, totalPages, total){
  var table=document.getElementById('submissionListBody');
  if(!table) return;
  var tableEl=table.closest('table');
  if(!tableEl) return;
  var existing=tableEl.querySelector('tfoot.sub-pagination');

  // Build the numeric page-window. WINDOW_RADIUS controls how many
  // neighbour numbers surround the active one.
  var WINDOW_RADIUS = 2;
  var pages = [];
  if(totalPages <= 7){
    for(var i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    var lo = Math.max(2, page - WINDOW_RADIUS);
    var hi = Math.min(totalPages - 1, page + WINDOW_RADIUS);
    if(lo > 2) pages.push('…');
    for(var j = lo; j <= hi; j++) pages.push(j);
    if(hi < totalPages - 1) pages.push('…');
    pages.push(totalPages);
  }

  var jump = function(p){ return 'onclick="loadSubmissions(undefined,{page:'+p+'})"'; };
  var btnBase = 'display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:28px;padding:0 8px;border:1px solid var(--border2);background:#fff;color:var(--text);font-size:11px;cursor:pointer;border-radius:3px';
  var btnActive = 'background:var(--purple);color:#fff;border-color:var(--purple);font-weight:700';
  var btnDisabled = 'opacity:.4;cursor:not-allowed';
  var ellipsis = '<span style="padding:0 6px;color:var(--text3)">…</span>';

  var numHtml = pages.map(function(p){
    if(p === '…') return ellipsis;
    var style = btnBase + (p === page ? ';' + btnActive : '');
    return '<button type="button" style="'+style+'" '+jump(p)+'>'+p+'</button>';
  }).join('');

  var firstStyle = btnBase + (page <= 1 ? ';' + btnDisabled : '');
  var prevStyle  = btnBase + (page <= 1 ? ';' + btnDisabled : '');
  var nextStyle  = btnBase + (page >= totalPages ? ';' + btnDisabled : '');
  var lastStyle  = btnBase + (page >= totalPages ? ';' + btnDisabled : '');

  // Per-page dropdown — value reflects the currentSubLimit module state.
  var limitOptions = [10,30,50,100].map(function(n){
    var sel = n === currentSubLimit ? ' selected' : '';
    return '<option value="'+n+'"'+sel+'>'+n+'개</option>';
  }).join('');

  // Range label: items X-Y of total.
  var startIdx = total ? ((page - 1) * currentSubLimit + 1) : 0;
  var endIdx = Math.min(total, page * currentSubLimit);
  var rangeLabel = total
    ? ('<strong style="color:var(--text)">'+startIdx+'-'+endIdx+'</strong> / 총 <strong style="color:var(--text)">'+total+'</strong>건')
    : '결과 없음';

  var html =
    '<tr><td colspan="7" style="padding:14px 12px;border-top:1px solid var(--border);background:var(--surface)">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text3)">'+
        '<span>'+rangeLabel+'</span>'+
        '<span style="display:flex;gap:4px;align-items:center">'+
          '<button type="button" style="'+firstStyle+'" '+(page<=1?'disabled':jump(1))+' title="첫 페이지">«</button>'+
          '<button type="button" style="'+prevStyle+'" '+(page<=1?'disabled':jump(page-1))+' title="이전">‹</button>'+
          numHtml +
          '<button type="button" style="'+nextStyle+'" '+(page>=totalPages?'disabled':jump(page+1))+' title="다음">›</button>'+
          '<button type="button" style="'+lastStyle+'" '+(page>=totalPages?'disabled':jump(totalPages))+' title="마지막 페이지">»</button>'+
        '</span>'+
        '<span style="display:flex;align-items:center;gap:6px">'+
          '<label style="color:var(--text3)">페이지당</label>'+
          '<select onchange="setSubLimit(this.value)" style="background:#fff;border:1px solid var(--border2);padding:5px 8px;border-radius:3px;font-size:11px;cursor:pointer">'+limitOptions+'</select>'+
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

// QA #211 — recover a rejected submission within the 30-day purge window.
// Flips status='rejected' → 'pending' and (via review.js) clears
// rejected_at so the cron skips this row on the next scan.
async function recoverRejectedSubmission(id){
  if(!id) return;
  if(!confirm('이 서브미션을 복구하여 대기 중 상태로 되돌릴까요?\n자동 삭제 예정에서 제외되며, 다시 심사 대기열로 이동합니다.')) return;
  try {
    var resp = await apiPut('/submissions/'+id+'/review', { status: 'pending', reviewNote: '' });
    if(resp && resp.error){ alert('복구 실패: '+resp.error); return; }
    if(typeof toast === 'function') toast('복구되었습니다');
    else alert('복구되었습니다.');
    // Refresh the list so the row leaves the rejected bucket immediately.
    loadSubmissions();
  } catch(e){
    alert('복구 실패: '+(e && e.message ? e.message : '알 수 없는 오류'));
  }
}
window.recoverRejectedSubmission = recoverRejectedSubmission;

// ======== PULL-LETTERS MANAGEMENT ========
// Two flows write to the same `pullletters` table:
//   - Legacy: /frontend/pullletter → multipart with file_urls (request_text)
//   - Community: /frontend/community → JSON with mood_board_id + structured fields
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
      papFetchAllPages('/articles?fields=admin&status=published').catch(function(){return{data:[]};}),
      papFetchAllPages('/articles?fields=admin&status=draft').catch(function(){return{data:[]};}),
      papFetchAllPages('/articles?fields=admin&status=scheduled').catch(function(){return{data:[]};})
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

// QA #208 Phase 2a — bulk-selection state for the news list (same
// pattern as editorial: a Set survives re-renders + filter toggles).
var newsSelectedIds = new Set();
// QA #208 Phase 2b — sort + date-range state for news.
var newsSortBy = 'recent';
var newsDateRange = 'all';
var newsDateBasis = 'created';
var newsDateFrom = '';
var newsDateTo = '';
// QA #208 Phase 2g/2h — author role + category dropdown filters.
var newsRoleFilter = 'all';
var newsCategoryFilter = 'all';

function setNewsSortFromUi(){
  var sel = document.getElementById('newsAdminSort');
  if(sel) newsSortBy = sel.value || 'recent';
  renderNews();
}
function setNewsDateRangeFromUi(){
  var sel = document.getElementById('newsAdminRange');
  var basis = document.getElementById('newsAdminBasis');
  var from = document.getElementById('newsAdminFrom');
  var to = document.getElementById('newsAdminTo');
  if(sel) newsDateRange = sel.value || 'all';
  if(basis) newsDateBasis = basis.value || 'created';
  if(from) newsDateFrom = from.value || '';
  if(to) newsDateTo = to.value || '';
  var wrap = document.getElementById('newsAdminCustomWrap');
  if(wrap) wrap.style.display = (newsDateRange === 'custom') ? '' : 'none';
  renderNews();
}
// QA #208 Phase 2g — news role filter handler.
function setNewsRoleFromUi(){
  var sel = document.getElementById('newsAdminRole');
  if(sel) newsRoleFilter = sel.value || 'all';
  renderNews();
}
// QA #208 Phase 2h — news category dropdown handler.
function setNewsCategoryFromUi(){
  var sel = document.getElementById('newsAdminCategory');
  if(sel) newsCategoryFilter = sel.value || 'all';
  renderNews();
}

// QA #208 Phase 2c — news saved-filter presets.
function applyNewsPreset(preset){
  if(preset === 'scheduled'){
    newsActiveStatus = 'scheduled';
    newsSortBy = 'recent';
    newsDateRange = 'all';
  } else if(preset === 'today'){
    newsActiveStatus = 'all';
    newsDateRange = 'today';
    newsDateBasis = 'created';
    newsSortBy = 'recent';
  } else if(preset === 'draft'){
    newsActiveStatus = 'draft';
    newsSortBy = 'updated_desc';
    newsDateRange = 'all';
  } else if(preset === 'thisweek'){
    newsActiveStatus = 'all';
    newsDateRange = '7d';
    newsDateBasis = 'created';
    newsSortBy = 'recent';
  } else if(preset === 'reset'){
    newsActiveStatus = 'all';
    newsSortBy = 'recent';
    newsDateRange = 'all';
    newsDateBasis = 'created';
    newsDateFrom = '';
    newsDateTo = '';
    newsRoleFilter = 'all';
    newsCategoryFilter = 'all';
  }
  var sortEl = document.getElementById('newsAdminSort'); if(sortEl) sortEl.value = newsSortBy;
  var rangeEl = document.getElementById('newsAdminRange'); if(rangeEl) rangeEl.value = newsDateRange;
  var basisEl = document.getElementById('newsAdminBasis'); if(basisEl) basisEl.value = newsDateBasis;
  var roleEl = document.getElementById('newsAdminRole'); if(roleEl) roleEl.value = newsRoleFilter;
  var catEl = document.getElementById('newsAdminCategory'); if(catEl) catEl.value = newsCategoryFilter;
  var customWrap = document.getElementById('newsAdminCustomWrap');
  if(customWrap) customWrap.style.display = (newsDateRange === 'custom') ? '' : 'none';
  renderNews();
}

function renderNews(){
  var tb=document.getElementById('newsListBody');
  if(!tb)return;

  // Counts roll up across all rows regardless of active filter so the
  // tab badges always show the global totals.
  // QA #208 Phase 2a — also track 'archived' so the new 비공개 card
  // gets an accurate count; everything not in the live triad rolls in.
  var counts={all:allArticles.length, published:0, draft:0, scheduled:0, archived:0};
  allArticles.forEach(function(a){
    var s=_articleEffectiveStatus(a);
    if(s === 'scheduled') counts.scheduled++;
    else if(s === 'published') counts.published++;
    else if(s === 'draft') counts.draft++;
    else counts.archived++;
  });
  var setCount=function(id,n){var el=document.getElementById(id);if(el)el.textContent=String(n||0);};
  setCount('newsAllCountBadge', counts.all);
  setCount('newsPublishedCountBadge', counts.published);
  setCount('newsDraftCountBadge', counts.draft);
  setCount('newsScheduledCountBadge', counts.scheduled);
  // QA #208 Phase 2a — stat-card numbers.
  setCount('newsStatAll', counts.all);
  setCount('newsStatPublished', counts.published);
  setCount('newsStatDraft', counts.draft);
  setCount('newsStatScheduled', counts.scheduled);
  setCount('newsStatArchived', counts.archived);
  // Highlight the active card (purple border).
  document.querySelectorAll('.news-stat-card').forEach(function(c){
    if(c.dataset.status === newsActiveStatus){
      c.style.borderColor = 'var(--purple)';
      c.style.boxShadow = '0 0 0 2px rgba(124,58,237,0.15)';
    } else {
      c.style.borderColor = 'var(--border2)';
      c.style.boxShadow = '';
    }
  });

  // Filter rows by the active tab. 'all' shows everything.
  var visible = allArticles.filter(function(a){
    if(newsActiveStatus!=='all' && _articleEffectiveStatus(a) !== newsActiveStatus) return false;
    // QA #208 Phase 2g — author role filter.
    if(newsRoleFilter !== 'all'){
      var creatorRole = (a._creator && a._creator.role) || null;
      if(newsRoleFilter === 'admin' && creatorRole !== 'admin') return false;
      if(newsRoleFilter === 'staff' && creatorRole !== 'staff') return false;
    }
    // QA #208 Phase 2h — category filter. Articles can carry either a
    // `category` column or category-coded tags; match both so editors
    // get a sane result regardless of curation style.
    if(newsCategoryFilter !== 'all'){
      var cat = String(a.category||'').toLowerCase();
      var tagStr = (Array.isArray(a.tags)?a.tags.join(' '):a.tags||'').toLowerCase();
      var needle = String(newsCategoryFilter).toLowerCase();
      if(cat !== needle && tagStr.indexOf(needle) === -1) return false;
    }
    return true;
  });
  // QA #208 Phase 2b — date range + sort.
  visible = _papApplyDateRange(visible, newsDateRange, newsDateBasis, newsDateFrom, newsDateTo);
  visible = _papApplySort(visible, newsSortBy);
  /* QA(2026-07-16) 페이지네이션 — 필터·정렬이 전부 끝난 뒤에 자른다.
     먼저 자르면 검색·정렬이 현재 페이지 안에서만 도는(원래 문제와 같은)
     상태가 된다. 위 상태별 카운트는 전량 배열 기준이라 페이지와 무관하다. */
  PAP_LIST_RERENDER.news = renderNews;
  var _pg = papPaginate('news', visible);
  papRenderPager('news','newsListBody',_pg);

  if(!visible.length){
    tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px 0">'+(newsActiveStatus==='all'?'뉴스가 없습니다':'해당 상태의 뉴스가 없습니다')+'</td></tr>';
    _newsRefreshBulkToolbar();
    return;
  }
  tb.innerHTML='';
  _pg.slice.forEach(function(a){
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
    // QA #202 — render "작성자 · 최근 수정자" in a tight two-line cell.
    var authorshipCell = _renderAuthorshipCell(a);
    // QA #208 Phase 2a — checkbox column for bulk selection.
    var isChecked = newsSelectedIds.has(a.id) ? ' checked' : '';
    tb.innerHTML+='<tr style="cursor:pointer" onclick="editArticle(\''+a.id+'\')">'
      + '<td onclick="event.stopPropagation()"><input type="checkbox" class="news-row-check" data-id="'+a.id+'" onchange="newsToggleRow(this)"'+isChecked+'></td>'
      + '<td style="font-size:10px">'+shortId+'</td>'
      + '<td class="td-title">'+safeTitle+'</td>'
      + '<td><span class="badge '+cls+'">'+label+'</span></td>'
      + '<td>'+fmtDate(a.published_date||a.scheduled_publish_at)+'</td>'
      + '<td onclick="event.stopPropagation()" style="font-size:11px;color:var(--text2);line-height:1.5">'+authorshipCell+'</td>'
      + '<td onclick="event.stopPropagation()"><button class="btn btn-sm" onclick="editArticle(\''+a.id+'\')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteArticle(\''+a.id+'\',\''+safeTitle.replace(/'/g,"\\'")+'\')">삭제</button></td>'
      + '</tr>';
  });
  _newsRefreshBulkToolbar();
  papInitAdvPanel('news');
}

// QA #208 Phase 2a — news bulk-selection helpers (mirror editorial).
function newsToggleRow(checkbox){
  if(!checkbox) return;
  var id = checkbox.dataset.id;
  if(!id) return;
  if(checkbox.checked) newsSelectedIds.add(id);
  else newsSelectedIds.delete(id);
  _newsRefreshBulkToolbar();
}
function newsToggleSelectAll(checkbox){
  document.querySelectorAll('.news-row-check').forEach(function(cb){
    cb.checked = checkbox.checked;
    var id = cb.dataset.id;
    if(!id) return;
    if(checkbox.checked) newsSelectedIds.add(id);
    else newsSelectedIds.delete(id);
  });
  _newsRefreshBulkToolbar();
}
function newsClearSelection(){
  newsSelectedIds.clear();
  var hdr = document.getElementById('newsSelectAll');
  if(hdr) hdr.checked = false;
  document.querySelectorAll('.news-row-check').forEach(function(cb){ cb.checked = false; });
  _newsRefreshBulkToolbar();
}
function _newsRefreshBulkToolbar(){
  var bar = document.getElementById('newsBulkToolbar');
  var lbl = document.getElementById('newsBulkCount');
  if(!bar) return;
  if(newsSelectedIds.size > 0){
    bar.style.display = 'block';
    if(lbl) lbl.textContent = newsSelectedIds.size + '개 선택';
  } else {
    bar.style.display = 'none';
  }
}
async function newsBulkAction(action){
  var ids = Array.from(newsSelectedIds);
  if(!ids.length){ alert('선택된 항목이 없습니다.'); return; }
  var labels = {
    publish: '공개 전환', draft: '임시저장 전환', delete: '삭제',
    addTags: '태그 추가', removeTags: '태그 제거',
  };

  // QA #208 Phase 2f — bulk tag actions.
  var tagsInput = null;
  if(action === 'addTags' || action === 'removeTags'){
    var promptLabel = action === 'addTags'
      ? '추가할 태그를 콤마로 구분해 입력하세요 (예: 인터뷰, 패션)'
      : '제거할 태그를 콤마로 구분해 입력하세요';
    var raw = window.prompt(promptLabel, '');
    if(!raw || !raw.trim()){ return; }
    tagsInput = raw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    if(!tagsInput.length){ return; }
  }

  if(!confirm(ids.length + '개 뉴스를 ' + labels[action] + '하시겠습니까?')) return;
  var byId = {};
  allArticles.forEach(function(a){ if(a && a.id) byId[a.id] = a; });

  var failures = [];
  for(var i = 0; i < ids.length; i++){
    var id = ids[i];
    try {
      if(action === 'delete'){
        await apiDelete('/articles/' + id);
      } else if(action === 'publish'){
        await apiPut('/articles/' + id, { status: 'published' });
      } else if(action === 'draft'){
        await apiPut('/articles/' + id, { status: 'draft' });
      } else if(action === 'addTags' || action === 'removeTags'){
        var row = byId[id];
        var current = (row && Array.isArray(row.tags)) ? row.tags.slice() : [];
        var next;
        if(action === 'addTags'){
          var seen = {};
          next = current.concat(tagsInput).filter(function(t){
            var k = String(t||'').trim();
            if(!k) return false;
            if(seen[k.toLowerCase()]) return false;
            seen[k.toLowerCase()] = 1;
            return true;
          });
        } else {
          var drop = {};
          tagsInput.forEach(function(t){ drop[String(t||'').trim().toLowerCase()] = 1; });
          next = current.filter(function(t){ return !drop[String(t||'').trim().toLowerCase()]; });
        }
        await apiPut('/articles/' + id, { tags: next });
      }
    } catch(err){
      failures.push(id.substring(0,8) + ': ' + (err && err.message || ''));
    }
  }
  newsSelectedIds.clear();
  await loadNews();
  if(failures.length){
    alert('일부 실패:\n' + failures.join('\n'));
  } else {
    alert('완료: ' + ids.length + '개 뉴스 ' + labels[action]);
  }
}

// QA #202 — tiny cell builder that renders denormalised authorship.
// `_creator` and `_editor` are objects attached by attachAuthorship()
// on the API side. If both are missing (legacy rows pre-#202) we show
// a dash so the column stays visually balanced.
function _renderAuthorshipCell(row){
  if(!row) return '<span style="color:var(--text3)">—</span>';
  var creatorName = (row._creator && (row._creator.display_name || row._creator.email)) || null;
  var editorName  = (row._editor  && (row._editor.display_name  || row._editor.email))  || null;
  var lines = [];
  if(creatorName){
    var createdAt = row.created_at ? new Date(row.created_at).toLocaleDateString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit'}) : '';
    lines.push('<div><span style="color:var(--text3)">작성:</span> '+esc(creatorName)+(createdAt?' <span style="color:var(--text3)">('+createdAt+')</span>':'')+'</div>');
  }
  if(editorName && (!creatorName || row.created_by !== row.updated_by)){
    var editedAt = row.admin_edited_at || row.updated_at;
    var editedStr = editedAt ? new Date(editedAt).toLocaleDateString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit'}) : '';
    lines.push('<div><span style="color:var(--text3)">수정:</span> '+esc(editorName)+(editedStr?' <span style="color:var(--text3)">('+editedStr+')</span>':'')+'</div>');
  }
  return lines.length ? lines.join('') : '<span style="color:var(--text3)">—</span>';
}

// QA #202 — open the audit log modal for any content row.
// `contentType` is one of 'editorial'/'article'/'film'/'shorts'.
// QA #209 — also renders the 4-card summary (생성자/최종 수정자/승인자/발행 담당자)
// at the top of the modal body so the editor sees the key actors at a glance.
async function openContentAuditLog(contentType, contentId){
  var modal = document.getElementById('contentAuditModal');
  var body  = document.getElementById('contentAuditBody');
  if(!modal || !body){ return; }
  modal.classList.add('show');
  body.innerHTML = '<div style="padding:40px 0;text-align:center;color:var(--text3)">불러오는 중...</div>';
  try {
    var resp = await apiGet('/admin/content-audit/'+contentType+'/'+contentId);
    var rows = resp && resp.data ? resp.data : [];
    // QA #209 — pick the four key actors out of the log + row fallback.
    var sourceRow = _lookupContentRow(contentType, contentId);
    var creatorEntry = null, editorEntry = null, approverEntry = null, publisherEntry = null;
    for(var i = 0; i < rows.length; i++){
      var e = rows[i];
      if(!creatorEntry   && e.action === 'create')                                    creatorEntry = e;
      if(!approverEntry  && e.action === 'approve')                                   approverEntry = e;
      if(!publisherEntry && e.action === 'publish')                                   publisherEntry = e;
      if(!editorEntry    && (e.action === 'update' || e.action === 'publish' || e.action === 'unpublish')) editorEntry = e;
    }
    if(!creatorEntry && sourceRow && sourceRow._creator){
      creatorEntry = { actor_label: sourceRow._creator.display_name || sourceRow._creator.email || '—', created_at: sourceRow.created_at };
    }
    if(!editorEntry && sourceRow && sourceRow._editor){
      editorEntry = { actor_label: sourceRow._editor.display_name || sourceRow._editor.email || '—', created_at: sourceRow.updated_at || sourceRow.admin_edited_at || sourceRow.created_at };
    }
    var card = function(label, color, actor){
      var who = actor ? esc(actor.actor_label || '—') : '<span style="color:var(--text3)">—</span>';
      var when = '';
      try {
        var d = actor && actor.created_at ? new Date(actor.created_at) : null;
        if(d && !isNaN(d.getTime())){
          when = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
        }
      } catch(_){}
      return '<div style="background:#fff;border:1px solid var(--border2);border-left:3px solid '+color+';border-radius:4px;padding:10px 12px">'
        + '<div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:4px">'+esc(label)+'</div>'
        + '<div style="font-size:12px;font-weight:600;line-height:1.4">'+who+'</div>'
        + (when ? '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+esc(when)+'</div>' : '')
        + '</div>';
    };
    var summaryHtml = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:14px 16px;background:#f9fafb;border-bottom:1px solid var(--border2)">'
      + card('생성자',       '#22c55e', creatorEntry)
      + card('최종 수정자',  '#7c3aed', editorEntry)
      + card('승인자',       '#f59e0b', approverEntry)
      + card('발행 담당자',  '#3b82f6', publisherEntry)
      + '</div>';

    if(!rows.length){
      body.innerHTML = summaryHtml + '<div style="padding:30px 0;text-align:center;color:var(--text3)">아직 수정 이력이 없습니다.</div>';
      return;
    }
    body.innerHTML = rows.map(function(r){
      var when = new Date(r.created_at);
      var whenStr = when.toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      var actionLabel = ({create:'등록',update:'수정',delete:'삭제',publish:'공개',unpublish:'비공개 전환'})[r.action] || r.action;
      var actionColor = ({create:'#27ae60',update:'#2980b9',delete:'#c0392b',publish:'#16a085',unpublish:'#7f8c8d'})[r.action] || '#666';
      var actor = r.actor_label || '(알 수 없음)';
      var diffSummary = '';
      if(r.diff && typeof r.diff === 'object'){
        var keys = Object.keys(r.diff);
        if(keys.length){
          diffSummary = '<div style="margin-top:6px;font-size:11px;color:var(--text3)">변경 필드: '+keys.map(esc).join(', ')+'</div>';
        }
      }
      return '<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;line-height:1.6">'
        +'<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">'
          +'<div><span style="display:inline-block;padding:2px 8px;background:'+actionColor+';color:#fff;font-size:10px;border-radius:2px;letter-spacing:.04em">'+actionLabel+'</span> '
          +'<strong style="margin-left:8px">'+esc(actor)+'</strong></div>'
          +'<div style="color:var(--text3);font-size:11px">'+esc(whenStr)+'</div>'
        +'</div>'
        +(r.summary ? '<div style="margin-top:4px;color:var(--text2)">'+esc(r.summary)+'</div>' : '')
        +diffSummary
      +'</div>';
    }).join('');
    // QA #209 — prepend the 4-card summary before the timeline.
    body.innerHTML = summaryHtml + body.innerHTML;
  } catch(e){
    body.innerHTML = '<div style="padding:30px 0;text-align:center;color:#c0392b">불러오기 실패: '+esc(e.message||'')+'</div>';
  }
}
function closeContentAuditModal(){
  var modal = document.getElementById('contentAuditModal');
  if(modal) modal.classList.remove('show');
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
  // QA #202 — populate the authorship line + reveal the "수정 이력 보기"
  // button. Only meaningful in edit mode (a brand-new article has no
  // ledger yet).
  var authorshipWrap = document.getElementById('newnewsAuthorshipMeta');
  var authorshipLine = document.getElementById('newnewsAuthorshipLine');
  if(authorshipWrap && authorshipLine){
    if(isEdit && article){
      var creator = article._creator && (article._creator.display_name || article._creator.email);
      var editor  = article._editor  && (article._editor.display_name  || article._editor.email);
      var parts = [];
      if(creator) parts.push('작성: <strong>'+esc(creator)+'</strong>'+(article.created_at?' · '+fmtDate(article.created_at):''));
      if(editor)  parts.push('최근 수정: <strong>'+esc(editor)+'</strong>'+(article.admin_edited_at?' · '+fmtDate(article.admin_edited_at):''));
      if(parts.length){
        authorshipLine.innerHTML = parts.join(' &nbsp;|&nbsp; ');
        authorshipWrap.style.display = 'block';
      } else {
        authorshipWrap.style.display = 'none';
      }
    } else {
      authorshipWrap.style.display = 'none';
    }
  }
}

// Clear the editor form back to a blank "new article" state.
function _resetNewsEditorForm(){
  var titleEl = document.getElementById('newnewsTitle');
  if(titleEl) titleEl.value = '';
  // QA #223 — reset the new category + tag fields too so the next
  // "+ 새 뉴스" doesn't inherit the previous edit's selections.
  var catEl = document.getElementById('newnewsCategory');
  if(catEl) catEl.value = 'news';
  var tagEl = document.getElementById('newnewsTags');
  if(tagEl) tagEl.value = '';
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
  // QA #224 — the inline upload-status line ("✓ 업로드 완료", error
  // messages, etc.) lives in a separate DOM node from the upload box,
  // so the previous reset only cleared the box and left the stale line
  // behind. Wipe it explicitly here.
  var thumbStatus = document.getElementById('newnewsThumbStatus');
  if(thumbStatus){
    thumbStatus.textContent = '';
    thumbStatus.style.color = '';
  }
  var blocks = document.getElementById('newsBlocks');
  if(blocks){
    // Leave a single empty text block so the editor doesn't open
    // completely barren the way it does on first render.
    // QA #281 — 헤더에 위/아래 + 삭제 버튼 + 자동 번호 재계산.
    blocks.innerHTML = '<div class="news-block" style="background:var(--surface);border:1px solid var(--border);padding:14px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
        +'<span style="font-size:10px;font-weight:700;color:var(--text3)">블록 1 — 텍스트</span>'
        +'<div style="display:flex;gap:4px">'
          +'<button class="btn btn-sm" title="위로 이동" onclick="_moveNewsBlock(this,-1)" style="padding:2px 8px">↑</button>'
          +'<button class="btn btn-sm" title="아래로 이동" onclick="_moveNewsBlock(this,1)" style="padding:2px 8px">↓</button>'
          +'<button class="btn btn-sm btn-red" onclick="this.closest(\'.news-block\').remove();_renumberNewsBlocks()">삭제</button>'
        +'</div>'
      +'</div>'
      +'<textarea class="modal-ta" style="min-height:100px" placeholder="본문 텍스트를 입력하세요..."></textarea>'
      +'</div>';
    // QA #281 — Drag & Drop 다중 업로드 setup (한 번만).
    if (typeof _setupNewsBlocksDragDrop === 'function') _setupNewsBlocksDragDrop();
  }
  newsBlockCount = 1;
  // QA #224 — reset the editorial-parity controls to their "fresh
  // article" defaults: 공개 checked, Featured/예약 cleared, 발행 +
  // 예약 날짜 inputs blanked, schedule panel hidden.
  var pubBox = document.getElementById('newnewsPublish');
  if(pubBox) pubBox.checked = true;
  var featBox = document.getElementById('newnewsFeatured');
  if(featBox) featBox.checked = false;
  var schedBox = document.getElementById('newnewsSchedule');
  if(schedBox) schedBox.checked = false;
  var ids = ['newnewsPublishDate','newnewsPublishTime','newnewsScheduleDate'];
  ids.forEach(function(id){ var el = document.getElementById(id); if(el) el.value = ''; });
  var sTime = document.getElementById('newnewsScheduleTime');
  if(sTime) sTime.value = '09:00';
  // Legacy fields (kept for cached-HTML safety).
  var radios = document.getElementsByName('newnewsStatusOpt');
  if(radios && radios.length){
    for(var i=0;i<radios.length;i++) radios[i].checked = (radios[i].value === 'published');
  }
  var legacySched = document.getElementById('newnewsScheduledAt');
  if(legacySched) legacySched.value = '';
  if(typeof toggleNewsSchedule === 'function') toggleNewsSchedule();
}

// Hydrate the editor with an existing article's payload.
function _hydrateNewsEditorForm(a){
  var titleEl = document.getElementById('newnewsTitle');
  if(titleEl) titleEl.value = a.title || '';

  // QA #223 — restore category + tags so edits don't silently revert
  // these fields. Default to 'news' when missing for older rows.
  var catEl = document.getElementById('newnewsCategory');
  if(catEl){
    var c = String(a.category || 'news').toLowerCase();
    var known = ['news','fashion','art','culture','music'];
    catEl.value = known.indexOf(c) >= 0 ? c : 'news';
  }
  var tagEl = document.getElementById('newnewsTags');
  if(tagEl){
    var tagsArr = Array.isArray(a.tags) ? a.tags : [];
    tagEl.value = tagsArr.join(', ');
  }

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
        var content;
        if(type === 'image'){
          // QA #200 — image blocks carry both url + caption. Pass the
          // full object so _appendNewsBlock can hydrate the preview
          // image AND the caption field together.
          content = { url: block.url || '', caption: block.content || '' };
        } else if(type === 'quote'){
          // QA #201 — quote blocks also carry a separate `source`
          // (attribution) field. Pass as object so the editor restores
          // both the body and the source input.
          content = { content: block.content || '', source: block.source || '' };
        } else if(type === 'gallery' || type === 'slide'){
          // QA #281 Phase B — gallery/slide carry an images array.
          content = { images: Array.isArray(block.images) ? block.images : [] };
        } else if(type === 'videogroup'){
          // QA #281 Phase C — videogroup carries a videos array.
          content = { videos: Array.isArray(block.videos) ? block.videos : [] };
        } else {
          content = block && block.content!==undefined ? block.content : '';
        }
        _appendNewsBlock(type, content);
      });
    } else {
      // Legacy / non-block payload — show the raw text in a single
      // text block so it can be edited (and re-saved as blocks).
      _appendNewsBlock('text', a.content || '');
    }
  }

  // QA #224 — rehydrate the editorial-parity checkbox UI from the row.
  // The three checkboxes encode the same three states the legacy radio
  // covered: published / draft / scheduled. Scheduled rows still have
  // status='published' under the hood (the future scheduled_publish_at
  // is what keeps them off the public list), so we infer "예약 게시"
  // from the timestamp rather than from status alone.
  var isScheduled = a._virtualStatus === 'scheduled'
    || (a.status === 'published' && a.scheduled_publish_at && new Date(a.scheduled_publish_at) > new Date());
  var pubBox = document.getElementById('newnewsPublish');
  var schedBox = document.getElementById('newnewsSchedule');
  if(pubBox) pubBox.checked = (a.status === 'published');
  if(schedBox) schedBox.checked = !!isScheduled;
  var pad = function(n){return n<10?'0'+n:''+n;};

  // 발행 날짜 prefill
  if(a.published_date){
    var pd = new Date(a.published_date);
    if(!isNaN(pd.getTime())){
      var pdEl = document.getElementById('newnewsPublishDate');
      var ptEl = document.getElementById('newnewsPublishTime');
      if(pdEl) pdEl.value = pd.getFullYear() + '-' + pad(pd.getMonth()+1) + '-' + pad(pd.getDate());
      if(ptEl) ptEl.value = pad(pd.getHours()) + ':' + pad(pd.getMinutes());
    }
  }

  // 예약 일시 prefill
  if(a.scheduled_publish_at){
    var sd = new Date(a.scheduled_publish_at);
    if(!isNaN(sd.getTime())){
      var sdEl = document.getElementById('newnewsScheduleDate');
      var stEl = document.getElementById('newnewsScheduleTime');
      if(sdEl) sdEl.value = sd.getFullYear() + '-' + pad(sd.getMonth()+1) + '-' + pad(sd.getDate());
      if(stEl) stEl.value = pad(sd.getHours()) + ':' + pad(sd.getMinutes());
    }
  }

  // Legacy radio (cached HTML safety) — still fill so a stale DOM
  // doesn't show all-off radios.
  var radios = document.getElementsByName('newnewsStatusOpt');
  var pick = isScheduled ? 'scheduled' : (a.status === 'draft' ? 'draft' : 'published');
  if(radios){
    for(var i=0;i<radios.length;i++) radios[i].checked = (radios[i].value === pick);
  }
  var legacySched = document.getElementById('newnewsScheduledAt');
  if(legacySched && a.scheduled_publish_at){
    var ld = new Date(a.scheduled_publish_at);
    legacySched.value = ld.getFullYear()+'-'+pad(ld.getMonth()+1)+'-'+pad(ld.getDate())+'T'+pad(ld.getHours())+':'+pad(ld.getMinutes());
  }

  if(typeof toggleNewsSchedule === 'function') toggleNewsSchedule();
}

// Append a block row to #newsBlocks pre-filled with `content`.
function _appendNewsBlock(type, content){
  newsBlockCount++;
  var area = document.getElementById('newsBlocks');
  if(!area) return null;
  var div = document.createElement('div');
  div.className = 'news-block';
  div.style.cssText = 'background:var(--surface);border:1px solid var(--border);padding:14px';
  var label = ({text:'텍스트',image:'이미지',gallery:'갤러리',slide:'슬라이드',quote:'인용구',video:'영상',videogroup:'영상 그룹'})[type] || '기타';
  // QA #281 — 블록 순서 변경 (↑/↓) + 삭제 버튼.
  var inner = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    +'<span style="font-size:10px;font-weight:700;color:var(--text3)">블록 '+newsBlockCount+' — '+label+'</span>'
    +'<div style="display:flex;gap:4px">'
      +'<button class="btn btn-sm" title="위로 이동" onclick="_moveNewsBlock(this,-1)" style="padding:2px 8px">↑</button>'
      +'<button class="btn btn-sm" title="아래로 이동" onclick="_moveNewsBlock(this,1)" style="padding:2px 8px">↓</button>'
      +'<button class="btn btn-sm btn-red" onclick="this.closest(\'.news-block\').remove();_renumberNewsBlocks()">삭제</button>'
    +'</div>'
    +'</div>';
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
    // QA #200 — image block now wires its file input to the real
    // /media/upload pipeline via handleNewsBlockImage. The block
    // element itself carries the resolved public URL on dataset.imgUrl
    // so _collectNewsBlocks can serialize {type:'image', url, content}
    // (where `content` is still the caption, kept for backwards-compat
    // with any older payloads).
    //
    // `content` argument may be either a plain caption string (legacy)
    // or an object {url, caption} (new hydration path). We normalise
    // both to {url, caption}.
    var imgUrl = '';
    var caption = '';
    if(content && typeof content === 'object'){
      imgUrl = content.url || '';
      caption = content.caption || '';
    } else {
      caption = content || '';
    }
    // QA #281 — multiple 선택 지원. 여러 파일 선택 시 첫 파일은 현재 블록에,
    // 나머지는 자동으로 새 이미지 블록을 생성해서 추가.
    inner += '<div class="pe-upload" onclick="this.querySelector(\'input\').click()" style="padding:16px"><input type="file" multiple accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleNewsBlockImage(this)"><div class="pe-upload-text">클릭하여 이미지 업로드 (여러 장 선택 가능)</div></div>';
    inner += '<div class="news-block-img-preview" style="margin-top:8px;'+(imgUrl?'':'display:none')+'">'+(imgUrl?'<img src="'+esc(imgUrl)+'" style="max-width:240px;max-height:240px;object-fit:cover;border:1px solid var(--border)">':'')+'</div>';
    inner += '<div class="news-block-img-status" style="margin-top:4px;font-size:11px;color:var(--text3);min-height:14px"></div>';
    var capInput = document.createElement('input');
    capInput.className='pe-input news-block-img-caption';
    // QA #201 — explicit purpose. Caption sits below the image on the
    // public site so editors know it is reader-facing context, not
    // internal notes.
    capInput.placeholder='이미지 캡션 (이미지 아래 작게 표시 · 사진 설명 / 사진가 / 출처 등)';
    capInput.style.marginTop='8px';
    capInput.value = caption;
    div.innerHTML = inner;
    div.appendChild(capInput);
    // Stash the existing URL on the block so collector can read it
    // back even if no new upload happens during this session.
    if(imgUrl) div.dataset.imgUrl = imgUrl;
  } else if(type==='quote'){
    // QA #201 — `content` may be a plain string (legacy / new block)
    // or an object {content, source} (hydration of a saved quote).
    var quoteText = '';
    var quoteSource = '';
    if(content && typeof content === 'object'){
      quoteText = content.content || '';
      quoteSource = content.source || '';
    } else {
      quoteText = content || '';
    }
    var qta = document.createElement('textarea');
    qta.className='modal-ta';
    qta.style.cssText='min-height:60px;font-style:italic';
    qta.placeholder='인용구 내용을 입력하세요 (강조하고 싶은 발언, 인터뷰 문장 등)';
    qta.value = quoteText;
    div.innerHTML = inner;
    div.appendChild(qta);
    var srcInput = document.createElement('input');
    srcInput.className='pe-input news-block-quote-source';
    // QA #201 — explicit purpose so editors know this is for attribution,
    // not a generic notes field.
    srcInput.placeholder='출처 (예: 인터뷰이 이름 · 원본 매체명 · 출처 URL)';
    srcInput.style.marginTop='8px';
    srcInput.value = quoteSource;
    div.appendChild(srcInput);
  } else if(type==='video'){
    var vInput = document.createElement('input');
    vInput.className='pe-input';
    vInput.placeholder='YouTube URL (예: https://youtube.com/watch?v=...)';
    vInput.value = content || '';
    div.innerHTML = inner;
    div.appendChild(vInput);
  } else if(type==='videogroup'){
    // QA #281 Phase C — 한 블록에 여러 YouTube/Vimeo 영상.
    // `content` shape: { videos: [{url, caption}, ...] }
    var videos = [];
    if (content){
      if (Array.isArray(content)) videos = content;
      else if (Array.isArray(content.videos)) videos = content.videos;
    }
    inner += '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">여러 YouTube/Vimeo 영상을 한 블록에 묶어 노출합니다. 같은 행사의 멀티앵글, 시리즈 영상 등.</div>';
    inner += '<div class="news-block-videos" style="display:flex;flex-direction:column;gap:8px"></div>';
    inner += '<button class="btn btn-sm" onclick="_addVideoToGroup(this)" style="margin-top:8px">+ 영상 URL 추가</button>';
    div.innerHTML = inner;
    var videosContainer = div.querySelector('.news-block-videos');
    // hydrate 기존 영상
    videos.forEach(function(v){
      if (v && (v.url || v.content)) _appendVideoGroupRow(videosContainer, v.url || v.content || '', v.caption || '');
    });
    // 빈 상태면 기본 1줄 추가
    if (videos.length === 0) _appendVideoGroupRow(videosContainer, '', '');
  } else if(type==='gallery' || type==='slide'){
    // QA #281 Phase B — 한 블록 안에 여러 이미지를 묶는 그룹 블록.
    // `content` shape: { images: [{url, caption}, ...] }  (or array fallback)
    var images = [];
    if (content){
      if (Array.isArray(content)) images = content;
      else if (Array.isArray(content.images)) images = content.images;
    }
    var hint = (type === 'gallery')
      ? '여러 이미지를 그리드(자동 2~3열)로 한 번에 보여줍니다. 같은 룩북 / 화보 컷에 적합.'
      : '여러 이미지를 좌우 스와이프 슬라이드로 보여줍니다. 같은 화보의 다른 컷을 캐러셀로 펼칠 때.';
    inner += '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">'+esc(hint)+'</div>';
    inner += '<div class="pe-upload" onclick="this.querySelector(\'input\').click()" style="padding:16px"><input type="file" multiple accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleGroupImageUpload(this)"><div class="pe-upload-text">+ 이미지 추가 (여러 장 동시 선택 가능)</div></div>';
    inner += '<div class="news-block-img-status" style="margin-top:4px;font-size:11px;color:var(--text3);min-height:14px"></div>';
    inner += '<div class="news-block-images" style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px"></div>';
    div.innerHTML = inner;
    // hydrate existing images on edit
    var imagesContainer = div.querySelector('.news-block-images');
    images.forEach(function(im){
      if (im && im.url) _appendBlockImageThumb(imagesContainer, im.url, im.caption || '');
    });
  } else {
    var oInput = document.createElement('input');
    oInput.className='pe-input';
    oInput.value = content || '';
    div.innerHTML = inner;
    div.appendChild(oInput);
  }
  area.appendChild(div);
  return div;
}

// QA #281 — 블록 순서 변경 (위/아래). 헤더의 ↑/↓ 버튼이 호출.
function _moveNewsBlock(btn, direction){
  var block = btn && btn.closest && btn.closest('.news-block');
  if (!block) return;
  if (direction < 0){
    var prev = block.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains('news-block')){
      block.parentNode.insertBefore(block, prev);
    }
  } else {
    var next = block.nextElementSibling;
    if (next && next.classList && next.classList.contains('news-block')){
      block.parentNode.insertBefore(next, block);
    }
  }
  _renumberNewsBlocks();
}

// QA #281 — 블록 라벨의 번호를 현재 순서에 맞게 재계산.
// 삭제/순서변경 후 호출하면 "블록 1 — 이미지", "블록 2 — 텍스트" 형태로 자연 정렬.
function _renumberNewsBlocks(){
  var area = document.getElementById('newsBlocks');
  if (!area) return;
  var blocks = area.querySelectorAll('.news-block');
  blocks.forEach(function(b, i){
    var labelSpan = b.querySelector('span');
    if (!labelSpan) return;
    // 기존 "블록 N — 라벨" 패턴에서 라벨만 보존하고 번호 갱신.
    var m = labelSpan.textContent.match(/—\s*(.+)$/);
    var label = m ? m[1] : '';
    labelSpan.textContent = '블록 ' + (i + 1) + (label ? ' — ' + label : '');
  });
}

// QA #281 — newsBlocks 컨테이너에 Drag&Drop 다중 업로드를 활성화.
// 외부에서 이미지 파일들을 끌어다 놓으면 각 파일마다 자동으로 이미지 블록 추가.
// idempotent — 같은 컨테이너에 여러 번 setup해도 한 번만 등록.
function _setupNewsBlocksDragDrop(){
  var area = document.getElementById('newsBlocks');
  if (!area || area.dataset.dndSetup === '1') return;
  area.dataset.dndSetup = '1';
  // 시각적 안내 텍스트 (한 번만 추가).
  if (!document.getElementById('newsBlocksDndHint')){
    var hint = document.createElement('div');
    hint.id = 'newsBlocksDndHint';
    hint.style.cssText = 'border:1px dashed var(--border);padding:10px;text-align:center;color:var(--text3);font-size:11px;margin-bottom:10px;background:rgba(255,255,255,.02)';
    hint.textContent = '🖼️ 이미지를 이 영역에 끌어다 놓으면 자동으로 이미지 블록이 추가됩니다 (여러 장 동시 가능)';
    area.parentNode.insertBefore(hint, area);
  }
  area.addEventListener('dragover', function(e){
    if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.items || [], function(it){ return it.kind === 'file'; })){
      e.preventDefault();
      area.style.outline = '2px dashed var(--text)';
      area.style.outlineOffset = '4px';
    }
  });
  area.addEventListener('dragleave', function(e){
    if (e.target === area){
      area.style.outline = '';
    }
  });
  area.addEventListener('drop', function(e){
    e.preventDefault();
    area.style.outline = '';
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    // 이미지 파일만 받음.
    var imageFiles = Array.prototype.filter.call(files, function(f){ return f && f.type && f.type.indexOf('image/') === 0; });
    if (!imageFiles.length){
      alert('이미지 파일만 끌어다 놓을 수 있어요.');
      return;
    }
    imageFiles.forEach(function(file){
      var newBlock = _appendNewsBlock('image', '');
      if (newBlock) _processNewsBlockImageFile(file, newBlock);
    });
    _renumberNewsBlocks();
  });
}

// 페이지 로드 시 한 번 setup 시도 (모달이 열리기 전이라도).
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', function(){
    try { _setupNewsBlocksDragDrop(); } catch(_){}
  });
}

// Show/hide the schedule input depending on the chosen status radio.
// QA #224 — legacy 3-way radio toggle. Kept as a no-op alias so any
// stray onchange="toggleNewsScheduleInput()" handlers in cached HTML
// won't throw before users hard-refresh. The new UI uses the
// editorial-style toggleNewsSchedule below.
function toggleNewsScheduleInput(){ toggleNewsSchedule(); }

// QA #224 — editorial-parity toggle. Show the 예약 일시 panel when the
// 예약 게시 checkbox is on, exactly like savePost / toggleSchedule do
// for editorials. The 발행 날짜 panel is always visible.
function toggleNewsSchedule(){
  var schedBox = document.getElementById('newnewsSchedule');
  var area = document.getElementById('newnewsScheduleArea');
  if(area) area.style.display = (schedBox && schedBox.checked) ? 'block' : 'none';
}

// QA #224 — small helpers mirroring the editorial form's
// _setPublishDateNow / _clearPublishDate so the "지금 / 초기화"
// affordance behaves identically across both editors.
function _setNewsPublishDateNow(){
  var d = new Date();
  var pad = function(n){ return n < 10 ? '0' + n : '' + n; };
  var ds = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  var ts = pad(d.getHours()) + ':' + pad(d.getMinutes());
  var dateEl = document.getElementById('newnewsPublishDate');
  var timeEl = document.getElementById('newnewsPublishTime');
  if(dateEl) dateEl.value = ds;
  if(timeEl) timeEl.value = ts;
}
function _clearNewsPublishDate(){
  var dateEl = document.getElementById('newnewsPublishDate');
  var timeEl = document.getElementById('newnewsPublishTime');
  if(dateEl) dateEl.value = '';
  if(timeEl) timeEl.value = '';
}

// QA #200 — shared image validator for the news editor.
// Enforces type + size up-front so the editor gets a Korean error before
// we burn a /media/upload round-trip. Returns null on success or a
// {ok:false, message} object on failure so the caller can show inline.
var NEWS_IMG_ALLOWED_TYPES = ['image/jpeg','image/png','image/webp'];
var NEWS_IMG_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — matches the hint
function validateNewsImage(file){
  if(!file) return { ok:false, message:'파일이 선택되지 않았습니다.' };
  if(NEWS_IMG_ALLOWED_TYPES.indexOf(file.type) < 0){
    return {
      ok:false,
      message:'허용되지 않은 형식입니다 ('+(file.type||'unknown')+'). JPG · PNG · WEBP 만 업로드 가능합니다.'
    };
  }
  if(file.size > NEWS_IMG_MAX_BYTES){
    var mb = (file.size / (1024*1024)).toFixed(2);
    return {
      ok:false,
      message:'파일이 너무 큽니다 ('+mb+'MB). 최대 2MB 이미지만 업로드할 수 있습니다.'
    };
  }
  return { ok:true };
}

// Thumbnail upload — QA #200 wiring.
//
// Lifecycle:
//   1. validate the file (type + size) → if it fails we abort BEFORE
//      hitting the network and show the reason inline.
//   2. paint an instant base64 preview so the editor sees feedback
//      while the real upload runs (Supabase round-trip is ~1-3s).
//   3. POST the file to /api/media/upload via uploadFile() — the same
//      helper editorials use — and stash the returned public URL in
//      the hidden newnewsThumbUrl field.
//   4. on success or failure, replace the inline status line so the
//      editor knows what happened.
function previewNewsThumb(input){
  if(!input || !input.files || !input.files[0]) return;
  var file = input.files[0];
  var thumb = document.getElementById('newnewsThumbUpload');
  var status = document.getElementById('newnewsThumbStatus');
  var hidden = document.getElementById('newnewsThumbUrl');

  // 1) Validate
  var v = validateNewsImage(file);
  if(!v.ok){
    if(status){
      status.style.color = '#c0392b';
      status.textContent = '⚠ ' + v.message;
    }
    // Clear the input so the next click re-fires onchange even if the
    // user picks the same problematic file again.
    try { input.value = ''; } catch(_){}
    alert(v.message);
    return;
  }

  // 2) Instant base64 preview while the upload runs.
  var reader = new FileReader();
  reader.onload = function(e){
    if(thumb){
      thumb.innerHTML = '<input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="previewNewsThumb(this)">'
        +'<img loading="lazy" src="'+e.target.result+'" style="max-width:200px;max-height:250px;object-fit:cover">'
        +'<div class="pe-upload-text" style="margin-top:8px">업로드 중...</div>';
      thumb.classList.add('has-thumb');
    }
  };
  reader.readAsDataURL(file);

  if(status){
    status.style.color = 'var(--text3)';
    status.textContent = '업로드 중... (' + (file.size/1024).toFixed(0) + 'KB)';
  }

  // 3) Real upload to Supabase Storage via the existing media endpoint.
  uploadFile(file).then(function(publicUrl){
    if(hidden) hidden.value = publicUrl;
    if(thumb){
      // Swap the temporary base64 preview for the canonical public URL
      // so a subsequent save reads exactly what the public site will.
      thumb.innerHTML = '<input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="previewNewsThumb(this)">'
        +'<img loading="lazy" src="'+publicUrl+'" style="max-width:200px;max-height:250px;object-fit:cover">'
        +'<div class="pe-upload-text" style="margin-top:8px">클릭하여 변경</div>';
    }
    if(status){
      status.style.color = '#27ae60';
      status.textContent = '✓ 업로드 완료';
    }
  }).catch(function(err){
    // Revert the box so the editor knows the upload is gone; the
    // hidden URL field is left UNTOUCHED (so an edit that re-uploads
    // and fails falls back to the existing thumbnail).
    if(thumb){
      var existing = hidden && hidden.value;
      thumb.innerHTML = '<input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="previewNewsThumb(this)">'
        + (existing ? '<img loading="lazy" src="'+esc(existing)+'" style="max-width:200px;max-height:250px;object-fit:cover">' : '')
        + '<div class="pe-upload-text" style="margin-top:8px">'+(existing?'클릭하여 변경':'클릭하여 썸네일 업로드')+'</div>';
      if(!existing) thumb.classList.remove('has-thumb');
    }
    if(status){
      status.style.color = '#c0392b';
      status.textContent = '⚠ 업로드 실패: ' + (err && err.message ? err.message : '알 수 없는 오류');
    }
    console.error('[news thumb upload]', err);
  });
}

// QA #200 — file-input change handler for news IMAGE blocks.
// Same lifecycle as previewNewsThumb but scoped to a single block:
//   - validate, then upload via /media/upload
//   - paint preview + status inside the block
//   - stash the public URL on the block's dataset so
//     _collectNewsBlocks can read it back on save
function handleNewsBlockImage(input){
  if(!input || !input.files || !input.files.length) return;
  var files = Array.prototype.slice.call(input.files);
  var originBlock = input.closest('.news-block');
  if(!originBlock) return;
  // QA #281 — 첫 파일은 현재 블록에, 나머지는 자동으로 새 이미지 블록 생성.
  _processNewsBlockImageFile(files[0], originBlock);
  for (var i = 1; i < files.length; i++){
    var newBlock = _appendNewsBlock('image', '');
    if (newBlock) _processNewsBlockImageFile(files[i], newBlock);
  }
  // input 값 초기화 (같은 파일 다시 선택해도 onchange가 발화하도록).
  try { input.value = ''; } catch(_){}
  _renumberNewsBlocks();
}

// QA #281 — 파일 1개 + 블록 1개를 처리하는 헬퍼. handleNewsBlockImage가 여러
// 파일을 받아 각각 이 함수로 위임. Drag&Drop 경로에서도 재사용.
function _processNewsBlockImageFile(file, block){
  if (!file || !block) return;
  var statusEl = block.querySelector('.news-block-img-status');
  var previewEl = block.querySelector('.news-block-img-preview');

  // 1) Validate
  var v = validateNewsImage(file);
  if(!v.ok){
    if(statusEl){
      statusEl.style.color = '#c0392b';
      statusEl.textContent = '⚠ ' + v.message;
    }
    alert(v.message);
    return;
  }

  // 2) Instant base64 preview
  var reader = new FileReader();
  reader.onload = function(e){
    if(previewEl){
      previewEl.style.display = 'block';
      previewEl.innerHTML = '<img src="'+e.target.result+'" style="max-width:240px;max-height:240px;object-fit:cover;border:1px solid var(--border)">';
    }
  };
  reader.readAsDataURL(file);

  if(statusEl){
    statusEl.style.color = 'var(--text3)';
    statusEl.textContent = '업로드 중... (' + (file.size/1024).toFixed(0) + 'KB)';
  }

  // 3) Real upload
  uploadFile(file).then(function(publicUrl){
    block.dataset.imgUrl = publicUrl;
    if(previewEl){
      previewEl.innerHTML = '<img src="'+publicUrl+'" style="max-width:240px;max-height:240px;object-fit:cover;border:1px solid var(--border)">';
    }
    if(statusEl){
      statusEl.style.color = '#27ae60';
      statusEl.textContent = '✓ 업로드 완료';
    }
  }).catch(function(err){
    if(statusEl){
      statusEl.style.color = '#c0392b';
      statusEl.textContent = '⚠ 업로드 실패: ' + (err && err.message ? err.message : '알 수 없는 오류');
    }
    console.error('[news block upload]', err);
  });
}

// QA #281 Phase B — 갤러리/슬라이드 그룹 블록 내부의 이미지 1장을 표현하는 thumb.
// `url`이 빈 문자열이면 placeholder(업로드 중) 상태로 렌더링.
function _appendBlockImageThumb(container, url, caption){
  if (!container) return null;
  var item = document.createElement('div');
  item.className = 'news-block-image-item';
  item.style.cssText = 'border:1px solid var(--border);padding:4px;background:var(--surface)';
  item.dataset.url = url || '';
  var inner = '<div style="position:relative">';
  if (url){
    inner += '<img src="'+esc(url)+'" style="width:100%;aspect-ratio:1;object-fit:cover;display:block">';
  } else {
    inner += '<div class="news-block-image-placeholder" style="width:100%;aspect-ratio:1;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:11px">업로드 중...</div>';
  }
  inner += '<button class="btn btn-sm btn-red" title="제거" onclick="this.closest(\'.news-block-image-item\').remove()" style="position:absolute;top:2px;right:2px;padding:0 6px;font-size:11px;line-height:18px">×</button>';
  inner += '</div>';
  inner += '<input class="news-block-image-caption" type="text" placeholder="캡션 (선택)" style="width:100%;margin-top:4px;font-size:11px;padding:4px 6px;background:var(--surface);border:1px solid var(--border);color:var(--text)" value="'+esc(caption||'').replace(/"/g,'&quot;')+'">';
  item.innerHTML = inner;
  container.appendChild(item);
  return item;
}

// QA #281 Phase B — 갤러리/슬라이드 블록의 다중 이미지 업로드 핸들러.
// 각 파일마다 placeholder thumb을 즉시 만들고, 업로드 완료되면 placeholder를
// 실제 이미지로 교체. 업로드 도중에도 사용자가 다른 작업을 이어갈 수 있도록 비동기.
async function handleGroupImageUpload(input){
  if (!input || !input.files || !input.files.length) return;
  var files = Array.prototype.slice.call(input.files);
  var block = input.closest('.news-block');
  if (!block) return;
  var container = block.querySelector('.news-block-images');
  var statusEl = block.querySelector('.news-block-img-status');
  if (!container) return;

  var total = files.length;
  var done = 0;
  function updateStatus(){
    if (!statusEl) return;
    statusEl.style.color = (done === total) ? '#27ae60' : 'var(--text3)';
    statusEl.textContent = (done === total) ? ('✓ 업로드 완료 (' + total + '장)') : ('업로드 중... ' + done + '/' + total);
  }
  updateStatus();

  // 모든 파일에 대해 동시에 업로드 (Supabase storage가 빠름). 각 thumb 객체에
  // 자기 위치 정보를 보유해서 placeholder 교체할 수 있도록.
  files.forEach(function(file){
    var v = (typeof validateNewsImage === 'function') ? validateNewsImage(file) : { ok: true };
    if (!v.ok){
      if (statusEl){
        statusEl.style.color = '#c0392b';
        statusEl.textContent = '⚠ ' + v.message;
      }
      console.warn('[group upload] skip invalid', v.message);
      return;
    }
    var thumb = _appendBlockImageThumb(container, '', '');
    uploadFile(file).then(function(publicUrl){
      if (!thumb || !publicUrl) return;
      thumb.dataset.url = publicUrl;
      var placeholder = thumb.querySelector('.news-block-image-placeholder');
      if (placeholder){
        placeholder.outerHTML = '<img src="'+esc(publicUrl)+'" style="width:100%;aspect-ratio:1;object-fit:cover;display:block">';
      }
      done++;
      updateStatus();
    }).catch(function(err){
      console.error('[group upload]', err);
      if (thumb) thumb.remove();
      done++;
      updateStatus();
    });
  });

  try { input.value = ''; } catch(_){}
}

// QA #281 Phase C — 영상 그룹 블록 내 1개 URL row 추가.
function _appendVideoGroupRow(container, url, caption){
  if (!container) return null;
  var row = document.createElement('div');
  row.className = 'news-block-video-row';
  row.style.cssText = 'display:flex;gap:6px;align-items:center';
  row.innerHTML = '<input class="pe-input news-block-video-url" type="text" placeholder="YouTube/Vimeo URL" value="'+esc(url||'').replace(/"/g,'&quot;')+'" style="flex:1">'
    + '<input class="pe-input news-block-video-caption" type="text" placeholder="캡션 (선택)" value="'+esc(caption||'').replace(/"/g,'&quot;')+'" style="flex:1">'
    + '<button class="btn btn-sm btn-red" onclick="this.closest(\'.news-block-video-row\').remove()" style="padding:4px 10px">×</button>';
  container.appendChild(row);
  return row;
}

// QA #281 Phase C — "+ 영상 URL 추가" 버튼 → 새 row 한 줄 추가.
function _addVideoToGroup(btn){
  var block = btn && btn.closest && btn.closest('.news-block');
  if (!block) return;
  var container = block.querySelector('.news-block-videos');
  if (container) _appendVideoGroupRow(container, '', '');
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
      document.getElementById('thumbPreview').innerHTML='<img loading="lazy" src="'+e.target.result+'" style="max-width:200px;max-height:250px;object-fit:cover"><div class="pe-upload-text" style="margin-top:8px">업로드됨 · 클릭하여 변경</div>';
      // Mark the wrapping .pe-upload as having a thumb so the X button
      // becomes visible (the X is hidden until is-current = true).
      var box=document.getElementById('thumbUploadBox');
      if(box) box.classList.add('has-thumb');
      // 커버 선택 시스템 — 업로드는 "보조" 소스. 업로드한 파일이 커버
      // 생성기의 소스가 되도록 data URL 을 기록하고, 갤러리 커버 선택은
      // 해제한다. 이전에 확정된 합성 커버도 무효화(소스가 바뀌었으므로).
      _papCoverSourceUrl = e.target.result;
      galleryCoverNum = null;
      _papComposedCoverUrl = null;
      if(typeof _renderGalleryCoverState==='function') _renderGalleryCoverState();
      if(typeof _papCoverEnsureLiveWired==='function') _papCoverEnsureLiveWired();
      if(typeof _papCoverScheduleLiveRender==='function') _papCoverScheduleLiveRender();
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
  // 커버 선택 시스템 상태도 함께 초기화.
  _papCoverSourceUrl = '';
  galleryCoverNum = null;
  _papComposedCoverUrl = null;
  if(typeof _renderGalleryCoverState==='function') _renderGalleryCoverState();
  if(typeof _papCoverScheduleLiveRender==='function') _papCoverScheduleLiveRender();
}

var galleryCount=0;
var galleryImages=[];
// galleryThumbNum → ★ row picked as the homepage CARD THUMBNAIL
//                   (small image, persisted as `thumbnail`).
// Defaults to null; the first uploaded image takes the role until
// the admin picks something else. Stored as data-img-num so
// reordering doesn't drift the selection.
// (galleryCoverNum — 화보 갤러리에서 커버 SOURCE 로 고른 이미지의
//  data-img-num. 커버 피커가 이 값을 채우고, 커버 생성기가 이 소스로
//  매거진 커버를 합성한다. null 이면 첫 갤러리 이미지를 기본 소스로 사용.)
var galleryThumbNum=null;
var galleryCoverNum=null;

// 커버 생성기(매거진 커버 합성)의 SOURCE 이미지 URL — data URL(업로드)
// 또는 http URL(갤러리 선택). 결과물(합성 커버)과 분리해서 보관해야
// 라이브 미리보기가 이미 합성된 이미지를 다시 합성(이중 오버레이)하지
// 않는다.
var _papCoverSourceUrl='';
// "이 디자인을 커버로 확정" 클릭 시 업로드된 합성 매거진 커버 URL.
// savePost 에서 cover_image(상세 hero)로 저장된다.
var _papComposedCoverUrl=null;

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

// ── QA #255 — admin-side auto-compressor ───────────────────────────────────
// Editors routinely have raw exports >2MB (10–40MB out of Lightroom is
// normal). Rather than asking them to round-trip through a third-party
// compressor every time, the admin gallery picker now sends oversized
// files through a client-side canvas compressor that drops the longest
// edge + JPEG quality in steps until the result clears 2MB. Returns a
// new File object that downstream code uses transparently — the rest of
// the upload flow doesn't change.
//
// Algorithm (escalating loss until under target):
//   step 1: 2400px @ 0.85
//   step 2: 2400px @ 0.75 → 0.65 → 0.55
//   step 3: 2000px @ same quality ladder
//   step 4: 1800 → 1600 → 1400 px with same ladder
//   give up below 1400 / 0.5 — return last attempt anyway (better than
//   blocking the admin entirely; they'll see a warning in the feedback).
async function _compressGalleryImage(file, targetBytes){
  targetBytes = targetBytes || GALLERY_MAX_BYTES;
  // Read source into an Image element.
  var dataUrl = await new Promise(function(res, rej){
    var r = new FileReader();
    r.onload  = function(e){ res(e.target.result); };
    r.onerror = function(){ rej(new Error('파일 읽기 실패')); };
    r.readAsDataURL(file);
  });
  var img = await new Promise(function(res, rej){
    var im = new Image();
    im.onload  = function(){ res(im); };
    im.onerror = function(){ rej(new Error('이미지 디코드 실패')); };
    im.src = dataUrl;
  });

  var sourceW = img.naturalWidth, sourceH = img.naturalHeight;
  // Long-edge dimension ladder. 2400 keeps print-quality detail for the
  // hero shots; below 1400 we stop because quality drops noticeably and
  // anything that hasn't compressed by then is usually a paper-thin
  // gradient where JPEG codec just doesn't help.
  var dimLadder     = [2400, 2000, 1800, 1600, 1400];
  var qualityLadder = [0.85, 0.75, 0.65, 0.55, 0.5];

  var lastBlob = null;
  for (var di = 0; di < dimLadder.length; di++){
    var maxDim = dimLadder[di];
    // Compute target canvas size preserving aspect ratio. If the source
    // is already smaller than maxDim we still try the quality ladder —
    // some sources are 2000px but 8MB because of zero JPEG compression.
    var scale = Math.min(1, maxDim / Math.max(sourceW, sourceH));
    var dw = Math.round(sourceW * scale);
    var dh = Math.round(sourceH * scale);
    var canvas = document.createElement('canvas');
    canvas.width  = dw;
    canvas.height = dh;
    var ctx = canvas.getContext('2d');
    // White background — JPEG has no alpha channel, so transparent PNG
    // source pixels would default to BLACK without this. White matches
    // the PAP site bg and is the safer default for editorial shots.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(img, 0, 0, dw, dh);

    for (var qi = 0; qi < qualityLadder.length; qi++){
      var q = qualityLadder[qi];
      var blob = await new Promise(function(res){
        canvas.toBlob(function(b){ res(b); }, 'image/jpeg', q);
      });
      if (!blob) continue;
      lastBlob = blob;
      if (blob.size <= targetBytes){
        // We hit the target — wrap as File with a .jpg extension so the
        // upload pipeline tags it correctly downstream.
        var safeName = (file.name || 'image')
          .replace(/\.(png|jpe?g|webp|heic|heif|gif|bmp|tiff?)$/i, '')
          + '.jpg';
        return new File([blob], safeName, { type: 'image/jpeg' });
      }
    }
  }
  // Couldn't reach the target — return the smallest attempt anyway so the
  // editor gets SOMETHING uploaded; the caller surfaces a warning.
  if (lastBlob){
    var fallbackName = (file.name || 'image')
      .replace(/\.(png|jpe?g|webp|heic|heif|gif|bmp|tiff?)$/i, '')
      + '.jpg';
    return new File([lastBlob], fallbackName, { type: 'image/jpeg' });
  }
  throw new Error('압축 실패');
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
function _summarizeGalleryBatch(added, blocked, compressed){
  // QA #95 — removed the ratio-warn arm. Aspect ratio is no longer
  // evaluated at upload.
  // QA #255 — added a "압축됨" count so the editor sees how many of the
  // newly-added files went through the auto-shrink path.
  var msgs=[];
  if(added>0)      msgs.push(added+'장 추가됨');
  if(compressed>0) msgs.push(compressed+'장 자동 압축');
  if(blocked>0)    msgs.push(blocked+'장 차단됨');
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
  // QA #255 — auto-compress counter so the batch summary distinguishes
  // "added as-is" from "added after auto-shrink".
  var compressed = 0;

  files.forEach(async function(file){
    // QA #255 — admin auto-compression. Anything over 2MB is run through
    // _compressGalleryImage() instead of being blocked outright. The
    // compressor returns a new File (image/jpeg) under the budget; we
    // proceed with that file as if the user had uploaded it directly.
    // The 60MB hard cap protects against accidentally selecting a 4K
    // video / raw camera dump which would tie up the browser tab.
    var HARD_CAP_BYTES = 60 * 1024 * 1024;
    if (file.size > HARD_CAP_BYTES){
      blocked++;
      _galleryFeedback('"'+file.name+'" 파일이 너무 큽니다 ('+(file.size/1024/1024).toFixed(1)+'MB > 60MB). 사진/그래픽 파일이 아닐 가능성이 있습니다.', 'error');
      _summarizeGalleryBatch(added, blocked, compressed);
      return;
    }
    if (file.size > GALLERY_MAX_BYTES){
      _galleryFeedback('"'+file.name+'" ('+(file.size/1024/1024).toFixed(1)+'MB) 자동 압축 중…', 'info');
      try {
        var origBytes = file.size;
        file = await _compressGalleryImage(file);
        var compactedMB = (file.size/1024/1024).toFixed(2);
        var origMB = (origBytes/1024/1024).toFixed(1);
        compressed++;
        // Note: feedback message will be overwritten by _summarizeGalleryBatch
        // once this file lands; that's fine — the editor sees the running
        // "압축됨" total which is more useful than per-file noise.
        console.log('[gallery] auto-compressed:', file.name, origMB+'MB →', compactedMB+'MB');
      } catch(e){
        blocked++;
        _galleryFeedback('"'+file.name+'" 자동 압축 실패: '+(e && e.message || e), 'error');
        _summarizeGalleryBatch(added, blocked, compressed);
        return;
      }
    }
    // STEP 1 — synchronous validation (size only). QA #95 confirmed: NO
    // aspect-ratio gate at this stage. The frontend layer (.ed-gallery-item)
    // contains any ratio into a 4:5 box at display time.
    var v = _validateGalleryFile(file);
    if(!v.ok){
      blocked++;
      _summarizeGalleryBatch(added, blocked, compressed);
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
      _summarizeGalleryBatch(added, blocked, compressed);
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
        + '<button class="pe-gallery-cover" onclick="event.stopPropagation();setGalleryCover('+num+')" title="커버로 사용 (에디토리얼 최상단 · 매거진 커버 합성 소스)" aria-label="커버로 사용">◆</button>'
        + '<button class="pe-gallery-mosaic" onclick="event.stopPropagation();openMosaicEditor('+num+')" title="부분 모자이크 (외설 부분만 가리기)" aria-label="부분 모자이크">🟦</button>'
        + '<span class="pe-tag-thumb">THUMB</span>'
        + '<span class="pe-tag-cover">COVER</span>'
        + '<span class="pe-gallery-num">#'+num+'</span>';
      grid.insertBefore(div, addBtn);
      _wireGalleryItemDrag(div);
      updateImgCredits();
      added++;
      _summarizeGalleryBatch(added, blocked, compressed);
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
      _summarizeGalleryBatch(added, blocked, compressed);
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
// 화보 갤러리에서 커버 SOURCE 이미지를 고른다(◆ 버튼). 고른 이미지를
// 커버 생성기의 소스로 지정하고, 상단 "커버 이미지" 프리뷰에도 반영한
// 뒤 라이브 미리보기를 즉시 다시 그린다(슬라이더를 건드릴 필요 없음).
function setGalleryCover(num){
  var hit = galleryImages.find(function(g){ return g.num===num; });
  if(!hit) return;
  galleryCoverNum = num;
  _papCoverSourceUrl = hit.src;        // 생성기 소스 = 이 화보 이미지
  _papComposedCoverUrl = null;         // 소스가 바뀌었으니 이전 확정 무효
  var thumbPrev = document.getElementById('thumbPreview');
  var thumbBox  = document.getElementById('thumbUploadBox');
  if(thumbPrev){
    thumbPrev.innerHTML = '<img loading="lazy" src="'+esc(hit.src)+'" style="max-width:200px;max-height:250px;object-fit:cover"><div class="pe-upload-text" style="margin-top:8px">화보에서 선택됨 · 아래에서 커버로 확정</div>';
  }
  if(thumbBox){
    thumbBox.classList.add('has-thumb');
    thumbBox.setAttribute('data-thumb-cleared','0');
    // 미확정 상태로 저장하면 원본 화보 이미지를 커버로 사용(fallback).
    thumbBox.dataset.existingUrl = hit.src;
  }
  // 갤러리 선택이 이겼으니 대기 중이던 업로드 파일은 비운다.
  var thumbInput = document.getElementById('thumbInput');
  if(thumbInput){ try{ thumbInput.value=''; }catch(_){} }
  _renderGalleryCoverState();
  if(typeof _papCoverEnsureLiveWired==='function') _papCoverEnsureLiveWired();
  if(typeof _papCoverScheduleLiveRender==='function') _papCoverScheduleLiveRender();
}

function _renderGalleryCoverState(){
  // Single render pass updates the ★ thumb + ◆ cover class on every row
  // so the visual outline + label always reflects current state.
  document.querySelectorAll('#galleryGrid .pe-gallery-item').forEach(function(el){
    var n = parseInt(el.getAttribute('data-img-num'),10);
    el.classList.toggle('is-thumb', n === galleryThumbNum);
    el.classList.toggle('is-cover', n === galleryCoverNum);
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
// ⚠ 이 목록은 api/_lib/creditRoles.js 의 CANONICAL_ROLES 복제본이다.
//   브라우저에서 require 를 못 쓰므로 복제하되, tests/credit-roles.test.js 가
//   두 파일을 대조해 어긋나면 실패한다. 한쪽만 고치면 테스트가 막아준다.
//   순서·철자까지 정확히 같아야 한다.
var EDITORIAL_CREDIT_ROLES = [
  'Photographer','Photographer assist',
  'Stylist','Stylist assist',
  'Make Up','Make Up assist',
  'Hair','Hair assist',
  'Make Up & Hair',
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

// ── QA #262 — Auto-extract credits + brands from a PDF ──────────────────
//
// Flow:
//   1. Editor picks a PDF in <input type=file>. We grab File object.
//   2. pdf.js parses every page's text layer client-side. The binary
//      never leaves the browser, only the text does.
//   3. We POST { text } to /api/admin/editorials/parse-credits-pdf which
//      runs Claude to convert the freeform credit sheet into a JSON
//      array of { roles, name, instagram } credit rows + { name,
//      instagram } brand rows.
//   4. Form is wiped + repopulated. Existing rows are replaced because
//      partial merges from arbitrary PDF formats would mis-pair handles
//      with the wrong person. Editor can manually add more after.
//
// Failure modes are visible — status text under the button surfaces any
// of: PDF library not loaded, empty text layer (scanned image PDF),
// Claude API error, malformed JSON.
async function papParseCreditsFromPdf(inputEl){
  var statusEl = document.getElementById('creditsPdfStatus');
  function _status(msg, kind){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = (kind === 'error') ? '#c62828'
                        : (kind === 'ok')    ? '#16a34a'
                        : (kind === 'warn')  ? '#b86b00'
                        :                      'var(--text3)';
  }
  if (!inputEl || !inputEl.files || !inputEl.files[0]) return;
  var file = inputEl.files[0];
  // Reset the input so picking the same file twice in a row still fires.
  inputEl.value = '';
  // pdf.js loaded?
  if (!window.pdfjsLib) {
    _status('❌ PDF 라이브러리가 아직 로드되지 않았습니다. 페이지를 새로고침해주세요.', 'error');
    return;
  }
  // 10MB hard cap. Editorial credit sheets are tiny; anything bigger
  // is almost certainly the wrong file.
  if (file.size > 10 * 1024 * 1024) {
    _status('❌ PDF가 너무 큽니다 (' + (file.size/1024/1024).toFixed(1) + 'MB > 10MB).', 'error');
    return;
  }

  _status('PDF 텍스트 추출 중…');

  var allText = '';
  try {
    var buf = await file.arrayBuffer();
    var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var content = await page.getTextContent();
      // Each .items[i].str is a text fragment in reading order. Join with
      // spaces and newline between pages — credit sheets are usually
      // one role per line and the line breaks carry through fine.
      var pageText = content.items.map(function(it){ return it.str || ''; }).join(' ');
      allText += pageText + '\n';
    }
  } catch (e) {
    console.error('[pdf-parse] pdf.js failed:', e);
    _status('❌ PDF 텍스트 추출 실패: ' + (e && e.message || e), 'error');
    return;
  }

  allText = (allText || '').trim();
  if (!allText) {
    _status('❌ PDF 안에 텍스트가 없습니다. 스캔 이미지 PDF는 지원되지 않습니다.', 'error');
    return;
  }

  _status('Claude로 크레딧 분석 중…');

  var parsed;
  try {
    var token = (typeof PAP !== 'undefined' && PAP.auth && PAP.auth.getToken) ? PAP.auth.getToken() : '';
    var resp = await fetch('/api/admin/editorials/parse-credits-pdf', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({ text: allText }),
    });
    var json = await resp.json();
    if (!resp.ok) {
      _status('❌ ' + (json.error || ('서버 오류: ' + resp.status)), 'error');
      return;
    }
    parsed = json;
  } catch (e) {
    console.error('[pdf-parse] fetch failed:', e);
    _status('❌ 서버 호출 실패: ' + (e && e.message || e), 'error');
    return;
  }

  var credits     = Array.isArray(parsed.credits)     ? parsed.credits     : [];
  var brands      = Array.isArray(parsed.brands)      ? parsed.brands      : [];
  // QA #263 — per-image (look) credits. Each entry is { index, text }
  // where index is 1-based to match the editor's mental model of
  // "Image #1 / #2 / ...".
  var lookCredits = Array.isArray(parsed.lookCredits) ? parsed.lookCredits : [];

  if (!credits.length && !brands.length && !lookCredits.length) {
    _status('⚠️ PDF에서 크레딧을 찾지 못했습니다. 직접 입력해주세요.', 'warn');
    return;
  }

  // Confirm with the editor before overwriting any existing rows.
  var creditsArea = document.getElementById('creditsArea');
  var brandsArea  = document.getElementById('brandsArea');
  var existingCreditRows = creditsArea ? creditsArea.querySelectorAll('.pe-credit-row').length : 0;
  var existingBrandRows  = brandsArea ? brandsArea.querySelectorAll('.pe-brand-row').length : 0;
  // Only ask for confirmation if there's something non-trivial to lose.
  var hasNonEmpty = false;
  if (existingCreditRows) {
    creditsArea.querySelectorAll('.pe-credit-row').forEach(function(r){
      var ig = r.querySelector('.pe-credit-ig');
      var nm = r.querySelector('.pe-credit-name');
      if ((ig && ig.value.trim()) || (nm && nm.value.trim())) hasNonEmpty = true;
    });
  }
  if (hasNonEmpty) {
    if (!confirm('PDF에서 ' + credits.length + '명의 크레딧 + ' + brands.length + '개의 브랜드를 추출했습니다.\n\n현재 입력된 크레딧을 모두 지우고 PDF 내용으로 교체할까요?')) {
      _status('사용자가 취소했습니다.');
      return;
    }
  }

  // Wipe existing rows, then add one per parsed credit.
  if (creditsArea) creditsArea.innerHTML = '';
  credits.forEach(function(c){
    if (typeof addCredit === 'function') addCredit('creditsArea');
    var rows = creditsArea.querySelectorAll('.pe-credit-row');
    var row = rows[rows.length - 1];
    if (!row) return;
    var ig = row.querySelector('.pe-credit-ig');
    var nm = row.querySelector('.pe-credit-name');
    var trig = row.querySelector('.pe-role-trigger');
    if (nm) nm.value = c.name || '';
    if (ig) ig.value = c.instagram || '';
    // Roles attach via the chip trigger's hidden state; safest is to
    // store via dataset and re-render.
    if (trig && Array.isArray(c.roles)) {
      trig.dataset.roles = JSON.stringify(c.roles);
      if (typeof _renderRoleChips === 'function') _renderRoleChips(trig);
    }
  });

  // Brands — wipe, then add one row per parsed brand.
  if (brandsArea) brandsArea.innerHTML = '';
  brands.forEach(function(b){
    if (typeof addBrand === 'function') addBrand();
    var rows = brandsArea.querySelectorAll('.pe-brand-row');
    var row = rows[rows.length - 1];
    if (!row) return;
    var nm = row.querySelector('.pe-brand-name');
    var ig = row.querySelector('.pe-brand-ig');
    if (nm) nm.value = b.name || '';
    if (ig) ig.value = b.instagram || '';
  });

  // QA #263 — per-image outfit credits. Match LOOK index (1-based from
  // the PDF) to the gallery image at the same 1-based position so
  // editor doesn't have to manually pair "Look 1 → Image #1". The
  // backend already filtered out any look entries that don't look like
  // valid { index, text }.
  var lookHits = 0;
  if (lookCredits.length && typeof galleryImages !== 'undefined' && Array.isArray(galleryImages)) {
    lookCredits.forEach(function(lc){
      var idx = lc.index - 1;  // PDF is 1-based; array is 0-based
      if (idx >= 0 && idx < galleryImages.length) {
        galleryImages[idx].credits = lc.text;
        lookHits++;
      }
    });
    // Re-render the per-image credits area so the new values appear.
    if (typeof updateImgCredits === 'function') updateImgCredits();
  }

  var msg = '✓ 크레딧 ' + credits.length + '명 + 브랜드 ' + brands.length + '개';
  if (lookHits > 0) msg += ' + 착장 ' + lookHits + '룩';
  msg += ' 추출 완료';
  if (lookCredits.length > galleryImages.length) {
    msg += ' (PDF에 ' + lookCredits.length + '룩 있으나 갤러리는 ' + galleryImages.length + '장)';
  }
  if (parsed.warnings && parsed.warnings.length) {
    msg += ' · ⚠️ ' + parsed.warnings.length + '건 확인 필요';
    console.warn('[pdf-parse] warnings:', parsed.warnings);
  }
  _status(msg, 'ok');
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

// 데일리 성장 진단 위젯 (2026-07) — growth_reports 최신 리포트를 어드민 홈에 표시.
// 전문 대시보드는 /site-analysis. 실패해도 대시보드 나머지에 영향 없음.
async function loadDashboardGrowth(){
  var badges=document.getElementById('dashGrowthBadges');
  var fails=document.getElementById('dashGrowthFails');
  var fb=document.getElementById('dashGrowthFeedback');
  if(!badges||!fb) return;
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function md(src){ // 초경량 마크다운 (##, **, 목록)
    var out=[],list=null;
    String(src||'').split('\n').forEach(function(ln){
      var t=ln.trim();
      if(!t){if(list){out.push('</'+list+'>');list=null;}return;}
      var inline=esc(t).replace(/\*\*([^*]+)\*\*/g,'<strong style="color:var(--text,#111)">$1</strong>');
      if(/^##\s+/.test(t)){if(list){out.push('</'+list+'>');list=null;}out.push('<div style="font-weight:800;color:var(--text,#111);margin:12px 0 4px;font-size:12.5px">'+inline.replace(/^##\s+/,'')+'</div>');}
      else if(/^[-•]\s+/.test(t)){if(list!=='ul'){if(list)out.push('</'+list+'>');out.push('<ul style="margin:2px 0 8px 16px;padding:0">');list='ul';}out.push('<li style="margin-bottom:3px">'+inline.replace(/^[-•]\s+/,'')+'</li>');}
      else if(/^\d+[.)]\s+/.test(t)){if(list!=='ol'){if(list)out.push('</'+list+'>');out.push('<ol style="margin:2px 0 8px 16px;padding:0">');list='ol';}out.push('<li style="margin-bottom:3px">'+inline.replace(/^\d+[.)]\s+/,'')+'</li>');}
      else{if(list){out.push('</'+list+'>');list=null;}out.push('<p style="margin:0 0 6px">'+inline+'</p>');}
    });
    if(list)out.push('</'+list+'>');
    return out.join('');
  }
  try{
    var res=await apiGet('/growth-report');
    var row=res&&res.data;
    if(!row) throw new Error(res&&res.error||'리포트 없음');
    var d=document.getElementById('dashGrowthDate');
    if(d)d.textContent='· '+(row.report_date||'');
    var s=(row.audit&&row.audit.summary)||{};
    function badge(n,label,color){return '<span style="background:'+color+'22;color:'+color+';border:1px solid '+color+'44;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700">'+label+' '+(n||0)+'</span>';}
    badges.innerHTML=badge(s.ok,'정상','#16a34a')+badge(s.warn,'주의','#ca8a04')+badge(s.fail,'긴급','#dc2626')+badge(s.error,'측정실패','#7c3aed');
    // fail 항목 라벨
    var failLabels=[];
    var secs=(row.audit&&row.audit.sections)||{};
    Object.keys(secs).forEach(function(k){(secs[k]||[]).forEach(function(c){if(c.status==='fail')failLabels.push(c.label);});});
    if(failLabels.length){fails.style.display='';fails.innerHTML='🚨 '+failLabels.map(esc).join(' · ');}
    else{fails.style.display='none';}
    // 예상 질문 칩 — 리포트 상태 기반 동적 생성 (긴급 항목 우선)
    var sug=document.getElementById('dashAskSuggest');
    if(sug){
      var qs=[];
      if(failLabels.length) qs.push('"'+failLabels[0].split(' (')[0]+'" 문제, 원인과 해결책은?');
      qs.push('이번 주 가장 큰 병목은?');
      qs.push('지난주 대비 좋아진 것과 나빠진 것은?');
      qs.push('오늘 딱 하나만 실행한다면?');
      if((s.warn||0)>3) qs.push('주의 항목 '+s.warn+'개 중 뭐부터 처리해야 해?');
      sug.innerHTML=qs.slice(0,4).map(function(q){
        return '<button type="button" onclick="var i=document.getElementById(\'dashAskInput\');i.value=this.textContent;dashAskAI();" '
          +'style="background:var(--surface,#fff);border:1px solid var(--border2,rgba(0,0,0,.12));border-radius:100px;padding:5px 12px;font-size:11px;color:var(--text2,rgba(0,0,0,.55));cursor:pointer">'+esc(q)+'</button>';
      }).join('');
    }
    fb.innerHTML=row.feedback?md(row.feedback):'<span style="color:var(--text3)">AI 피드백이 아직 없습니다 — 매일 07:30 자동 생성됩니다.</span>';
  }catch(e){
    fb.innerHTML='<span style="color:var(--text3)">성장 진단을 불러오지 못했습니다: '+esc(e.message||e)+'</span>';
  }
  // 추세 레이더 로드 (독립 — 실패해도 위 내용 유지)
  try{
    var tr=await apiGet('/growth-report?trends=1');
    var box=document.getElementById('dashGrowthTrends');
    if(box&&tr&&tr.trends){
      box.innerHTML=tr.trends.map(function(t){
        var color=t.status==='anomaly'?'#dc2626':t.status==='up'?'#16a34a':t.status==='down'?'#ca8a04':'#999';
        var icon=t.status==='anomaly'?'⚠️':t.status==='up'?'▲':t.status==='down'?'▼':'—';
        var body;
        if(t.status==='collecting'){ body='<span style="color:var(--text3);font-size:11px">'+esc(t.note)+'</span>'; }
        else{
          // 스파크라인 (SVG)
          var vs=t.points.map(function(p){return p.v;});
          var mx=Math.max.apply(null,vs), mn=Math.min.apply(null,vs), rg=(mx-mn)||1;
          var pts=vs.map(function(v,i){return (i*(96/Math.max(1,vs.length-1)))+','+(22-((v-mn)/rg)*18);}).join(' ');
          body='<svg viewBox="0 0 96 24" style="width:100%;height:24px;display:block"><polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="1.5"/></svg>'
            +'<div style="font-size:10.5px;color:var(--text3);margin-top:3px">현재 '+vs[vs.length-1]+' · 7일 뒤 예측 '+t.forecast7+(t.anomaly?' · <b style="color:#dc2626">이상 z='+t.z+'</b>':'')+'</div>';
        }
        return '<div style="background:var(--surface,#fff);border:1px solid var(--border2,rgba(0,0,0,.12));border-left:3px solid '+color+';border-radius:8px;padding:10px 12px">'
          +'<div style="font-size:11px;font-weight:700;margin-bottom:5px;color:var(--text,#111)"><span style="color:'+color+'">'+icon+'</span> '+esc(t.label)+'</div>'+body+'</div>';
      }).join('');
    }
  }catch(_){}
}

// AI에게 질문 — 최신 진단을 근거로 자연어 분석 답변
async function dashAskAI(){
  var inp=document.getElementById('dashAskInput'), out=document.getElementById('dashAskAnswer'), btn=document.getElementById('dashAskBtn');
  if(!inp||!out) return;
  var q=(inp.value||'').trim(); if(!q) return;
  btn.disabled=true; out.style.display=''; out.innerHTML='<span style="color:var(--text3)">분석 중…</span>';
  try{
    var r=await fetch((window.API_BASE||'/api')+'/growth-ask',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('pap-token')},body:JSON.stringify({question:q})});
    var j=await r.json().catch(function(){return {};});
    if(!r.ok) throw new Error(j.error||('HTTP '+r.status));
    out.innerHTML='<b style="color:var(--text,#111)">Q. '+q.replace(/</g,'&lt;')+'</b><br>'+String(j.answer||'').replace(/</g,'&lt;').replace(/\*\*([^*]+)\*\*/g,'<strong style="color:var(--text,#111)">$1</strong>').replace(/\n/g,'<br>');
  }catch(e){ out.innerHTML='<span style="color:#dc2626">실패: '+String(e.message||e).replace(/</g,'&lt;')+'</span>'; }
  btn.disabled=false;
}

async function loadDashboardStats(){
  // Date in header
  var dashDate=document.getElementById('dashDate');
  if(dashDate)dashDate.textContent=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'});
  // 성장 진단 위젯 — 병렬 로드 (대시보드 본체와 독립)
  try{loadDashboardGrowth();}catch(_){}

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

// ────────────────────────────────────────────────────────────────────────
// QA #209 — content audit log panel (shared by editorial/article/film/shorts).
// Loads the audit history for a content row and renders the summary cards
// (생성자/최종 수정자/승인자/발행 담당자) + collapsible full history list.
// Lives at module scope because all four edit modals reuse the same DOM
// node (#contentAuditPanel) — only data-content-type and the content id
// change per modal.
async function loadContentAuditPanel(contentType, contentId){
  var panel = document.getElementById('contentAuditPanel');
  if(!panel) return;
  if(!contentId){
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  panel.dataset.contentType = contentType;
  // Reset placeholder while fetching.
  var sumEl = document.getElementById('contentAuditSummary');
  var histEl = document.getElementById('contentAuditHistory');
  if(sumEl) sumEl.innerHTML = '<div style="grid-column:span 4;color:var(--text3);text-align:center;padding:10px">불러오는 중…</div>';
  if(histEl) histEl.innerHTML = '';

  try {
    var res = await apiGet('/admin/content-audit/' + contentType + '/' + contentId + '?limit=100');
    var entries = (res && res.data) || [];
    _renderContentAuditSummary(contentType, contentId, entries);
    _renderContentAuditHistory(entries);
  } catch(err){
    if(sumEl) sumEl.innerHTML = '<div style="grid-column:span 4;color:var(--red);text-align:center;padding:10px">작업 로그를 불러오지 못했습니다</div>';
  }
}

// Resolve the four key actors from the audit log + the original row.
// - 생성자: action='create' (oldest). Falls back to created_by on the row.
// - 최종 수정자: most recent action='update' (or any non-create/delete).
// - 승인자: oldest action='approve' (서브미션→에디토리얼 승인). 없으면 '—'.
// - 발행 담당자: most recent action='publish'. 없으면 '—'.
function _renderContentAuditSummary(contentType, contentId, entries){
  var sumEl = document.getElementById('contentAuditSummary');
  if(!sumEl) return;

  // Find the source row in the appropriate in-memory list so we can use
  // _creator/_editor as a fallback when the audit log doesn't have a
  // create entry (e.g. rows created before QA #202 launched).
  var sourceRow = _lookupContentRow(contentType, contentId);

  var creator = null, lastEditor = null, approver = null, publisher = null;
  // entries are returned newest-first.
  for(var i = 0; i < entries.length; i++){
    var e = entries[i];
    if(!creator && e.action === 'create') creator = e;
    if(!approver && e.action === 'approve') approver = e;
    if(!publisher && e.action === 'publish') publisher = e;
    if(!lastEditor && (e.action === 'update' || e.action === 'publish' || e.action === 'unpublish')) lastEditor = e;
  }
  // Fallback to row authorship denormalisation for legacy rows.
  if(!creator && sourceRow && sourceRow._creator){
    creator = {
      actor_label: sourceRow._creator.display_name || sourceRow._creator.email || '—',
      created_at: sourceRow.created_at,
    };
  }
  if(!lastEditor && sourceRow && sourceRow._editor){
    lastEditor = {
      actor_label: sourceRow._editor.display_name || sourceRow._editor.email || '—',
      created_at: sourceRow.updated_at || sourceRow.admin_edited_at || sourceRow.created_at,
    };
  }

  var card = function(label, color, actor, ts){
    var who = actor ? esc(actor.actor_label || '—') : '<span style="color:var(--text3)">—</span>';
    var when = '';
    var tsStr = ts || (actor && actor.created_at) || '';
    if(tsStr){
      try {
        var d = new Date(tsStr);
        if(!isNaN(d.getTime())){
          when = d.getFullYear() + '-' +
            String(d.getMonth()+1).padStart(2,'0') + '-' +
            String(d.getDate()).padStart(2,'0') + ' ' +
            String(d.getHours()).padStart(2,'0') + ':' +
            String(d.getMinutes()).padStart(2,'0');
        }
      } catch(_){}
    }
    return '<div style="background:#fff;border:1px solid var(--border2);border-left:3px solid '+color+';border-radius:4px;padding:10px 12px">'
      + '<div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:4px">'+esc(label)+'</div>'
      + '<div style="font-size:12px;font-weight:600;color:var(--text);line-height:1.4">'+who+'</div>'
      + (when ? '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+esc(when)+'</div>' : '')
      + '</div>';
  };

  sumEl.innerHTML = ''
    + card('생성자',       '#22c55e', creator,    creator    && creator.created_at)
    + card('최종 수정자',  '#7c3aed', lastEditor, lastEditor && lastEditor.created_at)
    + card('승인자',       '#f59e0b', approver,   approver   && approver.created_at)
    + card('발행 담당자',  '#3b82f6', publisher,  publisher  && publisher.created_at);
}

// Find the row in the matching in-memory list. Used for authorship fallback
// when the audit log doesn't have a create entry.
function _lookupContentRow(contentType, contentId){
  if(contentType === 'editorial')  return (editorials  || []).find(function(r){ return r && r.id === contentId; });
  if(contentType === 'article')    return (allArticles || []).find(function(r){ return r && r.id === contentId; });
  if(contentType === 'film')       return (films       || []).find(function(r){ return r && r.id === contentId; });
  if(contentType === 'shorts')     return (shortsList  || []).find(function(r){ return r && r.id === contentId; });
  return null;
}

// Render the full audit history as a vertical timeline. Each row shows
// the action verb (Korean) + actor + relative time + diff field count.
function _renderContentAuditHistory(entries){
  var el = document.getElementById('contentAuditHistory');
  if(!el) return;
  if(!entries || !entries.length){
    el.innerHTML = '<div style="color:var(--text3);text-align:center;padding:14px">기록된 작업 로그가 없습니다</div>';
    return;
  }
  var actionLabel = {
    create:    '🆕 등록',
    update:    '✏️ 수정',
    publish:   '✅ 공개',
    unpublish: '⏸ 비공개',
    approve:   '🎉 승인',
    delete:    '🗑 삭제',
  };
  var actionColor = {
    create:'#22c55e', update:'#7c3aed', publish:'#3b82f6',
    unpublish:'#f59e0b', approve:'#f59e0b', delete:'#ef4444',
  };
  var html = entries.map(function(e){
    var label = actionLabel[e.action] || ('• ' + (e.action||'?'));
    var color = actionColor[e.action] || 'var(--text3)';
    var when = '';
    try {
      var d = new Date(e.created_at);
      if(!isNaN(d.getTime())){
        when = d.getFullYear() + '-' +
          String(d.getMonth()+1).padStart(2,'0') + '-' +
          String(d.getDate()).padStart(2,'0') + ' ' +
          String(d.getHours()).padStart(2,'0') + ':' +
          String(d.getMinutes()).padStart(2,'0');
      }
    } catch(_){}
    var diffCount = e.diff ? Object.keys(e.diff).length : 0;
    var diffNote = diffCount ? '<span style="color:var(--text3);margin-left:6px">· '+diffCount+'개 필드 변경</span>' : '';
    var summary = e.summary ? '<div style="font-size:11px;color:var(--text2);margin-top:2px">'+esc(e.summary)+'</div>' : '';
    return ''
      + '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px dashed var(--border2)">'
      +   '<div style="min-width:80px;font-weight:600;color:'+color+';font-size:11px">'+label+'</div>'
      +   '<div style="flex:1;font-size:12px">'
      +     '<div><strong>'+esc(e.actor_label || '—')+'</strong>'+diffNote+'</div>'
      +     summary
      +   '</div>'
      +   '<div style="font-size:10px;color:var(--text3);min-width:120px;text-align:right">'+esc(when)+'</div>'
      + '</div>';
  }).join('');
  el.innerHTML = html;
}

// Toggle the full history list. Summary cards stay visible — the toggle
// only flips the detail panel + button label.
function toggleContentAuditPanel(){
  var hist = document.getElementById('contentAuditHistory');
  var btn = document.getElementById('contentAuditToggleBtn');
  if(!hist) return;
  if(hist.style.display === 'none'){
    hist.style.display = 'block';
    if(btn) btn.textContent = '▴ 접기';
  } else {
    hist.style.display = 'none';
    if(btn) btn.textContent = '▾ 펼치기';
  }
}
// Expose to inline onclick handlers in admin.html.
window.toggleContentAuditPanel = toggleContentAuditPanel;
window.loadContentAuditPanel = loadContentAuditPanel;

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
      papFetchAllPages('/editorials?fields=admin&status=published'),
      papFetchAllPages('/editorials?fields=admin&status=draft'),
      papFetchAllPages('/editorials?fields=admin&status=scheduled'),
    ]);
    var pub = results[0], draft = results[1], scheduled = results[2];
    // Tag scheduled rows with a synthetic _virtualStatus so the
    // render layer can show the right badge + filter button without
    // mutating the canonical status field.
    var schedRows = (scheduled.data || []).map(function(r){
      r._virtualStatus = 'scheduled';
      return r;
    });
    // QA #208 — dedupe + sort by created_at desc (newest first).
    // The legacy code concatenated published + draft + scheduled in
    // that order, which dumped every scheduled post at the BOTTOM of
    // the "전체" tab regardless of when it was authored. The user's
    // report — "예약 게시물이 전체 리스트 최하단에 배치됨" — was that
    // ordering. Sorting on created_at gives editors a single
    // chronological stream, and the per-status filter still works
    // because each row keeps its effective status.
    var byId = {};
    [].concat(pub.data || [], draft.data || [], schedRows).forEach(function(r){
      if(!r || !r.id) return;
      // Keep the scheduled tag if both buckets returned the same row
      // (scheduled rows are status='published' under the hood, so the
      // published fetch returned them too).
      if(byId[r.id] && r._virtualStatus === 'scheduled'){
        byId[r.id]._virtualStatus = 'scheduled';
      } else if(!byId[r.id]){
        byId[r.id] = r;
      }
    });
    editorials = Object.values(byId).sort(function(a, b){
      var ta = a.created_at || a.published_date || '';
      var tb = b.created_at || b.published_date || '';
      return String(tb).localeCompare(String(ta));
    });
    renderEditorialList();
  }catch(e){
    tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:#ff6b6b;padding:40px">불러오기 실패: '+esc(e.message)+'</td></tr>';
  }
}

// QA #208 Phase 2b — shared sort + date-range helpers for the three
// CMS lists (editorial / news / film). Centralising them here means
// each list has the same option set and the same semantics for
// "what date does the dropdown filter on".
//
// SORT_OPTIONS — `value` is what the <select> stores. The comparator
// reads the documented date/title field directly off the row, so the
// helpers don't need to know which list called them.
var PAP_SORT_OPTIONS = [
  { value: 'recent',       label: '최신순' },
  { value: 'oldest',       label: '오래된순' },
  { value: 'updated_desc', label: '최근 수정순' },
  { value: 'title_asc',    label: '제목 ㄱ→ㅎ' },
  { value: 'views_desc',   label: '조회수순' },
];

// DATE_RANGE — relative buckets. `直접선택` is wired separately to two
// <input type="date"> elements so we can render the "from / to" UI
// without overcomplicating the dropdown.
var PAP_DATE_RANGE_OPTIONS = [
  { value: 'all',    label: '전체 기간' },
  { value: 'today',  label: '오늘' },
  { value: '7d',     label: '최근 7일' },
  { value: '30d',    label: '최근 30일' },
  { value: 'custom', label: '직접 선택' },
];

// DATE_BASIS — which column the range filter operates on. Each list
// passes the actual field name to _papApplyDateRange so this is
// purely the user-facing label set.
var PAP_DATE_BASIS_OPTIONS = [
  { value: 'created',   label: '작성일 기준' },
  { value: 'published', label: '발행일 기준' },
  { value: 'updated',   label: '수정일 기준' },
];

// Resolve a row's timestamp for a given basis. The fallbacks mirror
// what each list already shows in its date column.
function _papResolveDate(row, basis){
  if(!row) return null;
  if(basis === 'created')   return row.created_at || row.published_date || null;
  if(basis === 'published') return row.published_date || row.scheduled_publish_at || row.created_at || null;
  if(basis === 'updated')   return row.admin_edited_at || row.updated_at || row.created_at || null;
  return row.created_at || null;
}

// Range expressed as a {fromIso, toIso} pair, or null when "전체 기간".
// `customFrom`/`customTo` are YYYY-MM-DD strings from the date inputs.
function _papResolveRange(rangeValue, customFrom, customTo){
  var now = new Date();
  var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  function _toEndOfDay(d){
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }
  if(rangeValue === 'today'){
    return { from: startOfToday.toISOString(), to: _toEndOfDay(now).toISOString() };
  }
  if(rangeValue === '7d'){
    var d7 = new Date(now); d7.setDate(d7.getDate() - 7);
    return { from: d7.toISOString(), to: now.toISOString() };
  }
  if(rangeValue === '30d'){
    var d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    return { from: d30.toISOString(), to: now.toISOString() };
  }
  if(rangeValue === 'custom'){
    if(!customFrom && !customTo) return null;
    var from = customFrom ? new Date(customFrom + 'T00:00:00').toISOString() : null;
    var to   = customTo   ? _toEndOfDay(new Date(customTo + 'T00:00:00')).toISOString() : null;
    return { from: from, to: to };
  }
  return null; // 'all' or unrecognised
}

// Filter rows by date range against the chosen basis.
function _papApplyDateRange(rows, rangeValue, basis, customFrom, customTo){
  var range = _papResolveRange(rangeValue, customFrom, customTo);
  if(!range) return rows;
  return rows.filter(function(r){
    var t = _papResolveDate(r, basis);
    if(!t) return false;
    if(range.from && String(t) < range.from) return false;
    if(range.to   && String(t) > range.to)   return false;
    return true;
  });
}

// Sort rows by the chosen option. Operates on the documented fields
// each list exposes; missing values sort to the end for date sorts
// and to '' for title sort (so blank titles cluster together rather
// than inflating page 1).
function _papApplySort(rows, sortValue){
  var copy = rows.slice();
  if(sortValue === 'recent'){
    return copy.sort(function(a,b){
      var ta = a.created_at || a.published_date || '';
      var tb = b.created_at || b.published_date || '';
      return String(tb).localeCompare(String(ta));
    });
  }
  if(sortValue === 'oldest'){
    return copy.sort(function(a,b){
      var ta = a.created_at || a.published_date || '';
      var tb = b.created_at || b.published_date || '';
      return String(ta).localeCompare(String(tb));
    });
  }
  if(sortValue === 'updated_desc'){
    return copy.sort(function(a,b){
      var ta = a.admin_edited_at || a.updated_at || a.created_at || '';
      var tb = b.admin_edited_at || b.updated_at || b.created_at || '';
      return String(tb).localeCompare(String(ta));
    });
  }
  if(sortValue === 'title_asc'){
    return copy.sort(function(a,b){
      return String(a.title||'').localeCompare(String(b.title||''), 'ko');
    });
  }
  if(sortValue === 'views_desc'){
    return copy.sort(function(a,b){
      var va = Number(a.view_count || 0);
      var vb = Number(b.view_count || 0);
      if(va !== vb) return vb - va;
      // Tiebreaker: newest first so equal-zero rows still show recents up top.
      var ta = a.created_at || a.published_date || '';
      var tb = b.created_at || b.published_date || '';
      return String(tb).localeCompare(String(ta));
    });
  }
  return copy;
}

// Build the dropdown markup once so all three lists can drop it into
// their toolbar without duplicating option arrays.
function _papRenderSortDropdown(idPrefix, currentValue, onchange){
  return '<select id="'+idPrefix+'Sort" onchange="'+onchange+'" style="background:#fff;border:1px solid var(--border2);padding:6px 10px;border-radius:4px;font-size:12px;cursor:pointer">'
    + PAP_SORT_OPTIONS.map(function(o){
        return '<option value="'+o.value+'"'+(o.value===currentValue?' selected':'')+'>'+o.label+'</option>';
      }).join('')
    + '</select>';
}
function _papRenderDateRangeDropdown(idPrefix, currentValue, basis, customFrom, customTo, onchange){
  var html = '<select id="'+idPrefix+'Range" onchange="'+onchange+'" style="background:#fff;border:1px solid var(--border2);padding:6px 10px;border-radius:4px;font-size:12px;cursor:pointer">'
    + PAP_DATE_RANGE_OPTIONS.map(function(o){
        return '<option value="'+o.value+'"'+(o.value===currentValue?' selected':'')+'>'+o.label+'</option>';
      }).join('')
    + '</select>'
    + '<select id="'+idPrefix+'Basis" onchange="'+onchange+'" style="margin-left:6px;background:#fff;border:1px solid var(--border2);padding:6px 10px;border-radius:4px;font-size:12px;cursor:pointer">'
    + PAP_DATE_BASIS_OPTIONS.map(function(o){
        return '<option value="'+o.value+'"'+(o.value===basis?' selected':'')+'>'+o.label+'</option>';
      }).join('')
    + '</select>';
  // Custom-range inputs render hidden until 'custom' is selected.
  var hidden = (currentValue === 'custom') ? '' : 'display:none;';
  html += '<span id="'+idPrefix+'CustomWrap" style="margin-left:6px;'+hidden+'">'
    + '<input type="date" id="'+idPrefix+'From" value="'+(customFrom||'')+'" onchange="'+onchange+'" style="background:#fff;border:1px solid var(--border2);padding:5px 8px;border-radius:4px;font-size:12px">'
    + '<span style="margin:0 4px;color:var(--text3)">~</span>'
    + '<input type="date" id="'+idPrefix+'To" value="'+(customTo||'')+'" onchange="'+onchange+'" style="background:#fff;border:1px solid var(--border2);padding:5px 8px;border-radius:4px;font-size:12px">'
    + '</span>';
  return html;
}

// QA #208 Phase 2c — saved filter presets ("quick chips").
// Each preset is a recipe that sets the list's status / sort / range
// state in one click. The implementation is per-list because the
// state variable names differ, but the preset semantics are shared.
//
// Presets used across all three lists:
//   - scheduled : status='scheduled' + sort by scheduled_publish_at asc
//   - today     : today's uploads (date basis = created)
//   - draft     : 임시저장 only
//   - this_week : last 7d
// Per-list helpers below wire the preset name to that list's setters
// and call its render function. The chip UI in admin.html stays the
// same; only the onclick names change.

// QA #208 Phase 2c — "advanced filter" panel collapse state.
// localStorage so the editor's preferred view sticks across reloads.
function _papGetAdvOpen(key){
  try { return localStorage.getItem('pap-adv-'+key) === '1'; } catch(_){ return false; }
}
function _papSetAdvOpen(key, open){
  try { localStorage.setItem('pap-adv-'+key, open ? '1' : '0'); } catch(_){}
}
function papToggleAdvFilter(key){
  var panel = document.getElementById(key+'AdvPanel');
  var btn = document.getElementById(key+'AdvBtn');
  if(!panel) return;
  var open = panel.style.display !== 'none';
  if(open){
    panel.style.display = 'none';
    _papSetAdvOpen(key, false);
    if(btn) btn.textContent = '🔧 고급 필터 ▾';
  } else {
    panel.style.display = 'flex';
    _papSetAdvOpen(key, true);
    if(btn) btn.textContent = '🔧 고급 필터 ▴';
  }
}
// Apply saved open state on first render of each list.
function papInitAdvPanel(key){
  var panel = document.getElementById(key+'AdvPanel');
  var btn = document.getElementById(key+'AdvBtn');
  if(!panel) return;
  var open = _papGetAdvOpen(key);
  panel.style.display = open ? 'flex' : 'none';
  if(btn) btn.textContent = open ? '🔧 고급 필터 ▴' : '🔧 고급 필터 ▾';
}

// QA #208 — bulk-selection state. A plain Set of editorial ids that
// survive re-renders so the user can toggle a status filter without
// losing their checked rows. editorialToggleSelectAll, the per-row
// onchange, and editorialBulkAction all read/write this.
var editorialSelectedIds = new Set();
// QA #208 Phase 2b — sort + date-range state (per-list).
var editorialSortBy = 'recent';
var editorialDateRange = 'all';
var editorialDateBasis = 'created';
var editorialDateFrom = '';
var editorialDateTo = '';
// QA #208 Phase 2g/2h — author role + category dropdown filters.
var editorialRoleFilter = 'all';      // 'all' | 'admin' | 'staff'
var editorialCategoryFilter = 'all';  // 'all' | 'Fashion' | 'Beauty' | …

function setEditorialSortFromUi(){
  var sel = document.getElementById('edAdminSort');
  if(sel) editorialSortBy = sel.value || 'recent';
  renderEditorialList();
}
function setEditorialDateRangeFromUi(){
  var sel = document.getElementById('edAdminRange');
  var basis = document.getElementById('edAdminBasis');
  var from = document.getElementById('edAdminFrom');
  var to = document.getElementById('edAdminTo');
  if(sel) editorialDateRange = sel.value || 'all';
  if(basis) editorialDateBasis = basis.value || 'created';
  if(from) editorialDateFrom = from.value || '';
  if(to) editorialDateTo = to.value || '';
  // Toggle custom-range inputs visibility.
  var wrap = document.getElementById('edAdminCustomWrap');
  if(wrap) wrap.style.display = (editorialDateRange === 'custom') ? '' : 'none';
  renderEditorialList();
}
// QA #208 Phase 2g — author role filter handler.
function setEditorialRoleFromUi(){
  var sel = document.getElementById('edAdminRole');
  if(sel) editorialRoleFilter = sel.value || 'all';
  renderEditorialList();
}
// QA #208 Phase 2h — category dropdown handler.
function setEditorialCategoryFromUi(){
  var sel = document.getElementById('edAdminCategory');
  if(sel) editorialCategoryFilter = sel.value || 'all';
  renderEditorialList();
}

// QA #208 Phase 2c — editorial saved-filter presets.
function applyEditorialPreset(preset){
  if(preset === 'scheduled'){
    edStatusFilter = 'scheduled';
    editorialSortBy = 'recent';
    editorialDateRange = 'all';
  } else if(preset === 'today'){
    edStatusFilter = 'all';
    editorialDateRange = 'today';
    editorialDateBasis = 'created';
    editorialSortBy = 'recent';
  } else if(preset === 'draft'){
    edStatusFilter = 'draft';
    editorialSortBy = 'updated_desc';
    editorialDateRange = 'all';
  } else if(preset === 'thisweek'){
    edStatusFilter = 'all';
    editorialDateRange = '7d';
    editorialDateBasis = 'created';
    editorialSortBy = 'recent';
  } else if(preset === 'reset'){
    edStatusFilter = 'all';
    editorialSortBy = 'recent';
    editorialDateRange = 'all';
    editorialDateBasis = 'created';
    editorialDateFrom = '';
    editorialDateTo = '';
    // QA #208 Phase 2g/2h — also reset role + category dropdowns.
    editorialRoleFilter = 'all';
    editorialCategoryFilter = 'all';
  }
  // Sync the dropdowns visually.
  var sortEl = document.getElementById('edAdminSort'); if(sortEl) sortEl.value = editorialSortBy;
  var rangeEl = document.getElementById('edAdminRange'); if(rangeEl) rangeEl.value = editorialDateRange;
  var basisEl = document.getElementById('edAdminBasis'); if(basisEl) basisEl.value = editorialDateBasis;
  var roleEl = document.getElementById('edAdminRole'); if(roleEl) roleEl.value = editorialRoleFilter;
  var catEl = document.getElementById('edAdminCategory'); if(catEl) catEl.value = editorialCategoryFilter;
  var customWrap = document.getElementById('edAdminCustomWrap');
  if(customWrap) customWrap.style.display = (editorialDateRange === 'custom') ? '' : 'none';
  renderEditorialList();
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
    // QA #208 Phase 2g — author role filter. Reads role from
    // _creator.role (attached by attachAuthorship on the server).
    if(editorialRoleFilter!=='all'){
      var creatorRole = (e._creator && e._creator.role) || null;
      if(editorialRoleFilter === 'admin' && creatorRole !== 'admin') return false;
      if(editorialRoleFilter === 'staff' && creatorRole !== 'staff') return false;
    }
    // QA #208 Phase 2h — category filter. Editorials don't have a
    // single canonical category field, so we match against (a) the
    // raw category column when present and (b) the tags list. That
    // matches how the site surfaces categories to readers.
    if(editorialCategoryFilter!=='all'){
      var cat = String(e.category||'').toLowerCase();
      var tagStr = (Array.isArray(e.tags)?e.tags.join(' '):e.tags||'').toLowerCase();
      var needle = String(editorialCategoryFilter).toLowerCase();
      if(cat !== needle && tagStr.indexOf(needle) === -1) return false;
    }
    if(!q)return true;
    var tags=Array.isArray(e.tags)?e.tags.join(' '):e.tags||'';
    var creator=(e._creator && (e._creator.display_name || e._creator.email)) || '';
    var editor=(e._editor && (e._editor.display_name || e._editor.email)) || '';
    return (e.title||'').toLowerCase().indexOf(q)>-1
        || tags.toLowerCase().indexOf(q)>-1
        || creator.toLowerCase().indexOf(q)>-1
        || editor.toLowerCase().indexOf(q)>-1;
  });

  // QA #208 Phase 2b — apply date range + sort after status/search
  // filtering so the user sees the most specific subset first, then
  // ordered the way they asked.
  filtered = _papApplyDateRange(filtered, editorialDateRange, editorialDateBasis, editorialDateFrom, editorialDateTo);
  filtered = _papApplySort(filtered, editorialSortBy);

  // QA #208 — populate status summary cards. Counts derive from the
  // FULL editorials list so the dashboard always shows globals
  // regardless of which filter is active.
  var counts = { all: editorials.length, published:0, draft:0, scheduled:0, archived:0 };
  editorials.forEach(function(e){
    var s = _effectiveStatus(e);
    if(s === 'scheduled') counts.scheduled++;
    else if(s === 'published') counts.published++;
    else if(s === 'draft') counts.draft++;
    else counts.archived++;
  });
  var setStat = function(id, n){ var el = document.getElementById(id); if(el) el.textContent = String(n||0); };
  setStat('edStatAll', counts.all);
  setStat('edStatPublished', counts.published);
  setStat('edStatDraft', counts.draft);
  setStat('edStatScheduled', counts.scheduled);
  setStat('edStatArchived', counts.archived);

  // Highlight the active card with a coloured border.
  document.querySelectorAll('.ed-stat-card').forEach(function(c){
    if(c.dataset.status === edStatusFilter){
      c.style.borderColor = 'var(--purple)';
      c.style.boxShadow = '0 0 0 2px rgba(124,58,237,0.15)';
    } else {
      c.style.borderColor = 'var(--border2)';
      c.style.boxShadow = '';
    }
  });

  var dcb=document.getElementById('edDraftCountBadge');
  if(dcb) dcb.textContent=counts.draft?('('+counts.draft+')'):'';
  var scb=document.getElementById('edScheduledCountBadge');
  if(scb) scb.textContent=counts.scheduled?('('+counts.scheduled+')'):'';
  var tb=document.getElementById('edListBody');
  if(!tb) return;
  tb.innerHTML='';
  /* QA(2026-07-16) 페이지네이션 — 필터·정렬이 "전부" 끝난 뒤에 자른다.
     순서가 중요하다: 먼저 자르면 검색·정렬이 현재 페이지 안에서만 도는
     (원래 문제와 똑같은) 상태가 된다. 위 counts 도 filtered 가 아니라
     editorials 전량 기준이라 페이지와 무관하게 정확하다. */
  PAP_LIST_RERENDER.editorial = renderEditorialList;
  var _pg = papPaginate('editorial', filtered);
  papRenderPager('editorial', 'edListBody', _pg);
  if(!filtered.length){tb.innerHTML='<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:40px 0">에디토리얼이 없습니다</td></tr>';if(document.getElementById('edCountLabel'))document.getElementById('edCountLabel').textContent='0';_editorialRefreshBulkToolbar();return;}
  _pg.slice.forEach(function(e){
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
    // Highlight non-live rows with a subtle background tint
    var rowStyle='';
    if(st==='draft')          rowStyle=' style="background:rgba(255,152,0,0.06)"';
    else if(st==='scheduled') rowStyle=' style="background:rgba(124,58,237,0.05)"';
    else if(st==='archived')  rowStyle=' style="background:rgba(220,38,38,0.04)"';
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
    // QA #208 — publish date column for live posts, scheduled date for queued ones.
    var publishedCell = st==='scheduled'
      ? '<span style="color:rgba(249,115,22,0.95);font-weight:600">예약: '+fmtDate(e.scheduled_publish_at)+'</span>'
      : fmtDate(e.published_date);
    // QA #208 — author + last editor display, using denormalised objects
    // from attachAuthorship (QA #202). Falls back to '—' when missing.
    var creatorName = (e._creator && (e._creator.display_name || e._creator.email)) || '';
    var editorName  = (e._editor  && (e._editor.display_name  || e._editor.email))  || '';
    var authorshipHtml;
    if(creatorName || editorName){
      var parts = [];
      if(creatorName) parts.push('<div style="font-weight:500">'+esc(creatorName)+'</div>');
      if(editorName && (!creatorName || e.created_by !== e.updated_by)){
        parts.push('<div style="color:var(--text3);font-size:10px">수정: '+esc(editorName)+'</div>');
      }
      authorshipHtml = parts.join('');
    } else {
      authorshipHtml = '<span style="color:var(--text3)">—</span>';
    }
    var updatedCell = fmtDate(e.admin_edited_at || e.updated_at);
    var isChecked = editorialSelectedIds.has(e.id) ? ' checked' : '';
    tb.innerHTML+='<tr'+rowStyle+'>'
      + '<td onclick="event.stopPropagation()"><input type="checkbox" class="ed-row-check" data-id="'+e.id+'" onchange="editorialToggleRow(this)"'+isChecked+'></td>'
      + '<td>'+thumbHtml+'</td>'
      + '<td class="td-title" onclick="editEditorial(\''+e.id+'\')">'+esc(e.title)+'</td>'
      + '<td>'+tagBadges+'</td>'
      + '<td><span class="badge '+cls+'">'+label+'</span></td>'
      + '<td style="font-size:11px;line-height:1.5">'+authorshipHtml+'</td>'
      + '<td>'+publishedCell+'</td>'
      + '<td style="font-size:11px;color:var(--text2)">'+updatedCell+'</td>'
      + '<td>'+actions+'</td>'
      + '</tr>';
  });
  if(document.getElementById('edCountLabel')) document.getElementById('edCountLabel').textContent=filtered.length;
  _editorialRefreshBulkToolbar();
  papInitAdvPanel('ed');
}

// QA #208 — bulk-selection helpers.
function editorialToggleRow(checkbox){
  if(!checkbox) return;
  var id = checkbox.dataset.id;
  if(!id) return;
  if(checkbox.checked) editorialSelectedIds.add(id);
  else editorialSelectedIds.delete(id);
  _editorialRefreshBulkToolbar();
}
function editorialToggleSelectAll(checkbox){
  document.querySelectorAll('.ed-row-check').forEach(function(cb){
    cb.checked = checkbox.checked;
    var id = cb.dataset.id;
    if(!id) return;
    if(checkbox.checked) editorialSelectedIds.add(id);
    else editorialSelectedIds.delete(id);
  });
  _editorialRefreshBulkToolbar();
}
function editorialClearSelection(){
  editorialSelectedIds.clear();
  var hdr = document.getElementById('edSelectAll');
  if(hdr) hdr.checked = false;
  document.querySelectorAll('.ed-row-check').forEach(function(cb){ cb.checked = false; });
  _editorialRefreshBulkToolbar();
}
function _editorialRefreshBulkToolbar(){
  var bar = document.getElementById('edBulkToolbar');
  var lbl = document.getElementById('edBulkCount');
  if(!bar) return;
  if(editorialSelectedIds.size > 0){
    bar.style.display = 'block';
    if(lbl) lbl.textContent = editorialSelectedIds.size + '개 선택';
  } else {
    bar.style.display = 'none';
  }
}
async function editorialBulkAction(action){
  var ids = Array.from(editorialSelectedIds);
  if(!ids.length){ alert('선택된 항목이 없습니다.'); return; }
  var labels = {
    publish: '공개 전환', draft: '임시저장 전환', delete: '삭제',
    addTags: '태그 추가', removeTags: '태그 제거',
  };

  // QA #208 Phase 2f — tag bulk actions need an interactive input.
  // Prompt once for the comma-separated tag list, then apply the
  // add/remove operation per row.
  var tagsInput = null;
  if(action === 'addTags' || action === 'removeTags'){
    var promptLabel = action === 'addTags'
      ? '추가할 태그를 콤마로 구분해 입력하세요 (예: 인터뷰, 패션)'
      : '제거할 태그를 콤마로 구분해 입력하세요';
    var raw = window.prompt(promptLabel, '');
    if(!raw || !raw.trim()){ return; }
    tagsInput = raw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    if(!tagsInput.length){ return; }
  }

  if(!confirm(ids.length + '개 항목을 ' + labels[action] + '하시겠습니까?')) return;
  // Look up each row's current tags from the in-memory list for add/remove ops.
  var byId = {};
  editorials.forEach(function(e){ if(e && e.id) byId[e.id] = e; });

  var failures = [];
  for(var i = 0; i < ids.length; i++){
    var id = ids[i];
    try {
      if(action === 'delete'){
        await apiDelete('/editorials/' + id);
      } else if(action === 'publish'){
        await apiPut('/editorials/' + id, { status: 'published' });
      } else if(action === 'draft'){
        await apiPut('/editorials/' + id, { status: 'draft' });
      } else if(action === 'addTags' || action === 'removeTags'){
        var row = byId[id];
        var current = (row && Array.isArray(row.tags)) ? row.tags.slice() : [];
        var next;
        if(action === 'addTags'){
          // Merge + dedupe (case-sensitive, preserves original casing).
          var seen = {};
          next = current.concat(tagsInput).filter(function(t){
            var k = String(t||'').trim();
            if(!k) return false;
            if(seen[k.toLowerCase()]) return false;
            seen[k.toLowerCase()] = 1;
            return true;
          });
        } else {
          var drop = {};
          tagsInput.forEach(function(t){ drop[String(t||'').trim().toLowerCase()] = 1; });
          next = current.filter(function(t){ return !drop[String(t||'').trim().toLowerCase()]; });
        }
        await apiPut('/editorials/' + id, { tags: next });
      }
    } catch(err){
      failures.push(id.substring(0,8) + ': ' + (err && err.message || ''));
    }
  }
  editorialSelectedIds.clear();
  await loadEditorials();
  if(failures.length){
    alert('일부 실패:\n' + failures.join('\n'));
  } else {
    alert('완료: ' + ids.length + '개 항목 ' + labels[action]);
  }
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

// ── QA #170 — Instagram caption helpers (mirror the server-side
// builder api/_lib/igCaption.js so the editor can re-run it after
// tweaking credits/brands). 새 형식 (2026-07):
//
//   {한국어 훅 — AI 생성에서만}
//
//   'TITLE' — PAP 매거진 exclusive editorial
//
//   {KR 단락 … 전체 스토리는 프로필 링크에서.}
//
//   Role @handle          ← 한 줄에 하나
//   Starring @model @agency
//
//   더 많은 에디토리얼 보기 | @pap_magazine | For more editorials
//
//   (EN) …
//
//   (IT) …
//
//   Fashion by @brand1 @brand2 …
//
//   #태그 × 5 (줄바꿈 구분)
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
  var title = String(ed.title||'').trim();

  // ── 크레딧: 한 줄에 하나 ("Role @handle") + Starring 분리 ──
  // 새 형식 (2026-07): 서버 api/_lib/igCaption.js 와 동일 포맷 미러.
  // 훅(한국어 첫 줄)은 🤖 AI 자동 생성에서만 채워진다 — 템플릿 재조립은
  // 훅 없이 타이틀 라인부터 시작 (기존 훅이 있으면 에디터가 수동 유지).
  var credits = Array.isArray(ed.credits) ? ed.credits : [];
  var creditLines = [];
  var modelParts = [];
  credits.forEach(function(c){
    if(!c) return;
    var handle = _igNormalizeHandle(c.instagram || c.website || '');
    if(!handle) return;
    // QA #302 — 다중 역할 병합. 한 인물에 여러 역할이 있으면 모두 표기.
    // starring 판정은 어느 역할이라도 starring/model 라벨이면 분리.
    var rolesArr = (Array.isArray(c.roles) && c.roles.length) ? c.roles : (c.role ? [c.role] : ['Credit']);
    var labels = rolesArr.map(function(r){ return _igRoleLabel(r); }).filter(Boolean);
    var isModel = labels.some(function(l){ return l === 'Starring' || /^Model$/i.test(l); });
    if(isModel){
      modelParts.push(handle);
    }else{
      var label = labels.join(' & ') || _igRoleLabel(rolesArr[0]) || 'Credit';
      creditLines.push(label + ' ' + handle);
    }
  });

  // ── Brands ──
  // QA #274 — Fashion by 라인의 핸들 소스를 2가지로 확장:
  //   (a) ed.fashion.brands (기존: 패션 브랜드 태그 영역의 수동 입력)
  //   (b) ed.fashion.imageCredits 또는 galleryImages[i].credits에서 추출한
  //       이미지별 착장 크레딧의 @handle들. 중복 제거 후 순서 유지로 합침.
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
  // QA #274 — 이미지별 착장 크레딧에서 @handle 추출.
  // 데이터 위치: ed.fashion.imageCredits = { '1': 'string', ... } 또는
  // 글로벌 galleryImages[i].credits (둘 다 폼에서 수집 가능).
  var imgCreditTexts = [];
  if (ed.fashion && ed.fashion.imageCredits && typeof ed.fashion.imageCredits === 'object'){
    Object.keys(ed.fashion.imageCredits).forEach(function(k){
      var v = ed.fashion.imageCredits[k];
      if (typeof v === 'string' && v.trim()) imgCreditTexts.push(v);
    });
  }
  if (typeof galleryImages !== 'undefined' && Array.isArray(galleryImages)){
    galleryImages.forEach(function(gi){
      if (gi && typeof gi.credits === 'string' && gi.credits.trim()){
        imgCreditTexts.push(gi.credits);
      }
    });
  }
  // 모든 텍스트에서 @handle 정규식 추출 → seen 맵으로 중복 제거.
  imgCreditTexts.forEach(function(text){
    var matches = String(text).match(/@[a-zA-Z0-9._]+/g);
    if (!matches) return;
    matches.forEach(function(raw){
      var h = _igNormalizeHandle(raw);
      if (!h) return;
      var key = h.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      brandHandles.push(h);
    });
  });

  // ── 조립 (새 형식 2026-07 — 서버 공용 빌더와 동일 구조) ──
  var lines = [];

  // 1) 타이틀 라인
  lines.push("'" + title + "' — PAP 매거진 exclusive editorial");
  lines.push('');

  // 2) KR 단락 (전체 스토리 유도는 하단 Full Story link 블록으로 이관)
  var descKo = (ed.description||'').trim();
  if(descKo){
    lines.push(descKo);
    lines.push('');
  }

  // 3) 크레딧 (한 줄에 하나) + Starring
  creditLines.forEach(function(l){ lines.push(l); });
  if(modelParts.length) lines.push('Starring ' + modelParts.join(' '));
  if(creditLines.length || modelParts.length) lines.push('');

  // 4) 구분선
  lines.push('FOR MORE EDITORIALS | ' + _IG_HOUSE_HANDLE);
  lines.push('');

  // 5) EN / IT
  var descEn = (ed.description_en||'').trim();
  var descIt = (ed.description_it||'').trim();
  if(descEn){ lines.push('(EN) ' + descEn); lines.push(''); }
  if(descIt){ lines.push('(IT) ' + descIt); lines.push(''); }

  // 6) Full Story link — slug 있으면 상세 URL 직접 노출 (서버 빌더와 동일).
  var _fsSlug = String(ed.slug||'').trim();
  if(_fsSlug){
    lines.push('Full Story link🔎 <Screenshot and copy-paste>');
    lines.push('https://www.pap-magazine.com/editorial/' + _fsSlug);
    lines.push('');
  }

  // 7) Fashion by
  if(brandHandles.length){ lines.push('Fashion by ' + brandHandles.join(' ')); lines.push(''); }

  // 8) 해시태그 — 정확히 5개, 줄바꿈 구분 (2025.12 정책: 캡션+댓글 합산 최대 5)
  var tags = ['패션화보','에디토리얼'];
  var tt = title.replace(/[^A-Za-z0-9가-힣]/g,'').toUpperCase();
  if(tt.length >= 2 && tt.length <= 30) tags.push(tt);
  tags.push('FASHIONEDITORIAL','papmagazine');
  lines.push(tags.slice(0,5).map(function(t){ return '#'+t; }).join('\n'));

  return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
// ── IG 대체 텍스트(alt text) 추천 (2026-07, 검색 노출 세트) ──
// 구글 이미지 검색·접근성용. IG 앱: 게시물 고급 설정 → 대체 텍스트에 붙여넣기.
// 100자 이내 유지 (IG 커스텀 alt 권장 한도).
function _buildIgAltTextFromEditorial(ed){
  if(!ed) return '';
  var title = String(ed.title||'').trim();
  var credits = Array.isArray(ed.credits) ? ed.credits : [];
  var models = [];
  credits.forEach(function(c){
    if(!c) return;
    var rolesArr = (Array.isArray(c.roles) && c.roles.length) ? c.roles : (c.role ? [c.role] : []);
    var isModel = rolesArr.some(function(r){ var l=_igRoleLabel(r); return l==='Starring' || /^Model$/i.test(l||''); });
    if(isModel){
      var nm = String(c.name||'').trim() || _igNormalizeHandle(c.instagram||'').replace(/^@/,'');
      if(nm) models.push(nm);
    }
  });
  var brands = (ed.fashion && Array.isArray(ed.fashion.brands)) ? ed.fashion.brands : [];
  var brandNames = [];
  brands.forEach(function(b){
    if(!b) return;
    var nm = String(b.name||'').trim() || _igNormalizeHandle(b.instagram||'').replace(/^@/,'');
    if(nm && brandNames.indexOf(nm) === -1) brandNames.push(nm);
  });
  var alt = "패션 화보 '" + title + "' — PAP 매거진 에디토리얼";
  if(models.length)     alt += ', 모델 ' + models.slice(0,2).join('·');
  if(brandNames.length) alt += ', ' + brandNames.slice(0,3).join('·') + ' 착용';
  if(alt.length > 100) alt = alt.slice(0, 97) + '…';
  return alt;
}
// 캡션 textarea 아래에 alt 추천 박스를 주입/갱신 (admin.html 수정 없이 동적 생성).
function _renderIgAltBox(ed){
  var cap = document.getElementById('postIgCaption');
  if(!cap) return;
  var alt = _buildIgAltTextFromEditorial(ed);
  if(!alt) return;
  var box = document.getElementById('postIgAltBox');
  if(!box){
    box = document.createElement('div');
    box.id = 'postIgAltBox';
    box.style.cssText = 'margin-top:8px;padding:8px 10px;background:var(--surface,#f8f8f8);border:1px solid var(--border2,#e5e5e5);border-radius:8px;font-size:12px;';
    box.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">🖼 대체 텍스트 추천 <span style="font-weight:400;color:#888;">(IG 게시 시 고급 설정 → 대체 텍스트에 붙여넣기 — 구글 이미지 검색 노출)</span></div>'
      + '<input id="postIgAltText" type="text" readonly onclick="this.select()" style="width:100%;border:1px solid var(--border2,#ddd);border-radius:6px;padding:6px 8px;font-size:12px;background:#fff;">';
    cap.parentNode.insertBefore(box, cap.nextSibling);
  }
  var inp = document.getElementById('postIgAltText');
  if(inp) inp.value = alt;
}
// Buttons in the editorial modal call into these. We rebuild a synthetic
// "ed" object from the live form so the regenerate button reflects any
// in-modal edits the user has made to credits/brands BEFORE saving.
function regenerateIgCaption(){
  var ed = _readEditorialFromForm();
  var caption = _buildIgCaptionFromEditorial(ed);
  var el = document.getElementById('postIgCaption');
  if(el){ el.value = caption; }
  _renderIgAltBox(ed);
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
// QA #272 — AI 키워드 자동 생성. 제목 + 설명 + 갤러리 첫 3장 이미지로
// 5~10개 영문 키워드 태그 제안 + postTags input에 자동 입력.
// QA #275 — Instagram 게시물 URL을 받아 Claude로 한국어/영어 바이링구얼 기사
// 자동 생성 + articles 테이블에 draft로 저장. 성공 시 곧바로 편집 화면 진입.
async function papImportFromInstagram(){
  var url = prompt('Instagram 게시물 URL을 입력하세요\n예: https://www.instagram.com/p/Czxy1234abc/');
  if (!url) return;
  url = url.trim();
  if (!/instagram\.com\/(?:p|reel|tv)\//.test(url)){
    alert('유효한 Instagram URL이 아닙니다.\n예: https://www.instagram.com/p/XXXX/');
    return;
  }
  var loadingAlert = '🤖 Claude로 기사 생성 중… (10~30초 소요)';
  console.log('[ig import] ' + loadingAlert);
  try {
    var resp = await fetch(_apiBase + '/admin/articles/from-instagram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('pap-token') || ''),
      },
      body: JSON.stringify({ instagramUrl: url, status: 'draft' }),
    });
    var data = await resp.json();
    if (!resp.ok){
      alert('Instagram 기사 생성 실패\n\n' + (data.error || ('상태 ' + resp.status)));
      return;
    }
    var article = data.article;
    if (data.duplicate){
      if (!confirm('이 게시물은 이미 import되어 있습니다.\n기존 기사 (id: ' + article.id + ', 제목: "' + article.title + '")를 열까요?')) return;
    } else {
      alert('✓ Instagram 기사 생성 완료\n\n제목: ' + article.title + '\n카테고리: ' + article.category + '\n태그: ' + (Array.isArray(article.tags) ? article.tags.join(', ') : '') + '\n\n임시저장 상태로 저장되었습니다. 검토 후 발행해주세요.');
    }
    // 뉴스 목록 새로고침 → 편집 화면 진입.
    if (typeof loadNews === 'function') await loadNews();
    if (typeof editNewsArticle === 'function') editNewsArticle(article.id);
  } catch (e){
    console.error('[ig import] failed:', e);
    alert('Instagram 기사 생성 실패: ' + (e && e.message || e));
  }
}

async function papAutoGenerateTags(overwrite){
  if (!editingEditorialId){
    alert('먼저 에디토리얼을 저장해주세요.\n신규 작성 중에는 AI 키워드 자동 생성을 사용할 수 없습니다.\n(임시저장 후 다시 시도하시면 됩니다.)');
    return;
  }
  var existingTags = (document.getElementById('postTags') || {}).value || '';
  if (overwrite && existingTags.trim()) {
    if (!confirm('기존 태그를 덮어쓰고 새로 생성합니다. 계속할까요?')) return;
  } else if (!overwrite && existingTags.trim()) {
    if (!confirm('태그가 이미 입력되어 있습니다. 그대로 덮어쓸까요?\n(아니오를 누르면 강제 재생성 버튼을 사용하세요.)')) return;
  }

  var btn = document.getElementById('aiTagsBtn');
  var origLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '🤖 키워드 생성 중…'; btn.style.opacity = '.7'; }
  var statusEl = document.getElementById('tagsAiStatus');
  function _s(msg, color){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = color || 'var(--text3)';
  }
  _s('Claude로 키워드 분석 중…');

  try {
    // 폼의 현재 값들을 override로 전송해 저장 안 한 상태에서도 정확한 결과.
    var currentTitle = (document.getElementById('postTitle') || {}).value || '';
    var currentDesc = (document.getElementById('postDescriptionEn') || {}).value
                  || (document.getElementById('postDescription') || {}).value
                  || '';
    var currentGallery = [];
    document.querySelectorAll('#galleryGrid .pe-gallery-item img').forEach(function(img){
      if (img && img.src) currentGallery.push(img.src);
    });

    var resp = await fetch(_apiBase + '/admin/editorials/' + editingEditorialId + '/generate-tags', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('pap-token') || ''),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        overwrite: true,  // 항상 DB에도 저장 (다음 편집 시 유지)
        currentTitle: currentTitle,
        currentDescription: currentDesc,
        currentGallery: currentGallery,
      })
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || ('실패: ' + resp.status));

    var tags = Array.isArray(data.tags) ? data.tags : [];
    if (!tags.length) {
      _s('⚠️ 생성된 태그가 없습니다.', '#b86b00');
      return;
    }
    // postTags input에 쉼표 join으로 입력 + tagPreview 칩 갱신.
    var tagsInput = document.getElementById('postTags');
    if (tagsInput) {
      tagsInput.value = tags.join(', ');
      // 입력 이벤트 trigger — tagPreview chip rendering이 oninput으로 동작.
      try { tagsInput.dispatchEvent(new Event('input', { bubbles: true })); } catch(_){}
    }
    _s('✓ ' + tags.length + '개 키워드 생성 완료', '#16a34a');
  } catch (e) {
    console.error('papAutoGenerateTags error:', e);
    _s('❌ ' + (e && e.message || e), '#c62828');
    alert('AI 키워드 생성 실패: ' + (e && e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origLabel || '🤖 AI 키워드 자동 생성'; btn.style.opacity = '1'; }
  }
}

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
    // QA #264 — also send the form's CURRENT credits + brands so the
    // server-side caption builder can compose "Fashion by @brand1 …"
    // even when the editor hasn't pressed Save yet. Without this, the
    // server loads the DB row only and any unsaved brand additions in
    // the form get ignored, producing a caption with no brand line.
    var formSnapshot = (typeof _readEditorialFromForm === 'function')
      ? _readEditorialFromForm()
      : null;
    var brandsOverride  = (formSnapshot && formSnapshot.fashion && Array.isArray(formSnapshot.fashion.brands))
      ? formSnapshot.fashion.brands : null;
    var creditsOverride = (formSnapshot && Array.isArray(formSnapshot.credits))
      ? formSnapshot.credits : null;
    // QA #274 — 이미지별 착장 크레딧도 함께 전송하여 서버가 "Fashion by"에
    // 포함시킬 수 있게 함. galleryImages[i].credits를 인덱스(1-based) 맵으로 변환.
    var imageCreditsOverride = null;
    if (typeof galleryImages !== 'undefined' && Array.isArray(galleryImages)){
      imageCreditsOverride = {};
      galleryImages.forEach(function(gi, idx){
        if (gi && typeof gi.credits === 'string' && gi.credits.trim()){
          imageCreditsOverride[String(idx + 1)] = gi.credits;
        }
      });
      if (!Object.keys(imageCreditsOverride).length) imageCreditsOverride = null;
    }
    var resp = await fetch(_apiBase+'/admin/editorials/'+editingEditorialId+'/auto-generate',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+(localStorage.getItem('pap-token')||''),
        'X-Requested-With':'XMLHttpRequest'
      },
      body: JSON.stringify({
        overwrite: !!overwrite,
        brandsOverride:       brandsOverride,
        creditsOverride:      creditsOverride,
        imageCreditsOverride: imageCreditsOverride,
      })
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
    // QA #204 — also hydrate the IT slot now that it persists in its own
    // column. Without this the editor never saw the Italian translation
    // refresh after pressing 🤖 AI 자동 생성.
    if(fu.description_it && document.getElementById('postDescriptionIt')){
      document.getElementById('postDescriptionIt').value = data.description_it || '';
    }
    if(fu.instagram_caption && document.getElementById('postIgCaption')){
      document.getElementById('postIgCaption').value = data.instagram_caption || '';
    }

    var summary = [];
    if(fu.description)        summary.push('description (KR)');
    if(fu.description_en)     summary.push('description (EN)');
    if(fu.description_it)     summary.push('description (IT)');
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
  // QA #204 — EN + IT slots are now first-class inputs in the editorial
  // form (admin.html). _readEditorialFromForm feeds the IG caption
  // regenerator so it can rebuild the (KR)/(EN)/(IT) blocks from the
  // editor's latest pending edits before save.
  var descriptionEn  = (document.getElementById('postDescriptionEn')||{}).value || '';
  var descriptionIt  = (document.getElementById('postDescriptionIt')||{}).value || '';
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
    // QA #273 — 이름 OR IG 핸들 둘 중 하나라도 있으면 브랜드로 포함.
    // 이전에는 name이 비어있으면 IG가 있어도 누락되어 "Fashion by @brand"가
    // 캡션에 안 나오는 버그가 있었음. _buildCaptionFromEditorial은 IG > name
    // 순서로 핸들을 추출하므로 IG만 있어도 충분.
    var name = (nameEl && nameEl.value || '').trim();
    var ig   = (igEl   && igEl.value   || '').trim();
    if (name || ig){
      brands.push({ name: name, instagram: ig });
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

async function editEditorial(id){
  // QA #216 — single-row fetch instead of trusting the list cache.
  // The /editorials list response projection drops a few large fields
  // (full description JSON, gallery details, …) and is stale right
  // after a save. Re-fetching the row guarantees the form mounts with
  // the canonical post-save state without a manual page reload.
  var ed = null;
  try {
    var resp = await apiGet('/editorials/' + id);
    ed = resp && (resp.data || resp);
  } catch(err){
    // Network blip — fall back to the cached row so the editor can at
    // least open the form, then warn the user the data may be stale.
    ed = editorials.find(function(e){return e.id===id;}) || null;
    if(typeof toast === 'function') toast('최신 데이터를 가져오지 못했습니다. 다시 불러오세요.');
  }
  if(!ed) return;
  // Keep the list cache in sync so other UI bits (status badge, table
  // row) reflect the fresh values without a separate refresh round-trip.
  var ix = editorials.findIndex(function(e){return e.id===id;});
  if(ix >= 0) editorials[ix] = Object.assign({}, editorials[ix], ed);
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
  // QA #204 — hydrate EN + IT description slots so an admin opening an
  // existing row sees the per-language values instead of having to dig
  // them out of the IG caption blob.
  if(document.getElementById('postDescriptionEn'))document.getElementById('postDescriptionEn').value=ed.description_en||'';
  if(document.getElementById('postDescriptionIt'))document.getElementById('postDescriptionIt').value=ed.description_it||'';
  // QA #170 — Instagram caption (seeded at submission approval).
  if(document.getElementById('postIgCaption'))document.getElementById('postIgCaption').value=ed.instagram_caption||'';
  try{ _renderIgAltBox(ed); }catch(_e){}
  // 참여 증폭 2.0 — 원본 IG 게시물 URL.
  if(document.getElementById('postIgSourceUrl'))document.getElementById('postIgSourceUrl').value=ed.source_instagram_url||'';
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
      // QA #214 — derive the 4-state status (pending / sent / failed),
      // hydrate day/month from the persisted columns so the editor
      // re-opens to the same values, and render a coloured badge that
      // makes the current state obvious at a glance.
      var status = ed.approval_email_status || (ed.approval_email_sent_at ? 'sent' : 'pending');
      var alreadySent = status === 'sent';
      // Checkbox: keep DISABLED while a successful send is on the row.
      // For 'failed' state we leave it ENABLED so the editor can retry
      // by re-ticking and saving again.
      if(chk){
        chk.checked = false;
        chk.disabled = alreadySent;
      }
      // Day / Month: hydrate from persisted columns (QA #214 — was '').
      if(dayEl)   dayEl.value   = ed.approval_email_day   || '';
      if(monthEl) monthEl.value = ed.approval_email_month || '';
      // Status badge:
      if(sentNote){
        if(status === 'sent'){
          var when = '';
          try { when = new Date(ed.approval_email_sent_at).toLocaleString('ko-KR'); } catch(_){}
          sentNote.textContent = '✅ 발송 완료' + (when ? ' · ' + when : '');
          sentNote.style.color = '#16a34a';
          sentNote.style.fontWeight = '700';
          sentNote.style.display = '';
        } else if(status === 'failed'){
          var reason = ed.approval_email_failed_reason || '';
          sentNote.textContent = '⚠️ 발송 실패' + (reason ? ' · ' + reason.slice(0, 60) : '') + ' (체크 후 저장하면 재발송)';
          sentNote.style.color = '#dc2626';
          sentNote.style.fontWeight = '700';
          sentNote.style.display = '';
        } else {
          // pending — no badge so the form looks like a fresh send opportunity.
          sentNote.style.display = 'none';
        }
      }
    } else {
      appBox.style.display = 'none';
    }
  }

  // ── Phase 4: rehydrate scheduled-publish UI when editing ──
  // QA #280 — 이전 모달 작업의 schedule 값이 남아서 저장 시 scheduled_publish_at으로
  // 잘못 전달되는 버그 fix. 항상 명시적으로 schedule 상태를 reset한 후, 이 게시물의
  // 실제 scheduled_publish_at 값으로만 hydrate.
  var schedCb = document.getElementById('postSchedule');
  var schedDateEl = document.getElementById('scheduleDate');
  var schedTimeEl = document.getElementById('scheduleTime');
  // 1) 항상 reset (체크박스 + 날짜/시간 입력 모두).
  if (schedCb) schedCb.checked = false;
  if (schedDateEl) schedDateEl.value = '';
  if (schedTimeEl) schedTimeEl.value = '';
  // 2) 이 게시물에 scheduled_publish_at 값이 있을 때만 hydrate.
  if (ed.scheduled_publish_at) {
    try {
      var sd = new Date(ed.scheduled_publish_at);
      if (!isNaN(sd.getTime())) {
        if (schedCb) schedCb.checked = true;
        var pad = function(n){ return n < 10 ? '0' + n : '' + n; };
        if (schedDateEl) schedDateEl.value = sd.getFullYear() + '-' + pad(sd.getMonth() + 1) + '-' + pad(sd.getDate());
        if (schedTimeEl) schedTimeEl.value = pad(sd.getHours()) + ':' + pad(sd.getMinutes());
      }
    } catch(e) {}
  }
  if (typeof toggleSchedule === 'function') toggleSchedule();

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
  // Reset cover-picker state so a previously-opened editorial's cover
  // source doesn't leak into this one (esp. when this post has no gallery).
  galleryCoverNum=null;_papCoverSourceUrl='';_papComposedCoverUrl=null;
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
          +'<button class="pe-gallery-cover" onclick="event.stopPropagation();setGalleryCover('+galleryCount+')" title="커버로 사용 (에디토리얼 최상단 · 매거진 커버 합성 소스)" aria-label="커버로 사용">◆</button>'
          +'<button class="pe-gallery-mosaic" onclick="event.stopPropagation();openMosaicEditor('+galleryCount+')" title="부분 모자이크 (외설 부분만 가리기)" aria-label="부분 모자이크">🟦</button>'
          +'<span class="pe-tag-thumb">THUMB</span>'
          +'<span class="pe-tag-cover">COVER</span>'
          +'<span class="pe-gallery-num">#'+galleryCount+'</span>';
        grid.insertBefore(div,addBtn);
        if(typeof _wireGalleryItemDrag === 'function') _wireGalleryItemDrag(div);
      }
    });
    updateImgCredits();
    // QA — restore the ★ THUMB (`thumbnail`) by matching the saved
    // URL against the loaded gallery items, falling back to the first
    // image so an old post with no thumb saved still gets one.
    var savedThumbUrl = ed.thumbnail || '';
    if(savedThumbUrl){
      var thumbMatch = galleryImages.find(function(g){ return g.src === savedThumbUrl; });
      if(thumbMatch) galleryThumbNum = thumbMatch.num;
    }
    if(galleryImages.length && galleryThumbNum===null){
      galleryThumbNum = galleryImages[0].num;
    }
    // ◆ COVER picker (revived) — default the cover SOURCE to the first
    // gallery image so the live 매거진 커버 미리보기 renders as soon as the
    // editor opens (no slider nudge). The already-saved cover_image stays
    // the hero in the DB until the editor re-confirms a new design; we
    // never feed the (possibly already-composited) saved cover back into
    // the generator, which would double-overlay the wordmark/title.
    galleryCoverNum = galleryImages.length ? galleryImages[0].num : null;
    _papCoverSourceUrl = galleryImages.length ? galleryImages[0].src : '';
    _papComposedCoverUrl = null;
    _renderGalleryCoverState();
    // Kick a first live render on open (always-visible preview).
    if(typeof _papCoverEnsureLiveWired==='function') _papCoverEnsureLiveWired();
    if(typeof _papCoverScheduleLiveRender==='function') setTimeout(_papCoverScheduleLiveRender, 300);
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
  // QA #209 — load the audit history panel for this editorial.
  loadContentAuditPanel('editorial', id);
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

// QA #216 — global toast so save handlers can surface success/error
// without an alert() blocking the UI. Lazy-mounts a #papToast container
// in the body on first call. Stacks up to 3 visible toasts; older ones
// auto-dismiss after the duration. Exposed on window so any module can
// fire `toast('saved')` regardless of script ordering.
function _papToastImpl(msg, opts){
  opts = opts || {};
  var type = opts.type || 'success'; // 'success' | 'error' | 'info'
  var dur = typeof opts.duration === 'number' ? opts.duration : (type === 'error' ? 6000 : 3000);
  var box = document.getElementById('papToast');
  if(!box){
    box = document.createElement('div');
    box.id = 'papToast';
    box.style.cssText = 'position:fixed;bottom:24px;right:24px;display:flex;flex-direction:column;gap:8px;z-index:99999;pointer-events:none';
    document.body.appendChild(box);
  }
  var color = type === 'error' ? '#dc2626' : (type === 'info' ? '#3b82f6' : '#16a34a');
  var icon  = type === 'error' ? '⚠️ ' : (type === 'info' ? 'ℹ️ ' : '✅ ');
  var t = document.createElement('div');
  t.style.cssText = 'pointer-events:auto;background:#111;color:#fff;padding:12px 16px;border-radius:6px;border-left:4px solid '+color+';font-size:13px;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.25);min-width:240px;max-width:420px;opacity:0;transform:translateY(8px);transition:all .2s';
  t.textContent = icon + String(msg||'');
  box.appendChild(t);
  // Trim to most-recent 3 to avoid stacking forever.
  while(box.children.length > 3){ box.removeChild(box.firstChild); }
  requestAnimationFrame(function(){ t.style.opacity='1'; t.style.transform='translateY(0)'; });
  setTimeout(function(){
    t.style.opacity='0'; t.style.transform='translateY(8px)';
    setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 220);
  }, dur);
}
// Expose globally — existing callers use `typeof toast === 'function'` checks.
if(typeof window !== 'undefined'){
  window.toast = _papToastImpl;
}
var toast = _papToastImpl;

// QA #216 — guard against accidental tab close/reload while the editor
// has unsaved changes. The form sets _papFormDirty=true on any input
// edit; savePost clears it on a successful round-trip. beforeunload's
// returnValue triggers the browser's native "Leave this page?" dialog.
var _papFormDirty = false;
function _papMarkDirty(){ _papFormDirty = true; }
function _papClearDirty(){ _papFormDirty = false; }
window._papMarkDirty = _papMarkDirty;
window._papClearDirty = _papClearDirty;
window.addEventListener('beforeunload', function(ev){
  if(_papFormDirty){
    ev.preventDefault();
    ev.returnValue = '';
    return '';
  }
});
// Wire the dirty flag to all form inputs once the DOM is ready.
document.addEventListener('DOMContentLoaded', function(){
  // Editorial + news + film + shorts form containers — any input/change
  // anywhere inside flips the flag. Specific fields wire themselves via
  // existing handlers; this is the catch-all.
  // QA #252 — film editor is now a tab page (#t-newfilm) instead of a
  // modal-bg overlay. The selector list below drives the unsaved-changes
  // warning so it needs to track the new id.
  var watch = ['#t-newpost', '#t-newnews', '#t-newfilm', '#shortsModal'];
  watch.forEach(function(sel){
    var root = document.querySelector(sel);
    if(!root) return;
    root.addEventListener('input',  _papMarkDirty, true);
    root.addEventListener('change', _papMarkDirty, true);
  });
});

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
  // QA #215 — index against KEPT images only. isExcluded rows are
  // filtered out of the upload, so building the credit map off the
  // raw galleryImages list shifts the keys by every excluded entry
  // and ends up storing image #2's credit under img_3 (etc.).
  var imgCreditsMap={};
  var keptImagesForCredits = galleryImages.filter(function(g){ return !g.isExcluded; });
  keptImagesForCredits.forEach(function(g,i){
    if(g.credits) imgCreditsMap['img_'+(i+1)] = g.credits;
  });
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
    // QA #204 — per-language slots so a save persists EN and IT
    // separately instead of leaving them buried inside the IG caption.
    var descriptionEnVal=document.getElementById('postDescriptionEn')?document.getElementById('postDescriptionEn').value:'';
    var descriptionItVal=document.getElementById('postDescriptionIt')?document.getElementById('postDescriptionIt').value:'';
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
      // QA #204 — persist EN + IT description slots in their own columns
      // (migration 039 added description_it). The editorial GET / list
      // both surface these so the editor sees them on the next open.
      description_en:descriptionEnVal||null,
      description_it:descriptionItVal||null,
      // QA #170 — empty string → null so the modal shows the "generate"
      // affordance on reopen instead of an empty textarea masquerading
      // as legitimate content.
      instagram_caption: igCaptionVal || null,
      // 참여 증폭 2.0 — 원본 IG 게시물 permalink. instagram.com 링크만 저장.
      source_instagram_url: (function(){
        var el=document.getElementById('postIgSourceUrl');
        var v=el?(el.value||'').trim():'';
        return (v && /instagram\.com\//.test(v)) ? v : null;
      })(),
      scheduled_publish_at: scheduledAt
    };

    // QA #172 — approval email payload. The send flag is attached only
    // when the admin ticked the checkbox; the day/month are persisted
    // ALWAYS (QA #214) so re-opening the modal hydrates the same values
    // the editor saved, regardless of whether they triggered a send.
    var approvalChk = document.getElementById('editorialSendApprovalEmail');
    var _dayInp   = document.getElementById('editorialApprovalDay');
    var _monthInp = document.getElementById('editorialApprovalMonth');
    var _dayVal   = _dayInp   ? (_dayInp.value   || '').trim() : '';
    var _monthVal = _monthInp ? (_monthInp.value || '').trim() : '';
    // Always persist day/month so the form stays sticky across reloads.
    payload.approval_day   = _dayVal;
    payload.approval_month = _monthVal;
    // Trigger the actual send only when the box is ticked AND not
    // disabled (disabled means the row already has approval_email_sent_at).
    if(approvalChk && approvalChk.checked && !approvalChk.disabled){
      payload.send_approval_email = true;
      if(!_dayVal || !_monthVal){
        if(!confirm('승인 메일의 "around the () of ()" 자리가 비어있어요.\n빈 () 그대로 발송해도 될까요?')){
          return;
        }
      }
    } else {
      // Explicit false so the backend can detect "user unticked to reset
      // a previously failed send" without ambiguity.
      payload.send_approval_email = false;
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
      // QA #216 — surface as toast too so the user sees confirmation
      // even after the list view replaces the success div.
      toast(successMsg);
      // QA #216 — clear the unsaved-changes flag so beforeunload stops
      // nagging the user after a successful save.
      _papClearDirty();
      editingEditorialId=null;
      // Wipe the form NOW so the next "+ 새 에디토리얼" click starts
      // truly empty even if the go('newpost') reset hook ever drifts.
      if(typeof _resetNewPostForm === 'function') _resetNewPostForm();
      // QA #216 — await the refetch so the list page never paints stale
      // data after a save. Then route to the list view.
      await loadEditorials();
      go('editorials');
    }else if(category==='news'){
      await apiPost('/articles',{title:title,subtitle:subtitle,tags:tagsArr,thumbnail_url:thumbUrl,credits:Object.entries(credits).map(function(c){return{role:c[0],name:c[1].name};}),status:isPublished?'published':'draft',published_date:isPublished?new Date().toISOString():null,category:'news'});
      toast('뉴스가 등록되었습니다.');
      await loadNews();
      go('news');
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
        toast('필름이 등록되었습니다.');
        await loadFilmsFromAPI();
        go('film');
      } else {
        await apiPost('/shorts',{title:title,youtube_id:_ytId,thumbnail_url:thumbUrl,tags:tagsArr.join(', '),status:isPublished?'published':'draft',published_date:isPublished?new Date().toISOString():null});
        toast('숏츠가 등록되었습니다.');
        await loadShortsFromAPI();
        go('shorts');
      }
    }
  }catch(e){
    // QA #100 / QA #216 — translate raw error and surface it both as a
    // sticky summary panel above the form AND as an error toast.
    // The form stays on screen (no go() navigation) so the user can
    // immediately retry without losing their work.
    var friendly = _peFormatSaveError(e);
    var summary=document.getElementById('peSaveSummary');
    if(summary){
      summary.innerHTML='<strong>저장 실패</strong><ul><li>'+esc(friendly)+'</li></ul>';
      summary.style.display='block';
      summary.scrollIntoView({behavior:'smooth', block:'center'});
    }
    toast(friendly, { type: 'error' });
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
// JSON shape for serializing into articles.content. The same shape is
// what _hydrateNewsEditorForm reads on edit, closing the round-trip.
//
// QA #200 — image blocks now carry BOTH a `url` (the Supabase public
// URL stashed on dataset.imgUrl by handleNewsBlockImage) AND a
// `content` (the optional caption). Text/quote/video blocks keep the
// pre-#200 shape so older payloads still round-trip cleanly.
function _collectNewsBlocks(){
  var blocks=[];
  document.querySelectorAll('#newsBlocks .news-block').forEach(function(block){
    // Block-type label sits in the small grey header — we keep the
    // legacy text matching since the labels are user-visible Korean.
    var headLabel = (block.querySelector('span') && block.querySelector('span').textContent) || '';
    var t = 'text';
    // QA #281 Phase B/C — 그룹 블록은 단일 블록보다 먼저 매칭. "영상 그룹"이
    // "영상"보다 우선해야 함 (포함관계).
    if(headLabel.indexOf('갤러리')>=0) t = 'gallery';
    else if(headLabel.indexOf('슬라이드')>=0) t = 'slide';
    else if(headLabel.indexOf('영상 그룹')>=0) t = 'videogroup';
    else if(headLabel.indexOf('이미지')>=0) t = 'image';
    else if(headLabel.indexOf('인용구')>=0) t = 'quote';
    else if(headLabel.indexOf('영상')>=0) t = 'video';

    var ta = block.querySelector('textarea');
    var captionInp = block.querySelector('input.news-block-img-caption');
    var inp = block.querySelector('input.pe-input');

    if(t==='text'){
      blocks.push({type:'text', content: ta ? ta.value : ''});
    } else if(t==='quote'){
      // QA #201 — quote source goes into a dedicated `source` field so
      // the public renderer can render it as attribution under the
      // quote, not as part of the quote body itself.
      var srcEl = block.querySelector('input.news-block-quote-source');
      blocks.push({
        type:'quote',
        content: ta ? ta.value : '',
        source: srcEl ? srcEl.value : ''
      });
    } else if(t==='image'){
      // QA #200 — read the uploaded URL from the block dataset (set
      // by handleNewsBlockImage). Skip blocks with no URL AND no
      // caption to avoid persisting empty placeholders.
      var url = block.dataset.imgUrl || '';
      var caption = captionInp ? captionInp.value : (inp ? inp.value : '');
      if(!url && !caption) return; // skip empty image block
      blocks.push({type:'image', url: url, content: caption});
    } else if(t==='video'){
      blocks.push({type:'video', content: inp ? inp.value : ''});
    } else if(t==='videogroup'){
      // QA #281 Phase C — 영상 URL row들을 직렬화. URL이 빈 row는 skip.
      var vrows = block.querySelectorAll('.news-block-video-row');
      var videos = [];
      vrows.forEach(function(row){
        var urlEl = row.querySelector('.news-block-video-url');
        var capEl = row.querySelector('.news-block-video-caption');
        var u = urlEl ? urlEl.value.trim() : '';
        if (!u) return;
        videos.push({ url: u, caption: capEl ? capEl.value : '' });
      });
      if (videos.length === 0) return; // skip empty group
      blocks.push({ type: 'videogroup', videos: videos });
    } else if(t==='gallery' || t==='slide'){
      // QA #281 Phase B — collect all images from .news-block-images
      // children. Each child has data-url + optional caption input.
      var items = block.querySelectorAll('.news-block-image-item');
      var images = [];
      items.forEach(function(item){
        var url = item.dataset.url || '';
        if (!url) return; // skip placeholder/failed
        var capEl = item.querySelector('.news-block-image-caption');
        images.push({ url: url, caption: capEl ? capEl.value : '' });
      });
      if (images.length === 0) return; // skip empty group block
      blocks.push({ type: t, images: images });
    }
  });
  return blocks;
}

async function saveNewsArticle(forceMode){
  var titleEl=document.getElementById('newnewsTitle');
  if(!titleEl||!titleEl.value){alert('제목을 입력해 주세요.');return;}

  var blocks = _collectNewsBlocks();

  // QA #224 — read the editorial-parity checkbox UI. The 임시저장
  // button passes forceMode='draft' so the public "공개" checkbox
  // state is irrelevant in that path (mirrors savePost('draft')).
  var publishBox = document.getElementById('newnewsPublish');
  var schedBox   = document.getElementById('newnewsSchedule');
  var wantsPublish  = !!(publishBox && publishBox.checked);
  var wantsSchedule = !!(schedBox && schedBox.checked);

  // Determine status. Scheduled posts go in as status='published' so
  // the public-list scheduled_publish_at gate hides them until their
  // time comes (same behaviour as editorials).
  var dbStatus;
  if(forceMode === 'draft'){
    dbStatus = 'draft';
  } else if(wantsSchedule){
    dbStatus = 'published';
  } else {
    dbStatus = wantsPublish ? 'published' : 'draft';
  }

  // Scheduled-publish timestamp.
  var schedAt = null;
  if(wantsSchedule && forceMode !== 'draft'){
    var sdate = document.getElementById('newnewsScheduleDate');
    var stime = document.getElementById('newnewsScheduleTime');
    if(!sdate || !sdate.value){
      alert('예약 게시를 선택했지만 예약 날짜가 비어 있습니다.');
      return;
    }
    var sval = sdate.value + 'T' + ((stime && stime.value) || '09:00');
    schedAt = new Date(sval).toISOString();
    if(new Date(schedAt) <= new Date()){
      if(!confirm('예약 일시가 현재보다 과거입니다. 그래도 진행할까요?\n(과거 일시는 즉시 공개와 동일하게 동작합니다.)')) return;
    }
  }

  // Manual published_date override. Either both date+time are filled
  // (use them), or fall back to "now" only when actually going live
  // immediately so drafts/scheduled posts don't get a published stamp.
  var manualPubAt = null;
  var pdate = document.getElementById('newnewsPublishDate');
  var ptime = document.getElementById('newnewsPublishTime');
  if(pdate && pdate.value){
    var pval = pdate.value + 'T' + ((ptime && ptime.value) || '00:00');
    var pd = new Date(pval);
    if(!isNaN(pd.getTime())) manualPubAt = pd.toISOString();
  }

  // Reuse the existing thumbnail URL when editing without a new upload.
  var thumbUrlEl = document.getElementById('newnewsThumbUrl');
  var thumbUrl = thumbUrlEl ? thumbUrlEl.value : '';

  // QA #223 — read the category select + tag input the admin form now
  // exposes. Tags are comma-separated; we normalise to lowercase trimmed
  // tokens so the public-side filter (which lowercase-compares) sees
  // canonical values regardless of how the editor typed them.
  var catEl = document.getElementById('newnewsCategory');
  var category = (catEl && catEl.value) ? catEl.value : 'news';
  var tagEl = document.getElementById('newnewsTags');
  var tagsRaw = tagEl && tagEl.value ? tagEl.value : '';
  var tags = tagsRaw
    .split(',')
    .map(function(t){ return String(t || '').trim().toLowerCase(); })
    .filter(function(t){ return t.length > 0; });

  var payload = {
    title: titleEl.value,
    content: JSON.stringify(blocks),
    category: category,
    tags: tags,
    status: dbStatus,
    scheduled_publish_at: schedAt,
  };
  if(thumbUrl) payload.thumbnail_url = thumbUrl;

  // QA #224 — published_date priority:
  //   1. manual 발행 날짜 input wins whenever the editor filled it in
  //   2. otherwise, only auto-stamp when transitioning to immediate
  //      publish (not draft, not scheduled). The PUT handler also
  //      auto-stamps on the first draft→published transition for
  //      safety, so leaving this null on drafts is fine.
  if(manualPubAt){
    payload.published_date = manualPubAt;
  } else if(dbStatus === 'published' && !schedAt){
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

// QA #208 Phase 2a — film list state mirrors the editorial / news lists:
// fan out three status fetches, tag scheduled rows with a virtual
// status, and let renderFilms drive the dashboard + bulk-action UI.
var filmActiveStatus = 'all';
var filmSelectedIds = new Set();
// QA #208 Phase 2b — sort + date-range state for film.
var filmSortBy = 'recent';
var filmDateRange = 'all';
var filmDateBasis = 'created';
var filmDateFrom = '';
var filmDateTo = '';
// QA #208 Phase 2g/2h — author role + category dropdown filters.
var filmRoleFilter = 'all';
var filmCategoryFilter = 'all';

function setFilmSortFromUi(){
  var sel = document.getElementById('filmAdminSort');
  if(sel) filmSortBy = sel.value || 'recent';
  renderFilms();
}
function setFilmDateRangeFromUi(){
  var sel = document.getElementById('filmAdminRange');
  var basis = document.getElementById('filmAdminBasis');
  var from = document.getElementById('filmAdminFrom');
  var to = document.getElementById('filmAdminTo');
  if(sel) filmDateRange = sel.value || 'all';
  if(basis) filmDateBasis = basis.value || 'created';
  if(from) filmDateFrom = from.value || '';
  if(to) filmDateTo = to.value || '';
  var wrap = document.getElementById('filmAdminCustomWrap');
  if(wrap) wrap.style.display = (filmDateRange === 'custom') ? '' : 'none';
  renderFilms();
}
// QA #208 Phase 2g — film role filter handler.
function setFilmRoleFromUi(){
  var sel = document.getElementById('filmAdminRole');
  if(sel) filmRoleFilter = sel.value || 'all';
  renderFilms();
}
// QA #208 Phase 2h — film category dropdown handler.
function setFilmCategoryFromUi(){
  var sel = document.getElementById('filmAdminCategory');
  if(sel) filmCategoryFilter = sel.value || 'all';
  renderFilms();
}

// QA #208 Phase 2c — film saved-filter presets.
function applyFilmPreset(preset){
  if(preset === 'scheduled'){
    filmActiveStatus = 'scheduled';
    filmSortBy = 'recent';
    filmDateRange = 'all';
  } else if(preset === 'today'){
    filmActiveStatus = 'all';
    filmDateRange = 'today';
    filmDateBasis = 'created';
    filmSortBy = 'recent';
  } else if(preset === 'draft'){
    filmActiveStatus = 'draft';
    filmSortBy = 'updated_desc';
    filmDateRange = 'all';
  } else if(preset === 'thisweek'){
    filmActiveStatus = 'all';
    filmDateRange = '7d';
    filmDateBasis = 'created';
    filmSortBy = 'recent';
  } else if(preset === 'reset'){
    filmActiveStatus = 'all';
    filmSortBy = 'recent';
    filmDateRange = 'all';
    filmDateBasis = 'created';
    filmDateFrom = '';
    filmDateTo = '';
    filmRoleFilter = 'all';
    filmCategoryFilter = 'all';
  }
  var sortEl = document.getElementById('filmAdminSort'); if(sortEl) sortEl.value = filmSortBy;
  var rangeEl = document.getElementById('filmAdminRange'); if(rangeEl) rangeEl.value = filmDateRange;
  var basisEl = document.getElementById('filmAdminBasis'); if(basisEl) basisEl.value = filmDateBasis;
  var roleEl = document.getElementById('filmAdminRole'); if(roleEl) roleEl.value = filmRoleFilter;
  var catEl = document.getElementById('filmAdminCategory'); if(catEl) catEl.value = filmCategoryFilter;
  var customWrap = document.getElementById('filmAdminCustomWrap');
  if(customWrap) customWrap.style.display = (filmDateRange === 'custom') ? '' : 'none';
  renderFilms();
}

async function loadFilmsFromAPI(){
  var tb=document.getElementById('filmListBody');if(!tb)return;
  tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px">불러오는 중...</td></tr>';
  try{
    var results = await Promise.all([
      papFetchAllPages('/films?status=published').catch(function(){return{data:[]};}),
      papFetchAllPages('/films?status=draft').catch(function(){return{data:[]};}),
      papFetchAllPages('/films?status=scheduled').catch(function(){return{data:[]};}),
    ]);
    var pub=results[0], draft=results[1], scheduled=results[2];
    (scheduled.data||[]).forEach(function(r){ r._virtualStatus='scheduled'; });
    // Dedupe by id; scheduled tag wins.
    var byId={};
    [].concat(pub.data||[], draft.data||[], scheduled.data||[]).forEach(function(r){
      if(!r || !r.id) return;
      if(byId[r.id] && r._virtualStatus === 'scheduled'){
        byId[r.id]._virtualStatus = 'scheduled';
      } else if(!byId[r.id]){
        byId[r.id] = r;
      }
    });
    films = Object.values(byId).sort(function(a,b){
      var ta = a.created_at || a.published_date || '';
      var tb_ = b.created_at || b.published_date || '';
      return String(tb_).localeCompare(String(ta));
    });
    renderFilms();
  }catch(e){
    tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:#ff6b6b;padding:40px">불러오기 실패</td></tr>';
  }
}

function _filmEffectiveStatus(f){
  if(f._virtualStatus) return f._virtualStatus;
  return f.status || 'published';
}

function renderFilms(){
  var tb=document.getElementById('filmListBody');if(!tb)return;

  // QA #208 Phase 2a — populate status cards.
  var counts={all:films.length, published:0, draft:0, scheduled:0, archived:0};
  films.forEach(function(f){
    var s=_filmEffectiveStatus(f);
    if(s==='scheduled') counts.scheduled++;
    else if(s==='published') counts.published++;
    else if(s==='draft') counts.draft++;
    else counts.archived++;
  });
  var setStat=function(id,n){var el=document.getElementById(id);if(el)el.textContent=String(n||0);};
  setStat('filmStatAll', counts.all);
  setStat('filmStatPublished', counts.published);
  setStat('filmStatDraft', counts.draft);
  setStat('filmStatScheduled', counts.scheduled);
  setStat('filmStatArchived', counts.archived);
  // Highlight active card.
  document.querySelectorAll('.film-stat-card').forEach(function(c){
    if(c.dataset.status === filmActiveStatus){
      c.style.borderColor = 'var(--purple)';
      c.style.boxShadow = '0 0 0 2px rgba(124,58,237,0.15)';
    } else {
      c.style.borderColor = 'var(--border2)';
      c.style.boxShadow = '';
    }
  });

  // Filter visible rows by active status.
  var visible = films.filter(function(f){
    if(filmActiveStatus !== 'all' && _filmEffectiveStatus(f) !== filmActiveStatus) return false;
    // QA #208 Phase 2g — author role filter.
    if(filmRoleFilter !== 'all'){
      var creatorRole = (f._creator && f._creator.role) || null;
      if(filmRoleFilter === 'admin' && creatorRole !== 'admin') return false;
      if(filmRoleFilter === 'staff' && creatorRole !== 'staff') return false;
    }
    // QA #208 Phase 2h — film category filter. Film categories live in
    // f.category (a string) for the 7 hardcoded values; also match
    // legacy rows that stuffed a comma-list into tags.
    if(filmCategoryFilter !== 'all'){
      var cat = String(f.category||'').toLowerCase();
      var tagStr = (Array.isArray(f.tags)?f.tags.join(' '):f.tags||'').toLowerCase();
      var needle = String(filmCategoryFilter).toLowerCase();
      if(cat !== needle && tagStr.indexOf(needle) === -1) return false;
    }
    return true;
  });
  // QA #208 Phase 2b — date range + sort.
  visible = _papApplyDateRange(visible, filmDateRange, filmDateBasis, filmDateFrom, filmDateTo);
  visible = _papApplySort(visible, filmSortBy);
  /* QA(2026-07-16) 페이지네이션 — 필터·정렬이 전부 끝난 뒤에 자른다.
     먼저 자르면 검색·정렬이 현재 페이지 안에서만 도는(원래 문제와 같은)
     상태가 된다. 위 상태별 카운트는 전량 배열 기준이라 페이지와 무관하다. */
  PAP_LIST_RERENDER.film = renderFilms;
  var _pg = papPaginate('film', visible);
  papRenderPager('film','filmListBody',_pg);

  tb.innerHTML='';
  if(!visible.length){
    tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px 0">'+(filmActiveStatus==='all'?'필름이 없습니다':'해당 상태의 필름이 없습니다')+'</td></tr>';
    _filmRefreshBulkToolbar();
    return;
  }
  _pg.slice.forEach(function(f,i){
    var origIdx = films.indexOf(f);
    var yt=f.youtube_id||'';
    var thumb=f.thumbnail_url||('https://img.youtube.com/vi/'+yt+'/mqdefault.jpg');
    var st=_filmEffectiveStatus(f);
    var cls, label;
    if(st==='scheduled'){
      cls='b-scheduled';
      var when='';
      if(f.scheduled_publish_at){
        try{
          var d=new Date(f.scheduled_publish_at);
          if(!isNaN(d.getTime())){
            var pad=function(n){return n<10?'0'+n:n;};
            when=' '+(d.getMonth()+1)+'/'+d.getDate()+' '+pad(d.getHours())+':'+pad(d.getMinutes());
          }
        }catch(_){}
      }
      label='⏰ 예약'+when;
    } else if(st==='published'){
      cls='b-published'; label='공개';
    } else if(st==='draft'){
      cls='b-draft'; label='임시저장';
    } else {
      cls='b-draft'; label='비공개';
    }
    var rowStyle='';
    if(st==='draft')          rowStyle=' style="background:rgba(255,152,0,0.06)"';
    else if(st==='scheduled') rowStyle=' style="background:rgba(124,58,237,0.05)"';
    else if(st==='archived')  rowStyle=' style="background:rgba(220,38,38,0.04)"';
    var isChecked = filmSelectedIds.has(f.id) ? ' checked' : '';
    // QA #208 Phase 2a — denormalised authorship (from QA #202 attachAuthorship).
    var authorshipCell = _renderAuthorshipCell(f);
    var updatedCell = fmtDate(f.updated_at);
    tb.innerHTML+='<tr'+rowStyle+'>'
      + '<td onclick="event.stopPropagation()"><input type="checkbox" class="film-row-check" data-id="'+f.id+'" onchange="filmToggleRow(this)"'+isChecked+'></td>'
      + '<td><img loading="lazy" class="td-thumb" src="'+esc(thumb)+'"></td>'
      + '<td class="td-title" onclick="openFilmModal('+origIdx+')">'+esc(f.title||'')+'</td>'
      + '<td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">'+esc(yt)+'</td>'
      + '<td><span class="badge '+cls+'">'+label+'</span></td>'
      + '<td style="font-size:11px;color:var(--text2);line-height:1.5">'+authorshipCell+'</td>'
      + '<td style="font-size:11px;color:var(--text2)">'+updatedCell+'</td>'
      + '<td><button class="btn btn-sm" onclick="openFilmModal('+origIdx+')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteFilm('+origIdx+')">삭제</button></td>'
      + '</tr>';
  });
  _filmRefreshBulkToolbar();
  papInitAdvPanel('film');
}

// QA #208 Phase 2a — film filter + bulk-selection helpers.
function filterFilmsByStatus(status){
  filmActiveStatus = status || 'all';
  renderFilms();
}
function filmToggleRow(checkbox){
  if(!checkbox) return;
  var id = checkbox.dataset.id;
  if(!id) return;
  if(checkbox.checked) filmSelectedIds.add(id);
  else filmSelectedIds.delete(id);
  _filmRefreshBulkToolbar();
}
function filmToggleSelectAll(checkbox){
  document.querySelectorAll('.film-row-check').forEach(function(cb){
    cb.checked = checkbox.checked;
    var id = cb.dataset.id;
    if(!id) return;
    if(checkbox.checked) filmSelectedIds.add(id);
    else filmSelectedIds.delete(id);
  });
  _filmRefreshBulkToolbar();
}
function filmClearSelection(){
  filmSelectedIds.clear();
  var hdr = document.getElementById('filmSelectAll');
  if(hdr) hdr.checked = false;
  document.querySelectorAll('.film-row-check').forEach(function(cb){ cb.checked = false; });
  _filmRefreshBulkToolbar();
}
function _filmRefreshBulkToolbar(){
  var bar = document.getElementById('filmBulkToolbar');
  var lbl = document.getElementById('filmBulkCount');
  if(!bar) return;
  if(filmSelectedIds.size > 0){
    bar.style.display = 'block';
    if(lbl) lbl.textContent = filmSelectedIds.size + '개 선택';
  } else {
    bar.style.display = 'none';
  }
}
async function filmBulkAction(action){
  var ids = Array.from(filmSelectedIds);
  if(!ids.length){ alert('선택된 항목이 없습니다.'); return; }
  var labels = {
    publish: '공개 전환', draft: '임시저장 전환', delete: '삭제',
    addTags: '태그 추가', removeTags: '태그 제거',
  };

  // QA #208 Phase 2f — bulk tag actions.
  var tagsInput = null;
  if(action === 'addTags' || action === 'removeTags'){
    var promptLabel = action === 'addTags'
      ? '추가할 태그를 콤마로 구분해 입력하세요 (예: 인터뷰, 패션)'
      : '제거할 태그를 콤마로 구분해 입력하세요';
    var raw = window.prompt(promptLabel, '');
    if(!raw || !raw.trim()){ return; }
    tagsInput = raw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    if(!tagsInput.length){ return; }
  }

  if(!confirm(ids.length + '개 필름을 ' + labels[action] + '하시겠습니까?')) return;
  var byId = {};
  films.forEach(function(f){ if(f && f.id) byId[f.id] = f; });

  var failures = [];
  for(var i = 0; i < ids.length; i++){
    var id = ids[i];
    try {
      if(action === 'delete'){
        await apiDelete('/films/' + id);
      } else if(action === 'publish'){
        await apiPut('/films/' + id, { status: 'published' });
      } else if(action === 'draft'){
        await apiPut('/films/' + id, { status: 'draft' });
      } else if(action === 'addTags' || action === 'removeTags'){
        var row = byId[id];
        var current = (row && Array.isArray(row.tags)) ? row.tags.slice() : [];
        var next;
        if(action === 'addTags'){
          var seen = {};
          next = current.concat(tagsInput).filter(function(t){
            var k = String(t||'').trim();
            if(!k) return false;
            if(seen[k.toLowerCase()]) return false;
            seen[k.toLowerCase()] = 1;
            return true;
          });
        } else {
          var drop = {};
          tagsInput.forEach(function(t){ drop[String(t||'').trim().toLowerCase()] = 1; });
          next = current.filter(function(t){ return !drop[String(t||'').trim().toLowerCase()]; });
        }
        await apiPut('/films/' + id, { tags: next });
      }
    } catch(err){
      failures.push(id.substring(0,8) + ': ' + (err && err.message || ''));
    }
  }
  filmSelectedIds.clear();
  await loadFilmsFromAPI();
  if(failures.length){
    alert('일부 실패:\n' + failures.join('\n'));
  } else {
    alert('완료: ' + ids.length + '개 필름 ' + labels[action]);
  }
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

// QA #306 — 필름 크레딧 입력 모드 토글.
// 'direct' 모드에서는 크레딧을 필름에 직접 저장 (에디토리얼과 별개).
// 'inherit' 모드에서는 크레딧을 [] 저장하고, 프론트가 related_editorial.credits를
// 자동으로 사용해서 렌더하도록 위임 (중복 입력 방지).
function _onFilmCreditsModeChange(mode){
  var wrap = document.getElementById('filmCreditsEditWrap');
  var note = document.getElementById('filmCreditsInheritNote');
  if (mode === 'inherit') {
    if (wrap) wrap.style.display = 'none';
    if (note) note.style.display = 'block';
  } else {
    if (wrap) wrap.style.display = '';
    if (note) note.style.display = 'none';
  }
}
if (typeof window !== 'undefined') window._onFilmCreditsModeChange = _onFilmCreditsModeChange;

// QA #229 — Linked-editorial picker (was a plain dropdown).
// Fetch editorials once per session, cache, then drive a searchable
// list UI with thumbnail / title / date in admin.html. The hidden
// `#filmRelatedEditorial` input keeps the same .value contract so
// saveFilm and edit hydration don't care about the layout change.
var _filmRelatedEdCache = null;
async function _populateFilmRelatedEditorial(selectedId){
  var hidden = document.getElementById('filmRelatedEditorial');
  if(hidden) hidden.value = selectedId || '';
  try {
    // QA #305 — published + scheduled 병합 fetch.
    // 예약 게시 상태 (status=published + scheduled_publish_at 미래) 는
    // 공개용 GET 이 hide 하므로 필름 등록 시 안 잡히던 결함. status=scheduled
    // 로 별도 조회해서 병합 + _scheduled 플래그로 배지 표시.
    // 두 요청 병렬 처리 + 실패해도 나머지는 사용.
    //
    // QA #317 — 세션당 1회 캐시 (`if (!_filmRelatedEdCache)`) 제거.
    // 관리자 페이지는 SPA 라 에디토리얼을 예약 게시한 직후 새로고침 없이
    // 필름 폼을 열면 캐시가 예약 이전 상태 → 방금 등록한 예약 에디토리얼이
    // 목록에 안 나오던 결함. 폼을 열 때마다 fresh fetch 한다 (admin 전용
    // 목록 + no-store 응답이라 부담 없음). fetch 실패 시엔 이전 캐시를
    // 유지해 목록이 비어 버리지 않게 한다.
    var results = await Promise.all([
      apiGet('/editorials?status=published&limit=100&page=1').catch(function(){ return null; }),
      apiGet('/editorials?status=scheduled&limit=100').catch(function(){ return null; })
    ]);
    var pubResp = results[0];
    var pubList = (pubResp && (pubResp.data || pubResp.editorials || pubResp)) || [];
    var schList = (results[1] && (results[1].data || results[1].editorials || results[1])) || [];
    if (!Array.isArray(pubList)) pubList = [];
    if (!Array.isArray(schList)) schList = [];
    // QA #317 — API 는 limit 을 100 으로 캡하므로 (기존 limit=500 요청은
    // 조용히 100 으로 잘렸음) 공개 에디토리얼이 100개를 넘으면 나머지
    // 페이지를 병렬로 추가 조회. 최대 5페이지(500개) — picker 검색이
    // 클라이언트 필터라 전체 카탈로그가 캐시에 있어야 한다.
    var totalPages = (pubResp && pubResp.pagination && parseInt(pubResp.pagination.pages, 10)) || 1;
    if (totalPages > 1) {
      var extraReqs = [];
      for (var p = 2; p <= Math.min(totalPages, 5); p++) {
        extraReqs.push(apiGet('/editorials?status=published&limit=100&page=' + p).catch(function(){ return null; }));
      }
      var extraResults = await Promise.all(extraReqs);
      extraResults.forEach(function(r){
        var l = (r && (r.data || r.editorials)) || [];
        if (Array.isArray(l)) pubList = pubList.concat(l);
      });
    }
    // 예약분에 flag 마킹 → 렌더시 배지 표시.
    schList = schList.map(function(ed){
      return Object.assign({}, ed, { _scheduled: true });
    });
    // 중복 제거 (같은 id 중 예약분 우선 — 스케줄 정보 유지). Set 으로 id 트래킹.
    var seen = {};
    var merged = [];
    schList.concat(pubList).forEach(function(ed){
      if(!ed || !ed.id) return;
      if(seen[ed.id]) return;
      seen[ed.id] = 1;
      merged.push(ed);
    });
    // QA #317 — 두 fetch 가 모두 실패해 빈 결과가 나온 경우엔 이전
    // 캐시를 보존 (일시적 네트워크 오류로 목록이 통째로 사라지는 것 방지).
    if (merged.length || !Array.isArray(_filmRelatedEdCache)) {
      _filmRelatedEdCache = merged;
    }
  } catch(e){
    console.warn('[films] failed to load editorials list:', e && e.message);
    _filmRelatedEdCache = _filmRelatedEdCache || [];
  }
  // Reset search + sort + range to defaults each time the picker opens.
  var s = document.getElementById('filmRelatedSearch'); if(s) s.value = '';
  var so = document.getElementById('filmRelatedSort'); if(so) so.value = 'newest';
  var rg = document.getElementById('filmRelatedRange'); if(rg) rg.value = 'all';
  // Render the visible chip for the currently selected editorial (if any).
  _updateFilmRelatedSelectedChip(selectedId);
  // Render the picker list.
  renderFilmRelatedList();
}

// Render the chip at the top of the picker showing the current pick.
// Hidden when nothing is selected. Called whenever the selection or
// the cached data set changes.
function _updateFilmRelatedSelectedChip(id){
  var row = document.getElementById('filmRelatedSelectedRow');
  if(!row) return;
  if(!id){
    row.style.display = 'none';
    return;
  }
  var match = null;
  if(Array.isArray(_filmRelatedEdCache)){
    for(var i = 0; i < _filmRelatedEdCache.length; i++){
      if(_filmRelatedEdCache[i] && _filmRelatedEdCache[i].id === id){ match = _filmRelatedEdCache[i]; break; }
    }
  }
  if(!match){
    // Selected id isn't in the cached list (e.g. unpublished or older
    // than the limit). Surface a compact placeholder so the editor
    // still sees that *something* is selected.
    row.style.display = 'flex';
    document.getElementById('filmRelatedSelectedThumb').style.backgroundImage = '';
    document.getElementById('filmRelatedSelectedTitle').textContent = '(목록에 없는 에디토리얼 · ID ' + String(id).slice(0,8) + ')';
    document.getElementById('filmRelatedSelectedDate').textContent = '';
    return;
  }
  row.style.display = 'flex';
  var thumb = match.thumbnail || match.thumbnail_url || match.cover_image || '';
  var thumbEl = document.getElementById('filmRelatedSelectedThumb');
  if(thumbEl) thumbEl.style.backgroundImage = thumb ? ('url(' + JSON.stringify(thumb).slice(1, -1) + ')') : '';
  // QA #305 — 선택된 chip 에도 예약 상태 배지. innerHTML 로 배지 SPAN 삽입.
  var titleEl = document.getElementById('filmRelatedSelectedTitle');
  if(titleEl){
    var titleText = match.title || match.slug || match.id || '';
    if(match._scheduled && match.scheduled_publish_at){
      var schedStr = _formatFilmEdDate(match.scheduled_publish_at);
      titleEl.innerHTML = esc(titleText)
        + ' <span style="font-size:10px;color:#fff;background:#2980b9;padding:2px 6px;border-radius:2px;margin-left:4px;white-space:nowrap">⏰ 예약 ' + esc(schedStr) + '</span>';
    } else {
      titleEl.textContent = titleText;
    }
  }
  var pd = match.published_date || match.created_at || '';
  document.getElementById('filmRelatedSelectedDate').textContent = pd ? _formatFilmEdDate(pd) : '';
}

function _formatFilmEdDate(d){
  try {
    var dt = new Date(d);
    if(isNaN(dt.getTime())) return '';
    var pad = function(n){ return n < 10 ? '0' + n : '' + n; };
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  } catch(_){ return ''; }
}

// Render the filtered / sorted editorial list into #filmRelatedList.
// Called on input, on sort change, and after the cache hydrates.
function renderFilmRelatedList(){
  var box = document.getElementById('filmRelatedList');
  if(!box) return;
  var list = Array.isArray(_filmRelatedEdCache) ? _filmRelatedEdCache.slice() : [];
  var searchEl = document.getElementById('filmRelatedSearch');
  var sortEl = document.getElementById('filmRelatedSort');
  var rangeEl = document.getElementById('filmRelatedRange');
  var q = ((searchEl && searchEl.value) || '').trim().toLowerCase();
  var sort = (sortEl && sortEl.value) || 'newest';
  var rangeVal = (rangeEl && rangeEl.value) || 'all';
  // Text filter — match title (any locale) + slug. We don't pre-index
  // because the cache size is small (≤500); a plain scan is cheaper
  // than maintaining an index.
  if(q){
    list = list.filter(function(ed){
      if(!ed) return false;
      var hay = ((ed.title || '') + ' ' + (ed.slug || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  // QA #232 — date-range filter (published_date within last N days).
  // Rows missing a publish date pass through under "전체 기간" but are
  // hidden when a range is selected (they can't be inside the window).
  if(rangeVal !== 'all'){
    var days = parseInt(rangeVal, 10);
    if(!isNaN(days) && days > 0){
      var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      list = list.filter(function(ed){
        var t = new Date(ed && (ed.published_date || ed.created_at) || 0).getTime();
        if(!t || isNaN(t)) return false;
        return t >= cutoff;
      });
    }
  }
  // Sort.
  list.sort(function(a, b){
    if(sort === 'title'){
      return (a.title || '').localeCompare(b.title || '');
    }
    var ad = new Date(a.published_date || a.created_at || 0).getTime() || 0;
    var bd = new Date(b.published_date || b.created_at || 0).getTime() || 0;
    return sort === 'oldest' ? (ad - bd) : (bd - ad);
  });
  if(!list.length){
    box.innerHTML = '<div class="pe-hint" style="padding:18px;color:var(--text3);text-align:center">'
      + (q ? '검색 결과가 없습니다.' : '에디토리얼이 없습니다.')
      + '</div>';
    return;
  }
  var currentId = (document.getElementById('filmRelatedEditorial') || {}).value || '';
  var html = '';
  list.forEach(function(ed){
    var thumb = ed.thumbnail || ed.thumbnail_url || ed.cover_image || '';
    var safeThumb = String(thumb).replace(/"/g, '&quot;');
    var title = ed.title || ed.slug || ed.id || '';
    var pd = ed.published_date || ed.created_at || '';
    var dateStr = pd ? _formatFilmEdDate(pd) : '';
    var sel = (ed.id === currentId);
    // QA #305 — 예약 게시 상태 배지. scheduled_publish_at 이 미래이면
    // 캐시 로딩 시 _scheduled 플래그가 마킹돼 있음. 예약 일시도 함께 노출.
    var schedBadge = '';
    if(ed._scheduled && ed.scheduled_publish_at){
      var schedStr = _formatFilmEdDate(ed.scheduled_publish_at);
      schedBadge = '<span style="font-size:10px;color:#fff;background:#2980b9;padding:2px 6px;border-radius:2px;margin-left:6px;white-space:nowrap">⏰ 예약 ' + esc(schedStr) + '</span>';
    }
    html += '<div class="film-rel-row" data-id="' + esc(ed.id) + '" '
      + 'onclick="selectFilmRelated(\'' + String(ed.id).replace(/'/g, "\\'") + '\')" '
      + 'style="display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border);'
      + (sel ? 'background:rgba(255,255,255,.06)' : '') + '">'
      + '<div style="width:42px;height:42px;background:var(--surface);background-size:cover;background-position:center;flex-shrink:0;border-radius:2px'
      +   (thumb ? (';background-image:url(\'' + safeThumb + '\')') : '') + '"></div>'
      + '<div style="flex:1;min-width:0">'
      +   '<div style="font-size:12px;font-weight:600;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(title) + schedBadge + '</div>'
      +   '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + esc(dateStr) + '</div>'
      + '</div>'
      + (sel ? '<span style="font-size:11px;color:#3ad48a;flex-shrink:0">✓ 선택됨</span>' : '')
      + '</div>';
  });
  box.innerHTML = html;
}

// User clicked a row in the picker → write the id into the hidden
// input + refresh the chip + repaint the list so the selected row
// shows the highlight. Clicking the already-selected row toggles off.
function selectFilmRelated(id){
  var hidden = document.getElementById('filmRelatedEditorial');
  if(!hidden) return;
  var prev = hidden.value;
  if(hidden.value === id){
    hidden.value = '';
  } else {
    hidden.value = id || '';
  }
  _updateFilmRelatedSelectedChip(hidden.value);
  renderFilmRelatedList();
  // QA #307 — 에디토리얼을 새로 선택했을 때 (해제/재선택 아닌 실제 change)
  // 크레딧을 자동으로 불러온다. 'auto' 모드는 area 가 비어있을 때만 침묵
  // 채우기, 이미 내용이 있으면 confirm 다이얼로그로 덮어쓰기 여부를 묻는다.
  if (hidden.value && hidden.value !== prev){
    try {
      _loadCreditsFromRelatedEditorial('auto');
    } catch(e){
      console.warn('[films] auto-load credits failed:', e && e.message);
    }
  }
}

function clearFilmRelated(){
  var hidden = document.getElementById('filmRelatedEditorial');
  if(hidden) hidden.value = '';
  _updateFilmRelatedSelectedChip('');
  renderFilmRelatedList();
}

// QA #307 — 연결된 에디토리얼의 크레딧을 필름 크레딧 폼에 자동 로드.
//
//   mode = 'auto'  → area 가 비어있으면 침묵 populate. 내용이 있으면
//                    confirm 다이얼로그로 덮어쓰기 여부 확인.
//   mode = 'force' → 항상 덮어쓴다 (toolbar 의 "📥 크레딧 불러오기"
//                    버튼용). area 가 이미 채워져 있을 때만 confirm.
//
// 데이터 소스는 _filmRelatedEdCache 에 이미 credits 필드가 포함돼 있어
// 별도 fetch 불필요 (/api/editorials LIST_COLUMNS 에 credits 포함).
// 필름 credits 스키마와 에디토리얼 credits 스키마가 동일하므로
// {roles, name, instagram} 그대로 재사용 가능.
function _loadCreditsFromRelatedEditorial(mode){
  mode = mode || 'auto';
  var hidden = document.getElementById('filmRelatedEditorial');
  var relId = hidden && hidden.value;
  if (!relId){
    if (mode === 'force'){
      alert('먼저 상단에서 연결할 에디토리얼을 선택해주세요.');
    }
    return;
  }
  // 캐시에서 에디토리얼 찾기
  var match = null;
  if (Array.isArray(_filmRelatedEdCache)){
    for (var i = 0; i < _filmRelatedEdCache.length; i++){
      if (_filmRelatedEdCache[i] && _filmRelatedEdCache[i].id === relId){
        match = _filmRelatedEdCache[i]; break;
      }
    }
  }
  if (!match){
    if (mode === 'force'){
      alert('선택한 에디토리얼의 데이터를 찾을 수 없습니다. 페이지를 새로고침한 후 다시 시도해주세요.');
    }
    return;
  }
  var edCredits = Array.isArray(match.credits) ? match.credits : [];
  if (!edCredits.length){
    if (mode === 'force'){
      alert('선택한 에디토리얼에 등록된 크레딧이 없습니다.');
    }
    return;
  }
  // 크레딧 모드 확인. 'inherit' 모드에서는 auto-load 스킵 (렌더시 자동
  // fallback 되므로 폼 채울 필요 없음). force 모드에서만 direct 로 전환.
  var currentModeEl = document.querySelector('input[name="filmCreditsMode"]:checked');
  var currentMode = currentModeEl ? currentModeEl.value : 'direct';
  if (mode === 'auto' && currentMode === 'inherit'){
    return;
  }
  var directRadio = document.querySelector('input[name="filmCreditsMode"][value="direct"]');
  if (directRadio && !directRadio.checked){
    directRadio.checked = true;
    _onFilmCreditsModeChange('direct');
  }
  // 기존 credits area 에 실제 내용이 있는지 확인 (빈 row 는 무시)
  var area = document.getElementById('filmCreditsArea');
  if (!area) return;
  var existingRows = area.querySelectorAll('.pe-credit-row');
  var hasContent = false;
  existingRows.forEach(function(row){
    var nameEl = row.querySelector('.pe-credit-name');
    var igEl = row.querySelector('.pe-credit-ig');
    var roles = (typeof _readCreditRoles === 'function') ? _readCreditRoles(row) : [];
    if ((nameEl && nameEl.value.trim()) || (igEl && igEl.value.trim()) || roles.length){
      hasContent = true;
    }
  });
  if (hasContent){
    // auto 모드에서 내용이 있으면 침묵 skip (사용자 입력 보호).
    // force 모드에서는 confirm 다이얼로그.
    if (mode === 'auto') return;
    var msg = '📰 선택한 에디토리얼의 크레딧 ' + edCredits.length + '건을 불러옵니다.\n\n'
            + '현재 입력된 크레딧이 있습니다. 모두 덮어쓸까요?\n'
            + '(취소하면 기존 입력을 유지합니다)';
    if (!confirm(msg)) return;
  }
  // area 비우고 에디토리얼 credits 로 재구성
  area.innerHTML = '';
  edCredits.forEach(function(c){
    if (!c || typeof c !== 'object') return;
    var row = document.createElement('div');
    row.className = 'pe-credit-row';
    row.setAttribute('draggable', 'true');
    var roles = c.roles || (c.role ? [c.role] : []);
    row.innerHTML = _buildCreditRowInner(roles, c.name || '', c.instagram || '');
    area.appendChild(row);
    _wireCreditRowDrag(row, 'filmCreditsArea');
    var trig = row.querySelector('.pe-role-trigger');
    if (trig) _renderRoleChips(trig);
  });
  // 빈 상태가 안 되도록 최소 1개 row 는 보장
  if (!area.querySelector('.pe-credit-row')){
    addCredit('filmCreditsArea');
  }
  _onCreditCheckChange('filmCreditsArea');
  // 성공 토스트 — showToast 가 있으면 사용, 없으면 status 라인에 fallback
  var toastMsg = '📥 에디토리얼 크레딧 ' + edCredits.length + '건을 불러왔습니다.';
  if (typeof showToast === 'function'){
    showToast(toastMsg, 'success');
  } else if (typeof console !== 'undefined'){
    console.log('[films]', toastMsg);
  }
}
if (typeof window !== 'undefined') window._loadCreditsFromRelatedEditorial = _loadCreditsFromRelatedEditorial;

// QA #232 — same shape as validateNewsImage (QA #200): reject the file
// up front so the editor sees a Korean error before we burn an
// /api/media/upload round-trip.
var FILM_THUMB_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
var FILM_THUMB_MAX_BYTES = 2 * 1024 * 1024; // 2MB
function validateFilmThumbImage(file){
  if(!file) return { ok: false, message: '파일이 선택되지 않았습니다.' };
  if(FILM_THUMB_ALLOWED_TYPES.indexOf(file.type) === -1){
    return { ok: false, message: '지원하지 않는 형식입니다. JPG / PNG / WEBP 파일만 업로드할 수 있습니다.' };
  }
  if(typeof file.size === 'number' && file.size > FILM_THUMB_MAX_BYTES){
    var mb = (file.size / 1024 / 1024).toFixed(1);
    return { ok: false, message: '파일 크기가 너무 큽니다. (' + mb + 'MB → 최대 2MB)' };
  }
  return { ok: true };
}

// File-input handler for the film thumbnail upload affordance — runs the
// same /api/media/upload roundtrip the editorial form uses, then drops
// the resulting URL into #filmThumb so saveFilm picks it up.
//
// QA #232 — pre-flight validation + inline status line. The legacy path
// only surfaced failures via alert() and rolled the preview back; that
// hid the actual reason ("the file you picked is 4MB / is a .heic") on
// alert dismissal. We now:
//   • validate type + size before upload (skip the network round-trip)
//   • render progress / success / error inline on #filmThumbStatus
//   • still show the alert for hard upload errors so they can't be missed
async function _onFilmThumbFile(input){
  if(!input.files || !input.files[0]) return;
  var file = input.files[0];
  var prev = document.getElementById('filmThumbPreview');
  var status = document.getElementById('filmThumbStatus');
  var origHtml = prev ? prev.innerHTML : '';
  function _setStatus(text, isError){
    if(!status) return;
    status.textContent = text || '';
    status.style.color = isError ? '#c0392b' : 'var(--text3)';
  }
  // 1) Validate
  var v = validateFilmThumbImage(file);
  if(!v.ok){
    _setStatus('⚠ ' + v.message, true);
    // Clear the file input so re-picking the same file re-fires onchange.
    try { input.value = ''; } catch(_){}
    alert(v.message);
    return;
  }
  // 2) Upload
  if(prev) prev.innerHTML = '<span class="pe-upload-text">업로드 중…</span>';
  _setStatus('업로드 중…', false);
  try {
    var url = await uploadFile(file);
    document.getElementById('filmThumb').value = url;
    if(prev){
      prev.innerHTML = '<img loading="lazy" src="'+esc(url)+'" style="max-height:60px;max-width:100px;object-fit:cover;border-radius:2px"><span class="pe-upload-text" style="margin-left:8px">업로드 완료 — 클릭하여 변경</span>';
    }
    _setStatus('✓ 업로드 완료', false);
  } catch(e){
    if(prev) prev.innerHTML = origHtml;
    var msg = '업로드 실패: ' + (e && e.message ? e.message : '서버 응답 없음');
    _setStatus('⚠ ' + msg, true);
    alert(msg);
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
  // QA #306 — 신규 필름은 '직접 입력' 기본. UI wrap 초기 상태 세팅.
  var _newModeDirect = document.querySelector('input[name="filmCreditsMode"][value="direct"]');
  if (_newModeDirect) _newModeDirect.checked = true;
  if (typeof _onFilmCreditsModeChange === 'function') _onFilmCreditsModeChange('direct');
  var thumbPrev = document.getElementById('filmThumbPreview');
  if(thumbPrev) thumbPrev.innerHTML = '<span class="pe-upload-icon" style="font-size:18px">📷</span><span class="pe-upload-text" style="margin-left:8px">또는 파일 업로드 (JPG · PNG · WebP)</span>';
  // QA #232 — clear the inline status line so a stale "✓ 업로드 완료" /
  // "⚠ ..." message from a previous edit doesn't carry into a fresh
  // "+ 새 필름" session.
  var thumbStatus = document.getElementById('filmThumbStatus');
  if(thumbStatus){ thumbStatus.textContent = ''; thumbStatus.style.color = ''; }
  // QA #250 — clear Instagram caption so a stale draft from a previous
  // film edit doesn't bleed into a fresh "+ 새 필름" session.
  var igCap = document.getElementById('filmIgCaption');
  if (igCap) igCap.value = '';
  // QA #251 — same logic for the three description slots.
  ['filmDescription', 'filmDescriptionEn', 'filmDescriptionIt']
    .forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
  // QA #253 — wipe the unified 게시 설정 surface so a previous edit's
  // 추천 / 예약 / 발행 날짜 state doesn't carry into a fresh entry.
  var _pubCb = document.getElementById('filmPublishCb');
  var _featCb = document.getElementById('filmFeatured');
  var _schedCb = document.getElementById('filmScheduleCb');
  if (_pubCb)   _pubCb.checked = true;   // default 공개
  if (_featCb)  _featCb.checked = false;
  if (_schedCb) _schedCb.checked = false;
  ['filmPublishDate','filmPublishTime','filmScheduleDate']
    .forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
  var _stEl = document.getElementById('filmScheduleTime');
  if (_stEl) _stEl.value = '09:00';
  if (typeof toggleFilmSchedule === 'function') toggleFilmSchedule();
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
    // QA #250 — hydrate Instagram caption draft. Comes from the films
    // LIST_COLUMNS payload (instagram_caption included there per the
    // API change in the same QA) so no extra fetch is needed.
    var _igEl = document.getElementById('filmIgCaption');
    if (_igEl) _igEl.value = f.instagram_caption || '';
    // QA #251 — hydrate KR/EN/IT description slots, also straight from
    // the list payload (added to LIST_COLUMNS in the same QA).
    var _dEl   = document.getElementById('filmDescription');
    var _dEnEl = document.getElementById('filmDescriptionEn');
    var _dItEl = document.getElementById('filmDescriptionIt');
    if (_dEl)   _dEl.value   = f.description    || '';
    if (_dEnEl) _dEnEl.value = f.description_en || '';
    if (_dItEl) _dItEl.value = f.description_it || '';
    document.getElementById('filmDate').value = (f.published_date || '').slice(0,10) || new Date().toISOString().slice(0,10);
    // QA #253 — hydrate the unified 발행 날짜 pair (#filmPublishDate +
    // #filmPublishTime) from f.published_date so editors can see + edit
    // the timestamp the same way the editorial / news editor does.
    if (f.published_date) {
      try {
        var _pd = new Date(f.published_date);
        if (!isNaN(_pd.getTime())) {
          var _pp = function(n){ return n < 10 ? '0' + n : '' + n; };
          var _pubDateEl = document.getElementById('filmPublishDate');
          var _pubTimeEl = document.getElementById('filmPublishTime');
          if (_pubDateEl) _pubDateEl.value = _pd.getFullYear() + '-' + _pp(_pd.getMonth()+1) + '-' + _pp(_pd.getDate());
          if (_pubTimeEl) _pubTimeEl.value = _pp(_pd.getHours()) + ':' + _pp(_pd.getMinutes());
        }
      } catch(_){}
    }
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
    // QA #253 — sync the visible checkbox pair (#filmPublishCb + #filmScheduleCb)
    // to the hidden radio so the editor sees the right state of the
    // unified 게시 설정 UI.
    var _isDraft = (f.status !== 'published');
    var _isScheduled = (_modeId === 'filmPublishMode_scheduled');
    var _pubCb2 = document.getElementById('filmPublishCb');
    var _schedCb2 = document.getElementById('filmScheduleCb');
    if (_pubCb2)   _pubCb2.checked   = !_isDraft;  // draft → 공개 미체크
    if (_schedCb2) _schedCb2.checked = _isScheduled;
    var _schedInput = document.getElementById('filmScheduledAt');
    if (_schedInput && f.scheduled_publish_at) {
      // Convert ISO timestamp → datetime-local value (YYYY-MM-DDTHH:mm).
      try {
        var _d = new Date(f.scheduled_publish_at);
        var _p = function(n){ return n < 10 ? '0' + n : '' + n; };
        _schedInput.value = _d.getFullYear() + '-' + _p(_d.getMonth()+1) + '-' + _p(_d.getDate()) + 'T' + _p(_d.getHours()) + ':' + _p(_d.getMinutes());
        // QA #253 — also fill the split date / time pair so the new
        // unified UI displays the right values.
        var _sdEl = document.getElementById('filmScheduleDate');
        var _stEl = document.getElementById('filmScheduleTime');
        if (_sdEl) _sdEl.value = _d.getFullYear() + '-' + _p(_d.getMonth()+1) + '-' + _p(_d.getDate());
        if (_stEl) _stEl.value = _p(_d.getHours()) + ':' + _p(_d.getMinutes());
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
    // QA #306 — credits 배열이 비어있고 related_editorial_id 가 있으면
    // '에디토리얼과 동일' 모드로 초기화. 그 외에는 '직접 입력' 기본.
    var _editMode = (creditsList.length === 0 && f.related_editorial_id)
      ? 'inherit' : 'direct';
    var _editModeInput = document.querySelector('input[name="filmCreditsMode"][value="' + _editMode + '"]');
    if (_editModeInput) _editModeInput.checked = true;
    if (typeof _onFilmCreditsModeChange === 'function') _onFilmCreditsModeChange(_editMode);
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

  // QA #252 — was `filmModal.classList.add('show')`. Now we navigate to
  // the dedicated tab page (`#t-newfilm`) the same way the editorial /
  // news editors do. `go('newfilm')` handles the URL pushState +
  // sidebar highlight + tab toggle; the form was already hydrated above
  // so there's nothing else to wire up here.
  go('newfilm');
  // Scroll to top so the editor starts at the title field, not wherever
  // the previous tab was scrolled to.
  try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch(_){}
}
// QA #252 — closing the film editor now means "go back to the film
// list" (mirrors closeNewPost/closeNewNews behavior). The dirty-check
// hook in pap-admin.js's beforeunload listener still kicks in via the
// '#t-newfilm' watch entry.
function closeFilmModal(){
  // Drop edit context so the next "+ 새 필름" click starts clean.
  try { editFilmId = null; editFilmIdx = -1; } catch(_){}
  go('film');
}

// QA #164 / #253 — keep the visible UI in sync with the (hidden) legacy
// radios + show the 예약 일시 box only when the 예약 checkbox is ticked.
//
// The film editor now matches the editorial / news pattern: two visible
// checkboxes (#filmPublishCb 공개, #filmScheduleCb 예약) drive a hidden
// radio group (`filmPublishMode_*`) that the rest of saveFilm /
// openFilmModal / read paths already speak. Toggling either checkbox
// reconciles the radios so downstream code keeps working:
//
//   공개 + 예약 미체크  → published
//   공개 미체크 + 예약 미체크 → draft
//   예약 체크 (공개 무관) → scheduled
//
// The "예약 일시" area (`#filmScheduleArea`) is the user-facing toggle
// target. The legacy `#filmScheduleWrap` element is now a hidden noop
// kept only so older cached JS doesn't NPE on a null lookup.

// ======== QA #254 — INSTAGRAM IMAGE GENERATOR ========
//
// Reads URLs from the gallery grid (each .pe-gallery-item img.src in
// the editorial editor), composites the PAP logo over each, and
// exports at Instagram-friendly dimensions (1080×1350 by default).
//
// Defaults match the existing PAP IG feed analysed from sample posts:
//   • Logo width        7% of canvas width
//   • Bottom padding    5% of canvas height
//   • Horizontal center
//   • White transparent PNG, drawn directly on the photo (no scrim)
//
// Editor-side controls let the user nudge these per-editorial via the
// sliders without a code change. A custom logo PNG can also be slotted
// in via the file input.
//
// Rendering happens entirely in the browser (Canvas API + JSZip), so
// there's no server-side image-processing cost. The only failure mode
// is CORS-blocked S3 fetches — handled below with crossOrigin and a
// clear error toast on failure.

// QA #254 v2 — default PAP logo source path. /pap-symbol-white.png is
// already shipped (used as the hero watermark on the home page), so we
// reuse it instead of drawing a runtime SVG. The editor can still
// override via the file input (papInstaSetCustomLogo) when they want a
// specific transparent-PNG mark for a given editorial.
// QA #254 v3 — wordmark, not the square symbol. The Instagram editor
// stamps a horizontal "PAP" wordmark at the bottom; pap-symbol-white.png
// is the square symbol mark used on the site header, not what we want
// composited over editorial shots.
var _PAP_INSTA_DEFAULT_LOGO_URL = '/pap-logo-white.png';

var _papInstaLogoImg = null;       // cached HTMLImageElement of the logo
var _papInstaLogoLoading = null;   // in-flight Promise so concurrent
                                    // preview + download calls share one load

// QA #254 v2 — per-image overrides for { logoPct, padPct }, keyed by
// the gallery image URL. Edited via the modal sliders; falls back to
// the global defaults read from #instaLogoSize / #instaBottomPad.
var _papInstaPerImageOpts = {};
var _papInstaCurrentUrls  = [];
var _papInstaCurrentIdx   = 0;

// QA #254 v2 — open the editor modal: build thumbnail strip, hydrate
// per-image opts (falling back to globals), composite first image.
async function papInstaOpenEditor(){
  var urls = _papInstaCollectGalleryUrls();
  if (!urls.length) {
    alert('갤러리에 이미지가 없습니다. 먼저 이미지를 추가해주세요.');
    return;
  }
  _papInstaCurrentUrls = urls;
  _papInstaCurrentIdx = 0;
  // QA #254 v3 — refresh "기본 로고 / 커스텀 로고" status badge.
  if (typeof _papInstaUpdateLogoStatusUI === 'function') _papInstaUpdateLogoStatusUI();
  _papInstaRenderThumbStrip();
  try {
    await _papInstaShowImage(0);
    document.getElementById('instaPreviewModal').classList.add('show');
  } catch (e) {
    console.error('[insta editor] failed:', e);
    alert('미리보기 합성에 실패했습니다.\nS3 CORS 제한 또는 이미지 로드 실패일 수 있습니다.\n\n상세: ' + (e && e.message ? e.message : e));
  }
}

// Backwards-compatible alias — older inline onclick may still call this.
var papInstaPreview = papInstaOpenEditor;

function _papInstaRenderThumbStrip(){
  var strip = document.getElementById('instaThumbStrip');
  if (!strip) return;
  strip.innerHTML = '';
  _papInstaCurrentUrls.forEach(function(url, idx){
    var thumb = document.createElement('div');
    thumb.style.cssText =
      'flex:0 0 auto;width:60px;height:60px;cursor:pointer;border:2px solid ' +
      (idx === _papInstaCurrentIdx ? 'var(--purple)' : 'transparent') +
      ';background-image:url(' + JSON.stringify(url).replace(/"/g,'\'') +
      ');background-size:cover;background-position:center;border-radius:2px;position:relative';
    thumb.dataset.idx = String(idx);
    thumb.title = '이미지 ' + (idx + 1);
    thumb.onclick = function(){
      var i = parseInt(this.dataset.idx, 10) || 0;
      _papInstaShowImage(i);
    };
    // Indicator dot if this image has a per-image override.
    if (_papInstaPerImageOpts[url]) {
      var dot = document.createElement('div');
      dot.style.cssText = 'position:absolute;top:2px;right:2px;width:7px;height:7px;background:#f97316;border-radius:50%;border:1px solid #fff';
      dot.title = '개별 설정 적용됨';
      thumb.appendChild(dot);
    }
    strip.appendChild(thumb);
  });
}

async function _papInstaShowImage(idx){
  if (idx < 0 || idx >= _papInstaCurrentUrls.length) return;
  _papInstaCurrentIdx = idx;
  var url = _papInstaCurrentUrls[idx];
  var opts = _papInstaOptsForImage(url);
  // Sync the modal sliders to this image's current effective opts.
  var ls = document.getElementById('instaModalLogoSize');
  var ps = document.getElementById('instaModalBottomPad');
  var ll = document.getElementById('instaModalLogoSizeLabel');
  var pl = document.getElementById('instaModalPadLabel');
  if (ls) ls.value = opts.logoPct;
  if (ps) ps.value = opts.padPct;
  if (ll) ll.textContent = opts.logoPct + '%';
  if (pl) pl.textContent = opts.padPct + '%';
  // QA #254 v3 — image positioning sliders.
  var sc = document.getElementById('instaModalImgScale');
  var ox = document.getElementById('instaModalOffsetX');
  var oy = document.getElementById('instaModalOffsetY');
  var scl = document.getElementById('instaModalImgScaleLabel');
  var oxl = document.getElementById('instaModalOffsetXLabel');
  var oyl = document.getElementById('instaModalOffsetYLabel');
  if (sc)  sc.value  = opts.imgScale;
  if (ox)  ox.value  = opts.offsetX;
  if (oy)  oy.value  = opts.offsetY;
  if (scl) scl.textContent = opts.imgScale + '%';
  if (oxl) oxl.textContent = (opts.offsetX > 0 ? '+' : '') + opts.offsetX;
  if (oyl) oyl.textContent = (opts.offsetY > 0 ? '+' : '') + opts.offsetY;
  // QA #257 — logo alpha slider sync (0-100% opacity).
  var la  = document.getElementById('instaModalLogoAlpha');
  var lal = document.getElementById('instaModalLogoAlphaLabel');
  if (la)  la.value  = opts.logoAlpha;
  if (lal) lal.textContent = opts.logoAlpha + '%';
  // QA #258 — "logo enabled" per-image toggle.
  var le = document.getElementById('instaModalLogoEnabled');
  if (le) le.checked = (opts.logoEnabled !== false);
  // Counter label.
  var cnt = document.getElementById('instaModalCounter');
  if (cnt) cnt.textContent = (idx + 1) + ' / ' + _papInstaCurrentUrls.length +
    (_papInstaPerImageOpts[url] ? ' · 🟠 개별 설정' : ' · 기본값');
  // Composite onto the preview canvas.
  var canvas = document.getElementById('instaPreviewCanvas');
  if (canvas) {
    canvas.width  = opts.W;
    canvas.height = opts.H;
    await _papInstaCompositeOne(url, canvas, opts);
  }
  // Refresh thumb-strip active border + override-dot.
  _papInstaRenderThumbStrip();
}

function papInstaPrev(){
  var i = _papInstaCurrentIdx - 1;
  if (i < 0) i = _papInstaCurrentUrls.length - 1;
  _papInstaShowImage(i);
}
function papInstaNext(){
  var i = _papInstaCurrentIdx + 1;
  if (i >= _papInstaCurrentUrls.length) i = 0;
  _papInstaShowImage(i);
}

// Slider input handler — updates the per-image override and re-composites.
function _papInstaOnSliderInput(){
  var url = _papInstaCurrentUrls[_papInstaCurrentIdx];
  if (!url) return;
  var logoPct  = parseFloat(document.getElementById('instaModalLogoSize').value);
  var padPct   = parseFloat(document.getElementById('instaModalBottomPad').value);
  // QA #254 v3 — image positioning override values.
  var imgScale = parseFloat((document.getElementById('instaModalImgScale')||{}).value || '100');
  var offsetX  = parseFloat((document.getElementById('instaModalOffsetX') ||{}).value || '0');
  var offsetY  = parseFloat((document.getElementById('instaModalOffsetY') ||{}).value || '0');
  // QA #257 — logo opacity (0-100%).
  var logoAlpha = parseFloat((document.getElementById('instaModalLogoAlpha')||{}).value || '100');
  // QA #258 — per-image enable toggle. Default true.
  var leEl = document.getElementById('instaModalLogoEnabled');
  var logoEnabled = leEl ? !!leEl.checked : true;
  _papInstaPerImageOpts[url] = {
    logoPct: logoPct, padPct: padPct,
    imgScale: imgScale, offsetX: offsetX, offsetY: offsetY,
    logoAlpha: logoAlpha,
    logoEnabled: logoEnabled,
  };
  document.getElementById('instaModalLogoSizeLabel').textContent = logoPct + '%';
  document.getElementById('instaModalPadLabel').textContent     = padPct  + '%';
  var scl = document.getElementById('instaModalImgScaleLabel');
  var oxl = document.getElementById('instaModalOffsetXLabel');
  var oyl = document.getElementById('instaModalOffsetYLabel');
  if (scl) scl.textContent = imgScale + '%';
  if (oxl) oxl.textContent = (offsetX > 0 ? '+' : '') + offsetX;
  if (oyl) oyl.textContent = (offsetY > 0 ? '+' : '') + offsetY;
  // QA #257 — alpha label.
  var lal = document.getElementById('instaModalLogoAlphaLabel');
  if (lal) lal.textContent = logoAlpha + '%';
  // Composite — same canvas, just rewrite.
  var opts = _papInstaOptsForImage(url);
  var canvas = document.getElementById('instaPreviewCanvas');
  if (canvas) _papInstaCompositeOne(url, canvas, opts);
  // Update strip orange-dot indicator.
  var cnt = document.getElementById('instaModalCounter');
  if (cnt) cnt.textContent = (_papInstaCurrentIdx + 1) + ' / ' +
    _papInstaCurrentUrls.length + ' · 🟠 개별 설정';
  // Refresh thumb-strip so the orange dot lights up immediately.
  _papInstaRenderThumbStrip();
}

// QA #254 v3 — Reset the current image's per-image override back to
// global defaults (clears the row from _papInstaPerImageOpts and re-
// syncs the sliders).
function papInstaResetImage(){
  var url = _papInstaCurrentUrls[_papInstaCurrentIdx];
  if (!url) return;
  delete _papInstaPerImageOpts[url];
  _papInstaShowImage(_papInstaCurrentIdx);
}

// QA #260 — apply ONLY the logo-related opts of the current image to
// every other image in the batch. Image-positioning opts (imgScale,
// offsetX, offsetY) are intentionally left alone because every photo
// frames differently and a uniform crop wouldn't make sense.
//
// Semantics:
//   - source = current image's effective opts (per-image override OR
//     global default fallback).
//   - for each other URL: merge logo opts into its existing override,
//     preserving its image-positioning opts.
//   - URLs that had no override before now get a fresh one carrying
//     just the logo opts (image-positioning defaults remain in effect).
function papInstaApplyLogoToAll(){
  var srcUrl = _papInstaCurrentUrls[_papInstaCurrentIdx];
  if (!srcUrl) return;
  var src = _papInstaOptsForImage(srcUrl);
  // The four logo-only opts.
  var logoOpts = {
    logoPct:     src.logoPct,
    padPct:      src.padPct,
    logoAlpha:   src.logoAlpha,
    logoEnabled: src.logoEnabled,
  };
  var count = 0;
  _papInstaCurrentUrls.forEach(function(url){
    if (url === srcUrl) return; // current image already has these values
    var existing = _papInstaPerImageOpts[url] || {};
    _papInstaPerImageOpts[url] = {
      // Preserve existing image-positioning override (or undefined to
      // fall back to global defaults).
      imgScale: existing.imgScale,
      offsetX:  existing.offsetX,
      offsetY:  existing.offsetY,
      // Overwrite logo opts with the source image's settings.
      logoPct:     logoOpts.logoPct,
      padPct:      logoOpts.padPct,
      logoAlpha:   logoOpts.logoAlpha,
      logoEnabled: logoOpts.logoEnabled,
    };
    count++;
  });
  // Refresh strip indicators + counter label, and re-composite the
  // currently visible canvas (no functional change for it but keeps
  // the UI internally consistent).
  _papInstaRenderThumbStrip();
  var cnt = document.getElementById('instaModalCounter');
  if (cnt) cnt.textContent = (_papInstaCurrentIdx + 1) + ' / ' +
    _papInstaCurrentUrls.length + ' · 🌐 ' + count + '장 일괄 적용 완료';
  // Toast-style feedback for an obvious "done" signal.
  alert('현재 이미지의 로고 설정을 다른 ' + count + '장에 일괄 적용했습니다.\n\n적용된 항목: 🏷️ 너비, 📏 하단 여백, 🔆 투명도, ☑️ 로고 표시 여부\n적용 제외: 🔍 확대, ↔️ 좌/우, ↕️ 상/하 (이미지마다 다른 framing 유지)');
}

// Resolve the effective opts for a given image: per-image override
// (if any) wins over the global slider defaults.
//
// QA #254 v3 — opts shape extended with imgScale / offsetX / offsetY
// for per-image positioning. Falls back to identity (100% / 0 / 0)
// when the override doesn't carry them so older overrides written
// before v3 don't crash.
function _papInstaOptsForImage(url){
  var base = _papInstaReadOpts();
  var ov = _papInstaPerImageOpts[url];
  if (ov) {
    return {
      W: base.W, H: base.H,
      logoPct:   (typeof ov.logoPct   === 'number') ? ov.logoPct   : base.logoPct,
      padPct:    (typeof ov.padPct    === 'number') ? ov.padPct    : base.padPct,
      imgScale:  (typeof ov.imgScale  === 'number') ? ov.imgScale  : base.imgScale,
      offsetX:   (typeof ov.offsetX   === 'number') ? ov.offsetX   : base.offsetX,
      offsetY:   (typeof ov.offsetY   === 'number') ? ov.offsetY   : base.offsetY,
      logoAlpha: (typeof ov.logoAlpha === 'number') ? ov.logoAlpha : base.logoAlpha,
      // QA #258 — per-image logo on/off (only false counts as off; undefined → default on).
      logoEnabled: (ov.logoEnabled === false) ? false : true,
    };
  }
  return base;
}

function closeInstaPreview(){
  var m = document.getElementById('instaPreviewModal');
  if (m) m.classList.remove('show');
}

async function papInstaDownloadAll(){
  // QA #254 v2 — when the editor modal is open, use its in-memory
  // url list (so per-image overrides win). Otherwise fall back to the
  // current gallery snapshot.
  var urls = (_papInstaCurrentUrls && _papInstaCurrentUrls.length)
    ? _papInstaCurrentUrls
    : _papInstaCollectGalleryUrls();
  if (!urls.length) { alert('갤러리에 이미지가 없습니다.'); return; }
  if (typeof JSZip === 'undefined') {
    alert('JSZip 라이브러리 로드 실패. 페이지를 새로고침해주세요.');
    return;
  }
  _papInstaSetStatus('처리 중 0 / ' + urls.length + '...');
  var globalOpts = _papInstaReadOpts();
  var zip = new JSZip();
  var folder = zip.folder('pap-instagram-' + (new Date().toISOString().slice(0,10)));
  var canvas = document.createElement('canvas');
  canvas.width = globalOpts.W; canvas.height = globalOpts.H;
  var ok = 0, failed = 0;
  for (var i = 0; i < urls.length; i++) {
    try {
      // Per-image override wins; resolve fresh on each loop iteration.
      var opts = _papInstaOptsForImage(urls[i]);
      await _papInstaCompositeOne(urls[i], canvas, opts);
      var blob = await new Promise(function(res){
        canvas.toBlob(function(b){ res(b); }, 'image/png', 0.92);
      });
      var name = String(i + 1).padStart(2, '0') + '.png';
      folder.file(name, blob);
      ok++;
    } catch (e) {
      console.error('[insta] image ' + i + ' failed:', e);
      failed++;
    }
    _papInstaSetStatus('처리 중 ' + (i + 1) + ' / ' + urls.length + '...');
  }
  _papInstaSetStatus('ZIP 생성 중...');
  var zipBlob = await zip.generateAsync({ type: 'blob' });
  var url = URL.createObjectURL(zipBlob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'pap-instagram-' + (new Date().toISOString().slice(0,10)) + '.zip';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
  _papInstaSetStatus('✓ ZIP 다운로드 완료 (성공 ' + ok + '장, 실패 ' + failed + '장)');
}

// QA #254 v3 — persisted custom logo.
//   localStorage key holds a base64 dataURL of the user-uploaded PNG.
//   _papInstaLoadLogo() checks this first, so the chosen logo survives
//   browser reloads / next-day visits — i.e. functions as the
//   "permanent default" until the editor clicks "기본 로고로 복원".
// QA #254 v3 — bumped key v1 → v2 to invalidate previously-stored bad
// custom logos. Editors who had uploaded the (incorrect) PAP symbol via
// the file picker would otherwise keep seeing it because the stored
// dataURL is read before the factory default URL. New key forces a
// fresh load of /pap-logo-white.png on next page open.
var _PAP_INSTA_CUSTOM_LOGO_KEY = 'pap_insta_custom_logo_v2';
// Best-effort cleanup of the old key so the browser doesn't carry dead
// storage forever.
try { localStorage.removeItem('pap_insta_custom_logo_v1'); } catch(_) {}

function _papInstaReadStoredLogoDataUrl(){
  try { return localStorage.getItem(_PAP_INSTA_CUSTOM_LOGO_KEY) || ''; }
  catch(_) { return ''; }
}
function _papInstaWriteStoredLogoDataUrl(dataUrl){
  try {
    if (dataUrl) localStorage.setItem(_PAP_INSTA_CUSTOM_LOGO_KEY, dataUrl);
    else         localStorage.removeItem(_PAP_INSTA_CUSTOM_LOGO_KEY);
  } catch(_) { /* quota / private-mode: ignore */ }
}

function papInstaSetCustomLogo(input){
  if (!input || !input.files || !input.files[0]) return;
  var file = input.files[0];
  // Reject anything heavier than 2 MB — localStorage caps around
  // 5 MB total, so a logo bigger than that would crowd out other state.
  if (file.size > 2 * 1024 * 1024) {
    _papInstaSetStatus('❌ 로고는 2MB 이하 PNG/SVG만 가능합니다.');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e){
    var dataUrl = e.target.result;
    var img = new Image();
    img.onload = function(){
      _papInstaLogoImg = img;
      // Persist for future sessions on this browser.
      _papInstaWriteStoredLogoDataUrl(dataUrl);
      _papInstaSetStatus('✓ 커스텀 로고가 영구 적용되었습니다. (이 브라우저 영구 저장)');
      _papInstaUpdateLogoStatusUI();
      // If the preview modal is open, recomposite the current image.
      var canvas = document.getElementById('instaPreviewCanvas');
      if (canvas && _papInstaCurrentUrls[_papInstaCurrentIdx]) {
        var url = _papInstaCurrentUrls[_papInstaCurrentIdx];
        _papInstaCompositeOne(url, canvas, _papInstaOptsForImage(url));
      }
    };
    img.onerror = function(){ _papInstaSetStatus('❌ 로고 이미지 로드 실패'); };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

// Restore factory-default logo (`/pap-symbol-white.png`).
function papInstaResetCustomLogo(){
  if (!confirm('커스텀 로고를 삭제하고 기본 PAP 로고로 되돌리시겠습니까?')) return;
  _papInstaWriteStoredLogoDataUrl('');
  _papInstaLogoImg = null;
  _papInstaLogoLoading = null;
  _papInstaSetStatus('✓ 기본 로고로 복원되었습니다.');
  _papInstaUpdateLogoStatusUI();
  var canvas = document.getElementById('instaPreviewCanvas');
  if (canvas && _papInstaCurrentUrls[_papInstaCurrentIdx]) {
    var url = _papInstaCurrentUrls[_papInstaCurrentIdx];
    _papInstaCompositeOne(url, canvas, _papInstaOptsForImage(url));
  }
}

// UI badge: shows whether the editor's browser is on factory default
// or a stored custom logo, and toggles the "기본 로고로 복원" button.
//
// QA #259 — added a thumbnail preview + 🔒 lock affordance so the
// editor can SEE which logo is currently active and confirm it's the
// one they uploaded. The thumbnail is the same dataURL we draw onto the
// canvas, so what they see in the badge is exactly what will be
// composited into the ZIP export.
function _papInstaUpdateLogoStatusUI(){
  var stored = _papInstaReadStoredLogoDataUrl();
  var has = !!stored;
  var badge = document.getElementById('instaLogoStatusBadge');
  if (badge) {
    if (has) {
      badge.innerHTML = '🔒 <span style="color:#16a34a">커스텀 로고 영구 적용 중</span> '
        + '<img src="' + stored + '" alt="현재 로고" '
        + 'style="display:inline-block;height:18px;width:auto;max-width:80px;vertical-align:middle;'
        + 'margin-left:6px;padding:2px 4px;background:#222;border-radius:3px">';
    } else {
      badge.innerHTML = '<span style="color:var(--text3)">기본 PAP 로고 사용 중</span>';
    }
  }
  var resetBtn = document.getElementById('instaResetLogoBtn');
  if (resetBtn) resetBtn.style.display = has ? '' : 'none';
}

function _papInstaSetStatus(msg){
  var el = document.getElementById('instaGenStatus');
  if (el) el.textContent = msg || '';
}

function _papInstaReadOpts(){
  var aspect = (document.getElementById('instaAspect') || {}).value || '4:5';
  // QA #261 — editor-preferred defaults: 15% width, 1% bottom pad, 85%
  // opacity. These values are the brand-correct settings derived from
  // the live editorial samples and were locked in after a full
  // walkthrough of 6 representative IG covers.
  var logoPct = parseFloat((document.getElementById('instaLogoSize') || {}).value || '15');
  var padPct  = parseFloat((document.getElementById('instaBottomPad') || {}).value || '1');
  // QA #254 v3 — image positioning defaults (identity transform — image
  // is cover-fit centered, no zoom-in, no offset). Per-image overrides
  // can shift these via the modal sliders.
  return {
    W: 1080,
    H: (aspect === '1:1' ? 1080 : 1350),
    logoPct: logoPct, padPct: padPct,
    imgScale: 100, offsetX: 0, offsetY: 0,
    // QA #257 / #261 — default logo opacity 85% (was 100%).
    logoAlpha: 85,
    // QA #258 — logo overlay enabled by default.
    logoEnabled: true,
  };
}

function _papInstaCollectGalleryUrls(){
  var imgs = document.querySelectorAll('#galleryGrid .pe-gallery-item img');
  var out = [];
  imgs.forEach(function(img){ if (img && img.src) out.push(img.src); });
  return out;
}

function _papInstaLoadLogo(){
  if (_papInstaLogoImg) return Promise.resolve(_papInstaLogoImg);
  if (_papInstaLogoLoading) return _papInstaLogoLoading;
  _papInstaLogoLoading = new Promise(function(res, rej){
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = function(){ _papInstaLogoImg = img; res(img); };
    img.onerror = function(){
      // QA #254 v3 — stored custom logo failed to decode for some
      // reason (corruption etc). Fall back to factory default rather
      // than blocking the editor.
      var fallback = new Image();
      fallback.crossOrigin = 'anonymous';
      fallback.onload  = function(){ _papInstaLogoImg = fallback; res(fallback); };
      fallback.onerror = function(){ rej(new Error('PAP 로고 로드 실패: ' + _PAP_INSTA_DEFAULT_LOGO_URL)); };
      fallback.src = _PAP_INSTA_DEFAULT_LOGO_URL;
    };
    // QA #254 v3 — check for a stored custom logo first (persisted
    // dataURL in localStorage). Falls through to the factory default
    // when there's nothing stored.
    var stored = (typeof _papInstaReadStoredLogoDataUrl === 'function')
      ? _papInstaReadStoredLogoDataUrl() : '';
    img.src = stored || _PAP_INSTA_DEFAULT_LOGO_URL;
  });
  return _papInstaLogoLoading;
}

// QA #254 v3 hotfix — cache loaded images by URL. Sliders fire many
// `_papInstaCompositeOne` calls per second; without a cache each one
// re-fetched the gallery image from S3, and a single CORS hiccup
// (preflight cache miss, transient 4xx, network blip) on any subsequent
// fetch left the canvas blank — looked like the sliders "did nothing"
// because the redraw silently dropped the image layer. With the cache
// the image is fetched exactly once per session per URL, so slider
// drags repaint instantly from memory.
var _papInstaImageCache = {};
function _papInstaLoadImage(url){
  if (_papInstaImageCache[url]) return Promise.resolve(_papInstaImageCache[url]);
  return new Promise(function(res, rej){
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = function(){
      _papInstaImageCache[url] = img;
      res(img);
    };
    img.onerror = function(){
      // Retry once WITHOUT crossOrigin so a missing CORS header doesn't
      // black out the preview. The fallback render will taint the canvas
      // (downloadAll will catch the SecurityError separately), but the
      // editor can still SEE what they're framing — which is the whole
      // point of the modal. ZIP export still works on the
      // crossOrigin-enabled paths it can use.
      var fallback = new Image();
      fallback.onload  = function(){
        _papInstaImageCache[url] = fallback;
        res(fallback);
      };
      fallback.onerror = function(){
        rej(new Error('이미지 로드 실패: ' + url));
      };
      fallback.src = url;
    };
    img.src = url;
  });
}

async function _papInstaCompositeOne(url, canvas, opts){
  var ctx = canvas.getContext('2d');
  var W = opts.W, H = opts.H;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  // QA #257 — turn on high-quality scaling for both the gallery image
  // and the logo overlay. Default browser smoothing setting is "low"
  // which produces visibly soft / pixelated edges when scaling a small
  // PNG up to fill 14% of 1080px. "high" runs bicubic-style sampling.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // QA #254 v2 — was fillStyle '#000' which left a black "frame" when
  // the source image happened to be transparent. Clear to fully
  // transparent and let cover-crop paint over it; on the off chance the
  // image still leaves gaps, the export PNG will preserve transparency.
  ctx.clearRect(0, 0, W, H);
  var img;
  try {
    img = await _papInstaLoadImage(url);
  } catch (e) {
    // QA #254 v3 hotfix — if the source image won't load, paint a faint
    // grey background so the editor sees the canvas exists and can still
    // exercise the logo/position sliders even when the image layer is
    // unavailable. Surfacing the URL in console keeps debugging cheap.
    console.warn('[pap-insta] preview image load failed, drawing placeholder:', url, e);
    ctx.fillStyle = '#f4f4f5';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('이미지 로드 실패 (CORS)', W/2, H/2);
    return;
  }
  var iw = img.naturalWidth, ih = img.naturalHeight;
  // QA #254 v3 — base cover-fit scale, then multiply by user-chosen
  // zoom (imgScale 100~250%). offsetX/Y shift the image by ±50% of
  // the canvas dimension so the editor can re-frame any region.
  var imgScale = (typeof opts.imgScale === 'number' && opts.imgScale > 0) ? opts.imgScale : 100;
  var offsetX  = (typeof opts.offsetX  === 'number') ? opts.offsetX : 0;
  var offsetY  = (typeof opts.offsetY  === 'number') ? opts.offsetY : 0;
  var scale = Math.max(W / iw, H / ih) * (imgScale / 100);
  var dw = iw * scale, dh = ih * scale;
  var dx = (W - dw) / 2 + (offsetX / 100) * W;
  var dy = (H - dh) / 2 + (offsetY / 100) * H;
  ctx.drawImage(img, dx, dy, dw, dh);
  // QA #258 — early out when the per-image "logo enabled" toggle is off.
  // The source pixels already have a watermark composited in, so adding
  // our overlay would produce a duplicate logo.
  if (opts.logoEnabled === false) return;
  var logo = await _papInstaLoadLogo();
  var logoW = W * (opts.logoPct / 100);
  var logoH = logoW * (logo.naturalHeight / logo.naturalWidth);
  // QA #257 — apply per-image logo opacity. Save/restore the ctx alpha
  // so this only affects the logo draw, not future composites that
  // share the same canvas.
  var alpha = (typeof opts.logoAlpha === 'number') ? Math.max(0, Math.min(100, opts.logoAlpha)) / 100 : 1;
  var prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.drawImage(logo, (W - logoW) / 2, H - logoH - (H * (opts.padPct / 100)), logoW, logoH);
  ctx.globalAlpha = prevAlpha;
}

// ── QA #265 — Magazine cover image generator ─────────────────────────────
//
// Mirrors the PAP magazine standard cover layout from live examples:
//   • Top-left:  "[Month] Issue"        (white sans, ~22px)
//   • Top-right: "[Year]"               (white sans, ~22px)
//   • Left edge: "Published by Domenico Kang" (90° rotated, ~14px)
//   • Top-center: PAP wordmark logo     (~22% canvas width)
//   • Bottom-center: italic serif title (~70px)
//   • Below title: contributors line    (italic serif, ~28px)
//
// All inputs are auto-derived from the editorial form so the editor can
// usually just click "👁️ 미리보기" → "⬇️ PNG 다운로드" without typing
// anything else. Manual overrides live in the cover-gen section's three
// optional inputs (Issue label, Year, Contributors).

var _PAP_COVER_W = 1080;
var _PAP_COVER_H = 1350;

// Month name in English for "May Issue" etc.
var _PAP_MONTHS = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

// QA #266 — read fine-tune slider values (or fall back to defaults if
// the advanced section isn't open / wasn't touched). Each value
// represents either a px or a % depending on the field.
function _papCoverReadStyleOpts(){
  function _num(id, fallback){
    var el = document.getElementById(id);
    var v = el ? parseFloat(el.value) : NaN;
    return isNaN(v) ? fallback : v;
  }
  // QA #269 — defaults locked in from the editor-approved sample
  // (June Issue 2026 "Where you end and I begin" cover).
  return {
    logoSize:       _num('coverLogoSize', 27),       // % canvas width
    logoShadow:     _num('coverLogoShadow', 70),     // 0-100, shadow intensity
    logoTop:        _num('coverLogoTop', 6),         // % canvas height from top
    titleSize:      _num('coverTitleSize', 48),      // px
    contribSize:    _num('coverContribSize', 24),    // px
    topLabelSize:   _num('coverTopLabelSize', 19),   // px
    sideLabelSize:  _num('coverSideLabelSize', 14),  // px
    bottomPad:      _num('coverBottomPad', 52),      // px from canvas bottom (contributors baseline)
    // QA #267 — independent position sliders.
    topLabelTop:    _num('coverTopLabelTop', 42),    // px from canvas top
    topLabelSide:   _num('coverTopLabelSide', 52),   // px from each side edge
    sideLabelY:     _num('coverSideLabelY', 57),     // % canvas height (vertical pos for "Published by")
    titleBottom:    _num('coverTitleBottom', 10),    // % canvas height from bottom (title baseline)
  };
}

// Reset button → restores all sliders to defaults.
function papCoverResetSettings(){
  // QA #269 — defaults match the editor-approved sample (June Issue 2026
  // "Where you end and I begin"). Reset button restores all 12 to these.
  var pairs = [
    ['coverLogoSize',      27, '%'],
    ['coverLogoShadow',    70, '%'],
    ['coverLogoTop',        6, '%'],
    ['coverTitleSize',     48, 'px'],
    ['coverContribSize',   24, 'px'],
    ['coverTopLabelSize',  19, 'px'],
    ['coverSideLabelSize', 14, 'px'],
    ['coverBottomPad',     52, 'px'],
    // QA #267 — position sliders defaults.
    ['coverTopLabelTop',   42, 'px'],
    ['coverTopLabelSide',  52, 'px'],
    ['coverSideLabelY',    57, '%'],
    ['coverTitleBottom',   10, '%'],
  ];
  pairs.forEach(function(p){
    var el = document.getElementById(p[0]);
    if (el) el.value = p[1];
    var lbl = document.getElementById(p[0] + 'Label');
    if (lbl) lbl.textContent = p[1] + p[2];
  });
}

function _papCoverReadFormMeta(){
  // 1) Issue label: input > published_date month > current month
  var issueEl = document.getElementById('coverIssueLabel');
  var issueLabel = (issueEl && issueEl.value || '').trim();
  if (!issueLabel) {
    var dateEl = document.getElementById('postDate');
    var dateStr = dateEl ? dateEl.value : '';
    var d = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    issueLabel = _PAP_MONTHS[d.getMonth()] + ' Issue';
  }

  // 2) Year: input > published_date year > current year
  var yearEl = document.getElementById('coverYearLabel');
  var yearLabel = (yearEl && yearEl.value || '').trim();
  if (!yearLabel) {
    var dateEl2 = document.getElementById('postDate');
    var dateStr2 = dateEl2 ? dateEl2.value : '';
    var d2 = dateStr2 ? new Date(dateStr2) : new Date();
    if (isNaN(d2.getTime())) d2 = new Date();
    yearLabel = String(d2.getFullYear());
  }

  // 3) Title: editorial postTitle
  var titleEl = document.getElementById('postTitle');
  var title = titleEl ? (titleEl.value || '').trim() : '';

  // 4) Contributors: input > credits area names joined
  var contribEl = document.getElementById('coverContributors');
  var contributors = (contribEl && contribEl.value || '').trim();
  if (!contributors) {
    var names = [];
    document.querySelectorAll('#creditsArea .pe-credit-row .pe-credit-name').forEach(function(el){
      var v = (el.value || '').trim();
      if (v) names.push(v);
    });
    contributors = names.join(' ');
  }

  // 5) Cover SOURCE image for the composite. Uses the decoupled cover
  //    source URL (set by the ◆ gallery picker or the 보조 업로드) so the
  //    generator never re-composites an already-composited cover (which
  //    would stack a second wordmark/title). Falls back to the first
  //    gallery image so the preview still renders on a fresh open.
  var coverUrl = _papCoverSourceUrl || '';
  if (!coverUrl) {
    var firstGalleryImg = document.querySelector('#galleryGrid .pe-gallery-item img');
    if (firstGalleryImg && firstGalleryImg.src) coverUrl = firstGalleryImg.src;
  }

  return {
    issueLabel: issueLabel,
    yearLabel:  yearLabel,
    title:      title,
    contributors: contributors,
    coverUrl:   coverUrl,
  };
}

function _papCoverSetStatus(msg, kind){
  var el = document.getElementById('coverGenStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = (kind === 'error') ? '#c62828'
                : (kind === 'ok')    ? '#16a34a'
                :                      'var(--text3)';
}

// Same image cache as the IG editor uses, so re-rendering the cover
// doesn't re-fetch the source from S3 every time.
async function _papCoverLoadImage(url){
  if (!url) throw new Error('커버 이미지가 없습니다. 커버 이미지 업로드 또는 갤러리에 이미지를 추가해주세요.');
  if (typeof _papInstaImageCache !== 'undefined' && _papInstaImageCache[url]) {
    return _papInstaImageCache[url];
  }
  return new Promise(function(res, rej){
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = function(){ res(img); };
    img.onerror = function(){
      // Retry without crossOrigin so a missing CORS header doesn't fail
      // the preview entirely (export may taint but at least the editor
      // can SEE what they're laying out).
      var fb = new Image();
      fb.onload  = function(){ res(fb); };
      fb.onerror = function(){ rej(new Error('커버 이미지 로드 실패')); };
      fb.src = url;
    };
    img.src = url;
  });
}

// Word-wrap helper. Splits `text` into lines that fit within `maxWidth`
// at the current ctx font. Used for long titles + contributor lines.
function _papCoverWrap(ctx, text, maxWidth){
  var words = String(text || '').split(/\s+/).filter(Boolean);
  var lines = [];
  var cur = '';
  for (var i = 0; i < words.length; i++) {
    var probe = cur ? (cur + ' ' + words[i]) : words[i];
    if (ctx.measureText(probe).width > maxWidth && cur) {
      lines.push(cur);
      cur = words[i];
    } else {
      cur = probe;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function _papCoverComposite(canvas, meta){
  var ctx = canvas.getContext('2d');
  var W = _PAP_COVER_W, H = _PAP_COVER_H;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, W, H);

  // 1) Cover-fit the source image to fill the canvas (4:5).
  var img = await _papCoverLoadImage(meta.coverUrl);
  var iw = img.naturalWidth, ih = img.naturalHeight;
  var scale = Math.max(W / iw, H / ih);
  var dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

  // 2) Subtle bottom gradient so the title text reads cleanly even on
  //    bright covers. Quarter-canvas darkening; doesn't touch the top
  //    where Issue/Year/PAP logo live (those usually sit on bright skin/
  //    background pixels and stay legible without help).
  var grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  // Tiny top gradient too — Issue/Year/PAP logo can sit on bright sky
  // backgrounds where pure white is washed out.
  var gradTop = ctx.createLinearGradient(0, 0, 0, H * 0.2);
  gradTop.addColorStop(0, 'rgba(0,0,0,0.25)');
  gradTop.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradTop;
  ctx.fillRect(0, 0, W, H * 0.2);

  // QA #266 — read fine-tune slider values once for this composite.
  var sty = _papCoverReadStyleOpts();

  // 3) Top-left: Issue label (white sans). QA #267 — position from sliders.
  ctx.fillStyle = '#ffffff';
  ctx.font = '400 ' + sty.topLabelSize + 'px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(meta.issueLabel, sty.topLabelSide, sty.topLabelTop);

  // 4) Top-right: Year label
  ctx.textAlign = 'right';
  ctx.fillText(meta.yearLabel, W - sty.topLabelSide, sty.topLabelTop);

  // 5) Left edge (rotated 90°): "Published by Domenico Kang".
  // QA #267 — Y position from slider (% canvas height).
  ctx.save();
  ctx.translate(38, H * (sty.sideLabelY / 100));
  ctx.rotate(-Math.PI / 2);
  ctx.font = '400 ' + sty.sideLabelSize + 'px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Published by Domenico Kang', 0, 0);
  ctx.restore();

  // 6) Top-center: PAP wordmark logo with optional 3D shadow.
  //    Reuse the editor's persisted logo (custom in localStorage OR
  //    factory default /pap-logo-white.png) — same source as IG.
  //
  //    QA #266 — drop-shadow on the logo creates the "popping out of
  //    the page" look the user spotted on real PAP covers. Intensity is
  //    slider-controlled (0% = flat, 100% = strongly raised).
  try {
    if (typeof _papInstaLoadLogo === 'function') {
      var logo = await _papInstaLoadLogo();
      var lw = W * (sty.logoSize / 100);
      var lh = lw * (logo.naturalHeight / logo.naturalWidth);
      var lx = (W - lw) / 2;
      var ly = H * (sty.logoTop / 100);
      if (sty.logoShadow > 0) {
        ctx.save();
        // Shadow intensity scaling: at 50% slider → alpha 0.4 / blur 14 /
        // offset 7. Tweaked so 35% (default) feels like the magazine
        // examples — visible but not heavy.
        var sAlpha   = (sty.logoShadow / 100) * 0.65;
        var sBlur    = (sty.logoShadow / 100) * 28;
        var sOffsetY = (sty.logoShadow / 100) * 12;
        ctx.shadowColor   = 'rgba(0, 0, 0, ' + sAlpha.toFixed(3) + ')';
        ctx.shadowBlur    = sBlur;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = sOffsetY;
        ctx.drawImage(logo, lx, ly, lw, lh);
        ctx.restore();
      } else {
        ctx.drawImage(logo, lx, ly, lw, lh);
      }
    }
  } catch(_){ /* logo failed; skip silently */ }

  // 7) Bottom-center: italic serif title (size from slider).
  var titleSize = sty.titleSize;
  ctx.font = 'italic 400 ' + titleSize + 'px "Times New Roman", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  var titleMaxW = W - 100;
  var titleLines = _papCoverWrap(ctx, meta.title || '', titleMaxW);
  // If title is very long the wrap might produce >2 lines; shrink the
  // font incrementally until it fits in 2 lines max.
  while (titleLines.length > 2 && titleSize > 36) {
    titleSize -= 6;
    ctx.font = 'italic 400 ' + titleSize + 'px "Times New Roman", Georgia, serif';
    titleLines = _papCoverWrap(ctx, meta.title || '', titleMaxW);
  }
  // Contributors size from slider, with same wrap-and-shrink fallback.
  var contribSize = sty.contribSize;
  ctx.font = 'italic 400 ' + contribSize + 'px "Times New Roman", Georgia, serif';
  var contribMaxW = W - 100;
  var contribLines = _papCoverWrap(ctx, meta.contributors || '', contribMaxW);
  if (contribLines.length > 2) {
    while (contribLines.length > 2 && contribSize > 16) {
      contribSize -= 2;
      ctx.font = 'italic 400 ' + contribSize + 'px "Times New Roman", Georgia, serif';
      contribLines = _papCoverWrap(ctx, meta.contributors || '', contribMaxW);
    }
  }

  // QA #267 — contributors and title now use INDEPENDENT position
  // anchors so editor can move them separately:
  //   contribY (baseline of LAST contributor line) = H - bottomPad
  //   titleY  (baseline of LAST title line)        = H - (titleBottom% × H)
  // Both draw bottom-up from their baseline. Editor is responsible for
  // keeping them from overlapping (they can see it live in the preview).
  ctx.font = 'italic 400 ' + contribSize + 'px "Times New Roman", Georgia, serif';
  var bottomPad = sty.bottomPad;
  var lineGap = 6;
  var contribY = H - bottomPad;
  for (var c = contribLines.length - 1; c >= 0; c--) {
    ctx.fillText(contribLines[c], W / 2, contribY);
    contribY -= (contribSize + lineGap);
  }
  // Title uses its own anchor (titleBottom% from bottom).
  var titleY = H - (H * (sty.titleBottom / 100));
  ctx.font = 'italic 400 ' + titleSize + 'px "Times New Roman", Georgia, serif';
  for (var t = titleLines.length - 1; t >= 0; t--) {
    ctx.fillText(titleLines[t], W / 2, titleY);
    titleY -= (titleSize + 8);
  }
}

// QA #268 — Live preview wiring.
//   1. Inline canvas under the cover gen section that always shows the
//      current state (no modal needed).
//   2. Debounced re-render on EVERY form/slider input change.
//   3. The modal version (👁️ 미리보기 button) still works the same way
//      but it now also auto-syncs when sliders change while open.
var _papCoverLiveTimer = null;
var _papCoverLiveRendering = false;
async function _papCoverDoLiveRender(){
  if (_papCoverLiveRendering) return;
  _papCoverLiveRendering = true;
  try {
    var liveCanvas = document.getElementById('coverLivePreviewCanvas');
    var emptyMsg   = document.getElementById('coverLivePreviewEmpty');
    var statusEl   = document.getElementById('coverLivePreviewStatus');
    if (!liveCanvas) { _papCoverLiveRendering = false; return; }
    var meta = _papCoverReadFormMeta();
    // No title or no cover image yet — show placeholder, hide canvas.
    if (!meta.title || !meta.coverUrl) {
      liveCanvas.style.display = 'none';
      if (emptyMsg) emptyMsg.style.display = 'block';
      if (statusEl) statusEl.textContent = '대기 중 (제목 + 커버 이미지 필요)';
      _papCoverLiveRendering = false;
      return;
    }
    liveCanvas.style.display = 'inline-block';
    if (emptyMsg) emptyMsg.style.display = 'none';
    if (statusEl) statusEl.textContent = '렌더 중…';
    await _papCoverComposite(liveCanvas, meta);
    if (statusEl) statusEl.textContent = '✓ 최신 상태';
    // QA #270 — modal sync removed (modal eliminated as redundant).
  } catch (e) {
    console.warn('[cover live] render failed:', e);
    var s = document.getElementById('coverLivePreviewStatus');
    if (s) s.textContent = '⚠️ 렌더 실패';
  }
  _papCoverLiveRendering = false;
}
function _papCoverScheduleLiveRender(){
  if (_papCoverLiveTimer) clearTimeout(_papCoverLiveTimer);
  // 100ms debounce — fast enough to feel live during slider drag,
  // slow enough to avoid hammering the canvas while user types.
  _papCoverLiveTimer = setTimeout(_papCoverDoLiveRender, 100);
}

// Wire once on first interaction with the cover gen section so we don't
// pay the cost on every admin page load.
var _papCoverLiveWired = false;
function _papCoverEnsureLiveWired(){
  if (_papCoverLiveWired) return;
  var section = document.getElementById('coverGenSection');
  if (!section) return;
  // Event delegation — any 'input' or 'change' inside the section triggers
  // a re-render. Catches sliders, text inputs, and the file upload field.
  section.addEventListener('input',  _papCoverScheduleLiveRender);
  section.addEventListener('change', _papCoverScheduleLiveRender);
  // Also trigger when the cover image upload changes (thumbInput sits
  // outside the section, but its preview lives in thumbPreview — we
  // can't easily delegate, so listen directly on the input).
  var thumbInput = document.getElementById('thumbInput');
  if (thumbInput) thumbInput.addEventListener('change', function(){
    // Give previewThumb() a moment to set the <img>.src.
    setTimeout(_papCoverScheduleLiveRender, 200);
  });
  // Title input lives outside too.
  var titleInput = document.getElementById('postTitle');
  if (titleInput) titleInput.addEventListener('input', _papCoverScheduleLiveRender);
  // First render now.
  _papCoverScheduleLiveRender();
  _papCoverLiveWired = true;
}

// Editorial modal might be opened multiple times; wire on each open via
// DOMContentLoaded + click handler.
document.addEventListener('DOMContentLoaded', function(){
  // Set up once the cover section exists in DOM.
  setTimeout(_papCoverEnsureLiveWired, 500);
});

// QA #270 — modal preview removed (live preview canvas in 고급 설정
// panel covers all use cases). Keeping these stubs so any external
// callers (e.g. a stale onclick) don't error out.
function closeCoverPreview(){ /* no-op — modal removed */ }
async function papCoverPreview(){
  // Just trigger a fresh live render so editor sees current state.
  _papCoverEnsureLiveWired();
  var meta = _papCoverReadFormMeta();
  if (!meta.title) {
    alert('에디토리얼 제목이 비어 있습니다. 먼저 제목을 입력해주세요.');
    return;
  }
  if (!meta.coverUrl) {
    alert('커버 이미지가 없습니다. 커버 이미지를 업로드하거나 갤러리에 이미지를 추가해주세요.');
    return;
  }
  _papCoverSetStatus('커버 합성 중…');
  try {
    var canvas = document.getElementById('coverPreviewCanvas');
    await _papCoverComposite(canvas, meta);
    document.getElementById('coverPreviewModal').classList.add('show');
    _papCoverSetStatus('✓ 미리보기 생성 완료', 'ok');
  } catch (e) {
    console.error('[cover] preview failed:', e);
    _papCoverSetStatus('❌ ' + (e && e.message || e), 'error');
    alert('미리보기 합성에 실패했습니다.\n상세: ' + (e && e.message || e));
  }
}

function closeCoverPreview(){
  var m = document.getElementById('coverPreviewModal');
  if (m) m.classList.remove('show');
}

async function papCoverDownload(){
  var meta = _papCoverReadFormMeta();
  if (!meta.title) {
    alert('에디토리얼 제목이 비어 있습니다.');
    return;
  }
  if (!meta.coverUrl) {
    alert('커버 이미지가 없습니다.');
    return;
  }
  _papCoverSetStatus('PNG 변환 중…');
  try {
    // Render at full 1080×1350 (canvas backing buffer = output resolution).
    var canvas = document.createElement('canvas');
    canvas.width  = _PAP_COVER_W;
    canvas.height = _PAP_COVER_H;
    await _papCoverComposite(canvas, meta);
    var blob = await new Promise(function(res){
      canvas.toBlob(function(b){ res(b); }, 'image/png', 1);
    });
    if (!blob) throw new Error('PNG 변환 실패 (canvas tainted by CORS?)');
    var base = (meta.title || 'cover').toLowerCase()
      .replace(/[^a-z0-9가-힯 ]+/g, '').replace(/\s+/g, '-');
    var fname = base + '-cover.png';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 3000);
    // 2026-07-20 (도메니코 요청) — 합성 커버와 함께 "원본 커버 이미지"도 같이
    // 다운로드한다. 실패해도 합성본 다운로드는 이미 끝났으므로 조용히 경고만.
    try {
      _papCoverSetStatus('원본 커버 다운로드 중…');
      var srcBlob;
      if (/^data:/.test(meta.coverUrl)) {
        srcBlob = await (await fetch(meta.coverUrl)).blob();
      } else {
        var r = await fetch(meta.coverUrl, { mode: 'cors' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        srcBlob = await r.blob();
      }
      var ext = (srcBlob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').split('+')[0];
      var a2 = document.createElement('a');
      a2.href = URL.createObjectURL(srcBlob);
      a2.download = base + '-cover-original.' + ext;
      document.body.appendChild(a2);
      a2.click();
      setTimeout(function(){ URL.revokeObjectURL(a2.href); a2.remove(); }, 3000);
      _papCoverSetStatus('✓ 다운로드 완료 — 합성 커버 + 원본 커버 2장 (' + fname + ')', 'ok');
    } catch (e2) {
      console.warn('[cover] original download failed:', e2);
      _papCoverSetStatus('✓ 합성 커버 다운로드 완료 · 원본 커버는 실패 (CORS 제한 가능): ' + (e2 && e2.message || e2), 'ok');
    }
  } catch (e) {
    console.error('[cover] download failed:', e);
    _papCoverSetStatus('❌ ' + (e && e.message || e), 'error');
    alert('다운로드 실패\n상세: ' + (e && e.message || e));
  }
}

// "이 디자인을 커버로 확정" — 라이브 미리보기의 합성 매거진 커버를 실제
// 이미지 파일로 구워 업로드하고, 그 URL 을 cover_image(에디토리얼 상세
// 최상단 hero)로 채택한다. savePost 의 finalCover 는
//   thumbUrl(신규 업로드) || existingCoverUrl(dataset) || finalThumb
// 순이므로, 확정 시 대기 중인 업로드 파일을 비우고 dataset.existingUrl 에
// 합성 커버 URL 을 심어 두면 저장 시 그 합성본이 hero 로 반영된다.
async function papCoverConfirmAsCover(){
  var meta = _papCoverReadFormMeta();
  if (!meta.title) {
    alert('에디토리얼 제목이 비어 있습니다. 먼저 제목을 입력해주세요.');
    return;
  }
  if (!meta.coverUrl) {
    alert('커버 이미지가 없습니다. 화보에서 커버로 쓸 이미지를 ◆ 버튼으로 먼저 선택해주세요.');
    return;
  }
  var btn = document.getElementById('coverConfirmBtn');
  var orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '확정 중…'; }
  _papCoverSetStatus('커버 합성 + 업로드 중…');
  try {
    // Render at full 1080×1350 then upload the PNG blob via the shared
    // media upload endpoint (same path gallery/thumbnail uploads use).
    var canvas = document.createElement('canvas');
    canvas.width  = _PAP_COVER_W;
    canvas.height = _PAP_COVER_H;
    await _papCoverComposite(canvas, meta);
    var blob = await new Promise(function(res, rej){
      canvas.toBlob(function(b){ b ? res(b) : rej(new Error('PNG 변환 실패 (CORS tainted?)')); }, 'image/png', 1);
    });
    var slug = (meta.title || 'cover').toLowerCase()
      .replace(/[^a-z0-9가-힯 ]+/g, '').replace(/\s+/g, '-');
    var file = new File([blob], slug + '-cover.png', { type: 'image/png' });
    var url = await uploadFile(file);
    _papComposedCoverUrl = url;
    // Adopt as cover_image source for savePost.
    var thumbBox  = document.getElementById('thumbUploadBox');
    var thumbPrev = document.getElementById('thumbPreview');
    if (thumbBox) {
      thumbBox.classList.add('has-thumb');
      thumbBox.setAttribute('data-thumb-cleared', '0');
      thumbBox.dataset.existingUrl = url;
    }
    if (thumbPrev) {
      thumbPrev.innerHTML = '<img loading="lazy" src="'+esc(url)+'" style="max-width:200px;max-height:250px;object-fit:cover"><div class="pe-upload-text" style="margin-top:8px">✅ 확정된 커버 — 저장 시 최상단 노출</div>';
    }
    // Clear any pending file upload so finalCover uses the composited URL,
    // not a raw re-upload of thumbInput.files[0].
    var ti = document.getElementById('thumbInput');
    if (ti) { try { ti.value = ''; } catch(_){ } }
    _papCoverSetStatus('✓ 커버 확정 완료 — 저장 시 최상단(hero) 이미지로 반영됩니다', 'ok');
  } catch (e) {
    console.error('[cover] confirm failed:', e);
    _papCoverSetStatus('❌ ' + (e && e.message || e), 'error');
    alert('커버 확정 실패\n상세: ' + (e && e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig || '✅ 이 디자인을 커버로 확정'; }
  }
}

// ═══════════════════════════════════════════════════════════════
// 🟦 부분 모자이크 에디터 (Feature ③)
// 화보 이미지의 특정 영역만 픽셀화한 "검열본"을 canvas 로 구워 uploadFile
// 로 업로드하고, 해당 gallery 이미지의 URL 을 교체한다. 원본은 서버에서
// 삭제하지 않음(참조만 교체) → 공개되는 건 검열본 URL 뿐이라 개발자도구로도
// 원본(외설 부분)이 노출되지 않는다. 저장(savePost) 시 교체된 URL 이
// file_urls/gallery 로 반영된다.
// ═══════════════════════════════════════════════════════════════
var _mosaicNum = null;      // 대상 gallery 이미지 num
var _mosaicImg = null;      // 로드된 원본 Image
var _mosaicRects = [];      // 지정 영역들 (표시 canvas 좌표계)
var _mosaicDrawing = false;
var _mosaicStart = null;    // {x,y}
var _mosaicCur = null;      // 드래그 중 임시 rect
var _mosaicDispScale = 1;   // naturalW / displayW
var _mosaicWired = false;

function _mosaicLoadImage(url){
  return new Promise(function(res, rej){
    var im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload  = function(){ res(im); };
    im.onerror = function(){ rej(new Error('이미지 로드 실패 (CORS?)')); };
    im.src = url;
  });
}

async function openMosaicEditor(num){
  var g = galleryImages.find(function(x){ return x.num === num; });
  if(!g){ alert('이미지를 찾을 수 없습니다.'); return; }
  _mosaicNum = num;
  _mosaicRects = [];
  _mosaicDrawing = false; _mosaicStart = null; _mosaicCur = null;
  var modal  = document.getElementById('mosaicModal');
  var canvas = document.getElementById('mosaicCanvas');
  var status = document.getElementById('mosaicStatus');
  if(status) status.textContent = '이미지 로딩 중…';
  if(modal) modal.style.display = 'flex';
  try{
    var img = await _mosaicLoadImage(g.src);
    _mosaicImg = img;
    // 표시 크기: 가로 최대 760px 로 스케일다운.
    var dispW = Math.min(img.naturalWidth || 760, 760);
    var dispH = Math.round((img.naturalHeight || dispW) * (dispW / (img.naturalWidth || dispW)));
    canvas.width = dispW; canvas.height = dispH;
    _mosaicDispScale = (img.naturalWidth || dispW) / dispW;
    _mosaicWireCanvas(canvas);
    _mosaicRedraw();
    if(status) status.textContent = '가릴 영역을 드래그하세요 (여러 개 가능)';
  }catch(e){
    if(status) status.textContent = '❌ ' + (e && e.message || e);
    alert('이미지를 불러오지 못했습니다: ' + (e && e.message || e));
  }
}

function closeMosaicEditor(){
  var modal = document.getElementById('mosaicModal');
  if(modal) modal.style.display = 'none';
  _mosaicImg = null; _mosaicRects = []; _mosaicNum = null;
  _mosaicDrawing = false; _mosaicStart = null; _mosaicCur = null;
}

function _mosaicWireCanvas(canvas){
  var strength = document.getElementById('mosaicStrength');
  var slabel   = document.getElementById('mosaicStrengthLabel');
  if(strength && !strength._mosaicWired){
    strength.addEventListener('input', function(){
      if(slabel) slabel.textContent = strength.value;
      _mosaicRedraw();
    });
    strength._mosaicWired = true;
  }
  if(_mosaicWired) return;
  _mosaicWired = true;
  function pos(e){
    var r = canvas.getBoundingClientRect();
    var src = (e.touches && e.touches[0]) ? e.touches[0] : e;
    var cx = src.clientX - r.left, cy = src.clientY - r.top;
    var sx = canvas.width / r.width, sy = canvas.height / r.height;
    return { x: Math.max(0, Math.min(canvas.width,  cx*sx)),
             y: Math.max(0, Math.min(canvas.height, cy*sy)) };
  }
  canvas.addEventListener('mousedown', function(e){ e.preventDefault(); _mosaicStart = pos(e); _mosaicDrawing = true; });
  canvas.addEventListener('mousemove', function(e){ if(!_mosaicDrawing) return; _mosaicCur = _mosaicRectFrom(_mosaicStart, pos(e)); _mosaicRedraw(); });
  window.addEventListener('mouseup', function(){
    if(!_mosaicDrawing) return;
    _mosaicDrawing = false;
    if(_mosaicCur && _mosaicCur.w > 4 && _mosaicCur.h > 4) _mosaicRects.push(_mosaicCur);
    _mosaicCur = null; _mosaicStart = null; _mosaicRedraw();
  });
  canvas.addEventListener('touchstart', function(e){ e.preventDefault(); _mosaicStart = pos(e); _mosaicDrawing = true; }, {passive:false});
  canvas.addEventListener('touchmove',  function(e){ e.preventDefault(); if(!_mosaicDrawing) return; _mosaicCur = _mosaicRectFrom(_mosaicStart, pos(e)); _mosaicRedraw(); }, {passive:false});
  canvas.addEventListener('touchend',   function(){ if(!_mosaicDrawing) return; _mosaicDrawing=false; if(_mosaicCur&&_mosaicCur.w>4&&_mosaicCur.h>4)_mosaicRects.push(_mosaicCur); _mosaicCur=null; _mosaicStart=null; _mosaicRedraw(); });
}

function _mosaicRectFrom(a, b){
  return { x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), w: Math.abs(b.x-a.x), h: Math.abs(b.y-a.y) };
}

function _mosaicReadBlock(){
  var el = document.getElementById('mosaicStrength');
  var v = el ? parseInt(el.value, 10) : 18;
  return isNaN(v) ? 18 : Math.max(4, v);
}

function _mosaicRedraw(){
  var canvas = document.getElementById('mosaicCanvas');
  if(!canvas || !_mosaicImg) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(_mosaicImg, 0, 0, canvas.width, canvas.height);
  // 확정된 영역 = 실제 픽셀화 미리보기(표시 스케일에 맞춘 블록)
  var dispBlock = Math.max(3, Math.round(_mosaicReadBlock() / _mosaicDispScale));
  _mosaicRects.forEach(function(r){ _pixelateRect(ctx, r.x, r.y, r.w, r.h, dispBlock); });
  // 드래그 중 임시 영역 = 파란 오버레이
  if(_mosaicCur){
    ctx.save();
    ctx.fillStyle = 'rgba(31,111,235,.35)';
    ctx.strokeStyle = 'rgba(31,111,235,.95)';
    ctx.lineWidth = 2;
    ctx.fillRect(_mosaicCur.x, _mosaicCur.y, _mosaicCur.w, _mosaicCur.h);
    ctx.strokeRect(_mosaicCur.x, _mosaicCur.y, _mosaicCur.w, _mosaicCur.h);
    ctx.restore();
  }
}

// 지정 영역을 블록 단위로 픽셀화. ctx 에 이미 그려진 픽셀을 축소→확대해
// 블록모자이크를 만든다(같은 canvas 를 소스로 읽는 것은 허용됨).
function _pixelateRect(ctx, x, y, w, h, block){
  x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
  if(w<1||h<1) return;
  var sw = Math.max(1, Math.round(w/block));
  var sh = Math.max(1, Math.round(h/block));
  var tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  var tctx = tmp.getContext('2d');
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

function mosaicUndo(){ _mosaicRects.pop(); _mosaicRedraw(); }
function mosaicClearRects(){ _mosaicRects = []; _mosaicRedraw(); }

async function applyMosaic(){
  if(!_mosaicImg) return;
  if(!_mosaicRects.length){ alert('가릴 영역을 최소 1개 이상 드래그해주세요.'); return; }
  var g = galleryImages.find(function(x){ return x.num === _mosaicNum; });
  if(!g){ alert('대상 이미지를 찾을 수 없습니다.'); return; }
  var btn    = document.getElementById('mosaicApplyBtn');
  var status = document.getElementById('mosaicStatus');
  var orig = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = '처리 중…'; }
  if(status) status.textContent = '검열본 합성 + 업로드 중…';
  try{
    // 원본 해상도로 검열본을 굽는다.
    var full = document.createElement('canvas');
    full.width  = _mosaicImg.naturalWidth  || _mosaicImg.width;
    full.height = _mosaicImg.naturalHeight || _mosaicImg.height;
    var fctx = full.getContext('2d');
    fctx.drawImage(_mosaicImg, 0, 0, full.width, full.height);
    var block = _mosaicReadBlock();
    _mosaicRects.forEach(function(r){
      // 표시 좌표 → 원본 좌표
      _pixelateRect(fctx, r.x*_mosaicDispScale, r.y*_mosaicDispScale, r.w*_mosaicDispScale, r.h*_mosaicDispScale, block);
    });
    var blob = await new Promise(function(res, rej){
      full.toBlob(function(b){ b ? res(b) : rej(new Error('이미지 변환 실패 (CORS tainted?)')); }, 'image/jpeg', 0.92);
    });
    var fname = 'mosaic-' + _mosaicNum + '-' + blob.size + '.jpg';
    var file = new File([blob], fname, { type: 'image/jpeg' });
    var url = await uploadFile(file);
    // gallery 이미지 URL 교체 (원본은 서버에서 삭제하지 않음, 참조만 교체).
    g.src = url; g.isUrl = true; g.file = null;
    var card = document.querySelector('.pe-gallery-item[data-img-num="'+_mosaicNum+'"]');
    if(card){ var im = card.querySelector('img'); if(im) im.src = url; }
    // 이 이미지가 커버 소스였다면 커버 소스도 검열본으로 갱신.
    if(galleryCoverNum === _mosaicNum){
      _papCoverSourceUrl = url;
      _papComposedCoverUrl = null;
      var tb = document.getElementById('thumbUploadBox');
      if(tb) tb.dataset.existingUrl = url;
      if(typeof _papCoverScheduleLiveRender==='function') _papCoverScheduleLiveRender();
    }
    if(status) status.textContent = '✓ 완료';
    closeMosaicEditor();
    alert('모자이크 적용 완료 — 검열본이 이 화보를 대체했습니다.\n"저장"을 눌러야 발행본에 반영됩니다.');
  }catch(e){
    console.error('[mosaic] apply failed:', e);
    if(status) status.textContent = '❌ ' + (e && e.message || e);
    alert('모자이크 적용 실패\n상세: ' + (e && e.message || e));
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = orig || '✅ 적용 + 저장'; }
  }
}

function toggleFilmSchedule(){
  var pubCb   = document.getElementById('filmPublishCb');
  var schedCb = document.getElementById('filmScheduleCb');
  var mode = 'published';
  if (schedCb && schedCb.checked) {
    mode = 'scheduled';
    // Per editorial UX (QA #127): selecting 예약 always implies the row
    // will go public when the time hits. Force the 공개 checkbox on so
    // the editor's mental model stays correct ("예약 = scheduled-public").
    if (pubCb) pubCb.checked = true;
  } else if (pubCb && !pubCb.checked) {
    mode = 'draft';
  }
  // Sync hidden radios so the rest of pap-admin.js reads the right mode.
  ['published', 'draft', 'scheduled'].forEach(function(m){
    var r = document.getElementById('filmPublishMode_' + m);
    if (r) r.checked = (m === mode);
  });
  // Show / hide the 예약 일시 area.
  var area = document.getElementById('filmScheduleArea');
  if (area) area.style.display = (mode === 'scheduled') ? '' : 'none';
}

// QA #253 — 발행 날짜 helpers, mirroring the editorial / news pair
// (_setPublishDateNow / _clearPublishDate). Decouples the file the
// user is editing from the timestamp the row claims to have been
// published, so editors can back-date or future-date the display date
// without touching the publish workflow.
function _setFilmPublishDateNow(){
  var d = new Date();
  var p = function(n){ return n < 10 ? '0' + n : '' + n; };
  var dEl = document.getElementById('filmPublishDate');
  var tEl = document.getElementById('filmPublishTime');
  if (dEl) dEl.value = d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
  if (tEl) tEl.value = p(d.getHours()) + ':' + p(d.getMinutes());
}
function _clearFilmPublishDate(){
  var dEl = document.getElementById('filmPublishDate');
  var tEl = document.getElementById('filmPublishTime');
  if (dEl) dEl.value = '';
  if (tEl) tEl.value = '';
}

async function saveFilm(forceStatus){
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

  // QA #253 — published_date now sources from the dedicated 발행 날짜
  // pair (#filmPublishDate + #filmPublishTime) so it can carry a full
  // timestamp like the editorial / news pattern. Falls back to:
  //   1. the legacy `#filmDate` input (if present, kept for backwards
  //      compatibility with rows that still mirror it on hydrate);
  //   2. today's date — saved as a YYYY-MM-DD slice so the column stays
  //      compatible with whichever pre-existing data type lived there.
  var _pubDateEl = document.getElementById('filmPublishDate');
  var _pubTimeEl = document.getElementById('filmPublishTime');
  var pubDate;
  if (_pubDateEl && _pubDateEl.value) {
    var _t = (_pubTimeEl && _pubTimeEl.value) ? _pubTimeEl.value : '00:00';
    // Use the explicit date + time, normalised to ISO UTC.
    var _local = new Date(_pubDateEl.value + 'T' + _t);
    pubDate = isNaN(_local.getTime())
      ? _pubDateEl.value
      : _local.toISOString();
  } else {
    var _legacyDateEl = document.getElementById('filmDate');
    pubDate = (_legacyDateEl && _legacyDateEl.value)
      ? _legacyDateEl.value
      : new Date().toISOString().slice(0,10);
  }

  // Credits — same shape the editorial form serializes. Empty rows skipped.
  // QA #306 — '에디토리얼과 동일' 모드일 때는 필름 credits 를 빈 배열로
  // 저장. 필름 상세 렌더링 시 pap-content-film.js 가 related_editorial 의
  // credits 로 자동 fallback (필름.credits.length === 0 조건).
  var credits = [];
  var _creditsModeEl = document.querySelector('input[name="filmCreditsMode"]:checked');
  var _creditsMode = _creditsModeEl ? _creditsModeEl.value : 'direct';
  if (_creditsMode === 'direct') {
    document.querySelectorAll('#filmCreditsArea .pe-credit-row').forEach(function(row){
      var nameEl = row.querySelector('.pe-credit-name');
      var igEl   = row.querySelector('.pe-credit-ig');
      var roles  = _readCreditRoles(row);
      var nameVal = (nameEl && nameEl.value || '').trim();
      if (roles.length > 0 && nameVal) {
        credits.push({ roles: roles, name: nameVal, instagram: (igEl && igEl.value || '').trim() });
      }
    });
  }
  // '에디토리얼과 동일' 모드에서 관련 에디토리얼 미선택 시 경고.
  if (_creditsMode === 'inherit') {
    var _relEd = (document.getElementById('filmRelatedEditorial') || {}).value || '';
    if (!_relEd) {
      alert('크레딧 모드가 "에디토리얼과 동일"로 설정됐지만 상단의 연결 에디토리얼이 비어 있습니다.\n에디토리얼을 먼저 선택하거나 "직접 입력" 모드로 전환해주세요.');
      return;
    }
  }

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
  // QA #253 — explicit "임시저장" button passes 'draft' to override the
  // unified UI's mode resolution. Mirrors the news editor's
  // saveNewsArticle('draft') entry point.
  if (forceStatus === 'draft') pubMode = 'draft';
  var status, scheduledIso = null;
  if (pubMode === 'draft') {
    status = 'draft';
  } else if (pubMode === 'scheduled') {
    // QA #253 — read the split date + time inputs and combine into an
    // ISO timestamp. Falls back to the legacy #filmScheduledAt
    // datetime-local in case any external caller (or older cached
    // markup) still feeds it.
    var _sDateEl = document.getElementById('filmScheduleDate');
    var _sTimeEl = document.getElementById('filmScheduleTime');
    var schedRaw = '';
    if (_sDateEl && _sDateEl.value) {
      var _st = (_sTimeEl && _sTimeEl.value) ? _sTimeEl.value : '09:00';
      schedRaw = _sDateEl.value + 'T' + _st;
    } else {
      schedRaw = (document.getElementById('filmScheduledAt').value || '').trim();
    }
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

  // QA #250 — Instagram caption (optional). Trim + send null on empty
  // so the API doesn't write "" into the column (matches the IS-NULL
  // semantics editorials.instagram_caption uses for the "needs caption"
  // future-filter).
  var igCapEl = document.getElementById('filmIgCaption');
  var igCaption = igCapEl ? String(igCapEl.value || '').trim() : '';

  // QA #251 — trilingual description (KR / EN / IT). Same null-on-empty
  // semantics as the IG caption.
  var _descEl   = document.getElementById('filmDescription');
  var _descEnEl = document.getElementById('filmDescriptionEn');
  var _descItEl = document.getElementById('filmDescriptionIt');
  var descKr = _descEl   ? String(_descEl.value   || '').trim() : '';
  var descEn = _descEnEl ? String(_descEnEl.value || '').trim() : '';
  var descIt = _descItEl ? String(_descItEl.value || '').trim() : '';

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
    instagram_caption: igCaption || null,
    // QA #251 — three description slots persisted together.
    description:    descKr || null,
    description_en: descEn || null,
    description_it: descIt || null,
  };

  try{
    if(editFilmId){
      await apiPut('/films/'+editFilmId, payload);
      toast('필름이 수정되었습니다.');
    } else {
      await apiPost('/films', payload);
      toast('필름이 등록되었습니다.');
    }
    _papClearDirty();
    closeFilmModal();
    // QA #216 — await the refetch so the list paints fresh data
    // before control returns; otherwise the modal closes onto a stale
    // grid and the editor thinks nothing changed.
    await loadFilmsFromAPI();
  }catch(e){
    toast('저장 실패: ' + (e && e.message ? e.message : '알 수 없는 오류'), { type: 'error' });
  }
}

async function deleteFilm(i){
  if(!films[i])return;
  if(!confirm('"'+films[i].title+'" 을 삭제하시겠습니까?'))return;
  try{await apiDelete('/films/'+films[i].id);films.splice(i,1);renderFilms();alert('삭제되었습니다.');}catch(e){alert('삭제 실패');}
}

// ======== QA #250 — FILM INSTAGRAM CAPTION HELPERS ========
// Template-based caption builder used by the "🔄 템플릿 재조립" button
// in the film modal. Mirrors the editorial caption shape (Photographer
// @x / Style @y / …) but pulls from the film form's title + credits[]
// inputs. No AI hop — the film page already has every structured
// field we need; a deterministic template is faster and predictable.
function _buildFilmIgCaptionTemplate(){
  var titleEl = document.getElementById('filmTitle');
  var title = titleEl ? String(titleEl.value || '').trim() : '';

  // Read credit rows the same way saveFilm does so the template stays
  // in lockstep with what actually gets persisted.
  var lines = [];
  document.querySelectorAll('#filmCreditsArea .pe-credit-row').forEach(function(row){
    var nameEl = row.querySelector('.pe-credit-name');
    var igEl   = row.querySelector('.pe-credit-ig');
    var roles  = (typeof _readCreditRoles === 'function') ? _readCreditRoles(row) : [];
    var nameVal = (nameEl && nameEl.value || '').trim();
    if (!roles.length || !nameVal) return;
    // Handle: prefer the @insta value, else fall back to the display
    // name. Strip leading @ so we add exactly one back.
    var handle = (igEl && igEl.value || '').trim().replace(/^@+/, '');
    var label = handle ? '@' + handle : nameVal;
    roles.forEach(function(role){
      // Capitalise the role for IG ("Director" not "director") so the
      // caption reads like the manually written one.
      var pretty = String(role || '').trim();
      if (!pretty) return;
      pretty = pretty.charAt(0).toUpperCase() + pretty.slice(1);
      lines.push(pretty + ' ' + label);
    });
  });

  var out = '@pap_magazine presents\n\n';
  if (title) out += title + '\n\n';
  if (lines.length) out += lines.join('\n') + '\n';
  return out.trimEnd();
}

function regenerateFilmIgCaption(){
  var el = document.getElementById('filmIgCaption');
  if (!el) return;
  // If the editor has hand-written content, confirm before clobbering
  // — same UX as the editorial regenerate buttons.
  if (el.value && el.value.trim() &&
      !confirm('현재 작성된 캡션을 새로 만든 템플릿으로 덮어쓸까요?')) {
    return;
  }
  el.value = _buildFilmIgCaptionTemplate();
  try { toast('인스타그램 캡션을 다시 만들었습니다.'); } catch(_){}
}

// ======== QA #251 — FILM DESCRIPTION AI TRANSLATION ========
// Sends the current textarea contents (unsaved drafts included) to
// /api/admin/films/:id/translate. Server picks the non-empty slot as
// source, translates into the other two languages, and (when overwrite
// is true) replaces all three. The DB write happens server-side; we
// just hydrate the textareas with the response so editors see the new
// translations immediately and can hit "저장" to persist for future
// loads.
//
// For a brand-new film (no editFilmId), there's no row to UPDATE — we
// surface a clear toast asking the editor to save first. Translating
// against an empty row would produce nothing useful anyway because
// the server reads from the row's current state.
async function aiTranslateFilmDescriptions(overwrite){
  if (!editFilmId){
    try { toast('먼저 필름을 저장한 후 AI 번역을 사용해주세요.', { type:'error' }); }
    catch(_){ alert('먼저 필름을 저장한 후 AI 번역을 사용해주세요.'); }
    return;
  }
  var krEl = document.getElementById('filmDescription');
  var enEl = document.getElementById('filmDescriptionEn');
  var itEl = document.getElementById('filmDescriptionIt');
  var kr = krEl ? String(krEl.value || '').trim() : '';
  var en = enEl ? String(enEl.value || '').trim() : '';
  var it = itEl ? String(itEl.value || '').trim() : '';

  // Pick the source — first non-empty slot in KR → EN → IT priority,
  // matching the server's fallback. This way the server gets whichever
  // unsaved draft the editor just typed, even if the row in DB is
  // still empty.
  var source = null;
  if (kr) source = { text: kr, lang: 'kr' };
  else if (en) source = { text: en, lang: 'en' };
  else if (it) source = { text: it, lang: 'it' };

  if (!source){
    try { toast('번역할 원문이 없습니다. KR / EN / IT 중 하나의 설명을 먼저 입력해주세요.', { type:'error' }); }
    catch(_){ alert('번역할 원문이 없습니다.'); }
    return;
  }

  if (overwrite && (kr || en || it) &&
      !confirm('기존 설명을 덮어쓰며 3개 언어 모두 새로 번역합니다.\n계속할까요?')) {
    return;
  }

  try { toast('🤖 번역 중... (몇 초 걸릴 수 있습니다)'); } catch(_){}
  try {
    var data = await apiPost('/admin/films/' + editFilmId + '/translate', {
      overwrite: !!overwrite,
      source: source,
    });
    if (data){
      if (krEl) krEl.value = data.description    || '';
      if (enEl) enEl.value = data.description_en || '';
      if (itEl) itEl.value = data.description_it || '';
      var filled = [];
      if (data.fieldsUpdated){
        if (data.fieldsUpdated.description)    filled.push('KR');
        if (data.fieldsUpdated.description_en) filled.push('EN');
        if (data.fieldsUpdated.description_it) filled.push('IT');
      }
      var msg = filled.length
        ? '✓ AI 번역 완료: ' + filled.join(', ') + ' 슬롯 업데이트됨'
        : '✓ 모든 슬롯에 이미 내용이 있어 변경되지 않았습니다.';
      try { toast(msg); } catch(_){ alert(msg); }
    }
  } catch(e){
    var emsg = (e && e.message) ? e.message : 'AI 번역에 실패했습니다.';
    try { toast(emsg, { type:'error' }); } catch(_){ alert(emsg); }
  }
}

function copyFilmIgCaption(btn){
  var el = document.getElementById('filmIgCaption');
  if (!el || !el.value) {
    try { toast('복사할 캡션이 없습니다.', { type: 'error' }); } catch(_){ alert('복사할 캡션이 없습니다.'); }
    return;
  }
  var txt = el.value;
  // Modern clipboard API + fallback. The editor's browser is always
  // recent (admin-side tool), but the textarea fallback is cheap.
  var done = function(){
    try { toast('캡션이 클립보드에 복사되었습니다.'); } catch(_){}
    if (btn) {
      var orig = btn.textContent;
      btn.textContent = '✓ 복사됨';
      setTimeout(function(){ btn.textContent = orig; }, 1500);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done).catch(function(){
      el.select(); document.execCommand('copy'); done();
    });
  } else {
    el.select(); document.execCommand('copy'); done();
  }
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

// ======== LOADING IMAGES (QA #310 — real API integration) ========
//
// 기존 addLoadingImg() 는 alert 만 띄우고 하드코딩 S3 URL 을 in-memory
// 배열에 push 하는 순수 mock 이었음. QA #310 에서 다음으로 전환:
//   - GET  /api/admin/loading-images  로 목록 조회
//   - POST /api/admin/loading-images  로 신규 등록 (실제 media upload → URL 저장)
//   - PATCH /api/admin/loading-images 로 활성/비활성/모바일 URL 수정
//   - DELETE /api/admin/loading-images?id= 로 삭제
// 이미지 업로드는 uploadFile() (기존 media/upload) 사용.
// 등록된 이미지는 /api/loading-images public GET 로 공개되어
// pap-splash-loader.js 가 스플래시 오버레이로 렌더.
var loadingImgs = [];

async function _fetchLoadingImgs(){
  try {
    var resp = await apiGet('/admin/loading-images');
    var list = (resp && (resp.data || resp)) || [];
    loadingImgs = Array.isArray(list) ? list : [];
  } catch(e){
    console.warn('[loading-images] fetch failed:', e && e.message);
    loadingImgs = [];
  }
  renderLoadingImgs();
}

// QA #314 — 선택 삭제용 로컬 상태. 렌더 사이에 유지.
var _loadingSelectedIds = new Set();

function renderLoadingImgs(){
  var grid = document.getElementById('loadingGrid');
  if (!grid) return;
  // 존재하지 않는 id 는 선택 목록에서 자동 제거 (fetch 후 반영).
  var currentIds = new Set(loadingImgs.map(function(x){ return x.id; }));
  Array.from(_loadingSelectedIds).forEach(function(id){
    if (!currentIds.has(id)) _loadingSelectedIds.delete(id);
  });
  _updateLoadingBulkBar();

  if (!loadingImgs.length){
    grid.innerHTML = '<div class="pe-hint" style="padding:24px;color:var(--text3)">등록된 로딩 이미지가 없습니다. <strong>+ 새 이미지</strong> 버튼으로 추가해주세요.</div>';
    return;
  }
  grid.innerHTML = '';
  loadingImgs.forEach(function(img, idx){
    var pcUrl = img.image_url_pc || '';
    var mUrl  = img.image_url_mobile || '';
    var active = !!img.is_active;
    var selected = _loadingSelectedIds.has(img.id);
    var card = document.createElement('div');
    card.className = 'loading-img-card';
    card.setAttribute('draggable', 'true');
    card.dataset.id = img.id;
    card.dataset.idx = String(idx);
    card.style.cssText = 'width:180px;background:var(--surface);border:' + (selected ? '2px solid #c0392b' : '1px solid var(--border)') + ';padding:10px;text-align:center;position:relative;cursor:move';
    // QA #312 — 드래그 인디케이터 + 순서 배지.
    // QA #314 — 좌상단에 선택 체크박스 (선택 삭제용), 우하단 삭제 버튼 강화.
    card.innerHTML =
      '<div style="position:absolute;top:6px;left:6px;display:flex;gap:4px;align-items:center;z-index:2">' +
        '<label style="cursor:pointer;background:rgba(0,0,0,.55);padding:3px 6px;border-radius:2px;display:flex;align-items:center;gap:4px" title="선택 삭제용 체크박스">' +
          '<input type="checkbox" ' + (selected ? 'checked' : '') + ' data-id="' + esc(img.id) + '" data-act="select" style="cursor:pointer;margin:0">' +
          '<span style="font-size:10px;font-weight:700;color:#fff">#' + (idx + 1) + '</span>' +
        '</label>' +
      '</div>' +
      '<div style="position:absolute;top:6px;right:6px;font-size:11px;color:var(--text3);pointer-events:none" title="드래그하여 순서 변경">⋮⋮</div>' +
      '<img loading="lazy" src="' + esc(pcUrl) + '" style="width:100%;height:110px;object-fit:cover;margin:8px 0;border:1px solid var(--border);background:#111;pointer-events:none">' +
      '<div style="font-size:10px;font-weight:600;margin-bottom:6px;color:' + (active ? 'var(--green)' : 'var(--red)') + '">' +
        (active ? '✓ 활성' : '✗ 비활성') +
      '</div>' +
      '<div style="font-size:10px;color:var(--text3);margin-bottom:6px">' +
        (mUrl ? '📱 모바일 등록됨' : '📱 모바일 미등록 (PC 이미지 사용)') +
      '</div>' +
      '<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">' +
        '<button class="btn btn-sm" data-id="' + esc(img.id) + '" data-act="edit" title="PC/모바일 이미지 편집 (모달)">✏️ 편집</button>' +
        '<button class="btn btn-sm" data-id="' + esc(img.id) + '" data-act="toggle" title="' + (active ? '비활성화하면 웹사이트에서 노출되지 않습니다' : '활성화하면 웹사이트 스플래시에 노출됩니다') + '">' + (active ? '비활성화' : '활성화') + '</button>' +
        '<button class="btn btn-sm btn-red" data-id="' + esc(img.id) + '" data-act="del" title="이 이미지를 영구 삭제합니다">🗑️ 삭제</button>' +
      '</div>';
    _wireLoadingCardDrag(card);
    grid.appendChild(card);
  });
  // 이벤트 위임 (버튼 클릭 + 체크박스).
  grid.onclick = function(e){
    var btn = e.target.closest('button[data-id]');
    if (btn){
      var id = btn.getAttribute('data-id');
      var act = btn.getAttribute('data-act');
      if (act === 'toggle') _toggleLoadingImg(id);
      else if (act === 'del') _deleteLoadingImg(id);
      else if (act === 'edit') openLoadingImgModal(id);
      else if (act === 'mobile') _pickMobileForLoadingImg(id);
      return;
    }
  };
  grid.onchange = function(e){
    var cb = e.target && e.target.matches && e.target.matches('input[type="checkbox"][data-act="select"]') ? e.target : null;
    if (!cb) return;
    var id = cb.getAttribute('data-id');
    if (cb.checked) _loadingSelectedIds.add(id);
    else _loadingSelectedIds.delete(id);
    renderLoadingImgs();
  };
}

// QA #314 — 상단 선택 삭제 bar 표시/갱신.
// 선택된 카드가 1개 이상이면 표시, 0개면 숨김.
function _updateLoadingBulkBar(){
  var bar = document.getElementById('loadingBulkBar');
  if (!bar) return;
  var count = _loadingSelectedIds.size;
  if (count === 0){
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  var countEl = document.getElementById('loadingBulkCount');
  if (countEl) countEl.textContent = String(count);
}

function _loadingBulkClear(){
  _loadingSelectedIds.clear();
  renderLoadingImgs();
}

async function _loadingBulkDelete(){
  var ids = Array.from(_loadingSelectedIds);
  if (!ids.length) return;
  // 삭제 대상 이미지 데이터 미리 수집 (다이얼로그 표시용).
  var targets = ids.map(function(id){
    return loadingImgs.filter(function(x){ return x.id === id; })[0];
  }).filter(Boolean);
  var msg = '⚠️ 선택한 로딩 이미지 ' + targets.length + '개를 영구 삭제합니다.\n\n';
  targets.forEach(function(t, i){
    var order = loadingImgs.indexOf(t) + 1;
    msg += (i + 1) + '. #' + order + (t.is_active ? ' (활성)' : ' (비활성)') + ' — ' + (t.alt_text || '이름 없음') + '\n';
  });
  msg += '\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?';
  if (!confirm(msg)) return;

  var statusEl = document.getElementById('loadingUploadStatus');
  function setStatus(m, kind){
    if (!statusEl) return;
    statusEl.textContent = m || '';
    statusEl.style.color = kind === 'error' ? '#c0392b' : (kind === 'ok' ? '#27ae60' : 'var(--text3)');
  }

  var successCount = 0;
  var failures = [];
  for (var i = 0; i < ids.length; i++){
    setStatus('삭제 중… (' + (i + 1) + ' / ' + ids.length + ')');
    try {
      var resp = await apiDelete('/admin/loading-images?id=' + encodeURIComponent(ids[i]));
      if (resp && resp.message && !resp.ok){
        throw new Error(resp.message);
      }
      successCount++;
    } catch(e){
      console.error('[loading-images] bulk delete failed for', ids[i], e);
      failures.push({ id: ids[i], reason: _extractLoadingErrReason(e) });
    }
  }
  _loadingSelectedIds.clear();
  await _fetchLoadingImgs();
  if (!failures.length){
    setStatus('✓ ' + successCount + '개 이미지가 삭제되었습니다.', 'ok');
    setTimeout(function(){ setStatus(''); }, 3000);
  } else {
    setStatus(successCount + '개 삭제 완료 · 실패 ' + failures.length + '개', 'error');
    var errMsg = '❌ 일부 이미지 삭제 실패\n\n성공: ' + successCount + '개\n실패: ' + failures.length + '개\n\n';
    failures.forEach(function(f, i){ errMsg += (i + 1) + '. → ' + f.reason + '\n'; });
    errMsg += '\n잠시 후 다시 시도해주세요.';
    alert(errMsg);
  }
}

// QA #312 — 카드 하나에 드래그 리스너 부착.
//   dragstart : source idx 를 dataTransfer 에 저장 + 원본 카드 반투명
//   dragover  : 다른 카드 위에서 drop 허용 + 하이라이트 outline
//   dragleave : outline 제거
//   drop      : 배열 재정렬 + 서버 저장 + 재렌더
// text/plain 을 사용하는 이유는 커스텀 MIME 을 거부하는 브라우저 회피
// (예: Safari 일부 버전). 커버/뉴스 블록에서 이미 검증된 패턴 재사용.
function _wireLoadingCardDrag(card){
  card.addEventListener('dragstart', function(e){
    var idx = card.dataset.idx || '';
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch(_){}
    card.style.opacity = '0.4';
    // grid drop zone 하이라이트가 겹치지 않게 dropZone dragover 를 잠깐 무시.
    var zone = document.getElementById('loadingDropZone');
    if (zone) zone.dataset.dragging = '1';
  });
  card.addEventListener('dragend', function(){
    card.style.opacity = '';
    var zone = document.getElementById('loadingDropZone');
    if (zone) delete zone.dataset.dragging;
    // 모든 카드의 outline 클리어.
    var all = document.querySelectorAll('.loading-img-card');
    all.forEach(function(c){ c.style.outline = ''; c.style.outlineOffset = ''; });
  });
  card.addEventListener('dragover', function(e){
    // 내부 카드 간 이동일 때만 preventDefault (파일 드롭은 dropzone 이 처리)
    var hasDragging = document.getElementById('loadingDropZone');
    if (hasDragging && hasDragging.dataset.dragging === '1'){
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch(_){}
      card.style.outline = '2px solid var(--text)';
      card.style.outlineOffset = '-2px';
    }
  });
  card.addEventListener('dragleave', function(){
    card.style.outline = '';
    card.style.outlineOffset = '';
  });
  card.addEventListener('drop', async function(e){
    var zone = document.getElementById('loadingDropZone');
    if (!zone || zone.dataset.dragging !== '1') return; // 파일 드롭은 zone 이 처리
    e.preventDefault();
    e.stopPropagation();
    card.style.outline = '';
    card.style.outlineOffset = '';
    var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    var to = parseInt(card.dataset.idx || '-1', 10);
    if (isNaN(from) || isNaN(to) || from === to || from < 0 || to < 0) return;
    if (from >= loadingImgs.length || to >= loadingImgs.length) return;
    // 로컬 배열 재정렬.
    var moved = loadingImgs.splice(from, 1)[0];
    loadingImgs.splice(to, 0, moved);
    // 즉시 renumber + 재렌더 (낙관적 업데이트)
    loadingImgs.forEach(function(x, i){ x.sort_order = i; });
    renderLoadingImgs();
    await _saveLoadingImgOrder();
  });
}

// QA #312 — 순서 저장. 서버에 각 이미지의 새 sort_order 를 PATCH.
// 배치 크기가 작아 (보통 ≤10) 순차 호출로 충분. 실패 시 rollback
// 대신 다음 fetch 로 서버 상태를 재동기화 (편집 도중 다른 세션이
// 개입하는 케이스도 자연스럽게 해소).
async function _saveLoadingImgOrder(){
  var statusEl = document.getElementById('loadingUploadStatus');
  function setStatus(msg, isError){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#c0392b' : 'var(--text3)';
  }
  setStatus('순서 저장 중…');
  var failed = 0;
  for (var i = 0; i < loadingImgs.length; i++){
    var img = loadingImgs[i];
    try {
      await apiPatch('/admin/loading-images', { id: img.id, sort_order: i });
    } catch(e){
      console.error('[loading-images] reorder patch failed:', img.id, e);
      failed++;
    }
  }
  if (failed){
    setStatus('순서 저장 부분 실패 (' + failed + '개)', true);
    // 실패가 있으면 서버와 재동기화.
    await _fetchLoadingImgs();
  } else {
    setStatus('✓ 순서가 저장되었습니다.');
    setTimeout(function(){ setStatus(''); }, 2000);
  }
}

// QA #319 — '+ 새 이미지' 는 이제 모달을 연다. PC 와 모바일 이미지를
// 각각 개별 업로드할 수 있는 구조.
function addLoadingImg(){
  openLoadingImgModal(null);
}

// QA #319 — 로딩 이미지 등록/편집 모달.
// id 가 있으면 편집 모드로 기존 값 사전 채움.
function openLoadingImgModal(id){
  var target = id ? loadingImgs.filter(function(x){ return x.id === id; })[0] : null;
  document.getElementById('loadImgId').value = target ? target.id : '';
  document.getElementById('loadImgUrlPc').value = target ? (target.image_url_pc || '') : '';
  document.getElementById('loadImgUrlMobile').value = target ? (target.image_url_mobile || '') : '';
  document.getElementById('loadImgAltText').value = target ? (target.alt_text || '') : '';
  document.getElementById('loadImgActive').checked = target ? !!target.is_active : true;
  document.getElementById('loadImgModalTitle').textContent = target ? ('로딩 이미지 편집 — #' + (loadingImgs.indexOf(target) + 1)) : '새 로딩 이미지';
  document.getElementById('loadImgPcStatus').textContent = '';
  document.getElementById('loadImgMobileStatus').textContent = '';
  var errEl = document.getElementById('loadImgFormError');
  if (errEl){ errEl.style.display = 'none'; errEl.textContent = ''; }
  // 프리뷰 세팅
  var pcPrev = document.getElementById('loadImgPcPreview');
  var mPrev  = document.getElementById('loadImgMobilePreview');
  if (target && target.image_url_pc){
    pcPrev.innerHTML = _loadImgPreviewHtml(target.image_url_pc, '16 / 9');
  } else {
    pcPrev.innerHTML = '<div style="font-size:32px;line-height:1;margin-bottom:8px">🖼️</div>'
                    + '<div style="font-size:12px;color:var(--text2);font-weight:600">클릭 또는 파일 드롭</div>'
                    + '<div style="font-size:10px;color:var(--text3);margin-top:4px">JPG · PNG · WEBP · 최대 3MB</div>';
  }
  if (target && target.image_url_mobile){
    mPrev.innerHTML = _loadImgPreviewHtml(target.image_url_mobile, '9 / 16');
  } else {
    mPrev.innerHTML = '<div style="font-size:32px;line-height:1;margin-bottom:8px">📱</div>'
                   + '<div style="font-size:12px;color:var(--text2);font-weight:600">클릭 또는 파일 드롭</div>'
                   + '<div style="font-size:10px;color:var(--text3);margin-top:4px">JPG · PNG · WEBP · 최대 3MB</div>';
  }
  // 파일 input 리셋 (같은 파일 다시 선택 가능)
  var pcInput = document.getElementById('loadImgPcFile'); if (pcInput) pcInput.value = '';
  var mInput  = document.getElementById('loadImgMobileFile'); if (mInput) mInput.value = '';
  _setupLoadingImgModalDrag();
  var modal = document.getElementById('loadingImgModal');
  modal.style.display = 'flex';
  modal.classList.add('show');
}

function closeLoadingImgModal(){
  var modal = document.getElementById('loadingImgModal');
  modal.classList.remove('show');
  modal.style.display = 'none';
}

function _loadImgPreviewHtml(url, aspect){
  return '<img src="' + esc(url) + '" style="width:100%;max-height:140px;aspect-ratio:' + aspect + ';object-fit:cover;border-radius:2px;background:#111">'
       + '<div style="font-size:10px;color:var(--text3);margin-top:6px">클릭하여 변경</div>';
}

// 모달 drop 영역 setup (모달 열 때마다 idempotent).
function _setupLoadingImgModalDrag(){
  ['pc','mobile'].forEach(function(kind){
    var zone = document.getElementById(kind === 'pc' ? 'loadImgPcDrop' : 'loadImgMobileDrop');
    if (!zone || zone.dataset.dndSetup === '1') return;
    zone.dataset.dndSetup = '1';
    zone.addEventListener('dragover', function(e){
      if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.items || [], function(it){ return it.kind === 'file'; })){
        e.preventDefault();
        zone.style.borderColor = 'var(--text)';
        zone.style.background = 'rgba(255,255,255,.05)';
      }
    });
    zone.addEventListener('dragleave', function(e){
      if (e.target === zone){
        zone.style.borderColor = '';
        zone.style.background = '';
      }
    });
    zone.addEventListener('drop', async function(e){
      e.preventDefault();
      zone.style.borderColor = '';
      zone.style.background = '';
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      // 첫 파일만 사용 (모달은 개별 슬롯).
      var fakeInput = { files: [files[0]], value: '' };
      await _onLoadingImgFile(fakeInput, kind);
    });
  });
}

// 파일 선택/드롭 → 검증 → uploadFile → hidden URL 필드 세팅 + 프리뷰.
async function _onLoadingImgFile(input, kind){
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var statusId  = kind === 'pc' ? 'loadImgPcStatus'  : 'loadImgMobileStatus';
  var urlId     = kind === 'pc' ? 'loadImgUrlPc'    : 'loadImgUrlMobile';
  var previewId = kind === 'pc' ? 'loadImgPcPreview' : 'loadImgMobilePreview';
  var aspect    = kind === 'pc' ? '16 / 9' : '9 / 16';
  var statusEl = document.getElementById(statusId);
  function setStatus(msg, kind2){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = kind2 === 'error' ? '#c0392b' : (kind2 === 'ok' ? '#27ae60' : 'var(--text3)');
  }
  var v = _validateLoadingImg(file);
  if (!v.ok){
    setStatus('⚠ ' + v.reason, 'error');
    try { input.value = ''; } catch(_){}
    return;
  }
  setStatus('업로드 중…');
  try {
    var url = await uploadFile(file);
    if (!url) throw new Error('업로드 서버 응답에 URL 이 없습니다.');
    document.getElementById(urlId).value = url;
    var prev = document.getElementById(previewId);
    if (prev) prev.innerHTML = _loadImgPreviewHtml(url, aspect);
    setStatus('✓ 업로드 완료', 'ok');
  } catch(e){
    console.error('[loading-images] modal upload failed:', e);
    setStatus('업로드 실패: ' + (e && e.message || e), 'error');
  }
}

// 모달의 저장 버튼.
async function saveLoadingImgFromModal(){
  var id = (document.getElementById('loadImgId').value || '').trim();
  var urlPc     = (document.getElementById('loadImgUrlPc').value || '').trim();
  var urlMobile = (document.getElementById('loadImgUrlMobile').value || '').trim();
  var altText   = (document.getElementById('loadImgAltText').value || '').trim();
  var isActive  = !!document.getElementById('loadImgActive').checked;
  var errEl = document.getElementById('loadImgFormError');
  function showError(msg){
    if (!errEl) return;
    errEl.style.display = 'block';
    errEl.textContent = msg;
  }
  if (errEl){ errEl.style.display = 'none'; errEl.textContent = ''; }
  if (!urlPc){
    showError('⚠️ PC 이미지는 필수입니다. 좌측 영역에 이미지를 업로드해주세요.');
    return;
  }
  try {
    var resp;
    if (id){
      resp = await apiPatch('/admin/loading-images', {
        id: id,
        image_url_pc: urlPc,
        image_url_mobile: urlMobile || null,
        alt_text: altText || null,
        is_active: isActive
      });
    } else {
      var maxOrder = loadingImgs.reduce(function(m, x){ return Math.max(m, x.sort_order || 0); }, -1);
      resp = await apiPost('/admin/loading-images', {
        image_url_pc: urlPc,
        image_url_mobile: urlMobile || null,
        alt_text: altText || null,
        sort_order: maxOrder + 1,
        is_active: isActive
      });
    }
    if (resp && resp.message && !resp.data){
      throw new Error(_extractLoadingErrReason(resp));
    }
    closeLoadingImgModal();
    await _fetchLoadingImgs();
    var statusEl = document.getElementById('loadingUploadStatus');
    if (statusEl){
      statusEl.textContent = '✓ ' + (id ? '수정' : '등록') + ' 완료 · 웹사이트에 최대 30초 내 반영';
      statusEl.style.color = '#27ae60';
      setTimeout(function(){ statusEl.textContent = ''; }, 5000);
    }
  } catch(e){
    console.error('[loading-images] modal save failed:', e);
    showError('❌ ' + _extractLoadingErrReason(e));
  }
}

// 카드의 "편집" 버튼에서 호출. openLoadingImgModal 을 래핑.
function editLoadingImg(id){
  openLoadingImgModal(id);
}

// QA #313 — 지원 형식/용량 상수. 안내 카드와 실제 검증이 항상 일치하도록
// 상단에 단일 진실원(single source of truth) 로 정의.
var LOADING_IMG_ALLOWED_TYPES  = ['image/jpeg', 'image/png', 'image/webp'];
var LOADING_IMG_ALLOWED_LABELS = 'JPG, PNG, WEBP';
var LOADING_IMG_MAX_BYTES      = 3 * 1024 * 1024; // 3MB

// 사전 검증: 파일이 로딩 이미지 요건을 만족하는지 체크.
// 각 실패 사유는 사용자 친화적인 한국어 메시지 + 실측치 (크기 등) 포함.
function _validateLoadingImg(f){
  if (!f) return { ok: false, reason: '파일이 비어 있습니다.' };
  var name = f.name || 'unknown';
  // 형식 체크: MIME 우선, 확장자는 fallback.
  var type = String(f.type || '').toLowerCase();
  if (type && LOADING_IMG_ALLOWED_TYPES.indexOf(type) === -1){
    return { ok: false, reason: '지원하지 않는 형식입니다. (' + (type || '알 수 없음') + ' · ' + LOADING_IMG_ALLOWED_LABELS + ' 만 가능)' };
  }
  if (!type){
    var ext = (name.split('.').pop() || '').toLowerCase();
    if (['jpg','jpeg','png','webp'].indexOf(ext) === -1){
      return { ok: false, reason: '지원하지 않는 확장자입니다. (.' + ext + ' · ' + LOADING_IMG_ALLOWED_LABELS + ' 만 가능)' };
    }
  }
  // 용량 체크
  if (typeof f.size === 'number' && f.size > LOADING_IMG_MAX_BYTES){
    var mb = (f.size / 1024 / 1024).toFixed(1);
    return { ok: false, reason: '용량 초과: ' + mb + ' MB (최대 3 MB)' };
  }
  return { ok: true };
}

// 서버 에러 응답에서 사람이 읽을 수 있는 사유를 추출.
// QA #318 — 서버는 이제 { message, detail, code } 를 내려주므로
// message + detail (+ code) 를 조합해서 완전한 진단 문자열을 만듦.
// message 만 있는 옛날 응답에도 호환.
// QA(긴급) — 시스템/코드 레벨 에러(테이블명·PGRST 코드·스키마 오류 등)를
// 사용자 화면에 그대로 노출하지 않는다. 원본 진단은 콘솔 로그로만 남기고,
// 사용자에겐 원인 유형별(서버/네트워크/규격)로 친화적 문구를 보여준다.
function _extractLoadingErrReason(err){
  if (!err) return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  // 이미 사용자 친화적으로 만들어진 문자열(클라 검증 사유 등)은 그대로 사용.
  if (typeof err === 'string') return err;

  // 원본 진단 정보 — 로그로만 보존.
  var rawParts = [];
  if (err.message) rawParts.push(String(err.message));
  if (err.detail && err.detail !== err.message) rawParts.push(String(err.detail));
  if (err.code) rawParts.push('[' + String(err.code) + ']');
  var raw = rawParts.join(' — ') || (function(){ try { return JSON.stringify(err); } catch(_){ return String(err); } })();
  try { console.error('[loading-images] raw error detail (사용자 비노출):', raw); } catch(_){}

  var probe = raw.toLowerCase();
  // 네트워크/연결 오류
  if (/failed to fetch|networkerror|network error|load failed|timeout|err_|net::/.test(probe)){
    return '네트워크 오류로 요청에 실패했습니다. 연결 상태를 확인하고 다시 시도해주세요.';
  }
  // 규격/입력 문제(서버가 명시적으로 규격 관련 message 를 준 경우)
  if (/규격|형식|용량|size|too large|invalid image|unsupported/.test(probe)){
    return '이미지가 권장 규격에서 벗어났습니다. 형식(JPG·PNG·WebP)과 용량(최대 3MB)을 확인해주세요.';
  }
  // 시스템/DB 레벨 오류(PGRST·스키마·테이블·제약조건·권한 등) → 코드/테이블명 비노출
  if (/pgrst|schema cache|could not find the table|relation|does not exist|duplicate|foreign key|violates|constraint|permission|denied|jwt|internal|failed to (create|update|delete|load)|500/.test(probe)
      || /^pgrst/i.test(String(err.code || ''))){
    return '서버 오류로 저장에 실패했습니다. 잠시 후 다시 시도해주세요. 문제가 계속되면 관리자에게 문의해주세요.';
  }
  // 그 외 — 서버가 준 사용자용 메시지가 한국어면 사용, 아니면 일반 안내.
  if (err.message && /[가-힯]/.test(String(err.message))) return String(err.message);
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
}

// 배치 업로드 공통 로직 (파일 선택 + 드래그앤드롭 양쪽에서 재사용).
// 진행 상황을 인라인 상태 라인으로 노출. 개별 실패는 나머지 진행에
// 영향 없음 — 실패한 파일만 마지막에 상세 요약 alert.
async function _uploadLoadingImgBatch(files){
  if (!files || !files.length) return;
  // 이미지 파일만 필터 + 3MB 상한 사전 체크.
  var accepted = [];
  var rejected = [];
  files.forEach(function(f){
    var v = _validateLoadingImg(f);
    if (!v.ok){
      rejected.push({ name: (f && f.name) || 'unknown', reason: v.reason });
    } else {
      accepted.push(f);
    }
  });
  if (!accepted.length){
    // 모든 파일이 사전 검증에서 걸린 경우 — 이유를 상세히 나열.
    var msg = '⚠️ 업로드 가능한 이미지가 없습니다.\n\n';
    msg += '허용 형식: ' + LOADING_IMG_ALLOWED_LABELS + '\n';
    msg += '최대 용량: 3 MB\n\n';
    msg += '제외된 파일 (' + rejected.length + '개):\n';
    rejected.forEach(function(r){ msg += '• ' + r.name + '\n    → ' + r.reason + '\n'; });
    alert(msg);
    return;
  }

  var statusEl = document.getElementById('loadingUploadStatus');
  function setStatus(msg, kind){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = kind === 'error' ? '#c0392b' : (kind === 'ok' ? '#27ae60' : 'var(--text3)');
  }

  // 이미 등록된 마지막 sort_order 뒤로 append (기존 순서 보존).
  var maxOrder = loadingImgs.reduce(function(m, x){ return Math.max(m, x.sort_order || 0); }, -1);

  var successCount = 0;
  var failures = [];
  for (var i = 0; i < accepted.length; i++){
    var f = accepted[i];
    setStatus('업로드 중… (' + (i + 1) + ' / ' + accepted.length + ') ' + f.name);
    try {
      var url = await uploadFile(f);
      if (!url) throw new Error('업로드 서버 응답에 URL 이 없습니다. 네트워크 상태를 확인하고 다시 시도해주세요.');
      var postResp = await apiPost('/admin/loading-images', {
        image_url_pc: url,
        alt_text: null,
        sort_order: maxOrder + 1 + i,
        is_active: true
      });
      // 서버가 message 만 응답하고 data 는 없는 경우 실패로 간주.
      if (postResp && postResp.message && !postResp.data){
        throw new Error(postResp.message);
      }
      successCount++;
    } catch(e){
      console.error('[loading-images] upload failed for', f.name, e);
      failures.push({ name: f.name, reason: _extractLoadingErrReason(e) });
    }
  }

  await _fetchLoadingImgs();

  // 결과 요약. 성공/사전 제외/서버 실패 3가지 카테고리를 명확히 구분.
  var lines = [];
  if (successCount){
    lines.push('✅ ' + successCount + '개 이미지가 성공적으로 등록되었습니다.');
  }
  if (rejected.length){
    lines.push('');
    lines.push('⛔ 업로드 전 제외 (' + rejected.length + '개) — 형식/용량 미충족:');
    rejected.forEach(function(r){ lines.push('• ' + r.name); lines.push('    → ' + r.reason); });
  }
  if (failures.length){
    lines.push('');
    lines.push('❌ 업로드 실패 (' + failures.length + '개) — 서버/네트워크 오류:');
    failures.forEach(function(f){ lines.push('• ' + f.name); lines.push('    → ' + f.reason); });
    lines.push('');
    lines.push('실패한 파일은 잠시 후 다시 시도해주세요. 계속 실패하면 파일 크기/형식을 확인해주세요.');
  }
  // 성공만 있고 문제 없으면 짧게, 문제가 있으면 상세히.
  // QA #315 — 등록 성공 시 웹사이트 반영 시간 안내.
  if (!rejected.length && !failures.length){
    setStatus('✓ ' + successCount + '개 등록 완료 · 웹사이트에 최대 30초 내 반영', 'ok');
    setTimeout(function(){ setStatus(''); }, 5000);
  } else {
    var statusMsg = successCount + '개 성공';
    if (rejected.length) statusMsg += ' · ' + rejected.length + '개 제외';
    if (failures.length) statusMsg += ' · ' + failures.length + '개 실패';
    setStatus(statusMsg, failures.length ? 'error' : (rejected.length ? 'error' : 'ok'));
  }
  // 문제가 하나라도 있으면 상세 alert.
  if (rejected.length || failures.length){
    alert(lines.join('\n'));
  }
}

// 드래그앤드롭 setup — 그리드 자체를 drop target 으로.
// dnd 등록은 컨테이너가 준비된 뒤 한 번만.
function _setupLoadingDragDrop(){
  var zone = document.getElementById('loadingDropZone');
  if (!zone || zone.dataset.dndSetup === '1') return;
  zone.dataset.dndSetup = '1';
  zone.addEventListener('dragover', function(e){
    if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.items || [], function(it){ return it.kind === 'file'; })){
      e.preventDefault();
      zone.style.outline = '2px dashed var(--text)';
      zone.style.outlineOffset = '4px';
      zone.style.background = 'rgba(255,255,255,.04)';
    }
  });
  zone.addEventListener('dragleave', function(e){
    if (e.target === zone){
      zone.style.outline = '';
      zone.style.background = '';
    }
  });
  zone.addEventListener('drop', async function(e){
    e.preventDefault();
    zone.style.outline = '';
    zone.style.background = '';
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    await _uploadLoadingImgBatch(Array.prototype.slice.call(files));
  });
}
if (typeof document !== 'undefined' && document.addEventListener){
  document.addEventListener('DOMContentLoaded', function(){
    try { _setupLoadingDragDrop(); } catch(_){}
  });
}

async function _toggleLoadingImg(id){
  var target = loadingImgs.filter(function(x){ return x.id === id; })[0];
  if (!target) return;
  try {
    await apiPatch('/admin/loading-images', { id: id, is_active: !target.is_active });
    await _fetchLoadingImgs();
  } catch(e){
    console.error('[loading-images] toggle failed:', e);
    alert('상태 변경 실패: ' + (e && e.message ? e.message : e));
  }
}

// QA #314 — 개별 삭제 확인 팝업 강화.
// 삭제 대상의 순서/상태/파일명을 팝업에 명시 → 실수로 다른 이미지를
// 지우는 사고 방지. 성공 시 상단 상태 라인에 명확한 피드백.
async function _deleteLoadingImg(id){
  var target = loadingImgs.filter(function(x){ return x.id === id; })[0];
  if (!target) return;
  var order = loadingImgs.indexOf(target) + 1;
  var activeLabel = target.is_active ? '활성' : '비활성';
  var altLabel = target.alt_text || '이름 없음';
  var msg = '⚠️ 로딩 이미지 삭제 확인\n\n';
  msg += '순서: #' + order + '\n';
  msg += '상태: ' + activeLabel + '\n';
  msg += '설명: ' + altLabel + '\n\n';
  msg += '이 이미지는 영구 삭제되며 웹사이트 스플래시에서 즉시 제외됩니다.\n';
  msg += '이 작업은 되돌릴 수 없습니다.\n\n';
  msg += '삭제하시겠습니까?';
  if (!confirm(msg)) return;

  var statusEl = document.getElementById('loadingUploadStatus');
  function setStatus(m, kind){
    if (!statusEl) return;
    statusEl.textContent = m || '';
    statusEl.style.color = kind === 'error' ? '#c0392b' : (kind === 'ok' ? '#27ae60' : 'var(--text3)');
  }
  setStatus('삭제 중…');
  try {
    var resp = await apiDelete('/admin/loading-images?id=' + encodeURIComponent(id));
    if (resp && resp.message && !resp.ok){
      throw new Error(resp.message);
    }
    // 선택 목록에서도 제거.
    _loadingSelectedIds.delete(id);
    await _fetchLoadingImgs();
    setStatus('✓ 이미지가 삭제되었습니다.', 'ok');
    setTimeout(function(){ setStatus(''); }, 3000);
  } catch(e){
    console.error('[loading-images] delete failed:', e);
    setStatus('삭제 실패', 'error');
    alert('❌ 삭제 실패\n\n순서: #' + order + '\n→ ' + _extractLoadingErrReason(e) + '\n\n잠시 후 다시 시도해주세요.');
  }
}

async function _pickMobileForLoadingImg(id){
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.onchange = async function(){
    if (!this.files || !this.files[0]) return;
    var file = this.files[0];
    // QA #313 — 통합된 검증 사용.
    var v = _validateLoadingImg(file);
    if (!v.ok){
      alert('⛔ 모바일 이미지 업로드 실패\n\n' + file.name + '\n→ ' + v.reason + '\n\n허용 형식: ' + LOADING_IMG_ALLOWED_LABELS + '\n최대 용량: 3 MB\n\n권장 규격: 세로형 9:16 (예: 1080×1920)');
      return;
    }
    try {
      var url = await uploadFile(file);
      if (!url) throw new Error('업로드 서버 응답에 URL 이 없습니다. 네트워크 상태를 확인하고 다시 시도해주세요.');
      var patchResp = await apiPatch('/admin/loading-images', { id: id, image_url_mobile: url });
      if (patchResp && patchResp.message && !patchResp.data){
        throw new Error(patchResp.message);
      }
      await _fetchLoadingImgs();
      alert('✅ 모바일 이미지가 저장되었습니다.');
    } catch(e){
      console.error('[loading-images] mobile update failed:', e);
      alert('❌ 모바일 이미지 저장 실패\n\n' + file.name + '\n→ ' + _extractLoadingErrReason(e) + '\n\n잠시 후 다시 시도해주세요.');
    }
  };
  input.click();
}

// 초기 렌더 (초기값은 빈 상태 → fetch 후 실 데이터로 재렌더)
renderLoadingImgs();
_fetchLoadingImgs();

// QA #315 — 웹사이트 반영 확인 도구들.
//
// _openLoadingSplashPreview:
//   새 창에서 홈페이지를 ?_splash=preview 로 열어 스플래시를 강제 재생.
//   sessionStorage 무시 + edge cache 우회. 관리자가 등록 후 바로
//   실제 결과를 눈으로 확인 가능.
function _openLoadingSplashPreview(){
  var base = (window.location.origin || 'https://pap-magazine.com');
  // 로컬 dev 환경에서 origin 이 admin 도메인일 수 있으므로 정규화.
  if (base.indexOf('localhost') === -1 && base.indexOf('127.0.0.1') === -1){
    // 프로덕션: 공개 도메인으로.
    base = 'https://pap-magazine.com';
  }
  var url = base + '/?_splash=preview&_t=' + Date.now();
  var win = window.open(url, '_blank', 'noopener');
  if (!win){
    alert('⚠️ 새 창이 팝업 차단되었습니다.\n브라우저 팝업 허용 후 다시 시도하거나, 아래 주소를 직접 열어주세요:\n\n' + url);
  }
}

// _verifyLoadingLive:
//   공개 API (/api/loading-images) 를 edge cache 우회해서 직접 호출.
//   응답을 요약해서 상단 상태 라인 + 상세 패널에 표시.
//   저장/삭제 후 이 버튼을 눌러 실제로 웹사이트가 무엇을 서빙하는지 확인.
async function _verifyLoadingLive(){
  var statusEl = document.getElementById('loadingLiveStatus');
  var detailEl = document.getElementById('loadingLiveDetail');
  function setStatus(msg, kind){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = kind === 'error' ? '#c0392b' : (kind === 'ok' ? '#27ae60' : 'var(--text3)');
  }
  setStatus('공개 API 확인 중…');
  if (detailEl){ detailEl.style.display = 'none'; detailEl.textContent = ''; }

  // API_BASE 는 어드민 API (예: /api). 공개 GET 은 인증 불필요.
  // cache: no-store + 랜덤 쿼리로 edge cache 우회.
  var url = API_BASE.replace(/\/$/, '') + '/loading-images?_bust=' + Date.now();
  try {
    var r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    var age = r.headers.get('age') || '0';
    var xVercelCache = r.headers.get('x-vercel-cache') || 'UNKNOWN';
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var body = await r.json();
    var list = (body && body.data) || [];
    var activeCount = list.length;
    var summary = '✓ 웹사이트가 지금 서빙하는 활성 이미지 ' + activeCount + '개' +
                  ' · edge cache: ' + xVercelCache +
                  (age !== '0' ? ' (age ' + age + 's)' : '');
    setStatus(summary, activeCount ? 'ok' : 'error');
    if (detailEl){
      detailEl.style.display = 'block';
      var lines = ['GET ' + url, ''];
      lines.push('X-Vercel-Cache: ' + xVercelCache);
      lines.push('Age: ' + age + 's');
      lines.push('Cache-Control: ' + (r.headers.get('cache-control') || '—'));
      lines.push('');
      lines.push('활성 이미지 (' + activeCount + '개):');
      if (!activeCount){
        lines.push('  (없음 — 웹사이트에 스플래시가 노출되지 않습니다)');
      } else {
        list.forEach(function(x, i){
          lines.push('  #' + (i + 1) + '  ' + (x.image_url_pc || '(no url)') +
                     (x.image_url_mobile ? '  📱' : '') +
                     '  ' + (x.alt_text || ''));
        });
      }
      // 로컬 관리자 데이터와 비교.
      var localActive = loadingImgs.filter(function(x){ return x.is_active; });
      lines.push('');
      lines.push('관리자 현재 상태 (활성 ' + localActive.length + '개):');
      localActive.forEach(function(x, i){
        lines.push('  #' + (i + 1) + '  ' + (x.image_url_pc || '(no url)') +
                   (x.image_url_mobile ? '  📱' : '') +
                   '  ' + (x.alt_text || ''));
      });
      // 불일치 감지.
      var mismatch = false;
      if (activeCount !== localActive.length) mismatch = true;
      else {
        for (var i = 0; i < activeCount; i++){
          if (list[i].id !== localActive[i].id){ mismatch = true; break; }
        }
      }
      lines.push('');
      if (mismatch){
        lines.push('⚠️ 관리자와 웹사이트 상태가 다릅니다.');
        lines.push('   edge cache 가 최신화될 때까지 최대 30초 대기하거나');
        lines.push('   이 버튼을 몇 초 뒤 다시 눌러 확인해주세요.');
      } else {
        lines.push('✅ 관리자와 웹사이트 상태가 일치합니다.');
      }
      detailEl.textContent = lines.join('\n');
    }
  } catch(e){
    console.error('[loading-images] verify failed:', e);
    setStatus('반영 상태 조회 실패: ' + (e && e.message || e), 'error');
    if (detailEl){
      detailEl.style.display = 'block';
      detailEl.textContent = 'GET ' + url + '\n\n에러: ' + (e && e.message || e);
    }
  }
}

// ======== MAGAZINE ISSUES (QA #317) ========
//
// magazine.html 의 발행호 목록을 관리. DB 는 magazine_issues 테이블,
// 공개 GET /api/magazine-issues, admin CRUD /api/admin/magazine-issues.
// admin 은 새 발행호를 등록/수정/삭제하고, 목록 순서는 sort_order 로,
// LATEST 배지는 is_latest 로 (활성 항목 중 1건만).
var magazineIssues = [];

async function loadMagazineIssues(){
  try {
    var resp = await apiGet('/admin/magazine-issues');
    magazineIssues = (resp && (resp.data || resp)) || [];
    if (!Array.isArray(magazineIssues)) magazineIssues = [];
  } catch(e){
    console.warn('[magazine-issues] fetch failed:', e && e.message);
    magazineIssues = [];
  }
  renderMagazineIssues();
}

// QA #339 — 페이지네이션 + 검색 상태 (localStorage 저장).
var _magIssuePage = 1;
var _magIssueLimit = (function(){
  try {
    var saved = parseInt(localStorage.getItem('pap-magissue-limit'), 10);
    if(saved === 10 || saved === 30 || saved === 50 || saved === 100) return saved;
  } catch(_){}
  return 30;
})();

function setMagIssueLimit(n){
  n = parseInt(n, 10);
  if(!n || [10,30,50,100].indexOf(n) === -1) n = 30;
  _magIssueLimit = n;
  try { localStorage.setItem('pap-magissue-limit', String(n)); } catch(_){}
  _magIssuePage = 1;
  renderMagazineIssues();
}
window.setMagIssueLimit = setMagIssueLimit;

function goMagIssuePage(p){
  p = parseInt(p, 10);
  if(!p || p < 1) p = 1;
  _magIssuePage = p;
  renderMagazineIssues();
  var top = document.getElementById('magazineIssuesGrid');
  if(top && top.scrollIntoView) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.goMagIssuePage = goMagIssuePage;

// 검색·필터 변경 시 페이지 1 로 리셋.
function renderMagazineIssuesFiltered(){
  _magIssuePage = 1;
  renderMagazineIssues();
}
window.renderMagazineIssuesFiltered = renderMagazineIssuesFiltered;

function _computeFilteredMagIssues(){
  var searchVal = (document.getElementById('magIssueSearch') ? document.getElementById('magIssueSearch').value : '').toLowerCase().trim();
  var statusVal = document.getElementById('magIssueStatusFilter') ? document.getElementById('magIssueStatusFilter').value : 'all';
  var yearVal   = document.getElementById('magIssueYearFilter')   ? document.getElementById('magIssueYearFilter').value   : 'all';
  return magazineIssues.filter(function(iss){
    // 상태 필터
    if (statusVal === 'active'   && !iss.is_active) return false;
    if (statusVal === 'inactive' &&  iss.is_active) return false;
    if (statusVal === 'latest'   && !iss.is_latest) return false;
    // 연도 필터
    if (yearVal !== 'all' && String(iss.issue_year || '') !== String(yearVal)) return false;
    // 검색 필터
    if (searchVal){
      var hay = ((iss.title || '') + ' ' +
                 (iss.month_label || '') + ' ' +
                 (iss.issue_number || '') + ' ' +
                 (iss.issue_year || '')).toLowerCase();
      if (hay.indexOf(searchVal) < 0) return false;
    }
    return true;
  });
}

function _updateMagIssueStats(){
  var total = magazineIssues.length;
  var active = magazineIssues.filter(function(x){ return x.is_active; }).length;
  var latest = magazineIssues.filter(function(x){ return x.is_latest; }).length;
  var tEl = document.getElementById('magIssueStatTotal');
  var aEl = document.getElementById('magIssueStatActive');
  var iEl = document.getElementById('magIssueStatInactive');
  var lEl = document.getElementById('magIssueStatLatest');
  if (tEl) tEl.textContent = total;
  if (aEl) aEl.textContent = active;
  if (iEl) iEl.textContent = total - active;
  if (lEl) lEl.textContent = latest;
  // 연도 필터 옵션 채우기 (기존 값 유지)
  var yearFilter = document.getElementById('magIssueYearFilter');
  if (yearFilter){
    var prev = yearFilter.value;
    var years = Array.from(new Set(magazineIssues.map(function(x){ return x.issue_year; }).filter(Boolean))).sort(function(a,b){ return b - a; });
    yearFilter.innerHTML = '<option value="all">전체 연도</option>' + years.map(function(y){ return '<option value="'+y+'">'+y+'</option>'; }).join('');
    if (prev && years.indexOf(parseInt(prev, 10)) >= 0) yearFilter.value = prev;
  }
  // perPage select 초기값 반영
  var perPageEl = document.getElementById('magIssuePerPage');
  if (perPageEl) perPageEl.value = String(_magIssueLimit);
}

function renderMagazineIssues(){
  var grid = document.getElementById('magazineIssuesGrid');
  if (!grid) return;
  _updateMagIssueStats();

  var filtered = _computeFilteredMagIssues();
  var total = filtered.length;
  var totalPages = Math.max(1, Math.ceil(total / _magIssueLimit));
  if (_magIssuePage > totalPages) _magIssuePage = totalPages;
  if (_magIssuePage < 1) _magIssuePage = 1;

  var pagBar = document.getElementById('magIssuePagination');

  if (!total){
    grid.innerHTML = '<div class="pe-hint" style="padding:24px;color:var(--text3);grid-column:1 / -1">'
      + (magazineIssues.length
          ? '검색 결과가 없습니다. 다른 키워드/필터로 시도해주세요.'
          : '등록된 발행호가 없습니다. <strong>+ 새 발행호</strong> 버튼으로 추가해주세요.')
      + '</div>';
    if (pagBar) pagBar.style.display = 'none';
    return;
  }

  // 페이지네이션 slice
  var startIdx = (_magIssuePage - 1) * _magIssueLimit;
  var endIdx = Math.min(total, startIdx + _magIssueLimit);
  var pageSlice = filtered.slice(startIdx, endIdx);

  // 연도별 섹션 그룹핑 (현재 페이지 슬라이스 내에서만)
  var byYear = {};
  pageSlice.forEach(function(iss){
    var y = iss.issue_year || 0;
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(iss);
  });
  var years = Object.keys(byYear).map(Number).sort(function(a,b){ return b - a; });
  grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(220px,1fr))';
  grid.innerHTML = '';
  years.forEach(function(y){
    var header = document.createElement('div');
    header.style.cssText = 'grid-column:1 / -1;font-size:14px;font-weight:700;padding:8px 4px;border-bottom:1px solid var(--border);margin-top:8px;color:var(--text1)';
    header.textContent = String(y);
    grid.appendChild(header);
    byYear[y].forEach(function(iss){
      var card = _buildMagazineIssueCard(iss);
      grid.appendChild(card);
    });
  });

  // 페이지네이션 렌더링
  if (pagBar){
    pagBar.style.display = '';
    var startNum = startIdx + 1;
    document.getElementById('magIssueRangeLabel').innerHTML =
      '<strong style="color:var(--text)">'+startNum+'-'+endIdx+'</strong> / 총 <strong style="color:var(--text)">'+total+'</strong>건';
    // 페이지 번호 버튼
    var WINDOW_RADIUS = 2;
    var pages = [];
    if (totalPages <= 7){
      for (var i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      var lo = Math.max(2, _magIssuePage - WINDOW_RADIUS);
      var hi = Math.min(totalPages - 1, _magIssuePage + WINDOW_RADIUS);
      if (lo > 2) pages.push('…');
      for (var j = lo; j <= hi; j++) pages.push(j);
      if (hi < totalPages - 1) pages.push('…');
      pages.push(totalPages);
    }
    var btnBase = 'display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:28px;padding:0 8px;border:1px solid var(--border2);background:#fff;color:var(--text);font-size:11px;cursor:pointer;border-radius:3px';
    var btnActive = 'background:var(--purple);color:#fff;border-color:var(--purple);font-weight:700';
    var btnDisabled = 'opacity:.4;cursor:not-allowed';
    var html = '';
    html += '<button type="button" style="'+btnBase+(_magIssuePage<=1?';'+btnDisabled:'')+'" '+(_magIssuePage<=1?'disabled':'onclick="goMagIssuePage(1)"')+' title="첫 페이지">«</button>';
    html += '<button type="button" style="'+btnBase+(_magIssuePage<=1?';'+btnDisabled:'')+'" '+(_magIssuePage<=1?'disabled':'onclick="goMagIssuePage('+(_magIssuePage-1)+')"')+' title="이전">‹</button>';
    pages.forEach(function(p){
      if (p === '…'){
        html += '<span style="padding:0 6px;color:var(--text3)">…</span>';
      } else {
        var style = btnBase + (p === _magIssuePage ? ';' + btnActive : '');
        html += '<button type="button" style="'+style+'" onclick="goMagIssuePage('+p+')">'+p+'</button>';
      }
    });
    html += '<button type="button" style="'+btnBase+(_magIssuePage>=totalPages?';'+btnDisabled:'')+'" '+(_magIssuePage>=totalPages?'disabled':'onclick="goMagIssuePage('+(_magIssuePage+1)+')"')+' title="다음">›</button>';
    html += '<button type="button" style="'+btnBase+(_magIssuePage>=totalPages?';'+btnDisabled:'')+'" '+(_magIssuePage>=totalPages?'disabled':'onclick="goMagIssuePage('+totalPages+')"')+' title="마지막 페이지">»</button>';
    document.getElementById('magIssuePageBtns').innerHTML = html;
  }
}

function _buildMagazineIssueCard(iss){
  var card = document.createElement('div');
  var isActive = !!iss.is_active;
  var isLatest = !!iss.is_latest;
  card.style.cssText = 'background:var(--surface);border:1px solid ' + (isLatest ? '#c9a96e' : 'var(--border)') + ';padding:10px;text-align:center;position:relative;border-radius:4px';
  // QA #339 — 작성자·발행일·수정일 표기 추가.
  // API 가 created_by_name / updated_by_name / created_at / updated_at 를 제공하면 표시.
  // 발행 년월 은 issue_year + issue_month 로 조합해 노출.
  var publishedDate = '';
  if (iss.issue_year && iss.issue_month){
    var mm = String(iss.issue_month).padStart(2, '0');
    publishedDate = iss.issue_year + '-' + mm;
  }
  var byLine = '';
  var creator = iss.created_by_name || iss.created_by_email || iss.created_by || '';
  var updater = iss.updated_by_name || iss.updated_by_email || iss.updated_by || '';
  if (creator){
    byLine += '작성 ' + esc(String(creator).slice(0, 18));
  }
  if (updater && updater !== creator){
    byLine += (byLine ? ' · ' : '') + '수정 ' + esc(String(updater).slice(0, 18));
  }
  var updatedAt = iss.updated_at || iss.created_at || '';
  if (updatedAt){
    try {
      var d = new Date(updatedAt);
      if (!isNaN(d.getTime())){
        var pad = function(n){ return n < 10 ? '0'+n : ''+n; };
        var stamp = String(d.getFullYear()).slice(-2) + '.' + pad(d.getMonth()+1) + '.' + pad(d.getDate());
        byLine += (byLine ? ' · ' : '') + stamp;
      }
    } catch(_){}
  }
  // QA(2026-07) #17 — 발행호 구조가 '분기 볼륨(Vol)'로 통일됐다.
  // 이제 magazine_issues 는 분기당 1행이고 issue_number 가 곧 Vol 번호다.
  // (예전엔 월간 1행 + Vol 을 계산해 붙여서, 같은 Vol 이 여러 행으로 보였다 — #16.)
  // months 에는 그 분기에 속한 월간 매거진들(link_url 포함)이 보존돼 있다.
  var _months = Array.isArray(iss.months) ? iss.months : [];
  var _monthsLine = _months.length
    ? _months.map(function(m){ return esc(String((m && m.label) || '')); }).filter(Boolean).join(' · ')
    : '';
  card.innerHTML =
    '<div style="position:absolute;top:6px;left:6px;font-size:10px;font-weight:700;color:#fff;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:2px;z-index:2">Vol. ' + esc(String(iss.issue_number || '')) + '</div>' +
    (isLatest ? '<div style="position:absolute;top:6px;right:6px;font-size:9px;font-weight:700;letter-spacing:.1em;color:#000;background:#c9a96e;padding:2px 6px;border-radius:2px;z-index:2">LATEST</div>' : '') +
    '<img loading="lazy" src="' + esc(iss.cover_image || '') + '" style="width:100%;aspect-ratio:2 / 3;object-fit:cover;margin:8px 0;border:1px solid var(--border);background:#111" onerror="this.style.opacity=\'.3\'">' +
    '<div style="font-size:12px;font-weight:600;color:var(--text1);margin-bottom:4px">' + esc(iss.title || '') + '</div>' +
    '<div style="font-size:10px;color:var(--text3);margin-bottom:4px">' + esc(iss.month_label || '') + ' · ' + esc(String(iss.editorial_count || 0)) + ' EDITORIALS</div>' +
    (_monthsLine ? '<div style="font-size:9px;color:var(--text3);margin-bottom:4px">📰 ' + _monthsLine + '</div>' : '') +
    (publishedDate ? '<div style="font-size:10px;color:var(--text3);margin-bottom:4px">📅 ' + esc(publishedDate) + '</div>' : '') +
    '<div style="font-size:10px;font-weight:600;margin-bottom:6px;color:' + (isActive ? 'var(--green)' : 'var(--red)') + '">' + (isActive ? '✓ 활성' : '✗ 비활성') + '</div>' +
    (byLine ? '<div style="font-size:9px;color:var(--text3);margin-bottom:8px;line-height:1.4">' + byLine + '</div>' : '') +
    '<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">' +
      '<button class="btn btn-sm" onclick="editMagazineIssue(\'' + esc(iss.id) + '\')" title="편집">✏️ 편집</button>' +
      '<button class="btn btn-sm btn-red" onclick="deleteMagazineIssue(\'' + esc(iss.id) + '\')" title="삭제">🗑️ 삭제</button>' +
    '</div>';
  return card;
}

function openMagazineIssueModal(){
  document.getElementById('magIssueId').value='';
  document.getElementById('magIssueModalTitle').textContent='새 발행호 (Vol.)';
  var maxNum=magazineIssues.reduce(function(m,x){ return Math.max(m,x.issue_number||0); },0);
  var nextVol=maxNum+1;
  document.getElementById('magIssueNumber').value=nextVol;
  document.getElementById('magIssueTitle').value='Vol. '+nextVol;
  document.getElementById('magIssueActive').checked=true;
  _clearMagCoverEditorial();
  _renderMagCoverList('');
  var modal=document.getElementById('magazineIssueModal');
  modal.style.display='flex'; modal.classList.add('show');
}

function editMagazineIssue(id){
  var iss=magazineIssues.filter(function(x){ return x.id===id; })[0];
  if(!iss) return;
  document.getElementById('magIssueId').value=iss.id;
  document.getElementById('magIssueModalTitle').textContent='발행호 편집 — VOL. '+iss.issue_number;
  document.getElementById('magIssueNumber').value=iss.issue_number||'';
  document.getElementById('magIssueTitle').value=iss.title||'';
  document.getElementById('magIssueActive').checked=!!iss.is_active;
  _clearMagCoverEditorial();
  // 커버 에디토리얼 원본 참조는 저장하지 않으므로, 현재 커버 이미지를 미리보기로만 표시.
  if(iss.cover_image){
    var th=document.getElementById('magIssueCoverEdThumb');
    var ti=document.getElementById('magIssueCoverEdTitle');
    var me=document.getElementById('magIssueCoverEdMeta');
    var wrap=document.getElementById('magIssueCoverEdSelected');
    if(th) th.src=iss.cover_image;
    if(ti) ti.textContent='현재 커버 ('+(iss.month_label||'')+')';
    if(me) me.textContent='변경하려면 아래 목록에서 새 커버 에디토리얼을 고르세요';
    if(wrap) wrap.style.display='';
  }
  _renderMagCoverList('');
  var modal=document.getElementById('magazineIssueModal');
  modal.style.display='flex'; modal.classList.add('show');
}

// QA #340 — 커버 에디토리얼 검색 picker + 발행기간 자동 라벨 빌더.
// 검색은 published + scheduled 병합 fetch (QA #305 필름 admin 패턴 재사용).
var _magEdSearchCache = null;
var _magEdSearchDebounce = null;

// 2026-07-21 개편 — 커버 에디토리얼을 '최신순 목록'으로 훑어보고 클릭 선택.
function _coverDeriveHint(dateStr){
  if(!dateStr) return '발행일 없음 — 자동 산출 불가';
  var d=new Date(dateStr); if(isNaN(d.getTime())) return '';
  var y=d.getUTCFullYear(), m=d.getUTCMonth()+1;
  var q=m<=3?1:m<=6?4:m<=9?7:10;
  var MON=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return MON[q-1]+'–'+MON[q+1]+' '+y+' (분기 자동 산출)';
}
function _magEdDate(e){ return e.published_date||e.publish_date||e.scheduled_publish_at||e.published_at||''; }
async function _renderMagCoverList(filter){
  var box=document.getElementById('magIssueCoverEdList'); if(!box) return;
  box.innerHTML='<div style="padding:14px;color:var(--text3);font-size:12px;text-align:center">불러오는 중…</div>';
  var pool=await _fetchMagEditorialSearchPool();
  var q=String(filter||'').trim().toLowerCase();
  var list=pool.slice().sort(function(a,b){ return String(_magEdDate(b)).localeCompare(String(_magEdDate(a))); });
  if(q){ list=list.filter(function(e){ var hay=((e.title||'')+' '+(Array.isArray(e.tags)?e.tags.join(' '):(e.tags||''))).toLowerCase(); return hay.indexOf(q)>=0; }); }
  var cap=300, shown=list.slice(0,cap);
  if(!shown.length){ box.innerHTML='<div style="padding:14px;color:var(--text3);font-size:12px;text-align:center">결과 없음</div>'; return; }
  var selId=(document.getElementById('magIssueCoverEdId')||{}).value||'';
  box.innerHTML=shown.map(function(e){
    var thumb=e.thumbnail_url||e.thumb||e.cover_image||(Array.isArray(e.images)&&e.images[0])||'';
    var badge=e.status==='scheduled'?'<span style="background:#f39c12;color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;margin-left:6px">예약</span>':'';
    var date=_magEdDate(e); if(date) date=String(date).slice(0,10);
    var sel=e.id===selId, bg=sel?'rgba(46,204,113,.14)':'';
    return '<div onclick="_pickMagCoverEditorial(\''+esc(e.id)+'\')" style="padding:7px 9px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;color:#111;background:'+bg+'" onmouseover="this.style.background=\'rgba(46,204,113,.06)\'" onmouseout="this.style.background=\''+bg+'\'">'
      +'<img src="'+esc(thumb)+'" style="width:40px;height:56px;object-fit:cover;background:#eee;border-radius:2px;flex-shrink:0" onerror="this.style.opacity=\'.3\'">'
      +'<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(e.title||'(제목 없음)')+badge+'</div>'
      +'<div style="font-size:10px;color:#888;margin-top:2px">'+esc(date)+'</div></div>'
      +(sel?'<div style="color:#27ae60;font-size:16px;font-weight:700">✓</div>':'')+'</div>';
  }).join('')+(list.length>cap?'<div style="padding:8px;text-align:center;color:var(--text3);font-size:10px">상위 '+cap+'개 표시 · 검색으로 좁혀주세요</div>':'');
}
window._renderMagCoverList=_renderMagCoverList;

async function _fetchMagEditorialSearchPool(){
  if (_magEdSearchCache) return _magEdSearchCache;
  try {
    var results = await Promise.all([
      apiGet('/editorials?status=published&limit=500'),
      apiGet('/editorials?status=scheduled&limit=200'),
    ]);
    var pool = [];
    results.forEach(function(r){
      var list = (r && (r.editorials || r.data)) || [];
      list.forEach(function(e){ pool.push(e); });
    });
    // 중복 제거 (같은 id 여러 번 등장 방지)
    var seen = {}; _magEdSearchCache = pool.filter(function(e){
      if (!e || seen[e.id]) return false;
      seen[e.id] = 1; return true;
    });
  } catch(e){
    console.warn('[mag cover picker] fetch failed:', e && e.message);
    _magEdSearchCache = [];
  }
  return _magEdSearchCache;
}

async function _searchMagCoverEditorial(query){
  clearTimeout(_magEdSearchDebounce);
  _magEdSearchDebounce=setTimeout(function(){ _renderMagCoverList(query); },200);
}
window._searchMagCoverEditorial = _searchMagCoverEditorial;

async function _pickMagCoverEditorial(edId){
  var pool=await _fetchMagEditorialSearchPool();
  var e=pool.filter(function(x){ return x.id===edId; })[0];
  if(!e) return;
  document.getElementById('magIssueCoverEdId').value=e.id;
  document.getElementById('magIssueCoverEdSlug').value=e.slug||'';
  // 제목 = 커버 에디토리얼 제목 (도메니코 지시 2026-07-21).
  var _tt=document.getElementById('magIssueTitle'); if(_tt && e.title) _tt.value=e.title;
  var thumb=e.thumbnail_url||e.thumb||e.cover_image||(Array.isArray(e.images)&&e.images[0])||'';
  var date=_magEdDate(e); if(date) date=String(date).slice(0,10);
  var th=document.getElementById('magIssueCoverEdThumb');
  var ti=document.getElementById('magIssueCoverEdTitle');
  var me=document.getElementById('magIssueCoverEdMeta');
  var wrap=document.getElementById('magIssueCoverEdSelected');
  if(th) th.src=thumb;
  if(ti) ti.textContent=e.title||'';
  if(me) me.textContent='발행일 '+date+' → '+_coverDeriveHint(date);
  if(wrap) wrap.style.display='';
  var srch=document.getElementById('magIssueCoverEdSearch');
  _renderMagCoverList(srch?srch.value:'');
}
window._pickMagCoverEditorial = _pickMagCoverEditorial;

function _clearMagCoverEditorial(){
  ['magIssueCoverEdId','magIssueCoverEdSlug'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var wrap=document.getElementById('magIssueCoverEdSelected'); if(wrap) wrap.style.display='none';
  var srch=document.getElementById('magIssueCoverEdSearch'); if(srch) srch.value='';
}
window._clearMagCoverEditorial = _clearMagCoverEditorial;

async function _setMagCoverEditorialFromIssue(iss){
  // 이슈의 cover_editorial_id 또는 slug 로 pool 에서 찾아 UI 복원.
  var pool = await _fetchMagEditorialSearchPool();
  var found = pool.filter(function(e){
    return (iss.cover_editorial_id && e.id === iss.cover_editorial_id)
        || (iss.cover_editorial_slug && e.slug === iss.cover_editorial_slug);
  })[0];
  if (found) _pickMagCoverEditorial(found.id);
}

// 발행 기간 라벨 자동 생성. 시작월+종료월+연도 → "Jul–Sep 2026"; 시작월+연도 → "JULY 2026".
function _buildMagPeriodLabel(){
  var ps = document.getElementById('magIssuePeriodStart').value;
  var pe = document.getElementById('magIssuePeriodEnd').value;
  var year = document.getElementById('magIssueYear').value;
  if (!ps){
    alert('시작월을 먼저 선택하세요.');
    return;
  }
  if (!year){
    alert('발행 연도를 먼저 입력하세요.');
    return;
  }
  var label = pe && pe !== ps ? (ps + '–' + pe + ' ' + year) : (ps.toUpperCase() + ' ' + year);
  // 배지 라벨(month_label) 필드에 반영.
  var lblEl = document.getElementById('magIssueMonthLabel');
  if (lblEl) lblEl.value = label;
  // 시작월로부터 발행월 자동 계산.
  var monthMap = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };
  var monthEl = document.getElementById('magIssueMonth');
  if (monthEl && monthMap[ps]) monthEl.value = monthMap[ps];
}
window._buildMagPeriodLabel = _buildMagPeriodLabel;

// QA #341 — 발행호에 포함되는 에디토리얼 다중 선택 상태.
// 순서 있는 배열로 저장 (첫 번째가 매거진에서 위쪽 노출).
var _magIncludedEds = [];

async function _searchMagIncludedEditorial(query){
  clearTimeout(_magEdSearchDebounce);
  _magEdSearchDebounce = setTimeout(async function(){
    var dd = document.getElementById('magIssueIncEdDropdown');
    if (!dd) return;
    var q = String(query || '').trim().toLowerCase();
    if (q.length < 1){ dd.style.display = 'none'; dd.innerHTML = ''; return; }
    var pool = await _fetchMagEditorialSearchPool();
    var alreadyIds = _magIncludedEds.map(function(x){ return x.id; });
    var hits = pool.filter(function(e){
      if (alreadyIds.indexOf(e.id) >= 0) return false;
      var hay = ((e.title || '') + ' ' + (Array.isArray(e.tags) ? e.tags.join(' ') : (e.tags || ''))).toLowerCase();
      return hay.indexOf(q) >= 0;
    }).slice(0, 30);
    if (!hits.length){
      dd.innerHTML = '<div style="padding:14px;color:var(--text3);font-size:12px;text-align:center">검색 결과 없음 (또는 이미 추가됨)</div>';
      dd.style.display = '';
      return;
    }
    dd.innerHTML = hits.map(function(e){
      var thumb = e.thumbnail_url || e.thumb || e.cover_image || (Array.isArray(e.images) && e.images[0]) || '';
      var isSched = e.status === 'scheduled';
      var badge = isSched
        ? '<span style="background:#f39c12;color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;margin-left:6px">예약</span>'
        : '<span style="background:#27ae60;color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;margin-left:6px">공개</span>';
      var date = e.publish_date || e.published_at || e.scheduled_publish_at || '';
      if (date) date = String(date).slice(0, 10);
      return '<div onclick="_addMagIncludedEditorial(\''+esc(e.id)+'\')" '
           + 'style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;transition:background .15s" '
           + 'onmouseover="this.style.background=\'rgba(46,204,113,.06)\'" '
           + 'onmouseout="this.style.background=\'\'">'
           +   '<img src="'+esc(thumb)+'" style="width:44px;height:60px;object-fit:cover;background:#eee;border-radius:2px;flex-shrink:0" onerror="this.style.opacity=\'.3\'">'
           +   '<div style="flex:1;min-width:0">'
           +     '<div style="font-size:12px;font-weight:600;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
           +       esc(e.title || '(제목 없음)') + badge
           +     '</div>'
           +     '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+esc(date)+' · 클릭하여 추가 →</div>'
           +   '</div>'
           + '</div>';
    }).join('');
    dd.style.display = '';
  }, 200);
}
window._searchMagIncludedEditorial = _searchMagIncludedEditorial;

async function _addMagIncludedEditorial(edId){
  var pool = await _fetchMagEditorialSearchPool();
  var e = pool.filter(function(x){ return x.id === edId; })[0];
  if (!e) return;
  // 중복 방지.
  if (_magIncludedEds.some(function(x){ return x.id === edId; })) return;
  _magIncludedEds.push({
    id:    e.id,
    slug:  e.slug || '',
    title: e.title || '',
    thumb: e.thumbnail_url || e.thumb || e.cover_image || (Array.isArray(e.images) && e.images[0]) || '',
    status: e.status || 'published'
  });
  _renderMagIncludedList();
  // 검색창/드롭다운 리셋.
  var search = document.getElementById('magIssueIncEdSearch');
  var dd = document.getElementById('magIssueIncEdDropdown');
  if (search) search.value = '';
  if (dd){ dd.style.display = 'none'; dd.innerHTML = ''; }
  // 에디토리얼 수 필드 자동 갱신.
  var cntEl = document.getElementById('magIssueEdCount');
  if (cntEl) cntEl.value = _magIncludedEds.length;
}
window._addMagIncludedEditorial = _addMagIncludedEditorial;

function _removeMagIncludedEditorial(edId){
  _magIncludedEds = _magIncludedEds.filter(function(x){ return x.id !== edId; });
  _renderMagIncludedList();
  var cntEl = document.getElementById('magIssueEdCount');
  if (cntEl) cntEl.value = _magIncludedEds.length;
}
window._removeMagIncludedEditorial = _removeMagIncludedEditorial;

function _moveMagIncludedEditorial(edId, dir){
  var idx = _magIncludedEds.findIndex(function(x){ return x.id === edId; });
  if (idx < 0) return;
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= _magIncludedEds.length) return;
  var tmp = _magIncludedEds[idx];
  _magIncludedEds[idx] = _magIncludedEds[newIdx];
  _magIncludedEds[newIdx] = tmp;
  _renderMagIncludedList();
}
window._moveMagIncludedEditorial = _moveMagIncludedEditorial;

function _renderMagIncludedList(){
  var wrap = document.getElementById('magIssueIncEdList');
  var empty = document.getElementById('magIssueIncEdEmpty');
  if (!wrap) return;
  if (!_magIncludedEds.length){
    if (empty){
      empty.style.display = '';
      // 다른 chip 제거하고 empty 만 표시.
      wrap.querySelectorAll('.mag-inc-chip').forEach(function(el){ el.remove(); });
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  // 기존 chip 모두 제거 후 재렌더.
  wrap.querySelectorAll('.mag-inc-chip').forEach(function(el){ el.remove(); });
  _magIncludedEds.forEach(function(x, i){
    var chip = document.createElement('div');
    chip.className = 'mag-inc-chip';
    chip.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px 4px 4px;background:rgba(46,204,113,.08);border:1px solid rgba(46,204,113,.35);border-radius:20px;font-size:11px;max-width:280px';
    var statusColor = x.status === 'scheduled' ? '#f39c12' : '#27ae60';
    chip.innerHTML =
      '<span style="font-weight:700;color:var(--text2);padding:0 4px">#' + (i+1) + '</span>' +
      '<img src="' + esc(x.thumb || '') + '" style="width:24px;height:32px;object-fit:cover;border-radius:2px;background:#eee" onerror="this.style.opacity=\'.3\'">' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--text1)">' + esc(x.title) + '</span>' +
      '<span style="width:6px;height:6px;border-radius:50%;background:' + statusColor + ';flex-shrink:0" title="' + (x.status === 'scheduled' ? '예약' : '공개') + '"></span>' +
      '<button type="button" onclick="_moveMagIncludedEditorial(\'' + esc(x.id) + '\',-1)" title="위로" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:11px;color:var(--text2)">▲</button>' +
      '<button type="button" onclick="_moveMagIncludedEditorial(\'' + esc(x.id) + '\',1)" title="아래로" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:11px;color:var(--text2)">▼</button>' +
      '<button type="button" onclick="_removeMagIncludedEditorial(\'' + esc(x.id) + '\')" title="제거" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:14px;color:#c0392b;line-height:1">✕</button>';
    wrap.appendChild(chip);
  });
}

function _resetMagIncludedList(){
  _magIncludedEds = [];
  _renderMagIncludedList();
}

async function _restoreMagIncludedFromIssue(iss){
  _magIncludedEds = [];
  var slugs = Array.isArray(iss.included_editorial_slugs) ? iss.included_editorial_slugs
             : (Array.isArray(iss.included_editorial_ids) ? iss.included_editorial_ids : []);
  if (!slugs.length){ _renderMagIncludedList(); return; }
  var pool = await _fetchMagEditorialSearchPool();
  slugs.forEach(function(key){
    var e = pool.filter(function(x){ return x.id === key || x.slug === key; })[0];
    if (!e) return;
    _magIncludedEds.push({
      id: e.id,
      slug: e.slug || '',
      title: e.title || '',
      thumb: e.thumbnail_url || e.thumb || e.cover_image || (Array.isArray(e.images) && e.images[0]) || '',
      status: e.status || 'published'
    });
  });
  _renderMagIncludedList();
}

function closeMagazineIssueModal(){
  var modal = document.getElementById('magazineIssueModal');
  modal.classList.remove('show');
  modal.style.display = 'none';
}

async function _onMagCoverFile(input){
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var statusEl = document.getElementById('magIssueCoverStatus');
  var prev = document.getElementById('magIssueCoverPreview');
  function setStatus(msg, isError){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#c0392b' : 'var(--text3)';
  }
  // 기본 형식/용량 검증 (3MB).
  if (['image/jpeg','image/png','image/webp'].indexOf(file.type) === -1){
    setStatus('⚠ 지원하지 않는 형식입니다. (JPG/PNG/WEBP 만 가능)', true);
    try { input.value = ''; } catch(_){}
    return;
  }
  if (file.size > 3 * 1024 * 1024){
    setStatus('⚠ 파일 크기가 너무 큽니다. (' + (file.size/1024/1024).toFixed(1) + 'MB → 최대 3MB)', true);
    try { input.value = ''; } catch(_){}
    return;
  }
  setStatus('업로드 중…');
  try {
    var url = await uploadFile(file);
    if (!url) throw new Error('업로드 응답에 URL 이 없습니다.');
    document.getElementById('magIssueCoverUrl').value = url;
    if (prev){
      prev.innerHTML = '<img src="' + esc(url) + '" style="max-height:120px;max-width:200px;object-fit:cover;border:1px solid var(--border);border-radius:2px">';
    }
    setStatus('✓ 업로드 완료');
  } catch(e){
    console.error('[magazine-issues] cover upload failed:', e);
    setStatus('업로드 실패: ' + (e && e.message || e), true);
  }
}

async function saveMagazineIssue(){
  var id=(document.getElementById('magIssueId').value||'').trim();
  var coverId=(document.getElementById('magIssueCoverEdId')||{}).value||null;
  var coverSlug=(document.getElementById('magIssueCoverEdSlug')||{}).value||null;
  var payload={
    issue_number: parseInt(document.getElementById('magIssueNumber').value,10),
    title: (document.getElementById('magIssueTitle').value||'').trim(),
    is_active: !!document.getElementById('magIssueActive').checked,
    cover_editorial_id: coverId,
    cover_editorial_slug: coverSlug,
  };
  if(!Number.isFinite(payload.issue_number)||payload.issue_number<1){ alert('⚠️ VOL 번호를 입력해주세요.'); return; }
  if(!payload.title){ alert('⚠️ 제목을 입력해주세요.'); return; }
  if(!id && !coverId && !coverSlug){ alert('⚠️ 커버 에디토리얼을 목록에서 선택해주세요.\n\n(발행연도·분기·기간·커버 이미지가 자동으로 채워집니다)'); return; }
  try{
    var resp;
    if(id){ payload.id=id; resp=await apiPatch('/admin/magazine-issues',payload); }
    else { resp=await apiPost('/admin/magazine-issues',payload); }
    if(resp && resp.message && !resp.data){ throw new Error(resp.message); }
    closeMagazineIssueModal();
    await loadMagazineIssues();
    alert('✅ 발행호가 저장되었습니다. 웹사이트에 최대 1분 내 반영됩니다.');
  }catch(e){
    console.error('[magazine-issues] save failed:',e);
    alert('❌ 저장 실패\n\n'+(e&&e.message||e)+'\n\n입력값을 확인하고 다시 시도해주세요.');
  }
}

async function deleteMagazineIssue(id){
  var iss = magazineIssues.filter(function(x){ return x.id === id; })[0];
  if (!iss) return;
  var msg = '⚠️ 발행호 삭제 확인\n\n';
  msg += 'ISSUE #' + iss.issue_number + ' — ' + iss.title + '\n';
  msg += '연월: ' + (iss.issue_year || '?') + '-' + (iss.issue_month || '?') + '\n';
  msg += '상태: ' + (iss.is_active ? '활성' : '비활성') + '\n\n';
  msg += '이 발행호는 영구 삭제되며 웹사이트 Magazine 목록에서 즉시 제외됩니다.\n';
  msg += '이 작업은 되돌릴 수 없습니다.\n\n';
  msg += '삭제하시겠습니까?';
  if (!confirm(msg)) return;
  try {
    var resp = await apiDelete('/admin/magazine-issues?id=' + encodeURIComponent(id));
    if (resp && resp.message && !resp.ok){
      throw new Error(resp.message);
    }
    await loadMagazineIssues();
    alert('✅ 발행호가 삭제되었습니다.');
  } catch(e){
    console.error('[magazine-issues] delete failed:', e);
    alert('❌ 삭제 실패\n\n' + (e && e.message || e));
  }
}

// 웹사이트 반영 확인 도구들.
function _openMagazinePreview(){
  var base = (window.location.origin || 'https://pap-magazine.com');
  if (base.indexOf('localhost') === -1 && base.indexOf('127.0.0.1') === -1){
    base = 'https://pap-magazine.com';
  }
  var url = base + '/magazine.html?_t=' + Date.now();
  var win = window.open(url, '_blank', 'noopener');
  if (!win){
    alert('⚠️ 새 창이 팝업 차단되었습니다.\n\n주소: ' + url);
  }
}

async function _verifyMagazineLive(){
  var statusEl = document.getElementById('magazineLiveStatus');
  var detailEl = document.getElementById('magazineLiveDetail');
  function setStatus(msg, kind){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = kind === 'error' ? '#c0392b' : (kind === 'ok' ? '#27ae60' : 'var(--text3)');
  }
  setStatus('공개 API 확인 중…');
  if (detailEl){ detailEl.style.display = 'none'; detailEl.textContent = ''; }
  var url = API_BASE.replace(/\/$/, '') + '/magazine-issues?_bust=' + Date.now();
  try {
    var r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    var age = r.headers.get('age') || '0';
    var xVercelCache = r.headers.get('x-vercel-cache') || 'UNKNOWN';
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var body = await r.json();
    var list = (body && body.data) || [];
    var summary = '✓ 웹사이트가 지금 서빙하는 활성 발행호 ' + list.length + '개' +
                  ' · edge cache: ' + xVercelCache +
                  (age !== '0' ? ' (age ' + age + 's)' : '');
    setStatus(summary, list.length ? 'ok' : 'error');
    if (detailEl){
      detailEl.style.display = 'block';
      var lines = ['GET ' + url, ''];
      lines.push('X-Vercel-Cache: ' + xVercelCache);
      lines.push('Age: ' + age + 's');
      lines.push('Cache-Control: ' + (r.headers.get('cache-control') || '—'));
      lines.push('');
      lines.push('활성 발행호 (' + list.length + '개):');
      list.forEach(function(x, i){
        lines.push('  ' + (i + 1) + '. #' + x.issue_number + '  ' + x.title + '  (' + x.issue_year + ') ' + (x.is_latest ? '⭐ LATEST' : ''));
      });
      var localActive = magazineIssues.filter(function(x){ return x.is_active; });
      lines.push('');
      lines.push('관리자 현재 상태 (활성 ' + localActive.length + '개):');
      localActive.forEach(function(x, i){
        lines.push('  ' + (i + 1) + '. #' + x.issue_number + '  ' + x.title + '  (' + x.issue_year + ') ' + (x.is_latest ? '⭐ LATEST' : ''));
      });
      var mismatch = (list.length !== localActive.length);
      if (!mismatch){
        for (var i = 0; i < list.length; i++){
          if (list[i].id !== localActive[i].id){ mismatch = true; break; }
        }
      }
      lines.push('');
      if (mismatch){
        lines.push('⚠️ 관리자와 웹사이트 상태가 다릅니다. edge cache 갱신 대기 (최대 1분).');
      } else {
        lines.push('✅ 관리자와 웹사이트 상태가 일치합니다.');
      }
      detailEl.textContent = lines.join('\n');
    }
  } catch(e){
    console.error('[magazine-issues] verify failed:', e);
    setStatus('반영 상태 조회 실패: ' + (e && e.message || e), 'error');
  }
}

// 초기 로드.
loadMagazineIssues();

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
// QA #329 — contact 의 '관련 이미지' 는 QA #326 에서 UI 제거됨 —
// 렌더 호출도 함께 정리 (컨테이너 부재 시 no-op 이었지만 dead call).

// ======== QA #321 — BUSINESS PAGE (real persistence) ========
// 비즈니스 편집은 mock(saveCompanyInfo) 에서 분리 — /api/settings 의
// site_settings.business_page (JSONB) 에 실제 저장한다.
//   value = {
//     content_brand_ko: '…',   // 섹션 1 본문 (한국어)
//     content_work_ko:  '…',   // 섹션 2 본문 (한국어)
//     mediakit_title:   '',    // 비우면 언어별 기본 표기
//     mediakit_link_en: '',    // 비우면 웹사이트 내장 기본 링크
//     mediakit_link_ko: ''
//   }
// business.html 이 public GET 으로 읽어 반영 (한국어 본문 → ko 뷰,
// 미디어킷 제목/링크 → 전 언어 공통).
// QA #326 — 상태 배너가 business/contact 두 탭에서 쓰이게 되면서
// _pageSetStatus(elId, kind, text) 로 범용화. 하위 호환 shim 유지.
function _bizSetStatus(kind, text){ _pageSetStatus('bizStatus', kind, text); }

async function loadBusinessPage(){
  try {
    var resp = await apiGet('/settings?key=business_page');
    var v = (resp && resp.value) || {};
    var set = function(id, val){ var el = document.getElementById(id); if(el) el.value = val || ''; };
    set('bizBrandKo',      v.content_brand_ko);
    set('bizWorkKo',       v.content_work_ko);
    set('bizMediakitTitle',v.mediakit_title);
    set('bizMediakitEn',   v.mediakit_link_en);
    set('bizMediakitKo',   v.mediakit_link_ko);
    _bizSetStatus(null, '');
  } catch(e){
    console.warn('[business] load failed:', e && e.message);
    _bizSetStatus('err', '저장된 설정을 불러오지 못했습니다 — 저장 시 현재 입력값으로 덮어씁니다.');
  }
}

function _bizValidUrl(u){
  if(!u) return true; // 비움 = 기본 링크 사용
  return /^https:\/\//i.test(u);
}

// ======== QA #326 — CONTACT PAGE (real persistence) ========
// site_settings.contact_page = { office_it, office_kr, email }
// contact.html 이 public GET 으로 읽어 첫 번째 contact-block 의 오피스
// 주소 <p> 두 개를 교체 (전 언어 공통 — 라벨은 언어별 번역 유지).
// QA #327 — email 필드 추가: Email 섹션 표기 + mailto 링크에 적용.
async function loadContactPage(){
  try {
    var resp = await apiGet('/settings?key=contact_page');
    var v = (resp && resp.value) || {};
    var set = function(id, val){ var el = document.getElementById(id); if(el) el.value = val || ''; };
    set('contactOfficeIt', v.office_it);
    set('contactOfficeKr', v.office_kr);
    set('contactEmail',    v.email);
    // QA #328 — 미디어키트 필드
    set('contactMediakitTitle', v.mediakit_title);
    set('contactMediakitEn',    v.mediakit_link_en);
    set('contactMediakitKo',    v.mediakit_link_ko);
    _pageSetStatus('contactStatus', null, '');
  } catch(e){
    console.warn('[contact] load failed:', e && e.message);
    _pageSetStatus('contactStatus', 'err', '저장된 설정을 불러오지 못했습니다 — 저장 시 현재 입력값으로 덮어씁니다.');
  }
}

async function saveContactPage(){
  var val = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var payload = {
    office_it: val('contactOfficeIt'),
    office_kr: val('contactOfficeKr'),
    email:     val('contactEmail'),
    // QA #328 — 미디어키트 제목 + 언어별 다운로드 링크
    mediakit_title:   val('contactMediakitTitle'),
    mediakit_link_en: val('contactMediakitEn'),
    mediakit_link_ko: val('contactMediakitKo')
  };
  // QA #327 — 이메일 형식 검증 (비움 = 내장 기본값 사용이므로 허용).
  if(payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)){
    _pageSetStatus('contactStatus', 'err', '이메일 형식이 올바르지 않습니다. (예: contact@pap-magazine.com)');
    return;
  }
  // QA #328 — 링크는 https:// 전체 URL 만 허용 (비움 = 기본 링크).
  if(!_bizValidUrl(payload.mediakit_link_en) || !_bizValidUrl(payload.mediakit_link_ko)){
    _pageSetStatus('contactStatus', 'err', '미디어킷 링크는 https:// 로 시작하는 전체 URL 이어야 합니다.');
    return;
  }
  var btn = document.getElementById('contactSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = '저장 중…'; }
  try {
    var resp = await apiPut('/settings', { key: 'contact_page', value: payload });
    if(resp && resp.data){
      _pageSetStatus('contactStatus', 'ok', '✓ 저장되었습니다. 웹사이트에 최대 1분 내 반영됩니다 (edge cache 60초).');
    } else {
      _pageSetStatus('contactStatus', 'err', '저장 실패: ' + ((resp && resp.message) || '알 수 없는 오류'));
    }
  } catch(e){
    _pageSetStatus('contactStatus', 'err', '저장 실패: ' + (e && e.message || '네트워크 오류'));
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = '저장'; }
  }
}

// QA #326 — bizStatus 전용이던 상태 배너 헬퍼를 범용화.
function _pageSetStatus(elId, kind, text){
  var el = document.getElementById(elId);
  if(!el) return;
  if(!text){ el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.textContent = text;
  el.style.background = kind === 'err' ? 'rgba(220,38,38,.08)' : 'rgba(22,163,74,.08)';
  el.style.border = '1px solid ' + (kind === 'err' ? 'rgba(220,38,38,.3)' : 'rgba(22,163,74,.3)');
  el.style.color = kind === 'err' ? '#dc2626' : '#16a34a';
}

async function saveBusinessPage(){
  var val = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var payload = {
    content_brand_ko: val('bizBrandKo'),
    content_work_ko:  val('bizWorkKo'),
    mediakit_title:   val('bizMediakitTitle'),
    mediakit_link_en: val('bizMediakitEn'),
    mediakit_link_ko: val('bizMediakitKo')
  };
  if(!_bizValidUrl(payload.mediakit_link_en) || !_bizValidUrl(payload.mediakit_link_ko)){
    _bizSetStatus('err', '미디어킷 링크는 https:// 로 시작하는 전체 URL 이어야 합니다.');
    return;
  }
  var btn = document.getElementById('bizSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = '저장 중…'; }
  try {
    var resp = await apiPut('/settings', { key: 'business_page', value: payload });
    if(resp && resp.data){
      _bizSetStatus('ok', '✓ 저장되었습니다. 웹사이트에 최대 1분 내 반영됩니다 (edge cache 60초).');
    } else {
      _bizSetStatus('err', '저장 실패: ' + ((resp && resp.message) || '알 수 없는 오류'));
    }
  } catch(e){
    _bizSetStatus('err', '저장 실패: ' + (e && e.message || '네트워크 오류'));
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = '저장'; }
  }
}

// ======== NAV MENU ITEMS (Hamburger Nav) — QA #320 실운영 전환 ========
//
// 기존은 완전한 mock (in-memory + localStorage) 였음. QA #320 에서
// DB (nav_menu_items) + API (/api/(admin/)?nav-menu) + 모달 UI 로 재구축.
// 관리자 편집이 즉시 웹사이트 햄버거 우측 메뉴에 반영됨 (edge cache 60s).
var menuCats = [];

async function loadNavMenuItems(){
  try {
    var resp = await apiGet('/admin/nav-menu');
    menuCats = (resp && (resp.data || resp)) || [];
    if (!Array.isArray(menuCats)) menuCats = [];
  } catch(e){
    console.warn('[nav-menu] fetch failed:', e && e.message);
    menuCats = [];
  }
  renderMenuCats();
}

// QA #324 — 인라인 편집 렌더링.
// 각 행이 입력 가능한 상태로 표시되고, 값이 변하면 '저장' 버튼이 노란색으로
// 강조돼 dirty 상태를 시각적으로 표시. 저장 성공 시 원본 값 동기화.
// 팝업 모달은 하위 호환용으로 유지 (openNavMenuModal 은 그대로 노출).
function renderMenuCats(){
  var tb = document.getElementById('menuCatBody');
  if (!tb) return;
  tb.innerHTML = '';
  var styleColor = { red: 'var(--red)', gold: '#c9a96e', muted: 'var(--text3)', default: 'var(--text1)' };
  menuCats.forEach(function(m){
    var color = styleColor[m.style] || styleColor.default;
    var rid = 'nav-row-' + esc(m.id);
    var tr = document.createElement('tr');
    tr.id = rid;
    tr.dataset.id = m.id;
    // 원본 값을 dataset 에 저장해서 dirty 감지 + reset 에 사용.
    tr.dataset.origLabelKey     = m.label_key || '';
    tr.dataset.origLabelDefault = m.label_default || '';
    tr.dataset.origLinkUrl      = m.link_url || '';
    tr.dataset.origStyle        = m.style || 'default';
    tr.dataset.origSortOrder    = String(m.sort_order || 0);
    tr.dataset.origIsActive     = m.is_active ? '1' : '0';
    tr.innerHTML =
      '<td><input type="number" class="pe-input" value="' + esc(String(m.sort_order || 0)) + '" oninput="_markNavRowDirty(\'' + esc(m.id) + '\')" style="width:60px;padding:5px 6px;font-size:12px" data-field="sort_order"></td>' +
      '<td><input type="text" class="pe-input" value="' + esc(m.label_default || '') + '" oninput="_markNavRowDirty(\'' + esc(m.id) + '\')" style="width:100%;padding:5px 8px;font-size:12px;font-weight:700;letter-spacing:.04em;color:' + color + '" data-field="label_default" placeholder="예: BEAUTY"></td>' +
      '<td><input type="text" class="pe-input" value="' + esc(m.label_key || '') + '" oninput="_markNavRowDirty(\'' + esc(m.id) + '\')" style="width:100%;padding:5px 8px;font-size:11px;font-family:monospace;color:var(--text3)" data-field="label_key" placeholder="예: navBeauty (선택)"></td>' +
      '<td><input type="text" class="pe-input" value="' + esc(m.link_url || '') + '" oninput="_markNavRowDirty(\'' + esc(m.id) + '\')" style="width:100%;padding:5px 8px;font-size:11px;font-family:monospace;color:var(--text2)" data-field="link_url" placeholder="예: /beauty"></td>' +
      '<td>' +
        '<select class="pe-select" onchange="_markNavRowDirty(\'' + esc(m.id) + '\')" style="width:100%;padding:5px 6px;font-size:12px" data-field="style">' +
          '<option value="default"' + (m.style === 'default' ? ' selected' : '') + '>default</option>' +
          '<option value="red"'     + (m.style === 'red'     ? ' selected' : '') + '>red</option>' +
          '<option value="gold"'    + (m.style === 'gold'    ? ' selected' : '') + '>gold</option>' +
          '<option value="muted"'   + (m.style === 'muted'   ? ' selected' : '') + '>muted</option>' +
        '</select>' +
      '</td>' +
      '<td style="text-align:center">' +
        '<label class="pe-check" style="justify-content:center;cursor:pointer">' +
          '<input type="checkbox"' + (m.is_active ? ' checked' : '') + ' onchange="_markNavRowDirty(\'' + esc(m.id) + '\')" data-field="is_active">' +
        '</label>' +
      '</td>' +
      '<td>' +
        '<button class="btn btn-sm" onclick="_saveNavRow(\'' + esc(m.id) + '\')" data-role="save" style="opacity:.4" disabled title="변경사항이 있으면 활성화됩니다">💾 저장</button> ' +
        '<button class="btn btn-sm" onclick="_resetNavRow(\'' + esc(m.id) + '\')" data-role="reset" style="opacity:.4" disabled title="원래 값으로 되돌립니다">↺</button> ' +
        '<button class="btn btn-sm btn-red" onclick="deleteNavMenuItem(\'' + esc(m.id) + '\')" title="삭제">🗑️</button>' +
      '</td>';
    tb.appendChild(tr);
  });
  // 하단 '새 메뉴 추가' 행 렌더링.
  _renderNavNewRow();
}

// 새 메뉴 추가용 인라인 행 (테이블 최하단).
function _renderNavNewRow(){
  var tb = document.getElementById('menuCatBody');
  if (!tb) return;
  var maxOrder = menuCats.reduce(function(m, x){ return Math.max(m, x.sort_order || 0); }, 0);
  var suggestedOrder = maxOrder + 10;
  var tr = document.createElement('tr');
  tr.id = 'nav-row-new';
  tr.style.background = 'rgba(46,204,113,.05)';
  tr.style.borderTop = '2px solid rgba(46,204,113,.35)';
  tr.innerHTML =
    '<td><input type="number" class="pe-input" id="navNewSortOrder" value="' + suggestedOrder + '" style="width:60px;padding:5px 6px;font-size:12px"></td>' +
    '<td><input type="text" class="pe-input" id="navNewLabelDefault" placeholder="라벨 (예: BEAUTY)" style="width:100%;padding:5px 8px;font-size:12px;font-weight:700"></td>' +
    '<td><input type="text" class="pe-input" id="navNewLabelKey" placeholder="i18n 키 (선택)" style="width:100%;padding:5px 8px;font-size:11px;font-family:monospace"></td>' +
    '<td><input type="text" class="pe-input" id="navNewLinkUrl" placeholder="/beauty" style="width:100%;padding:5px 8px;font-size:11px;font-family:monospace"></td>' +
    '<td>' +
      '<select class="pe-select" id="navNewStyle" style="width:100%;padding:5px 6px;font-size:12px">' +
        '<option value="default">default</option>' +
        '<option value="red">red</option>' +
        '<option value="gold">gold</option>' +
        '<option value="muted">muted</option>' +
      '</select>' +
    '</td>' +
    '<td style="text-align:center">' +
      '<label class="pe-check" style="justify-content:center;cursor:pointer">' +
        '<input type="checkbox" id="navNewActive" checked>' +
      '</label>' +
    '</td>' +
    '<td>' +
      '<button class="btn btn-sm btn-primary" onclick="_addNavRowInline()">➕ 추가</button>' +
    '</td>';
  tb.appendChild(tr);
}

// 행 값이 원본과 다르면 dirty 표시 (저장/리셋 버튼 활성화).
function _markNavRowDirty(id){
  var tr = document.getElementById('nav-row-' + id);
  if (!tr) return;
  var current = _readNavRowValues(tr);
  var dirty = String(current.label_key)     !== tr.dataset.origLabelKey
           || String(current.label_default) !== tr.dataset.origLabelDefault
           || String(current.link_url)      !== tr.dataset.origLinkUrl
           || String(current.style)         !== tr.dataset.origStyle
           || String(current.sort_order)    !== tr.dataset.origSortOrder
           || (current.is_active ? '1' : '0') !== tr.dataset.origIsActive;
  var saveBtn = tr.querySelector('button[data-role="save"]');
  var resetBtn = tr.querySelector('button[data-role="reset"]');
  if (saveBtn){
    saveBtn.disabled = !dirty;
    saveBtn.style.opacity = dirty ? '1' : '.4';
    saveBtn.style.background = dirty ? 'linear-gradient(135deg,#f39c12,#e67e22)' : '';
    saveBtn.style.color = dirty ? '#fff' : '';
    saveBtn.style.borderColor = dirty ? '#d68910' : '';
  }
  if (resetBtn){
    resetBtn.disabled = !dirty;
    resetBtn.style.opacity = dirty ? '1' : '.4';
  }
}

// 행에서 현재 편집 중인 값 읽기.
function _readNavRowValues(tr){
  var q = function(field){ return tr.querySelector('[data-field="' + field + '"]'); };
  return {
    label_default: (q('label_default').value || '').trim(),
    label_key:     (q('label_key').value || '').trim() || null,
    link_url:      (q('link_url').value || '').trim(),
    style:         q('style').value || 'default',
    sort_order:    parseInt(q('sort_order').value, 10) || 0,
    is_active:     !!q('is_active').checked,
  };
}

// 개별 행 저장.
async function _saveNavRow(id){
  var tr = document.getElementById('nav-row-' + id);
  if (!tr) return;
  var vals = _readNavRowValues(tr);
  if (!vals.label_default){ alert('⚠️ 라벨을 입력해주세요.'); return; }
  if (!vals.link_url){ alert('⚠️ 링크 URL 을 입력해주세요.'); return; }
  var saveBtn = tr.querySelector('button[data-role="save"]');
  if (saveBtn){ saveBtn.disabled = true; saveBtn.textContent = '저장 중…'; }
  try {
    var resp = await apiPatch('/admin/nav-menu', Object.assign({ id: id }, vals));
    if (resp && resp.message && !resp.data){
      var detail = resp.detail ? (resp.message + ' — ' + resp.detail) : resp.message;
      throw new Error(detail);
    }
    // 로컬 데이터 동기화 + 원본 dataset 갱신.
    var idx = menuCats.findIndex(function(x){ return x.id === id; });
    if (idx >= 0) menuCats[idx] = Object.assign({}, menuCats[idx], resp.data || vals);
    tr.dataset.origLabelKey     = vals.label_key || '';
    tr.dataset.origLabelDefault = vals.label_default;
    tr.dataset.origLinkUrl      = vals.link_url;
    tr.dataset.origStyle        = vals.style;
    tr.dataset.origSortOrder    = String(vals.sort_order);
    tr.dataset.origIsActive     = vals.is_active ? '1' : '0';
    _markNavRowDirty(id); // 저장 후 dirty 해제
    // 저장 성공 표시 (2초간 초록 배경)
    tr.style.transition = 'background .3s ease';
    tr.style.background = 'rgba(46,204,113,.15)';
    setTimeout(function(){ tr.style.background = ''; }, 1500);
    var statusEl = document.getElementById('navMenuLiveStatus');
    if (statusEl){
      statusEl.textContent = '✓ 저장 완료 · 웹사이트에 최대 1분 내 반영';
      statusEl.style.color = '#27ae60';
      setTimeout(function(){ statusEl.textContent = ''; }, 3000);
    }
  } catch(e){
    console.error('[nav-menu] inline save failed:', e);
    alert('❌ 저장 실패\n\n' + (e && e.message || e));
  } finally {
    if (saveBtn){ saveBtn.textContent = '💾 저장'; }
  }
}

// 행을 원본 값으로 되돌리기.
function _resetNavRow(id){
  var tr = document.getElementById('nav-row-' + id);
  if (!tr) return;
  var q = function(field){ return tr.querySelector('[data-field="' + field + '"]'); };
  q('label_default').value = tr.dataset.origLabelDefault;
  q('label_key').value     = tr.dataset.origLabelKey;
  q('link_url').value      = tr.dataset.origLinkUrl;
  q('style').value         = tr.dataset.origStyle;
  q('sort_order').value    = tr.dataset.origSortOrder;
  q('is_active').checked   = tr.dataset.origIsActive === '1';
  _markNavRowDirty(id);
}

// 신규 메뉴 인라인 추가.
async function _addNavRowInline(){
  var payload = {
    label_default: (document.getElementById('navNewLabelDefault').value || '').trim(),
    label_key:     (document.getElementById('navNewLabelKey').value || '').trim() || null,
    link_url:      (document.getElementById('navNewLinkUrl').value || '').trim(),
    style:         document.getElementById('navNewStyle').value || 'default',
    sort_order:    parseInt(document.getElementById('navNewSortOrder').value, 10) || 0,
    is_active:     !!document.getElementById('navNewActive').checked,
  };
  if (!payload.label_default){ alert('⚠️ 라벨을 입력해주세요.'); return; }
  if (!payload.link_url){ alert('⚠️ 링크 URL 을 입력해주세요.'); return; }
  try {
    var resp = await apiPost('/admin/nav-menu', payload);
    if (resp && resp.message && !resp.data){
      var detail = resp.detail ? (resp.message + ' — ' + resp.detail) : resp.message;
      throw new Error(detail);
    }
    await loadNavMenuItems();
    var statusEl = document.getElementById('navMenuLiveStatus');
    if (statusEl){
      statusEl.textContent = '✓ 새 메뉴 등록 완료 · 웹사이트에 최대 1분 내 반영';
      statusEl.style.color = '#27ae60';
      setTimeout(function(){ statusEl.textContent = ''; }, 3000);
    }
  } catch(e){
    console.error('[nav-menu] inline add failed:', e);
    alert('❌ 등록 실패\n\n' + (e && e.message || e));
  }
}

function openNavMenuModal(id){
  var target = id ? menuCats.filter(function(x){ return x.id === id; })[0] : null;
  document.getElementById('navMenuId').value = target ? target.id : '';
  document.getElementById('navMenuLabelKey').value = target ? (target.label_key || '') : '';
  document.getElementById('navMenuLabelDefault').value = target ? (target.label_default || '') : '';
  document.getElementById('navMenuLinkUrl').value = target ? (target.link_url || '') : '';
  document.getElementById('navMenuStyle').value = target ? (target.style || 'default') : 'default';
  document.getElementById('navMenuSortOrder').value = target ? (target.sort_order || 0)
    : (menuCats.reduce(function(m, x){ return Math.max(m, x.sort_order || 0); }, 0) + 10);
  document.getElementById('navMenuActive').checked = target ? !!target.is_active : true;
  document.getElementById('navMenuModalTitle').textContent = target ? ('메뉴 항목 편집 — ' + (target.label_default || '')) : '새 메뉴 항목';
  var errEl = document.getElementById('navMenuFormError');
  if (errEl){ errEl.style.display = 'none'; errEl.textContent = ''; }
  _updateNavMenuPreview();
  var modal = document.getElementById('navMenuModal');
  modal.style.display = 'flex';
  modal.classList.add('show');
  // 미리보기 실시간 업데이트
  ['navMenuLabelDefault','navMenuLinkUrl','navMenuStyle'].forEach(function(id){
    var el = document.getElementById(id);
    if (el && !el.dataset.previewBound){
      el.dataset.previewBound = '1';
      var evt = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, _updateNavMenuPreview);
    }
  });
}

function closeNavMenuModal(){
  var modal = document.getElementById('navMenuModal');
  modal.classList.remove('show');
  modal.style.display = 'none';
}

function _updateNavMenuPreview(){
  var label = document.getElementById('navMenuLabelDefault').value || 'MENU';
  var url = document.getElementById('navMenuLinkUrl').value || '/';
  var style = document.getElementById('navMenuStyle').value || 'default';
  var styleColor = { red: '#e74c3c', gold: '#c9a96e', muted: '#666', default: '#fff' };
  var linkEl = document.getElementById('navMenuPreviewLink');
  var urlEl  = document.getElementById('navMenuPreviewUrl');
  if (linkEl){ linkEl.textContent = label; linkEl.style.color = styleColor[style] || '#fff'; }
  if (urlEl){ urlEl.textContent = url; }
}

async function saveNavMenuItem(){
  var id = (document.getElementById('navMenuId').value || '').trim();
  var payload = {
    label_key:     (document.getElementById('navMenuLabelKey').value || '').trim() || null,
    label_default: (document.getElementById('navMenuLabelDefault').value || '').trim(),
    link_url:      (document.getElementById('navMenuLinkUrl').value || '').trim(),
    style:         document.getElementById('navMenuStyle').value || 'default',
    sort_order:    parseInt(document.getElementById('navMenuSortOrder').value, 10) || 0,
    is_active:     !!document.getElementById('navMenuActive').checked,
  };
  var errEl = document.getElementById('navMenuFormError');
  function showError(msg){
    if (!errEl) return;
    errEl.style.display = 'block';
    errEl.textContent = msg;
  }
  if (errEl){ errEl.style.display = 'none'; errEl.textContent = ''; }
  if (!payload.label_default){ showError('⚠️ 라벨(기본)을 입력해주세요.'); return; }
  if (!payload.link_url){ showError('⚠️ 링크 URL 을 입력해주세요.'); return; }
  try {
    var resp;
    if (id){
      payload.id = id;
      resp = await apiPatch('/admin/nav-menu', payload);
    } else {
      resp = await apiPost('/admin/nav-menu', payload);
    }
    if (resp && resp.message && !resp.data){
      var detail = resp.detail ? (resp.message + ' — ' + resp.detail) : resp.message;
      throw new Error(detail);
    }
    closeNavMenuModal();
    await loadNavMenuItems();
    var statusEl = document.getElementById('navMenuLiveStatus');
    if (statusEl){
      statusEl.textContent = '✓ ' + (id ? '수정' : '등록') + ' 완료 · 웹사이트에 최대 1분 내 반영';
      statusEl.style.color = '#27ae60';
      setTimeout(function(){ statusEl.textContent = ''; }, 5000);
    }
  } catch(e){
    console.error('[nav-menu] save failed:', e);
    showError('❌ 저장 실패\n\n' + (e && e.message || e));
  }
}

async function _toggleNavMenuActive(id){
  var target = menuCats.filter(function(x){ return x.id === id; })[0];
  if (!target) return;
  try {
    await apiPatch('/admin/nav-menu', { id: id, is_active: !target.is_active });
    await loadNavMenuItems();
  } catch(e){
    console.error('[nav-menu] toggle failed:', e);
    alert('상태 변경 실패: ' + (e && e.message || e));
  }
}

async function deleteNavMenuItem(id){
  var target = menuCats.filter(function(x){ return x.id === id; })[0];
  if (!target) return;
  var msg = '⚠️ 메뉴 항목 삭제\n\n';
  msg += '라벨: ' + (target.label_default || '') + '\n';
  msg += '링크: ' + (target.link_url || '') + '\n\n';
  msg += '삭제하면 웹사이트 햄버거 메뉴에서 즉시 제외됩니다.\n';
  msg += '이 작업은 되돌릴 수 없습니다.\n\n';
  msg += '삭제하시겠습니까?';
  if (!confirm(msg)) return;
  try {
    var resp = await apiDelete('/admin/nav-menu?id=' + encodeURIComponent(id));
    if (resp && resp.message && !resp.ok){
      throw new Error(resp.message);
    }
    await loadNavMenuItems();
    var statusEl = document.getElementById('navMenuLiveStatus');
    if (statusEl){
      statusEl.textContent = '✓ 삭제 완료';
      statusEl.style.color = '#27ae60';
      setTimeout(function(){ statusEl.textContent = ''; }, 3000);
    }
  } catch(e){
    console.error('[nav-menu] delete failed:', e);
    alert('❌ 삭제 실패: ' + (e && e.message || e));
  }
}

// 웹사이트 반영 상태 확인 (QA #315 패턴).
async function _verifyNavMenuLive(){
  var statusEl = document.getElementById('navMenuLiveStatus');
  var detailEl = document.getElementById('navMenuLiveDetail');
  function setStatus(msg, kind){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = kind === 'error' ? '#c0392b' : (kind === 'ok' ? '#27ae60' : 'var(--text3)');
  }
  setStatus('공개 API 확인 중…');
  if (detailEl){ detailEl.style.display = 'none'; detailEl.textContent = ''; }
  var url = API_BASE.replace(/\/$/, '') + '/nav-menu?_bust=' + Date.now();
  try {
    var r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    var age = r.headers.get('age') || '0';
    var xVercelCache = r.headers.get('x-vercel-cache') || 'UNKNOWN';
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var body = await r.json();
    var list = (body && body.data) || [];
    setStatus('✓ 웹사이트가 서빙 중인 활성 메뉴 ' + list.length + '개 · edge cache: ' + xVercelCache + (age !== '0' ? ' (age ' + age + 's)' : ''), list.length ? 'ok' : 'error');
    if (detailEl){
      detailEl.style.display = 'block';
      var lines = ['GET ' + url, '', 'X-Vercel-Cache: ' + xVercelCache, 'Age: ' + age + 's', '', '활성 메뉴 (' + list.length + '개):'];
      list.forEach(function(x, i){ lines.push('  ' + (i + 1) + '. [' + x.style + '] ' + x.label_default + '  →  ' + x.link_url); });
      var localActive = menuCats.filter(function(x){ return x.is_active; });
      lines.push('', '관리자 활성 (' + localActive.length + '개):');
      localActive.forEach(function(x, i){ lines.push('  ' + (i + 1) + '. [' + x.style + '] ' + x.label_default + '  →  ' + x.link_url); });
      var mismatch = (list.length !== localActive.length);
      if (!mismatch) for (var i = 0; i < list.length; i++) if (list[i].id !== localActive[i].id){ mismatch = true; break; }
      lines.push('', mismatch ? '⚠️ 관리자와 웹사이트 상태가 다릅니다. edge cache 갱신 대기 (최대 1분).' : '✅ 관리자와 웹사이트 상태가 일치합니다.');
      detailEl.textContent = lines.join('\n');
    }
  } catch(e){
    console.error('[nav-menu] verify failed:', e);
    setStatus('반영 상태 조회 실패: ' + (e && e.message || e), 'error');
  }
}

// Legacy 별칭 유지 (호환용).
function addMenuCat(){ openNavMenuModal(null); }
function editMenuCat(id){ openNavMenuModal(id); }
function deleteMenuCat(id){ deleteNavMenuItem(id); }

// 초기 로드.
loadNavMenuItems();

// QA #301 — 인스타그램 핸들 입력 onblur 자동 정규화.
// 운영자가 '@' 없이 'johnkim' 만 입력해도 blur 시점에 '@johnkim' 으로
// 자동 보강 → 서버 정규화(_lib/credits.normalizeCreditsArray) 와 일관 +
// 운영자가 시각적으로 즉시 확인 가능. URL 형태는 건드리지 않음.
// blur 이벤트는 bubble 하지 않으므로 capture: true 필수.
document.addEventListener('blur', function(e){
  if(!e.target || !e.target.classList) return;
  if(!e.target.classList.contains('pe-credit-ig')) return;
  var v = String(e.target.value || '').trim();
  if(!v) return;
  if(/^https?:\/\//i.test(v)) return;  // URL 은 그대로
  if(/^@/.test(v)) return;             // 이미 @ 있음
  e.target.value = '@' + v.replace(/^@+/, '');
  try { e.target.dispatchEvent(new Event('change', { bubbles: true })); } catch(_){}
}, true);

// ======== COVER SETTINGS (QA #295) ========
//
// 그룹 + 이미지(1:N) 모델. 각 카드 = 하나의 발행호 (issue + title +
// link_url 1회 입력) + 그 안에 N장의 이미지 (각각 ↑↓/삭제 가능).
//
// 데이터 형태:
//   coverGroups = [
//     {
//       id: uuid|null,           // DB의 cover_groups.id (새로 만든 그룹은 null)
//       issue: 'JULY ISSUE',
//       title: 'Masquerade',
//       link_url: '/editorial/masquerade',
//       sort_order: 0,
//       is_active: true,
//       images: [
//         { id: uuid|null, image_url: 'https://...', sort_order: 0 },
//         ...
//       ]
//     }
//   ]
//
// 저장은 그룹 단위. 사용자가 카드의 "이 그룹 저장" 버튼을 누르면 그
// 그룹만 POST/PUT 으로 Supabase 와 동기화. 이미지 업로드는 기존
// uploadFile() (Supabase Storage) 를 재사용.
//
// 기존 localStorage 만 쓰던 coverSlides 와 호환 X — admin 첫 방문 시
// /api/admin/banners 에서 server-truth 를 로딩.

var coverGroups = [];
var coverGroupsLoaded = false;

function _coverEscapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── QA #299 목록 페이지 상태 ───────────────────────────────────────
var _coverSearch = '';
var _coverStatusFilter = 'all';   // all | public | scheduled | draft | ended
var _coverActiveEditGi = -1;      // 현재 펼쳐서 편집 중인 그룹 인덱스 (-1=없음)

function _coverComputeStatus(g){
  // 상태 우선순위: ended > draft > scheduled > public
  if(!g) return 'draft';
  if(g.ended_at){
    var et = new Date(g.ended_at).getTime();
    if(!isNaN(et) && et <= Date.now()) return 'ended';
  }
  if(g.is_active === false) return 'draft';
  if(g.scheduled_publish_at){
    var st = new Date(g.scheduled_publish_at).getTime();
    if(!isNaN(st) && st > Date.now()) return 'scheduled';
  }
  return 'public';
}

function _coverStatusBadgeHtml(status){
  var styles = {
    'public':    { color:'#fff', bg:'#27ae60', label:'공개' },
    'scheduled': { color:'#fff', bg:'#2980b9', label:'⏰ 예약' },
    'draft':     { color:'#fff', bg:'#7f8c8d', label:'📦 임시저장' },
    'ended':     { color:'#fff', bg:'#34495e', label:'종료' }
  };
  var s = styles[status] || styles['draft'];
  return '<span style="font-size:10px;padding:3px 9px;border-radius:3px;color:'+s.color+';background:'+s.bg+';white-space:nowrap">'+s.label+'</span>';
}

function _coverFormatDateShort(v){
  if(!v) return '<span style="color:var(--text3)">—</span>';
  var d = new Date(v);
  if(isNaN(d.getTime())) return '<span style="color:var(--text3)">—</span>';
  var pad = function(n){ return n<10 ? '0'+n : ''+n; };
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
    + ' <span style="color:var(--text3)">' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</span>';
}

function _coverGroupAuthor(g){
  var who = g && (g._editor || g._creator);
  if(who && who.display_name) return _coverEscapeHtml(who.display_name);
  if(who && who.email) return _coverEscapeHtml(String(who.email).split('@')[0]);
  return '<span style="color:var(--text3)">—</span>';
}

function _coverOnSearchInput(v){
  _coverSearch = String(v || '').trim().toLowerCase();
  renderCovers();
}
function _coverOnStatusFilter(v){
  _coverStatusFilter = v || 'all';
  renderCovers();
}

function toggleCoverEdit(gi){
  if(_coverActiveEditGi === gi){
    _coverActiveEditGi = -1;
  } else {
    _coverActiveEditGi = gi;
  }
  renderCovers();
}

function renderCovers(){
  var el = document.getElementById('coverList');
  if(!el) return;

  if(!coverGroupsLoaded){
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">불러오는 중…</div>';
    return;
  }

  // ── 상단: 검색 + 상태 필터 + 추가 버튼 ────────────────────────────
  var statusCounts = { all: 0, public: 0, scheduled: 0, draft: 0, ended: 0 };
  coverGroups.forEach(function(g){
    statusCounts.all += 1;
    var s = _coverComputeStatus(g);
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  var html = '';
  html += '<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">';
  html += '<input type="text" placeholder="제목 / 발행호 검색" value="'+_coverEscapeHtml(_coverSearch)+'" '
    + 'oninput="_coverOnSearchInput(this.value)" '
    + 'style="flex:1;min-width:200px;padding:7px 10px;font-size:13px;border:1px solid var(--border);background:var(--surface)">';
  html += '<select onchange="_coverOnStatusFilter(this.value)" '
    + 'style="padding:7px 10px;font-size:12px;border:1px solid var(--border);background:var(--surface)">'
    + '<option value="all"'      + (_coverStatusFilter==='all'?' selected':'')      + '>전체 ('+statusCounts.all+')</option>'
    + '<option value="public"'   + (_coverStatusFilter==='public'?' selected':'')   + '>공개 ('+statusCounts.public+')</option>'
    + '<option value="scheduled"'+ (_coverStatusFilter==='scheduled'?' selected':'')+ '>예약 ('+statusCounts.scheduled+')</option>'
    + '<option value="draft"'    + (_coverStatusFilter==='draft'?' selected':'')    + '>임시저장 ('+statusCounts.draft+')</option>'
    + '<option value="ended"'    + (_coverStatusFilter==='ended'?' selected':'')    + '>종료 ('+statusCounts.ended+')</option>'
    + '</select>';
  html += '<button class="btn" onclick="addCoverGroup()">+ 새 배너 추가</button>';
  html += '</div>';

  // ── 행 필터링 ─────────────────────────────────────────────────────
  var rows = coverGroups.map(function(g, gi){ return { g: g, gi: gi, status: _coverComputeStatus(g) }; });
  if(_coverStatusFilter !== 'all'){
    rows = rows.filter(function(r){ return r.status === _coverStatusFilter; });
  }
  if(_coverSearch){
    rows = rows.filter(function(r){
      var hay = ((r.g.title || '') + ' ' + (r.g.issue || '')).toLowerCase();
      return hay.indexOf(_coverSearch) !== -1;
    });
  }

  // ── 빈 상태 ───────────────────────────────────────────────────────
  if(coverGroups.length === 0){
    html += '<div style="padding:60px;text-align:center;color:var(--text3);border:1px dashed var(--border);background:var(--surface)">'
      + '등록된 배너 그룹이 없습니다.<br><br>'
      + '<button class="btn" onclick="addCoverGroup()">+ 첫 그룹 추가</button>'
      + '</div>';
    el.innerHTML = html;
    return;
  }
  if(rows.length === 0){
    html += '<div style="padding:50px;text-align:center;color:var(--text3);border:1px dashed var(--border)">'
      + '검색 / 필터 조건에 맞는 배너가 없습니다.</div>';
    el.innerHTML = html;
    return;
  }

  // ── 테이블 ─────────────────────────────────────────────────────────
  html += '<div style="background:var(--surface);border:1px solid var(--border);overflow:hidden">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr style="background:rgba(0,0,0,.04);border-bottom:1px solid var(--border)">'
    + '<th style="text-align:left;padding:10px 12px;font-weight:700;color:var(--text2);width:30%">제목</th>'
    + '<th style="text-align:left;padding:10px 12px;font-weight:700;color:var(--text2);width:90px">상태</th>'
    + '<th style="text-align:left;padding:10px 12px;font-weight:700;color:var(--text2);width:140px">작성일</th>'
    + '<th style="text-align:left;padding:10px 12px;font-weight:700;color:var(--text2);width:140px">예약일</th>'
    + '<th style="text-align:left;padding:10px 12px;font-weight:700;color:var(--text2);width:110px">작성자</th>'
    + '<th style="text-align:left;padding:10px 12px;font-weight:700;color:var(--text2);width:140px">최종 수정일</th>'
    + '<th style="text-align:right;padding:10px 12px;font-weight:700;color:var(--text2);width:140px">작업</th>'
    + '</tr></thead><tbody>';

  rows.forEach(function(r){
    var g = r.g, gi = r.gi;
    var isOpen = _coverActiveEditGi === gi;
    var imageCount = Array.isArray(g.images) ? g.images.length : 0;
    var titleCell = '<div style="font-weight:600;color:var(--text1)">' + _coverEscapeHtml(g.title || '(제목 없음)') + '</div>'
      + (g.issue ? '<div style="font-size:10px;color:var(--text3);margin-top:2px">' + _coverEscapeHtml(g.issue) + '</div>' : '')
      + '<div style="font-size:10px;color:var(--text3);margin-top:2px">🖼 ' + imageCount + '장</div>';

    html += '<tr style="border-bottom:1px solid var(--border);' + (isOpen ? 'background:rgba(46,204,113,.06)' : '') + '">'
      + '<td style="padding:10px 12px;vertical-align:top">' + titleCell + '</td>'
      + '<td style="padding:10px 12px;vertical-align:top">' + _coverStatusBadgeHtml(r.status) + '</td>'
      + '<td style="padding:10px 12px;vertical-align:top;color:var(--text2)">' + _coverFormatDateShort(g.created_at) + '</td>'
      + '<td style="padding:10px 12px;vertical-align:top;color:var(--text2)">' + (g.scheduled_publish_at ? _coverFormatDateShort(g.scheduled_publish_at) : '<span style="color:var(--text3)">—</span>') + '</td>'
      + '<td style="padding:10px 12px;vertical-align:top;color:var(--text2)">' + _coverGroupAuthor(g) + '</td>'
      + '<td style="padding:10px 12px;vertical-align:top;color:var(--text2)">' + _coverFormatDateShort(g.updated_at) + '</td>'
      + '<td style="padding:10px 12px;vertical-align:top;text-align:right">'
      +   '<button class="btn btn-sm" onclick="toggleCoverEdit('+gi+')">'+ (isOpen ? '접기' : '수정') +'</button> '
      +   '<button class="btn btn-sm btn-red" onclick="deleteCoverGroup('+gi+')">삭제</button>'
      + '</td>'
      + '</tr>';

    // 펼친 편집 카드 → 같은 테이블에 colspan 행으로 inline 노출.
    if(isOpen){
      html += '<tr style="background:#fff"><td colspan="7" style="padding:0;border-bottom:1px solid var(--border)">'
        + '<div style="padding:0">' + _coverRenderEditCard(g, gi) + '</div>'
        + '</td></tr>';
    }
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// ─── QA #299 편집 카드 HTML (기존 renderCovers 카드 부분을 분리) ───
// 펼쳐진 한 그룹에 대해서만 호출됨. 반환값은 그대로 외부에서 innerHTML.
function _coverRenderEditCard(g, gi){
  var issueVal = _coverEscapeHtml(g.issue || '');
  var titleVal = _coverEscapeHtml(g.title || '');
  var linkVal  = _coverEscapeHtml(g.link_url || '');
  // ── 게시 상태 배지 ────────────────────────────────────────────────
  var statusInitial = _coverComputeStatusInitial(gi, g);
  var statusBadge = '<span data-cover-status '
    + 'style="font-size:10px;color:'+statusInitial.color+';padding:2px 8px;background:'+statusInitial.bg+';border-radius:3px">'
    + statusInitial.label + '</span>';

  var html = '<div data-cover-card="'+gi+'" style="background:var(--surface);padding:20px;border-top:2px solid #27ae60">';

  // 헤더 (발행호/제목/링크 + 그룹 액션)
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;gap:12px">';
  html += '<div style="flex:1">';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
    + '<span style="font-size:11px;font-weight:700;color:var(--text2)">배너 그룹 ' + (gi+1) + '</span>'
    + statusBadge + '</div>';
  html += '<div style="display:grid;grid-template-columns:80px 1fr;gap:10px 14px;align-items:center">';
  html += '<label style="font-size:11px;font-weight:700;color:var(--text3)">발행호</label>'
    + '<input class="pe-input" value="'+issueVal+'" placeholder="예: JULY ISSUE"'
    + ' onchange="coverGroups['+gi+'].issue=this.value;_coverMarkDirty('+gi+')">';
  html += '<label style="font-size:11px;font-weight:700;color:var(--text3)">제목</label>'
    + '<input class="pe-input" value="'+titleVal+'" placeholder="예: Masquerade (필수)"'
    + ' onchange="coverGroups['+gi+'].title=this.value;_coverMarkDirty('+gi+')">';
  html += '<label style="font-size:11px;font-weight:700;color:var(--text3)">링크</label>'
    + '<div style="display:flex;gap:6px;align-items:center">'
    +   '<input class="pe-input" value="'+linkVal+'" placeholder="클릭 시 이동할 URL (예: /editorial/masquerade)"'
    +     ' style="flex:1" onchange="coverGroups['+gi+'].link_url=this.value;_coverMarkDirty('+gi+')">'
    +   '<button class="btn btn-sm" style="white-space:nowrap" '
    +     'onclick="openCoverEditorialPicker('+gi+')" title="발행된 에디토리얼을 검색해서 자동 연결">📰 에디토리얼 연결</button>'
    + '</div>';
  html += '</div>';
  html += '</div>';

  // 게시 모드 + 예약 일시 + 액션 버튼
  var mode = _coverDeriveMode(g);
  var schedDisplay = _coverDatetimeForInput(g.scheduled_publish_at);
  html += '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;min-width:220px">';
  html += '<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-end;font-size:11px">'
    + '<label class="pe-check" style="white-space:nowrap;font-weight:600"><input type="radio" name="coverMode_'+gi+'" value="public" '
    +   (mode === 'public' ? 'checked' : '')
    +   ' onchange="_coverSetMode('+gi+',\'public\')"> 공개 (즉시 노출)</label>'
    + '<label class="pe-check" style="white-space:nowrap;font-weight:600"><input type="radio" name="coverMode_'+gi+'" value="scheduled" '
    +   (mode === 'scheduled' ? 'checked' : '')
    +   ' onchange="_coverSetMode('+gi+',\'scheduled\')"> ⏰ 예약 발행</label>'
    + '<label class="pe-check" style="white-space:nowrap;font-weight:600"><input type="radio" name="coverMode_'+gi+'" value="draft" '
    +   (mode === 'draft' ? 'checked' : '')
    +   ' onchange="_coverSetMode('+gi+',\'draft\')"> 📦 임시저장</label>'
    + '</div>';
  html += '<div style="display:'+(mode === 'scheduled' ? 'flex' : 'none')+';flex-direction:column;gap:2px;width:100%">'
    + '<input type="datetime-local" value="'+schedDisplay+'" '
    +   'onchange="coverGroups['+gi+'].scheduled_publish_at=this.value;_coverMarkDirty('+gi+')" '
    +   'style="font-size:11px;padding:4px 6px;border:1px solid var(--border)">'
    + '<span style="font-size:10px;color:var(--text3);text-align:right">현지 시간 기준 · 시점 도래 시 자동 노출</span>'
    + '</div>';
  // QA #299 — 운영 종료 일시 (선택 입력). 운영 종료 시점을 미리 예약해두면 hero 에서 자동 사라짐.
  var endedDisplay = _coverDatetimeForInput(g.ended_at);
  html += '<div style="display:flex;flex-direction:column;gap:2px;width:100%;margin-top:4px;border-top:1px dashed var(--border);padding-top:6px">'
    + '<label style="font-size:10px;color:var(--text3)">운영 종료 (선택)</label>'
    + '<input type="datetime-local" value="'+endedDisplay+'" '
    +   'onchange="coverGroups['+gi+'].ended_at=this.value;_coverMarkDirty('+gi+')" '
    +   'style="font-size:11px;padding:4px 6px;border:1px solid var(--border)">'
    + '<div style="font-size:10px;color:var(--text3);text-align:right;display:flex;gap:6px;justify-content:flex-end">'
    +   '<a href="#" onclick="event.preventDefault();coverGroups['+gi+'].ended_at=null;_coverMarkDirty('+gi+');renderCovers()" style="color:var(--text3)">비우기</a>'
    +   '<a href="#" onclick="event.preventDefault();coverGroups['+gi+'].ended_at=new Date().toISOString();_coverMarkDirty('+gi+');renderCovers()" style="color:#e74c3c">지금 종료</a>'
    + '</div>'
    + '</div>';
  html += '<div style="display:flex;gap:4px;margin-top:4px">'
    + '<button class="btn btn-sm" style="background:#2c3e50;color:#fff" onclick="saveCoverGroup('+gi+')">저장</button>'
    + '<button class="btn btn-sm" onclick="toggleCoverEdit('+gi+')">닫기</button>'
    + '</div>';
  html += '</div>';
  html += '</div>'; // /header row

  // 이미지 영역 (PC + 모바일 슬롯, 드래그&드롭) ─ 기존 코드 그대로 복사용
  html += _coverRenderImagesArea(g, gi);

  html += '</div>'; // /card
  return html;
}

function _coverRenderImagesArea(g, gi){
  var html = '';
    // ── 이미지 영역 (QA #296: PC/모바일 듀얼 슬롯) ─────────────────────
    html += '<div style="border-top:1px solid var(--border);padding-top:14px;margin-top:14px">';

    // 헤더: 카운트 + 규격 안내 + 추가 버튼
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:12px;flex-wrap:wrap">'
      + '<div>'
      +   '<div style="font-size:11px;font-weight:700;color:var(--text2)">슬라이드 ('+g.images.length+'장)</div>'
      +   '<div style="font-size:10px;color:var(--text3);margin-top:3px">권장 규격 · PC <strong>1920×1080</strong> (16:9) · 모바일 <strong>1080×1920</strong> (9:16) · 각 <strong>2MB</strong> 이하 (JPG/PNG/WebP)</div>'
      + '</div>'
      + '<button class="btn btn-sm" onclick="addCoverImage('+gi+')">+ 슬라이드 추가</button>'
      + '</div>';

    // 드래그&드롭 영역 안내 + 슬라이드 리스트 컨테이너
    html += '<div data-cover-drop="'+gi+'" '
      + 'ondragover="_coverHandleDragOver(event,'+gi+')" '
      + 'ondragleave="_coverHandleDragLeave(event,'+gi+')" '
      + 'ondrop="_coverHandleDrop(event,'+gi+')" '
      + 'style="border:2px dashed var(--border);border-radius:4px;padding:14px;transition:background .15s,border-color .15s">';

    if(g.images.length === 0){
      html += '<div style="padding:24px;text-align:center;color:var(--text3);font-size:12px">'
        + '이미지를 1장 이상 등록해야 라이브에 노출됩니다.<br>'
        + '<span style="font-size:11px">PC 이미지를 이 영역에 <strong>드래그&amp;드롭</strong>하시거나 위의 + 슬라이드 추가 버튼을 사용하세요. 여러 장 동시 드롭도 가능합니다.</span>'
        + '</div>';
    } else {
      // 각 슬라이드 = PC 슬롯 + 모바일 슬롯 + 액션 버튼
      html += '<div style="display:flex;flex-direction:column;gap:12px">';
      g.images.forEach(function(img, ii){
        var pcSrc      = img.image_url || '';
        var mobSrc     = img.image_url_mobile || '';
        var pcUploading  = img._uploading_pc;
        var mobUploading = img._uploading_mobile;
        var pcError    = img._error_pc;
        var mobError   = img._error_mobile;

        html += '<div style="display:flex;gap:12px;align-items:stretch;border:1px solid var(--border);background:#fff;padding:10px;border-radius:4px">';
        html += '<div style="display:flex;flex-direction:column;justify-content:center;font-size:10px;color:var(--text3);font-weight:700;width:24px">#' + (ii+1) + '</div>';

        // ── PC 슬롯 (16:9) ─────────────────────────────────────────────
        html += '<div style="flex:1.6;display:flex;flex-direction:column;gap:4px">';
        html += '<div style="font-size:10px;font-weight:700;color:var(--text2)">PC <span style="color:var(--text3);font-weight:400">· 1920×1080 권장</span></div>';
        html += '<div style="position:relative;aspect-ratio:16/9;background:#f3f3f3;border:1px solid var(--border);cursor:pointer" '
          + 'onclick="replaceCoverImage('+gi+','+ii+',\'pc\')" '
          + 'title="클릭하여 PC 이미지 교체">';
        if(pcSrc){
          html += '<img loading="lazy" src="'+_coverEscapeHtml(pcSrc)+'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block">';
        } else {
          html += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:11px">+ PC 이미지</div>';
        }
        if(pcUploading){
          html += '<div style="position:absolute;inset:0;background:rgba(0,0,0,.55);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px">업로드 중…</div>';
        }
        html += '</div>';
        if(pcError){
          html += '<div style="font-size:10px;color:#e74c3c">⚠ ' + _coverEscapeHtml(pcError) + '</div>';
        }
        html += '</div>';

        // ── 모바일 슬롯 (9:16) ──────────────────────────────────────────
        html += '<div style="flex:0.6;display:flex;flex-direction:column;gap:4px;max-width:120px">';
        html += '<div style="font-size:10px;font-weight:700;color:var(--text2)">모바일 <span style="color:var(--text3);font-weight:400">· 1080×1920 권장 (옵션)</span></div>';
        html += '<div style="position:relative;aspect-ratio:9/16;background:#f3f3f3;border:1px solid var(--border);cursor:pointer" '
          + 'onclick="replaceCoverImage('+gi+','+ii+',\'mobile\')" '
          + 'title="클릭하여 모바일 이미지 등록/교체">';
        if(mobSrc){
          html += '<img loading="lazy" src="'+_coverEscapeHtml(mobSrc)+'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block">';
        } else {
          html += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:11px;text-align:center;padding:6px">+ 모바일<br><span style="font-size:9px;font-weight:400">(생략 시 PC 사용)</span></div>';
        }
        if(mobUploading){
          html += '<div style="position:absolute;inset:0;background:rgba(0,0,0,.55);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px">업로드 중…</div>';
        }
        html += '</div>';
        if(mobError){
          html += '<div style="font-size:10px;color:#e74c3c">⚠ ' + _coverEscapeHtml(mobError) + '</div>';
        }
        html += '</div>';

        // ── 액션 버튼 (순서/모바일 제거/삭제) ───────────────────────────
        html += '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;justify-content:center">';
        html += '<div style="display:flex;gap:2px">'
          + '<button class="btn btn-sm" style="padding:2px 6px" title="위로" onclick="moveCoverImage('+gi+','+ii+',-1)">↑</button>'
          + '<button class="btn btn-sm" style="padding:2px 6px" title="아래로" onclick="moveCoverImage('+gi+','+ii+',1)">↓</button>'
          + '</div>';
        if(mobSrc){
          html += '<button class="btn btn-sm" style="padding:2px 6px;font-size:10px" title="모바일 이미지만 비우기" onclick="clearMobileImage('+gi+','+ii+')">📱✕</button>';
        }
        html += '<button class="btn btn-sm btn-red" style="padding:2px 8px" title="이 슬라이드 삭제" onclick="deleteCoverImage('+gi+','+ii+')">삭제</button>';
        html += '</div>';

        html += '</div>'; // /slide row
      });
      html += '</div>';
    }

    html += '</div>'; // /drop zone
    html += '</div>'; // /image area
  return html;
}

// "이 그룹은 저장이 필요합니다" 시각적 표시 ─ 카드 보더 + status 배지.
// QA #297: dirty set 에 추가해서 beforeunload 경고도 트리거.
function _coverMarkDirty(gi){
  _coverDirtyGroups.add(gi);
  var card = document.querySelector('[data-cover-card="'+gi+'"]');
  if(card) card.style.borderColor = '#e67e22';
  if(typeof _coverUpdateCardStatus === 'function'){
    _coverUpdateCardStatus(gi, 'dirty');
  }
}

// ─── 그룹 액션 ────────────────────────────────────────────────────────
function addCoverGroup(){
  coverGroups.push({
    id: null,
    issue: 'NEW ISSUE',
    title: '새 커버',
    link_url: '',
    sort_order: coverGroups.length,
    is_active: true,
    scheduled_publish_at: null,  // QA #298
    images: []
  });
  renderCovers();
}

// ─── QA #298 게시 모드 헬퍼 ────────────────────────────────────────────
// 모드 = 'public' | 'scheduled' | 'draft'  (저장은 is_active +
// scheduled_publish_at 2개 컬럼 조합). UI 만 모드를 보여주고, 저장
// 데이터는 기존 2개 필드 그대로 사용 ─ DB 스키마 추가 변경 없음.
function _coverDeriveMode(g){
  if(!g) return 'public';
  if(g.is_active === false) return 'draft';
  if(g.scheduled_publish_at){
    var t = new Date(g.scheduled_publish_at).getTime();
    if(!isNaN(t) && t > Date.now()) return 'scheduled';
  }
  return 'public';
}

function _coverSetMode(gi, mode){
  var g = coverGroups[gi];
  if(!g) return;
  if(mode === 'draft'){
    g.is_active = false;
    // scheduled_publish_at 은 보존 (사용자가 임시저장 → 다시 예약 모드로
    // 돌아갔을 때 입력값이 사라지지 않도록).
  } else if(mode === 'scheduled'){
    g.is_active = true;
    // 예약 일시가 비어있거나 과거이면 기본값 = 현재 시간 + 24h.
    var t = g.scheduled_publish_at ? new Date(g.scheduled_publish_at).getTime() : 0;
    if(!t || isNaN(t) || t <= Date.now()){
      var d = new Date(Date.now() + 24 * 60 * 60 * 1000);
      // YYYY-MM-DDTHH:MM (로컬 timezone)
      g.scheduled_publish_at = _coverDatetimeForInput(d);
    }
  } else { // public
    g.is_active = true;
    g.scheduled_publish_at = null;
  }
  _coverMarkDirty(gi);
  renderCovers();
}

// datetime-local input 의 value 포맷 (YYYY-MM-DDTHH:MM, 로컬 timezone).
function _coverDatetimeForInput(value){
  if(!value) return '';
  var d = (value instanceof Date) ? value : new Date(value);
  if(isNaN(d.getTime())) return '';
  var pad = function(n){ return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// 카드 헤더 statusBadge 초기 값 계산 (저장된 경우 모드별 색상).
function _coverComputeStatusInitial(gi, g){
  if(_coverDirtyGroups.has(gi)){
    return { color:'#e67e22', bg:'#fef5e7', label:'미저장 (저장 버튼을 눌러주세요)' };
  }
  if(!g.id){
    return { color:'#e67e22', bg:'#fef5e7', label:'미저장 (저장 버튼을 눌러주세요)' };
  }
  var mode = _coverDeriveMode(g);
  if(mode === 'draft'){
    return { color:'#7f8c8d', bg:'#ecf0f1', label:'📦 임시저장' };
  }
  if(mode === 'scheduled'){
    var t = new Date(g.scheduled_publish_at);
    var label = '⏰ 예약: ' + _coverFormatScheduledLabel(t);
    return { color:'#2980b9', bg:'#eaf4fb', label: label };
  }
  return { color:'#27ae60', bg:'#eafaf1', label:'공개 중' };
}

function _coverFormatScheduledLabel(d){
  if(!d || isNaN(d.getTime())) return '';
  var pad = function(n){ return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function deleteCoverGroup(gi){
  var g = coverGroups[gi];
  if(!g) return;
  if(!confirm('"' + (g.title || g.issue || '그룹 ' + (gi+1)) + '" 배너 그룹을 삭제하시겠습니까?\n그룹 안의 모든 이미지도 함께 삭제됩니다.')) return;

  if(!g.id){
    // 서버에 저장된 적이 없는 그룹 — 로컬에서만 제거.
    coverGroups.splice(gi, 1);
    renderCovers();
    return;
  }

  fetch('/api/admin/banners?id=' + encodeURIComponent(g.id), {
    method: 'DELETE',
    headers: _papAuthHeaders()
  }).then(function(r){
    if(!r.ok) throw new Error('delete failed');
    coverGroups.splice(gi, 1);
    renderCovers();
  }).catch(function(err){
    console.error('[cover] delete failed', err);
    alert('삭제에 실패했습니다. 다시 시도해주세요.');
  });
}

function moveCoverGroup(gi, dir){
  var nj = gi + dir;
  if(nj < 0 || nj >= coverGroups.length) return;
  var tmp = coverGroups[gi];
  coverGroups[gi] = coverGroups[nj];
  coverGroups[nj] = tmp;
  coverGroups[gi].sort_order = gi;
  coverGroups[nj].sort_order = nj;
  renderCovers();
  // 서버 저장은 각 그룹의 "저장" 버튼으로 ─ 순서가 dirty 되었음만 표시.
  _coverMarkDirty(gi);
  _coverMarkDirty(nj);
}

function saveCoverGroup(gi){
  var g = coverGroups[gi];
  if(!g) return;
  if(!String(g.title || '').trim()){
    alert('제목은 필수입니다.');
    return;
  }
  var imgsForSave = g.images
    .filter(function(im){ return im.image_url; })
    .map(function(im, idx){
      return {
        image_url: im.image_url,
        image_url_mobile: im.image_url_mobile || null,  // QA #296
        sort_order: idx
      };
    });

  // QA #298 — 예약 일시 validation. 예약 모드인데 일시가 비어있으면 거부.
  var mode = _coverDeriveMode(g);
  if(mode === 'scheduled' && !g.scheduled_publish_at){
    alert('예약 발행을 선택했지만 예약 일시가 비어 있습니다.\n일시를 입력하거나 다른 모드를 선택해주세요.');
    return;
  }
  var schedIso = null;
  if(g.scheduled_publish_at){
    var sd = new Date(g.scheduled_publish_at);
    if(!isNaN(sd.getTime())) schedIso = sd.toISOString();
  }

  var payload = {
    issue: g.issue || null,
    title: g.title,
    link_url: g.link_url || null,
    sort_order: gi,
    is_active: g.is_active !== false,
    scheduled_publish_at: schedIso,  // QA #298
    images: imgsForSave
  };

  var isUpdate = !!g.id;
  if(isUpdate) payload.id = g.id;

  // QA #297 — 저장 시작 즉시 배지를 'saving' 으로 갱신 (사용자 피드백).
  _coverUpdateCardStatus(gi, 'saving');

  fetch('/api/admin/banners', {
    method: isUpdate ? 'PUT' : 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, _papAuthHeaders()),
    body: JSON.stringify(payload)
  }).then(function(r){
    if(!r.ok){
      // 본문에 message 가 있으면 사용자에게 그대로.
      return r.text().then(function(t){
        var msg = '';
        try { var j = JSON.parse(t); msg = j && j.message; } catch(_){}
        throw new Error(msg || ('HTTP ' + r.status));
      });
    }
    return r.json();
  }).then(function(json){
    if(json && json.data){
      coverGroups[gi].id = json.data.id;
      // QA #298 — 서버가 정규화한 scheduled_publish_at 으로 클라이언트 값을
      // 다시 동기화 (서버 시각 기준 ISO).
      coverGroups[gi].scheduled_publish_at = json.data.scheduled_publish_at || null;
      coverGroups[gi].ended_at = json.data.ended_at || null;  // QA #299
      coverGroups[gi].is_active = json.data.is_active !== false;
      // QA #299 — 작성자/수정자/타임스탬프도 서버 값으로 동기화 (목록 컬럼 즉시 반영).
      coverGroups[gi].created_at = json.data.created_at || coverGroups[gi].created_at;
      coverGroups[gi].updated_at = json.data.updated_at || coverGroups[gi].updated_at;
      coverGroups[gi].created_by = json.data.created_by || coverGroups[gi].created_by;
      coverGroups[gi].updated_by = json.data.updated_by || coverGroups[gi].updated_by;
      if(json.data._creator) coverGroups[gi]._creator = json.data._creator;
      if(json.data._editor)  coverGroups[gi]._editor  = json.data._editor;
      if(Array.isArray(json.data.images)){
        coverGroups[gi].images = json.data.images.map(function(im){
          return {
            id: im.id || null,
            image_url: im.image_url,
            image_url_mobile: im.image_url_mobile || null,  // QA #296
            sort_order: im.sort_order || 0
          };
        });
      }
    }
    // QA #297 — 이 그룹의 dirty flag clear → 모두 비면 beforeunload 도 OK.
    _coverDirtyGroups.delete(gi);
    var card = document.querySelector('[data-cover-card="' + gi + '"]');
    if(card) card.style.borderColor = '';
    renderCovers();
    _coverUpdateCardStatus(gi, 'saved-ok');
  }).catch(function(err){
    console.error('[cover] save failed', err);
    var msg = (err && err.message) ? err.message : '알 수 없는 오류';
    _coverUpdateCardStatus(gi, 'error', msg);
    // 인라인 배지 외에도 명확히 alert ─ 다른 그룹으로 옮겨가도 잊지 않도록.
    alert('저장에 실패했습니다.\n\n사유: ' + msg + '\n\n다시 시도해주세요. 문제가 지속되면 새로고침 후 재시도해주세요.');
  });
}

// ─── 이미지 액션 ──────────────────────────────────────────────────────
// QA #296 — 다중 파일 입력, PC/모바일 슬롯, 드래그&드롭, validation.

var _COVER_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
var _COVER_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// 단일 파일 검증 ─ 통과시 null, 실패시 한국어 에러 메시지.
function _coverValidateFile(file){
  if(!file) return '파일을 선택해주세요.';
  if(_COVER_ALLOWED_TYPES.indexOf(file.type) === -1){
    return 'JPG, PNG, WebP 파일만 업로드할 수 있습니다.';
  }
  if(file.size > _COVER_MAX_BYTES){
    var mb = (file.size / 1024 / 1024).toFixed(1);
    return '파일이 너무 큽니다 (' + mb + ' MB). 2MB 이하로 줄여주세요.';
  }
  return null;
}

// 다중 파일 input 다이얼로그 ─ 사용자가 한 번에 여러 장 선택 가능.
function _coverPickFiles(multiple, cb){
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = _COVER_ALLOWED_TYPES.join(',');
  if(multiple) input.multiple = true;
  input.onchange = function(){
    if(this.files && this.files.length) cb(Array.prototype.slice.call(this.files));
  };
  input.click();
}

// 한 슬라이드의 특정 슬롯(pc|mobile)에 파일 업로드. 슬라이드가 없으면
// (slot 인덱스 == 그룹 이미지 길이) 새 슬라이드를 만든 뒤 업로드.
function _coverUploadToSlot(gi, ii, slot, file){
  if(typeof uploadFile !== 'function'){
    alert('uploadFile 헬퍼를 찾을 수 없습니다.');
    return;
  }
  var validation = _coverValidateFile(file);
  if(validation){
    // 슬라이드가 존재할 때만 인라인 에러 표시. 없으면 알림.
    var existing = coverGroups[gi].images[ii];
    if(existing){
      existing[slot === 'mobile' ? '_error_mobile' : '_error_pc'] = validation;
      renderCovers();
    } else {
      alert(validation);
    }
    return;
  }

  // 슬라이드가 없으면 만들어준다 (PC 신규 업로드 흐름).
  if(!coverGroups[gi].images[ii]){
    coverGroups[gi].images[ii] = {
      image_url: '', image_url_mobile: null,
      sort_order: coverGroups[gi].images.length
    };
  }
  var target = coverGroups[gi].images[ii];
  var uploadKey = slot === 'mobile' ? '_uploading_mobile' : '_uploading_pc';
  var errorKey  = slot === 'mobile' ? '_error_mobile'     : '_error_pc';
  target[uploadKey] = true;
  target[errorKey]  = null;
  renderCovers();

  uploadFile(file).then(function(publicUrl){
    if(slot === 'mobile') target.image_url_mobile = publicUrl;
    else                  target.image_url = publicUrl;
    target[uploadKey] = false;
    _coverMarkDirty(gi);
    renderCovers();
  }).catch(function(err){
    console.error('[cover] upload failed', err);
    target[uploadKey] = false;
    target[errorKey]  = '업로드에 실패했습니다. 다시 시도해주세요.';
    // 빈 PC slot 으로 만들어진 임시 슬라이드는 정리.
    if(slot === 'pc' && !target.image_url){
      coverGroups[gi].images.splice(ii, 1);
    }
    renderCovers();
  });
}

// PC 슬롯에 N장을 한 번에 — 각 파일이 새 슬라이드를 차지. drag&drop /
// 다중 파일 input 양쪽에서 사용.
function _coverUploadPcBatch(gi, files){
  files.forEach(function(file){
    var newIndex = coverGroups[gi].images.length;
    _coverUploadToSlot(gi, newIndex, 'pc', file);
  });
}

function addCoverImage(gi){
  _coverPickFiles(true, function(files){
    _coverUploadPcBatch(gi, files);
  });
}

// slot: 'pc' | 'mobile'. 슬라이드의 해당 슬롯 이미지를 교체.
function replaceCoverImage(gi, ii, slot){
  slot = slot || 'pc';
  _coverPickFiles(false, function(files){
    _coverUploadToSlot(gi, ii, slot, files[0]);
  });
}

function clearMobileImage(gi, ii){
  var img = coverGroups[gi].images[ii];
  if(!img) return;
  img.image_url_mobile = null;
  img._error_mobile = null;
  _coverMarkDirty(gi);
  renderCovers();
}

function deleteCoverImage(gi, ii){
  if(!confirm('이 슬라이드를 그룹에서 제거하시겠습니까?\n(그룹 저장 후 영구 반영됩니다)')) return;
  coverGroups[gi].images.splice(ii, 1);
  _coverMarkDirty(gi);
  renderCovers();
}

function moveCoverImage(gi, ii, dir){
  var imgs = coverGroups[gi].images;
  var nj = ii + dir;
  if(nj < 0 || nj >= imgs.length) return;
  var tmp = imgs[ii];
  imgs[ii] = imgs[nj];
  imgs[nj] = tmp;
  _coverMarkDirty(gi);
  renderCovers();
}

// ─── 드래그&드롭 핸들러 (PC 이미지 다중 업로드) ──────────────────────
function _coverHandleDragOver(e, gi){
  e.preventDefault();
  e.stopPropagation();
  var dz = e.currentTarget;
  if(dz) dz.style.background = '#fff5d6'; // soft yellow highlight
  if(dz) dz.style.borderColor = '#e67e22';
}
function _coverHandleDragLeave(e, gi){
  e.preventDefault();
  e.stopPropagation();
  var dz = e.currentTarget;
  if(dz) dz.style.background = '';
  if(dz) dz.style.borderColor = '';
}
function _coverHandleDrop(e, gi){
  e.preventDefault();
  e.stopPropagation();
  var dz = e.currentTarget;
  if(dz) dz.style.background = '';
  if(dz) dz.style.borderColor = '';

  var files = [];
  if(e.dataTransfer){
    if(e.dataTransfer.files && e.dataTransfer.files.length){
      files = Array.prototype.slice.call(e.dataTransfer.files);
    } else if(e.dataTransfer.items){
      Array.prototype.slice.call(e.dataTransfer.items).forEach(function(item){
        if(item.kind === 'file'){
          var f = item.getAsFile();
          if(f) files.push(f);
        }
      });
    }
  }
  if(files.length === 0) return;

  // 드롭된 파일은 모두 PC 슬롯에 새 슬라이드로 추가. 파일 종류/크기
  // 검증은 _coverUploadToSlot 내부에서 슬라이드별 인라인 에러로 표시.
  _coverUploadPcBatch(gi, files);
}

// ─── 초기 로딩 ────────────────────────────────────────────────────────
function _papAuthHeaders(){
  // 다른 admin 호출이 사용하는 동일 헤더 헬퍼 패턴. 모듈마다 약간씩
  // 다른데 — 가장 보편적인 것: localStorage 의 pap-token.
  var headers = {};
  try {
    var token = (window.PAP && window.PAP.auth && typeof window.PAP.auth.getToken === 'function')
      ? window.PAP.auth.getToken()
      : localStorage.getItem('pap-token');
    if(token) headers['Authorization'] = 'Bearer ' + token;
  } catch(_){}
  return headers;
}

function loadCoverGroups(){
  fetch('/api/admin/banners', { headers: _papAuthHeaders() })
    .then(function(r){
      if(!r.ok) throw new Error('load failed: ' + r.status);
      return r.json();
    })
    .then(function(json){
      var rows = (json && json.data) || [];
      coverGroups = rows.map(function(g, idx){
        return {
          id: g.id,
          issue: g.issue || '',
          title: g.title || '',
          link_url: g.link_url || '',
          sort_order: typeof g.sort_order === 'number' ? g.sort_order : idx,
          is_active: g.is_active !== false,
          scheduled_publish_at: g.scheduled_publish_at || null,  // QA #298
          ended_at: g.ended_at || null,                          // QA #299
          created_at: g.created_at || null,
          updated_at: g.updated_at || null,
          created_by: g.created_by || null,
          updated_by: g.updated_by || null,
          _creator: g._creator || null,
          _editor: g._editor || null,
          images: Array.isArray(g.images) ? g.images.map(function(im){
            return {
              id: im.id || null,
              image_url: im.image_url,
              image_url_mobile: im.image_url_mobile || null,  // QA #296
              sort_order: im.sort_order || 0
            };
          }) : []
        };
      });
      coverGroupsLoaded = true;
      renderCovers();
    })
    .catch(function(err){
      console.error('[cover] load failed', err);
      coverGroupsLoaded = true;
      coverGroups = [];
      renderCovers();
    });
}

loadCoverGroups();

// ─── QA #297 — 에디토리얼 picker 모달 ─────────────────────────────────
// 그룹 카드의 "📰 에디토리얼 연결" 버튼이 호출. 단일 모달을 DOM 에 한
// 번만 만들고 그룹 id 만 바꿔서 재사용.
var _coverEdPickerCache = null;       // [{id, title, slug, thumbnail, published_date, ...}]
var _coverEdPickerActiveGi = -1;      // 현재 어떤 그룹을 위해 열려있는지

function _coverEnsurePickerDom(){
  if(document.getElementById('coverEdPickerOverlay')) return;
  var ov = document.createElement('div');
  ov.id = 'coverEdPickerOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:none;align-items:center;justify-content:center;padding:24px';
  ov.innerHTML = ''
    + '<div id="coverEdPickerCard" style="background:#fff;width:560px;max-width:100%;max-height:80vh;display:flex;flex-direction:column;border-radius:6px;overflow:hidden;color:#111">'
    +   '<div style="padding:18px 20px;border-bottom:1px solid #e6e6e6;display:flex;justify-content:space-between;align-items:center">'
    +     '<div>'
    +       '<div style="font-size:14px;font-weight:700">에디토리얼 연결</div>'
    +       '<div style="font-size:11px;color:#888;margin-top:3px">선택하면 링크가 자동으로 채워집니다. 발행호/제목이 비어있으면 함께 채워집니다.</div>'
    +     '</div>'
    +     '<button class="btn btn-sm" onclick="closeCoverEditorialPicker()" style="background:transparent;border:none;font-size:18px;cursor:pointer">×</button>'
    +   '</div>'
    +   '<div style="padding:12px 20px;border-bottom:1px solid #e6e6e6">'
    +     '<input id="coverEdPickerSearch" type="text" placeholder="제목, slug 로 검색…" '
    +       'style="width:100%;padding:8px 10px;font-size:13px;border:1px solid #ddd;border-radius:3px"'
    +       'oninput="_coverEdPickerRender()">'
    +   '</div>'
    +   '<div id="coverEdPickerList" style="flex:1;overflow-y:auto;min-height:200px"></div>'
    +   '<div style="padding:10px 20px;border-top:1px solid #e6e6e6;font-size:11px;color:#888;text-align:right">'
    +     '<span id="coverEdPickerCount">0</span>건 / 최근 500건 노출'
    +   '</div>'
    + '</div>';
  // 빈 배경 클릭 시 닫기 (카드 안 클릭은 무시).
  ov.addEventListener('click', function(e){
    if(e.target === ov) closeCoverEditorialPicker();
  });
  document.body.appendChild(ov);

  // ESC 키로 닫기.
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && ov.style.display === 'flex'){
      closeCoverEditorialPicker();
    }
  });
}

async function openCoverEditorialPicker(gi){
  _coverEnsurePickerDom();
  _coverEdPickerActiveGi = gi;
  var ov = document.getElementById('coverEdPickerOverlay');
  ov.style.display = 'flex';
  var listEl = document.getElementById('coverEdPickerList');
  var searchEl = document.getElementById('coverEdPickerSearch');
  if(searchEl){ searchEl.value = ''; setTimeout(function(){ searchEl.focus(); }, 50); }
  if(!_coverEdPickerCache){
    listEl.innerHTML = '<div style="padding:40px;text-align:center;color:#888;font-size:13px">에디토리얼 불러오는 중…</div>';
    try {
      var r = await fetch('/api/editorials?status=published&limit=500', { headers: _papAuthHeaders() });
      var json = r.ok ? await r.json() : null;
      _coverEdPickerCache = (json && (json.data || json.editorials)) || [];
      if(!Array.isArray(_coverEdPickerCache)) _coverEdPickerCache = [];
    } catch(err){
      console.warn('[cover-picker] fetch failed', err);
      _coverEdPickerCache = [];
    }
  }
  _coverEdPickerRender();
}

function closeCoverEditorialPicker(){
  var ov = document.getElementById('coverEdPickerOverlay');
  if(ov) ov.style.display = 'none';
  _coverEdPickerActiveGi = -1;
}

function _coverEdPickerRender(){
  var listEl = document.getElementById('coverEdPickerList');
  var searchEl = document.getElementById('coverEdPickerSearch');
  var countEl = document.getElementById('coverEdPickerCount');
  if(!listEl) return;
  var q = ((searchEl && searchEl.value) || '').trim().toLowerCase();
  var rows = (_coverEdPickerCache || []).slice();
  if(q){
    rows = rows.filter(function(ed){
      if(!ed) return false;
      var hay = ((ed.title || '') + ' ' + (ed.slug || '') + ' ' + (ed.issue || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  rows.sort(function(a, b){
    var ad = new Date((a && (a.published_date || a.created_at)) || 0).getTime() || 0;
    var bd = new Date((b && (b.published_date || b.created_at)) || 0).getTime() || 0;
    return bd - ad;
  });
  if(countEl) countEl.textContent = rows.length;
  if(rows.length === 0){
    listEl.innerHTML = '<div style="padding:40px;text-align:center;color:#888;font-size:13px">'
      + (q ? '검색 결과가 없습니다.' : '발행된 에디토리얼이 없습니다.')
      + '</div>';
    return;
  }
  var html = '';
  rows.forEach(function(ed){
    var thumb = ed.thumbnail || ed.thumbnail_url || ed.cover_image || '';
    var safeThumb = String(thumb).replace(/"/g, '&quot;');
    var title = _coverEscapeHtml(ed.title || ed.slug || ed.id || '');
    var slug = _coverEscapeHtml(ed.slug || '');
    var issue = _coverEscapeHtml(ed.issue || '');
    var pd = ed.published_date || ed.created_at || '';
    var dateStr = pd ? String(pd).split('T')[0] : '';
    html += '<div onclick="selectCoverEditorial(\'' + String(ed.id).replace(/\'/g, "\\\'") + '\')" '
      + 'style="display:flex;align-items:center;gap:12px;padding:10px 20px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:background .12s" '
      + 'onmouseover="this.style.background=\'#fafafa\'" onmouseout="this.style.background=\'\'">';
    html += '<div style="width:56px;height:42px;background:#eee;flex-shrink:0;border-radius:2px;background-size:cover;background-position:center'
      + (thumb ? (';background-image:url(\'' + safeThumb + '\')') : '') + '"></div>';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-size:13px;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + title + '</div>';
    html += '<div style="font-size:11px;color:#888;margin-top:2px">'
      + (issue ? '<span style="margin-right:8px">' + issue + '</span>' : '')
      + (slug ? '<span style="margin-right:8px">/' + slug + '</span>' : '')
      + dateStr
      + '</div>';
    html += '</div>';
    html += '</div>';
  });
  listEl.innerHTML = html;
}

function selectCoverEditorial(edId){
  var gi = _coverEdPickerActiveGi;
  if(gi < 0 || !coverGroups[gi]) return;
  var ed = null;
  for(var i = 0; i < (_coverEdPickerCache || []).length; i++){
    if(_coverEdPickerCache[i] && _coverEdPickerCache[i].id === edId){ ed = _coverEdPickerCache[i]; break; }
  }
  if(!ed){ closeCoverEditorialPicker(); return; }

  var slug = ed.slug || ed.id;
  var g = coverGroups[gi];
  g.link_url = '/editorial/' + slug;
  // 발행호 / 제목이 비어있으면 자동 채움 (이미 채워져 있으면 보존 ─
  // 운영자가 직접 쓴 카피를 덮어쓰지 않음).
  if(!String(g.issue || '').trim() && ed.issue){
    g.issue = ed.issue;
  }
  if(!String(g.title || '').trim() && ed.title){
    g.title = ed.title;
  }
  _coverMarkDirty(gi);
  closeCoverEditorialPicker();
  renderCovers();
}

// ─── QA #297 — 저장 UX 강화 + 미저장 경고 ─────────────────────────────
//
// _coverDirtyGroups: 그룹 인덱스 기준 dirty flag set. _coverMarkDirty 가
// add, saveCoverGroup 성공 시 해당 그룹만 delete. 모두 비면 beforeunload
// 경고가 안 뜸. (인덱스 기반이라 그룹 순서가 바뀌면 살짝 부정확하지만,
// "뭔가 저장 안 된 상태가 있다" 만 판단하면 되므로 충분.)
var _coverDirtyGroups = new Set();

// 카드 헤더의 statusBadge 를 직접 갱신 (renderCovers 재호출 없이).
// state: 'saved' | 'dirty' | 'saving' | 'saved-ok' | 'error'
function _coverUpdateCardStatus(gi, state, message){
  var card = document.querySelector('[data-cover-card="' + gi + '"]');
  if(!card) return;
  var statusEl = card.querySelector('[data-cover-status]');
  if(!statusEl) return;
  var styles = {
    'saved':    'color:#27ae60;background:#eafaf1',
    'dirty':    'color:#e67e22;background:#fef5e7',
    'saving':   'color:#2980b9;background:#eaf4fb',
    'saved-ok': 'color:#fff;background:#27ae60',
    'error':    'color:#fff;background:#e74c3c'
  };
  var labels = {
    'saved':    '저장됨',
    'dirty':    '미저장 (저장 버튼을 눌러주세요)',
    'saving':   '저장 중…',
    'saved-ok': '✓ 저장 완료',
    'error':    '⚠ ' + (message || '저장 실패')
  };
  statusEl.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:3px;' + (styles[state] || '');
  statusEl.textContent = labels[state] || '';
  if(state === 'saved-ok'){
    // QA #298 — 4초 뒤 모드별 적절한 라벨로 복귀 (공개 중 / 예약 / 임시저장).
    setTimeout(function(){
      var still = document.querySelector('[data-cover-card="' + gi + '"] [data-cover-status]');
      if(still && still.textContent === '✓ 저장 완료'){
        var initial = _coverComputeStatusInitial(gi, coverGroups[gi]);
        still.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:3px;color:'+initial.color+';background:'+initial.bg;
        still.textContent = initial.label;
      }
    }, 4000);
  }
}

// 페이지 닫기 / 새로고침 / 다른 탭 이동 시 — 저장 안 된 변경이 있으면 경고.
// SPA admin 의 일부 라우팅은 beforeunload 를 우회하지만, 외부 이동
// (URL 입력 / 탭 닫기) 은 막아줌. 사용자 데이터 보호 차원.
window.addEventListener('beforeunload', function(e){
  if(_coverDirtyGroups.size > 0){
    e.preventDefault();
    // Chrome 은 returnValue 가 truthy 면 자체 메시지 표시 (커스텀 텍스트는 무시).
    e.returnValue = '저장되지 않은 배너 변경사항이 있습니다. 정말 나가시겠습니까?';
    return e.returnValue;
  }
});

// ======== SHORTS API ========
// QA #208 Phase 2d — shorts dashboard pattern (matches editorial/news/film).
var shortsActiveStatus = 'all';
var shortsSelectedIds = new Set();
var shortsSortBy = 'recent';
var shortsDateRange = 'all';
var shortsDateBasis = 'created';
var shortsDateFrom = '';
var shortsDateTo = '';
var shortsRoleFilter = 'all';

function setShortsSortFromUi(){
  var sel = document.getElementById('shortsAdminSort');
  if(sel) shortsSortBy = sel.value || 'recent';
  renderShortsFromAPI();
}
function setShortsDateRangeFromUi(){
  var sel = document.getElementById('shortsAdminRange');
  var basis = document.getElementById('shortsAdminBasis');
  var from = document.getElementById('shortsAdminFrom');
  var to = document.getElementById('shortsAdminTo');
  if(sel) shortsDateRange = sel.value || 'all';
  if(basis) shortsDateBasis = basis.value || 'created';
  if(from) shortsDateFrom = from.value || '';
  if(to) shortsDateTo = to.value || '';
  var wrap = document.getElementById('shortsAdminCustomWrap');
  if(wrap) wrap.style.display = (shortsDateRange === 'custom') ? '' : 'none';
  renderShortsFromAPI();
}
function setShortsRoleFromUi(){
  var sel = document.getElementById('shortsAdminRole');
  if(sel) shortsRoleFilter = sel.value || 'all';
  renderShortsFromAPI();
}
function setShortsStatusFilter(status){
  shortsActiveStatus = status || 'all';
  renderShortsFromAPI();
}
function applyShortsPreset(preset){
  if(preset === 'today'){
    shortsActiveStatus = 'all';
    shortsDateRange = 'today';
    shortsDateBasis = 'created';
    shortsSortBy = 'recent';
  } else if(preset === 'draft'){
    shortsActiveStatus = 'draft';
    shortsSortBy = 'updated_desc';
    shortsDateRange = 'all';
  } else if(preset === 'thisweek'){
    shortsActiveStatus = 'all';
    shortsDateRange = '7d';
    shortsDateBasis = 'created';
    shortsSortBy = 'recent';
  } else if(preset === 'reset'){
    shortsActiveStatus = 'all';
    shortsSortBy = 'recent';
    shortsDateRange = 'all';
    shortsDateBasis = 'created';
    shortsDateFrom = '';
    shortsDateTo = '';
    shortsRoleFilter = 'all';
  }
  var sortEl = document.getElementById('shortsAdminSort'); if(sortEl) sortEl.value = shortsSortBy;
  var rangeEl = document.getElementById('shortsAdminRange'); if(rangeEl) rangeEl.value = shortsDateRange;
  var basisEl = document.getElementById('shortsAdminBasis'); if(basisEl) basisEl.value = shortsDateBasis;
  var roleEl = document.getElementById('shortsAdminRole'); if(roleEl) roleEl.value = shortsRoleFilter;
  var customWrap = document.getElementById('shortsAdminCustomWrap');
  if(customWrap) customWrap.style.display = (shortsDateRange === 'custom') ? '' : 'none';
  renderShortsFromAPI();
}

async function loadShortsFromAPI(){
  var tb=document.getElementById('shortsListBody');if(!tb)return;
  tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px">불러오는 중...</td></tr>';
  try{
    var pub=await papFetchAllPages('/shorts?status=published');
    var draft=await papFetchAllPages('/shorts?status=draft');
    shortsList=(pub.data||[]).concat(draft.data||[]);
    renderShortsFromAPI();
  }catch(e){
    tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px 0">숏츠가 없습니다</td></tr>';
  }
}
function renderShortsFromAPI(){
  var tb=document.getElementById('shortsListBody');if(!tb)return;

  // Status card counts roll up across full list.
  var counts = { all: shortsList.length, published: 0, draft: 0 };
  shortsList.forEach(function(s){
    var st = s.status || 'published';
    if(st === 'published') counts.published++;
    else counts.draft++;
  });
  var setStat=function(id,n){var el=document.getElementById(id);if(el)el.textContent=String(n||0);};
  setStat('shortsStatAll', counts.all);
  setStat('shortsStatPublished', counts.published);
  setStat('shortsStatDraft', counts.draft);
  document.querySelectorAll('.shorts-stat-card').forEach(function(c){
    if(c.dataset.status === shortsActiveStatus){
      c.style.borderColor = 'var(--purple)';
      c.style.boxShadow = '0 0 0 2px rgba(124,58,237,0.15)';
    } else {
      c.style.borderColor = 'var(--border2)';
      c.style.boxShadow = '';
    }
  });

  // Search input + filters.
  var q = (document.getElementById('shortsSearchAdmin') ? document.getElementById('shortsSearchAdmin').value : '').toLowerCase();
  var visible = shortsList.filter(function(s){
    var st = s.status || 'published';
    if(shortsActiveStatus !== 'all' && st !== shortsActiveStatus) return false;
    if(shortsRoleFilter !== 'all'){
      var creatorRole = (s._creator && s._creator.role) || null;
      if(shortsRoleFilter === 'admin' && creatorRole !== 'admin') return false;
      if(shortsRoleFilter === 'staff' && creatorRole !== 'staff') return false;
    }
    if(!q) return true;
    var creator = (s._creator && (s._creator.display_name || s._creator.email)) || '';
    return (s.title||'').toLowerCase().indexOf(q) > -1
        || creator.toLowerCase().indexOf(q) > -1;
  });
  visible = _papApplyDateRange(visible, shortsDateRange, shortsDateBasis, shortsDateFrom, shortsDateTo);
  visible = _papApplySort(visible, shortsSortBy);
  /* QA(2026-07-16) 페이지네이션 — 필터·정렬이 전부 끝난 뒤에 자른다.
     먼저 자르면 검색·정렬이 현재 페이지 안에서만 도는(원래 문제와 같은)
     상태가 된다. 위 상태별 카운트는 전량 배열 기준이라 페이지와 무관하다. */
  PAP_LIST_RERENDER.shorts = renderShortsFromAPI;
  var _pg = papPaginate('shorts', visible);
  papRenderPager('shorts','shortsListBody',_pg);

  if(document.getElementById('shortsCountLabel')) document.getElementById('shortsCountLabel').textContent = visible.length;

  tb.innerHTML = '';
  if(!visible.length){
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px 0">'+(shortsActiveStatus==='all'?'숏츠가 없습니다':'해당 상태의 숏츠가 없습니다')+'</td></tr>';
    _shortsRefreshBulkToolbar();
    papInitAdvPanel('shorts');
    return;
  }
  _pg.slice.forEach(function(s){
    var origIdx = shortsList.indexOf(s);
    var yt = s.youtube_id || s.yt || '';
    var st = s.status || 'published';
    var cls = st === 'published' ? 'b-published' : 'b-draft';
    var label = st === 'published' ? '공개' : '비공개';
    var isChecked = shortsSelectedIds.has(s.id) ? ' checked' : '';
    var authorshipCell = _renderAuthorshipCell(s);
    var updatedCell = fmtDate(s.updated_at || s.created_at);
    tb.innerHTML += '<tr>'
      + '<td onclick="event.stopPropagation()"><input type="checkbox" class="shorts-row-check" data-id="'+s.id+'" onchange="shortsToggleRow(this)"'+isChecked+'></td>'
      + '<td style="font-size:10px">'+(s.id ? s.id.substring(0,8) : '—')+'</td>'
      + '<td class="td-title" onclick="openShortsModal('+origIdx+')">'+esc(s.title)+'</td>'
      + '<td style="font-size:11px">'+esc(yt)+'</td>'
      + '<td><span class="badge '+cls+'">'+label+'</span></td>'
      + '<td style="font-size:11px;color:var(--text2);line-height:1.5">'+authorshipCell+'</td>'
      + '<td style="font-size:11px;color:var(--text2)">'+updatedCell+'</td>'
      + '<td><button class="btn btn-sm" onclick="openShortsModal('+origIdx+')">편집</button> <button class="btn btn-sm btn-red" onclick="deleteShortsAPI('+origIdx+')">삭제</button></td>'
      + '</tr>';
  });
  _shortsRefreshBulkToolbar();
  papInitAdvPanel('shorts');
}
async function deleteShortsAPI(i){
  if(!shortsList[i])return;
  if(!confirm('"'+shortsList[i].title+'" 을 삭제하시겠습니까?'))return;
  try{await apiDelete('/shorts/'+shortsList[i].id);shortsList.splice(i,1);renderShortsFromAPI();}catch(e){alert('삭제 실패');}
}

// QA #208 Phase 2d — shorts bulk-selection helpers.
function shortsToggleRow(checkbox){
  if(!checkbox) return;
  var id = checkbox.dataset.id;
  if(!id) return;
  if(checkbox.checked) shortsSelectedIds.add(id);
  else shortsSelectedIds.delete(id);
  _shortsRefreshBulkToolbar();
}
function shortsToggleSelectAll(checkbox){
  document.querySelectorAll('.shorts-row-check').forEach(function(cb){
    cb.checked = checkbox.checked;
    var id = cb.dataset.id;
    if(!id) return;
    if(checkbox.checked) shortsSelectedIds.add(id);
    else shortsSelectedIds.delete(id);
  });
  _shortsRefreshBulkToolbar();
}
function shortsClearSelection(){
  shortsSelectedIds.clear();
  var hdr = document.getElementById('shortsSelectAll');
  if(hdr) hdr.checked = false;
  document.querySelectorAll('.shorts-row-check').forEach(function(cb){ cb.checked = false; });
  _shortsRefreshBulkToolbar();
}
function _shortsRefreshBulkToolbar(){
  var bar = document.getElementById('shortsBulkToolbar');
  var lbl = document.getElementById('shortsBulkCount');
  if(!bar) return;
  if(shortsSelectedIds.size > 0){
    bar.style.display = 'block';
    if(lbl) lbl.textContent = shortsSelectedIds.size + '개 선택';
  } else {
    bar.style.display = 'none';
  }
}
async function shortsBulkAction(action){
  var ids = Array.from(shortsSelectedIds);
  if(!ids.length){ alert('선택된 항목이 없습니다.'); return; }
  var labels = { publish: '공개 전환', draft: '비공개 전환', delete: '삭제' };
  if(!confirm(ids.length + '개 숏츠를 ' + labels[action] + '하시겠습니까?')) return;
  var failures = [];
  for(var i = 0; i < ids.length; i++){
    var id = ids[i];
    try {
      if(action === 'delete'){
        await apiDelete('/shorts/' + id);
      } else if(action === 'publish'){
        await apiPut('/shorts/' + id, { status: 'published' });
      } else if(action === 'draft'){
        await apiPut('/shorts/' + id, { status: 'draft' });
      }
    } catch(err){
      failures.push(id.substring(0,8) + ': ' + (err && err.message || ''));
    }
  }
  shortsSelectedIds.clear();
  await loadShortsFromAPI();
  if(failures.length){
    alert('일부 실패:\n' + failures.join('\n'));
  } else {
    alert('완료: ' + ids.length + '개 숏츠 ' + labels[action]);
  }
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

// ======== 목록 전량 로드 + 페이지네이션 (QA 2026-07-16) ========
//
// 무엇이 문제였나 —
//   1. 페이지네이션이 "사라진" 게 아니라 호출부가 끊겨 있었다. 여기 있던
//      loadEditorialsPage()/renderPagination() 은 어디서도 호출되지 않는
//      죽은 코드였다. QA #196(예약 게시물 노출) 때 목록 로더가 상태 3종을
//      각각 limit=100 으로 받아 합치는 방식으로 바뀌면서 페이지 개념이
//      빠졌고, 옛 함수만 파일에 남았다.
//   2. 그래서 에디토리얼은 2,448건 중 106건만 관리자에 보였다.
//   3. 카운트도 API 가 주는 pagination.total 을 무시하고 "받아온 배열
//      길이"를 세어 limit 상한 100 에서 멈췄다 — QA 가 함께 보고한
//      "100건 초과 집계 누락"이 같은 뿌리다.
//   4. 검색·정렬·기간필터도 전부 메모리 배열 기준이라 100건 안에서만
//      동작했다(보고되지 않았지만 같은 원인).
//
// 어떻게 고쳤나 —
//   목록을 "전량" 받아 메모리에 두고, 기존 필터·정렬을 그대로 태운 뒤
//   마지막에 페이지 단위로 잘라 보여준다. 이렇게 해야 검색·정렬·기간이
//   전체 데이터 기준으로 정확해진다(서버 페이지네이션으로 가면 필터가
//   현재 페이지 안에서만 도는 지금 문제가 그대로 남는다).
//   전량 로드가 가능하도록 API 에 관리자용 슬림 컬럼(?fields=admin)을
//   추가했다 — 에디토리얼 기준 행당 6.7KB → 대폭 축소.
//
// 옛 renderPagination 은 삭제한다(죽은 코드 + 컨테이너를 edListBody 에
// 하드코딩해 다른 목록에 재사용 불가).

/** 1페이지를 받아 pagination.total 을 보고 나머지 페이지를 병렬로 받아온다.
 *  반환: { rows, total, pages, truncated }
 *  truncated=true 는 안전상한(MAX_PAGES)에 걸려 전량을 못 받았다는 뜻 —
 *  이 경우 호출부가 카운트에 "이상" 표시를 할 수 있도록 알려준다. */
async function papFetchAllPages(path, opts){
  opts = opts || {};
  var perPage = opts.limit || 100;          // API 상한이 100
  var MAX_PAGES = opts.maxPages || 60;      // 6,000행 — 폭주 방어
  var BATCH = opts.batch || 5;              // 동시 요청 수
  function url(p){
    return path + (path.indexOf('?') > -1 ? '&' : '?') + 'limit=' + perPage + '&page=' + p;
  }
  var first = await apiGet(url(1));
  var rows = (first && first.data) || [];
  var pg = (first && first.pagination) || {};
  var total = (typeof pg.total === 'number') ? pg.total : rows.length;
  var pages = pg.pages || 1;
  var truncated = false;
  if (pages > MAX_PAGES) { pages = MAX_PAGES; truncated = true; }
  for (var p = 2; p <= pages; p += BATCH) {
    var batch = [];
    for (var q = p; q < p + BATCH && q <= pages; q++) {
      // URL 은 push 시점에 확정되므로 클로저 문제 없음
      batch.push(apiGet(url(q)).catch(function(){ return { data: [] }; }));
    }
    var res = await Promise.all(batch);
    for (var i = 0; i < res.length; i++) rows = rows.concat((res[i] && res[i].data) || []);
  }
  // data: rows 별칭 — 기존 로더들이 응답을 `.data` 로 읽고 있어서, 호출부를
  // 최소로 바꾸려고 같은 배열을 두 이름으로 노출한다.
  return { rows: rows, data: rows, total: total, pages: pages, truncated: truncated };
}

/** 목록별 페이지 상태. key 는 'editorial' | 'news' | 'film' | 'shorts'. */
var PAP_PAGE_SIZES = [25, 50, 100, 200];
var papPageState = {};
function _papPageSt(key){
  if (!papPageState[key]) {
    var saved = parseInt(localStorage.getItem('pap-admin-pagesize-' + key), 10);
    papPageState[key] = { page: 1, size: (PAP_PAGE_SIZES.indexOf(saved) > -1 ? saved : 25) };
  }
  return papPageState[key];
}
/** 필터·정렬이 끝난 배열을 받아 현재 페이지 조각을 돌려준다. */
function papPaginate(key, rows){
  var st = _papPageSt(key);
  var pages = Math.max(1, Math.ceil(rows.length / st.size));
  if (st.page > pages) st.page = pages;   // 필터로 줄었을 때 빈 화면 방지
  if (st.page < 1) st.page = 1;
  var start = (st.page - 1) * st.size;
  return {
    slice: rows.slice(start, start + st.size),
    page: st.page, pages: pages, size: st.size,
    total: rows.length, from: rows.length ? start + 1 : 0,
    to: Math.min(start + st.size, rows.length)
  };
}
function papGoPage(key, p){
  var st = _papPageSt(key);
  st.page = p;
  var r = PAP_LIST_RERENDER[key];
  if (typeof r === 'function') r();
}
function papSetPageSize(key, n){
  var st = _papPageSt(key);
  st.size = parseInt(n, 10) || 25;
  st.page = 1;
  try { localStorage.setItem('pap-admin-pagesize-' + key, String(st.size)); } catch(_){}
  var r = PAP_LIST_RERENDER[key];
  if (typeof r === 'function') r();
}
/** key → 재렌더 함수. 각 목록이 자기 렌더러를 등록한다. */
var PAP_LIST_RERENDER = {};

/** 페이지네이션 UI. tbody 가 속한 .tbl-wrap 아래에 영역을 만들어 붙인다. */
function papRenderPager(key, tbodyId, info){
  var id = 'papPager-' + key;
  var el = document.getElementById(id);
  if (!el) {
    var tb = document.getElementById(tbodyId);
    if (!tb) return;
    var wrap = tb.closest('.tbl-wrap') || tb.closest('table').parentElement;
    if (!wrap) return;
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'padding:10px 14px;display:flex;gap:8px;align-items:center;'
      + 'justify-content:space-between;flex-wrap:wrap;border-top:1px solid var(--border)';
    wrap.appendChild(el);
  }
  var esc2 = function(s){ return String(s).replace(/'/g, "\\'"); };
  var sizeSel = '<select onchange="papSetPageSize(\'' + esc2(key) + '\',this.value)"'
    + ' style="background:#fff;border:1px solid var(--border2);padding:3px 6px;font-size:11px;border-radius:4px">'
    + PAP_PAGE_SIZES.map(function(n){
        return '<option value="' + n + '"' + (n === info.size ? ' selected' : '') + '>' + n + '개씩</option>';
      }).join('') + '</select>';

  // 좌: "전체 2,448건 중 1–25" — 전체 건수를 항상 보여준다(QA 집계 누락 건)
  var left = '<div style="font-size:11px;color:var(--text3)">전체 <b style="color:var(--text)">'
    + info.total.toLocaleString() + '</b>건 중 ' + info.from.toLocaleString()
    + '–' + info.to.toLocaleString() + ' &nbsp; ' + sizeSel + '</div>';

  var btn = function(p, label, disabled){
    if (disabled) {
      return '<span style="padding:4px 9px;font-size:11px;color:var(--text3);opacity:.4">' + label + '</span>';
    }
    return '<button class="btn btn-sm" onclick="papGoPage(\'' + esc2(key) + '\',' + p + ')">' + label + '</button>';
  };
  var right = '<div style="display:flex;gap:4px;align-items:center">'
    + btn(1, '« 처음', info.page <= 1)
    + btn(info.page - 1, '‹ 이전', info.page <= 1)
    + '<span style="padding:4px 10px;font-size:11px;color:var(--text2)"><b>' + info.page + '</b> / ' + info.pages + '</span>'
    + btn(info.page + 1, '다음 ›', info.page >= info.pages)
    + btn(info.pages, '마지막 »', info.page >= info.pages)
    + '</div>';
  el.innerHTML = left + right;
}

// ======== SETTINGS PERSISTENCE (localStorage) ========
// Save banners, covers, loading images, menu cats to localStorage
function saveBannerOrig(){saveBanner();}
var _origSaveBanner=null;
function persistSettings(){
  lsSet('banners',banners);
  lsSet('coverSlides',coverSlides);
  // QA #320 — loadingImgs 는 localStorage 지속 대상에서 제거.
  // QA #310 에서 DB/API (/api/admin/loading-images) 로 이관됐는데 이
  // 레거시 계층이 mock 시절 임시 데이터를 localStorage 에 저장/복원해
  // "업로드하지 않은 이미지가 목록에 생성됨" 현상을 만들었음.
  lsSet('menuCats',menuCats);
}
// Load settings from localStorage on init
(function(){
  var b=lsGet('banners',null);if(b&&b.length)banners=b;
  var c=lsGet('coverSlides',null);if(c&&c.length)coverSlides=c;
  // QA #320 — loadingImgs localStorage 복원 제거 (위 주석 참고).
  // mock 시절 저장된 stale 키도 1회 청소.
  try { localStorage.removeItem('pap_admin_loadingImgs'); } catch(_){}
  // QA #320 — menuCats 도 DB (nav_menu_items) 로 이관. localStorage 정리.
  try { localStorage.removeItem('pap_admin_menuCats'); } catch(_){}
  renderBanners();renderCovers();
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
// QA #320 — addMenuCat/deleteMenuCat 는 이제 DB 저장이라 persistSettings 래퍼 불필요.
// QA #320 — addLoadingImg persistSettings 래퍼 제거. 로딩 이미지는
// QA #310 부터 DB/API 가 단일 진실원이므로 localStorage 지속 불필요.

// ======== UPDATED GO FUNCTION FOR NEW SECTIONS ========
var _originalGo=go;
go=function(id,el){
  _originalGo(id,el);
  if(id==='shorts') loadShortsFromAPI();
  if(id==='community') loadCommunity();
  if(id==='subscriptions') loadSubscriptions();
  if(id==='intads') renderAds();
  if(id==='business') loadBusinessPage(); // QA #321 — 저장된 설정 hydrate
  if(id==='contact') loadContactPage();   // QA #326 — 오피스 주소 hydrate
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

// ============================================================================
// QA #284 Phase 3 — 어드민 다운로드 이력 뷰어
// ============================================================================
// API: /api/admin/download-logs
// 필터: 이메일 부분일치 / 콘텐츠 유형 / allowed-denied / 일자 범위
// 페이지네이션: 50개씩, 이전/다음 + 페이지 표시
// CSV 내보내기: 클라이언트에서 현재 필터 + 전체 결과(최대 200개) 받아서 변환

var _papDlState = { offset: 0, limit: 50, total: 0, rows: [] };

async function loadDownloadLogs(){
  var body = document.getElementById('dlLogBody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px 0">불러오는 중...</td></tr>';
  var qs = _buildDlQuery();
  try {
    var token = (typeof getToken === 'function') ? getToken() : (localStorage.getItem('token') || '');
    var r = await fetch('/api/admin/download-logs?' + qs, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok){
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#e74c3c;padding:40px 0">불러오기 실패 ('+r.status+')</td></tr>';
      return;
    }
    var data = await r.json();
    _papDlState.rows = data.logs || [];
    _papDlState.total = data.total || 0;
    _renderDownloadLogs();
    _renderDownloadLogPager();
    _renderDownloadLogStats();
  } catch(err){
    console.error('[downloads] load failed:', err);
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#e74c3c;padding:40px 0">'+(err.message||err)+'</td></tr>';
  }
}

function _buildDlQuery(){
  var p = new URLSearchParams();
  p.set('limit', String(_papDlState.limit));
  p.set('offset', String(_papDlState.offset));
  var em = document.getElementById('dlEmailFilter'); if (em && em.value) p.set('email', em.value);
  var ty = document.getElementById('dlTypeFilter'); if (ty && ty.value) p.set('content_type', ty.value);
  var al = document.getElementById('dlAllowedFilter'); if (al && al.value) p.set('allowed', al.value);
  var fr = document.getElementById('dlFromFilter'); if (fr && fr.value) p.set('from', fr.value + 'T00:00:00');
  var to = document.getElementById('dlToFilter'); if (to && to.value) p.set('to', to.value + 'T23:59:59');
  return p.toString();
}

function _renderDownloadLogs(){
  var body = document.getElementById('dlLogBody');
  if (!body) return;
  if (!_papDlState.rows.length){
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px 0">조회된 다운로드 이력이 없습니다.</td></tr>';
    return;
  }
  body.innerHTML = _papDlState.rows.map(function(r){
    var dt = r.downloaded_at ? new Date(r.downloaded_at).toLocaleString('ko-KR', { hour12: false }) : '—';
    var typeLabel = ({ 'cover':'커버', 'gallery':'갤러리', 'editorial-zip':'에디토리얼 ZIP', 'article-thumb':'아티클' })[r.content_type] || r.content_type;
    var contentInfo = '';
    if (r.content_slug) contentInfo += '<div style="font-size:10px;color:var(--text)">' + _papEsc(r.content_slug) + '</div>';
    if (r.content_id) contentInfo += '<div style="font-size:10px;color:var(--text3)">id: ' + _papEsc(r.content_id) + '</div>';
    if (!contentInfo) contentInfo = '<span style="color:var(--text3)">—</span>';
    var statusBadge = r.consented
      ? '<span style="display:inline-block;padding:2px 8px;background:#27ae60;color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;border-radius:2px">정상</span>'
      : '<span style="display:inline-block;padding:2px 8px;background:#e74c3c;color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;border-radius:2px">거부</span>';
    return '<tr>' +
      '<td style="white-space:nowrap;color:var(--text3);font-size:10px">' + dt + '</td>' +
      '<td style="font-size:11px">' + _papEsc(r.user_email || '—') + '</td>' +
      '<td style="font-size:11px">' + _papEsc(typeLabel) + '</td>' +
      '<td>' + contentInfo + '</td>' +
      '<td style="font-size:10px;color:var(--text3);word-break:break-all">' + _papEsc(r.file_name || '—') + '</td>' +
      '<td style="font-size:10px;color:var(--text3)">' + _papEsc(r.ip_address || '—') + '</td>' +
      '<td>' + statusBadge + '</td>' +
    '</tr>';
  }).join('');
}

function _renderDownloadLogPager(){
  var pager = document.getElementById('dlLogPager');
  if (!pager) return;
  var page = Math.floor(_papDlState.offset / _papDlState.limit) + 1;
  var totalPages = Math.max(1, Math.ceil(_papDlState.total / _papDlState.limit));
  var prevDisabled = _papDlState.offset === 0;
  var nextDisabled = _papDlState.offset + _papDlState.limit >= _papDlState.total;
  pager.innerHTML =
    '<button class="btn btn-sm" onclick="dlGoPrev()" ' + (prevDisabled?'disabled':'') + '>← 이전</button>' +
    '<span style="font-size:11px;color:var(--text3)">' + page + ' / ' + totalPages + ' (총 ' + _papDlState.total + '건)</span>' +
    '<button class="btn btn-sm" onclick="dlGoNext()" ' + (nextDisabled?'disabled':'') + '>다음 →</button>';
}

function _renderDownloadLogStats(){
  // 현재 로드된 페이지 기준 stats. 정확한 전체 통계는 별도 endpoint가 필요하지만
  // 우선 빠르게 sense check가 가능하도록 페이지 단위 표시.
  var rows = _papDlState.rows;
  var today = new Date().toISOString().slice(0, 10);
  var todayCount = rows.filter(function(r){ return (r.downloaded_at || '').slice(0, 10) === today; }).length;
  var allowed = rows.filter(function(r){ return r.consented; }).length;
  var denied = rows.filter(function(r){ return !r.consented; }).length;
  _setText('dlStatTotal', String(_papDlState.total));
  _setText('dlStatToday', String(todayCount));
  _setText('dlStatAllowed', String(allowed));
  _setText('dlStatDenied', String(denied));
}
function _setText(id, v){ var el = document.getElementById(id); if (el) el.textContent = v; }
function _papEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function dlGoPrev(){ if (_papDlState.offset >= _papDlState.limit){ _papDlState.offset -= _papDlState.limit; loadDownloadLogs(); } }
function dlGoNext(){ if (_papDlState.offset + _papDlState.limit < _papDlState.total){ _papDlState.offset += _papDlState.limit; loadDownloadLogs(); } }
function resetDownloadLogFilters(){
  ['dlEmailFilter','dlTypeFilter','dlAllowedFilter','dlFromFilter','dlToFilter'].forEach(function(id){
    var el = document.getElementById(id); if (!el) return;
    if (el.tagName === 'SELECT') el.value = 'all';
    else el.value = '';
  });
  _papDlState.offset = 0;
  loadDownloadLogs();
}

// CSV 내보내기 — 현재 필터로 최대 200개씩 페이지네이션해서 collect 후 CSV 변환.
async function exportDownloadLogsCSV(){
  if (!confirm('현재 필터 조건의 모든 이력을 CSV로 내보냅니다. (최대 1,000건)\n계속하시겠습니까?')) return;
  var token = (typeof getToken === 'function') ? getToken() : (localStorage.getItem('token') || '');
  var allRows = [];
  var savedOffset = _papDlState.offset;
  try {
    for (var off = 0; off < 1000; off += 200){
      var p = new URLSearchParams();
      p.set('limit', '200');
      p.set('offset', String(off));
      var em = document.getElementById('dlEmailFilter'); if (em && em.value) p.set('email', em.value);
      var ty = document.getElementById('dlTypeFilter'); if (ty && ty.value) p.set('content_type', ty.value);
      var al = document.getElementById('dlAllowedFilter'); if (al && al.value) p.set('allowed', al.value);
      var fr = document.getElementById('dlFromFilter'); if (fr && fr.value) p.set('from', fr.value + 'T00:00:00');
      var to = document.getElementById('dlToFilter'); if (to && to.value) p.set('to', to.value + 'T23:59:59');
      var r = await fetch('/api/admin/download-logs?' + p.toString(), { headers: { 'Authorization': 'Bearer ' + token } });
      if (!r.ok) throw new Error('fetch failed');
      var data = await r.json();
      var page = data.logs || [];
      allRows = allRows.concat(page);
      if (page.length < 200) break;
    }
    if (!allRows.length){ alert('내보낼 이력이 없습니다.'); return; }
    var headers = ['일시','이메일','user_id','유형','content_id','content_slug','file_name','image_url','ip_address','user_agent','consented'];
    var lines = [headers.join(',')];
    allRows.forEach(function(r){
      var row = [r.downloaded_at, r.user_email, r.user_id, r.content_type, r.content_id, r.content_slug, r.file_name, r.image_url, r.ip_address, r.user_agent, r.consented];
      lines.push(row.map(function(v){
        if (v == null) return '';
        var s = String(v).replace(/"/g, '""');
        if (/[",\n]/.test(s)) s = '"' + s + '"';
        return s;
      }).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pap-download-logs-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  } catch(err){
    console.error('[downloads CSV] failed:', err);
    alert('CSV 내보내기 실패: ' + (err.message || err));
  } finally {
    _papDlState.offset = savedOffset;
  }
}

// go('downloads', ...) 진입 시 자동으로 로드. go() 함수에서 case 'downloads' 처리 없어도
// 사용자가 새로고침 버튼을 누를 수 있으므로 fallback도 OK. 자동 로드를 위해
// DOMContentLoaded 후 hash-based 진입을 감지.
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    // tab id 매칭 시 자동 로드. go() 함수가 hash 변경하므로 hashchange listener도 추가.
    function maybeLoad(){
      var tab = document.getElementById('t-downloads');
      if (tab && tab.classList.contains('show') && !tab.dataset.loaded){
        tab.dataset.loaded = '1';
        loadDownloadLogs();
      }
    }
    window.addEventListener('hashchange', maybeLoad);
    setTimeout(maybeLoad, 500);
  });
})();
