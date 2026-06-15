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
- Korrigieren: letzte Buchung rückgängig (Löschmarker im Log, syncbar), danach komplette Neuberechnung aus dem Log.
- Bezahlen: Offene Getränke ausgleichen; Zahlungen sichtbar im Log.
- Guthaben: Gutschriften aufladen und abbauen wie Vorrat.
- Historie: Diagramm (inkl. Tages-Drinkcount in `[n]`), Log mit IDs/Ranges
  inklusive Löschmarker, Raw-Daten pro Nutzer:in/alle.
- Statistik: Offen/Guthaben werden ausgeblendet, wenn sie 0 sind.
- Verwaltung: Einträge bearbeiten/löschen, Nutzer:innen einzeln oder gesammelt
  löschen.
- Migration: v1-Wallets können für robusten QR-Export auf v2 migriert werden.
- Import/Export: Link (auto-merge), kompakter QR-Code oder JSON-Datei; Export
  enthält auch Theme + Wallet-ID gegen Namens-Kollisionen.

## Action Codes (QR)

Action Codes können **lokal (wallet-gebunden)** oder **global (wallet-agnostisch)**
sein. Der Scope wird beim Erstellen/Bearbeiten gewählt. Beim Scannen erfolgt
**sofort** eine Buchung (ohne Reload):

- Typ **Trinken**: bucht ein Drink-Event.
- Typ **Guthaben**: bucht eine Gutschrift.

Wichtig:

- Verwaltung erfolgt inline per Buttons (New action code, Bearbeiten, Löschen).
- Die Mengenfrage im Inline-Formular passt sich dem Typ an (trinken vs gutschreiben).
- Pro Code ist der Scope wählbar: 🔒 Lokal (wallet‑gebunden) oder 🌍 Global.
- Lokale Action Codes sind an eine Wallet gebunden (Ziel-WalletId steckt im QR).
- Globale Action Codes sind stateless und wirken auf das aktuell geöffnete Wallet.
- Öffnest du `wallet.html#acg:…` direkt, wird bei mehreren Wallets eine Auswahl
  angezeigt; bei genau einem Wallet wird automatisch gebucht.
- Beim Bearbeiten (Name/Menge/Typ) wird der QR bei Bedarf neu erzeugt; alte Codes
  werden dann **ungültig** und werden beim Einlösen strikt abgelehnt.
- Der Betrag wird aus dem gespeicherten Action Code gelesen (nicht aus
  manipulierbaren QR-Feldern).
- QR-Payloads sind schlank gehalten; ältere Payloads bleiben kompatibel.

### Globale Action Codes (deterministisch)

Globale Action Codes (`#acg:...`) sind rein datengetrieben:

- deterministisch: gleiche Eingaben → gleicher Link
- keine Speicherung, keine Secrets
- Validierung: Typ `d/g`, Menge `1..100`
- wenn kein Wallet geöffnet ist, wird eine Hinweis‑Meldung angezeigt
- wirkt nur beim Scannen/Öffnen des Links, nicht automatisch

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

## Code-Aufteilung

Die UI- und Action-Logik ist aus `wallet-ui.js` in kleinere Dateien
ausgelagert, damit agentic coding / Review einfacher ist. `wallet-ui.js`
bleibt der schlanke Composer, der DOM-Refs sammelt, die Module initialisiert
und Hash-Routing macht:

- `wallet-device-ui.js`: Geräte-Symbol-Picker in der Top-Row (inkl. sichtbarer Device-ID)
- `wallet-sync-ui.js`: Sync-Status-Zeile (Ampel, Timeline, „✅ passt“)
- `wallet-export-ui.js`: Export-UI (Link, QR, JSON, QR-Session-Cache)
- `wallet-history-ui.js`: History-Ansicht (Diagramm/Log/Raw, Log-Tools)
- `wallet-hash-actions.js`: Global-Action Selection UI (Wallet-Auswahl bei `#acg:`)
- `wallet-actions.js`: Buchungs-Actions (Drink/Undo/Pay/Credit/Reset/Delete/Edit),
  jede Funktion bekommt einen `ctx` mit State-Gettern und UI-Reset-Hooks
- `wallet-messages.js`: zentrale Global-Message-API

Hinweis: `wallet.html` lädt diese Dateien vor `wallet-ui.js`.

## Architektur (Core vs UI)

