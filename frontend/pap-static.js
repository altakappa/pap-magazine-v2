// PAP Magazine — Static pages module (extracted from pap-app.js per
// HARNESS_CHECKLIST.md mission 7).
//
// Owns: open / close logic for the home-page Terms-of-Service and
//   Privacy-Policy modal pages (#termsPage, #privacyPage). For non-Korean
//   visitors a reference-translation summary is rendered into the modal's
//   notice strip.
//
// Public surface (called from inline onclick= attributes in index.html and
// pap-magazine-v5.html):
//   window.openPage(id)   — show the modal, scroll lock, render lang notice
//   window.closePage(id)  — hide the modal, restore scroll
//
// Dependencies (must be loaded before this file):
//   - pap-i18n.js → reads `_legalNoticeTexts` as a bare global
//
// Korean is the legally binding original — the notice strip is only shown to
// non-'ko' users and is explicitly labelled as a non-binding reference.

// ======== TERMS & PRIVACY PAGES ========
function openPage(id){
  document.getElementById(id).classList.add('active');
  document.body.style.overflow='hidden';
  // Show language notice + summary for non-Korean users
  var curLang=localStorage.getItem('pap-lang')||'ko';
  var isTerms=id==='termsPage';
  var noticeId=isTerms?'termsLangNotice':'privacyLangNotice';
  var notice=document.getElementById(noticeId);
  if(notice){
    var key=isTerms?'terms':'privacy';
    var text=_legalNoticeTexts[key]&&_legalNoticeTexts[key][curLang];
    if(curLang!=='ko'&&text){
      notice.innerHTML=text;
      notice.style.display='block';
    } else {
      notice.style.display='none';
    }
  }
}
function closePage(id){
  document.getElementById(id).classList.remove('active');
  document.getElementById(id).scrollTop=0;
  document.body.style.overflow='';
}
