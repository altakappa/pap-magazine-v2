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
  // 2026-07-26 감사 B-6 — 예전엔 textContent→innerHTML 직렬화였다. 그 방식은
  // <, >, & 만 엔티티가 되고 **따옴표는 그대로 남는다**. PAP.sanitize 결과가
  // value="…" / title="…" 같은 속성에 들어가면 `" onerror="` 로 속성을
  // 빠져나올 수 있어, 텍스트·속성 양쪽에서 안전하도록 직접 이스케이프한다.
  // (텍스트 노드에서는 &quot;/&#39; 가 따옴표로 렌더되어 표시 결과가 같다)
  function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  // ======== CSRF TOKEN HELPER ========
  function getCsrfToken() {
    var match = document.cookie.match(/(?:^|;\s*)pap_csrf=([^;]*)/);
    return match ? match[1] : null;
  }

  // HTTP header values must be US-ASCII (no control chars, no non-ASCII).
  // Safari throws "The string did not match the expected pattern." if violated.
  // Strip anything outside printable ASCII and trim whitespace/newlines defensively.
  function sanitizeHeaderValue(v) {
    if (!v) return '';
    try {
      // Remove CR/LF and anything outside printable ASCII (space..~)
      return String(v).replace(/[^\x20-\x7E]/g, '').trim();
    } catch (_) {
      return '';
    }
  }

  // ======== HTTP HELPER ========
  async function request(method, endpoint, data, isFormData) {
    const headers = {};
    const rawToken = getToken();
    const token = sanitizeHeaderValue(rawToken);
    // If the stored token got corrupted (non-ASCII / newline), drop it — server will fall back to httpOnly cookie.
    if (rawToken && !token) {
      try { console.warn('[PAP] stored token contained non-ASCII chars, dropping from Authorization header'); } catch(_){}
      try { removeToken(); } catch(_){}
    }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!isFormData) headers['Content-Type'] = 'application/json';

    // CSRF protection headers
    headers['X-Requested-With'] = 'XMLHttpRequest';
    var csrfToken = sanitizeHeaderValue(getCsrfToken());
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

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

        // Read body as text first — server might return non-JSON on platform errors
        // (Vercel 413 payload-too-large, 504 gateway-timeout, etc. return HTML).
        // Safari throws "SyntaxError: The string did not match the expected pattern."
        // when JSON.parse gets HTML, which is useless to the user.
        const rawText = await res.text();
        let json;
        try {
          json = rawText ? JSON.parse(rawText) : {};
        } catch (parseErr) {
          // Non-JSON response. Synthesize a helpful error message from status.
          const statusMsg =
            res.status === 413 ? 'Request payload too large. Please reduce the amount of data in the form and try again.' :
            res.status === 504 ? 'Server timeout — the upload took too long. Please try again with fewer/smaller files.' :
            res.status === 502 ? 'Bad gateway — the server is temporarily unavailable. Please try again.' :
            res.status === 401 ? 'Session expired. Please log in again.' :
            res.status === 403 ? 'Access denied.' :
            res.status === 404 ? 'Endpoint not found (' + endpoint + ').' :
            (res.status >= 500 ? 'Server error ' + res.status + '. Please try again later.' :
            'Unexpected server response (' + res.status + ').');
          // Keep a short preview of the HTML body in the console for diagnostics
          try {
            console.error('[PAP] non-JSON response from ' + endpoint, {
              status: res.status,
              contentType: res.headers.get('content-type'),
              bodyPreview: String(rawText || '').slice(0, 400),
            });
          } catch(_){}
          throw new Error(statusMsg);
        }

        // Handle 401 responses
        if (res.status === 401) {
          // If this is a login attempt, pass the error through (don't treat as expired session)
          if (endpoint === '/auth/login') {
            throw new Error(json.message || json.code || 'Invalid credentials');
          }
          // Otherwise treat as expired session
          removeToken();
          removeUser();
          // QA #207 — repaint the header dropdown the moment we wipe
          // localStorage so the user doesn't briefly see a logged-in
          // shell while the navigation hop is in flight. The function
          // is exposed on window by pap-auth.js. Wrapped in try/catch
          // because pap-auth.js may not have loaded yet on the very
          // first API call from a cold page.
          try {
            if (typeof window !== 'undefined' && typeof window._papUpdateAuthDropdown === 'function') {
              window._papUpdateAuthDropdown();
            }
          } catch(_){}
          if (window.location.pathname.indexOf('/auth') === -1) {
            window.location.href = '/auth';
          }
          throw new Error('Session expired. Please log in again.');
        }

        if (!res.ok) {
          // 2026-07-26 감사 C-1 — 서버가 내려주는 code/본문을 에러에 실어 보낸다.
          // 호출부(프론트)가 원문 영문 message 대신 code 로 언어별 문구를 고를 수
          // 있게 하기 위한 것. message 자체는 그대로 둬 기존 분기 로직과 호환된다.
          const err = new Error(json.message || 'Request failed');
          err.code = json.code || '';
          err.status = res.status;
          err.payload = json;
          throw err;
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
      // Notify server to invalidate all tokens (non-blocking)
      const token = getToken();
      if (token) {
        fetch(API_BASE + '/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
        }).catch(function() {});
      }
      removeToken();
      removeUser();
      window.location.href = '/';
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

    // 2026-07-11 — 저장된 회원 정보를 서버 기준으로 동기화.
    // 결제 웹훅·해지·관리자 변경으로 등급이 바뀌어도 재로그인 없이 반영된다.
    // (기존에는 로그인 시점의 등급이 localStorage에 박제되어, 결제 직후에도
    //  재로그인 전까지 무료 회원 취급되는 문제가 있었다)
    async refreshUser() {
      if (!getToken()) return null;
      try {
        const res = await request('GET', '/auth/me');
        if (res && res.user) {
          const cur = getUser() || {};
          const merged = Object.assign({}, cur, {
            id: res.user.id || cur.id,
            email: res.user.email || cur.email,
            name: res.user.name || cur.name,
            role: res.user.role || cur.role,
            subscription: res.user.subscription || 'free',
          });
          setUser(merged);
          return merged;
        }
      } catch (_) { /* 네트워크 실패 시 기존 저장값 유지 */ }
      return null;
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
      // Secure cookie-based flow: token comes via httpOnly cookie, exchanged via API
      if (params.get('oauth') === 'success') {
        fetch(API_BASE + '/auth/oauth-token', { method: 'POST', credentials: 'same-origin' })
          .then(r => r.json())
          .then(data => {
            if (data.token) {
              setToken(data.token);
              if (data.user) setUser(data.user);
              window.history.replaceState({}, document.title, window.location.pathname);
              // location.replace: the OAuth callback URL shouldn't sit in
              // history — back from index should go to wherever the user
              // started, not back through this auth roundtrip.
              window.location.replace('/');
            }
          })
          .catch(() => {
            ui.toast('Authentication failed', 'error');
          });
      }
    }
  };

  // ======== FILENAME SANITIZATION (for Safari FormData) ========
  // Safari's fetch throws "The string did not match the expected pattern."
  // when multipart form-data contains filenames with non-ASCII characters
  // (e.g. Korean). Rebuild File objects with an ASCII-safe filename.
  function asciiSafeFilename(original, fallbackPrefix) {
    var ext = '';
    if (typeof original === 'string') {
      var m = original.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
      if (m) ext = '.' + m[1];
    }
    var rand = Math.random().toString(36).slice(2, 8);
    return (fallbackPrefix || 'file') + '_' + Date.now() + '_' + rand + ext;
  }
  function safeFile(file, prefix) {
    if (!file) return file;
    try {
      var originalName = file.name || '';
      // If name already ASCII-printable (no control chars), keep as-is.
      if (/^[\x20-\x7E]+$/.test(originalName)) return file;
      var newName = asciiSafeFilename(originalName, prefix);
      // Prefer File constructor (modern browsers)
      if (typeof File === 'function') {
        try {
          return new File([file], newName, {
            type: file.type || 'application/octet-stream',
            lastModified: file.lastModified || Date.now(),
          });
        } catch (_) { /* fall through to Blob */ }
      }
      // Fallback: wrap as Blob (will be sent as "blob" but with correct MIME)
      var b = file.slice ? file.slice(0, file.size, file.type) : file;
      // Some browsers allow setting blob.name — harmless otherwise
      try { Object.defineProperty(b, 'name', { value: newName }); } catch (_) {}
      return b;
    } catch (_) {
      return file;
    }
  }

  // ======== SUBMISSIONS ========
  const submissions = {
    // Two-step direct upload flow to bypass Vercel's 4.5 MB body limit:
    //   1. POST /submissions/upload-url → returns signed Supabase URLs
    //   2. PUT each file directly to Supabase Storage
    //   3. POST /submissions with JSON metadata + resulting public URLs
    //
    // Video is accepted as an optional URL via data.videoUrl (Dropbox /
    // WeTransfer / Swisstransfer / Google Drive) — no video file upload.
    //
    // `onProgress(done, total, phase)` is called during the upload phase so
    // the UI can show a progress indicator (phase: 'sign' | 'upload').
    async create(data, lookImageFiles, additionalImageFiles, onProgress) {
      const looks = lookImageFiles || [];
      const extras = additionalImageFiles || [];

      // Build metadata list in a fixed order. We keep the ordering indexes so
      // that we can reconstruct lookUrls / additionalUrls after uploads.
      const metas = [];
      looks.forEach(function(f) {
        metas.push({ file: f, category: 'look' });
      });
      extras.forEach(function(f) {
        metas.push({ file: f, category: 'additional' });
      });

      if (metas.length === 0) {
        throw new Error('At least one image is required');
      }

      if (typeof onProgress === 'function') onProgress(0, metas.length, 'sign');

      // Step 1 — ask the server for signed upload URLs
      const signReq = metas.map(function(m) {
        var safe = safeFile(m.file, m.category);
        return {
          name: safe.name || 'file',
          type: safe.type || 'application/octet-stream',
          size: safe.size || 0,
          category: m.category,
        };
      });

      const signRes = await request('POST', '/submissions/upload-url', { files: signReq });
      if (!signRes || !Array.isArray(signRes.uploads) || signRes.uploads.length !== metas.length) {
        throw new Error('Failed to obtain upload URLs');
      }

      // Step 2 — PUT each file directly to Supabase Storage, in parallel
      var done = 0;
      const uploadPromises = metas.map(function(m, i) {
        const slot = signRes.uploads[i];
        const safe = safeFile(m.file, m.category);
        return fetch(slot.signedUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': slot.contentType || safe.type || 'application/octet-stream',
            'x-upsert': 'true',
          },
          body: safe,
        }).then(function(r) {
          if (!r.ok) {
            return r.text().catch(function(){return '';}).then(function(body) {
              throw new Error('Upload failed (' + r.status + ')' + (body ? ': ' + body.slice(0, 200) : ''));
            });
          }
          done++;
          if (typeof onProgress === 'function') onProgress(done, metas.length, 'upload');
          return slot;
        });
      });

      const settled = await Promise.all(uploadPromises);

      // Reconstruct look/additional URL arrays in original order
      const lookUrls = [];
      const additionalUrls = [];
      metas.forEach(function(m, i) {
        const slot = settled[i];
        if (!slot || !slot.publicUrl) return;
        if (m.category === 'look') lookUrls.push(slot.publicUrl);
        else additionalUrls.push(slot.publicUrl);
      });

      // Step 3 — send metadata + pre-uploaded URLs as plain JSON
      return await request('POST', '/submissions', {
        data: data,
        lookUrls: lookUrls,
        additionalUrls: additionalUrls,
      });
    },

    // Resubmit a previously-submitted work after admin requested a revision.
    // Mirrors create() but:
    //   - mixes already-uploaded `keptLookUrls` / `keptAdditionalUrls`
    //     (URLs from the original submission the user wants to keep) with any
    //     newly-added files that need fresh uploads.
    //   - PUTs the merged metadata to /api/submissions/:id, which sets the
    //     submission status back to 'pending' for re-review.
    async update(id, data, newLookFiles, newAdditionalFiles, keptLookUrls, keptAdditionalUrls, onProgress) {
      const newLooks = newLookFiles || [];
      const newExtras = newAdditionalFiles || [];
      const metas = [];
      newLooks.forEach(function(f) { metas.push({ file: f, category: 'look' }); });
      newExtras.forEach(function(f) { metas.push({ file: f, category: 'additional' }); });

      const keptLook = Array.isArray(keptLookUrls) ? keptLookUrls.slice() : [];
      const keptExtra = Array.isArray(keptAdditionalUrls) ? keptAdditionalUrls.slice() : [];
      if (keptLook.length + keptExtra.length + metas.length === 0) {
        throw new Error('At least one image is required');
      }

      let newLookUploaded = [];
      let newExtraUploaded = [];
      if (metas.length > 0) {
        if (typeof onProgress === 'function') onProgress(0, metas.length, 'sign');
        const signReq = metas.map(function(m) {
          var safe = safeFile(m.file, m.category);
          return { name: safe.name || 'file', type: safe.type || 'application/octet-stream', size: safe.size || 0, category: m.category };
        });
        const signRes = await request('POST', '/submissions/upload-url', { files: signReq });
        if (!signRes || !Array.isArray(signRes.uploads) || signRes.uploads.length !== metas.length) {
          throw new Error('Failed to obtain upload URLs');
        }
        var done = 0;
        const uploadPromises = metas.map(function(m, i) {
          const slot = signRes.uploads[i];
          const safe = safeFile(m.file, m.category);
          return fetch(slot.signedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': slot.contentType || safe.type || 'application/octet-stream', 'x-upsert': 'true' },
            body: safe,
          }).then(function(r) {
            if (!r.ok) {
              return r.text().catch(function(){return '';}).then(function(body) {
                throw new Error('Upload failed (' + r.status + ')' + (body ? ': ' + body.slice(0, 200) : ''));
              });
            }
            done++;
            if (typeof onProgress === 'function') onProgress(done, metas.length, 'upload');
            return slot;
          });
        });
        const settled = await Promise.all(uploadPromises);
        metas.forEach(function(m, i) {
          const slot = settled[i];
          if (!slot || !slot.publicUrl) return;
          if (m.category === 'look') newLookUploaded.push(slot.publicUrl);
          else newExtraUploaded.push(slot.publicUrl);
        });
      }

      // Final URL lists: kept (from original) come first to preserve cover-index meaning.
      const lookUrls = keptLook.concat(newLookUploaded);
      const additionalUrls = keptExtra.concat(newExtraUploaded);

      return await request('PUT', '/submissions/' + encodeURIComponent(id), {
        data: data,
        lookUrls: lookUrls,
        additionalUrls: additionalUrls,
      });
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
    // data: {
    //   photographer:{name,instagram,portfolio},  REQUIRED
    //   stylist:{name,instagram,portfolio},       REQUIRED
    //   videographer:{name,instagram,portfolio},  optional
    //   contact:{name,email},                     REQUIRED
    //   requestText: string,                      optional
    //   extras: [{role,name,instagram}]           optional
    // }
    // moodboardFiles: image File[]
    // proposalPdf: PDF File (REQUIRED — 촬영시안)
    // 2026-07-21 — 서브미션과 동일한 2단계 직접 업로드로 전환.
    //   1. POST /pullletters/upload-url → 파일별 서명 URL
    //   2. 각 파일을 스토리지로 직접 PUT
    //   3. POST /pullletters 에 JSON 메타데이터 + 경로만 전송
    //
    // 이전엔 무드보드와 PDF 를 multipart 로 한 요청에 실어 보냈는데,
    // Vercel 서버리스 요청 본문 한계가 4.5MB 라서 3MB PDF 하나로도
    // "Request payload too large" 가 났다. 게다가 파일은 신청 버튼을
    // 누를 때까지 전혀 전송되지 않아, 화면엔 업로드된 것처럼 보이지만
    // 실제로는 아무것도 올라가 있지 않았다.
    //
    // onProgress(done, total, phase) — phase: 'sign' | 'upload'
    async create(data, moodboardFiles, proposalPdf, onProgress) {
      // 2026-07-22 (도메니코 지시) — 무드보드 업로드란 폐지. 무드보드·촬영
      // 컨셉·팀 구성은 촬영시안 PDF 하나에 포함한다. moodboardFiles 는
      // 하위 호환용 파라미터로만 남기고(전달되면 여전히 업로드) 필수 아님.
      const moods = moodboardFiles || [];
      if (!proposalPdf) throw new Error('Proposal PDF is required');

      const metas = moods.map(function(f) { return { file: safeFile(f, 'mood'), category: 'moodboard' }; });
      metas.push({ file: safeFile(proposalPdf, 'proposal.pdf'), category: 'proposal' });

      if (typeof onProgress === 'function') onProgress(0, metas.length, 'sign');

      // ── 1) 서명 URL 발급 ──
      const signRes = await request('POST', '/pullletters/upload-url', {
        files: metas.map(function(m) {
          return {
            name: m.file.name || 'file',
            type: m.file.type || 'application/octet-stream',
            size: m.file.size || 0,
            category: m.category,
          };
        }),
      });
      if (!signRes || !Array.isArray(signRes.uploads) || signRes.uploads.length !== metas.length) {
        throw new Error('Failed to obtain upload URLs');
      }

      // ── 2) 스토리지로 직접 업로드 ──
      var done = 0;
      await Promise.all(signRes.uploads.map(function(u, i) {
        return fetch(u.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': u.contentType || metas[i].file.type || 'application/octet-stream' },
          body: metas[i].file,
        }).then(function(r) {
          if (!r.ok) throw new Error('Upload failed (' + r.status + ')');
          done++;
          if (typeof onProgress === 'function') onProgress(done, metas.length, 'upload');
        });
      }));

      // ── 3) 메타데이터만 전송 ──
      const moodboardUrls = signRes.uploads
        .filter(function(u) { return u.category === 'moodboard'; })
        .map(function(u) { return u.publicUrl; });
      const proposal = signRes.uploads.find(function(u) { return u.category === 'proposal'; });

      return await request('POST', '/pullletters', Object.assign({}, data, {
        moodboardUrls: moodboardUrls,
        proposalPath: proposal ? proposal.path : '',
      }));
    },

    async getMine() {
      return await request('GET', '/pullletters/mine');
    },

    // 신청자 본인의 철회 (2026-07-26 감사 B-2). 서버가 status='pending' 이고
    // 발급 PDF 가 없을 때만 허용한다 — 그 외에는 409 로 거절된다.
    async cancel(id) {
      return await request('DELETE', '/pullletters/' + encodeURIComponent(id));
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
    async checkout(plan, billing, trial) {
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
        trial: trial === true,
      });
      return res;
    },

    /**
     * Guest checkout — pay by card without prior login.
     * Creates an account behind the scenes, runs PortOne, returns a JWT
     * we drop straight into localStorage so the user is logged in.
     * A "set your password" email is sent automatically.
     */
    async guestCheckout(plan, billing, guestInfo) {
      if (typeof PortOne === 'undefined') {
        throw new Error('Payment SDK not loaded. Please refresh the page.');
      }
      var storeId = window._PAP_PORTONE_STORE_ID;
      var channelKey = window._PAP_PORTONE_CHANNEL_KEY;
      if (!storeId || !channelKey) {
        throw new Error('Payment configuration missing');
      }
      if (!guestInfo || !guestInfo.email || !guestInfo.name) {
        throw new Error((typeof lang!=='undefined'&&lang==='ko')?'이메일과 이름이 필요해요.':'Email and name are required.');
      }

      // 1) Issue billing key in the same PortOne popup as authenticated checkout.
      var issueResponse = await PortOne.requestIssueBillingKey({
        storeId: storeId,
        channelKey: channelKey,
        billingKeyMethod: 'CARD',
        customer: { email: guestInfo.email, fullName: guestInfo.name },
      });
      if (issueResponse.code != null) {
        throw new Error(issueResponse.message || 'Payment cancelled');
      }

      // 2) Send to /guest-checkout — no auth header, server validates email is fresh.
      var resp = await fetch(API_BASE + '/subscriptions/guest-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: guestInfo.email,
          name: guestInfo.name,
          billingKey: issueResponse.billingKey,
          plan: plan,
          billing: billing,
        }),
      });
      var data = await resp.json();
      if (!resp.ok) {
        // Bubble up the friendly server message verbatim.
        var err = new Error(data.message || 'Guest checkout failed');
        err.existingAccount = !!data.existingAccount;
        throw err;
      }

      // 3) Auto-login by stashing the JWT + user object exactly the way
      //    /api/auth/oauth-token does. The next page load reads from
      //    localStorage and treats them as logged-in.
      if (data.token) {
        try { localStorage.setItem('pap-token', data.token); } catch (_) {}
      }
      if (data.user) {
        try { localStorage.setItem('pap-user', JSON.stringify(data.user)); } catch (_) {}
      }
      return data;
    },

    /**
     * 해외 결제 — Paddle Billing 오버레이 체크아웃 (EUR/USD 등 다통화 + VAT 처리).
     * 로그인 필수: custom_data.user_id 로 웹훅이 구독을 계정에 매핑한다.
     * 결과 반영은 paddle-webhook 이 담당 — 여기선 오버레이만 연다.
     */
    async checkoutIntl(plan, billing) {
      if (typeof Paddle === 'undefined') {
        throw new Error('Payment SDK not loaded. Please refresh the page.');
      }
      var user = auth.getUser();
      if (!user || !user.id) {
        throw new Error('Please sign in first to subscribe with international payment.');
      }
      var cfg = await request('GET', '/subscriptions/paddle-config');
      // 결제 일시중단(공급사 교체) — 원인 불명 에러 대신 안내로 흘린다.
      if (cfg && cfg.paused) {
        var _pe = new Error('PAYMENTS_PAUSED');
        _pe.code = 'PAYMENTS_PAUSED';
        throw _pe;
      }
      if (!cfg || !cfg.clientToken) {
        throw new Error('International payment is not available yet.');
      }
      if (!window._papPaddleInit) {
        if (cfg.environment === 'sandbox') {
          try { Paddle.Environment.set('sandbox'); } catch (_) {}
        }
        Paddle.Initialize({
          token: cfg.clientToken,
          eventCallback: function (ev) {
            // 체크아웃 완료 → 안내 + 새로고침으로 구독 상태 반영.
            if (ev && ev.name === 'checkout.completed') {
              try {
                if (window.PAP && PAP.ui && PAP.ui.toast) {
                  PAP.ui.toast('Payment complete! Updating your membership…', 'success');
                }
              } catch (_) {}
              // 2026-07-11 — Paddle 웹훅이 등급을 올릴 때까지 짧게 폴링한 뒤 이동.
              // 곧바로 이동하면 결제 직후에도 '무료 회원'으로 보이는 문제가 있었다.
              // 최대 8회 × 1.5초(약 12초) 대기 후에는 그냥 이동 (페이지 로드 동기화가 후속 보정).
              var _tries = 0;
              (function _waitUpgrade() {
                auth.refreshUser().then(function (u) {
                  var up = u && (u.subscription === 'standard' || u.subscription === 'premium');
                  if (up || _tries >= 8) { window.location.href = '/mypage'; return; }
                  _tries++; setTimeout(_waitUpgrade, 1500);
                }).catch(function () {
                  if (_tries >= 8) { window.location.href = '/mypage'; return; }
                  _tries++; setTimeout(_waitUpgrade, 1500);
                });
              })();
            }
          },
        });
        window._papPaddleInit = true;
      }
      var key = plan + '_' + billing;
      var priceId = cfg.prices && cfg.prices[key];

      // 2026-08-03 시윤 3단계 — 재체험 차단.
      // 해지했다가 다시 구독하는 사람에게 또 7일 무료체험을 주지 않는다.
      // 판정은 서버(/subscriptions/trial-eligibility)가 하고, 여기서는 price id 만
      // '체험 없는' 쪽으로 갈아 끼운다. 판정 실패·price 미설정이면 기존 price 로
      // 그대로 진행한다(fail-open — 어떤 경우에도 결제 자체를 막지 않는다).
      var noTrial = false;
      try {
        var elig = await request('GET', '/subscriptions/trial-eligibility');
        if (elig && elig.eligible === false) {
          var altPrice = cfg.pricesNoTrial && cfg.pricesNoTrial[key];
          if (altPrice) { priceId = altPrice; noTrial = true; }
        }
      } catch (_) { /* 판정 실패 → 기존 price 유지 */ }

      if (!priceId) {
        throw new Error('This plan is not available for international checkout yet.');
      }
      Paddle.Checkout.open({
        items: [{ priceId: priceId, quantity: 1 }],
        customer: user.email ? { email: user.email } : undefined,
        customData: { user_id: user.id, plan_key: key, no_trial: noTrial },
        settings: { displayMode: 'overlay', theme: 'dark', locale: (localStorage.getItem('pap-lang') || 'en') },
      });
      return { opened: true };
    },

    /** 해외(Paddle) 구독 해지 — 현재 결제 기간 말에 종료. */
    async cancelIntlSubscription() {
      return await request('POST', '/subscriptions/paddle-portal', { action: 'cancel' });
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
          authBtn.href = '/mypage';
          authBtn.style.opacity = '1';
          // Change icon to filled circle to indicate logged-in
          authBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';
        } else {
          authBtn.href = '/auth';
        }
      }

      // Update nav LOGIN / JOIN link
      const navLogin = document.querySelector('[data-i18n="navLogin"]');
      if (navLogin && loggedIn && user) {
        navLogin.textContent = user.name || 'MY PAGE';
        navLogin.href = '/mypage';
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

    // Show modal notification (center screen with confirm button)
    toast(message, type) {
      // Overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;animation:papFadeIn .2s ease;';
      // Modal box
      const modal = document.createElement('div');
      modal.style.cssText = 'background:#111;border:1px solid rgba(255,255,255,.12);padding:32px 28px 24px;max-width:380px;width:90%;text-align:center;font-family:Montserrat,sans-serif;animation:papSlideUp .25s ease;';
      // Icon
      const icon = document.createElement('div');
      icon.style.cssText = 'font-size:28px;margin-bottom:16px;';
      icon.textContent = type === 'error' ? '⚠' : type === 'success' ? '✓' : 'ℹ';
      // Message
      const msg = document.createElement('div');
      msg.style.cssText = 'font-size:13px;font-weight:500;color:#fff;line-height:1.7;letter-spacing:.02em;margin-bottom:24px;word-break:keep-all;';
      msg.textContent = message;
      // Confirm button
      const btn = document.createElement('button');
      btn.style.cssText = 'background:#fff;color:#000;border:none;padding:11px 40px;font-size:12px;font-weight:700;letter-spacing:.08em;cursor:pointer;font-family:Montserrat,sans-serif;transition:opacity .2s;';
      btn.textContent = (typeof lang!=='undefined'&&lang==='ko')?'확인':'OK';
      btn.onmouseenter = function(){ btn.style.opacity='.8'; };
      btn.onmouseleave = function(){ btn.style.opacity='1'; };
      btn.onclick = function(){ overlay.style.opacity='0'; setTimeout(function(){ overlay.remove(); }, 200); };
      // Also close on overlay click
      overlay.onclick = function(e){ if(e.target===overlay){ btn.onclick(); } };
      // Assemble
      modal.appendChild(icon);
      modal.appendChild(msg);
      modal.appendChild(btn);
      overlay.appendChild(modal);
      // Inject keyframe animations if not already present
      if (!document.getElementById('papModalStyles')) {
        const style = document.createElement('style');
        style.id = 'papModalStyles';
        style.textContent = '@keyframes papFadeIn{from{opacity:0}to{opacity:1}}@keyframes papSlideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}';
        document.head.appendChild(style);
      }
      document.body.appendChild(overlay);
      btn.focus();
    }
  };

  // Auto-check login state on page load
  document.addEventListener('DOMContentLoaded', function() {
    ui.updateLoginState();
    auth.handleOAuthCallback();
    // 2026-07-11 — 로그인 상태면 회원 등급을 서버와 동기화 (5분 스로틀).
    // 결제·해지·관리자 변경이 재로그인 없이도 다음 페이지 이동 시 반영된다.
    try {
      if (auth.isLoggedIn()) {
        var _last = 0;
        try { _last = parseInt(sessionStorage.getItem('pap-user-sync') || '0', 10) || 0; } catch (_) {}
        if (Date.now() - _last > 5 * 60 * 1000) {
          try { sessionStorage.setItem('pap-user-sync', String(Date.now())); } catch (_) {}
          auth.refreshUser().then(function (u) {
            if (u) { try { ui.updateLoginState(); } catch (_) {} }
          });
        }
      }
    } catch (_) {}
  });

  return { auth, submissions, pullLetters, community, subscriptions, ui, sanitize };
})();
