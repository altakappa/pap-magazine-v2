// PAP Magazine — Home interactions module (extracted from pap-app.js per
// HARNESS_CHECKLIST.md mission 9).
//
// Owns: home-page-only visual flourishes that early-return on pages without
// the relevant DOM.
//
//   - FLOATING LOGO IIFE: cursor-following hero logo with header morph
//     (touch devices fall back to in-header static logo). Exposes
//     window._papResetFloatingLogo for external modal close triggers.
//   - _resetCursorForModal: helper called by Content harness's open* family
//     (openEditorial, openCreatorPopup, openAllEditorials, openAllArticles,
//     openAllFilms etc.) to defuse the floating cursor before a modal opens.
//   - SIGNUP POPUP IIFE: first-visit join-popup; persists dismissal in
//     localStorage('pap-signup-shown'). Element only exists on index.html;
//     IIFE early-returns elsewhere.
//   - closeSignupPopup: called from the popup's close/skip buttons inline.
//   - INFINITE MARQUEE IIFE: hero-area scrolling text. Re-runs on resize and
//     on language change (pap-lang-changed event).
//
// Public surface (consumed cross-script via globals):
//   window._papResetFloatingLogo    set by floating logo IIFE; reset hook
//   _resetCursorForModal            called by Content harness's open* fns
//   closeSignupPopup                called from inline onclick=
//
// Dependencies (must be loaded before this file):
//   - pap-utils.js → lockScroll, unlockScroll (used by signup popup IIFE)
//
// All sections early-return when their DOM target (#floatingLogo,
// #signupPopup, #marqueeTrack) is missing, so this module is safe to load
// on every page even though only index.html actually renders any of them.

