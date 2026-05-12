/* PAP Admin — Email Campaigns
   ----------------------------------------------------------------
   All campaign-related UI logic lives in a single global `campaigns`
   namespace so it doesn't collide with the rest of pap-admin.js. The
   admin.html tab fires campaigns.load() when activated and the editor
   modal calls campaigns.openEditor(type) etc.

   Recipient counts and the eligible-pool number both come from
   /api/admin/campaigns GET — no separate count endpoint needed.
*/
(function () {
  if (typeof window === 'undefined') return;

  const apiBase = (window.PAP_CONFIG && window.PAP_CONFIG.API_BASE) || '/api';
  const auth = () => ({ 'Authorization': 'Bearer ' + localStorage.getItem('pap-token') });

  // In-memory state for the editor (resets each open()).
  const state = {
    mode: null,             // 'editorial-weekly' | 'news-weekly'
    editingId: null,        // existing campaign id or null
    pickedEditorials: [],   // [{id, slug, title, image, credit, tagline}]
    pool: [],               // all editorials (loaded once)
    poolFiltered: [],       // search-filtered subset of pool
    newsItems: [],          // [{title, summary, url, image, category}]
    eligibleRecipients: 0,
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const p = n => n < 10 ? '0' + n : '' + n;
      return d.getFullYear() + '.' + p(d.getMonth()+1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (_) { return iso; }
  }
  function toLocalDatetimeInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => n < 10 ? '0' + n : '' + n;
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fromLocalDatetimeInput(v) {
    if (!v) return null;
    return new Date(v).toISOString();
  }

  // ── List page ───────────────────────────────────────────────────
  async function load() {
    const tbody = $('campaignListBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px 0">불러오는 중...</td></tr>';
    try {
      const res = await fetch(apiBase + '/admin/campaigns?limit=80', { headers: auth() });
      if (!res.ok) throw new Error('GET /admin/campaigns ' + res.status);
      const json = await res.json();
      state.eligibleRecipients = json.eligibleRecipients || 0;
      const elig = $('campaignEligibleCount');
      if (elig) elig.textContent = state.eligibleRecipients.toLocaleString();
      renderList(json.data || []);
    } catch (err) {
      console.error('[campaigns.load]', err);
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#ff6b6b;padding:40px 0">불러오기 실패</td></tr>';
    }
  }
  function renderList(rows) {
    const tbody = $('campaignListBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:40px 0">등록된 캠페인이 없습니다</td></tr>';
      return;
    }
    const typeLabel = (t) => t === 'editorial-weekly' ? '이주의 에디토리얼' : t === 'news-weekly' ? '이주의 뉴스' : t;
    const statusLabel = (s) => ({
      draft: '<span class="badge b-pending">임시저장</span>',
      scheduled: '<span class="badge b-revision">예약됨</span>',
      sending: '<span class="badge b-pending">발송 중</span>',
      sent: '<span class="badge b-approved">발송 완료</span>',
      failed: '<span class="badge b-declined">실패</span>',
      cancelled: '<span class="badge">취소</span>',
    }[s] || s);
    tbody.innerHTML = rows.map(r => {
      const editable = r.status === 'draft' || r.status === 'scheduled';
      const actions = [
        editable ? `<button class="btn btn-sm" onclick="campaigns.edit('${r.id}')">편집</button>` : `<button class="btn btn-sm" onclick="campaigns.viewStats('${r.id}')">통계</button>`,
        editable ? `<button class="btn btn-sm btn-red" onclick="campaigns.remove('${r.id}')">삭제</button>` : ''
      ].filter(Boolean).join(' ');
      return `<tr>
        <td>${esc(r.name)}</td>
        <td>${typeLabel(r.type)}</td>
        <td class="td-title">${esc(r.subject)}</td>
        <td>${r.scheduled_at ? fmtDate(r.scheduled_at) : '—'}</td>
        <td>${r.sent_at ? fmtDate(r.sent_at) : '—'}</td>
        <td>${r.recipient_count || 0} / ${r.sent_count || 0} / ${r.failed_count || 0}</td>
        <td>${statusLabel(r.status)}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
  }

  // ── Editor modal ────────────────────────────────────────────────
  async function openEditor(type, existing) {
    state.mode = type;
    state.editingId = (existing && existing.id) || null;
    state.pickedEditorials = [];
    state.newsItems = [];

    $('campaignEditorTitle').textContent = type === 'editorial-weekly' ? '이주의 에디토리얼 편집' : '이주의 뉴스 편집';
    $('campaignEditorRecipients').textContent = (state.eligibleRecipients || 0).toLocaleString();
    $('campName').value = (existing && existing.name) || '';
    $('campSubject').value = (existing && existing.subject) || '';
    $('campPreheader').value = (existing && existing.preheader) || '';
    $('campHeadline').value = (existing && existing.hero_headline) || '';
    $('campBody').value = (existing && existing.hero_body) || '';
    $('campScheduledAt').value = existing && existing.scheduled_at ? toLocalDatetimeInput(existing.scheduled_at) : '';

    $('campEditorialsSection').style.display = type === 'editorial-weekly' ? 'block' : 'none';
    $('campNewsSection').style.display = type === 'news-weekly' ? 'block' : 'none';

    if (type === 'editorial-weekly') {
      if (existing && existing.payload && Array.isArray(existing.payload.editorials)) {
        state.pickedEditorials = existing.payload.editorials.slice();
      }
      await loadEditorialPool();
      renderPicked();
    } else if (type === 'news-weekly') {
      if (existing && existing.payload && Array.isArray(existing.payload.newsItems)) {
        state.newsItems = existing.payload.newsItems.slice();
      } else {
        // Start with 3 empty rows so the admin has slots to fill.
        state.newsItems = [emptyNewsItem(), emptyNewsItem(), emptyNewsItem()];
      }
      renderNewsItems();
    }

    $('campaignEditorModal').classList.add('active');
  }

  function closeEditor() {
    $('campaignEditorModal').classList.remove('active');
  }

  // Load all published editorials for the picker. We hit the public
  // /api/editorials endpoint (no admin gate) since the picker only
  // ever offers what's already public — there's no risk of leaking
  // unpublished drafts into the email.
  async function loadEditorialPool() {
    const pool = $('campEditorialPool');
    pool.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:11px">불러오는 중...</div>';
    try {
      const res = await fetch(apiBase + '/editorials?status=published&limit=100&page=1');
      if (!res.ok) throw new Error('GET /editorials ' + res.status);
      const json = await res.json();
      state.pool = (json.data || []).map(e => ({
        id: e.id,
        slug: e.slug || '',
        title: e.title || '',
        image: e.cover_image || e.thumbnail || '',
        credit: '',
        tagline: (Array.isArray(e.tags) && e.tags[0]) ? e.tags[0] : 'EDITORIAL',
      })).filter(e => e.image);
      state.poolFiltered = state.pool;
      renderPool();
    } catch (err) {
      console.error('[campaigns.loadEditorialPool]', err);
      pool.innerHTML = '<div style="padding:16px;color:#ff6b6b;font-size:11px">불러오기 실패</div>';
    }
  }

  function filterEditorialPool(q) {
    q = (q || '').toLowerCase().trim();
    state.poolFiltered = q
      ? state.pool.filter(e => e.title.toLowerCase().includes(q) || (e.tagline || '').toLowerCase().includes(q))
      : state.pool;
    renderPool();
  }

  function renderPool() {
    const pool = $('campEditorialPool');
    const pickedIds = new Set(state.pickedEditorials.map(p => p.id));
    if (!state.poolFiltered.length) {
      pool.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:11px">결과 없음</div>';
      return;
    }
    pool.innerHTML = state.poolFiltered.map(e => `
      <div class="camp-pool-item${pickedIds.has(e.id) ? ' is-picked' : ''}" data-id="${esc(e.id)}" onclick="campaigns.pick('${esc(e.id)}')">
        <div class="camp-pool-thumb" style="background-image:url('${esc(e.image)}')"></div>
        <div class="camp-pool-meta">
          <div class="camp-pool-tagline">${esc(e.tagline)}</div>
          <div class="camp-pool-title">${esc(e.title)}</div>
        </div>
      </div>
    `).join('');
  }

  function renderPicked() {
    const wrap = $('campEditorialPicked');
    $('campEditorialsCount').textContent = `(${state.pickedEditorials.length}개)`;
    if (!state.pickedEditorials.length) {
      wrap.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:11px;text-align:center">좌측에서 클릭해 추가하세요</div>';
      return;
    }
    wrap.innerHTML = state.pickedEditorials.map((e, i) => `
      <div class="camp-pool-item is-picked" data-id="${esc(e.id)}">
        <div class="camp-pool-thumb" style="background-image:url('${esc(e.image)}')"></div>
        <div class="camp-pool-meta">
          <div class="camp-pool-tagline">#${i+1} · ${esc(e.tagline)}</div>
          <div class="camp-pool-title">${esc(e.title)}</div>
        </div>
        <div class="camp-pool-actions">
          ${i > 0 ? `<button class="btn btn-sm" onclick="campaigns.movePicked('${esc(e.id)}',-1)">↑</button>` : ''}
          ${i < state.pickedEditorials.length-1 ? `<button class="btn btn-sm" onclick="campaigns.movePicked('${esc(e.id)}',1)">↓</button>` : ''}
          <button class="btn btn-sm btn-red" onclick="campaigns.unpick('${esc(e.id)}')">×</button>
        </div>
      </div>
    `).join('');
  }

  function pick(id) {
    const ed = state.pool.find(e => e.id === id);
    if (!ed) return;
    if (state.pickedEditorials.find(p => p.id === id)) {
      unpick(id);
      return;
    }
    state.pickedEditorials.push(ed);
    renderPool();
    renderPicked();
  }
  function unpick(id) {
    state.pickedEditorials = state.pickedEditorials.filter(p => p.id !== id);
    renderPool();
    renderPicked();
  }
  function movePicked(id, dir) {
    const i = state.pickedEditorials.findIndex(p => p.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= state.pickedEditorials.length) return;
    const tmp = state.pickedEditorials[i];
    state.pickedEditorials[i] = state.pickedEditorials[j];
    state.pickedEditorials[j] = tmp;
    renderPicked();
  }

  // ── News items (news-weekly only) ──────────────────────────────
  function emptyNewsItem() {
    return { title: '', summary: '', url: '', image: '', category: '' };
  }
  function renderNewsItems() {
    const wrap = $('campNewsList');
    $('campNewsCount').textContent = `(${state.newsItems.length}개)`;
    wrap.innerHTML = state.newsItems.map((n, i) => `
      <div class="camp-news-item" data-i="${i}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:11px;color:var(--text3);letter-spacing:.1em">#${i+1}</strong>
          <button class="btn btn-sm btn-red" onclick="campaigns.removeNewsItem(${i})">삭제</button>
        </div>
        <input class="modal-in" placeholder="카테고리 (예: 뷰티, 셀럽, 패션)" value="${esc(n.category||'')}" oninput="campaigns.updateNewsItem(${i},'category',this.value)" style="margin-bottom:6px">
        <input class="modal-in" placeholder="제목 *" value="${esc(n.title||'')}" oninput="campaigns.updateNewsItem(${i},'title',this.value)" style="margin-bottom:6px">
        <textarea class="modal-ta" placeholder="요약 (1-2 문장)" rows="2" oninput="campaigns.updateNewsItem(${i},'summary',this.value)" style="margin-bottom:6px">${esc(n.summary||'')}</textarea>
        <input class="modal-in" placeholder="링크 URL" value="${esc(n.url||'')}" oninput="campaigns.updateNewsItem(${i},'url',this.value)" style="margin-bottom:6px">
        <input class="modal-in" placeholder="이미지 URL" value="${esc(n.image||'')}" oninput="campaigns.updateNewsItem(${i},'image',this.value)">
      </div>
    `).join('');
  }
  function updateNewsItem(i, key, val) {
    if (!state.newsItems[i]) return;
    state.newsItems[i][key] = val;
  }
  function addNewsItem() {
    state.newsItems.push(emptyNewsItem());
    renderNewsItems();
  }
  function removeNewsItem(i) {
    state.newsItems.splice(i, 1);
    renderNewsItems();
  }

  // ── Persistence ────────────────────────────────────────────────
  function gather(targetStatus) {
    const subject = ($('campSubject').value || '').trim();
    if (!subject) {
      alert('메일 제목을 입력하세요.');
      return null;
    }
    const scheduledRaw = $('campScheduledAt').value;
    const scheduled_at = fromLocalDatetimeInput(scheduledRaw);
    if (targetStatus === 'scheduled' && !scheduled_at) {
      alert('예약 발송이려면 발송 시간을 설정하세요.');
      return null;
    }
    let payload = {};
    if (state.mode === 'editorial-weekly') {
      if (targetStatus === 'scheduled' && !state.pickedEditorials.length) {
        alert('최소 1개 이상의 에디토리얼을 선택하세요.');
        return null;
      }
      payload.editorials = state.pickedEditorials;
    } else if (state.mode === 'news-weekly') {
      const valid = state.newsItems.filter(n => n.title && n.title.trim());
      if (targetStatus === 'scheduled' && !valid.length) {
        alert('제목이 있는 뉴스 아이템이 최소 1개 필요합니다.');
        return null;
      }
      payload.newsItems = valid;
    }
    return {
      name: ($('campName').value || '').trim() || null,
      type: state.mode,
      subject,
      preheader: $('campPreheader').value || null,
      hero_headline: $('campHeadline').value || null,
      hero_body: $('campBody').value || null,
      payload,
      status: targetStatus,
      scheduled_at,
    };
  }

  async function save(targetStatus) {
    const body = gather(targetStatus);
    if (!body) return;
    try {
      let res;
      if (state.editingId) {
        res = await fetch(apiBase + '/admin/campaigns/' + state.editingId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(apiBase + '/admin/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || 'save failed ' + res.status);
      }
      const j = await res.json();
      state.editingId = j.campaign && j.campaign.id || state.editingId;
      alert(targetStatus === 'scheduled' ? '예약되었습니다. cron이 다음 정각에 발송 처리합니다.' : '임시 저장되었습니다.');
      closeEditor();
      load();
    } catch (err) {
      console.error('[campaigns.save]', err);
      alert('저장 실패: ' + (err.message || err));
    }
  }

  async function sendTest() {
    // Persist as draft first if it hasn't been saved yet — the test
    // endpoint needs a campaign id. We don't auto-promote to scheduled.
    if (!state.editingId) {
      const body = gather('draft');
      if (!body) return;
      try {
        const res = await fetch(apiBase + '/admin/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('save before test failed');
        const j = await res.json();
        state.editingId = j.campaign.id;
      } catch (err) {
        return alert('테스트 발송 전 임시 저장 실패: ' + err.message);
      }
    } else {
      // Save current edits so the test reflects what's in the form.
      const body = gather('draft');
      if (!body) return;
      try {
        await fetch(apiBase + '/admin/campaigns/' + state.editingId, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body),
        });
      } catch (_) {}
    }
    const targetEmail = prompt('테스트 메일을 받을 이메일 주소 (비우면 내 이메일):', '') || '';
    try {
      const res = await fetch(apiBase + '/admin/campaigns/' + state.editingId + '/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ email: targetEmail || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message || 'send-test failed');
      alert('테스트 발송 완료: ' + j.to);
    } catch (err) {
      console.error('[campaigns.sendTest]', err);
      alert('테스트 발송 실패: ' + (err.message || err));
    }
  }

  async function edit(id) {
    try {
      const res = await fetch(apiBase + '/admin/campaigns/' + id, { headers: auth() });
      if (!res.ok) throw new Error('GET failed');
      const j = await res.json();
      openEditor(j.campaign.type, j.campaign);
    } catch (err) {
      alert('불러오기 실패: ' + (err.message || err));
    }
  }

  async function remove(id) {
    if (!confirm('이 캠페인을 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(apiBase + '/admin/campaigns/' + id, {
        method: 'DELETE', headers: auth(),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || 'delete failed');
      }
      load();
    } catch (err) {
      alert('삭제 실패: ' + (err.message || err));
    }
  }

  async function viewStats(id) {
    try {
      const res = await fetch(apiBase + '/admin/campaigns/' + id, { headers: auth() });
      if (!res.ok) throw new Error('GET failed');
      const j = await res.json();
      const c = j.campaign;
      const s = j.stats || {};
      alert(
        '캠페인: ' + c.name + '\n\n' +
        '발송 시각: ' + (c.sent_at || '—') + '\n' +
        '대상자: ' + (c.recipient_count || 0) + '명\n' +
        '성공: ' + (c.sent_count || 0) + ' / 실패: ' + (c.failed_count || 0) + '\n\n' +
        '오픈/클릭 추적:\n' +
        '  - 오픈: ' + (s.opened || 0) + '\n' +
        '  - 클릭: ' + (s.clicked || 0) + '\n' +
        '  - 바운스: ' + (s.bounced || 0)
      );
    } catch (err) {
      alert('통계 불러오기 실패: ' + (err.message || err));
    }
  }

  // ── Expose ─────────────────────────────────────────────────────
  window.campaigns = {
    load,
    openEditor,
    closeEditor,
    pick, unpick, movePicked,
    filterEditorialPool,
    addNewsItem, updateNewsItem, removeNewsItem,
    save, sendTest, edit, remove, viewStats,
  };

  // Auto-load when admin.html's `go('campaigns')` activates the tab.
  // We hook the existing pap-admin.js dispatch so we don't need to edit
  // its switch — just add a window listener for a custom event the
  // tab switcher fires (or fall back: detect tab activation).
  const origGo = window.go;
  if (typeof origGo === 'function') {
    window.go = function (id, link) {
      const r = origGo.apply(this, arguments);
      if (id === 'campaigns') load();
      return r;
    };
  }
})();
