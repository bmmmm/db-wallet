# db-wallet

A lightweight, browser-only drink-tracking wallet — **no database, no backend**.  
Everything runs locally in your browser using `localStorage`, and users manage their own data through export/import URLs.

## Files
- [`index.html`](./index.html) — Landing page for choosing a username  
- [`wallet.html`](./wallet.html) — Main interface (drink, minus, pay, export, history, reset)

## Features
- Personal wallet identified by a simple URL hash (`wallet.html#username`)
- Track drinks (+), subtract entries, and mark payments
- Full event-based history with daily buckets
- Automatic merge when importing data from another device
- Export current data as a shareable URL
- Reset wallet data at any time
- 100% client-side — perfect for GitHub Pages hosting

## How it works
State is stored entirely as an event list in `localStorage`.  
When exporting, the event log is encoded into a URL.  
Opening that export URL on another device imports and **merges** the data safely.

## Run on GitHub Pages
1. Push this repo to GitHub:  
   https://github.com/bmmmm/db-wallet
2. Open **Settings → Pages**
3. Set **Source: main branch / root**
4. Your app will be live at:  
   https://bmmmm.github.io/db-wallet/

## Usage
1. Open the landing page:  
   https://bmmmm.github.io/db-wallet/
2. Choose a username (or let the system generate one)
3. Use the wallet — all data stays in your browser
4. Export → open on another device → automatic merge → continue tracking

---

Minimal, fast, and surprisingly powerful 🚀