Core (Logik/Codec/Storage):
- `wallet-helpers.js`, `wallet-storage.js`, `wallet-import-v2.js`
- `wallet-summary.js`, `wallet-sync.js`, `migration.js`
- `action-codes.js` (Normalisierung, Merge, Hash encode/decode)
- `hash-router.js` (Hash-Parsing)

UI (DOM + Interaktion):
- `index-ui.js`, `wallet-ui.js`
- `wallet-device-ui.js`, `wallet-history-ui.js`, `wallet-export-ui.js`, `wallet-sync-ui.js`
- `wallet-hash-actions.js`, `wallet-actions.js`, `wallet-messages.js`
- `import-preview.js`, `theme.js`

Tools:
- `self-check.js` (Konsole: `window.dbWalletSelfCheck.run()`)

## Self-Check

Im Browser (z. B. `wallet.html`) in der Konsole ausführen:

```
window.dbWalletSelfCheck.run()
```

Der Self-Check prüft u. a. Storage-Roundtrip, Import v2, Migration, Hash-Parsing,
Summary-Parität, Event-Ordering (`ts`, dann numerische base36-`seq`), Tombstones/Undo
und Action-Code-Payloads.

## Datenmodell Hinweise

- `wallet.deviceId` (Export/Sync-Metadatum) und `wallet.seq` (Event-Zähler pro Device-Key)
  bleiben getrennt; eine Zusammenlegung wäre nicht rückwärtskompatibel.

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
| [`wallet-helpers.js`](./wallet-helpers.js)     | Helper (Base64URL, gzip, Storage-Safety, Registry, fnv1a64/hash53/parseCompactEventId); kanonische Single-Source für Event-Comparator (`cmpEventId`/`compareEventsByTime`) und `DEVICE_SYMBOLS` |
| [`wallet-messages.js`](./wallet-messages.js)   | Zentrale UI-Message-API (`showGlobal` / `clearGlobal` / `ensureContainer`) |
| [`wallet-hash-actions.js`](./wallet-hash-actions.js) | Global-Action UI (`#acg:`): Wallet-Auswahlbildschirm + Preview-Helper    |
| [`wallet-actions.js`](./wallet-actions.js)     | Buchungs-Actions (Drink/Undo/Pay/Credit/Reset/Delete/Edit), `ctx`-basiert |
| [`wallet-storage.js`](./wallet-storage.js)     | Wallet-Storage/Model (load/save, deviceKey, devices-Liste)                |
| [`wallet-import-v2.js`](./wallet-import-v2.js) | Import/Export-Codec v2 + Hash-Import (inkl. Action Codes)                 |
| [`wallet-summary.js`](./wallet-summary.js)     | Berechnung von Total/Offen/Guthaben/Diagramm (pure)                       |
| [`wallet-sync.js`](./wallet-sync.js)           | Sync-Status Helfer (Ampel + ASCII-Timeline; lokal)                        |
| [`action-codes.js`](./action-codes.js)         | Action Codes UI + Hash-Encoding/Decoding                                  |
| [`wallet-history-ui.js`](./wallet-history-ui.js) | History-UI (Diagramm/Log/Raw, Log-Tools)                                 |
| [`hash-router.js`](./hash-router.js)           | Hash-Parsing (ac/import/i2/i2u)                                           |
| [`self-check.js`](./self-check.js)             | In-Browser Self-Check (Konsole)                                           |
| [`theme.js`](./theme.js)                       | Theme-Logik (Auswahl + Speicherung)                                       |
| [`import-preview.js`](./import-preview.js)     | Import-Auswahl (persist/preview) + Preview-Flow                           |
| [`themes.css`](./themes.css)                   | Theme-Paletten (CSS-Variablen)                                            |
| [`colors.html`](./colors.html)                 | Vorschau aller 5 Themes mit Farbbalken & UI-Beispielen                    |
| [`colors.css`](./colors.css)                   | Styles für die Theme-Vorschau                                             |
| [`style.css`](./style.css)                     | Basis-UI, responsive Layout                                               |
| [`qrcodegen.js`](./qrcodegen.js)               | QR-Code-Generator (Nayuki)                                                |
| [`migration.js`](./migration.js)               | Migration v1 → v2 (für QR-Export, nutzt zentrale Helper)                  |
| [`manifest.json`](./manifest.json)             | PWA-Manifest (Name, Farben, Icon)                                         |
| [`service-worker.js`](./service-worker.js)     | Offline-Cache (cache-first App-Shell, network-first HTML)                 |
| [`sw-register.js`](./sw-register.js)           | Service-Worker-Registrierung (https/localhost only)                       |
| [`favicon.svg`](./favicon.svg)                 | App-Icon (512×512, Theme-Farben)                                          |

