// Stub for the in-browser test suite: window.dbWalletSelfCheck.run() loads
// self-check.js (~75 KB) on first use instead of on every wallet.html visit,
// then forwards to the real run(). self-check.js stays in the SW precache, so
// this also works offline. A load failure rejects the promise with a clear
// message (and a later call retries).
(function () {
  const SRC = "self-check.js";
  let loading = null;

  function realApi() {
    const api = window.dbWalletSelfCheck;
    return api && api !== stub && typeof api.run === "function" ? api : null;
  }

  function load() {
    const ready = realApi();
    if (ready) return Promise.resolve(ready);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SRC;
      script.onload = () => {
        const api = realApi();
        if (api) resolve(api);
        else reject(new Error(`db-wallet self-check: ${SRC} loaded but defines no dbWalletSelfCheck.run()`));
      };
      script.onerror = () => {
        reject(new Error(`db-wallet self-check: could not load ${SRC} (offline and not cached?)`));
      };
      (document.head || document.body).appendChild(script);
    }).catch((err) => {
      loading = null;
      throw err;
    });
    return loading;
  }

  const stub = {
    run(options) {
      return load().then((api) => api.run(options));
    },
    load,
  };

  if (!realApi()) window.dbWalletSelfCheck = stub;
})();
