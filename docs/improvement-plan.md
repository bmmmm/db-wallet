# db-wallet: Verbesserungsplan (Stand 2026-11-09, Basis `ff68cd5`)

Dieser Plan ist zum Abarbeiten durch einen Agenten geschrieben. Er beruht auf einer
vollständigen Durchsicht des Codes (Datenschicht, Codec, Action Codes, UI, CSS, PWA)
und auf Nachstellungen in Node gegen die Originaldateien.

## Kurzfassung

Die App ist solide gebaut, hat aber sieben bestätigte Fehler in der Datenschicht, von
denen zwei Daten verfälschen und einer eine dokumentierte Sicherheitszusage bricht
(„Widerruf = Löschen“ funktioniert nicht). Ursache ist fast immer dieselbe Stelle:
`saveWallet` gleicht bei jedem Schreiben mit dem gespeicherten Stand ab, und für alles
außer Events gibt es kein Löschmodell. Diese Fehler stammen teils aus der letzten
Fix-Welle (`c07723c`) und sind durchgerutscht, weil die Testsuite nur im Browser läuft
und keine Abläufe aus Laden, Speichern und erneutem Laden prüft.

Daraus folgt die Reihenfolge: erst ein Testfundament, das in der CI läuft (Phase 0),
dann die Datenfehler (Phase 1), dann Navigation und Fehlerpfade (Phase 2), dann
risikoarme Verbesserungen an Oberfläche und PWA (Phase 3). Der größere Umbau der
Bedienung (Phase 4) und Strukturarbeit (Phase 5) kommen danach.

Die Rechenleistung der Datenschicht ist kein Problem: Bei 2 000 Events kostet eine
Buchung in Node etwa 6 ms Speichern plus 7 ms Summary, bei 10 000 Events etwa 27 ms
plus 31 ms. Die echte Skalierungsgrenze ist der QR-Export (etwa 590 Events).

## Fortschritt

Beim Abarbeiten hier abhaken und pro Paket den Commit notieren.

- [x] P0.1 Node-Testlauf mit Harness (1791157)
- [x] P0.2 Testlauf in der CI, Pages-Deploy hängt daran (2b48f24)
- [x] P1.1 Event-Normalisierung an einer Stelle, Mengen-Obergrenze (d368d87)
- [x] P1.2 Löschmodell für Action Codes (12e1290)
- [x] P1.3 Globale Action Codes überleben den Import (132042b)
- [x] P1.4 Action-Code-Panel liest globale Codes immer vom Wallet (e3f3572)
- [x] P1.5 `supersedes` bei Migration und Import umhängen (cf87098)
- [x] P1.6 Reset vergibt keine alten Event-IDs neu (bd22321)
- [x] P1.7 Import meldet Speicherfehler (6b92f3f)
- [x] P1.8 `syncPeers` gegen `__proto__` härten (50a09aa)
- [ ] P2.1 `replaceState` statt `location.hash` in Buchungs- und Importpfaden
- [ ] P2.2 Sackgassen in `wallet.html` schließen
- [ ] P2.3 Importfehler mit Fehlercode, Abbruch führt zurück ins offene Wallet
- [ ] P2.4 `legacyIdToV2Id` früh beenden
- [ ] P2.5 QR zu groß: kompakten Link anbieten
- [ ] P3.1 Theme: Standard, Kontrast, Fokus, `theme-color`
- [ ] P3.2 CSS-Grundlagen für Touch und Lesbarkeit
- [ ] P3.3 CSP ohne `'unsafe-inline'`
- [ ] P3.4 PWA: Icons und Service-Worker-Strategie
- [ ] P3.5 `self-check.js` bei Bedarf nachladen
- [ ] P3.6 Export: Kopieren, Teilen, scharfer QR
- [ ] P3.7 Englische Reststrings eindeutschen
- [ ] P4 Bedienung (erst nach Freigabe, siehe dort)
- [ ] P5 Struktur und Skalierung (einzeln nach Bedarf)

## Arbeitsregeln

1. **Reihenfolge.** P0 → P1 → P2 → P3 können ohne Rückfrage abgearbeitet werden; die
   Voreinstellungen unter „Entscheidungen“ gelten, solange nichts anderes gesagt wird.
   Vor P4 anhalten und die Freigabe einholen, weil sich dort das Aussehen der App
   ändert. P5 besteht aus unabhängigen Paketen.
2. **Ein Paket, ein Commit** (oder eine kleine Serie). Commit-Stil wie bisher im Repo:
   englisch, `fix(storage): …`, `feat(ui): …`. Keine `Co-Authored-By`- oder
   „Generated with“-Zeilen.
3. **Erst der Test, dann die Korrektur.** Für jedes P1- und P2-Paket zuerst den
   Regressionstest schreiben und rot sehen (die Fälle stehen in Anhang A), dann
   korrigieren. Ein Test, der nie rot war, belegt nichts.
4. **Service Worker.** Ändert ein Paket eine Datei aus `APP_SHELL`, muss `VERSION` in
   `service-worker.js` steigen. Der Guard vergleicht `base..HEAD`, ein Bump pro Branch
   reicht. Prüfen mit `bash scripts/check-sw-version.sh main`. Neue Dateien, die eine
   Seite lädt, gehören in `APP_SHELL`; `pages.yml` kopiert nur `./*.js ./*.html ./*.css
   manifest.json favicon.svg NOTICE LICENSE`, alles andere braucht dort einen Eintrag.
5. **Invarianten aus `CLAUDE.md` gelten weiter:** Events sind append-only, Events
   entstehen nur über `dbWalletStorage.newEvent`/`appendEvents`, die Skript-Reihenfolge
   in `wallet.html` ist tragend, neue Codec-Blöcke stehen vor `ck` und nach allen
   bisherigen. Ändert ein Paket eine Invariante oder führt eine neue ein (P1.2, P1.6),
   `CLAUDE.md` und den Architekturteil der `README.md` im selben Commit anpassen.
6. **Prüfen.** Logik über `node --test tests/` (ab P0.1). Was nur im Browser prüfbar
   ist (Layout, Service Worker, Dialoge), braucht `await dbWalletSelfCheck.run()` auf
   `wallet.html` und einen Blick auf die Seite; die Fallstricke dazu stehen in
   `CLAUDE.md` unter „Local Dev“. Auf garage ist Loopback für den Account gesperrt, ein
   lokaler `http.server` ist dort nicht erreichbar. Steht in der Sitzung kein Browser
   zur Verfügung, das in der Übergabe so sagen und nicht als geprüft ausgeben.
