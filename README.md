# db-wallet

Ein leichtes, komplett browserbasiertes Getränke‑Wallet für Freund:innen von bitcircus101.de  
und der [Datenburg e.V. Bonn](https://datenburg.org/) – **kein Backend, kein Server**.  
Alle Daten liegen lokal im Browser und lassen sich per Export-Link oder JSON teilen.

## Demo
- Live-Demo (GitHub Pages): https://bmmmm.github.io/db-wallet/  
  Das ist das Deployment aus dem Original‑Repo und dient hier als Beispiel.

## Schnellstart
1. `index.html` öffnen.
2. Namen für die Nutzer:in eingeben (oder leer lassen für Zufall) → weiter zu `wallet.html#<name>`.  
   `wallet.html#peter` ist nur ein Beispiel zur Orientierung.
3. Optional: Theme am Seitenende wählen; Auswahl wird gespeichert.
4. Optional: In `wallet.html` → Export → „QR-Code (kurz) anzeigen“ (kompakt, minuten-genau, merge-fähig).  
   Tipp: QR-Code antippen → PNG downloaden; der Link unter dem QR ist zum Kopieren markiert.

## Funktionen
- 🥤 Buchen: Getränke hinzufügen, Tagesstatistik inkl. Diagramm/Log/Raw.
- ↩️ Korrigieren: Getränke zurücknehmen, solange Guthaben/Offen passt.
- 💸 Bezahlen: Offene Getränke ausgleichen; Zahlungen sichtbar im Log.
- 💰 Guthaben: Gutschriften aufladen und abbauen wie Vorrat.
- 🧾 Historie: Diagramm, Log mit IDs/Ranges (z. B. `1,3,5-7` – Beispiel), Raw‑Daten pro Nutzer:in/alle.
- 🧹 Verwaltung: Einträge bearbeiten/löschen, Nutzer:innen einzeln oder gesammelt löschen (inkl. „Nuke All“).
- 🧬 Migration: v1‑Wallets können für robusten QR‑Export auf v2 migriert werden.
- 🔄 Import/Export: Link (auto-merge), kompakter QR‑Code oder JSON-Datei; Export enthält auch das aktive Theme und eine Wallet-ID gegen Namens-Kollisionen.

## Dateien

| Datei | Zweck |
|-------|-------|
| [`index.html`](./index.html) | Startseite, Nutzer:innenwahl, Import/Export, Theme-Wahl |
| [`wallet.html`](./wallet.html) | Drinks, Guthaben, Zahlungen, Historie/Raw, Theme-Wahl |
| [`theme.js`](./theme.js) | Theme-Logik (Auswahl + Speicherung) |
| [`themes.css`](./themes.css) | Theme-Paletten (CSS-Variablen) |
| [`colors.html`](./colors.html) | Vorschau aller 5 Themes mit Farbbalken & UI-Beispielen |
| [`colors.css`](./colors.css) | Styles für die Theme-Vorschau |
| [`style.css`](./style.css) | Basis-UI, responsive Layout |
| [`qrcodegen.js`](./qrcodegen.js) | QR-Code-Generator (Nayuki) |
| [`migration.js`](./migration.js) | Migration v1 → v2 (für QR-Export) |

## Deployment (Beispiel)
So läuft das GitHub‑Pages‑Setup im Original‑Repo; für Forks einfach anpassen:
1. Repo pushen.
2. GitHub: Settings → Pages → Deploy from branch → main / root.
3. Fertig – Beispiel‑URL: https://bmmmm.github.io/db-wallet/

Viel Spaß mit deinem minimalistischen, schnellen Getränke‑Wallet 🍹🚀
