# db-wallet 🍹

> Getränke-Wallet für den Browser — **kein Backend, kein Server**, alles lokal.

Leichtgewichtiges Drink-Tracking für die Crew vom Hackspace
[bitcircus101.de](https://bitcircus101.de) und der
[Datenburg e.V. Bonn](https://datenburg.org/). Alle Daten liegen im
`localStorage`; synchronisiert wird über Export/Import (Link, QR, JSON) — ganz
ohne Cloud.

**→ [Live-Demo](https://bmmmm.github.io/db-wallet/)** &nbsp;·&nbsp; kein Framework · kein Build · kein npm · PWA

## Schnellstart

1. `index.html` öffnen: oben stehen die Wallets dieses Geräts (Öffnen/Löschen);
   darunter einen Namen eingeben (oder leer lassen für Zufall) →
   `wallet.html#<name>`. Ein vorhandener Name öffnet dieses Wallet, Umlaute
   werden ausgeschrieben („Jörg“ → `joerg`); die Zeile unter dem Feld sagt
   vorher, was „Weiter“ tut.
2. Getränke buchen, bezahlen, Guthaben aufladen.
3. Zum Übertragen: auf einem Gerät **Export → „QR-Code anzeigen"**, auf dem anderen
   scannen — der Merge passiert automatisch.

> Theme lässt sich am Seitenende wählen und wird gespeichert.

## Update

Neue Versionen kommen von selbst, sobald die App mit Internet geöffnet wird. Die
Daten bleiben dabei im Browser, ein Update löscht nichts. Was sich geändert hat,
steht in [CHANGELOG.md](CHANGELOG.md).

1. App (oder die Seite im Browser) mit Internet öffnen.
2. Nach ein paar Sekunden erscheint unten **„Neue Version verfügbar.“**. Dort
   auf **„Aktualisieren“** tippen (bei späteren Updates heißt der Knopf
   „Neu laden“).
3. Erscheint kein Hinweis: die App ganz schließen (auch aus der App-Übersicht
   wegwischen) und wieder öffnen; im Browser die Seite neu laden.

Bis zum Tippen auf „Aktualisieren“ ist die Seite ein Mischstand: die neue Seite
mit Skripten und Styles der alten Version aus dem Cache. Sie kann unfertig
aussehen; Buchen geht, die Zahlen stimmen, aber besser erst aktualisieren.

**Mehrere Geräte:** erst **alle** Geräte aktualisieren, dann Links oder QR-Codes
austauschen.

- **Import scheitert:** Zeigt ein Gerät „Import fehlgeschlagen ❌ — die Daten
  stammen aus einer neueren App-Version“, dieses Gerät aktualisieren und den
  Link oder QR danach noch einmal öffnen. Es wurde nichts importiert und nichts
  geht verloren. Das passiert bei jedem Export, der gelöschte Einträge enthält.
- **Gelöschte Action Codes:** Die Löschung reist erst zwischen zwei
  aktualisierten Geräten mit. Ein vorher gelöschter Code muss auf dem anderen
  Gerät einmal von Hand gelöscht werden.
- **Reihenfolge:** Solange noch ein altes Gerät im Spiel ist, können Einträge
  aus derselben Minute dort in anderer Reihenfolge stehen. Die Summen sind
  gleich.

Gemessen ist das mit `scripts/upgrade-check.js`, Ergebnis und Einzelheiten in
[`docs/upgrade-compat.md`](docs/upgrade-compat.md).

## Features

- **Buchen & Korrigieren** — Drinks zählen (höchstens 99 je Buchung, ab 20 mit
  Rückfrage; Enter im Mengenfeld bucht), letzte Buchung rückgängig (als
  syncbarer Löschmarker), Tagesstatistik mit Diagramm/Log/Raw. Jede Buchung
  meldet sich in der Statuszeile am unteren Rand („+1 gebucht · Offen: 4“) mit
  „Rückgängig“ für genau diese Buchung; Fehler stehen dort ebenfalls.
- **Bezahlen & Guthaben** — „Alle N offenen bezahlen“ gleicht die offenen Drinks
  aus, Guthaben (höchstens 999 auf einmal, im Formular unter „Guthaben
  aufladen“) wird wie ein Vorrat auf- und abgebaut.
- **Verwaltung** — in der „Historie“ steht jeder Eintrag in einer eigenen Zeile;
  mit „Einträge bearbeiten oder löschen“ bekommt jede Zeile „Bearbeiten“ (Datum
  und Menge im Formular) und „Löschen“. Rückfragen kommen in einem Dialog.
  Nutzer:innen einzeln oder gesammelt entfernen — die Rückfrage bietet vorher
  ein JSON-Backup an (über „JSON importieren“ zurückholbar). Zurücksetzen macht daraus ein neues Wallet mit gleichem
  Namen (neue Wallet-ID): ein vorher gemachter Export landet beim Import als
  eigenes Wallet, lokale Action-Code-QRs des alten Wallets gelten nicht mehr.
- **Import/Export** — Link (auto-merge), kompakter QR-Code oder JSON; inklusive
  Theme und Wallet-ID gegen Namens-Kollisionen. Der Link ist ein Schlüssel zum
  ganzen Wallet: das erste „Teilen“ auf einem Gerät sagt das, bevor es teilt.
  Öffnet ein gescannter Link im Browser statt in der installierten App, lässt
  er sich auf deren Startseite unter „Link einfügen“ übernehmen (Export-Links
  und Action Codes; der Host darf abweichen).
- **Offline-fähig** — als PWA installierbar, läuft ohne Netz.

## Action Codes (QR)

Vorgefertigte QR-Codes, die beim Scannen **sofort** buchen — Typ *Trinken* oder
*Guthaben*, mit zwei Scopes:

- 🔒 **Lokal** — an eine Wallet gebunden (die Ziel-WalletId steckt im QR).
- 🌍 **Global** (`#acg:…`) — der QR ist self-contained und deterministisch, wirkt
  auf das gerade geöffnete Wallet. Beim Anwenden fragt die App **immer nach**
  (Betrag/Typ werden genannt); bei mehreren Wallets wird zuerst das Ziel gewählt,
  ist keins offen, kommt ein Hinweis. Die Verwaltungsliste globaler Codes wird auf
  dem Wallet gespeichert und reist im Export mit (ohne Key — globale Codes haben
  keinen; Scope bleibt beim Import erhalten).

Gut zu wissen:

- **Betrag und Typ** werden aus dem **gespeicherten** Code gelesen, nie aus
  manipulierbaren QR-Feldern.
- Bearbeiten (Name/Menge/Typ) erneuert den **Key** lokal — **alte QR-Codes werden
  beim Einlösen strikt abgelehnt**. Ein Import kann Label/Menge/Typ aktualisieren,
  aber **nie den lokalen Key** überschreiben.
- Codes **laufen nicht ab** — Widerruf = Bearbeiten (Key-Rotation) oder Löschen;
  der Key ist das einzige Geheimnis.
- Löschen merkt sich die Code-ID (`deletedActionCodes`, die 50 neuesten).
  Ein anderer Tab oder ein Import eines älteren Exports holt den Code nicht zurück.
  Die Liste reist im Export mit (QR/Link und JSON): importiert ein anderes Gerät
  den Export, verschwindet der Code auch dort.
- Max. 6 Codes pro Wallet empfohlen; ab 10 bleiben die 10 zuletzt **bearbeiteten**
  (nicht „benutzten").
- Globale Codes validieren Typ (`d`/`g`) und Menge (`1`–`100`).

> **Export = Bearer-Credential:** QR/Link enthalten das volle Event-Log, die
> userId und die Action-Code-Keys **unverschlüsselt**. Wer den Code abfotografiert,
> kann ihn einspielen. Nur an vertrauenswürdige Geräte weitergeben.

## Sync & Geräte

Rein lokale Anzeige, **kein Hintergrund-Sync** — synchronisiert wird
ausschließlich über Export/Import. Gezählt werden **Events**: 1 Event = 1 Schritt,
egal ob `+1` oder `+10`. Die Sync-Zeile erscheint erst, wenn es einen Sync-Partner
gibt, also nach dem ersten Import von einem anderen Gerät; ein frisches Wallet
(oder eins, das nur exportiert wurde) zeigt sie nicht.

| Ampel | Bedeutung |
|-------|-----------|
| ✅ Grün | aktuell (≤ 5 Tage) |
| ⚠️ Gelb | älter (6–10 Tage) |
| 🛑 Rot | veraltet (≥ 11 Tage) — „Zum Export“ (oder ein Klick auf die Zeile) springt zum Export |

Der Button **„✅ passt"** setzt den Sync-Stand manuell auf „gleich" (Vertrauens-
Reset auf diesem Gerät, ohne Export/Import).

Pro Wallet gibt es zudem eine synchronisierte **Geräte-Liste** (Symbol
`L/M/D/K/T/*`, `lastSeenAt`), die bei Export/Import deterministisch gemerged wird:
max. 6 Geräte (älteste fallen raus), jedes Symbol pro Wallet eindeutig, gesetzt
im Kopfbereich über „Gerät: wählen“ (die Auswahl erklärt, wofür das Zeichen steht,
und zeigt die Geräte-ID).

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

**Tests in Node** (ohne npm, nur `node:test`; läuft auch in der CI):

```bash
node --test tests/
```

Die Tests laden die Originalmodule in einen `vm`-Kontext mit eigenem
`localStorage` (`tests/harness.js`) und prüfen Datenschicht, Codec, Import und
das Action-Code-Panel.

**Self-Check** in der Browser-Konsole auf `wallet.html` (der erste Aufruf lädt
`self-check.js` nach):

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
Delete/Undo hängen einen Tombstone an (`t:"x"`, `ref` = **Root-ID** des Eintrags).
**Edit** hängt einen Replacement mit `supersedes` = Root-ID an (kein Tombstone) —
der Summary-Fold kollabiert alle Replacements einer Root auf den kanonisch
letzten Gewinner, sodass parallele Edits auf zwei Geräten konvergieren statt zu
doppeln; eine Löschung der Root gewinnt gegen einen parallelen Edit. Ein Event
wird **nie** in-place geändert — der Merge dedupliziert strikt nach `id`.
Reihenfolge: nach der Minute von `ts`, dann nach Root-ID, dann nach ID (Gerät,
dann numerische base36-`seq`, nicht lexikalisch) — so sortiert jedes Gerät gleich.
Undo ist **monoton** (entfernt den letzten sichtbaren Eintrag) und
fragt nach, wenn die letzte Aktion eine Löschung war.

**Core (Logik / Codec / Storage):**

| Datei | Rolle |
|-------|-------|
| `wallet-helpers.js` | Base64URL, gzip, IDs, Hashing; kanonischer Event-Comparator + `DEVICE_SYMBOLS` |
| `wallet-storage.js` | localStorage, deviceKey, Geräte-Liste, Wallet-Registry |
| `wallet-import-v2.js` | Binär-Codec v2 (encode/decode), Import-Merge, Action-Code-Einlösung |
| `wallet-summary.js` | Total / Offen / Guthaben / Diagramm (pure) |
| `wallet-sync.js` | Sync-Ampel + ASCII-Timeline (lokal) |
| `action-codes.js` | Action Codes: Normalisierung, Merge, Hash-Codec, Löschliste, Änderungen als reine Funktionen |
| `action-codes-ui.js` | Action-Code-Panel (DOM, nur `wallet.html`) |
| `hash-router.js` | Hash-Parsing (`#<name>`, `ac` / `acg` / `import` / `i2` / `i2u`) |
| `migration.js` | Migration v1 → v2, still beim Laden und beim Import (ohne Rückfrage) |

**UI:**

| Datei | Rolle |
|-------|-------|
| `index-ui.js` | Startseite (Wallet-Liste, Öffnen/Anlegen, Link einfügen, Import, Löschen mit Backup) |
| `wallet-ui.js` | Wallet-Composer (DOM-Wiring, Hash-Routing, Module initialisieren) |
| `wallet-actions.js` | Buchungen (Drink/Undo/Pay/Credit/Reset/Delete/Edit) |
| `wallet-history-ui.js` | Verlauf (Diagramm, Historie als Zeilen mit Bearbeiten/Löschen, Raw) |
| `wallet-device-ui.js` | Geräte-Symbol-Picker (Kopfbereich, beschriftet) |
| `wallet-sync-ui.js` | Sync-Zeile (Ampel, Timeline, „✅ passt", „Zum Export"; nur mit Sync-Partner) |
| `wallet-export-ui.js` | Export (Link/QR/JSON, PNG-Download) |
| `wallet-hash-actions.js` | Wallet-Auswahl bei globalen Action Codes |
| `wallet-messages.js` | Hinweisblock unter dem Seitenkopf (kein Wallet offen, Speicherfehler) |
| `import-preview.js` + `preview.html` | Read-Only-Import-Vorschau (lokal, nicht gespeichert) |
| `theme.js` + `themes.css` | Theme-System (5 Paletten) |

**PWA:** `manifest.json`, `service-worker.js`, `sw-register.js` &nbsp;·&nbsp;
**Tools:** `self-check.js` (+ `self-check-loader.js`) &nbsp;·&nbsp;
**QR:** `qrcodegen.js` (Nayuki), erst beim ersten QR nachgeladen (Export, offenes Action-Code-Panel)

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
  Nginx/Caddy — nur die App-Dateien ausliefern, nicht den Repo-Root: die Liste
  steht in der `cp`-Zeile von `.github/workflows/pages.yml` (`*.js`, `*.html`,
  `*.css`, Manifest, Icons, `LICENSE`, `NOTICE`). `tests/`, `scripts/`, `docs/`
  und die Markdown-Dateien gehören nicht auf den Server.

**Cache-Invalidierung:** beim Release `VERSION` in `service-worker.js` erhöhen —
alte Caches werden beim nächsten Besuch aufgeräumt. Der SW schreibt nur
`200`/`basic`-Responses in die App-Shell, damit Fehler- oder Redirect-Seiten den
Cache nicht vergiften.
Vor dem Push auf `main`: `node scripts/upgrade-check.js <veröffentlichter Commit>` (siehe `docs/upgrade-compat.md`).
</details>

<details>
<summary>Notizen für LLMs / Agents</summary>

Invarianten, Codec-Regeln, Gotchas und die Test-Harness stehen in
[`CLAUDE.md`](CLAUDE.md) — dort, nicht hier, pflegen.
</details>

## Lizenz

Lizenziert unter der [Apache License 2.0](./LICENSE).

---

Viel Spaß mit deinem schnellen, minimalistischen Getränke-Wallet 🍹
