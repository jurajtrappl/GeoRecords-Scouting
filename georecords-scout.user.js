// ==UserScript==
// @name         GeoRecords Scout
// @namespace    https://georecords-slim.onrender.com
// @version      1.1.0
// @description  Auto-submit finished GeoGuessr games to GeoRecords scouting
// @author       GeoRecords
// @match        https://www.geoguessr.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      georecords-slim.onrender.com
// @updateURL    https://raw.githubusercontent.com/YOURUSERNAME/georecords-scout/main/georecords-scout.user.js
// @downloadURL  https://raw.githubusercontent.com/YOURUSERNAME/georecords-scout/main/georecords-scout.user.js
// @supportURL   https://github.com/YOURUSERNAME/georecords-scout/issues
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ==================== CONFIG ====================

    const GEORECORDS_URL = 'https://georecords-slim.onrender.com';

    // ==================== STATE ====================

    const submittedUrls = new Set();
    let csrfToken = null;
    let loggedInUser = null;
    let autoSubmit = true;
    let defaultMapType = 'world';

    // ==================== SETTINGS ====================

    async function loadSettings() {
        autoSubmit = await GM_getValue('autoSubmit', true);
        defaultMapType = await GM_getValue('defaultMapType', 'world');
    }

    function registerMenuCommands() {
        GM_registerMenuCommand(
            `Auto-submit: ${autoSubmit ? '✅ ON' : '❌ OFF'} (click to toggle)`,
            async () => {
                autoSubmit = !autoSubmit;
                await GM_setValue('autoSubmit', autoSubmit);
                showToast(`Auto-submit ${autoSubmit ? 'enabled' : 'disabled'}`, false, true);
                registerMenuCommands();
            },
            { id: 'gr-toggle-autosubmit', autoClose: false }
        );
        GM_registerMenuCommand(
            `Map type: ${defaultMapType === 'world' ? '🌍 World' : '🗺️ Regional'} (click to toggle)`,
            async () => {
                defaultMapType = defaultMapType === 'world' ? 'regional' : 'world';
                await GM_setValue('defaultMapType', defaultMapType);
                showToast(`Map type set to ${defaultMapType === 'world' ? '🌍 World' : '🗺️ Regional'}`, false, true);
                registerMenuCommands();
            },
            { id: 'gr-toggle-maptype', autoClose: false }
        );
        GM_registerMenuCommand('🔍 Check GeoRecords connection', checkConnection, { id: 'gr-check-connection' });
        GM_registerMenuCommand('📊 Submit this game now', manualSubmit, { id: 'gr-manual-submit' });
    }

    // ==================== API ====================

    function gmFetch(method, url, data) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                headers: {
                    'Content-Type': 'application/json',
                    ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {})
                },
                data: data ? JSON.stringify(data) : undefined,
                withCredentials: true,
                onload(res) {
                    try {
                        resolve({ status: res.status, data: JSON.parse(res.responseText) });
                    } catch {
                        resolve({ status: res.status, data: { error: res.responseText } });
                    }
                },
                onerror(err) { reject(err); }
            });
        });
    }

    async function fetchCsrfToken(force = false) {
        if (csrfToken && !force) return csrfToken;
        try {
            const res = await gmFetch('GET', `${GEORECORDS_URL}/api/auth/me`);
            if (res.status === 200 && res.data.csrf_token) {
                csrfToken = res.data.csrf_token;
                loggedInUser = res.data.username;
                return csrfToken;
            }
        } catch (e) {
            console.error('[GeoRecords Scout] CSRF fetch failed:', e);
        }
        csrfToken = null;
        loggedInUser = null;
        return null;
    }

    async function submitToScouting(gameUrl, mapType) {
        let token = await fetchCsrfToken();
        if (!token) {
            return { ok: false, error: 'Not logged in to GeoRecords. Visit georecords-slim.onrender.com and log in.' };
        }

        try {
            let res = await gmFetch('POST', `${GEORECORDS_URL}/api/practice/submit`, {
                url: gameUrl,
                map_type: mapType
            });

            // CSRF expired — refresh and retry once
            if (res.status === 403) {
                token = await fetchCsrfToken(true);
                if (!token) return { ok: false, error: 'Session expired. Log in to GeoRecords again.' };
                res = await gmFetch('POST', `${GEORECORDS_URL}/api/practice/submit`, {
                    url: gameUrl,
                    map_type: mapType
                });
            }

            if (res.status >= 200 && res.status < 300) {
                return { ok: true, data: res.data };
            }
            return { ok: false, error: res.data.error || `Error ${res.status}` };
        } catch (e) {
            return { ok: false, error: 'Network error — is GeoRecords down?' };
        }
    }

    // ==================== GAME DETECTION ====================

    function getGameUrl() {
        const url = window.location.href;
        const gameMatch = url.match(/geoguessr\.com\/game\/([a-zA-Z0-9]+)/);
        if (gameMatch) return `https://www.geoguessr.com/game/${gameMatch[1]}`;
        const resultsMatch = url.match(/geoguessr\.com\/results\/([a-zA-Z0-9]+)/);
        if (resultsMatch) return `https://www.geoguessr.com/results/${resultsMatch[1]}`;
        return null;
    }

    function isGameFinished() {
        // Results page — definitely finished
        if (window.location.href.includes('/results/')) return true;

        // /game/ page — look for end-of-game UI elements
        if (window.location.href.includes('/game/')) {
            // GeoGuessr result summary selectors (they change occasionally, so cast a wide net)
            const selectors = [
                '[data-qa="result-view-top"]',
                '[data-qa="play-again-button"]',
                '.result-layout',
                '[class*="result_wrapper"]',
                '[class*="results_wrapper"]',
                'button[class*="play-again"]',
                '[class*="finalResults"]',
                '[class*="final-result"]'
            ];
            for (const sel of selectors) {
                if (document.querySelector(sel)) return true;
            }

            // Check for the final score summary with all 5 rounds visible
            // GeoGuessr shows a progress bar with round indicators
            const roundNodes = document.querySelectorAll(
                '[class*="progress-circle"][class*="completed"], ' +
                '[class*="round-indicator"][class*="finished"], ' +
                '[class*="progress_node"][class*="is-completed"]'
            );
            if (roundNodes.length >= 5) return true;
        }

        return false;
    }

    // ==================== AUTO-SUBMIT ====================

    async function trySubmit(gameUrl) {
        if (!gameUrl || submittedUrls.has(gameUrl)) return;
        submittedUrls.add(gameUrl);

        if (!autoSubmit) return;

        showToast('Submitting to Scout...', false, true);

        const result = await submitToScouting(gameUrl, defaultMapType);

        if (result.ok) {
            const d = result.data;
            const pct = d.total_rounds ? Math.round(d.correct_count / d.total_rounds * 100) : 0;
            showToast(`Scouted! ${d.correct_count}/${d.total_rounds} correct (${pct}%) · ${(d.total_score || 0).toLocaleString()} pts`);
        } else {
            // Silently ignore duplicates
            if (result.error && (result.error.includes('already submitted') || result.error.includes('already'))) {
                return;
            }
            showToast(result.error || 'Failed to submit', true);
        }
    }

    function checkForFinishedGame() {
        if (isGameFinished()) {
            const gameUrl = getGameUrl();
            if (gameUrl) trySubmit(gameUrl);
        }
    }

    // ==================== MENU COMMANDS ====================

    async function checkConnection() {
        showToast('Checking connection...', false, true);
        const token = await fetchCsrfToken(true);
        if (token) {
            showToast(`Connected to GeoRecords as ${loggedInUser}`);
        } else {
            showToast('Not connected — log in at georecords-slim.onrender.com', true);
        }
    }

    async function manualSubmit() {
        const gameUrl = getGameUrl();
        if (!gameUrl) {
            showToast('No game URL found on this page', true);
            return;
        }
        // Force submit even if already submitted
        submittedUrls.delete(gameUrl);
        showToast('Submitting...', false, true);
        const result = await submitToScouting(gameUrl, defaultMapType);
        if (result.ok) {
            const d = result.data;
            showToast(`Scouted! ${d.correct_count}/${d.total_rounds} correct · ${(d.total_score || 0).toLocaleString()} pts`);
        } else {
            showToast(result.error || 'Failed', true);
        }
    }

    // ==================== TOAST UI ====================

    function showToast(message, isError = false, isTransient = false) {
        const existing = document.getElementById('gr-scout-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'gr-scout-toast';
        Object.assign(toast.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
            padding: '12px 18px', borderRadius: '10px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '13px', fontWeight: '500', maxWidth: '360px', lineHeight: '1.4',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            transition: 'opacity 0.3s, transform 0.3s',
            transform: 'translateY(10px)', opacity: '0',
            background: '#12121f',
            border: `1px solid ${isError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
            color: isError ? '#fca5a5' : '#a7f3d0',
        });

        const icon = isError ? '❌' : (isTransient ? '⏳' : '📊');
        toast.innerHTML = `<span style="margin-right:6px;">${icon}</span>${escapeHtml(message)}`;
        document.body.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.style.transform = 'translateY(0)';
            toast.style.opacity = '1';
        });

        // Auto-dismiss
        const duration = isTransient ? 2000 : 5000;
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ==================== OBSERVERS ====================

    // DOM mutation observer — detects when game UI changes to results
    let checkTimeout = null;
    const observer = new MutationObserver(() => {
        if (checkTimeout) clearTimeout(checkTimeout);
        checkTimeout = setTimeout(checkForFinishedGame, 800);
    });

    // URL change watcher (GeoGuessr is a SPA)
    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            setTimeout(checkForFinishedGame, 1500);
        }
    }, 500);

    // ==================== INIT ====================

    async function init() {
        await loadSettings();
        registerMenuCommands();

        // Pre-fetch CSRF token
        await fetchCsrfToken();
        if (loggedInUser) {
            console.log(`[GeoRecords Scout] Connected as ${loggedInUser}`);
        } else {
            console.log('[GeoRecords Scout] Not logged in to GeoRecords');
        }

        // Start watching
        observer.observe(document.body, { childList: true, subtree: true });

        // Initial check
        setTimeout(checkForFinishedGame, 2000);
    }

    init();

})();
