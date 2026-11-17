(function () {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    return;
  }

  // Capture whether a controller already exists BEFORE registering: on a fresh
  // first visit there is none, so the controllerchange below (fired by the new
  // SW's skipWaiting + clients.claim) must not prompt a reload mid-first-load.
  const hadController = !!navigator.serviceWorker.controller;
  let notified = false;

  const UPDATE_TEXT = "Neue Version verfügbar.";
  const UPDATE_LABEL = "Neu laden";

  // P5.3: the notice goes to the page's status line (sticky, with a reload
  // button) instead of an inline-styled toast that ignored the theme and sat
  // on top of the line's own notices. A later notice may replace it — the
  // new version is active already, the next page load gets it anyway.
  // Without the line (or the helpers) it builds an own box with the line's
  // classes, so style.css still styles it.
  function showUpdateToast() {
    if (notified || !document.body) return;
    notified = true;
    const reload = () => location.reload();
    const helpers = window.dbWalletHelpers || null;
    if (helpers && typeof helpers.notify === "function" && document.getElementById("status-line")) {
      helpers.notify(UPDATE_TEXT, { sticky: true, action: { label: UPDATE_LABEL, run: reload } });
      return;
    }
    const bar = document.createElement("div");
    bar.className = "status-line update-toast is-visible";
    const text = document.createElement("span");
    text.className = "status-text";
    text.setAttribute("role", "status");
    text.textContent = UPDATE_TEXT;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "status-action";
    btn.textContent = UPDATE_LABEL;
    btn.addEventListener("click", reload);
    bar.appendChild(text);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Only notify when an EXISTING controller was replaced by a new deploy —
    // never on the first install. A toast (not an auto-reload) so we don't
    // interrupt an in-progress booking.
    if (hadController) showUpdateToast();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((err) => {
        console.warn("db-wallet: service worker registration failed", err);
      });
  });
})();
