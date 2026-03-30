<p align="center">
  <img src="assets/icons/icon.ico" alt="BiBox Downloader" width="80"/>
</p>

<h1 align="center">BiBox Downloader</h1>

<p align="center">
  <strong>Schulbuecher &amp; Lernmaterialien offline verfuegbar machen</strong><br/>
  Portable Desktop-App fuer die <a href="https://bibox2.westermann.de">Westermann BiBox 2.0</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue?style=flat-square" alt="Version"/>
  <img src="https://img.shields.io/badge/electron-34-47848F?style=flat-square&logo=electron" alt="Electron 34"/>
  <img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="React 19"/>
  <img src="https://img.shields.io/badge/typescript-5.7-3178C6?style=flat-square&logo=typescript" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/platform-windows%20%7C%20linux-lightgrey?style=flat-square" alt="Platform"/>
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"/>
</p>

---

## Was ist das?

Der **BiBox Downloader** laedt Schulbuecher und Lernmaterialien aus deinem BiBox-Account herunter und speichert sie offline — als hochaufloesende PNGs, zusammengefasste PDFs und sortierte Materialien-Sammlungen. Einmal herunterladen, ueberall nutzen — ohne Internet, ohne App, ohne DRM-Einschraenkungen.

> **Hinweis:** Du benoetigst einen gueltigen BiBox-Account mit lizenzierten Buechern. Dieses Tool laedt nur Inhalte herunter, fuer die du bereits eine Lizenz besitzt.

---

## Features

| Feature | Beschreibung |
|:---:|---|
| **Buch-Download** | Alle Seiten als hochaufloesende PNGs + automatisch generiertes PDF |
| **Materialien-Sammlung** | Alle Arbeitsblatter, Loesungen und Zusatzmaterialien in einer einzigen PDF |
| **PDF-Entschluesselung** | Automatische Entschluesselung geschuetzter Arbeitsblatter via Chromium |
| **Word-Konvertierung** | DOC/DOCX-Dateien werden via MS Word oder Textextraktion zu PDF |
| **Fortschritt & Resume** | Echtzeit-Fortschritt, Geschwindigkeitsanzeige, abgebrochene Downloads fortsetzbar |
| **Rate Limiting** | Intelligente Drosselung (3 Verbindungen, 200ms Delay) — serverschonend |
| **Portable** | Kein Installer — direkt von USB-Stick oder Netzlaufwerk startbar |

---

## Schnellstart

### Option 1: Fertige App herunterladen (empfohlen)

