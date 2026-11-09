# Offene Punkte nach Phase 0 bis 3

Stand 2026-11-10. `main` = `a3f4ab3` liegt auf GitHub und Forgejo, die Pages-Seite ist
damit ausgeliefert. Dieser Plan führt alles, was danach offen ist, in der Reihenfolge,
in der es sich am billigsten erledigt. Die Pakete selbst stehen weiter in
[`improvement-plan.md`](improvement-plan.md); dessen Arbeitsregeln gelten auch hier.

Belegstufen wie dort, dazu **gemeldet**: aus dem Bericht eines Agentenlaufs übernommen,
nicht nachgestellt. Solche Punkte erst mit einem roten Test bestätigen, dann beheben;
lässt sich einer nicht nachstellen, streichen statt reparieren.

## Fortschritt

- [ ] O1 Veröffentlichten Stand im Browser prüfen (Nutzer, etwa 10 Minuten)
- [ ] O2 Remotes dieses Checkouts an `CLAUDE.md` angleichen (Entscheidung)
- [ ] O3 Nachzügler aus den Läufen (ein Agentenlauf, in Node prüfbar)
- [ ] O4 Löschliste der Action Codes im Export (E4, eigenes Paket)
- [ ] O5 Phase 4 Bedienung (Freigabe, vier Läufe, braucht einen Browser)
- [ ] O6 Phase 5 Struktur (einzeln nach Bedarf)

## O1 Veröffentlichten Stand im Browser prüfen

Zuerst, weil es als Einziges schon bei Nutzern wirkt: Phase 0 bis 3 ist nie in einem
Browser gelaufen, der Service Worker nur gegen Nachbauten in Node. In der Agentenumgebung geht
das nicht (kein Browser, Loopback gesperrt); am Handy und einmal am Desktop mit offener
Konsole durchgehen. Fällt etwas durch: Paket notieren, Fix vor allem anderen.

| Prüfen | Erwartet | Paket |
|---|---|---|
| Seite öffnen, wenn die App schon installiert war | Update-Hinweis erscheint, danach neue Oberfläche | P3.4 |
| Flugmodus, App neu starten | startet, Wallet lesbar, Buchung möglich | P3.4 |
| Konsole auf `index.html`, `wallet.html`, `preview.html` | keine CSP-Meldung; jedes Panel öffnet und schließt | P3.3 |
| `await dbWalletSelfCheck.run()` in `wallet.html` | `{ok: true}`; lädt `self-check.js` genau einmal | P3.5 |
| Frische Installation, System hell und dunkel | Paper Mint bzw. Lilac Carbon; Adresszeile folgt dem Theme | P3.1 |
| Tab-Taste durch die Seite | Fokusring in jedem Theme sichtbar | P3.1 |
| Handy: Buttons, lange IDs, langer Code-Name | nichts überlappt, nichts läuft aus der Karte | P3.2, P3.7 |
| App installieren (Android und iOS) | richtiges Icon, nicht beschnitten | P3.4 |
| Export: Kopieren, Teilen, QR | Link in der Zwischenablage; Teilen-Blatt am Handy; QR scharf | P3.6 |
| `ac:`-Code scannen, dann Zurück | bucht einmal, Zurück bucht nicht erneut | P2.1 |
| `wallet.html` ohne Hash; kaputter Import-Link | Wallet-Liste und „Zur Startseite“; Fehlertext nennt die Ursache | P2.2, P2.3 |
| Zwei Tabs, im einen Reset, im anderen buchen | zweiter Tab meldet „neu laden“, nichts kommt zurück | P1.9 |

Die 3 s Wartezeit des Service Workers auf das Netz ist geschätzt; wirkt der Start bei
schlechtem Empfang träge, `NAV_TIMEOUT_MS` in `service-worker.js` senken.

## O2 Remotes dieses Checkouts angleichen

Im Haupt-Checkout (`~/db-wallet`) zeigt `origin` auf GitHub, ein Remote `github` fehlt;
`CLAUDE.md` beschreibt `origin` als Forgejo und `github` als Spiegel. Der Push am
2026-11-10 ging deshalb per URL nach Forgejo. Voreinstellung: Remotes so umbenennen,
wie `CLAUDE.md` es beschreibt (URL aus `~/ops/runbooks/identity-setup.md`, nicht in
getrackte Dateien schreiben). Das ist lokale Konfiguration und ändert keinen Commit;
bis dahin bei jedem Push beide Ziele ausdrücklich nennen.

Merke für alle Folgearbeiten: Der pre-push-Hook lehnt für GitHub jeden Commit ab, der
einen privaten Hostnamen enthält, und prüft jeden Commit einzeln. Ein Korrektur-Commit
obendrauf genügt dann nicht, die Historie muss neu geschrieben werden. Also vor dem
Commit prüfen, nicht vor dem Push.