7. **Nicht pushen, bevor Entscheidung E1 geklärt ist.** In diesem Checkout zeigt
   `origin` auf GitHub, `CLAUDE.md` beschreibt `origin` als Forgejo.

## Belegstufen

- **nachgestellt**: in Node gegen die Originaldateien reproduziert, Fall in Anhang A.
- **gelesen**: am Code nachvollzogen, nicht ausgeführt.
- **Review**: aus dem Review-Lauf übernommen (Messung in headless Chromium über
  `file://` oder im Node-Harness), hier nicht wiederholt. Vor der Umsetzung kurz
  gegenprüfen.

---

## Phase 0: Testfundament

### P0.1 Node-Testlauf mit Harness

Die Module sind `window.dbWalletX`-IIFEs ohne DOM-Zugriff beim Laden. Sie lassen sich
in einem `vm`-Kontext mit einem kleinen Browser-Ersatz laden (Skelett in Anhang A, so
im Review benutzt). Kein npm, kein Paketmanifest: `node:test`, `node:assert`, `node:vm`
genügen.

- Anlegen: `tests/harness.js` (liefert `makeEnv()` mit frischem `localStorage` pro
  Aufruf) und `tests/*.test.js`.
- Die Fälle aus Anhang A als Tests aufnehmen. Sie sind vor den Korrekturen rot; so
  lange mit `test.todo`/`{ todo: true }` markieren und im jeweiligen P1-Paket scharf
  schalten.
- Dazu einen Grundstock grüner Tests für das, was heute stimmt: Buchen, Bezahlen,
  Guthaben, Undo, Edit, Codec-Roundtrip (`encodeImportV2Bytes` → `decodeImportV2Bytes`
  → `buildImportedWallet`), Zwei-Tab-Kollision mit Re-Mint.
- `tests/` liegt nicht im Wurzelverzeichnis und wird deshalb nicht nach Pages kopiert.
- `CLAUDE.md` („Local Dev“) und `README.md` („Entwicklung“) um den Befehl ergänzen.

Fertig, wenn `node --test tests/` lokal läuft und die bekannten Fehler als offene
Todos ausweist.

### P0.2 Testlauf in der CI

- In `.github/workflows/sw-version.yml` einen zweiten Job `tests` ergänzen
  (`node --test tests/`, `timeout-minutes` setzen, Actions per Commit-SHA pinnen wie
  im Repo üblich, siehe `~/ops/reference/github-actions-pinning.md`). Node ist auf
  `ubuntu-latest` vorinstalliert.
- Weil `pages.yml` auf den Abschluss von `sw-version-guard` wartet, hängt der Deploy
  damit automatisch auch an den Tests. Den Workflow-Namen nicht ändern.

Später möglich, nicht Teil dieses Pakets: der echte In-Browser-Self-Check in der CI
über das auf dem Runner vorinstallierte Chrome.

---

## Phase 1: Datenintegrität und Sicherheit

### P1.1 Event-Normalisierung an einer Stelle, Mengen-Obergrenze

**Befund (nachgestellt, Fälle A2 und A3).** `loadWallet` normalisiert Events nur im
Speicher (`wallet-storage.js:469-518`: fehlendes `n` wird 1, String-`n`, `n` über 1e9
wird gekappt, `p` verliert `n`). `saveWallet` vergleicht danach mit dem rohen
gespeicherten Event (`sameEventContent`, `:569-580`), hält die Abweichung für eine
Zwei-Tab-Kollision, vergibt eine neue ID (`:715-725`) und mischt das rohe Event wieder
dazu. Jedes Öffnen des Wallets erzeugt eine weitere Kopie. Ausgelöst durch eine Menge
über 1 000 000 000 im Mengenfeld (eine Buchung mit 2 000 000 000 wird nach drei
Öffnungen zu vier Events) und durch importiertes JSON mit fehlendem oder
String-`n`. Normale Buchungen sind nicht betroffen (Kontrollfall bleibt bei 3 Events).

**Umsetzung.**
- Aus `loadWallet` eine reine Funktion `normalizeEvent(ev)` herauslösen (liefert ein
  normalisiertes Event oder `null`).
- In `saveWallet` den gespeicherten Stand vor dem Kollisionsvergleich und vor
  `mergeEvents` durch dieselbe Funktion schicken.
- In `buildImportedWallet` (`wallet-import-v2.js:1004`) die fremden Events mit
  derselben Funktion und einer Feld-Whitelist (`id, t, n, ts, ref, supersedes, oid`)
  übernehmen.
- Re-Mint nur für IDs des eigenen `deviceKey`. Eine echte Zwei-Tab-Kollision betrifft
  immer das eigene Gerät; bei fremden IDs gewinnt der gespeicherte Stand. Heute kann
  der Re-Mint eine ID im Sequenzraum eines fremden Geräts vergeben.
- Mengen an der Eingabe begrenzen: `getAmount` (`wallet-ui.js:896`), `bookCredit` und
  `editEntry` (`wallet-actions.js:132`, `:410`), `normalizeAmount`
  (`action-codes.js:17`). Die Konstante einmal in `wallet-helpers.js` definieren;
  heute steht sie doppelt (`MAX_EVENT_AMOUNT` in Storage, `MAX_DECODED_AMOUNT` im
  Codec). Ohne die Grenze speichert das Action-Code-Formular 1e20, und danach wirft
  jeder QR-Export in `writeVarUint` (nachgestellt: `normalizeAmount` gibt 1e20 zurück).

**Abnahme.** A2, A3 und der Kontrollfall grün. Ein Action Code mit Betrag
`"100000000000000000000"` wird gekappt und der Export funktioniert.

### P1.2 Löschmodell für Action Codes

