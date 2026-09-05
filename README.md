# TabRest

Cut Chrome CPU and memory by auto-suspending idle tabs. Suspended tabs stop
running JavaScript, timers, and background work; they reload instantly when you
click them.

## Install (unpacked, for testing)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `tabrest` folder

## Features

- **Auto-suspend idle tabs** — tabs untouched past your idle threshold get discarded.
- **Whitelist** — hostnames that are never suspended (options page).
- **Skip rules** — never suspend the active tab, audible tabs, or pinned tabs.
- **Suspend all now** — one click to discard every eligible background tab.

## How it works

`chrome.tabs.discard()` unloads a tab from memory. That frees the CPU and RAM the
tab's renderer was using. Chrome shows a placeholder and reloads the page on focus.

A service worker runs a 1-minute alarm, checks each tab's last-interaction time,
and discards ones past the threshold that don't match a skip/whitelist rule.

## Suspending tabs that are still loading

Chrome loads roughly six tabs per host at a time. Open a big batch and the rest
sit queued with an empty `tab.url` and their real address in `tab.pendingUrl`.
Such a tab cannot be discarded at all — `chrome.tabs.discard()` throws the
pending address away and leaves a blank tab — so Suspend All parks it on
`suspended.html` instead, which cancels its download at once and keeps the
address in the page hash. Clicking the tab sends it back.

Turn **Stop tabs mid-load** off in Options to skip parking entirely: queued tabs
are then left to finish loading and suspended once they land. Nothing shows a
TabRest address, but a large batch keeps downloading for a while after you press
the button.

Parking is uncommon in practice — a burst of tabs across different sites loads
in parallel, so most are discardable normally. In a 12-site test only one tab
needed parking.

## Limits

- A tab resting on the TabRest page needs TabRest installed to return on its
  own. Remove the extension while tabs are parked and their addresses are still
  readable in the address bar, but you must reopen them yourself. Chrome gives
  extensions no hook to run on uninstall, so this cannot be fully solved; turn
  off "Stop tabs mid-load" to avoid parking altogether.
- A 1-minute idle setting lands at 1-2 minutes. Chrome does not let extensions
  run an alarm more than once a minute, so short thresholds are checked on the
  next tick.
- Cannot reduce Chrome's core process cost (browser, GPU, network service). Only
  tab renderers are controllable by extensions.
- Chrome's built-in **Memory Saver** does something similar; TabRest gives you
  tighter, configurable control.

## Changelog

### 1.1.0

Both problems reported in the 2-star store review, fixed and covered by tests.

- **Auto-suspend never fired.** Idle timestamps lived only in the service
  worker's memory. MV3 evicts the worker after ~30s idle, so the alarm woke a
  fresh one with an empty map, every tab looked freshly used, and the threshold
  was never crossed. Timestamps now live in `storage.session` and are
  cross-checked against `tab.lastAccessed`. Measured: 0 tabs suspended in 6
  minutes before, fires at ~115s after.
- **Suspend All left most of a burst downloading.** Tabs Chrome had queued but
  not committed report an empty `tab.url`, which the `!host` guard read as a
  `chrome://` page and skipped. They also cannot be discarded — that throws the
  pending address away and leaves a blank tab — so they are parked on a
  placeholder page that cancels the load and remembers where each was going.
  Measured on 48 tabs: 12 suspended and 22s of further downloading before,
  48 suspended and quiet within a second after.
- New **Stop tabs mid-load** option (default on) to turn parking off entirely.
- `chrome.tabs.discard()` resolves without complaint on tabs it skips, so
  discards are now verified rather than assumed.
- Suspend All runs in parallel; badge updates are coalesced.
- Fixed: the popup's custom-minutes row never hid, because `.row`'s
  `display: flex` overrode the `hidden` attribute.
- Added `test/` — regression tests driving a real browser.

### 1.0.2

Initial store release.

## Roadmap

- Per-tab CPU detection + auto-suspend runaway tabs (needs `chrome.processes`,
  Chrome Dev/Canary only).
- Badge showing count of suspended tabs.
- Per-site idle thresholds.
