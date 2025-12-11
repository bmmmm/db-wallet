# db-wallet

A lightweight, browser-only drink-tracking wallet — **no database, no backend**.  
Everything runs locally in your browser using `localStorage`, and users manage their own data through export/import URLs.

## Features
- Personal wallet identified by a simple URL hash (e.g. `wallet.html#username`)
- Track drinks (+), subtract entries, and mark payments
- Full event-based history with daily buckets
- Automatic merge when importing data from another device
- Export current data as a shareable URL
- Reset wallet data at any time
- 100% client-side — perfect for GitHub Pages hosting

## Structure
- `index.html` — Landing page for choosing a username
- `wallet.html` — Main interface with all buttons (drink, minus, pay, export, reset, history)

## How it works
State is stored as a list of events in `localStorage`.  
When exporting, the event log is encoded into a URL.  
Opening that URL on another device imports and merges data safely.

## Run on GitHub Pages
1. Push this repo to GitHub:  
   `https://github.com/bmmmm/db-wallet`
2. In *Settings → Pages*, set the source to **main branch / root**.
3. Your app will be live at:  
   `https://bmmmm.github.io/db-wallet/`

## Usage
1. Visit the landing page:  
   `https://bmmmm.github.io/db-wallet/`
2. Choose a username (or use a random one)
3. Use the wallet — everything is saved locally
4. Export → open on another device → auto-merge → continue tracking

---

Minimal, fast, and surprisingly powerful 🚀