**Befund (nachgestellt, Fall A1).** Löschen filtert den Code aus `wallet.actionCodes`
und ruft `saveWallet`. Dessen `reconcilePersistedFields` (`wallet-storage.js:604-649`)
vereinigt mit dem gespeicherten Stand, der den Code noch enthält, und schreibt ihn
zurück. Betroffen: Löschen lokaler und globaler Codes (`action-codes.js:796-815`), die
Umwandlung lokal ↔ global (`:719-756`, danach existieren beide) und das Kürzen auf
10 Codes. Die Zusage aus README und `CLAUDE.md`, Widerruf sei Bearbeiten oder Löschen,
gilt für das Löschen derzeit nicht: der gedruckte QR bucht weiter. Nach der Korrektur
bliebe eine zweite Lücke (gelesen): `mergeActionCodes` (`action-codes.js:247-253`)
nimmt jede unbekannte ID auf, ein Import vom Zweitgerät brächte den gelöschten Code
samt altem Key zurück.

**Umsetzung.**
- Am Wallet eine Löschliste führen, zum Beispiel
  `wallet.deletedActionCodes = { [codeId]: deletedAtMs }`, auf die jüngsten 50
  Einträge begrenzt. Jede Löschung und jede Umwandlung trägt die alte ID ein.
- `reconcilePersistedFields`: die Löschlisten beider Seiten vereinigen, dann nach der
  Vereinigung der Codes alle gelöschten IDs entfernen. Danach
  `ensureWalletActionCodes` und `ensureWalletDevices` erneut anwenden, damit die
  Obergrenzen auch nach der Vereinigung gelten.
- `mergeActionCodes` und der Import globaler Codes überspringen IDs aus der lokalen
  Löschliste.
- Ob die Löschliste auch im Export mitreisen soll, ist Entscheidung E4. Wenn ja: neuer
  Codec-Block nach `gc` und vor `ck`; alte Decoder brechen dort ab und überspringen
  dann auch die Prüfsumme, wie bei jedem unbekannten Block.
- `CLAUDE.md`-Gotcha zu Action Codes um das Löschmodell ergänzen.

**Abnahme.** A1 grün für lokale und globale Codes. Zusätzlich: Löschen, dann Import
eines Exports, der den Code noch enthält, lässt ihn gelöscht. Umwandlung lokal →
global hinterlässt genau einen Code. Der Zwei-Tab-Fall bleibt erhalten: Tab A legt
einen Code an, Tab B speichert mit altem Stand, der Code von A überlebt.

### P1.3 Globale Action Codes überleben den Import

**Befund (nachgestellt, Fall A4).** `normalizeActionCode` (`action-codes.js:161-183`)
kennt kein `scope`. Jeder Import, auch der Rückweg aufs Ursprungsgerät, schickt
`globalActionCodes` durch `mergeActionCodes` (`wallet-import-v2.js:1037-1046`); danach
fehlt `scope: "global"`. Laut Review zeigt die UI sie dann als lokale Codes mit einem
`ac:`-QR, dessen ID in `wallet.actionCodes` nicht existiert (Anzeige
`action-codes.js:894`; gelesen im Review, vor der Korrektur selbst prüfen). Außerdem
erfindet der Encoder bei jedem Export einen neuen Zufalls-Key pro globalem Code, obwohl
globale Codes keinen Key haben.

**Umsetzung.** Für globale Codes eine eigene Normalisierung, die `scope` erhält (oder
aus dem Präfix `global:` ableitet) und keinen Key verlangt. Im Encoder keinen Key
erfinden; das Feld im `gc`-Block leer schreiben, sofern das Format das zulässt, sonst
das Format so lassen und den Wert beim Decodieren verwerfen.

**Abnahme.** A4 grün: nach Export → Import auf einem zweiten Gerät und zurück hat der
Code `scope: "global"`, und zwei Exporte desselben Wallets sind bytegleich.

### P1.4 Action-Code-Panel liest globale Codes immer vom Wallet

**Befund (gelesen).** `initActionCodesUi` kopiert `globalActionCodes` einmal nach
`ctx.globalCodes` (`action-codes.js:1111-1118`). `persistGlobalCodes` (`:1075-1084`)
schreibt diese Kopie in das gerade offene Wallet. Nach einem Wallet-Wechsel ohne
Neuladen (Import-Link im offenen Tab, `ac:` für ein anderes Wallet, Reset) zeigt das
Panel die Codes des alten Wallets und schreibt sie bei der nächsten Änderung ins neue.

**Umsetzung.** Keine Kopie halten. `renderActionList` und alle Handler lesen
`ctx.getWallet().globalActionCodes`, Änderungen gehen direkt dorthin.

**Abnahme.** Test über die reinen Funktionen nach P5.1, bis dahin im Self-Check:
Wallet A mit globalem Code, Wechsel auf Wallet B, Code in B anlegen, B enthält nur den
neuen Code.

### P1.5 `supersedes` bei Migration und Import umhängen

**Befund (nachgestellt, Fall A5).** `migration.js:81-87` hängt nur `ref` von
Tombstones auf die neuen IDs um, nicht `supersedes`. Wird ein v1-Eintrag vor der
Migration bearbeitet, zeigt das Replacement danach ins Leere, Original und Replacement
zählen beide (im Test: Summe 2 vor der Migration, 7 danach). Dieselbe Lücke steht im
Import (`wallet-import-v2.js:1098-1108`).

**Umsetzung.** In beiden Schleifen `supersedes` genauso behandeln wie `ref`.

**Abnahme.** A5 grün, dazu der Importfall (Legacy-Edit in ein bereits migriertes
Wallet importieren).

### P1.6 Reset vergibt keine alten Event-IDs neu

**Befund (nachgestellt, Fall A6).** `resetWallet` (`wallet-actions.js:163-171`) behält
die `walletId` und setzt `seq` auf `{}`. Die nächste Buchung bekommt wieder
`<deviceKey>.1`. Hat ein Zweitgerät den alten Stand, verwirft es die neuen Buchungen
beim nächsten Sync als bekannt (Dedup nach `id`).

**Umsetzung.** Nach Entscheidung E2. Voreinstellung: Reset vergibt eine neue
`walletId`; das zurückgesetzte Wallet ist ein neues Wallet, alte Exporte mischen sich
nicht mehr hinein. Alternative: `walletId` und `seq` behalten, dann holt der nächste
Import vom Zweitgerät die alten Events zurück.

**Abnahme.** A6 grün: nach Reset wird keine früher vergebene ID wiederverwendet. Mit
der Voreinstellung zusätzlich: der Import eines alten Exports landet nicht im
zurückgesetzten Wallet.

