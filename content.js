// TabRest form-guard: tell the service worker when this page has unsaved input,
// so the tab is not suspended out from under the user.

(() => {
  let dirty = false;

  function send(state) {
    try { chrome.runtime.sendMessage({ type: "formDirty", dirty: state }); } catch {}
  }

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    if (tag === "INPUT") {
      const skip = ["button", "submit", "reset", "checkbox", "radio", "file", "hidden", "range", "color"];
      return !skip.includes((el.type || "text").toLowerCase());
    }
    return false;
  }

  function markDirty() {
    if (dirty) return;
    dirty = true;
    send(true);
  }

  function clearDirty() {
    if (!dirty) return;
    dirty = false;
    send(false);
  }

  // User typed into a field → dirty.
  document.addEventListener("input", (e) => {
    if (isEditable(e.target)) markDirty();
  }, true);

  // Submitting or resetting a form → no longer unsaved.
  document.addEventListener("submit", clearDirty, true);
  document.addEventListener("reset", clearDirty, true);

  // Re-announce dirty state when the tab becomes visible again — the SW may have
  // slept and forgotten. Keeps the guard reliable.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && dirty) send(true);
  });
})();