1. Lade den neuesten Release herunter: [**Releases**](https://github.com/stephanbuettig/bibox-downloader/releases)
2. ZIP entpacken
3. `BiBox Downloader.exe` starten
4. Mit deinem BiBox-Account einloggen
5. Buch auswaehlen und herunterladen

### Option 2: Selbst kompilieren

```bash
# Repository klonen
git clone https://github.com/stephanbuettig/bibox-downloader.git
cd bibox-downloader

# Abhaengigkeiten installieren
npm install

# Entwicklungsmodus starten
npm run dev

# Oder: Produktions-Build (Windows)
build.bat
```

Die fertige App liegt anschliessend in `release/win-unpacked/`.

> Detaillierte Build-Anleitung: [BUILDING.md](BUILDING.md)

---

## Voraussetzungen

| | Voraussetzung | Hinweis |
|:---:|---|---|
| **Nutzer** | Windows 10/11 (64-bit) | Linux-Version verfuegbar |
| **Nutzer** | BiBox-Account mit Lizenz | Fuer den Login |
| **Optional** | Microsoft Word | Fuer beste DOC/DOCX-Konvertierung |
| **Entwickler** | Node.js 18+ (empfohlen: 20 LTS) | Zum Selbst-Kompilieren |

---

## Architektur

```
┌─────────────────────────────────────────────────────┐
│  Renderer (React 19 + Zustand 5)                    │
│  ┌────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Login      │  │ Library  │  │ Progress       │  │
│  │ (OAuth2)   │  │ Grid     │  │ + Result View  │  │
│  └─────┬──────┘  └────┬─────┘  └───────┬────────┘  │
│        └───── contextBridge (preload) ──┘           │
├─────────────────────────┬───────────────────────────┤
│  Main Process           │                           │
│  ┌──────────┐  ┌────────┴────────┐  ┌────────────┐ │
│  │ OAuth    │  │ Download Engine │  │ PDF        │ │
│  │ + Token  │  │ + Rate Limiter  │  │ Builder    │ │
│  │ Store    │  │ + Checkpoint    │  │ + Decrypt  │ │
│  └──────────┘  └─────────────────┘  └────────────┘ │
│  ┌──────────────────────────────────────────────┐   │
│  │ BiBox API Client (undici + ETag Cache)       │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## Technologie-Stack

| Komponente | Technologie | Version |
|---|---|---|
| Framework | Electron | 34 |
| Frontend | React + TypeScript | 19 / 5.7 |
| State | Zustand | 5 |
| Bundler | Vite | 6 |
| PDF | pdf-lib | 1.17 |
| HTTP | undici | 6 |
| Build | electron-builder | 25 |

---

## Projektstruktur

```
bibox-downloader/
├── src/
│   ├── main/                    # Electron Main Process
│   │   ├── api/                 #   BiBox API Client + ETag-Cache
│   │   ├── auth/                #   OAuth2 Login + Token-Verwaltung
│   │   ├── download/            #   Download-Engine + Materialien
│   │   ├── ipc/                 #   IPC-Handler (Main <-> Renderer)
│   │   ├── logging/             #   Strukturierter Logger
│   │   ├── pdf/                 #   PDF-Builder + Entschluesselung
│   │   └── storage/             #   Dateiverwaltung + JSON-Store
│   ├── renderer/                # React 19 Frontend
│   │   ├── components/          #   UI-Komponenten
│   │   └── stores/              #   Zustand State Management
│   └── shared/                  # Geteilte Typen + Utils
├── dist/                        # Kompilierter Code (vorcompiliert)
├── assets/                      # Icons und Bilder
├── build.bat                    # Windows One-Click Build
├── electron-builder.yml         # Build-Konfiguration
└── package.json
```

---

## Technische Highlights

**PDF-Entschluesselung via Chromium** — Viele BiBox-Arbeitsblatter sind mit AES-128 verschluesselt (V=4, R=4). Anstatt externe Tools wie qpdf oder Ghostscript zu verwenden, nutzt der BiBox Downloader Electrons eingebauten Chromium-PDF-Viewer: Ein unsichtbares `BrowserWindow` laedt die verschluesselte PDF, und `printToPDF()` erzeugt eine saubere, entschluesselte Kopie. Zero Dependencies.

**Magic-Byte-Erkennung** — Dateien mit unbekanntem MIME-Type (`application/octet-stream`) werden anhand ihrer ersten Bytes identifiziert: MP3, WAV, FLAC, OGG, MIDI, M4A, WebM, PDF, DOCX, PNG, JPEG, GIF — alles wird korrekt einsortiert.

**Word COM Batch-Konvertierung** — DOC/DOCX-Dateien werden ueber einen einzigen Word-COM-Prozess konvertiert, mit einer Dateilisten-Methode die auch Sonderzeichen in Dateinamen (Apostrophe, Umlaute) zuverlaessig handhabt.

> Alle Learnings und Architekturentscheidungen: [DEVELOPMENT.md](DEVELOPMENT.md)

---

## Unterstuetzen

Wenn dir der BiBox Downloader gefaellt, freue ich mich ueber einen kleinen Kaffee:

<p align="center">
  <a href="http://paypal.me/stephanbuettig/10">
    <img src="assets/images/paypal-spenden-button.png" alt="PayPal Spenden" width="200"/>
  </a>
</p>

---

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](LICENSE).

Die heruntergeladenen Inhalte (Schulbuecher, Arbeitsblatter etc.) unterliegen dem Urheberrecht der Westermann Gruppe und duerfen nur im Rahmen der jeweiligen BiBox-Lizenz genutzt werden.

---

## Haftungsausschluss

Dieses Tool ist ein unabhaengiges Open-Source-Projekt und steht in keiner Verbindung zur Westermann Gruppe oder BiBox. Die Nutzung erfolgt auf eigene Verantwortung.
