// PAP Magazine — 이미지 CDN 최적화 모듈 (성능 최적화 2026-07)
//
// S3 원본 이미지(장당 수백 KB~수 MB)를 Vercel 이미지 최적화
// (/_vercel/image)로 라우팅해 AVIF/WebP + 뷰포트 크기 리사이즈로
// 서빙한다. vercel.json 의 "images" 설정과 한 쌍.
//
// 안전 설계:
//   • loading="lazy" 이면서 아직 로드 안 된 <img> 만 다시 쓴다
//     — eager 이미지(히어로 LCP 등)와 이미 받은 이미지는 절대 안 건드림
//   • 변환 실패(요금제 한도, 미지원 포맷 등) 시 onerror 로 원본 S3 URL
//     복원 — 이미지가 깨질 수 없는 구조
//   • MutationObserver 로 동적 렌더 카드(API 싱크, 오버레이 갤러리)도
//     자동 적용 — 렌더러 코드 수정 없음
//
// 제외 대상: /_vercel/image 자기 자신, data: URI, S3 외 도메인.

(function(){
  'use strict';
  var S3_HOST = 'pap-korea-bucket.s3.ap-northeast-2.amazonaws.com';
  var SIZES = [320, 640, 960, 1280, 1920]; // vercel.json images.sizes 와 일치해야 함
  var QUALITY = 75;

  function pickWidth(img){
    var cw = img.clientWidth || (img.parentElement && img.parentElement.clientWidth) || 0;
    if(!cw) cw = 640; // 레이아웃 전 — 카드 기본값
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var target = cw * dpr;
    for(var i = 0; i < SIZES.length; i++){
      if(SIZES[i] >= target) return SIZES[i];
    }
    return SIZES[SIZES.length - 1];
  }

  function cdnUrl(src, w){
    return '/_vercel/image?url=' + encodeURIComponent(src) + '&w=' + w + '&q=' + QUALITY;
  }

  function rewrite(img){
    try{
      if(!img || img.dataset.papCdn) return;
      var src = img.getAttribute('src') || '';
      if(src.indexOf(S3_HOST) === -1) return;
      if(src.indexOf('/_vercel/image') !== -1) return;
      // lazy + 미로드 이미지만 — eager(히어로)와 로드 완료분은 그대로
      if(img.loading !== 'lazy' || img.complete) return;
      img.dataset.papCdn = '1';
      img.dataset.papOrig = src;
      img.addEventListener('error', function(){
        // 변환 실패 → 원본 복원 (1회)
        if(img.dataset.papOrig && img.src !== img.dataset.papOrig){
          img.src = img.dataset.papOrig;
        }
      }, { once: true });
      img.src = cdnUrl(src, pickWidth(img));
    }catch(e){ /* 이미지 로딩을 절대 막지 않는다 */ }
  }

  function sweep(root){
    if(!root || !root.querySelectorAll) return;
    var imgs = root.querySelectorAll('img[loading="lazy"]');
    for(var i = 0; i < imgs.length; i++) rewrite(imgs[i]);
  }

  if(document.readyState !== 'loading'){ sweep(document); }
  else { document.addEventListener('DOMContentLoaded', function(){ sweep(document); }); }

  try{
    new MutationObserver(function(muts){
      for(var i = 0; i < muts.length; i++){
        var added = muts[i].addedNodes;
        for(var j = 0; j < added.length; j++){
          var n = added[j];
          if(n.nodeType !== 1) continue;
          if(n.tagName === 'IMG') rewrite(n);
          else sweep(n);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }catch(e){ /* 옵저버 미지원 환경 — 초기 sweep 만으로 동작 */ }
})();
