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
  // button). Only index.html and wallet.html load this script; both have the
  // line and load wallet-helpers.js first. A later notice may replace it —
  // the new version is active already, the next page load gets it anyway.
  function showUpdateNotice() {
    const helpers = window.dbWalletHelpers;
    if (notified || !helpers) return;
    notified = true;
    helpers.notify(UPDATE_TEXT, {
      sticky: true,
      action: { label: UPDATE_LABEL, run: () => location.reload() },
    });
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Only notify when an EXISTING controller was replaced by a new deploy —
    // never on the first install. A notice (not an auto-reload) so we don't
    // interrupt an in-progress booking.
    if (hadController) showUpdateNotice();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((err) => {
        console.warn("db-wallet: service worker registration failed", err);
      });
  });
})();
