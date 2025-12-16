# db-wallet

Ein leichtes, komplett browserbasiertes Getränke-Wallet für Freund:innen vom
Hackspace [bitcircus101.de](https://bitcircus101.de) in Bonn und der
[Datenburg e.V. Bonn](https://datenburg.org/) – **kein Backend, kein Server**.
Alle Daten liegen ausschließlich lokal im Browser (`localStorage`) und lassen
sich per Export/Import zwischen Geräten übertragen.

## Demo

- Live-Demo (GitHub Pages): https://bmmmm.github.io/db-wallet/
  - Das ist das Deployment aus dem Original-Repo und dient hier als Beispiel.

## Schnellstart

1. `index.html` öffnen.
2. Namen für die Nutzer:in eingeben (oder leer lassen für Zufall) → weiter zu
   `wallet.html#<name>` (z. B. `wallet.html#peter`).
3. Optional: Theme am Seitenende wählen; Auswahl wird gespeichert.
4. Optional: In `wallet.html` → Export → „QR-Code (kurz) anzeigen“ (kompakt,
   minuten-genau, merge-fähig). Tipp: QR-Code antippen → PNG downloaden; der
   Link unter dem QR ist zum Kopieren markiert.

## Funktionen

- Buchen: Getränke hinzufügen, Tagesstatistik inkl. Diagramm/Log/Raw.
- Korrigieren: Getränke zurücknehmen, solange Guthaben/Offen passt.
- Bezahlen: Offene Getränke ausgleichen; Zahlungen sichtbar im Log.
- Guthaben: Gutschriften aufladen und abbauen wie Vorrat.
- Historie: Diagramm, Log mit IDs/Ranges, Raw-Daten pro Nutzer:in/alle.
- Verwaltung: Einträge bearbeiten/löschen, Nutzer:innen einzeln oder gesammelt
  löschen.
- Migration: v1-Wallets können für robusten QR-Export auf v2 migriert werden.
- Import/Export: Link (auto-merge), kompakter QR-Code oder JSON-Datei; Export
  enthält auch Theme + Wallet-ID gegen Namens-Kollisionen.

## Action Codes (QR)

Action Codes sind wallet-gebundene QR-Links (`#ac:...`), die beim Scannen
**sofort** eine Buchung im Ziel-Profil auslösen (ohne Reload):

- Typ **Trinken**: bucht ein Drink-Event.
- Typ **Guthaben**: bucht eine Gutschrift.

Wichtig:

- Action Codes sind an eine Wallet gebunden (Ziel-WalletId steckt im QR).
- Action Codes können erneuert/rotiert werden: alte QR-Codes werden dann
  **ungültig** und werden beim Einlösen strikt abgelehnt.
- Der Betrag wird aus dem gespeicherten Action Code gelesen (nicht aus
  manipulierbaren QR-Feldern).

## Sync Status (Top-Row)

Die Wallet zeigt einen rein lokalen Sync-Status an, um den Stand zwischen
Geräten (z. B. Laptop ↔ Handy) sichtbar zu machen. Es gibt **keinen**
Hintergrund-Sync: Synchronisieren passiert ausschließlich durch Export/Import.

### Wie Syncing funktioniert

- Export/Import (Link/QR/JSON) ist der einzige Weg, Daten zwischen Geräten zu
  übertragen.
- Für die Sync-Anzeige zählen ausschließlich **Events** (nicht Getränkemengen).
  **1 Event = 1 Schritt** auf der Timeline – unabhängig davon, ob ein Event `+1`
  oder `+10` enthält.

### Wie man die Sync-Zeile liest (Mental Model)

Die ASCII-Timeline basiert auf der Anzahl der Events:

- `===|`: fester Marker für „zuletzt sicher gemeinsam“ (die `=` wachsen nicht)
- Zeichen nach `|`: lokale Divergenz in Event-Schritten (1 Zeichen = 1 Event)
- Die Anzahl der abweichenden lokalen Events wird zusätzlich separat als `Δ`
  angezeigt (kein `ΔR`).

Beispiele:

- `Sync: ===|` → identisch
- `Sync: ===|MMMM` → lokal 4 Events weiter
- `Sync: …==|MMMMMMMMMMMMMMMMMMMMMMMM` → Divergenz gekürzt (rechts priorisiert)

### Ampel-Logik & Reset

- Grün: Sync aktuell (≤ 5 Tage)
- Gelb: Sync alt (6–10 Tage)
- Rot: Sync veraltet (≥ 11 Tage) → Klick führt zur Export-Sektion
- Button „✅ passt“: manueller Vertrauens-Reset (setzt den Sync-Stand auf
  „gleich“ auf diesem Gerät, ohne Export/Import).

## Geräte-Bewusstsein (pro Wallet, synchronisiert)

Pro Wallet gibt es eine synchronisierte Geräte-Liste (mit `deviceKey`, Symbol,
`lastSeenAt`), die bei Export/Import mitgesendet und deterministisch gemerged
wird:

- Maximal 6 Geräte pro Wallet (älteste Einträge werden automatisch entfernt).
- Pro Wallet ist jedes Symbol (`L/M/D/K/T/*`) eindeutig und wird per Buttons in
  der Top-Row zugewiesen (keine Texteingabe, keine Prompts).
- Das lokale Geräte-Symbol zeigt die eigene Device-ID direkt daneben (mobile-tauglich,
  kein Hover nötig).

## Code-Aufteilung (Stage 1)

Ein Teil der UI-Logik wurde aus `wallet-ui.js` in kleinere Dateien ausgelagert,
damit agentic coding / Review einfacher ist:

- `wallet-device-ui.js`: Geräte-Symbol-Picker in der Top-Row (inkl. sichtbarer Device-ID)
- `wallet-sync-ui.js`: Sync-Status-Zeile (Ampel, Timeline, „✅ passt“)
- `wallet-export-ui.js`: Export-UI (Link, QR, JSON, QR-Session-Cache)

Hinweis: `wallet.html` lädt diese Dateien vor `wallet-ui.js`.

## Dateien

| Datei                                          | Zweck                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| [`index.html`](./index.html)                   | Startseite, Nutzer:innenwahl, Import/Export, Theme-Wahl                   |
| [`wallet.html`](./wallet.html)                 | Drinks, Guthaben, Zahlungen, Historie/Raw, Theme-Wahl                     |
| [`index-ui.js`](./index-ui.js)                 | UI-Logik der Startseite (Routing, Liste, Import)                          |
| [`wallet-ui.js`](./wallet-ui.js)               | Wallet-Composer/Entry (DOM-Wiring, Hash-Routing, Module initialisieren)   |
| [`wallet-device-ui.js`](./wallet-device-ui.js) | Geräte-Symbol-Picker (Top-Row, sichtbare Device-ID)                       |
| [`wallet-sync-ui.js`](./wallet-sync-ui.js)     | Sync-Status UI (Ampel + ASCII-Timeline + „✅ passt“)                       |
| [`wallet-export-ui.js`](./wallet-export-ui.js) | Export UI (Link/QR/JSON, QR-Session-Cache, PNG-Download)                  |
| [`wallet-helpers.js`](./wallet-helpers.js)     | Helper (Base64URL, gzip, Storage-Safety, Registry)                        |
| [`wallet-storage.js`](./wallet-storage.js)     | Wallet-Storage/Model (load/save, deviceKey, devices-Liste)                |
| [`wallet-import-v2.js`](./wallet-import-v2.js) | Import/Export-Codec v2 + Hash-Import (inkl. Action Codes)                 |
| [`wallet-summary.js`](./wallet-summary.js)     | Berechnung von Total/Offen/Guthaben/Diagramm (pure)                       |
| [`wallet-sync.js`](./wallet-sync.js)           | Sync-Status Helfer (Ampel + ASCII-Timeline; lokal)                        |
| [`action-codes.js`](./action-codes.js)         | Action Codes UI + Hash-Encoding/Decoding                                  |
| [`theme.js`](./theme.js)                       | Theme-Logik (Auswahl + Speicherung)                                       |
| [`import-preview.js`](./import-preview.js)     | Import-Auswahl (persist/preview) + Preview-Flow                           |
| [`themes.css`](./themes.css)                   | Theme-Paletten (CSS-Variablen)                                            |
| [`colors.html`](./colors.html)                 | Vorschau aller 5 Themes mit Farbbalken & UI-Beispielen                    |
| [`colors.css`](./colors.css)                   | Styles für die Theme-Vorschau                                             |
| [`style.css`](./style.css)                     | Basis-UI, responsive Layout                                               |
| [`qrcodegen.js`](./qrcodegen.js)               | QR-Code-Generator (Nayuki)                                                |
| [`migration.js`](./migration.js)               | Migration v1 → v2 (für QR-Export)                                         |

## Deployment (Beispiel)

So läuft das GitHub-Pages-Setup im Original-Repo; für Forks einfach anpassen:

1. Repo pushen.
2. GitHub: Settings → Pages → Deploy from branch → main / root.
3. Fertig – Beispiel-URL: https://bmmmm.github.io/db-wallet/

Viel Spaß mit deinem minimalistischen, schnellen Getränke-Wallet 🍹🚀
