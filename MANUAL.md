# TabRest — User Manual

TabRest suspends idle browser tabs to free CPU and RAM. A suspended tab stops
running scripts and timers, drops its memory to near zero, and reloads instantly
when you click it. Your tabs stay in the strip — nothing is closed.

---

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the `tabrest` folder
5. Pin the icon: click the puzzle-piece in the toolbar → pin TabRest

---

## The popup

Click the TabRest icon to open it.

| Control | What it does |
|---------|-------------|
| **Auto-suspend idle tabs** | Master on/off switch for automatic suspending |
| **Idle time (minutes)** | How long a tab must be untouched before it suspends |
| **Suspend all** | Suspend every eligible background tab right now |
| **Scan now** | Run the idle check immediately (don't wait for the timer) |
| **🛡 Never suspend this site** | Add the current tab's site to the whitelist — one click |
| **↩ Undo last** | Restore the tabs from your most recent suspend (appears only when there's something to undo) |
| **Stats row** | Suspended now · RAM saved (estimate) · Lifetime tabs suspended |
| **Suspended tabs** | List of currently suspended tabs, each with a **Restore** button |

---

## Right-click menu

Right-click any page **or** the TabRest toolbar icon:

- **Suspend this tab** — suspend the page you're on
- **Never suspend this site** — whitelist it, no typing needed

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+S` | Suspend the current tab |
| `Alt+Shift+A` | Suspend all background tabs |

Rebind them at `chrome://extensions/shortcuts`.

---

## Settings page

Open via **⚙ Settings & whitelist** at the bottom of the popup.

### Skip rules
- **Skip tabs playing audio** — never suspend a tab making sound
- **Skip pinned tabs** — never suspend pinned tabs

### Whitelist
One hostname per line — never suspended. You usually don't need to type here;
use the **Never suspend this site** button or right-click menu instead.

```
mail.google.com
figma.com
```

### Per-site idle rules
Give specific sites their own idle time. Format: `host = minutes`.

```
news.ycombinator.com = 5      # suspend fast
docs.google.com = 120         # keep alive longer
```

A per-site rule overrides the default idle time for that host.

---

## What is never suspended

TabRest automatically protects:

- The **active** tab you're looking at
- Tabs **playing audio** (if the skip rule is on)
- **Pinned** tabs (if the skip rule is on)
- Tabs with **unsaved form input** (you were typing something)
- **Whitelisted** sites
- Browser pages like `chrome://…`

---

## How suspending works

TabRest uses Chrome's built-in `tabs.discard()`. The tab is unloaded from memory
but stays in the tab strip showing its title and icon. Clicking it reloads the page
from where it left off (like reopening a bookmark).

- Frees the CPU and RAM that tab's process was using
- Reversible — no data loss for normal pages
- Form input is protected so you don't lose what you were typing

---

## Verify it's working

- **Badge** on the icon shows the number of suspended tabs
- `chrome://discards` shows the discard state of every tab
- Task Manager (`Shift+Esc`) — a suspended tab's memory drops to ~0

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Nothing suspends | Check the master toggle is on and idle time isn't too high |
| A tab won't suspend | It may be active, audible, pinned, whitelisted, or has unsaved input |
| Changed code, no effect | Click the reload icon on the extension card in `chrome://extensions` |
| Shortcut does nothing | Another extension may own it — rebind at `chrome://extensions/shortcuts` |
| Errors | `chrome://extensions` → TabRest → **Errors**, or click **service worker** for the console |

---

## Privacy

TabRest runs entirely on your device. It does not send any data anywhere.
Settings sync through your Chrome account (Chrome's own sync). The form-guard
content script only checks whether a field on the page has unsaved input — it
never reads or transmits what you typed.

Full policy: https://som3669.github.io/privacy-policy/tabrest/
