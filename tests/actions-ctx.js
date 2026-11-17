// Minimal ctx stub for window.dbWalletActions (the wallet-ui.js wiring without
// a DOM). Errors land in `alerts`, status-line notices in `notices`. Every
// dialogConfirm answers `confirm` (default true) at once, as a plain boolean
// (wallet.html's dialog answers with a Promise; the actions take both).
function makeActionsCtx(w, wallet, opts = {}) {
  const state = {
    wallet,
    alerts: [],
    notices: [],
    confirms: [],
    amount: opts.amount || 1,
  };
  const ctx = {
    getWallet: () => state.wallet,
    setWallet: (next) => {
      state.wallet = next;
    },
    getUserId: () => state.wallet.userId,
    getAmount: () => state.amount,
    getSummary: () => w.dbWalletSummary.computeSummarySafe(state.wallet),
    resetAmount() {},
    resetPayUi() {},
    clearExport() {},
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
  };
  return { ctx, state };
}

module.exports = { makeActionsCtx };
