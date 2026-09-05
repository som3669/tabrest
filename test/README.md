# TabRest regression tests

These drive a real Chrome with the extension loaded unpacked. There is no
mocking of `chrome.tabs` — every assertion is about what the browser actually
did. All three tests exist because the bug they cover shipped once.

## Running

```sh
node test/run.mjs           # all
node test/run.mjs burst     # one
```

Needs `puppeteer-core` and a **Chrome for Testing** binary:

```sh
npx @puppeteer/browsers install chrome@stable
```

An installed Google Chrome will not work. Recent stable versions ignore
`--load-extension` altogether, so the extension never loads and every test times
out looking for its service worker - a failure that looks like a product bug and
is not one. Verified against 152 (Chrome for Testing) and 154 (beta).

Override the lookup with:

```sh
CHROME_PATH=/path/to/chrome PUPPETEER_DIR=/path/to/project/with/puppeteer node test/run.mjs
```

A browser window opens while the tests run — MV3 service workers do not work in
headless mode. Do not click in it: focusing a tab makes it the active tab, and
active tabs are protected from suspension, which will fail the run.

`timer` takes 2-5 minutes because it waits for Chrome to evict the service
worker on its own schedule. The other two take under a minute each.

## What each one covers

**burst.test.mjs** — 48 tabs opened at once, then Suspend All.

Chrome loads roughly 6 tabs per host at a time. The rest sit with an empty
`tab.url` and their real address in `tab.pendingUrl`. TabRest read that empty
url as "a chrome:// page" and skipped those tabs, so most of a burst carried on
downloading after the user pressed the button. Tabs in that state also cannot be
discarded at all — `chrome.tabs.discard()` throws the pending address away and
leaves a blank tab — so they are parked on `suspended.html` instead, which
cancels the load immediately and keeps the address in the page hash.

Asserts: all 48 suspended, none still loading, all 48 addresses intact, and the
server stops being hit within 3 seconds of the click.

**timer.test.mjs** — auto-suspend after the service worker is evicted.

Idle timestamps used to live only in a module-level object in the worker. MV3
evicts the worker after ~30s idle, so the alarm woke a fresh one with an empty
map, every tab looked freshly used, and auto-suspend never fired — not once,
outside the first 30 seconds after startup. Timestamps now live in
`storage.session` and are cross-checked against `tab.lastAccessed`.

This test must never attach a debugger to the service worker: doing so keeps it
alive and the bug disappears. That is exactly how the bug was first "verified as
fixed" when it was not. State is read from an extension page, and the test fails
if it does not witness an eviction before the suspend.

**options.test.mjs** — the settings page writes what it shows.

The stop-mid-load toggle is checked in both positions against real tab
behaviour, not just against storage: off means no tab is ever parked, on means
queued tabs are. Per-site rules and a whitelist entry added through the page are
checked to reach the worker's own logic.

**guards.test.mjs** — what must never be suspended.

Form-guard, whitelist, the active tab, pinned tabs, and restore. Each guard runs
alongside a control tab that *is* expected to be suspended, so a run where
nothing happened at all cannot pass.

## Store screenshots

`node test/shots.mjs` regenerates `store/screenshot-*.png` from the running
extension, so the listing images cannot drift from the real UI. It seeds a few
real sites first so the popup shows genuine titles and favicons. Writing it
turned up a live bug: the popup's custom-minutes row set `hidden`, but `.row`
set `display: flex`, which beats the `[hidden]` rule - so the row never hid.

## A note on writing more of these

Two earlier versions of the burst fix looked correct and were not. The first
chased a race that did not exist; the second destroyed 42 URLs. Both produced
plausible-looking numbers. If a test can pass without the feature working —
because nothing was eligible, or because the harness starved the browser at the
network layer — it is not evidence. Always include a control.
