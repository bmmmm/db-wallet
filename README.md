# db-wallet

Ein leichtes, vollständig browserbasiertes Getränke‑Wallet — **ohne Datenbank, ohne Backend, ohne Server**.  
Alle Daten werden lokal im Browser gespeichert und können per Export-Link oder JSON-Datei übertragen werden.

---

## 🎯 Was macht db-wallet?
db-wallet ist ein kleines Tool, um Getränkeverbrauch, Korrekturen, Guthaben und Zahlungen zu verwalten.  
Ideal für WG‑Kassen, Hackspaces, Vereinsräume oder private Kühlschränke.

Jeder Nutzer hat ein eigenes Wallet – erreichbar über eine URL wie:

```
wallet.html#peter
```

Alle Daten sind **lokal**, **offline nutzbar** und bleiben isoliert im Browser des jeweiligen Geräts.

---

## 🧩 Hauptfunktionen

### 🥤 Getränke buchen
- +1 oder mehrere Getränke hinzufügen  
- Automatische Tagesstatistik  
- Übersichtliche Historie

### ↩️ Korrekturen
- Getränke zurücknehmen  
- Nur so weit möglich, wie Guthaben bzw. offene Getränke vorhanden sind

### 💸 Bezahlen
- Offene Getränke bezahlen  
- Nur möglich, wenn tatsächlich offene Getränke existieren  
- Zahlungspunkte erscheinen in der Historie

### 💰 Guthaben aufladen
- Guthaben als „Gutschrift“ buchen  
- Kann wie ein Vorrat aufgebraucht werden  
- Es ist unmöglich, mehr Guthaben zurückzugeben, als vorhanden ist

---

## 📊 Historie & Analyse

db-wallet zeigt drei Arten von Auswertungen:

### **1. Log-Ansicht (chronologisch)**
- Jeder Eintrag einzeln sichtbar  
- Bearbeiten oder Löschen einzelner IDs möglich  
- Ranges wie `3-5,7,9` werden unterstützt

### **2. Diagramm-Ansicht**
Einfaches Textdiagramm, z. B.:

```
2025-12-12 | ##  
2025-12-13 | ###
```

### **3. Raw-Daten**
- Aktueller Nutzer oder alle Nutzer  
- Perfekt zur Fehlersuche oder zum manuellen Export

---

## 🔄 Export & Import

### **Export‑Modi**
- 🔗 **Export-Link** (portabel, URL‑basiert, wird automatisch beim Öffnen importiert)  
- 📄 **JSON‑Datei exportieren**

### **Import‑Modi**
- Öffnen eines Export-Links: automatische Zusammenführung  
- JSON-Datei in der Startseite hochladen

db-wallet erkennt identische Events per ID und verhindert Duplikate.

---

## 🧹 Verwaltung

### ✏️ Logbuch bearbeiten
- Datum ändern  
- Menge ändern  
- Zeitstempel aktualisieren

### 🗑️ Nutzerverwaltung
Auf der Startseite:
- Einzelne Nutzer löschen  
- Mehrere Nutzer gleichzeitig löschen  
- **💣 Alle lokalen Nutzer löschen (Nuke All)**

---

## 🗂️ Dateien

| Datei | Zweck |
|-------|-------|
| [`index.html`](./index.html) | Startseite, Nutzerwahl, Import, Übersicht |
| [`wallet.html`](./wallet.html) | Hauptinterface für Getränke, Guthaben, Zahlungen, Historie |
| [`README.md`](./README.md) | Dokumentation |

---

## 🚀 GitHub Pages Deployment

1. Repository pushen  
2. In GitHub: **Settings → Pages → Deploy from branch → main / root**  
3. Fertig!  
   Live-Version:  
   https://bmmmm.github.io/db-wallet/

---

Viel Spaß mit deinem minimalistischen, schnellen und erstaunlich mächtigen Getränke‑Wallet 🍹🚀