// ======== FLOATING LOGO + _resetCursorForModal + SIGNUP POPUP + closeSignupPopup ========
// ======== FLOATING LOGO (cursor follow on hero) ========
(function(){
  const fLogo = document.getElementById('floatingLogo');
  if(!fLogo) return;
  // On mobile/touch devices, keep logo fixed in header — skip all floating logic
  if('ontouchstart' in window || navigator.maxTouchPoints > 0){
    fLogo.classList.add('in-header');
    fLogo.style.left = '50%';
    fLogo.style.top = '0';
    fLogo.style.transform = 'translateX(-50%)';
    fLogo.style.position = 'fixed';
    return;
  }
  const heroEl = document.querySelector('.hero');
  // Single-source header rebuild: the header (and its .logo-wrap) is now
  // INJECTED by pap-header.js, which loads AFTER this file. So .logo-wrap
  // may not exist yet at IIFE time — do NOT hard-bail on it, and always
  // re-query it LIVE so we never hold a stale reference to a header that
  // pap-header.js removed/re-injected. pap-header.js calls
  // window._papResetFloatingLogo() once its header is in the DOM.
  let onHero = false;
  let mouseX = 0, mouseY = 0;
  let rafId = null;

  function getHeaderLogoPos(){
    const hl = document.querySelector('.logo-wrap');
    if(!hl){
      // Header not injected yet — fall back to the header's visual centre
      // (72px bar → ~36px). _papResetFloatingLogo() re-runs once it exists.
      return { x: window.innerWidth / 2, y: 36 };
    }
    const r = hl.getBoundingClientRect();
    return { x: window.innerWidth / 2, y: r.top + r.height/2 };
  }

  var edgeBouncing = false;
  var EDGE_THRESHOLD = 40; // px from edge to trigger bounce

  // ======== BOUNCE COIN COUNTER (below header logo, flash then fade) ========
  var bounceCount = 0;
  var bounceCooldown = false;
  var scoreEl = document.createElement('span');
  scoreEl.id = 'bounceScore';
  var heroSymbol = document.querySelector('.hero-symbol');
  if(heroSymbol){
    var symbolWrap = document.createElement('div');
    symbolWrap.id = 'symbolScoreWrap';
    heroSymbol.parentNode.insertBefore(symbolWrap, heroSymbol);
    symbolWrap.appendChild(heroSymbol);
    symbolWrap.appendChild(scoreEl);
  } else { document.body.appendChild(scoreEl); }

  function positionScore(){
    /* score is centered inside #symbolScoreWrap via CSS */
  }

  function triggerBounceScore(){
    if(bounceCooldown) return;
    if('ontouchstart' in window || navigator.maxTouchPoints > 0) return;
    bounceCooldown = true;
    bounceCount++;
    // Position score below header logo
    positionScore();
    scoreEl.textContent = bounceCount;
    scoreEl.classList.remove('show');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('show');
    // Spawn "+1" at the logo's current position (where it hit the edge)
    var plus = document.createElement('div');
    plus.className = 'bounce-plus-one';
    plus.textContent = '+1';
    var logoRect = fLogo.getBoundingClientRect();
    plus.style.left = (logoRect.left + logoRect.width / 2) + 'px';
    plus.style.top = (logoRect.top + logoRect.height / 2) + 'px';
    document.body.appendChild(plus);
    // Combo text for milestones
    if(bounceCount === 100){
      var love = document.createElement('div');
      love.className = 'bounce-combo bounce-love';
      love.textContent = 'PAP Loves You';
      love.style.left = '50%';
      love.style.top = '40%';
      document.body.appendChild(love);
      setTimeout(function(){ if(love.parentNode) love.parentNode.removeChild(love); }, 2500);
    } else if(bounceCount % 10 === 0){
      var combo = document.createElement('div');
      combo.className = 'bounce-combo';
      combo.textContent = bounceCount + ' COMBO!';
      combo.style.left = '50%';
      combo.style.top = '35%';
      document.body.appendChild(combo);
      setTimeout(function(){ if(combo.parentNode) combo.parentNode.removeChild(combo); }, 1200);
    }
    setTimeout(function(){ if(plus.parentNode) plus.parentNode.removeChild(plus); }, 800);
    setTimeout(function(){ bounceCooldown = false; }, 300);
  }

  // Reset counter when hero scrolls out of view
  var heroObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting && bounceCount > 0){
        bounceCount = 0;
        scoreEl.classList.remove('show');
        scoreEl.textContent = '';
      }
    });
  }, {threshold: 0});
  if(heroEl) heroObserver.observe(heroEl);

  function updateFloatingLogo(){
    if(!heroEl) return;
    const heroRect = heroEl.getBoundingClientRect();
    // Exclude header area — cursor must be below header to activate custom cursor
    var headerEl = document.querySelector('.header');
    var headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom + 8 : 80; // +8px buffer
    // Also exclude auth-btn-wrap & active dropdown area from hero cursor zone
    var authWrap = document.querySelector('.auth-btn-wrap');
    var acctDD = document.getElementById('accountDropdown');
    var overAuth = false;
    if(authWrap){var ar=authWrap.getBoundingClientRect();if(mouseX>=ar.left-8&&mouseX<=ar.right+8&&mouseY>=ar.top-8&&mouseY<=ar.bottom+8)overAuth=true;}
    if(acctDD&&acctDD.classList.contains('active')){var dr=acctDD.getBoundingClientRect();if(mouseX>=dr.left-8&&mouseX<=dr.right+8&&mouseY>=dr.top-8&&mouseY<=dr.bottom+8)overAuth=true;}
    const isInHero = !overAuth && heroRect.top <= mouseY && mouseY <= heroRect.bottom && heroRect.left <= mouseX && mouseX <= heroRect.right && mouseY > headerBottom;

    // Detect if cursor is near left or right edge of hero
    var nearLeftEdge = isInHero && (mouseX - heroRect.left) < EDGE_THRESHOLD;
    var nearRightEdge = isInHero && (heroRect.right - mouseX) < EDGE_THRESHOLD;
    var nearEdge = nearLeftEdge || nearRightEdge;

    // Squish zone: wider than bounce threshold, logo folds outward as it nears edge
    var SQUISH_ZONE = 120;
    var distFromLeft = mouseX - heroRect.left;
    var distFromRight = heroRect.right - mouseX;
    var foldDeg = 0; // rotateY degrees for 3D fold effect
    if(isInHero && distFromRight < SQUISH_ZONE){
      // Near right edge — fold outward (rotate toward viewer on right side)
      var t = 1 - Math.max(0, distFromRight / SQUISH_ZONE);
      foldDeg = t * 75; // max 75deg
    } else if(isInHero && distFromLeft < SQUISH_ZONE){
      // Near left edge — fold outward (rotate toward viewer on left side)
      var t = 1 - Math.max(0, distFromLeft / SQUISH_ZONE);
      foldDeg = -(t * 75);
    }

    if(isInHero && heroRect.top < window.innerHeight * 0.5 && !nearEdge){
      // Cursor is on hero area, not near edges
      if(!onHero || edgeBouncing){
        onHero = true;
        edgeBouncing = false;
        fLogo.classList.remove('in-header');
        fLogo.classList.add('on-cursor');
        heroEl.style.cursor = 'none';
      }
      fLogo.style.left = mouseX + 'px';
      fLogo.style.top = mouseY + 'px';
      fLogo.style.transform = 'translate(-50%,-50%) perspective(300px) rotateY(' + foldDeg + 'deg)';
    } else {
      // Outside hero OR near edge — bounce logo up to header position
      if(onHero || !fLogo.classList.contains('in-header')){
        // Score when logo was following cursor (onHero) and bounces back
        if(onHero) triggerBounceScore();
        onHero = false;
        edgeBouncing = nearEdge;
        fLogo.classList.add('in-header');
        fLogo.classList.remove('on-cursor');
        heroEl.style.cursor = '';
      }
      const hp = getHeaderLogoPos();
      fLogo.style.left = hp.x + 'px';
      fLogo.style.top = hp.y + 'px';
      fLogo.style.transform = 'translate(-50%,-50%)';
    }
  }

  // Trail pool
  const TRAIL_COUNT = 8;
  const trailPool = [];
  const logoSrc = fLogo.querySelector('img').src;
  for(let i=0;i<TRAIL_COUNT;i++){
    const t = document.createElement('div');
    t.className = 'logo-trail';
    t.innerHTML = '<img src="'+logoSrc+'" alt="">';
    document.body.appendChild(t);
    trailPool.push(t);
  }
  let trailIdx = 0;
  let lastTrailTime = 0;

  function spawnTrail(x, y){
    const now = performance.now();
    if(now - lastTrailTime < 40) return; // throttle: ~25fps
    lastTrailTime = now;
    const t = trailPool[trailIdx % TRAIL_COUNT];
    trailIdx++;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
    t.style.animation = 'none';
    t.offsetHeight;
    t.style.animation = 'trailFade .5s ease forwards';
  }

  // Check if any modal/popup/overlay is active (disable cursor interaction)
  function isModalActive(){
    var signupPopup = document.getElementById('signupPopup');
    var creatorPopup = document.getElementById('creatorPopup');
    var cookieBanner = document.getElementById('cookieConsent');
    var navOverlay = document.getElementById('navOverlay');
    var papModal = document.querySelector('.pap-modal-overlay');
    var interstitial = document.getElementById('premiumInterstitial');
    var brandAd = document.querySelector('[id^="brandAd"]');
    var pageOverlay = document.querySelector('.page-overlay.active');
    if(signupPopup && signupPopup.classList.contains('active')) return true;
    if(creatorPopup && creatorPopup.classList.contains('active')) return true;
    if(navOverlay && navOverlay.classList.contains('active')) return true;
    if(cookieBanner) return true;
    if(papModal) return true;
    if(interstitial) return true;
    if(brandAd) return true;
    if(pageOverlay) return true;
    return false;
  }

  document.addEventListener('mousemove', function(e){
    // Skip cursor tracking when any modal/popup is active — return logo to header
    if(isModalActive()){
      if(onHero){
        onHero = false;
        var hp = getHeaderLogoPos();
        fLogo.style.transition = 'all .4s cubic-bezier(.22,1,.36,1)';
        fLogo.style.left = hp.x + 'px';
        fLogo.style.top = hp.y + 'px';
        fLogo.classList.add('in-header');
        fLogo.classList.remove('on-cursor');
        if(heroEl) heroEl.style.cursor = '';
      }
      return;
    }
    mouseX = e.clientX;
    mouseY = e.clientY;
    if(onHero) spawnTrail(mouseX, mouseY);
    if(!rafId){
      rafId = requestAnimationFrame(function(){
        updateFloatingLogo();
        rafId = null;
      });
    }
  });

  // Re-evaluate floating logo on scroll (cursor may have left hero due to scroll)
  document.addEventListener('scroll', function(){
    if(onHero && !rafId){
      rafId = requestAnimationFrame(function(){
        updateFloatingLogo();
        rafId = null;
      });
    }
  }, {passive: true});

  // Initial position — also serves as re-initialization when navigating back to main
  window.addEventListener('load', function(){
    fLogo.style.display = ''; // ensure logo is visible
    fLogo.style.opacity = '1';
    fLogo.classList.add('in-header');
    var hp = getHeaderLogoPos();
    fLogo.style.left = hp.x + 'px';
    fLogo.style.top = hp.y + 'px';
    fLogo.style.transform = 'translate(-50%,-50%)';
  });

  window.addEventListener('resize', function(){
    if(!onHero){
      const hp = getHeaderLogoPos();
      fLogo.style.left = hp.x + 'px';
      fLogo.style.top = hp.y + 'px';
    }
  });

  // ======== BFCACHE / TAB-SWITCH RESTORATION ========
  // Safari (and some other browsers) aggressively cache pages in bfcache.
  // On back/forward navigation the page is restored from memory without
  // re-executing scripts, so the closure state (onHero, logo position,
  // event listeners) may be stale.  Reset the cursor to a known good state.
  function _resetFloatingLogoToHeader(){
    onHero = false;
    edgeBouncing = false;
    rafId = null;
    fLogo.classList.add('in-header');
    fLogo.classList.remove('on-cursor');
    if(heroEl) heroEl.style.cursor = '';
    fLogo.style.transition = 'none';
    var hp = getHeaderLogoPos();
    fLogo.style.left = hp.x + 'px';
    fLogo.style.top = hp.y + 'px';
    fLogo.style.transform = 'translate(-50%,-50%)';
    // Restore CSS transition after a paint frame
    requestAnimationFrame(function(){
      fLogo.style.transition = '';
    });
  }

  window.addEventListener('pageshow', function(e){
    // ALWAYS reset cursor on pageshow — whether from bfcache or normal navigation
    // This fixes the bug where custom cursor disappears after returning from sub-pages
    _resetFloatingLogoToHeader();
  });

  // When the tab regains visibility, re-sync logo position (header may have
  // shifted due to resize while tab was hidden).
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && !onHero){
      var hp = getHeaderLogoPos();
      fLogo.style.left = hp.x + 'px';
      fLogo.style.top = hp.y + 'px';
    }
  });

  // Expose reset for external callers (e.g. _resetCursorForModal)
  window._papResetFloatingLogo = _resetFloatingLogoToHeader;

  // Extra safety: also reset on DOMContentLoaded in case load already fired
  if(document.readyState === 'complete' || document.readyState === 'interactive'){
    _resetFloatingLogoToHeader();
  } else {
    document.addEventListener('DOMContentLoaded', function(){
      _resetFloatingLogoToHeader();
    });
  }

  // ======== PAP PONG GAME (double-click on header logo) ========
  var gameActive = false;
  var gameCanvas = null;
  var gameCtx = null;
  var gameRaf = null;
  var gameLevel = 1;
  var gameMaxLevel = 10;
  var gameScore = 0;
  var gameLives = 3;
  var gamePaddle = null;
  var gameBalls = [];
  var gameLogoImg = null;
  var gameStarted = false;
  var gameLevelUpTimer = 0;
  var gameParticles = [];
  var gameCombo = 0;
  var gameMaxCombo = 0;

  // Preload logo image for the game
  gameLogoImg = new Image();
  gameLogoImg.src = fLogo.querySelector('img').src;

  function initGame(){
    if(gameActive) return;
    if('ontouchstart' in window || navigator.maxTouchPoints > 0) return;
    gameActive = true;
    gameLevel = 1;
    gameScore = 0;
    gameLives = 3;
    gameCombo = 0;
    gameMaxCombo = 0;
    gameLevelUpTimer = 0;
    gameParticles = [];

    gameCanvas = document.createElement('canvas');
    gameCanvas.id = 'papGameCanvas';
    gameCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;cursor:none;';
    document.body.appendChild(gameCanvas);
    gameCanvas.width = window.innerWidth;
    gameCanvas.height = window.innerHeight;
    gameCtx = gameCanvas.getContext('2d');

    fLogo.style.display = 'none';
    setupGameLevel(gameLevel);
    gameStarted = true;
    gameLoop();

    gameCanvas.addEventListener('mousemove', function(e){
      if(gamePaddle) gamePaddle.x = e.clientX - gamePaddle.w / 2;
    });
    document.addEventListener('keydown', gameKeyHandler);
  }

  function gameKeyHandler(e){
    if(e.key === 'Escape' && gameActive) closeGame();
  }

  function closeGame(){
    gameActive = false;
    gameStarted = false;
    if(gameRaf) cancelAnimationFrame(gameRaf);
    if(gameCanvas) gameCanvas.remove();
    gameCanvas = null;
    fLogo.style.display = '';
    document.removeEventListener('keydown', gameKeyHandler);
  }

  function setupGameLevel(level){
    var cw = gameCanvas.width;
    var ch = gameCanvas.height;
    gameBalls = [];
    gameLevelUpTimer = 0;
    gamePaddle = {
      x: cw / 2 - 60, y: ch - 50,
      w: Math.max(80, 150 - level * 6), h: 14
    };
    // Start with 1 ball, add more as level increases
    var ballCount = Math.min(level, 6);
    for(var i = 0; i < ballCount; i++){
      spawnBall(cw, ch, level, i === 0);
    }
  }

  function spawnBall(cw, ch, level, isFirst){
    var size = 32 + Math.random() * 12;
    var baseSpeed = 2.5 + level * 0.4;
    // Random angle upward (between -30deg and -150deg from horizontal)
    var angle = -(0.3 + Math.random() * 0.4) * Math.PI;
    if(Math.random() > 0.5) angle = Math.PI + angle;
    var vx = Math.cos(angle) * baseSpeed * (0.8 + Math.random() * 0.4);
    var vy = -Math.abs(Math.sin(angle) * baseSpeed * (0.8 + Math.random() * 0.4));
    // First ball starts from paddle area, others from random top positions
    var startX, startY;
    if(isFirst){
      startX = cw / 2;
      startY = ch - 100;
      vy = -Math.abs(vy); // ensure going up
    } else {
      startX = 60 + Math.random() * (cw - 120);
      startY = 60 + Math.random() * (ch * 0.3);
      // Random direction but with some downward component
      vy = Math.abs(vy) * (Math.random() > 0.5 ? 1 : -1);
    }
    gameBalls.push({
      x: startX,
      y: startY,
      vx: vx,
      vy: vy,
      size: size,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.06,
      trail: [],
      bounceFlash: 0
    });
  }

  function spawnParticles(x, y, color, count){
    for(var i = 0; i < count; i++){
      var angle = Math.random() * Math.PI * 2;
      var speed = 1 + Math.random() * 3;
      gameParticles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.02 + Math.random() * 0.03,
        size: 2 + Math.random() * 3,
        color: color
      });
    }
  }

  function gameLoop(){
    if(!gameActive) return;
    gameRaf = requestAnimationFrame(gameLoop);
    var ctx = gameCtx;
    var cw = gameCanvas.width;
    var ch = gameCanvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // Background with subtle gradient
    var bgGrad = ctx.createRadialGradient(cw/2, ch/2, 0, cw/2, ch/2, cw * 0.7);
    bgGrad.addColorStop(0, 'rgba(15,15,15,0.92)');
    bgGrad.addColorStop(1, 'rgba(0,0,0,0.95)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cw, ch);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for(var gx = 0; gx < cw; gx += 80){
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, ch); ctx.stroke();
    }
    for(var gy = 0; gy < ch; gy += 80){
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.setLineDash([8, 12]);
    ctx.beginPath(); ctx.moveTo(0, ch/2); ctx.lineTo(cw, ch/2); ctx.stroke();
    ctx.setLineDash([]);

    // HUD
    ctx.fillStyle = '#fff';
    ctx.font = '600 14px Montserrat, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('LEVEL ' + gameLevel + '/' + gameMaxLevel, 20, 30);
    ctx.textAlign = 'center';
    ctx.fillText('SCORE: ' + gameScore, cw / 2, 30);
    ctx.textAlign = 'right';
    var heartsStr = '';
    for(var hi = 0; hi < gameLives; hi++) heartsStr += '\u2665 ';
    ctx.fillStyle = '#ff6b6b';
    ctx.fillText(heartsStr, cw - 20, 30);

    // Combo display
    if(gameCombo > 1){
      ctx.fillStyle = 'rgba(255,215,0,' + Math.min(1, 0.4 + gameCombo * 0.1) + ')';
      ctx.font = 'bold ' + (12 + gameCombo) + 'px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('COMBO x' + gameCombo, cw / 2, 55);
    }

    // Ball count & ESC hint
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '400 11px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BALLS: ' + gameBalls.length + '  |  ESC TO EXIT', cw / 2, ch - 15);

    // Level up flash
    if(gameLevelUpTimer > 0){
      gameLevelUpTimer--;
      var flashAlpha = gameLevelUpTimer / 60;
      ctx.fillStyle = 'rgba(255,215,0,' + (flashAlpha * 0.15) + ')';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = 'rgba(255,215,0,' + flashAlpha + ')';
      ctx.font = 'bold 42px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LEVEL ' + gameLevel + '!', cw / 2, ch / 2 - 40);
      if(gameLevel > 1){
        ctx.font = '400 14px Montserrat, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,' + (flashAlpha * 0.7) + ')';
        ctx.fillText('+1 BALL', cw / 2, ch / 2);
      }
    }

    // Update & draw particles
    for(var pi = gameParticles.length - 1; pi >= 0; pi--){
      var p = gameParticles[pi];
      p.x += p.vx; p.y += p.vy;
      p.life -= p.decay;
      if(p.life <= 0){ gameParticles.splice(pi, 1); continue; }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Update & draw bouncing logo balls
    for(var i = gameBalls.length - 1; i >= 0; i--){
      var ball = gameBalls[i];

      // Physics: move
      ball.x += ball.vx;
      ball.y += ball.vy;
      // Slight gravity pull
      ball.vy += 0.04;
      ball.rotation += ball.rotSpeed;
      if(ball.bounceFlash > 0) ball.bounceFlash -= 0.05;

      // Wall bounces (left, right, top)
      var r = ball.size / 2;
      if(ball.x - r <= 0){
        ball.x = r;
        ball.vx = Math.abs(ball.vx);
        ball.rotSpeed = -ball.rotSpeed;
        spawnParticles(ball.x, ball.y, 'rgba(255,255,255,0.5)', 3);
      }
      if(ball.x + r >= cw){
        ball.x = cw - r;
        ball.vx = -Math.abs(ball.vx);
        ball.rotSpeed = -ball.rotSpeed;
        spawnParticles(ball.x, ball.y, 'rgba(255,255,255,0.5)', 3);
      }
      if(ball.y - r <= 0){
        ball.y = r;
        ball.vy = Math.abs(ball.vy);
        spawnParticles(ball.x, ball.y, 'rgba(255,255,255,0.5)', 3);
      }

      // Paddle collision
      if(ball.vy > 0 &&
         ball.y + r >= gamePaddle.y &&
         ball.y - r <= gamePaddle.y + gamePaddle.h &&
         ball.x + r >= gamePaddle.x &&
         ball.x - r <= gamePaddle.x + gamePaddle.w){
        // Bounce up
        ball.y = gamePaddle.y - r;
        // Angle depends on where ball hits paddle
        var hitPos = (ball.x - gamePaddle.x) / gamePaddle.w; // 0 to 1
        var bounceAngle = (hitPos - 0.5) * 1.2; // -0.6 to 0.6
        var speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        speed = Math.min(speed * 1.02, 8 + gameLevel * 0.5); // slight acceleration, cap speed
        ball.vx = Math.sin(bounceAngle) * speed;
        ball.vy = -Math.abs(Math.cos(bounceAngle) * speed);
        ball.rotSpeed = bounceAngle * 0.1;
        ball.bounceFlash = 1;

        // Score & combo
        gameCombo++;
        if(gameCombo > gameMaxCombo) gameMaxCombo = gameCombo;
        var pts = 10 * Math.min(gameCombo, 5);
        gameScore += pts;

        spawnParticles(ball.x, gamePaddle.y, '#FFD700', 8);

        // Show points popup
        gameParticles.push({
          x: ball.x, y: gamePaddle.y - 20,
          vx: 0, vy: -1,
          life: 1, decay: 0.025,
          size: 0, color: '#FFD700',
          text: '+' + pts
        });
      }

      // Missed — fell below screen
      if(ball.y - r > ch + 20){
        gameBalls.splice(i, 1);
        gameLives--;
        gameCombo = 0;
        spawnParticles(ball.x, ch, '#ff4444', 12);
        // Respawn if still alive
        if(gameLives > 0 && gameBalls.length === 0){
          setTimeout(function(){
            if(gameActive){
              var bc = Math.min(gameLevel, 6);
              for(var bi = 0; bi < bc; bi++) spawnBall(cw, ch, gameLevel, bi === 0);
            }
          }, 500);
        }
        continue;
      }

      // Ball trail
      ball.trail.push({x: ball.x, y: ball.y, a: 0.4});
      if(ball.trail.length > 8) ball.trail.shift();

      // Draw trail
      for(var ti = 0; ti < ball.trail.length; ti++){
        var t = ball.trail[ti];
        t.a *= 0.85;
        ctx.globalAlpha = t.a * 0.3;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(t.x, t.y, ball.size * 0.3 * (ti / ball.trail.length), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Draw rotating logo ball
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.rotation);

      // Glow effect on bounce
      if(ball.bounceFlash > 0){
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 20 * ball.bounceFlash;
      }

      ctx.globalAlpha = 0.92;
      if(gameLogoImg.complete && gameLogoImg.naturalWidth > 0){
        ctx.drawImage(gameLogoImg, -ball.size / 2, -ball.size / 2, ball.size, ball.size);
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + Math.floor(ball.size * 0.45) + 'px Montserrat, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PAP', 0, 0);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Draw text particles (score popups)
    for(var tpi = gameParticles.length - 1; tpi >= 0; tpi--){
      var tp = gameParticles[tpi];
      if(tp.text){
        ctx.globalAlpha = tp.life;
        ctx.fillStyle = tp.color;
        ctx.font = 'bold 16px Montserrat, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(tp.text, tp.x, tp.y);
        tp.y += tp.vy;
        tp.life -= tp.decay;
        if(tp.life <= 0) gameParticles.splice(tpi, 1);
      }
    }
    ctx.globalAlpha = 1;

    // Draw paddle (stylized PAP bar)
    ctx.save();
    var padGrad = ctx.createLinearGradient(gamePaddle.x, gamePaddle.y, gamePaddle.x + gamePaddle.w, gamePaddle.y);
    padGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
    padGrad.addColorStop(0.5, '#fff');
    padGrad.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = padGrad;
    // Glow under paddle
    ctx.shadowColor = 'rgba(255,255,255,0.4)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(gamePaddle.x, gamePaddle.y, gamePaddle.w, gamePaddle.h, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAP', gamePaddle.x + gamePaddle.w / 2, gamePaddle.y + 11);
    ctx.textAlign = 'left';
    ctx.restore();

    // Check level clear
    var levelGoal = gameLevel * 150;
    if(gameScore >= levelGoal){
      if(gameLevel >= gameMaxLevel){
        // WIN!
        gameActive = false;
        cancelAnimationFrame(gameRaf);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 48px Montserrat, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('YOU WIN!', cw / 2, ch / 2 - 50);
        ctx.fillStyle = '#fff';
        ctx.font = '600 20px Montserrat, sans-serif';
        ctx.fillText('FINAL SCORE: ' + gameScore, cw / 2, ch / 2);
        ctx.font = '400 13px Montserrat, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('MAX COMBO: x' + gameMaxCombo, cw / 2, ch / 2 + 30);
        ctx.fillText('CLICK TO CLOSE', cw / 2, ch / 2 + 65);
        gameCanvas.onclick = function(){ closeGame(); };
        return;
      }
      // Level up!
      gameLevel++;
      gameLevelUpTimer = 60;
      // Keep existing balls, add a new one
      spawnBall(cw, ch, gameLevel, false);
      // Shrink paddle slightly
      gamePaddle.w = Math.max(80, 150 - gameLevel * 6);
    }

    // Game over
    if(gameLives <= 0){
      gameActive = false;
      cancelAnimationFrame(gameRaf);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 48px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', cw / 2, ch / 2 - 50);
      ctx.fillStyle = '#fff';
      ctx.font = '600 20px Montserrat, sans-serif';
      ctx.fillText('SCORE: ' + gameScore + '  |  LEVEL: ' + gameLevel, cw / 2, ch / 2);
      ctx.font = '400 13px Montserrat, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('MAX COMBO: x' + gameMaxCombo, cw / 2, ch / 2 + 30);
      ctx.fillText('CLICK TO RESTART', cw / 2, ch / 2 + 65);
      gameCanvas.onclick = function(){
        gameCanvas.onclick = null;
        gameActive = true;
        gameLevel = 1; gameScore = 0; gameLives = 3;
        gameCombo = 0; gameMaxCombo = 0;
        gameParticles = [];
        setupGameLevel(gameLevel);
        gameLoop();
      };
      return;
    }
  }

  // Double-click on FLOATING LOGO (center top) to start game
  if(fLogo){
    fLogo.style.cursor = 'pointer';
    var logoClickTimer = null;
    fLogo.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      if(logoClickTimer) clearTimeout(logoClickTimer);
      logoClickTimer = setTimeout(function(){ window.location.href = '/'; }, 300);
    });
    fLogo.addEventListener('dblclick', function(e){
      e.preventDefault();
      e.stopPropagation();
      if(logoClickTimer){ clearTimeout(logoClickTimer); logoClickTimer = null; }
      initGame();
    });

    // Add click-invite indicator (pulsing glow)
    var playHint = document.createElement('div');
    playHint.className = 'logo-play-hint';
    playHint.textContent = 'DOUBLE CLICK TO PLAY';
    playHint.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);white-space:nowrap;font-family:Montserrat,sans-serif;font-size:8px;font-weight:600;letter-spacing:.15em;color:rgba(255,255,255,0);padding-top:4px;pointer-events:none;transition:color .3s;';
    fLogo.appendChild(playHint);

    // Show hint on hover
    fLogo.addEventListener('mouseenter', function(){
      playHint.style.color = 'rgba(255,255,255,0.5)';
    });
    fLogo.addEventListener('mouseleave', function(){
      playHint.style.color = 'rgba(255,255,255,0)';
    });
  }
})();


