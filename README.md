# db-wallet

Leichtes, komplett browserbasiertes Getränke‑Wallet – **kein Backend, kein Server**.  
Alle Daten liegen lokal im Browser und lassen sich per Export-Link oder JSON teilen.

---

## Schnellstart
- Startseite `index.html` öffnen, Nutzername eingeben (oder leer lassen für Zufall) → weiter zu `wallet.html#<name>`.
- Mobile ready: Layout stapelt Buttons, Felder passen sich an.
- Themes wählbar am Seitenende (5 dunkle Pastell-Schemes), Auswahl wird gespeichert.

---

## Was geht?
- 🥤 Buchen: Getränke hinzufügen, Tagesstatistik inkl. Diagramm/Log/Raw.
- ↩️ Korrigieren: Getränke zurücknehmen, solange Guthaben/Offen passt.
- 💸 Bezahlen: Offene Getränke ausgleichen; Zahlungen sichtbar im Log.
- 💰 Guthaben: Gutschriften aufladen und abbauen wie Vorrat.
- 🧾 Historie: Diagramm, chronologischer Log mit ID-Ranges (`1,3,5-7`), Raw-Daten pro User/alle.
- 🧹 Verwaltung: Einträge bearbeiten/löschen, Nutzer einzeln oder gesammelt löschen (inkl. „Nuke All“).
- 🔄 Import/Export: Link (auto-merge) oder JSON-Datei auf der Startseite hochladen/erzeugen.

---

## Dateien

| Datei | Zweck |
|-------|-------|
| [`index.html`](./index.html) | Startseite, Nutzerwahl, Import/Export, Theme-Wahl |
| [`wallet.html`](./wallet.html) | Drinks, Guthaben, Zahlungen, Historie/Raw, Theme-Wahl |
| [`colors.html`](./colors.html) | Vorschau aller 5 Themes mit Farbbalken & UI-Beispielen |
| [`colors.css`](./colors.css) | Styles für die Theme-Vorschau |
| [`style.css`](./style.css) | Basis-UI, responsive Layout, Theme-Variablen |

---

## Deploy (GitHub Pages)
1. Repo pushen.
2. GitHub: Settings → Pages → Deploy from branch → main / root.
3. Fertig: https://bmmmm.github.io/db-wallet/

Viel Spaß mit deinem minimalistischen, schnellen Getränke‑Wallet 🍹🚀
