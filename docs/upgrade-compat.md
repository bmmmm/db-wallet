# Upgrade-Check: alter Stand → HEAD

## Zweck

`scripts/upgrade-check.js` misst, was beim Update von einem veröffentlichten
Stand auf HEAD zwischen alten und neuen Geräten und Tabs passiert: gemeinsamer
Speicher, QR/Link, JSON-Backup, Reihenfolge der Historie, der erste Start nach
dem Deploy (neue Seite, alte Skripte aus dem Service-Worker-Cache) und der
Update-Hinweis. Es misst und dokumentiert; es repariert nichts.

## Aufruf

```bash
node scripts/upgrade-check.js <alter-ref> [--new-root <dir>]
```

- `<alter-ref>` wird per `git archive <ref> | tar -x` in ein Temp-Verzeichnis
  entpackt (danach gelöscht). Neu ist die Arbeitskopie, mit `--new-root` ein
  anderes Verzeichnis.
- Ausgabe: eine Zeile `alt: … , neu: …`, dann eine Markdown-Tabelle
  `| ID | Pfad | Erwartung | Beobachtet | Klasse |`.
- Klassen: `OK`; `HINWEIS` = Verhalten ändert sich, keine Daten weg (auch: nicht
  gemessen); `DATENVERLUST` = eine Event-ID fehlt, die Summary weicht ab, ein
  Action Code oder die Löschliste fehlt, oder ein gelöschter Code ist da;
  `FEHLER` = das Szenario selbst warf, es wurde nichts gemessen.
- Exit: `1` bei mindestens einem `DATENVERLUST` oder `FEHLER`, `2` bei
  Bedienfehlern (kein Ref, unbekannter Ref), sonst `0`.
- Die Szenarien stehen in `scripts/scenarios-upgrade.js`
  (`runScenarios({ oldRoot, newRoot })`); `tests/upgrade-check.test.js` lässt
  sie gegen die Arbeitskopie auf beiden Seiten laufen (alles `OK`).

## Ergebnis 39efb6e → HEAD

Ausgabe von `node scripts/upgrade-check.js 39efb6e` (Exit 1). `44b1611` ist der
Kopf von `t3/umsetzung-offener-punkte`; seitdem ist keine App-Datei geändert.

alt: 39efb6e (39efb6e), neu: HEAD (44b1611)

