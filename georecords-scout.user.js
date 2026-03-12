// ==UserScript==
// @name         GeoRecords Scout
// @namespace    https://georecords-slim.onrender.com
// @version      2.0.0
// @description  Auto-submit finished GeoGuessr games to GeoRecords scouting + campaigns
// @author       GeoRecords
// @match        https://www.geoguessr.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      georecords-slim.onrender.com
// @updateURL    https://raw.githubusercontent.com/jurajtrappl/GeoRecords-Scouting/main/georecords-scout.user.js
// @downloadURL  https://raw.githubusercontent.com/jurajtrappl/GeoRecords-Scouting/main/georecords-scout.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ==================== CONFIG ====================
  const GR_URL = 'https://georecords-slim.onrender.com';

  // ==================== STATE ====================
  const submitted = new Set();
  let csrfToken = null;
  let loggedInUser = null;
  let autoSubmit = true;
  let autoCampaign = true;
  let defaultMapType = 'world';
  let panelEl = null;

  // ==================== SETTINGS ====================
  async function loadSettings() {
    autoSubmit = await GM_getValue('autoSubmit', true);
    autoCampaign = await GM_getValue('autoCampaign', true);
    defaultMapType = await GM_getValue('defaultMapType', 'world');
  }

  function registerMenuCommands() {
    GM_registerMenuCommand('⚙️ GeoRecords Scout Settings', togglePanel, { id: 'gr-settings' });
    GM_registerMenuCommand('📊 Submit this game now', manualSubmit, { id: 'gr-manual-submit' });
  }

  // ==================== SETTINGS PANEL ====================
  function togglePanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; return; }

    panelEl = document.createElement('div');
    Object.assign(panelEl.style, {
      position: 'fixed', top: '60px', right: '20px', zIndex: '999998',
      background: '#1a1a2e', border: '1px solid rgba(139,105,20,0.4)',
      borderRadius: '10px', padding: '16px 20px', minWidth: '260px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px', color: '#e0d6c2', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    });

    const renderPanel = () => {
      panelEl.innerHTML = `
        <div style="font-weight:700; font-size:14px; margin-bottom:12px; color:#c8a96e;">📊 GeoRecords Scout</div>
        <div style="font-size:11px; color:#8a8070; margin-bottom:12px;">
          ${loggedInUser ? `Connected as <strong style="color:#a7f3d0;">${esc(loggedInUser)}</strong>` : '<span style="color:#fca5a5;">Not connected</span>'}
        </div>
        ${makeToggle('Auto-submit scouting', autoSubmit, 'autoSubmit')}
        ${makeToggle('Auto-submit to campaigns', autoCampaign, 'autoCampaign')}
        <div style="margin-top:10px; display:flex; align-items:center; gap:8px;">
          <span style="flex:1;">Map type</span>
          <button id="gr-maptype-btn" style="padding:4px 10px; border-radius:4px; border:1px solid rgba(139,105,20,0.3); background:rgba(139,105,20,0.1); color:#c8a96e; cursor:pointer; font-size:12px;">
            ${defaultMapType === 'world' ? '🌍 World' : '🗺️ Regional'}
          </button>
        </div>
        <div style="margin-top:14px; padding-top:10px; border-top:1px solid rgba(139,105,20,0.15);">
          <button id="gr-close-panel" style="width:100%; padding:6px; border-radius:4px; border:1px solid rgba(139,105,20,0.3); background:transparent; color:#8a8070; cursor:pointer; font-size:12px;">Close</button>
        </div>
      `;

      panelEl.querySelectorAll('[data-toggle]').forEach(el => {
        el.addEventListener('click', async () => {
          const key = el.dataset.toggle;
          if (key === 'autoSubmit') { autoSubmit = !autoSubmit; await GM_setValue('autoSubmit', autoSubmit); }
          if (key === 'autoCampaign') { autoCampaign = !autoCampaign; await GM_setValue('autoCampaign', autoCampaign); }
          renderPanel();
        });
      });

      const mtBtn = panelEl.querySelector('#gr-maptype-btn');
      if (mtBtn) mtBtn.addEventListener('click', async () => {
        defaultMapType = defaultMapType === 'world' ? 'regional' : 'world';
        await GM_setValue('defaultMapType', defaultMapType);
        renderPanel();
      });

      const closeBtn = panelEl.querySelector('#gr-close-panel');
      if (closeBtn) closeBtn.addEventListener('click', () => { panelEl.remove(); panelEl = null; });
    };

    document.body.appendChild(panelEl);
    renderPanel();
  }

  function makeToggle(label, value, key) {
    const bg = value ? '#22c55e' : '#4b4b4b';
    const pos = value ? '18px' : '2px';
    return `
      <div data-toggle="${key}" style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer; user-select:none;">
        <div style="width:36px; height:20px; border-radius:10px; background:${bg}; position:relative; transition:background 0.2s; flex-shrink:0;">
          <div style="width:16px; height:16px; border-radius:50%; background:white; position:absolute; top:2px; left:${pos}; transition:left 0.2s;"></div>
        </div>
        <span style="flex:1;">${label}</span>
      </div>`;
  }

  // ==================== API ====================
  function gmFetch(method, url, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url,
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        data: data ? JSON.stringify(data) : undefined,
        withCredentials: true,
        onload(res) {
          try { resolve({ status: res.status, data: JSON.parse(res.responseText) }); }
          catch { resolve({ status: res.status, data: { error: res.responseText } }); }
        },
        onerror(err) { reject(err); },
      });
    });
  }

  async function fetchCsrf(force = false) {
    if (csrfToken && !force) return csrfToken;
    try {
      const res = await gmFetch('GET', `${GR_URL}/api/auth/me`);
      if (res.status === 200 && res.data.csrf_token) {
        csrfToken = res.data.csrf_token;
        loggedInUser = res.data.username;
        return csrfToken;
      }
    } catch (e) { console.error('[GR Scout] CSRF failed:', e); }
    csrfToken = null; loggedInUser = null;
    return null;
  }

  async function apiPost(endpoint, body) {
    let token = await fetchCsrf();
    if (!token) return { ok: false, error: 'Not logged in to GeoRecords' };
    try {
      let res = await gmFetch('POST', `${GR_URL}${endpoint}`, body);
      if (res.status === 403) {
        token = await fetchCsrf(true);
        if (!token) return { ok: false, error: 'Session expired' };
        res = await gmFetch('POST', `${GR_URL}${endpoint}`, body);
      }
      if (res.status >= 200 && res.status < 300) return { ok: true, data: res.data };
      return { ok: false, error: res.data?.error || `Error ${res.status}`, status: res.status };
    } catch (e) { return { ok: false, error: 'Network error' }; }
  }

  // ==================== GAME DETECTION ====================
  function getGameId() {
    const m = location.href.match(/geoguessr\.com\/(?:game|results)\/([a-zA-Z0-9]+)/);
    return m ? m[1] : null;
  }

  function isFinished() {
    if (location.href.includes('/results/')) return true;
    if (!location.href.includes('/game/')) return false;

    // GeoGuessr result UI selectors (multiple for resilience)
    const sels = [
      '[data-qa="result-view-top"]',
      '[data-qa="play-again-button"]',
      '.result-layout',
      '[class*="result_wrapper"]', '[class*="results_wrapper"]',
      '[class*="finalResults"]', '[class*="final-result"]',
      'button[data-qa="close-round-result"]',
    ];
    for (const s of sels) { if (document.querySelector(s)) return true; }

    // Check for final round summary: all 5 round indicators completed
    const nodes = document.querySelectorAll('[class*="round-number"]');
    if (nodes.length >= 5) {
      const allDone = [...nodes].every(n =>
        n.closest('[class*="completed"]') || n.closest('[class*="is-completed"]')
      );
      if (allDone) return true;
    }

    // Fallback: look for the total score display on the final summary screen
    const scoreEls = document.querySelectorAll('[data-qa="score"]');
    if (scoreEls.length > 0 && document.querySelector('[data-qa="play-again-button"], [class*="play-again"]')) {
      return true;
    }

    return false;
  }

  // ==================== SUBMISSION LOGIC ====================
  async function submitGame(gameId) {
    if (!gameId || submitted.has(gameId)) return;
    submitted.add(gameId);
    if (!autoSubmit && !autoCampaign) return;

    const gameUrl = `https://www.geoguessr.com/game/${gameId}`;
    let scoutResult = null;

    // 1. Scouting
    if (autoSubmit) {
      showToast('Submitting to Scout...', false, true);
      scoutResult = await apiPost('/api/practice/submit', { url: gameUrl, map_type: defaultMapType });

      if (scoutResult.ok) {
        const d = scoutResult.data;
        const pct = d.total_rounds ? Math.round(d.correct_count / d.total_rounds * 100) : 0;
        showToast(`Scouted! ${d.correct_count}/${d.total_rounds} correct (${pct}%) · ${(d.total_score || 0).toLocaleString()} pts`);
      } else if (scoutResult.error?.toLowerCase().includes('already')) {
        // Silently skip duplicates
      } else if (scoutResult.status === 400 && scoutResult.error?.toLowerCase().includes('not finished')) {
        // Game not finished yet — remove from submitted so we retry
        submitted.delete(gameId);
        return;
      } else {
        showToast(scoutResult.error || 'Scout failed', true);
      }
    }

    // 2. Campaign auto-check
    if (autoCampaign) {
      try {
        const campResult = await apiPost('/api/chain-challenges/check-game', { game_url: gameUrl });
        if (campResult.ok && campResult.data?.matched) {
          for (const r of campResult.data.results) {
            if (r.status === 'submitted') {
              showToast(`⚔️ Campaign "${r.campaign}" — auto-submitted!`);
            } else if (r.status === 'score_too_low') {
              showToast(`⚔️ ${r.campaign}: score ${r.score?.toLocaleString()} < ${r.min?.toLocaleString()} needed`, true);
            }
          }
        }
      } catch (e) { console.error('[GR Scout] Campaign check failed:', e); }
    }
  }

  function checkFinished() {
    if (!isFinished()) return;
    const id = getGameId();
    if (id) submitGame(id);
  }

  async function manualSubmit() {
    const id = getGameId();
    if (!id) { showToast('No game found on this page', true); return; }
    submitted.delete(id);
    showToast('Submitting...', false, true);

    const url = `https://www.geoguessr.com/game/${id}`;
    const result = await apiPost('/api/practice/submit', { url, map_type: defaultMapType });
    if (result.ok) {
      const d = result.data;
      showToast(`Scouted! ${d.correct_count}/${d.total_rounds} correct · ${(d.total_score || 0).toLocaleString()} pts`);
    } else {
      showToast(result.error || 'Failed', true);
    }

    // Also check campaigns
    if (autoCampaign) {
      const campResult = await apiPost('/api/chain-challenges/check-game', { game_url: url });
      if (campResult.ok && campResult.data?.matched) {
        for (const r of campResult.data.results) {
          if (r.status === 'submitted') showToast(`⚔️ Campaign "${r.campaign}" — submitted!`);
        }
      }
    }
  }

  // ==================== TOAST ====================
  function showToast(message, isError = false, isTransient = false) {
    const old = document.getElementById('gr-scout-toast');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'gr-scout-toast';
    Object.assign(el.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
      padding: '12px 18px', borderRadius: '10px', maxWidth: '380px', lineHeight: '1.4',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px', fontWeight: '500',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      transition: 'opacity 0.3s, transform 0.3s',
      transform: 'translateY(10px)', opacity: '0',
      background: '#12121f',
      border: `1px solid ${isError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
      color: isError ? '#fca5a5' : '#a7f3d0',
    });

    const icon = isError ? '❌' : (isTransient ? '⏳' : '📊');
    el.innerHTML = `<span style="margin-right:6px;">${icon}</span>${esc(message)}`;
    document.body.appendChild(el);

    requestAnimationFrame(() => { el.style.transform = 'translateY(0)'; el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translateY(10px)';
      setTimeout(() => el.remove(), 300);
    }, isTransient ? 2000 : 5000);
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ==================== OBSERVERS ====================
  let debounce = null;
  const observer = new MutationObserver(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(checkFinished, 600);
  });

  // SPA URL watcher — GeoGuessr navigates without page reloads
  let lastUrl = location.href;
  let lastGameId = getGameId();
  const urlCheck = setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    const newId = getGameId();
    if (newId !== lastGameId) {
      lastGameId = newId;
      console.log(`[GR Scout] Game: ${newId || '(none)'}`);
    }

    // Check after SPA render delay
    setTimeout(checkFinished, 1500);
  }, 400);

  // ==================== INIT ====================
  async function init() {
    await loadSettings();
    registerMenuCommands();

    await fetchCsrf();
    if (loggedInUser) console.log(`[GR Scout] Connected as ${loggedInUser}`);
    else console.log('[GR Scout] Not logged in');

    lastGameId = getGameId();
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(checkFinished, 2000);
  }

  init();
})();
