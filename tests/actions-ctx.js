// Minimal ctx stub for window.dbWalletActions (the wallet-ui.js wiring without
// a DOM). Dialog answers are scripted: `prompts` is a queue of return values for
// dialogPrompt, `confirm` the answer for every dialogConfirm.
function makeActionsCtx(w, wallet, opts = {}) {
  const state = {
    wallet,
    alerts: [],
    confirms: [],
    prompts: Array.isArray(opts.prompts) ? opts.prompts.slice() : [],
    amount: opts.amount || 1,
    deleteRange: opts.deleteRange || "",
  };
  const ctx = {
    getWallet: () => state.wallet,
    setWallet: (next) => {
      state.wallet = next;
    },
    getUserId: () => state.wallet.userId,
    getAmount: () => state.amount,
    getSummary: () => w.dbWalletSummary.computeSummarySafe(state.wallet),
    getDeleteRange: () => state.deleteRange,
    resetAmount() {},
    resetPayUi() {},
    clearExport() {},
    clearDeleteRange() {
      state.deleteRange = "";
    },
    setHistoryEmpty() {},
    refreshActionCodesUi() {},
    updateHeaderUi() {},
    onStateChanged() {},
    dialogAlert: (m) => state.alerts.push(String(m)),
    dialogConfirm: (m) => {
      state.confirms.push(String(m));
      return opts.confirm !== false;
    },
    dialogPrompt: () => (state.prompts.length ? state.prompts.shift() : null),
  };
  return { ctx, state };
}

module.exports = { makeActionsCtx };