// ======== MODAL CURSOR RESET (proactively disable floating cursor when popup opens) ========
function _resetCursorForModal(){
  // Prefer the internal reset (also resets closure state like onHero)
  if(window._papResetFloatingLogo){
    window._papResetFloatingLogo();
    return;
  }
  // Fallback: DOM-only reset (closure state unreachable)
  var fLogo=document.getElementById('floatingLogo');
  var heroEl=document.querySelector('.hero');
  if(fLogo){
    fLogo.classList.add('in-header');
    fLogo.classList.remove('on-cursor');
    fLogo.style.transition='all .4s cubic-bezier(.22,1,.36,1)';
    var hLogo=document.querySelector('.logo-wrap');
    if(hLogo){
      var r=hLogo.getBoundingClientRect();
      fLogo.style.left=(window.innerWidth/2)+'px';
      fLogo.style.top=(r.top+r.height/2)+'px';
    }
    fLogo.style.transform='translate(-50%,-50%)';
  }
  if(heroEl) heroEl.style.cursor='';
}

// ======== SIGNUP POPUP ========
// INDEPENDENT from cookie consent — both popups show SIMULTANEOUSLY on first visit.
// Cookie popup (bottom bar, z-index:10000) + Signup popup (center modal, z-index:5000)
// Each popup has its own state in localStorage and closes independently.
(function(){
  var SIGNUP_KEY = 'pap-signup-shown';
  // Check localStorage (persists across pages AND sessions)
  var dismissed;
  try { dismissed = localStorage.getItem(SIGNUP_KEY); } catch(e) { dismissed = null; }
  if(dismissed) return;

  function _showSignupPopup(){
    try{
      var el = document.getElementById('signupPopup');
      if(!el) return;
      el.classList.add('active');
      lockScroll();
      if(typeof _resetCursorForModal === 'function') _resetCursorForModal();
    }catch(e){ console.error('Signup popup error:', e); }
  }

  // Show immediately after DOM is ready (no waiting for cookie consent)
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(_showSignupPopup, 800); });
  } else {
    setTimeout(_showSignupPopup, 800);
  }
})();
function closeSignupPopup(){
  var el = document.getElementById('signupPopup');
  if(el) el.classList.remove('active');
  unlockScroll();
  // Save to localStorage so it persists across pages and doesn't reappear
  try { localStorage.setItem('pap-signup-shown', '1'); } catch(e) {}
}