## O3 Nachzügler aus den Läufen

Ein Lauf, je Punkt ein Commit, alles in Node prüfbar. Reihenfolge nach Wirkung.

1. **Import bei gesperrtem Speichern** (gemeldet). Trifft die Sperre aus P1.9 während
   eines Imports, erscheint die allgemeine Meldung „konnte nicht gespeichert werden“
   statt des Neuladen-Hinweises. `saveWallet` soll den Grund zurückgeben oder die
   Import-Meldung ihn unterscheiden.
2. **Globaler Code ohne ID** (gemeldet). Er bekommt eine ID ohne `global:`-Präfix
   (`normalizeGlobalActionCodes`).
3. **Stille Kürzung beim Abgleich** (gemeldet). Nach der Vereinigung zweier Tabs gelten
   wieder die Obergrenzen (10 Codes, 6 Geräte); was dabei wegfällt, erfährt niemand.
   Mindestens ein Hinweis in der Oberfläche.
4. **„Teilen“ ohne Hinweis** (gelesen). Der geteilte Link ist der Schlüssel zum ganzen
   Wallet (`CLAUDE.md`, „bearer credential“). Vor dem ersten Teilen einmal darauf
   hinweisen.
5. **QR auf sehr schmalen Schirmen** (gemeldet). Unter etwa 268 px greift
   `max-width`, die Module liegen nicht mehr auf ganzen Gerätepixeln.
6. **`tests/wallet-page.js` wartet nach Zeit** (gemeldet). Auf Lastspitzen kann ein
   Test kippen; in allen bisherigen vollen Läufen nicht. Auf ein Ereignis statt auf Ruhe
   warten.

Bewusst ohne Paket: `document.execCommand("copy")` als zweiter Kopierweg ist veraltet,
aber der dritte Weg (Link markiert lassen) fängt den Ausfall ab. Die Restlücke aus P2.4
(53 ms gegen 39 ms bei 5 000 Events) ist unerklärt und ohne spürbare Wirkung.

## O4 Löschliste der Action Codes im Export (E4)

Ein gelöschter Code bleibt auf jedem anderen Gerät gültig, weil
`wallet.deletedActionCodes` nur lokal liegt. Neuer Codec-Block mit `id → ts`, vor `ck`
und nach `gc` geschrieben (Blöcke haben kein Längenfeld, alte Decoder brechen am ersten
unbekannten Block ab), Import vereinigt die Listen und filtert danach. Tests: Löschen
auf A, Export, Import auf B entfernt den Code; alter Export ohne Block importiert
weiter; ein Export von vor dem Löschen holt den Code nicht zurück. Wire-Format-Änderung,
deshalb eigener Lauf und nicht Teil von O3.

## O5 Phase 4 Bedienung

Braucht die Freigabe des Nutzers und eine Sitzung mit Browser, sonst entsteht wieder
ungeprüfte Oberfläche. Pakete so gebündelt, dass jeder Lauf dieselben Dateien anfasst
und für sich benutzbar bleibt:

| Lauf | Pakete | Warum zusammen |
|---|---|---|
| 1 | P4.1 Statuszeile, P4.6 Bezahlen und Mengenfeld (E5) | größter Nutzen; beide am Buchungsblock, P4.1 legt die Meldungsnaht für alle späteren |
| 2 | P4.3 Formulare, P4.4 Historie mit Zeilenaktionen | ersetzen zusammen die `prompt`-Abläufe für Bearbeiten und Löschen |
| 3 | P4.2 Kopfbereich, P4.7 Sync-Zeile und Gerätesymbol | reines Layout von `wallet.html` |
| 4 | P4.5 Startseite, P4.8 Link einfügen | beide an `index.html` und am Router |

P4.9 (Struktur für Tastatur und Screenreader) nicht als eigener Lauf: in jedem Lauf für
die angefassten Blöcke miterledigen. Nach jedem Lauf O1-artig im Browser prüfen, bevor
der nächste beginnt. O3 Punkt 3 und 4 entfallen als eigene Hinweise, wenn P4.1 vorher
läuft: dann gehören sie in die Statuszeile.

## O6 Phase 5 Struktur

Reihenfolge, falls angegangen: **P5.2** (toter und doppelter Code, billig) → **P5.1**
(`action-codes.js` teilen; vor Lauf 2 aus O5 sinnvoll, weil es die UI-Zweige testbar
macht) → **P5.4** (Konvergenzfehler bei zwei Geräten in derselben Minute; der einzige
echte Fehler in Phase 5, erst Entwurf) → **P5.6** → **P5.3** → **P5.5**.
P5.7 ist durch P3.1 erledigt: `colors.html` und `colors.css` stehen nicht mehr in
`APP_SHELL`; beim nächsten Anfassen nur gegenprüfen und abhaken.
