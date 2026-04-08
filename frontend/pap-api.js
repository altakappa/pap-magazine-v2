/**
 * PAP Magazine - Frontend API Connector
 * Include this script in any HTML page to connect to the backend.
 *
 * Usage:
 *   <script src="pap-api.js"></script>
 *   Then use: PAP.auth.login(email, password)
 *             PAP.submissions.create(data)
 *             PAP.user.getProfile()
 *             etc.
 */

const PAP = (function() {
  // ======== CONFIGURATION ========
  // IMPORTANT: Set your production API URL before deployment
  // API is served from the same Vercel deployment under /api
  const API_BASE = (window.PAP_CONFIG && window.PAP_CONFIG.API_BASE)
    || (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api');

  // ======== HTML SANITIZATION ========
  function sanitize(str) {
    if (typeof str !== 'string') return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ======== TOKEN MANAGEMENT ========
  // Migrate old sessionStorage tokens to localStorage (one-time)
  (function migrateTokens(){
    try {
      var oldT = sessionStorage.getItem('pap-token');
      var oldU = sessionStorage.getItem('pap-user');
      if (oldT && !localStorage.getItem('pap-token')) { localStorage.setItem('pap-token', oldT); }
      if (oldU && !localStorage.getItem('pap-user')) { localStorage.setItem('pap-user', oldU); }
      if (oldT) sessionStorage.removeItem('pap-token');
      if (oldU) sessionStorage.removeItem('pap-user');
    } catch(e){}
  })();
  function getToken() { return localStorage.getItem('pap-token'); }
  function setToken(token) { localStorage.setItem('pap-token', token); }
  function removeToken() { localStorage.removeItem('pap-token'); }
  function getUser() {
    const u = localStorage.getItem('pap-user');
    try { return u ? JSON.parse(u) : null; } catch(e) { return null; }
  }
  function setUser(user) {
    // Store only non-sensitive user fields
    var safe = { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription };
    localStorage.setItem('pap-user', JSON.stringify(safe));
  }
  function removeUser() { localStorage.removeItem('pap-user'); }

  // ======== HTTP HELPER ========
  async function request(method, endpoint, data, isFormData) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!isFormData) headers['Content-Type'] = 'application/json';

    // CSRF protection header
    headers['X-Requested-With'] = 'XMLHttpRequest';

    const options = { method, headers, credentials: 'same-origin' };
    if (data) {
      options.body = isFormData ? data : JSON.stringify(data);
    }

    // Add abort controller for 30 second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    options.signal = controller.signal;

    let lastError;
    // Retry once on network error (not 4xx/5xx responses)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(API_BASE + endpoint, options);
        clearTimeout(timeoutId);
        const json = await res.json();

        // Handle expired sessions
        if (res.status === 401) {
          removeToken();
          removeUser();
          if (window.location.pathname.indexOf('auth.html') === -1) {
            window.location.href = 'auth.html';
          }
          throw new Error('Session expired. Please log in again.');
        }

        if (!res.ok) {
          throw new Error(json.message || 'Request failed');
        }
        return json;
      } catch (error) {
        lastError = error;
        // Only retry on network errors (AbortError, TypeError) or timeout, not on HTTP errors
        if (attempt === 0 && (error instanceof TypeError || error.name === 'AbortError')) {
          continue;
        }
        clearTimeout(timeoutId);
        throw error;
      }
    }
    clearTimeout(timeoutId);
    throw lastError;
  }

  // ======== AUTH ========
  const auth = {
    async signup(userData) {
      const res = await request('POST', '/auth/signup', userData);
      if (res.token) {
        setToken(res.token);
        setUser(res.user);
      }
      return res;
    },

    async login(email, password) {
      const res = await request('POST', '/auth/login', { email, password });
      if (res.token) {
        setToken(res.token);
        setUser(res.user);
      }
      return res;
    },

    logout() {
      removeToken();
      removeUser();
      window.location.href = 'pap-magazine-v5.html';
    },

    isLoggedIn() {
      return !!getToken();
    },

    getUser() {
      return getUser();
    },

    async getProfile() {
      return await request('GET', '/auth/me');
    },

    async updateProfile(data) {
      return await request('PUT', '/auth/me', data);
    },

    // Redirect to Google OAuth
    loginWithGoogle() {
      window.location.href = API_BASE + '/auth/google';
    },

    // Redirect to Facebook OAuth
    loginWithFacebook() {
      window.location.href = API_BASE + '/auth/facebook';
    },

    // Redirect to Kakao OAuth
    loginWithKakao() {
      window.location.href = API_BASE + '/auth/kakao';
    },

    // Handle OAuth callback (call this on page load of auth.html)
    handleOAuthCallback() {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      if (token) {
        // Remove token from URL immediately to prevent leaking via referrer
        window.history.replaceState({}, document.title, window.location.pathname);
        setToken(token);
        // Fetch user profile
        request('GET', '/auth/me').then(res => {
          setUser(res.user);
          window.location.href = 'pap-magazine-v5.html';
        }).catch(() => {
          removeToken();
          ui.toast('Authentication failed', 'error');
        });
      }
    }
  };

  // ======== SUBMISSIONS ========
  const submissions = {
    async create(data, lookImageFiles, additionalImageFiles) {
      const formData = new FormData();

      // Add look images
      if (lookImageFiles) {
        lookImageFiles.forEach(file => formData.append('lookImages', file));
      }

      // Add additional images
      if (additionalImageFiles) {
        additionalImageFiles.forEach(file => formData.append('additionalImages', file));
      }

      // Add JSON data
      formData.append('data', JSON.stringify(data));

      return await request('POST', '/submissions', formData, true);
    },

    async getMine() {
      return await request('GET', '/submissions/mine');
    },

    async getById(id) {
      return await request('GET', '/submissions/' + encodeURIComponent(id));
    },

    // Admin
    async getAll(status, page) {
      let url = '/submissions?page=' + (page || 1);
      if (status) url += '&status=' + encodeURIComponent(status);
      return await request('GET', url);
    },

    async review(id, status, reviewNote) {
      return await request('PUT', '/submissions/' + encodeURIComponent(id) + '/review', { status, reviewNote });
    }
  };

  // ======== PULL-LETTERS ========
  const pullLetters = {
    async create(data, moodboardFiles) {
      const formData = new FormData();
      if (moodboardFiles) {
        moodboardFiles.forEach(file => formData.append('moodboard', file));
      }
      formData.append('data', JSON.stringify(data));
      return await request('POST', '/pullletters', formData, true);
    },

    async getMine() {
      return await request('GET', '/pullletters/mine');
    },

    // Admin
    async getAll(status) {
      let url = '/pullletters';
      if (status) url += '?status=' + encodeURIComponent(status);
      return await request('GET', url);
    },

    async review(id, status, reviewNote) {
      return await request('PUT', '/pullletters/' + encodeURIComponent(id) + '/review', { status, reviewNote });
    }
  };

  // ======== COMMUNITY ========
  const community = {
    async getPosts(tag, page) {
      let url = '/community/posts?page=' + (page || 1);
      if (tag) url += '&tag=' + encodeURIComponent(tag);
      return await request('GET', url);
    },

    async createPost(title, content, tag) {
      return await request('POST', '/community/posts', { title, content, tag });
    },

    async likePost(postId) {
      return await request('POST', '/community/posts/' + encodeURIComponent(postId) + '/like');
    },

    async getComments(postId) {
      return await request('GET', '/community/posts/' + encodeURIComponent(postId) + '/comments');
    },

    async addComment(postId, content) {
      return await request('POST', '/community/posts/' + encodeURIComponent(postId) + '/comments', { content });
    },

    async getProjects(status) {
      let url = '/community/projects';
      if (status) url += '?status=' + encodeURIComponent(status);
      return await request('GET', url);
    },

    async createProject(data) {
      return await request('POST', '/community/projects', data);
    },

    async applyToProject(projectId, role, message) {
      return await request('POST', '/community/projects/' + encodeURIComponent(projectId) + '/apply', { role, message });
    },

    async getDirectory(role, query, page) {
      let url = '/community/directory?page=' + (page || 1);
      if (role && role !== 'all') url += '&role=' + encodeURIComponent(role);
      if (query) url += '&q=' + encodeURIComponent(query);
      return await request('GET', url);
    }
  };

  // ======== SUBSCRIPTIONS (PortOne V2) ========
  const subscriptions = {
    /**
     * Issue billing key via PortOne popup, then create subscription on backend
     */
    async checkout(plan, billing) {
      if (typeof PortOne === 'undefined') {
        throw new Error('Payment SDK not loaded. Please refresh the page.');
      }
      var storeId = window._PAP_PORTONE_STORE_ID;
      var channelKey = window._PAP_PORTONE_CHANNEL_KEY;
      if (!storeId || !channelKey) {
        throw new Error('Payment configuration missing');
      }

      // 1) Request billing key via PortOne popup (card registration)
      var issueResponse = await PortOne.requestIssueBillingKey({
        storeId: storeId,
        channelKey: channelKey,
        billingKeyMethod: 'CARD',
      });

      if (issueResponse.code != null) {
        throw new Error(issueResponse.message || 'Payment cancelled');
      }

      // 2) Send billing key + plan to backend for payment
      var res = await request('POST', '/subscriptions/checkout', {
        billingKey: issueResponse.billingKey,
        plan: plan,
        billing: billing,
      });
      return res;
    },

    async cancelSubscription() {
      return await request('POST', '/subscriptions/portal', { action: 'cancel' });
    },

    async getSubscription() {
      return await request('GET', '/subscriptions/portal');
    },

    async manageSubscription() {
      return this.cancelSubscription();
    }
  };

  // ======== UI HELPERS ========
  const ui = {
    // Update UI based on login state
    updateLoginState() {
      const loggedIn = auth.isLoggedIn();
      const user = auth.getUser();

      // Hide/show gate overlays
      document.querySelectorAll('.access-gate-overlay').forEach(el => {
        if (loggedIn) el.classList.add('hidden');
      });

      // Update signup popups
      if (loggedIn) {
        const popup = document.getElementById('signupPopup');
        if (popup) popup.style.display = 'none';
      }

      // Update header auth button: link to mypage when logged in
      const authBtn = document.querySelector('.auth-btn-header');
      if (authBtn) {
        if (loggedIn) {
          authBtn.href = 'mypage.html';
          authBtn.style.opacity = '1';
          // Change icon to filled circle to indicate logged-in
          authBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';
        } else {
          authBtn.href = 'auth.html';
        }
      }

      // Update nav LOGIN / JOIN link
      const navLogin = document.querySelector('[data-i18n="navLogin"]');
      if (navLogin && loggedIn && user) {
        navLogin.textContent = user.name || 'MY PAGE';
        navLogin.href = 'mypage.html';
        navLogin.style.color = 'rgba(255,255,255,.9)';
      }

      // Show user info in header if available
      if (loggedIn && user) {
        const writeBtn = document.querySelector('.c-write-btn');
        if (writeBtn) writeBtn.textContent = user.name;
      }
    },

    // Check subscription access
    checkAccess(requiredTier) {
      const user = auth.getUser();
      if (!user) return false;
      const tiers = { free: 0, standard: 1, premium: 2 };
      return tiers[user.subscription] >= tiers[requiredTier];
    },

    // Show toast notification
    toast(message, type) {
      const t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:14px 24px;font-size:12px;font-weight:600;letter-spacing:.05em;z-index:9999;transition:all .3s;font-family:Montserrat,sans-serif;';
      t.style.background = type === 'error' ? '#ff4444' : type === 'success' ? '#44bb66' : '#333';
      t.style.color = '#fff';
      t.textContent = message;
      document.body.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
    }
  };

  // Auto-check login state on page load
  document.addEventListener('DOMContentLoaded', function() {
    ui.updateLoginState();
    auth.handleOAuthCallback();
  });

  return { auth, submissions, pullLetters, community, subscriptions, ui, sanitize };
})();
