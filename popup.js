const $ = (id) => document.getElementById(id);
const status = (t) => { $("status").textContent = t; };

const DEFAULTS = { enabled: true, idleMinutes: 30 };
const PRESETS = [5, 15, 30, 60];

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $("enabled").checked = s.enabled;
  applyIdleUI(s.idleMinutes);
}

// Highlight the matching preset chip, or reveal the custom field.
function applyIdleUI(minutes) {
  const chips = $("presets").querySelectorAll("button");
  const isPreset = PRESETS.includes(minutes);
  chips.forEach((b) => {
    const m = b.dataset.min;
    b.classList.toggle("active", m !== "custom" && Number(m) === minutes);
  });
  if (!isPreset) {
    $("customBtn").classList.add("active");
    $("customRow").hidden = false;
    $("idle").value = minutes;
  } else {
    $("customBtn").classList.remove("active");
    $("customRow").hidden = true;
  }
}

async function setIdle(minutes) {
  const v = Math.max(1, Math.min(720, parseInt(minutes, 10) || 30));
  await chrome.storage.sync.set({ idleMinutes: v });
  applyIdleUI(v);
  status(`Suspend after ${v < 60 ? v + " min" : v / 60 + " h"}`);
}

$("presets").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.min === "custom") {
    $("customRow").hidden = false;
    $("customBtn").classList.add("active");
    $("idle").focus();
    return;
  }
  setIdle(Number(btn.dataset.min));
});

$("idle").addEventListener("change", () => setIdle($("idle").value));

$("enabled").addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: $("enabled").checked });
  status($("enabled").checked ? "Auto-suspend on" : "Auto-suspend off");
});

function fmtMB(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB";
}

function renderStats() {
  chrome.runtime.sendMessage({ type: "stats" }, (r) => {
    if (!r) return;
    $("stN").textContent = r.current;
    $("stMB").textContent = fmtMB(r.currentBytes);
    $("stLife").textContent = r.lifetimeCount;
    $("undo").hidden = !r.canUndo;
  });
}

async function currentHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return "";
  try { return new URL(tab.url).hostname; } catch { return ""; }
}

// Reflect whether the current site is already whitelisted.
async function refreshWhitelistBtn() {
  const btn = $("whitelistSite");
  const host = await currentHost();
  if (!host) { btn.disabled = true; btn.textContent = "🛡 Can't whitelist this page"; return; }
  chrome.runtime.sendMessage({ type: "isWhitelisted", host }, (r) => {
    if (r?.listed) {
      btn.disabled = true;
      btn.textContent = "✓ Site whitelisted";
    } else {
      btn.disabled = false;
      btn.textContent = "🛡 Never suspend this site";
    }
  });
}

$("whitelistSite").addEventListener("click", async () => {
  const host = await currentHost();
  if (!host) { status("Can't whitelist this page"); return; }
  chrome.runtime.sendMessage({ type: "whitelistCurrent", host }, () => {
    status(`Added ${host} to whitelist`);
    refreshWhitelistBtn();
  });
});

$("restoreAll").addEventListener("click", () => {
  status("Restoring all…");
  chrome.runtime.sendMessage({ type: "restoreAll" }, (r) => {
    status(`Restored ${r?.restored ?? 0} tabs`);
    renderList(); renderStats();
  });
});

$("undo").addEventListener("click", () => {
  status("Restoring…");
  chrome.runtime.sendMessage({ type: "undoLast" }, (r) => {
    status(`Restored ${r?.restored ?? 0} tabs`);
    renderList(); renderStats();
  });
});

function faviconEl(t) {
  if (t.favicon) {
    const img = document.createElement("img");
    img.className = "fav";
    img.alt = "";
    img.src = t.favicon;
    img.onerror = () => { img.replaceWith(placeholderFav(t)); };
    return img;
  }
  return placeholderFav(t);
}

function placeholderFav(t) {
  const d = document.createElement("div");
  d.className = "fav ph";
  d.textContent = (t.host || t.title || "?").charAt(0).toUpperCase();
  return d;
}

function renderList() {
  chrome.runtime.sendMessage({ type: "listSuspended" }, (r) => {
    const ul = $("list");
    ul.innerHTML = "";
    const tabs = r?.tabs ?? [];
    $("restoreAll").hidden = tabs.length < 2;
    if (!tabs.length) {
      ul.innerHTML = '<li class="empty">No suspended tabs yet</li>';
      return;
    }
    for (const t of tabs) {
      const li = document.createElement("li");

      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("div");
      title.className = "t";
      title.textContent = t.title;
      const host = document.createElement("div");
      host.className = "h";
      host.textContent = t.host;
      meta.append(title, host);

      const btn = document.createElement("button");
      btn.textContent = "Restore";
      btn.setAttribute("aria-label", `Restore ${t.title}`);
      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "restoreTab", tabId: t.id }, () => { renderList(); renderStats(); });
      });

      li.append(faviconEl(t), meta, btn);
      ul.appendChild(li);
    }
  });
}

$("suspendAll").addEventListener("click", () => {
  status("Suspending…");
  chrome.runtime.sendMessage({ type: "suspendAll" }, (r) => {
    status(`Suspended ${r?.suspended ?? 0} tabs`);
    renderList(); renderStats();
  });
});

$("scanNow").addEventListener("click", () => {
  status("Scanning…");
  chrome.runtime.sendMessage({ type: "scanNow" }, () => { status("Scan done"); renderList(); renderStats(); });
});

function refreshLive() { renderList(); renderStats(); }

load();
refreshLive();
refreshWhitelistBtn();

// Keep the popup counts and list live while it is open (auto-suspend runs in the
// background, so numbers can change without the user clicking anything).
const liveTimer = setInterval(refreshLive, 1000);
window.addEventListener("unload", () => clearInterval(liveTimer));