### P1.7 Import meldet Speicherfehler

**Befund (nachgestellt).** `importRemoteWallet` ignoriert den Rückgabewert von
`saveWallet` (`wallet-import-v2.js:1181`). Bei vollem Speicher folgt auf die
Fehlermeldung direkt „Getränkedaten importiert ✅“ und der Wechsel auf ein Wallet ohne
die Daten. Derselbe Fehler laut Review im JSON-Import (`index-ui.js:294-299`).

**Umsetzung.** Rückgabewert prüfen, bei `false` Fehlermeldung zeigen, nicht routen,
keine Erfolgsmeldung.

**Abnahme.** Harness mit `quota`: Import in einen vollen Speicher endet mit genau einer
Fehlermeldung.

### P1.8 `syncPeers` gegen `__proto__` härten

**Befund (Review, im Harness reproduziert).** Der Null-Prototyp-Schutz in
`buildImportedWallet` greift nur, wenn `syncPeers` fehlt (`wallet-import-v2.js:1121-1129`).
Nach dem ersten Import ist es ein gewöhnliches Objekt aus `JSON.parse`. Ein Payload mit
Geräte-ID `__proto__` liefert in Zeile 1142 `Object.prototype` als Peer und schreibt
`label`, `updatedAt`, `peerEventCount`, `commonEventCount` darauf. Die Wirkung bleibt
auf die Sitzung begrenzt, Code wird nicht ausgeführt.

**Umsetzung.** `syncPeers` beim Laden in ein Null-Prototyp-Objekt umkopieren und Peers
nur über `Object.hasOwn` lesen; `__proto__`, `constructor`, `prototype` als Peer-Key
ablehnen.

**Abnahme.** Nach dem Import mit Geräte-ID `__proto__` hat ein frisches `{}` keine der
vier Eigenschaften.

---

## Phase 2: Navigation und Fehlerpfade

### P2.1 `replaceState` statt `location.hash`

**Befund (gelesen).** `bookActionCode` setzt `window.location.hash`
(`wallet-import-v2.js:1395`, `:1404`, `:1429`, `:1432`), ebenso `importRemoteWallet`
(`:1183`). Das legt einen Verlaufseintrag an: `#ac:…` bleibt im Verlauf, „Zurück“ bucht
denselben Code ohne Rückfrage erneut. Der globale Pfad (`acg:`) nutzt `replaceState`
und hat das Problem nicht. Dieselbe Zuweisung löst ein zweites `hashchange` aus, das
`switchToUser` doppelt laufen lässt (`wallet-ui.js:796-805`); das ist der erste Punkt
aus der alten `TODO.md`, damit bestätigt: doppeltes Laden, Speichern und Rendern, kein
Datenschaden.

**Umsetzung.** In allen `ac:`- und Importpfaden den Hash über `history.replaceState`
ersetzen (es gibt `replaceHashSilently` in `wallet-ui.js`; nach `wallet-helpers.js`
ziehen, damit der Codec es nutzen kann). Danach genau einmal `switchToUser`.

**Abnahme.** Self-Check: nach einer `ac:`-Buchung steht `#ac:` nicht mehr im Verlauf
(`history.length` unverändert), und `switchToUser` läuft pro Import einmal.

### P2.2 Sackgassen in `wallet.html` schließen

**Befund (gelesen, im Review im Browser reproduziert).**
- Ohne Hash erscheint nur „Bitte zuerst ein Wallet importieren oder öffnen.“ ohne Link
  (`wallet-ui.js:335-341`). Der `hashchange`-Listener wird erst in Zeile 815
  registriert, also nach diesem frühen `return`; ein nachträglich gesetzter Hash
  bleibt wirkungslos.
- Ein kaputter Import-Link beim Kaltstart zeigt die Fehlermeldung und kehrt in Zeile
  367 bei `!userId` ohne `setNoWalletState()` zurück. Sichtbar bleibt die ganze
  Oberfläche mit Buttons ohne Handler, auch „Zur Startseite“ reagiert nicht.

**Umsetzung.** Den Listener vor den frühen Returns registrieren. Im Zustand ohne
Wallet einen Link zur Startseite und die Liste der vorhandenen Wallets zeigen
(Entscheidung E3: nicht automatisch das zuletzt benutzte öffnen). In Zeile 367 bei
`!userId` denselben Zustand setzen.

**Abnahme.** Im Browser: `wallet.html` ohne Hash zeigt die Wallet-Liste; ein kaputter
`#i2:`-Link endet in demselben Zustand; ein danach gesetzter Hash öffnet das Wallet.

### P2.3 Importfehler mit Fehlercode, Abbruch führt zurück

**Befund (nachgestellt für die Prüfsumme, sonst gelesen).** Die Fehlerklassifikation
sucht in Meldungstexten (`wallet-import-v2.js:1468-1490`). „Import beschädigt
(Prüfsumme stimmt nicht)“ (`:623`) trifft kein Muster, der Nutzer sieht nur „Import
fehlgeschlagen ❌“. Bricht man den Importdialog ab, landet man auf `index.html`, obwohl
ein Wallet offen war und `returnToUserId` vorliegt.

**Umsetzung.** Fehlerobjekte mit `code` (zum Beispiel `checksum`, `truncated`,
`too-large`, `unsupported-version`) und eine Meldungstabelle. Bei Abbruch zurück zum
offenen Wallet.

**Abnahme.** Ein Payload mit verfälschter Prüfsumme liefert die Prüfsummen-Meldung mit
dem Hinweis auf einen frischen Export.

### P2.4 `legacyIdToV2Id` früh beenden

**Befund (Review, gemessen).** Der Legacy-Test ist nur `includes("-")`
(`wallet-import-v2.js:60-66`). Device-Keys sind base64url und enthalten in etwa 12 %
der Fälle ein „-“; dann läuft bei jedem `saveWallet` pro Event ein BigInt-Hash (5 000
Events: 66 ms statt 13 ms in Node).

**Umsetzung.** `null` zurückgeben, sobald `parseCompactEventId(id)` greift.

**Abnahme.** Bestehende Merge-Tests grün; ein Test mit Device-Key `ab-cd` belegt, dass
kein Alias gebildet wird.

### P2.5 QR zu groß: kompakten Link anbieten

