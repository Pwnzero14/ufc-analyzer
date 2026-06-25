import { StorageService } from './services/index.js';
import { CONFIG } from './config/index.js';
/**
 * Popup script for the UFC extension
 * Displays captured lines and provides buttons for actions
 */
const PLATFORMS = [
    { id: 'pick6', label: CONFIG.platforms.pick6.label, color: CONFIG.platforms.pick6.color, cls: 'p6' },
    { id: 'underdog', label: CONFIG.platforms.underdog.label, color: CONFIG.platforms.underdog.color, cls: 'ud' },
    { id: 'betr', label: CONFIG.platforms.betr.label, color: CONFIG.platforms.betr.color, cls: 'betr' },
    { id: 'prizepicks', label: CONFIG.platforms.prizepicks.label, color: CONFIG.platforms.prizepicks.color, cls: 'pp' },
    { id: 'draftkings_sportsbook', label: 'DraftKings Sportsbook', color: '#f59e0b', cls: 'dk' },
];
function timeAgo(ts) {
    if (!ts)
        return '';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60)
        return `${diff}s ago`;
    if (diff < 3600)
        return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
}
function render(lines) {
    const section = document.getElementById('platforms-section');
    if (!section)
        return;
    section.innerHTML = '';
    PLATFORMS.forEach((p) => {
        const data = lines[p.id];
        const hasData = (data?.fighters?.length || 0) > 0;
        const row = document.createElement('div');
        row.className = 'platform-row';
        row.innerHTML = `
      <div class="platform-name ${p.cls}">
        <div class="dot" style="background:${p.color}"></div>
        ${p.label}
      </div>
      <span class="status-badge ${hasData ? 'status-ok' : 'status-wait'}">
        ${hasData ? `✓ ${data.fighters.length} fighters` : 'Waiting...'}
      </span>`;
        section.appendChild(row);
        if (hasData) {
            const ts = document.createElement('div');
            ts.className = 'timestamp';
            ts.textContent = `Captured ${timeAgo(data.capturedAt)}`;
            section.appendChild(ts);
            const list = document.createElement('div');
            list.className = 'fighter-list';
            data.fighters.slice(0, 6).forEach((f) => {
                const r = document.createElement('div');
                r.className = 'fighter-row';
                const line = f.line_fp ?? f.line_ss ?? f.line_td ?? '—';
                r.innerHTML = `<span class="fighter-name">${f.name}</span><span class="fighter-line">${line}</span>`;
                list.appendChild(r);
            });
            if (data.fighters.length > 6) {
                const more = document.createElement('div');
                more.style.cssText = 'font-size:10px;color:#3a3f50;padding:3px 0;';
                more.textContent = `+${data.fighters.length - 6} more`;
                list.appendChild(more);
            }
            section.appendChild(list);
        }
    });
    // JSON Preview
    const exportData = {
        capturedAt: new Date().toISOString(),
        pick6: lines.pick6?.fighters || [],
        underdog: lines.underdog?.fighters || [],
        betr: lines.betr?.fighters || [],
        prizepicks: lines.prizepicks?.fighters || [],
        draftkings_sportsbook: lines.draftkings_sportsbook?.fighters || [],
    };
    const preview = document.getElementById('json-preview');
    if (preview) {
        preview.textContent = JSON.stringify(exportData, null, 2);
    }
    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
                copyBtn.textContent = '✓ Copied!';
                setTimeout(() => (copyBtn.textContent = 'Copy Lines JSON'), 2000);
            });
        };
    }
}
async function loadAndRender() {
    try {
        const lines = await StorageService.getLines();
        render(lines);
    }
    catch (error) {
        console.error('[UFC Popup] Error loading lines:', error);
    }
}
// ── BUTTON HANDLERS ────────────────────────────────────────────────────
document.getElementById('auto-fetch-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('auto-fetch-btn');
    btn.textContent = '⟳ Opening tabs...';
    btn.disabled = true;
    try {
        const result = await chrome.runtime.sendMessage({ type: 'AUTO_SCRAPE_LINES' });
        const count = Object.values(result?.results || {}).reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0);
        btn.textContent = count > 0 ? `✓ ${count} fighters loaded` : '⚡ Auto-Fetch Lines';
        await loadAndRender();
        chrome.tabs.create({ url: chrome.runtime.getURL('analyzer.html') });
    }
    catch (error) {
        console.error('[UFC Popup] Auto-fetch error:', error);
        btn.textContent = '⚡ Auto-Fetch Lines';
    }
    finally {
        btn.disabled = false;
    }
});
document.getElementById('open-analyzer-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('analyzer.html') });
});
document.getElementById('retry-pick6-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('retry-pick6-btn');
    btn.textContent = 'Scanning...';
    btn.disabled = true;
    try {
        const pick6Tabs = await chrome.tabs.query({ url: '*://pick6.draftkings.com/*' });
        const targetTab = pick6Tabs[0] || await chrome.tabs.create({ url: CONFIG.platforms.pick6.url, active: true });
        await new Promise((r) => setTimeout(r, 3500));
        await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            files: ['dist/content.js'],
        });
        await new Promise((r) => setTimeout(r, 4000));
        await loadAndRender();
    }
    catch (error) {
        console.error('[UFC Popup] Retry error:', error);
    }
    finally {
        btn.textContent = 'Retry Pick6 Scan';
        btn.disabled = false;
    }
});
document.getElementById('fetch-dk-tds-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('fetch-dk-tds-btn');
    btn.textContent = 'Opening...';
    btn.disabled = true;
    try {
        const url = 'https://sportsbook.draftkings.com/leagues/mma/ufc?category=fights&subcategory=fighter-props&nav_1=takedowns-landed-o-u';
        const tab = await chrome.tabs.create({ url, active: true });
        await new Promise((r) => setTimeout(r, 3500));
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['dist/content.js'],
        });
        await new Promise((r) => setTimeout(r, 4000));
        await loadAndRender();
    }
    catch (error) {
        console.error('[UFC Popup] DK TDs fetch error:', error);
    }
    finally {
        btn.textContent = '📥 Fetch DK Sportsbook TDs';
        btn.disabled = false;
    }
});
document.getElementById('clear-btn')?.addEventListener('click', async () => {
    try {
        await chrome.runtime.sendMessage({ type: 'CLEAR_LINES' });
        await loadAndRender();
    }
    catch (error) {
        console.error('[UFC Popup] Clear error:', error);
    }
});
// ── INITIAL LOAD ───────────────────────────────────────────────────────
loadAndRender();
setInterval(loadAndRender, 5000);
// Export for debugging
globalThis.ufc_popup = { loadAndRender };
//# sourceMappingURL=popup.js.map