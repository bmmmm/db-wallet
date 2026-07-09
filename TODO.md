# TODO

- [ ] Verify/fix double `switchToUser` after link/QR import: `importRemoteWallet` sets
  `location.hash` while `handleHashChange` already called `switchToUser` explicitly —
  the queued hashchange may reload/save/render a second time (unverified sweep finding,
  wallet-import-v2.js ~1114).
- [ ] Theme label on fresh install: with no stored theme the label claims "Lilac Carbon"
  and no theme button is active, while the page renders the `:root` default palette
  (unverified sweep finding, wallet-ui.js ~27 / theme.js).