**Befund (Review, gemessen).** Ab etwa 590 Events (weniger mit Tombstones und Edits,
etwa 480 bei 10 % Löschungen und 5 % Edits) passt der Export nicht mehr in einen QR
der Version 40. Die App meldet „Zu groß für QR-Export. Nutze Export-Link oder JSON.“
(`wallet-export-ui.js:334-344`) und verwirft den fertig gebauten kompakten `i2:`-Link.
Der empfohlene klassische Link ist bei 500 Events rund 36 000 Zeichen lang gegenüber
rund 2 500 und enthält keine globalen Codes.

**Umsetzung.** Wenn der QR nicht passt, den `i2:`-Link im Linkfeld anzeigen, mit
kurzem Hinweis. Die eigentliche Skalierung steht in P5.5.

**Abnahme.** Mit 700 Events liefert der Export einen funktionierenden `i2:`-Link statt
nur einer Fehlermeldung.

---

## Phase 3: Schnelle Verbesserungen an Oberfläche und PWA

Alle Pakete sind klein. Messwerte stammen aus dem Review (headless Chromium, 320 bis
380 px); die Kontrastwerte sind nachgerechnet.

### P3.1 Theme: Standard, Kontrast, Fokus, `theme-color`

- **Standard-Theme** (zweiter Punkt der alten `TODO.md`, bestätigt). Ohne
  gespeichertes Theme behauptet das Label „Lilac Carbon“, kein Button ist aktiv,
  gerendert wird die `:root`-Palette aus `style.css:1-9`, eine sechste, namenlose
  Palette. `theme.js` soll ohne Speichern einen Standard setzen: dunkel → Lilac Carbon,
  hell (`prefers-color-scheme`) → Paper Mint, `data-theme` setzen, Button markieren.
  `:root` auf die Werte von Lilac Carbon bringen.
- **Kontrast in den hellen Themes.** `--accent-strong` dient als Textfarbe für
  Saldo-Zahlen, Links und aktive Buttons (`style.css:91`, `:180`, `:212`, `:270`,
  `:285`, `:524`). Gegen `--panel`: Paper Mint 1,96:1, Peach Cloud 2,03:1; `--danger`
  2,43:1 und 2,69:1. Vorschlag mit nachgerechneten Werten: Paper Mint `#0f766e`
  (4,75:1) und Danger `#b23a41` (5,10:1); Peach Cloud `#9c4a1c` (5,07:1) und Danger
  `#b03a3a` (4,92:1). Wenn `--accent-strong` als Flächenfarbe hell bleiben soll, eine
  eigene Variable für Akzenttext einführen. `colors.html` und `colors.css` führen
  dieselben Hex-Werte von Hand und müssen mitgezogen werden.
- **Fokus.** Eingabefelder haben `outline: none` und einen kaum sichtbaren Rahmen.
  Einheitlich `:focus-visible { outline: 2px solid var(--text); outline-offset: 2px }`.
  Die fest verdrahteten Cyan-Werte `rgba(34,211,238,…)` in `style.css:120`, `:181`,
  `:276` durch Theme-Variablen ersetzen.
- **`theme-color` und `color-scheme`.** `applyTheme` setzt den Meta-Tag auf `--bg`;
  `themes.css` bekommt je Theme `color-scheme: dark` oder `light`, damit Checkboxen und
  Scrollbars dem Theme folgen statt dem Betriebssystem.

### P3.2 CSS-Grundlagen für Touch und Lesbarkeit

- Buttons im Mobile-Breakpoint auf `min-height: 44px` (heute haben nur die sechs
  Buchungsbuttons 48 px, die übrigen 34 px, „✅ passt“ 28 px, Gerätesymbole etwa
  25 × 21 px).
- `button, input { font: inherit }` (Buttons rendern in Arial 13,3 px neben
  Monospace-Fließtext mit 16 px).
- `button:hover` in `@media (hover: hover)` kapseln; ein Block für
  `prefers-reduced-motion`.
- `overflow-wrap: anywhere` für `#uid` und `.stat strong` (lange IDs erzeugen
  horizontalen Seitenscroll).
- `.sr-only` ist nirgends definiert, das Label in `index.html:36` ist deshalb sichtbar
  und doppelt sich mit dem `aria-label`. Label sichtbar lassen, `aria-label` streichen.
- `image-rendering: pixelated` für die QR-Canvas (wird per CSS auf nicht-ganzzahlige
  Größen skaliert).

### P3.3 CSP ohne `'unsafe-inline'`

Nur sieben `style="…"`-Attribute erzwingen `style-src 'unsafe-inline'`:
`wallet.html:35`, `:76`, `:147`, `:158`, `:161` (jeweils `display: none`),
`index.html:69` (`display: none`), `preview.html:32` (Farbe). Im JS gibt es keine
CSP-relevanten Stellen (`el.style.x = …` ist erlaubt). Die Regeln nach `style.css`
verschieben, danach `'unsafe-inline'` aus der CSP der drei App-Seiten entfernen.
`colors.html` hat eine eigene CSP und kann sie behalten. Vorher prüfen, dass das JS
`style.display === ""` an allen Stellen als „versteckt“ behandelt, sonst zeigt ein
Umschalter ins Leere. Im Browser prüfen: keine CSP-Meldung in der Konsole.

### P3.4 PWA: Icons und Service-Worker-Strategie

- **Icons.** `manifest.json` hat ein einziges SVG mit `purpose: "any maskable"`, es
  gibt kein `apple-touch-icon`. Ergänzen: PNG 192 und 512 (`any`), ein randloses 512er
  (`maskable`, das heutige SVG hat runde transparente Ecken), `apple-touch-icon` 180.
  Die Dateien in `APP_SHELL` und in die Kopierliste von `pages.yml` aufnehmen. Steht
  kein Werkzeug zum Rastern bereit, das Paket mit dieser Angabe zurückgeben.
- **Precache.** `cache.addAll` geht durch den HTTP-Cache und kann beim Versionswechsel
  alte Dateien unter der neuen `VERSION` einfrieren. Stattdessen
  `new Request(url, { cache: "reload" })`.
- **Navigationen.** HTML läuft network-first ohne Timeout; bei schlechtem Netz wartet
  die Seite auf den Browser-Timeout, obwohl die Shell im Cache liegt. Network-first
  mit Timeout (etwa 3 s), dann Cache. `caches.match(req, { ignoreSearch: true })`,
  damit `wallet.html?x=…` offline nicht auf `index.html` zurückfällt.
