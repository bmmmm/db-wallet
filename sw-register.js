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

  function showUpdateToast() {
    if (notified || !document.body) return;
    notified = true;
    const bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.style.position = "fixed";
    bar.style.left = "50%";
    bar.style.bottom = "16px";
    bar.style.transform = "translateX(-50%)";
    bar.style.zIndex = "9999";
    bar.style.padding = "10px 14px";
    bar.style.borderRadius = "10px";
    bar.style.background = "rgba(20,20,20,0.92)";
    bar.style.color = "#fff";
    bar.style.font = "14px system-ui, sans-serif";
    bar.style.boxShadow = "0 4px 16px rgba(0,0,0,0.35)";
    bar.style.display = "flex";
    bar.style.gap = "12px";
    bar.style.alignItems = "center";

    const text = document.createElement("span");
    text.textContent = "Neue Version verfügbar.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Aktualisieren";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", () => location.reload());

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
