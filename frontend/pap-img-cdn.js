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
// 제외 대상: /_vercel/image 자기 자신, data: URI, 허용 호스트 외 도메인, gif/svg.
//
// 2026-10-14 건강 점검 후속 (도메니코 "순서대로 진행"):
//   • Supabase storage 호스트 추가 — vercel.json remotePatterns 에는 7월부터
//     있었는데 이 모듈은 S3 만 봐서, 홈·에디토리얼 허브의 Supabase 이미지 37장이
//     원본(평균 758KB)으로 직접 내려갔다(실측 2~9초).
//   • JS 가 나중에 그려 넣는 카드(MutationObserver 경로)는 loading 값과 무관하게
//     바꾼다 — eager/auto 로 들어온 히어로·상단 카드 18장이 S3 원본으로 5~13초 걸렸다.
//     삽입 직후 같은 마이크로태스크에서 src 를 바꾸므로 원본 요청은 시작 전에 버려진다.
//     HTML 에 처음부터 박힌 eager(진짜 LCP 히어로)는 종전대로 건드리지 않는다.
//   • 고유 원본 수 과금(Vercel 비용 2026-08-22)은 허브 페이지 이미지가 수십 장이라
//     영향이 작고, SSR(seoRenderer)이 같은 URL·폭·q 로 이미 변환하므로 캐시를 공유한다.

(function(){
  'use strict';
  var HOSTS = [
    'pap-korea-bucket.s3.ap-northeast-2.amazonaws.com',
    'igcazquhkwxtqsaqpznx.supabase.co'
  ];
  function isOptHost(src){
    for(var i = 0; i < HOSTS.length; i++){ if(src.indexOf('https://' + HOSTS[i] + '/') === 0) return true; }
    return false;
  }
  function isSkippedFormat(src){
    var p = src.split('?')[0].toLowerCase();
    return /\.(gif|svg|mp4|webm)$/.test(p) || p.indexOf('/render/image/') !== -1;
  }
  // 2026-08-10 비용 절감(도메니코 승인): 생성 크기 5종→3종.
  // vercel.json 허용 목록에는 640/1280 이 당분간 남아 있다 — 구글에 캐시된
  // 옛 srcset 이 하루쯤 더 그 크기를 요청하기 때문. 다음 주 자동 트랙이 제거.
  var SIZES = [320, 960, 1920];
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

  function rewrite(img, dynamic){
    try{
      if(!img || img.dataset.papCdn) return;
      var src = img.getAttribute('src') || '';
      if(!isOptHost(src) || isSkippedFormat(src)) return;
      if(src.indexOf('/_vercel/image') !== -1) return;
      // 로드 완료분은 그대로. 초기 sweep 에서 eager(히어로 LCP·상단 3장)는 그대로.
      // lazy·auto(미지정) 는 아직 안 받았으면 바꾼다 — 10/14 배포 뒤 실측에서 모듈보다
      // 먼저 그려진 auto 카드 12장이 Supabase 원본으로 남아 있었다.
      // JS 가 나중에 넣은 카드(dynamic)는 loading 값과 무관하게 바꾼다.
      if(img.complete) return;
      if(!dynamic && img.loading === 'eager') return;
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

  function sweep(root, dynamic){
    if(!root || !root.querySelectorAll) return;
    var imgs = root.querySelectorAll('img');
    for(var i = 0; i < imgs.length; i++) rewrite(imgs[i], dynamic);
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
          if(n.tagName === 'IMG') rewrite(n, true);
          else sweep(n, true);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }catch(e){ /* 옵저버 미지원 환경 — 초기 sweep 만으로 동작 */ }
})();