## PWA / Offline

`manifest.json` + `service-worker.js` machen db-wallet installierbar und
offline-fähig. Der SW cached das komplette App-Shell beim ersten Besuch;
HTML-Navigationen gehen network-first mit Fallback auf den Cache. Nur `200`/`basic`-
Responses werden in die App-Shell geschrieben, damit eine Fehler- oder Redirect-Seite
den Cache nicht vergiftet.

Cache-Invalidierung: beim Release die Konstante `VERSION` in
`service-worker.js` erhöhen — alte Caches werden beim nächsten Besuch
automatisch aufgeräumt.

## Deployment (statisch, „Pages“-Style)

db-wallet ist eine reine Static-Webapp (HTML/CSS/JS) und kann auf vielen
Open-Source-freundlichen „Pages“-Diensten deployed werden.

### Hosted „Pages“-Dienste (GitHub-Pages-ähnlich)

- **Codeberg Pages** (Forgejo-basiert): https://codeberg.page/
- **GitLab Pages** (gitlab.com oder self-hosted GitLab): https://docs.gitlab.com/ee/user/project/pages/

### Self-hosted (Forgejo / Gitea)

Forgejo/Gitea bringen üblicherweise kein integriertes „Pages“-Feature wie GitHub/GitLab mit.
Typischer Setup:

1. Repo in **Forgejo** (https://forgejo.org/) oder **Gitea** (https://about.gitea.com/)
2. CI (Forgejo Actions / Woodpecker / Drone) baut die Static Site (falls nötig)
3. Deploy auf einen separaten Static Host (z. B. Nginx/Caddy oder S3/MinIO)

Tipp: Wenn du keinen Build brauchst, reicht auch simples Hosting des Repo-Roots als Static-Verzeichnis.

Es sind **keine** Build-Schritte, **keine** Server-Komponenten und **keine**
API-Keys notwendig.

Beispiel-URL (GitHub Pages):  
https://bmmmm.github.io/db-wallet/

Viel Spaß mit deinem minimalistischen, schnellen Getränke-Wallet 🍹🚀

## LLM Notes (for quick repo understanding)

- File map (core vs UI): Core/codec/storage in `wallet-helpers.js`, `wallet-storage.js`, `wallet-import-v2.js`, `wallet-summary.js`, `wallet-sync.js`, `migration.js`, `action-codes.js`, `hash-router.js`. UI in `index-ui.js`, `wallet-ui.js`, `wallet-device-ui.js`, `wallet-sync-ui.js`, `wallet-export-ui.js`, `wallet-history-ui.js`, `wallet-hash-actions.js`, `wallet-actions.js`, `wallet-messages.js`, `import-preview.js`, `theme.js`. PWA: `manifest.json`, `service-worker.js`, `sw-register.js`, `favicon.svg`.
- Invariants: storage prefix `db-wallet:`, registry key `db-wallet:registry`, hash formats `#<userId>`, `#import:`, `#i2:`, `#i2u:`, `#ac:`, `#acg:`; event schema `{id,t,n?,ts,ref?}` with tombstones `t:"x"` + `ref`; append-only — never mutate an event in place (merge dedups by `id`); event order = sort by `ts`, tie-break by numeric base36 `seq` (not lexical); action code SOFT/HARD limits 6/10; global `#acg:` deterministic and stateless.
- Entrypoints & flow: `index.html` → `index-ui.js` (list/create/import) and `wallet.html` → `wallet-ui.js` (hash classify → load wallet → compute summary → render UI); `hash-router.js` is the single classifier/parser for hashes.
- Where to edit: storage/model in `wallet-storage.js`; summary/tombstones in `wallet-summary.js`; action-code encode/decode + UI in `action-codes.js`; hash parsing in `hash-router.js`; booking actions in `wallet-actions.js`; UI wiring in `index-ui.js` / `wallet-ui.js` / `wallet-history-ui.js`.
- Quick manual checks: open `index.html` → create/open wallet → add drinks/pay → undo (tombstone) → export/import v2 → local/global action codes → open `wallet.html#acg:…` with 1+ wallets → `window.dbWalletSelfCheck.run()`.
