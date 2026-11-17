// Minimal ctx stub for window.dbWalletActions (the wallet-ui.js wiring without
// a DOM). Errors land in `alerts`, status-line notices in `notices`. Dialog
// answers are scripted: `prompts` is a queue of return values for
// dialogPrompt, `confirm` the answer for every dialogConfirm.
function makeActionsCtx(w, wallet, opts = {}) {
  const state = {
    wallet,
    alerts: [],
    notices: [],
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
    // Status-line notices (P4.1): { text, action } with action = the label.
    notify: (m, o) =>
      state.notices.push({ text: String(m), action: o && o.action ? o.action.label : null, run: o && o.action ? o.action.run : null }),
    dialogConfirm: (m) => {
      state.confirms.push(String(m));
      return opts.confirm !== false;
    },
    dialogPrompt: () => (state.prompts.length ? state.prompts.shift() : null),
  };
  return { ctx, state };
}

module.exports = { makeActionsCtx };
