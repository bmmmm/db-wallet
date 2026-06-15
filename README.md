# db-wallet 🍹

> Getränke-Wallet für den Browser — **kein Backend, kein Server**, alles lokal.

Leichtgewichtiges Drink-Tracking für die Crew vom Hackspace
[bitcircus101.de](https://bitcircus101.de) und der
[Datenburg e.V. Bonn](https://datenburg.org/). Alle Daten liegen im
`localStorage`; synchronisiert wird über Export/Import (Link, QR, JSON) — ganz
ohne Cloud.

**→ [Live-Demo](https://bmmmm.github.io/db-wallet/)** &nbsp;·&nbsp; kein Framework · kein Build · kein npm · PWA

## Schnellstart

1. `index.html` öffnen, Namen eingeben (oder leer lassen für Zufall) →
   `wallet.html#<name>`.
2. Getränke buchen, bezahlen, Guthaben aufladen.
3. Zum Übertragen: auf einem Gerät **Export → „QR-Code (kurz)"**, auf dem anderen
   scannen — der Merge passiert automatisch.

> Theme lässt sich am Seitenende wählen und wird gespeichert.

## Features

- **Buchen & Korrigieren** — Drinks zählen, letzte Buchung rückgängig (als
  syncbarer Löschmarker), Tagesstatistik mit Diagramm/Log/Raw.
- **Bezahlen & Guthaben** — offene Drinks ausgleichen, Guthaben wie Vorrat
  auf- und abbauen.
- **Verwaltung** — Einträge bearbeiten/löschen, Nutzer:innen einzeln oder
  gesammelt entfernen.
- **Import/Export** — Link (auto-merge), kompakter QR-Code oder JSON; inklusive
  Theme und Wallet-ID gegen Namens-Kollisionen.
- **Offline-fähig** — als PWA installierbar, läuft ohne Netz.

## Action Codes (QR)

Vorgefertigte QR-Codes, die beim Scannen **sofort** buchen — Typ *Trinken* oder
*Guthaben*, mit zwei Scopes:

- 🔒 **Lokal** — an eine Wallet gebunden (die Ziel-WalletId steckt im QR).
- 🌍 **Global** (`#acg:…`) — stateless und deterministisch, wirkt auf das gerade
  geöffnete Wallet. Bei mehreren Wallets fragt die App, auf welches gebucht wird;
  ist keins offen, kommt ein Hinweis.

Gut zu wissen:

- Der Betrag wird aus dem **gespeicherten** Code gelesen, nie aus manipulierbaren
  QR-Feldern.
- Bearbeiten (Name/Menge/Typ) erneuert den Code — **alte QR-Codes werden beim
  Einlösen strikt abgelehnt**.
- Max. 6 Codes pro Wallet empfohlen; ab 10 bleiben nur die 10 zuletzt aktiven.
- Globale Codes validieren Typ (`d`/`g`) und Menge (`1`–`100`).

## Sync & Geräte

Rein lokale Anzeige, **kein Hintergrund-Sync** — synchronisiert wird
ausschließlich über Export/Import. Gezählt werden **Events**: 1 Event = 1 Schritt,
egal ob `+1` oder `+10`.

| Ampel | Bedeutung |
|-------|-----------|
| ✅ Grün | aktuell (≤ 5 Tage) |
| ⚠️ Gelb | älter (6–10 Tage) |
| 🛑 Rot | veraltet (≥ 11 Tage) — Klick springt zum Export |

Der Button **„✅ passt"** setzt den Sync-Stand manuell auf „gleich" (Vertrauens-
Reset auf diesem Gerät, ohne Export/Import).

Pro Wallet gibt es zudem eine synchronisierte **Geräte-Liste** (Symbol
`L/M/D/K/T/*`, `lastSeenAt`), die bei Export/Import deterministisch gemerged wird:
max. 6 Geräte (älteste fallen raus), jedes Symbol pro Wallet eindeutig, gesetzt
per Button in der Top-Row.

<details>
<summary>ASCII-Timeline lesen</summary>

Die Sync-Zeile zeigt die lokale Divergenz in Events:

| Anzeige | Bedeutung |
|---------|-----------|
| `Sync: ===\|` | identisch |
| `Sync: ===\|MMMM` | lokal 4 Events weiter |
| `Sync: …==\|MMMM…` | gekürzt, wenn die Divergenz nicht mehr in die Zeile passt |

`===\|` ist ein fester Marker („zuletzt sicher gemeinsam"), die Zeichen danach
sind lokale Events. Die genaue Zahl steht zusätzlich als `Δ: +N Events`.
</details>

## Entwicklung

Kein Build-Schritt — HTML/CSS/JS direkt bearbeiten und statisch servieren:

```bash
python3 -m http.server 8080   # → http://localhost:8080
```

**Self-Check** in der Browser-Konsole (z. B. auf `wallet.html`):

```js
await dbWalletSelfCheck.run()   // → { ok, checks }
```

Prüft u. a. Storage-Roundtrip, Import v2, Migration (v1→v2), Hash-Parsing,
Summary-Parität, Event-Ordering, Tombstones/Undo und Action-Code-Payloads.

> Der Service-Worker cached die App-Shell cache-first. Nach einem Edit ggf. den
> SW abmelden + Caches leeren oder auf einem frischen Port servieren, sonst läuft
> alter Code.

<details>
<summary>Architektur &amp; Dateien</summary>

**Event-Modell — append-only.** Drink/Credit/Pay hängen ein Event an;
Delete/Undo/Edit hängen einen Tombstone an (`t:"x"`, `ref` = Ziel-ID). Ein Event
wird **nie** in-place geändert — der Merge dedupliziert strikt nach `id`.
Reihenfolge: nach `ts` sortiert, Tie-Break über numerische base36-`seq` (nicht
lexikalisch).

`wallet.deviceId` (Sync-Metadatum) und `wallet.seq` (Event-Zähler pro
Device-Key) bleiben getrennt — eine Zusammenlegung wäre nicht
rückwärtskompatibel.

**Core (Logik / Codec / Storage):**

| Datei | Rolle |
|-------|-------|
| `wallet-helpers.js` | Base64URL, gzip, IDs, Hashing; kanonischer Event-Comparator + `DEVICE_SYMBOLS` |
| `wallet-storage.js` | localStorage, deviceKey, Geräte-Liste, Wallet-Registry |
| `wallet-import-v2.js` | Binär-Codec v2 (encode/decode), Import-Merge, Action-Code-Einlösung |
| `wallet-summary.js` | Total / Offen / Guthaben / Diagramm (pure) |
| `wallet-sync.js` | Sync-Ampel + ASCII-Timeline (lokal) |
| `action-codes.js` | Action Codes: Normalisierung, Merge, Hash-Codec, UI |
| `hash-router.js` | Hash-Parsing (`#<name>`, `ac` / `acg` / `import` / `i2` / `i2u`) |
| `migration.js` | Migration v1 → v2 (für robusten QR-Export) |

**UI:**

| Datei | Rolle |
|-------|-------|
| `index-ui.js` | Startseite (Liste, Anlegen, Import) |
| `wallet-ui.js` | Wallet-Composer (DOM-Wiring, Hash-Routing, Module initialisieren) |
| `wallet-actions.js` | Buchungen (Drink/Undo/Pay/Credit/Reset/Delete/Edit) |
| `wallet-history-ui.js` | Verlauf (Diagramm/Log/Raw) |
| `wallet-device-ui.js` | Geräte-Symbol-Picker (Top-Row) |
| `wallet-sync-ui.js` | Sync-Zeile (Ampel, Timeline, „✅ passt") |
| `wallet-export-ui.js` | Export (Link/QR/JSON, PNG-Download) |
| `wallet-hash-actions.js` | Wallet-Auswahl bei globalen Action Codes |
| `wallet-messages.js` | Zentrale UI-Message-API |
| `import-preview.js` + `preview.html` | Read-Only-Import-Vorschau (lokal, nicht gespeichert) |
| `theme.js` + `themes.css` | Theme-System (5 Paletten) |

**PWA:** `manifest.json`, `service-worker.js`, `sw-register.js` &nbsp;·&nbsp;
**Tools:** `self-check.js`, `colors.html` (Theme-Vorschau) &nbsp;·&nbsp;
**QR:** `qrcodegen.js` (Nayuki)

**Ladereihenfolge ist load-bearing:** jedes Modul ist ein
`window.dbWalletX`-IIFE, das früh aussteigt, wenn eine Abhängigkeit fehlt — die
`<script>`-Reihenfolge in `wallet.html` beibehalten.
</details>

<details>
<summary>Deployment</summary>

Reine Static-Webapp — **keine Builds, keine Server, keine API-Keys**. Läuft auf
jedem Static-Host:

- **GitHub Pages** — aktuelles Deployment: `bmmmm.github.io/db-wallet`
- **Codeberg Pages** (Forgejo), **GitLab Pages** oder self-hosted hinter
  Nginx/Caddy — einfach den Repo-Root als Static-Verzeichnis ausliefern.

**Cache-Invalidierung:** beim Release `VERSION` in `service-worker.js` erhöhen —
alte Caches werden beim nächsten Besuch aufgeräumt. Der SW schreibt nur
`200`/`basic`-Responses in die App-Shell, damit Fehler- oder Redirect-Seiten den
Cache nicht vergiften.
</details>

<details>
<summary>Notizen für LLMs / Agents</summary>

- **Einstiegspunkte:** `index.html` → `index-ui.js`; `wallet.html` →
  `wallet-ui.js` (Hash klassifizieren → Wallet laden → Summary berechnen →
  rendern). `hash-router.js` ist der einzige Hash-Parser.
- **Invarianten:** Storage-Prefix `db-wallet:`, Registry `db-wallet:registry`;
  Event-Schema `{id,t,n?,ts,ref?}` mit Tombstones `t:"x"` + `ref`; append-only
  (Merge dedupt nach `id`); Order = `ts`, dann numerische base36-`seq`;
  Action-Code-Limits 6/10; `#acg:` deterministisch und stateless.
- **Wo editieren:** Storage/Modell → `wallet-storage.js`; Summary/Tombstones →
  `wallet-summary.js`; Action-Codes → `action-codes.js`; Hash-Parsing →
  `hash-router.js`; Buchungen → `wallet-actions.js`.
- **Smoke-Test:** Wallet anlegen → Drinks/Pay → Undo → Export/Import v2 →
  lokale/globale Action Codes → `dbWalletSelfCheck.run()`.
</details>

---

Viel Spaß mit deinem schnellen, minimalistischen Getränke-Wallet 🍹
