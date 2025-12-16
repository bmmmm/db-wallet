(function () {
  const DEVICE_SYMBOLS = ["L", "M", "D", "K", "T", "*"];

  let opts = null;
  let expanded = false;
  let rootEl = null;
  let docListenerBound = false;

  function ensureRoot() {
    if (!opts || !opts.elUid) return null;
    if (rootEl && rootEl.isConnected) return rootEl;

    const existing = document.getElementById("device-symbol-selector");
    if (existing) {
      rootEl = existing;
      return rootEl;
    }

    const root = document.createElement("span");
    root.id = "device-symbol-selector";
    root.style.display = "flex";
    root.style.alignItems = "center";
    root.style.gap = "0.35rem";
    root.style.marginTop = "0.2rem";
    root.style.position = "relative";

    // Wichtig: unterhalb des Usernamens, gleicher linker Block
    opts.elUid.parentNode.appendChild(root);

    rootEl = root;
    return rootEl;
  }

  function createSymbolButton(symbol, isActive) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = symbol;
    btn.style.padding = "0.1rem 0.45rem";
    btn.style.fontSize = "0.9rem";
    btn.style.lineHeight = "1.1";
    btn.style.width = "auto";
    btn.style.minWidth = "0";
    btn.style.margin = "0 0.15rem";
    if (isActive) btn.style.fontWeight = "700";
    return btn;
  }

  function createDeviceKeyEl(deviceKey) {
    const span = document.createElement("span");
    span.textContent = deviceKey;
    span.style.marginLeft = "0.25rem";
    span.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    span.style.fontSize = "0.9rem";
    span.style.opacity = "0.9";
    return span;
  }

  function render() {
    const root = ensureRoot();
    if (!root || !opts) return;

    if (!docListenerBound) {
      docListenerBound = true;
      document.addEventListener("click", (e) => {
        if (!expanded) return;
        const target = e && e.target ? e.target : null;
        if (rootEl && target && rootEl.contains(target)) return;
        expanded = false;
        render();
      });
    }

    const deviceKey =
      opts.getDeviceKey && typeof opts.getDeviceKey === "function"
        ? opts.getDeviceKey()
        : "";

    const current =
      opts.getDeviceSymbol && typeof opts.getDeviceSymbol === "function"
        ? opts.getDeviceSymbol()
        : "";

    root.innerHTML = "";

    // gemeinsame Zeile für Symbol + Device-ID
    const line = document.createElement("span");
    line.style.display = "inline-flex";
    line.style.alignItems = "center";
    line.style.gap = "0.35rem";

    if (!current) {
      expanded = false;

      for (const sym of DEVICE_SYMBOLS) {
        const btn = createSymbolButton(sym, false);
        btn.addEventListener("click", (e) => {
          if (e && typeof e.stopPropagation === "function") e.stopPropagation();
          const ok =
            opts.setDeviceSymbol && typeof opts.setDeviceSymbol === "function"
              ? opts.setDeviceSymbol(sym)
              : false;
          if (!ok) return;
          expanded = false;
          render();
          if (opts.onChange) opts.onChange();
        });
        line.appendChild(btn);
      }

      if (deviceKey) line.appendChild(createDeviceKeyEl(deviceKey));
      root.appendChild(line);
      return;
    }

    const activeBtn = createSymbolButton(current, true);
    activeBtn.title = deviceKey ? `Device ID: ${deviceKey}` : "";
    activeBtn.setAttribute("aria-haspopup", "true");
    activeBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    activeBtn.addEventListener("click", (e) => {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      expanded = !expanded;
      render();
    });

    line.appendChild(activeBtn);
    if (deviceKey) line.appendChild(createDeviceKeyEl(deviceKey));
    root.appendChild(line);

    if (!expanded) return;

    const optsEl = document.createElement("span");
    optsEl.style.display = "inline-flex";
    optsEl.style.flexWrap = "wrap";
    optsEl.style.gap = "0.2rem";
    optsEl.style.marginLeft = "0.1rem";

    for (const sym of DEVICE_SYMBOLS) {
      if (sym === current) continue;
      const btn = createSymbolButton(sym, false);
      btn.addEventListener("click", (e) => {
        if (e && typeof e.stopPropagation === "function") e.stopPropagation();
        const ok =
          opts.setDeviceSymbol && typeof opts.setDeviceSymbol === "function"
            ? opts.setDeviceSymbol(sym)
            : false;
        if (!ok) return;
        expanded = false;
        render();
        if (opts.onChange) opts.onChange();
      });
      optsEl.appendChild(btn);
    }

    root.appendChild(optsEl);
  }

  function collapse() {
    expanded = false;
    render();
  }

  function init(nextOpts) {
    opts = nextOpts || null;
    expanded = false;
    render();
  }

  window.dbWalletDeviceUI = {
    init,
    render,
    collapse,
  };
})();
