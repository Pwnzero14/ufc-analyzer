const PLATFORMS = [
  { id: "pick6",    label: "Pick6 (DraftKings)", color: "#63b3ed" },
  { id: "underdog", label: "Underdog Fantasy",   color: "#9b4ae8" },
  { id: "betr",     label: "Betr Fantasy",        color: "#ff6b2b" },
];

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function render(lines) {
  const section = document.getElementById("platforms-section");
  section.innerHTML = "";
  PLATFORMS.forEach(p => {
    const data = lines[p.id];
    const hasData = data?.fighters?.length > 0;
    const row = document.createElement("div");
    row.className = "platform-row";
    row.innerHTML = `
      <div class="platform-name">
        <div class="dot" style="background:${p.color}"></div>
        ${p.label}
      </div>
      <span class="status-badge ${hasData ? "status-ok" : "status-wait"}">
        ${hasData ? `&#10003; ${data.fighters.length} fighters` : "Waiting..."}
      </span>`;
    section.appendChild(row);
    if (hasData) {
      const ts = document.createElement("div");
      ts.className = "timestamp";
      ts.textContent = `Captured ${timeAgo(data.capturedAt)}`;
      section.appendChild(ts);
      const list = document.createElement("div");
      list.className = "fighter-list";
      data.fighters.slice(0, 6).forEach(f => {
        const r = document.createElement("div");
        r.className = "fighter-row";
        r.innerHTML = `<span class="fighter-name">${f.name}</span><span class="fighter-line">${f.line_fp ?? f.line_ss ?? f.line_td ?? f.line ?? '—'}</span>`;
        list.appendChild(r);
      });
      if (data.fighters.length > 6) {
        const more = document.createElement("div");
        more.style.cssText = "font-size:10px;color:#3a3f50;padding:3px 0;";
        more.textContent = `+${data.fighters.length - 6} more`;
        list.appendChild(more);
      }
      section.appendChild(list);
    }
  });

  const exportData = {
    capturedAt: new Date().toISOString(),
    pick6: lines.pick6?.fighters || [],
    underdog: lines.underdog?.fighters || [],
    betr: lines.betr?.fighters || [],
  };
  document.getElementById("json-preview").textContent = JSON.stringify(exportData, null, 2);
  document.getElementById("copy-btn").onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
      document.getElementById("copy-btn").textContent = "&#10003; Copied!";
      setTimeout(() => document.getElementById("copy-btn").textContent = "Copy Lines JSON", 2000);
    });
  };
}

function loadAndRender() {
  chrome.runtime.sendMessage({ type: "GET_LINES" }, (lines) => render(lines || {}));
}

loadAndRender();
setInterval(loadAndRender, 5000);

// Auto-fetch lines button — background tab scrape
document.getElementById('auto-fetch-btn').onclick = () => {
  const btn = document.getElementById('auto-fetch-btn');
  btn.textContent = '⟳ Opening tabs...';
  btn.disabled = true;
  chrome.runtime.sendMessage({ type: 'AUTO_SCRAPE_LINES' }, (result) => {
    const count = Object.values(result?.results || {}).reduce((s, n) => s + n, 0);
    btn.textContent = count > 0 ? `✓ ${count} fighters loaded` : '⚡ Auto-Fetch Lines';
    btn.disabled = false;
    loadAndRender();
    // Open analyzer to show results
    chrome.tabs.create({ url: chrome.runtime.getURL('analyzer.html') });
  });
};

// Open the analyzer page
document.getElementById("open-analyzer-btn").onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("analyzer.html") });
};

// Manually retry Pick6 scrape by re-injecting content script
document.getElementById("retry-pick6-btn").onclick = () => {
  const btn = document.getElementById("retry-pick6-btn");
  btn.textContent = "Scanning...";
  btn.disabled = true;
  chrome.tabs.query({ url: "*://*.draftkings.com/*" }, (tabs) => {
    if (tabs.length > 0) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ["content.js"]
      });
      setTimeout(() => {
        loadAndRender();
        btn.textContent = "Retry Pick6 Scan";
        btn.disabled = false;
      }, 4000);
    } else {
      alert("Open pick6.draftkings.com to a UFC slate first, then retry.");
      btn.textContent = "Retry Pick6 Scan";
      btn.disabled = false;
    }
  });
};

document.getElementById("fetch-dk-tds-btn").onclick = () => {
  const btn = document.getElementById("fetch-dk-tds-btn");
  btn.textContent = "Opening...";
  btn.disabled = true;
  const url = "https://sportsbook.draftkings.com/leagues/mma/ufc?category=fighter-props&subcategory=takedowns-landed-o-u";
  chrome.tabs.create({ url, active: true }, (tab) => {
    setTimeout(() => {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }, () => {
        setTimeout(() => {
          loadAndRender();
          btn.textContent = "📥 Fetch DK Sportsbook TDs";
          btn.disabled = false;
        }, 4000);
      });
    }, 3500);
  });
};

document.getElementById("clear-btn").onclick = () => {
  chrome.runtime.sendMessage({ type: "CLEAR_LINES" }, () => render({}));
};
