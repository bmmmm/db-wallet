# Änderungen

Neueste zuerst. Wie man auf eine neue Version kommt, steht im README unter
[Update](README.md#update).

## 2026-11-25 · Aufgeräumt, und ein Dutzend Fehler weniger

Ein Aufräum-Update: Alte und doppelte Wege sind entfernt, insgesamt rund 3600
Zeilen App-Code weniger. Dazu kommen Fehlerkorrekturen, vor allem beim Import,
bei globalen Codes und beim Löschen. Bedienung und Daten bleiben, wie sie
waren.

### Entfernt

- **Der Button „Export-Link (klassisch)“** im Export. Der kurze QR-Link kann
  dasselbe. Alte `#import:`-Links lassen sich weiter öffnen.
- **Der Raw-Schalter „alle Nutzer:innen“** auf der Wallet-Seite. Die
  Startseite zeigt weiter „Alle Raw-Daten anzeigen“.
- **Die Übernahme alter v1-Daten fragt nicht mehr.** Ein altes Wallet wird
  beim Öffnen und beim Import still umgestellt, ohne Rückfrage, Button und
  Versionsanzeige.
- **Die Farbvorschau** `colors.html`.

### Korrigiert

- **Abgeschnittene oder kaputte Links** werden abgelehnt. Vorher importierte
  die App den Teil vor der Bruchstelle, und eine verlorene Löschung brachte
  eine gelöschte Buchung zurück.
- **Löschen und Zurücksetzen** entfernen nur noch Daten des Wallets. Vorher
  traf es auch einen gleichnamigen Eintrag einer anderen App auf derselben
  Adresse (`bmmmm.github.io` teilen sich alle Projekte).
- **Rückgängig und Löschen einer verschobenen Zahlung** sagen wieder, wie
  viele Getränke dadurch offen werden.
- **Ein geleertes Code-Label** bekommt den üblichen Namen („Drink +5“) und
  behält seinen Schlüssel. Vorher wechselte der Schlüssel, und ein gedruckter
  QR-Code ging nicht mehr.
- **Globale Codes (`acg:`):**
  - Ein ungültiger Code bucht nichts und sagt das in der Statuszeile, statt
    eine erfundene Vorschau zu zeigen.
  - Mit offenem Wallet erscheint dafür eine Fehlermeldung statt des
    Hinweises „Bitte zuerst ein Wallet …“.
  - Beim Kaltstart meldet sich die Buchung wie bei offenem Wallet
    (etwa „Kiste“: +2 gebucht · Offen: 2), ein Speicherfehler ebenso.
- **Ein abgelehnter `ac:`-Link** verschwindet aus der Adresszeile und fragt
  beim Neuladen nicht noch einmal.
- **Das Code-Panel folgt anderen Tabs:** Ein dort gelöschter Code oder einer
  mit neuem Schlüssel zeigt keinen alten Link mehr.
- **Das Speicher-Banner** nennt den neuesten Fehler, nicht mehr immer
  „Speicher voll“.
- **Der Theme-Name** wechselt mit, wenn das System von hell auf dunkel
  schaltet.
- **Ältere Browser**, die einen `i2:`-Link nicht entpacken können, werden zum
  JSON-Backup geschickt statt zum entfernten klassischen Link.

### Bedienung

- Ein QR-Code lässt sich auch mit der Tastatur als PNG speichern (Enter oder
  Leertaste).
- Im Code-Panel bleibt der Tastaturfokus nach jedem Klick an einer sinnvollen
  Stelle.
- Der Fokusrahmen auf „Historie“, „Action Codes“ und „Theme“ ist wieder
  sichtbar.
- Buttons heißen für Screenreader so, wie sie dastehen, und Klappbereiche
  sagen, ob sie offen sind. Der QR-Button heißt jetzt „QR-Code anzeigen“.
- Die Lichter im Seitenhintergrund nehmen die Akzentfarbe des Themes an.
- Die Import-Vorschau zeigt das Theme des Imports, ohne es zu speichern. Die
  Wahl heißt „(auf diesem Gerät speichern)“.

### Unter der Haube

- Toter Code, Ersatzwege für Module, die immer geladen sind, und doppelte
  Helfer sind entfernt (JS −3944/+1223 Zeilen, HTML/CSS −936/+39).
- Der Browser-Selbsttest ist ein Smoke-Test mit 7 Checks (255 statt 2122
  Zeilen). Die Logikfälle laufen jetzt in Node: 385 automatische Tests statt
  298.
- Die Pages-Veröffentlichung nimmt genau den Commit, den die Prüfung
  freigegeben hat.

### Mischbetrieb

Gemessen mit `scripts/upgrade-check.js` gegen den Stand vom 17.11. Daten,
QR/Link und JSON gehen in beide Richtungen wie bisher. Beim ersten Start nach
dem Update laufen Buchen, Rückgängig, QR-Codes und Action Codes auch mit den
alten Skripten aus dem Zwischenspeicher. Nur die Darstellung ist bis zum Tippen
auf „Aktualisieren“ unfertig.

## 2026-11-17 · Gebaut fürs Handy, eine Reihenfolge auf allen Geräten

Das größte Update seit dem Start: 20 Commits, 66 Dateien, etwa 9300 Zeilen neu
und 2350 entfernt. Die Bedienung ist von Grund auf fürs Handy überarbeitet. Fast
alle Browser-Pop-ups sind weg. Alle Geräte zeigen dieselbe Reihenfolge, und ein
QR-Code fasst mit Löschungen deutlich mehr Einträge. Die Daten bleiben, wo sie
sind: im Speicher des Browsers, ohne Server.

> **Vor dem nächsten Austausch alle Geräte aktualisieren.** Ein Export mit
> gelöschten Einträgen lässt sich nur noch mit der neuen Version importieren.
> Die alte Version lehnt ihn ab („…aus einer neueren App-Version“), es geht
> nichts verloren. Danach den Link einfach noch einmal öffnen. Beim ersten
> Öffnen nach dem Update auf „Aktualisieren“ tippen. Mehr dazu unter
> [Mischbetrieb](#mischbetrieb-alte-und-neue-geräte).

### Buchen und Bezahlen

- **Statuszeile statt Pop-up.** Jede Buchung meldet sich am unteren Rand,
  z. B. „+1 gebucht · Offen: 4“. Der Button „Rückgängig“ nimmt genau diese
  Buchung zurück, auch wenn in einem anderen Tab inzwischen etwas dazukam.
  Fehler stehen in derselben Zeile.
- **Bezahlen sagt, was es tut:** „Alle 4 offenen bezahlen“. Ohne offene
  Getränke ist der Button aus. Vorher hieß er „heute bezahlen“ und beglich in
  Wahrheit alles Offene.
- **Grenzen gegen Vertipper:**
  - höchstens 99 Getränke je Buchung, ab 20 mit Rückfrage;
  - Guthaben höchstens 999 auf einmal;
  - Werte darüber lehnt die App ab, statt sie still zu kürzen;
  - Enter im Mengenfeld bucht.
- **Guthaben über ein Formular** unter „Guthaben aufladen“ (ganze Zahlen)
  statt über ein Eingabe-Pop-up.
- **Rückfragen in einem eigenen Dialog** statt `confirm()`. Escape heißt
  „Nein“, danach steht der Fokus wieder dort, wo er war.

### Historie

- Jeder Eintrag steht in einer eigenen Zeile. Mit „Einträge bearbeiten oder
  löschen“ bekommt jede Zeile „Bearbeiten“ (Datum und Menge im Formular) und
  „Löschen“. Positionsnummern abtippen ist vorbei.
- Bearbeiten am selben Tag behält die Uhrzeit. Ein Eintrag lässt sich nur auf
  einen früheren Tag legen, nie über eine Bezahlung hinweg.
- „Rückgängig“ fragt nach, wenn die letzte Aktion ein Löschen war.

### Aufbau der Seite

- **Kompakter Kopf:** Titel, „Start“ und „Info“, Nutzer und Gerät in einer
  Zeile.
- **Feste Zahlenzeile:** Offen, Gesamt und Guthaben bleiben immer stehen. Die
  Buchungsknöpfe springen nach der ersten Buchung nicht mehr um fast 100 Pixel
  nach unten.
- **Beschriftetes Gerätesymbol:** ein Knopf „Gerät: wählen“ statt sechs
  unbeschrifteter Buchstaben. Die Auswahl erklärt jedes Zeichen.
- **Sync-Zeile nur bei Bedarf:** Sie erscheint erst, wenn es einen Sync-Partner
  gibt, also nach dem ersten Import von einem anderen Gerät. Bei Rot führt
  „Zum Export“ direkt hin.
- **Tastatur und Screenreader:** eine Überschrift je Block, Umschalter melden
  ihren Zustand, der Importdialog gibt den Fokus zurück.
- **Export-QR passt sich der Box an** und zeichnet sich nach dem Drehen des
  Handys neu.

### Startseite

- Die Wallets dieses Geräts stehen oben, jedes mit „Öffnen“ und einem
  getrennten, roten „Löschen“. Vor dem Löschen bietet die App ein JSON-Backup
  an.
- **Ein vorhandener Name öffnet sein Wallet**, statt still ein zweites
  („peter-2“) anzulegen.
- **Umlaute werden ausgeschrieben:** „Jörg“ wird `joerg`, vorher `jrg`. Das gilt
  auch beim Import.
- **„Link einfügen“:** Öffnet ein gescannter QR-Code den Browser statt der
  installierten App (typisch auf dem iPhone), lässt sich der Link hier einfügen.
  Das geht für Export-Links und Action Codes.

### Sync und Export

- **Eine Reihenfolge auf allen Geräten.** Einträge sortieren nach der Minute,
  dann nach ihrer Kennung. Jedes Gerät zeigt dieselbe Liste, auch nach einem
  Import mit minutengenauen Zeiten. Bearbeiten zwei Geräte denselben Eintrag,
  gewinnt auf beiden dieselbe Bearbeitung.
- **Mehr Einträge pro QR-Code.** Gelöschte Einträge brauchen im Export nur noch
  6 bis 8 statt 34 Byte. Eine Wallet passt bis zu dieser Größe noch in einen
  einzigen QR-Code:

  | Einträge | vorher | jetzt |
  |---|---|---|
  | nur Buchungen | 561 | 561 |
  | davon 10 % gelöscht | 422 | 476 |
  | davon 25 % gelöscht | 319 | 395 |

- **Gelöschte Action Codes bleiben gelöscht.** Die Löschliste reist im Export
  mit. Ein auf einem Gerät gelöschter Code verschwindet nach dem Import auch auf
  den anderen.
- **Globale Codes ohne Kennung** bekommen eine mit dem richtigen Präfix
  `global:`.
- **JSON-Import:** Setzt ein anderer Tab das Wallet zurück, während die
  Import-Rückfrage offen ist, landet der Import als eigenes Wallet. Die Meldung
  nennt den echten Grund statt „Speicher voll“.

### Schneller und aufgeräumter

- Die QR-Bibliothek lädt erst, wenn ein QR-Code gezeigt wird. Die
  Action-Code-QRs zeichnen nur, solange ihr Bereich offen ist.
- Ein Hinweis „Neue Version verfügbar. · Neu laden“ erscheint in der
  Statuszeile statt in einer eigenen Box.
- **Unter der Haube:**
  - Das Action-Code-Panel ist eine eigene Datei, seine Änderungen sind reine,
    getestete Funktionen.
  - Toter und doppelter Code ist entfernt.
  - Eine Karten-Optik in einer CSS-Regel.
- **Tests:** 298 automatische Tests statt 157. Im Browser laufen 80 Selbsttests
  (`await dbWalletSelfCheck.run()` in der Konsole).
- **Upgrade-Check:** `node scripts/upgrade-check.js <veröffentlichter Commit>`
  misst vor jedem Release, was zwischen altem und neuem Stand passiert
  (Speicher, QR/Link, JSON, Reihenfolge, erster Start nach dem Update).

### Mischbetrieb: alte und neue Geräte

Gemessen mit dem neuen `scripts/upgrade-check.js` (21 Szenarien zwischen dem
bisherigen Stand und diesem) und einmal im echten Browser mit Service Worker
nachgestellt. Die Tabelle steht in
[`docs/upgrade-compat.md`](docs/upgrade-compat.md).

- **Daten:**
  - Was der alte Stand gespeichert hat, lädt der neue vollständig: alle
    Einträge, Summen, Action Codes.
  - Auch zwei offene Tabs (alt und neu) auf einem Gerät verlieren nichts.
- **Erster Start nach dem Update:**
  - Bis man im Hinweis auf „Aktualisieren“ tippt, läuft die neue Seite mit den
    alten Skripten aus dem Zwischenspeicher. Sie sieht halb fertig aus, und
    QR-Codes werden nicht gezeichnet.
  - Buchen und Rückgängig gehen trotzdem.
  - Nach dem Tippen ist alles neu, die Daten sind vollständig da.
- **QR/Link von neu nach alt:**
  - Ohne gelöschte Einträge kommt alles an, auch globale Codes.
  - Mit gelöschten Einträgen lehnt das alte Gerät ab und speichert nichts.
- **Von alt nach neu:** kommt vollständig an, als QR/Link wie als JSON-Backup.
- **Gelöschte Action Codes:** Die Löschliste reist nur zwischen zwei neuen
  Ständen. Der alte Stand hat sie nie exportiert oder gelesen. Ein Code, der
  im Mischbetrieb gelöscht wurde, muss auf dem anderen Gerät einmal von Hand
  gelöscht werden.
- **Reihenfolge:** Einträge verschiedener Geräte aus derselben Minute können
  auf einem alten Gerät anders stehen. Die Summen sind gleich.

### Noch nicht auf echten Geräten geprüft

Im Browser ist alles durchgetestet, auf einem echten Handy stehen noch aus:

- Start ohne Netz;
- das Symbol der installierten App;
- das Teilen-Menü;
- der Update-Hinweis in der installierten App.

Rückmeldungen dazu helfen.

Drei Rückfragen bleiben vorerst native Browser-Dialoge, weil sie beim Start
der Seite synchron laufen müssen:

- das Anwenden eines globalen Codes;
- die Zielwahl eines lokalen Codes;
- die einmalige Übernahme alter v1-Daten.

## 2026-11-10 · Datenintegrität, Navigation, PWA

Die Grundlage für das Update oben. Einzelheiten stehen in
[`docs/improvement-plan.md`](docs/improvement-plan.md), Phasen 0 bis 3.

- **Datenintegrität:**
  - jedes Event wird an einer Stelle geprüft, mit Mengenobergrenze;
  - gelöschte Action Codes kommen nicht zurück;
  - globale Codes überleben den Import;
  - Zurücksetzen vergibt keine alten Kennungen neu;
  - ein veralteter zweiter Tab überschreibt kein zurückgesetztes Wallet.
- **Navigation:**
  - Buchungen und Importe hinterlassen keine Zurück-Falle mehr;
  - Importfehler nennen den Grund und führen ins offene Wallet zurück;
  - ein zu großer QR bietet einen kompakten Link an.
- **Oberfläche und PWA:**
  - Themes mit Kontrast und sichtbarem Fokus;
  - größere Touch-Ziele;
  - Content Security Policy ohne Inline-Code;
  - App-Icons;
  - ein Service Worker, der Seiten frisch holt und offline weiterläuft;
  - Export mit Kopieren und Teilen;
  - durchgehend deutsche Texte.
- **Tests:** ein Node-Testlauf für die Logik, die CI lässt den Pages-Deploy nur
  nach grünen Tests zu.
