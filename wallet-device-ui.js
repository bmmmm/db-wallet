(function () {
  // Device symbol picker in the wallet header (P4.7). Collapsed it is one
  // labelled button ("Gerät: L" or "Gerät: wählen"); expanded it shows what
  // the symbol is for, the device id, and the six symbols as a pressed-state
  // group. The explanation is visible text, not a title tooltip (touch
  // devices never show those). Styling lives in style.css (.device-*).

  const helpers = window.dbWalletHelpers;
  if (!helpers) return;
  const DEVICE_SYMBOLS = helpers.DEVICE_SYMBOLS;

  const OPTIONS_ID = "device-symbol-options";

  let opts = null;
  let expanded = false;
  let rootEl = null;
  let docListenerBound = false;
  // "toggle" | "option" | null — where focus goes after the next render.
  let pendingFocus = null;

  function onDocumentClose(e) {
    if (!expanded) return;
    const target = e && e.target ? e.target : null;
    if (rootEl && target && rootEl.contains(target)) return;
    expanded = false;
    render();
  }

  function call(name, arg) {
    return opts && typeof opts[name] === "function" ? opts[name](arg) : undefined;
  }

  function choose(sym) {
    if (!call("setDeviceSymbol", sym)) return;
    expanded = false;
    pendingFocus = "toggle";
    render();
    call("onChange");
  }

  function render() {
    const root = rootEl;
    if (!root || !opts) return;

    if (!docListenerBound) {
      docListenerBound = true;
      document.addEventListener("click", onDocumentClose);
    }

    const deviceKey = call("getDeviceKey") || "";
    const current = call("getDeviceSymbol") || "";

    root.innerHTML = "";
    root.classList.toggle("is-expanded", expanded);

    const label = document.createElement("span");
    label.className = "device-label";
    label.textContent = "Gerät:";
    root.appendChild(label);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "device-toggle";
    toggle.textContent = current || "wählen";
    toggle.setAttribute(
      "aria-label",
      current ? `Gerätesymbol ${current} ändern` : "Gerätesymbol wählen",
    );
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.setAttribute("aria-controls", OPTIONS_ID);
    toggle.addEventListener("click", (e) => {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      expanded = !expanded;
      pendingFocus = expanded ? "option" : "toggle";
      render();
    });
    root.appendChild(toggle);

    let focusTarget = pendingFocus === "toggle" ? toggle : null;

    if (expanded) {
      const panel = document.createElement("div");
      panel.id = OPTIONS_ID;
      panel.className = "device-options";
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-label", "Gerätesymbol");

      const hint = document.createElement("p");
      hint.className = "device-hint";
      hint.textContent =
        "Ein Zeichen für dieses Gerät. Es kennzeichnet seine Buchungen in der Sync-Anzeige auf allen Geräten." +
        (deviceKey ? ` Geräte-ID: ${deviceKey}` : "");
      panel.appendChild(hint);

      const buttons = document.createElement("div");
      buttons.className = "device-symbols";
      for (const sym of DEVICE_SYMBOLS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "device-symbol";
        btn.textContent = sym;
        btn.setAttribute("aria-pressed", sym === current ? "true" : "false");
        btn.addEventListener("click", (e) => {
          if (e && typeof e.stopPropagation === "function") e.stopPropagation();
          choose(sym);
        });
        buttons.appendChild(btn);
        if (pendingFocus === "option" && !focusTarget) focusTarget = btn;
        if (pendingFocus === "option" && sym === current) focusTarget = btn;
      }
      panel.appendChild(buttons);
      panel.addEventListener("keydown", (e) => {
        if (!e || e.key !== "Escape") return;
        if (typeof e.preventDefault === "function") e.preventDefault();
        expanded = false;
        pendingFocus = "toggle";
        render();
      });
      root.appendChild(panel);
    }

    pendingFocus = null;
    if (focusTarget && typeof focusTarget.focus === "function") {
      try {
        focusTarget.focus();
      } catch (e) {
        // ignore
      }
    }
  }

  // #device-symbol-selector stands in wallet.html's header.
  function init(nextOpts) {
    opts = nextOpts || null;
    rootEl = document.getElementById("device-symbol-selector");
    expanded = false;
    pendingFocus = null;
    render();
  }

  window.dbWalletDeviceUI = {
    init,
    render,
  };
})();