- Im Browser prüfen: Offline-Start aus dem Cache, Update-Toast nach `VERSION`-Bump.

### P3.5 `self-check.js` bei Bedarf nachladen

`wallet.html` lädt bei jedem Aufruf 73 KB Testsuite. Kein App-Code ruft
`dbWalletSelfCheck` auf (Review; per `grep` gegenprüfen). Das Skript aus dem HTML
nehmen und durch einen kleinen Stub ersetzen, der `window.dbWalletSelfCheck.run()`
anbietet und `self-check.js` beim ersten Aufruf per `<script>` nachlädt. Der Aufruf
aus `CLAUDE.md` bleibt gültig, die Datei bleibt in `APP_SHELL`. Achtung: Der Self-Check
vergleicht geladene Skripte mit dem Cache (`self-check.js:2031-2041`); das an den Stub
anpassen.

### P3.6 Export: Kopieren, Teilen, scharfer QR

Der Hinweis im Export sagt „Link = Kopieren“, der Code markiert aber nur den Text; im
Repo gibt es weder `navigator.clipboard` noch `navigator.share`. Buttons „Kopieren“
und, wo vorhanden, „Teilen“ ergänzen. Der JSON-Download widerruft die Blob-URL sofort
(`wallet-ui.js:829`), der PNG-Pfad wartet eine Sekunde; angleichen, weil Safari sonst
den Download verlieren kann (Verdacht aus dem Review).

### P3.7 Englische Reststrings eindeutschen

„New action code“ (`action-codes.js:1003`, `:1049`), „Devices:“, „Device ID“, „Last
seen“ (`wallet-sync-ui.js:245`, `:254`). Die Klasse `action-code-meta`
(`action-codes.js:903`) hat keine CSS-Regel.

---

## Phase 4: Bedienung (erst nach Freigabe)

Die Oberfläche ist vom Desktop her gewachsen, benutzt wird die App am Handy. Diese
Pakete ändern das Aussehen und brauchen vorab die Zustimmung des Nutzers, am besten
mit einem Entwurf pro Paket. Reihenfolge nach Nutzen.

- **P4.1 Statuszeile statt `alert`.** Es gibt 52 native Dialoge (38 `alert`, 10
  `confirm`, 4 `prompt`), auch auf den Hauptwegen. Nach „+ Trinken“ ändert sich nur
  eine Zahl; ein Doppeltipp bucht unbemerkt doppelt. Eine zentrale Zeile mit
  `role="status"` bei den Buttons („+1 gebucht · Offen: 4 · Rückgängig“) ersetzt die
  Erfolgs- und Fehler-`alert`s. Die Naht existiert schon: `dialogAlert`,
  `dialogConfirm`, `dialogPrompt` in `wallet-ui.js:1017-1019`; `wallet-import-v2.js`,
  `index-ui.js`, `wallet-export-ui.js` und `wallet-storage.js` rufen `alert` noch
  direkt. `aria-live` von der Sync-Zeile nehmen (`wallet-sync-ui.js:51`).
- **P4.2 Kopfbereich.** Bei 360 px liegt „+ Trinken“ bei y = 733 unter dem Falz und
  springt nach der ersten Buchung um 96 px, weil `toggleStatVisibility`
  (`wallet-ui.js:920-933`) Karten bei 0 ausblendet. Feste Stat-Zeile mit drei Spalten,
  Buchungsblock direkt darunter, Start und Info als kleine Links in die Kopfzeile.
- **P4.3 Guthaben und Bearbeiten als Formular.** Guthaben läuft über `prompt`,
  Bearbeiten über zwei `prompt`s mit getipptem `YYYY-MM-DD`. Inline-Formulare mit
  `type="number"` und `type="date"`, wie `action-codes.js` es vormacht. Bestätigungen
  über ein gemeinsames `<dialog>`.
- **P4.4 Historie mit Zeilenaktionen.** Bearbeiten und Löschen verlangen heute, eine
  Positionsnummer aus dem `<pre>` abzulesen und einzutippen; die Nummern ändern sich
  nach jeder Aktion. Stattdessen eine Liste mit „Bearbeiten“ und „Löschen“ pro Zeile,
  die auf die Root-ID zielt. Tombstones nur im Raw-Log zeigen.
- **P4.5 Startseite.** Wallet-Liste vor der Neuanlage; ein vorhandener Name öffnet das
  Wallet, statt still `peter-2` anzulegen; Umlaute transliterieren („Jörg“ wird heute
  zu `jrg`); „Löschen“ optisch von „Öffnen“ trennen (`--danger` ist definiert, wird
  aber kaum benutzt) und vor dem Löschen ein JSON-Backup anbieten.
- **P4.6 Bezahlen und Mengenfeld.** „heute bezahlen“ begleicht alle offenen Getränke,
  nicht die von heute; besser „Alle N offenen bezahlen“, bei 0 deaktiviert. Enter im
  Mengenfeld bucht. `max` am Feld und eine Rückfrage bei großen Mengen (Entscheidung
  E5).
- **P4.7 Sync-Zeile und Gerätesymbol.** Ein frisches Wallet zeigt etwa 125 px
  „Sync-Status: unbekannt“ und sechs unbeschriftete Buttons „L M D K T *“;
  Erklärungen stecken in `title`-Attributen, die auf Touch-Geräten nie erscheinen.
  Sync-Zeile erst nach dem ersten Export oder Import zeigen, Gerätesymbol beschriften.
- **P4.8 Link einfügen.** Auf iOS hat die installierte PWA einen eigenen Speicher; ein
  mit der Kamera gescannter QR öffnet Safari und findet dort kein Wallet (Verdacht zum
  Plattformverhalten, das fehlende Einfügefeld ist belegt). Ein Feld „Link einfügen“
  übergibt den Hash an den vorhandenen Router.
- **P4.9 Struktur für Tastatur und Screenreader.** `<main>`, `<header>`, eine `h2` je
  Block; `aria-pressed` für Modus-, Raw- und Theme-Buttons; der Import-Dialog als
  natives `<dialog>` mit Fokusrückgabe; Fokus nach „Bezahlen“ auf die erste Option.

---