// ======== MARQUEE ========
/* ── Infinite marquee (CSS-animation, truly seamless) ──
   We duplicate the original items so the track is 2× wide, then animate
   translateX from 0 to -50% via @keyframes papMarquee. Because the two
   halves are identical clones, the wrap at -50% is visually continuous
   — no jump, no stop-and-restart. We wait for fonts.ready before
   cloning so widths are final and pixel-aligned. Resize & language
   change both re-run setup. */
(function(){
  function setupMarquee(){
    var track=document.getElementById('marqueeTrack');
    if(!track) return;
    // Reset: disable animation, strip previously-added clones
    track.classList.remove('mq-anim');
    track.style.animation='';
    track.style.animationDuration='';
    track.style.transform='';
    var clones=track.querySelectorAll('[data-mq-clone]');
    for(var k=0;k<clones.length;k++) clones[k].parentNode.removeChild(clones[k]);
    // Mark remaining children as originals (idempotent on repeat calls)
    var origs=Array.prototype.slice.call(track.children);
    if(!origs.length) return;
    origs.forEach(function(el){ el.removeAttribute('data-mq-clone'); });
    // Force reflow so scrollWidth reflects 1-set content
    void track.offsetWidth;
    var setWidth=track.scrollWidth;
    if(setWidth<=0) return;
    // Need content ≥ 2× viewport AND even copies (so -50% lands on a clone boundary)
    var needed=Math.max(2, Math.ceil((window.innerWidth*2)/setWidth));
    if(needed % 2) needed++;
    // Append (needed-1) identical sets using live clones of the original nodes
    for(var c=1;c<needed;c++){
      origs.forEach(function(el){
        var n=el.cloneNode(true);
        n.setAttribute('data-mq-clone','1');
        track.appendChild(n);
      });
    }
    // Speed: ~80 px/s desktop, ~60 px/s mobile. Duration covers half the track.
    var pxPerSec=window.innerWidth<768?60:80;
    var halfWidth=(setWidth*needed)/2;
    var duration=Math.max(14, halfWidth/pxPerSec);
    track.style.animationDuration=duration+'s';
    // Force reflow then enable animation (avoids starting mid-layout)
    void track.offsetWidth;
    track.classList.add('mq-anim');
  }
  function schedule(){
    // Wait for webfonts (Montserrat 900) so measured widths are final.
    if(document.fonts && document.fonts.ready && typeof document.fonts.ready.then==='function'){
      document.fonts.ready.then(function(){ setTimeout(setupMarquee, 60); });
    } else {
      setTimeout(setupMarquee, 400);
    }
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
  // Re-setup on resize (debounced) & on language change (text widths change)
  var resizeTimer;
  window.addEventListener('resize', function(){
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(setupMarquee, 220);
  });
  document.addEventListener('pap-lang-changed', function(){
    setTimeout(setupMarquee, 100);
  });
})();


