(function () {
  const DEFAULT_CLASS = "action-codes-notice";
  const DEFAULT_ID = "global-action-message";

  function findAnchor(selectors) {
    if (!Array.isArray(selectors)) return null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function ensureContainer(options) {
    const opts = options || {};
    const id = opts.id || DEFAULT_ID;
    const className = opts.className || DEFAULT_CLASS;
    const anchors = Array.isArray(opts.anchors) && opts.anchors.length
      ? opts.anchors
      : [".top-row", "h1"];

    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      const anchor = findAnchor(anchors);
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(el, anchor.nextSibling);
      } else if (document.body) {
        document.body.appendChild(el);
      } else {
        return null;
      }
    }
    el.className = className;
    return el;
  }

  function showGlobal(message, options) {
    const text = String(message || "").trim();
    if (!text) return null;
    const el = ensureContainer(options);
    if (!el) return null;
    el.textContent = text;
    return el;
  }

  function clearGlobal(options) {
    const id = (options && options.id) || DEFAULT_ID;
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = "";
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  window.dbWalletMessages = { showGlobal, clearGlobal, ensureContainer };
})();