## Phase 5: Struktur und Skalierung

Unabhängige Pakete, jeweils nur bei Bedarf.

- **P5.1 `action-codes.js` teilen.** Zeilen 1 bis 343 sind Logik und Codec, 345 bis
  1123 DOM. `index.html` lädt die ganze Datei nur wegen `decodeActionHash`. Abspalten
  in `action-codes-ui.js`; die Umwandlungszweige (lokal ↔ global, Bearbeiten, Löschen)
  als reine Funktionen `(wallet, änderung) → wallet`, damit sie im Node-Test laufen.
  Die Fehler aus P1.2 bis P1.4 saßen genau in diesen ungetesteten Zweigen.
- **P5.2 Toter und doppelter Code** (Review, je Stelle vor dem Löschen per `grep`
  prüfen).
  Tot: `wallet-import-v2.js:1230-1232` (`ac:`-Zweig), `:1346-1355` (`pending-walletId`
  wird geschrieben, nie gelesen); `action-codes.js:377-408` (QR-Fallback, unerreichbar);
  Fallbacks in `import-preview.js:5-16`, `:185-193`, `:204-214`, nötig nur, weil
  `wallet.html:25` das Skript vor den Helpers lädt.
  Doppelt: `hash-router.js:40-43` kopiert `normalizeUserId` ohne die 64-Zeichen-Grenze;
  die Liste reservierter Präfixe steht in `hash-router.js:2` und
  `wallet-storage.js:63-69`; die Normalisierung für `acg:` steht dreifach
  (`action-codes.js:52-69`, `wallet-hash-actions.js:19-28`, `wallet-ui.js:692-696`).
- **P5.3 CSS zusammenführen.** Dieselbe Karten-Optik ist sechsmal definiert; 106
  `el.style.x`-Zuweisungen in `wallet-sync-ui.js`, `wallet-device-ui.js` und
  `sw-register.js` umgehen Theme und Media-Queries. Klassen `.card` und `.panel`, die
  JS-Styles in Klassen überführen.
- **P5.4 Kanonische Reihenfolge über Geräte hinweg.** (Review, im Harness
  reproduziert, Fall A7.) Der QR-Export rundet Zeitstempel auf die Minute; importierte
  Events bekommen „Minute + Position“, eigene behalten Millisekunden. Buchen zwei
  Geräte in derselben Minute und ist eine Zahlung dabei, sortiert jedes Gerät die
  fremden Events vor die eigenen: Gerät A zeigt „offen 0“, Gerät B „offen 1“. Selten,
  aber ein echter Konvergenzfehler. Mögliche Lösung: kanonische Ordnung nach (Minute,
  `deviceKey`, `seq`). Das ändert den zentralen Comparator
  (`wallet-helpers.js`, `compareEventsByTime`), der auch den Gewinner bei Edits und das
  Undo-Ziel bestimmt. Vor der Umsetzung einen kurzen Entwurf schreiben und die
  Tombstone-Zeitstempel (`max(now, maxTs + 1)`) dagegen prüfen.
- **P5.5 QR-Kapazität.** Tombstones kosten im Export etwa fünfmal so viel wie ein
  Event (zwei Volltext-IDs im `xt`-Block). Erst Tombstones kompakt kodieren
  (Geräteindex und `seq`), dann bei Bedarf Delta-Export je Peer oder mehrteiliger QR.
  Wire-Format-Änderung, eigener Entwurf.
- **P5.6 `qrcodegen.js` bei Bedarf laden.** 35 KB, gebraucht nur für Export und
  Action-Code-Karten. `renderActionList` zeichnet beim Start jede QR-Karte, obwohl das
  `<details>` zu ist; erst beim Öffnen zeichnen.
- **P5.7 `colors.html` und `colors.css`.** Die App braucht `colors.css` nicht, nur
  `colors.html` bindet sie ein; beide liegen im Precache (Entscheidung E6).

---

## Entscheidungen

Voreinstellungen gelten, solange der Nutzer nichts anderes sagt.

| Nr. | Frage | Voreinstellung |
|---|---|---|
| E1 | In diesem Checkout ist `origin` = `https://github.com/bmmmm/db-wallet`, einen Remote `github` gibt es nicht. `CLAUDE.md` beschreibt `origin` als Forgejo. Das Forgejo-Repo existiert und steht auf demselben Commit. Wohin wird gepusht? | Nicht pushen, bis geklärt. |
| E2 | Was bedeutet Reset, wenn ein Zweitgerät den alten Stand hat? | Neue `walletId`: Reset ist ein neues Wallet. |
| E3 | Soll `wallet.html` ohne gültigen Hash das zuletzt benutzte Wallet öffnen? (Offen seit Juni als „U2“.) | Nein, Wallet-Liste zeigen. |
| E4 | Soll das Löschen eines Action Codes per Export auf andere Geräte wandern? | Ja, als neuer Codec-Block; kann nach P1.2 als eigenes Paket folgen. |
| E5 | Obergrenzen im Mengenfeld? | Getränke höchstens 99, Guthaben höchstens 999, Rückfrage ab 20 Getränken. |
| E6 | `colors.html` in der App behalten? | Aus `APP_SHELL` und den Theme-Hinweisen nehmen, im Repo behalten. |
| E7 | Diese Datei nennt unbehobene Fehler, GitHub ist öffentlich. | Erst zusammen mit den Korrekturen aus Phase 1 veröffentlichen. |

Unverändert bleibt die Entscheidung „I1“ vom Juni: Nach abgelehntem Import-Prompt auf
`index.html` wird der Hash gelöscht.

## Nicht Teil des Plans

- Kein Framework, kein Build, kein npm für die App.
- Keine Verschlüsselung des Exports; er ist laut `CLAUDE.md` bewusst ein
  Bearer-Credential.
- Keine Reparatur bereits duplizierter Events aus P1.1: Der Auslöser (Mengen über
  1e9 oder präpariertes JSON) ist im Alltag unwahrscheinlich. Taucht ein betroffenes
  Wallet auf, ist das ein eigener Auftrag.

---

## Anhang A: Harness und Nachstellungen

Das Skelett lief im Review mit Node 24. Es lädt die Originaldateien in einen
`vm`-Kontext. `quota` begrenzt die Länge eines gespeicherten Werts und simuliert
vollen Speicher.