| ID | Pfad | Erwartung | Beobachtet | Klasse |
| --- | --- | --- | --- | --- |
| S1 | Speicher: D vom alten Stand geschrieben, vom neuen geladen | IDs, Summary, Codes, Löschliste gleich | IDs 7/7; Summary gleich (0/7/0); lokale Codes 1/1; globale Codes 1/1; Löschliste 1/1; gelöschter Code nicht da | OK |
| S2a | Zwei Tabs: neu bucht/editiert/löscht Eintrag+Code, dann speichert der veraltete alte Tab | Events beider Tabs da, Löschliste da, gelöschter Code weg | neu lädt: IDs 11/11, Löschliste 2/2, gelöschter Code nicht da; alt lädt: IDs 11/11, Löschliste 2/2, gelöschter Code nicht da | OK |
| S2b | Zwei Tabs: alt bucht/editiert/löscht Eintrag+Code, dann speichert der veraltete neue Tab | Events beider Tabs da, Löschliste da, gelöschter Code weg | neu lädt: IDs 11/11, Löschliste 2/2, gelöschter Code nicht da; alt lädt: IDs 11/11, Löschliste 2/2, gelöschter Code nicht da | OK |
| S3a | QR/Link neu -> alt: D ohne Delete (mit Edit) | Import, IDs/Summary/lokale Codes gleich | Codec 2; Import ja; Speicher danach: 6 Events; IDs 6/6; Summary gleich (1/8/0); lokale Codes 1/1 | OK |
| S3b | QR/Link neu -> alt: D mit Delete | Import, IDs (mit Tombstone)/Summary gleich | Codec 3; Import nein; Fehlercode unsupported-version; Meldung „Import fehlgeschlagen ❌ — die Daten stammen aus einer neueren App-Version.“; Speicher danach: kein Wallet; Quelle unverändert | HINWEIS |
| S3c | QR/Link neu -> alt: globaler Code (Export aus S3a) | globaler Code kommt an (ID, Label, Betrag, Typ, ohne Key) | globale Codes 1/1 | OK |
| S3d | QR/Link neu -> alt: Löschliste (Export aus S3a auf ein Gerät, das den gelöschten Code schon hat) | Löschliste kommt an, gelöschter Code verschwindet | Löschliste fehlt (1 von 1); gelöschter Code da (1) | DATENVERLUST |
| S4 | QR/Link alt -> neu: D mit Delete, alter Encoder, neuer Import | IDs (mit Tombstone), Summary, Codes gleich, gelöschter Code bleibt weg | Codec 2; Import ja; IDs 7/7; Summary gleich (0/7/0); lokale Codes 1/1; globale Codes 1/1; gelöschter Code nicht da | OK |
| S4-dc | QR/Link alt -> neu: Löschliste (Export aus S4 auf ein Gerät, das den gelöschten Code schon hat) | Löschliste kommt an, gelöschter Code verschwindet | Löschliste fehlt (1 von 1); gelöschter Code da (1) | DATENVERLUST |
| S5 | Reihenfolge: D + devB in derselben Minute + Edit auf den Vortag, alt vs. neu auf einem Speicher | gleiche Reihenfolge und Summary | Reihenfolge weicht ab: alt devA.8 devA.6 devB.1 devA.3 devA.4, neu devA.8 devA.6 devA.3 devB.1 devA.4; Summary gleich (0/8/0) | HINWEIS |
| S6-sw | Erster Start nach dem Deploy: alter service-worker.js (Cache aus dem alten Install) beantwortet die neue Seite | wallet.html neu (Netz); Skripte/CSS aus dem alten APP_SHELL alt (Cache), andere neu | wallet.html neu; alt (Cache): 23 Dateien inkl. style.css, themes.css; neu (Netz): action-codes-ui.js | OK |
| S6-css | Mischstand: Darstellung der neuen wallet.html | Layout wie im neuen Stand | nicht gemessen: Fake-DOM ohne CSS/Layout; style.css (anders als im neuen Stand) kommt aus dem alten Cache | HINWEIS |
| S6-boot | Erster Start nach dem Deploy: neue wallet.html, Skripte aus dem alten APP_SHELL alt, sonst neu (action-codes-ui.js); Speicher mit D vom alten Stand | keine Exception, Wallet sichtbar (#uid) | Exceptions: keine; #uid „max“ | OK |
| S6-buchen | Mischstand: Drink-Button, dann Rückgängig | Drink bucht ein Event, Rückgängig einen Tombstone | Drink +1 Event (t d); Rückgängig +1 Tombstone | OK |
| S6-qr | Mischstand: Export -> Link + QR | QR gezeichnet | QR nicht gezeichnet; Nutzer sieht: alert „QR-Code konnte nicht erzeugt werden (QR-Bibliothek fehlt). Du kannst den Export-Link trotzdem kopieren.“; Button „Link“ liefert einen #import:-Link; Link im QR-Feld: nein | HINWEIS |
| S6-codes | Mischstand: Action-Code-Panel öffnen | 2 Karten mit QR | QR auf 0 von 2 Karten gezeichnet; Karte zeigt „QR-Code-Generator fehlt (qrcodegen.js).“ | HINWEIS |
| S6-laden | Speicher nach dem Mischstand, vom neuen Stand geladen | vollständig ladbar, Summary wie alt | IDs 9/9; Summary gleich (0/7/0); lokale Codes 1/1; globale Codes 1/1; Löschliste 1/1 | OK |
| S6b | Nach „Aktualisieren“: derselbe Speicher, alles neu | Boot ohne Exception, Buchung geht | Exceptions: keine; #uid „max“; Drink +1 Event | OK |
| S7 | Update-Hinweis: altes sw-register.js mit Controller, controllerchange | „Neue Version verfügbar.“ + Button, Klick lädt neu | „Neue Version verfügbar.“ in eigener Leiste + Button „Aktualisieren“; Klick: 1 Neuladen (pageLoads) | OK |
| S8a | JSON-Backup alt -> neu (Export -> JSON -> buildImportedWallet/saveWallet) | IDs, Summary, Codes, Löschliste gleich; gelöschter Code verschwindet | Gerät mit dem Code: Löschliste fehlt (1 von 1); Gerät mit dem Code: gelöschter Code da (1); Backup über Export -> JSON; IDs 7/7; Summary gleich (0/7/0); lokale Codes 1/1; globale Codes 1/1 | DATENVERLUST |
| S8b | JSON-Backup neu -> alt (walletBackupData -> buildImportedWallet/saveWallet) | IDs, Summary, Codes, Löschliste gleich; gelöschter Code verschwindet | Gerät mit dem Code: Löschliste fehlt (1 von 1); Gerät mit dem Code: gelöschter Code da (1); Backup über walletBackupData; IDs 7/7; Summary gleich (0/7/0); lokale Codes 1/1; globale Codes 1/1 | DATENVERLUST |

Summary-Werte stehen als unpaid/total/credit.

## Bewertung für diesen Release

Exit `1` gegen 39efb6e kommt allein aus den vier Zeilen zur Löschliste der
Action Codes (S3d, S4-dc, S8a, S8b). Das ist eine Grenze von 39efb6e, kein
Fehler des neuen Stands:

- 39efb6e exportiert die Liste nicht, weder im QR/Link (kein `dc`-Block) noch
  im JSON.
- Beim Import liest 39efb6e sie nicht (`buildImportedWallet` filtert nur mit der
  lokalen Liste). Die damalige `CLAUDE.md` nennt sie ausdrücklich „local-only,
  not exported“.

Events, Summary und alle nicht gelöschten Codes kommen in allen vier Zeilen
vollständig an. Folge im Mischbetrieb: Ein auf einem Gerät gelöschter Code
bleibt auf einem Gerät der anderen Version sichtbar, bis er dort ebenfalls
gelöscht wird. Zwischen zwei neuen Ständen reist die Löschung mit; das prüft
`tests/upgrade-check.test.js` (alt = neu, alle Zeilen `OK`).

Für den nächsten Release ist der veröffentlichte Stand dieser hier; dann
müssen die vier Zeilen `OK` sein.

## Was der Nutzer sieht

**S3b (QR/Link neu → alt, mit Löschung).** Ein Export mit mindestens einer
Löschung trägt Codec 3. Öffnet ein Gerät mit 39efb6e den Link, erscheint
„Import fehlgeschlagen ❌ — die Daten stammen aus einer neueren App-Version.
Bitte diese App aktualisieren.“; das Gerät speichert nichts, das sendende Gerät
bleibt unverändert. Ohne Löschung (S3a, Codec 2) läuft der Import durch.

**S3d (Löschliste neu → alt).** Hat das alte Gerät einen Action Code schon
(aus einem früheren Import) und wurde er auf dem neuen Gerät gelöscht, zeigt
das alte Gerät ihn nach dem Import des neuen Links weiter an; seine Löschliste
bleibt leer. Buchungen, Summary und die übrigen Codes kommen an (S3a, S3c).

**S4-dc (Löschliste alt → neu).** Der Link von 39efb6e enthält keine
Löschliste (der alte Encoder schreibt keinen `dc`-Block). Ein neues Gerät, das
den Code schon hat, zeigt ihn nach dem Import weiter an. Buchungen inklusive
Löschungen, Summary und Codes kommen vollständig an (S4).

**S5 (Reihenfolge).** Zwei Einträge verschiedener Geräte in derselben Minute
stehen auf einem alten und einem neuen Gerät in anderer Reihenfolge: alt nach
Millisekunden (`devB.1` vor `devA.3`), neu nach Minute und Root-ID (`devA.3`
vor `devB.1`). Die Summary ist gleich. Das alte Log nummeriert die Zeilen in
dieser Reihenfolge (`formatLogLine`).

**S6-css (Darstellung im Mischstand).** Der alte Service Worker liefert die neue
`wallet.html` mit der `style.css` aus dem alten Cache; die neue `style.css`
unterscheidet sich. Wie die Seite damit aussieht, misst der Fake-DOM nicht.

**S6-qr (Export-QR im Mischstand).** Die neue Seite lädt `qrcodegen.js` nicht
mehr, das alte `wallet-export-ui.js` aus dem Cache erwartet die Bibliothek
global. Nach „Link + QR“ erscheint „QR-Code konnte nicht erzeugt werden
(QR-Bibliothek fehlt). Du kannst den Export-Link trotzdem kopieren.“; ein QR
erscheint nicht. Der Button „Link“ liefert einen `#import:`-Link (das alte
JSON-Linkformat).

**S6-codes (Action-Code-Panel im Mischstand).** Das neue `action-codes-ui.js`
kommt zwar vom Netz, steigt aber an seiner Abhängigkeitsprüfung aus, weil dem
alten `wallet-helpers.js` aus dem Cache `loadQrLibrary` fehlt. Es bleibt das
alte Panel aus dem alten `action-codes.js`: Es zeigt beide Codes, aber auf
keiner Karte einen QR, sondern „QR-Code-Generator fehlt (qrcodegen.js).“. Buchen, Rückgängig und das Laden des Speichers funktionieren
im Mischstand (S6-buchen, S6-laden); nach „Aktualisieren“ ist alles neu (S6b).

**S8a (JSON-Backup alt → neu).** Das JSON aus „Export → JSON“ von 39efb6e hat
kein Feld `deletedActionCodes`. Ein neues Gerät importiert Buchungen, Summary
und Codes vollständig; einen dort schon vorhandenen, auf dem alten Gerät
gelöschten Code zeigt es weiter an.

**S8b (JSON-Backup neu → alt).** Das neue Backup enthält `deletedActionCodes`,
der Import von 39efb6e (`buildImportedWallet`) nutzt nur die eigene Löschliste.
Buchungen, Summary und Codes kommen an; ein auf dem alten Gerät schon
vorhandener, auf dem neuen gelöschter Code bleibt dort sichtbar.

## Aufbau

- **Datensatz D:** Wallet `max`, Gerät `devA`. Credit 5 (`g`) zwei Tage vorher;
  Drinks d1 (2) und d2 (3) in derselben Minute, ein Pay, d3 (1) danach; ein Edit
  (d1 → 4, gleicher `ts`), ein Delete (d3); ein lokaler Code „Lokal“, ein
  globaler „Global“, ein Code „Weg“, der per `removeActionCode` gelöscht ist.
  Summary 0/7/0.
- **Schreiben** immer mit der API der schreibenden Version:
  `dbWalletStorage.newEvent`/`appendEvents`, Delete über
  `buildTombstoneEvent` + `appendEvents`, Codes über `dbWalletActionCodes`.
  Entsprechungen in 39efb6e, wo die Funktion fehlt:
  - Edit: `newEvent` kennt dort kein `{ supersedes }`; wie das alte
    `editEntry` bekommt das neue Event `supersedes` und `ts` gesetzt.
  - Lokaler Code: `buildActionCode` + `push` + `ensureWalletActionCodes` +
    `saveWallet` (wie das alte Panel); neu: `createActionCode`.
  - Globaler Code: `buildGlobalCode` ist dort nicht exportiert; derselbe
    Datensatz (`id: "global:" + randomToken(10)`, Label, Betrag, Typ) läuft
    durch `normalizeGlobalActionCodes`.
  - JSON-Backup: `walletBackupData` fehlt; das Backup kommt aus „Export → JSON“
    der alten `wallet.html` (`exportJsonData` in `wallet-ui.js`).
- **Zeit:** In jedem vm-Kontext sind `Date.now()` und `new Date()` auf feste
  Zeitpunkte ab 2026-11-10 12:00 UTC gesetzt; jeder Lauf druckt dieselbe Tabelle.
- **Empfänger** (S3, S4, S8) ist ein frisches Gerät `devR`. Für die Löschliste
  (S3d, S4-dc, S8) hat das Empfangsgerät vorher den Export von vor dem Löschen
  des Codes importiert, hat den Code also schon.
- **Link-Import:** `tryImportFromHash` der empfangenden Version, ohne
  `import-preview.js` (speichert direkt). **JSON-Import:** der DOM-freie Teil von
  `index-ui.js` `importJsonFile`: `buildImportedWallet`, `ensureDeviceSeq`,
  `saveWallet({ quiet: true })`.
- **S2:** zwei Tabs auf einem Speicher, beide `devA`. Der erste bucht, editiert
  d2, löscht den Credit und den Code „Lokal“; dann speichert der veraltete
  andere Tab eine Buchung. Danach laden beide Versionen den Speicher.
- **S5:** D (neuer Stand) plus eine Buchung von `devB` in der Minute von d1/d2
  und ein Edit, der den Credit einen Tag früher legt (über keinen Pay).
  Verglichen wird `computeSummarySafe(...).eventsSorted` ohne Tombstones (die
  Grundlage von Historie und Log) und die Summary.
- **S6:** `bootWalletPage` mit der neuen `wallet.html`; jedes Skript aus dem
  `APP_SHELL` der alten `service-worker.js` (aus der Datei gelesen) kommt aus dem
  alten Stand, jedes andere aus dem neuen. S6-sw lässt den alten Service Worker
  selbst in einem vm-Kontext installieren und die Anfragen der neuen Seite
  beantworten (Netz liefert neu, Cache alt) und prüft das gegen den
  `APP_SHELL`. Fehler beim Laden eines Skripts und in Listenern auf
  `window`/`document` werden je Datei aufgezeichnet statt geworfen.
- **S7:** altes `sw-register.js` auf der neuen Seite, mit vorhandenem
  Controller, dann `controllerchange`.
- **Harness:** `makeEnv({ root })` liest die Module aus `root`;
  `bootWalletPage({ root, html, scriptSource })` nimmt Seite und Skripte aus
  einem anderen Stand. Ohne die Optionen verhalten sich beide wie vorher.

## Nicht gemessen

- **Darstellung** (S6-css): Der Fake-DOM hat kein CSS und kein Layout.
- **`theme.js`, `import-preview.js`, `self-check-loader.js`** laufen im
  Seiten-Harness nicht (`tests/wallet-page.js` überspringt sie); `sw-register.js`
  nur getrennt in S7. Der Import-Dialog (Vorschau oder Speichern) ist damit in
  keinem Szenario dabei.
- **Lebenszyklus des Service Workers im Browser:** wann der neue SW installiert,
  `skipWaiting`/`clients.claim` und `controllerchange` auslöst, HTTP-Cache und
  Netz-Timeout. S6-sw prüft nur, welche Datei der alte SW nach seinem Install
  aus dem Cache und welche aus dem Netz beantwortet.
- **Startseite** (`index.html`) im Mischstand und der Inhalt des alten
  `#import:`-Links.
- **Echtes Gerät:** native `alert`/`confirm`, Teilen-Blatt, installierte PWA.
