/**
 * pap-protect.js — QA #284 Phase 1
 *
 * 공개 페이지 이미지/영상 콘텐츠의 "캐주얼한" 무단 저장을 어렵게 만드는
 * 1차 보호 레이어. 우클릭, 드래그, 선택, 모바일 long-press 콜아웃을 차단.
 *
 * 한계 — 명시적으로 표기:
 *   • 개발자 도구, 스크린샷, 화면 녹화는 막을 수 없음.
 *   • 본 스크립트의 목적은 "악의 없는 사용자가 우클릭/드래그로
 *     쉽게 다운받지 못하게" 하는 것. 보호의 1단계.
 *   • 실제 권한 기반 다운로드는 Phase 2 (role 분기) + Phase 3 (로그)에서.
 *
 * 적용 범위:
 *   • 공개 페이지 전체 (index, articles, editorials, films, magazine, community 등)
 *   • 어드민(admin.html)에는 로드하지 않음 — 어드민은 이미지 편집/다운로드가 핵심 기능.
 *
 * 비활성 클래스:
 *   • .pap-allow-save가 붙은 요소는 차단에서 제외 (어드민 미리보기 등 예외용).
 */

(function(){
  'use strict';

  // 한 페이지에 두 번 로드되어도 핸들러 중복 등록되지 않도록.
  if (window.__papProtectInit) return;
  window.__papProtectInit = true;

  // 1) 우클릭 메뉴 차단 — img / video / source / picture 대상.
  //    a (link)와 button은 정상 동작해야 하므로 제외.
  document.addEventListener('contextmenu', function(e){
    var t = e.target;
    if (!t) return;
    if (t.closest && t.closest('.pap-allow-save')) return;
    var tag = (t.tagName || '').toUpperCase();
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'PICTURE' || tag === 'SOURCE'){
      e.preventDefault();
    }
  }, false);

  // 2) 드래그 시작 차단 — 이미지를 데스크탑/다른 탭으로 끌어놓아 저장하는 경로 차단.
  document.addEventListener('dragstart', function(e){
    var t = e.target;
    if (!t) return;
    if (t.closest && t.closest('.pap-allow-save')) return;
    var tag = (t.tagName || '').toUpperCase();
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'PICTURE'){
      e.preventDefault();
    }
  }, false);

  // 3) 키보드 단축키 차단 — Ctrl+S (저장), Ctrl+U (소스보기 일부 브라우저),
  //    Ctrl+P (인쇄 후 PDF로 저장). 데스크탑 사용자만 해당.
  //    개발자 도구(F12)는 차단하지 않음 — 차단해도 우회 가능하고 정직한 사용자에게만 불편.
  document.addEventListener('keydown', function(e){
    if (!(e.ctrlKey || e.metaKey)) return;
    var k = (e.key || '').toLowerCase();
    if (k === 's' || k === 'p'){
      // 본문 페이지에서만 차단. input/textarea 안에서는 정상 (Ctrl+S로 작성 폼 저장 시도 등).
      var a = document.activeElement;
      var inInput = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
      if (!inInput){
        e.preventDefault();
      }
    }
  }, false);

  // 4) CSS 주입 — 이미지 선택/드래그/iOS callout 차단.
  //    전역 selector지만 .pap-allow-save 자식은 user-select:auto로 풀어줌.
  var styleId = 'pap-protect-css';
  if (!document.getElementById(styleId)){
    var s = document.createElement('style');
    s.id = styleId;
    s.textContent = [
      'img, video, picture {',
      '  -webkit-user-select: none;',
      '  -moz-user-select: none;',
      '  -ms-user-select: none;',
      '  user-select: none;',
      '  -webkit-user-drag: none;',
      '  -khtml-user-drag: none;',
      '  -moz-user-drag: none;',
      '  -o-user-drag: none;',
      '  user-drag: none;',
      '  -webkit-touch-callout: none;', /* iOS 길게 누르기 메뉴 차단 */
      '}',
      '.pap-allow-save img, .pap-allow-save video, .pap-allow-save picture {',
      '  -webkit-user-select: auto;',
      '  user-select: auto;',
      '  -webkit-user-drag: auto;',
      '  user-drag: auto;',
      '  -webkit-touch-callout: default;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  // 5) 새로 추가되는 img에도 draggable="false" 보장 — 동적 렌더(SPA overlay) 대응.
  //    MutationObserver로 IMG가 추가될 때마다 draggable 속성 강제.
  if (window.MutationObserver){
    var mo = new MutationObserver(function(mutations){
      mutations.forEach(function(m){
        if (!m.addedNodes) return;
        m.addedNodes.forEach(function(node){
          if (!node || node.nodeType !== 1) return;
          if (node.tagName === 'IMG'){
            if (!node.closest || !node.closest('.pap-allow-save')) node.setAttribute('draggable', 'false');
          } else if (node.querySelectorAll){
            var imgs = node.querySelectorAll('img');
            imgs.forEach(function(img){
              if (!img.closest('.pap-allow-save')) img.setAttribute('draggable', 'false');
            });
          }
        });
      });
    });
    var startObserver = function(){
      mo.observe(document.body, { childList: true, subtree: true });
      // 초기 페이지에 이미 있는 IMG들에도 draggable 적용.
      document.querySelectorAll('img').forEach(function(img){
        if (!img.closest('.pap-allow-save')) img.setAttribute('draggable', 'false');
      });
    };
    if (document.body) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver);
  }

})();