```js
// tests/harness.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const REPO = path.join(__dirname, "..");

function makeStorage(quota) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      v = String(v);
      if (v.length > (quota || Infinity)) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
  };
}

function makeEnv(opts = {}) {
  const alerts = [];
  const win = {
    console, TextEncoder, TextDecoder, btoa, atob, crypto: globalThis.crypto,
    Blob, Response, CompressionStream, DecompressionStream, setTimeout, clearTimeout, URL,
    localStorage: makeStorage(opts.quota), sessionStorage: makeStorage(),
    alert: (m) => alerts.push(String(m)), confirm: () => true, prompt: () => null,
    location: { hash: "", href: "https://example.invalid/wallet.html" },
    document: {
      body: { dataset: {} }, addEventListener() {},
      getElementById() { return null; }, querySelector() { return null; },
      documentElement: { setAttribute() {}, getAttribute() { return ""; } },
    },
    addEventListener() {}, history: { replaceState() {} },
  };
  win.window = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  const files = opts.files || [
    "qrcodegen.js", "wallet-helpers.js", "hash-router.js", "migration.js",
    "action-codes.js", "wallet-storage.js", "wallet-import-v2.js",
    "wallet-summary.js", "wallet-sync.js",
  ];
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(REPO, f), "utf8"), ctx, { filename: f });
  }
  win._alerts = alerts;
  return win;
}
module.exports = { makeEnv };
```

Objekte aus dem `vm`-Kontext haben eigene Prototypen; für Vergleiche Zahlen und
Strings prüfen oder über `JSON.stringify` gehen, nicht `assert.deepStrictEqual` auf
rohe Objekte.

Die Fälle, jeweils mit `const w = makeEnv(); const S = w.dbWalletStorage;`:

**A1, Action Code löschen (P1.2).** Heute 2, erwartet 1.

```js
const AC = w.dbWalletActionCodes;
const wallet = S.loadWallet("anna");
wallet.actionCodes.push(AC.buildActionCode({ type: "g", amount: 5, label: "A" }));
wallet.actionCodes.push(AC.buildActionCode({ type: "d", amount: 1, label: "B" }));
S.saveWallet(wallet);
const del = wallet.actionCodes[0].id;
wallet.actionCodes = wallet.actionCodes.filter((c) => c.id !== del);
S.saveWallet(wallet);
S.loadWallet("anna").actionCodes.length; // heute 2
```

**A2, Menge über 1e9 (P1.1).** Heute 2, 3, 4 Events; erwartet 1.

```js
let wallet = S.loadWallet("bob");
S.appendEvents(wallet, [S.newEvent(wallet, "d", 2000000000)]);
for (let i = 0; i < 3; i++) {
  wallet = S.loadWallet("bob");
  S.ensureDeviceSeq(wallet);
  S.saveWallet(wallet); // das tut wallet-ui.js bei jedem Öffnen
}
wallet.events.length; // heute 4
```

**A3, Import mit nicht normalisierten Events (P1.1).** Heute wächst die Zahl mit
jedem Öffnen (3, 6, 9, 12); erwartet konstant 3.

```js
const I = w.dbWalletImportV2;
const built = I.buildImportedWallet({
  userId: "bob", walletId: "AAAAAAAAAAAAAAAA", v: 2,
  events: [
    { id: "devA.1", t: "d", ts: 1700000000000 },          // ohne n
    { id: "devA.2", t: "d", n: "3", ts: 1700000060000 },  // n als String
    { id: "devA.3", t: "p", n: 1, ts: 1700000120000 },    // Zahlung mit n
  ],
});
S.ensureDeviceSeq(built.wallet);
S.saveWallet(built.wallet);
// danach wie in A2 mehrfach laden und speichern
```

**A4, globaler Code nach Import (P1.3).** Heute fehlt `scope`, der Key wechselt je
Export.

```js
const I = w.dbWalletImportV2;
const wallet = S.loadWallet("anna");
wallet.globalActionCodes = [{ id: "global:x1", label: "G1", amount: 2, type: "d",
  scope: "global", createdAt: 1000, updatedAt: 1000 }];
S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]);
const remote = I.decodeImportV2Bytes(I.encodeImportV2Bytes(wallet, null));
I.buildImportedWallet(remote).wallet.globalActionCodes[0].scope; // heute undefined
```

**A5, Migration mit Edit (P1.5).** Heute Summe 2 vor und 7 nach der Migration;
erwartet 2.

```js
const wallet = { userId: "eve", v: 1, events: [
  { id: "legacydev-1700000000000-abc", t: "d", n: 5, ts: 1700000000000 },
  { id: "legacydev-1700000060000-def", t: "d", n: 2, ts: 1700000060000,
    supersedes: "legacydev-1700000000000-abc" },
] };
w.dbWalletMigrateV1toV2(wallet);
w.dbWalletSummary.computeSummary(wallet).total; // heute 7
```

**A6, Reset (P1.6).** Heute wird `<deviceKey>.1` zweimal vergeben. Über
`dbWalletActions.resetWallet` mit einem `ctx`-Stub testen (dazu `wallet-actions.js` in
`files` aufnehmen); der Kern:

```js
let wallet = S.loadWallet("dora");
S.appendEvents(wallet, [S.newEvent(wallet, "d", 1), S.newEvent(wallet, "d", 1)]);
const before = wallet.events.map((e) => e.id);
// … resetWallet(ctx) …
// erste Buchung danach darf keine ID aus `before` tragen
```

**A7, gleiche Minute auf zwei Geräten (P5.4).** Zwei Umgebungen mit festem
`db-wallet:device` (`devA`, `devB`); A hat ein Getränk von vor einer Stunde, B
importiert diesen Stand. In derselben Minute zahlt A bei +10 s, B trinkt bei +5 s.
Nach Export und Import in beide Richtungen: A `unpaid` 0, B `unpaid` 1; erwartet
gleich.

Weitere Kurzfälle: Import in vollen Speicher (`makeEnv({ quota: … })`, P1.7) liefert
heute zwei `alert`s, den Speicherfehler und „Getränkedaten importiert ✅“; ein Payload
mit verfälschter Prüfsumme (P2.3) liefert heute nur „Import fehlgeschlagen ❌“;
`AC.normalizeAmount("100000000000000000000")` (P1.1) liefert heute 1e20.
