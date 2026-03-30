<p align="center">
  <img src="assets/icons/icon.png" alt="BiBox Downloader" width="100"/>
</p>

<h1 align="center">BiBox Downloader</h1>

<p align="center">
  <strong>Schulbücher & Lernmaterialien offline verfügbar machen</strong><br/>
  <sub>Portable Desktop-App für die <a href="https://bibox2.westermann.de">Westermann BiBox 2.0</a></sub>
</p>

<p align="center">
  <a href="https://github.com/stephanbuettig/bibox-downloader/releases/latest"><img src="https://img.shields.io/github/v/release/stephanbuettig/bibox-downloader?style=flat-square&label=Download&color=28a745" alt="Latest Release"/></a>&nbsp;
  <img src="https://img.shields.io/github/downloads/stephanbuettig/bibox-downloader/total?style=flat-square&color=blue" alt="Downloads"/>&nbsp;
  <img src="https://img.shields.io/badge/electron-34-47848F?style=flat-square&logo=electron" alt="Electron 34"/>&nbsp;
  <img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="React 19"/>&nbsp;
  <img src="https://img.shields.io/badge/typescript-5.7-3178C6?style=flat-square&logo=typescript" alt="TypeScript"/>&nbsp;
  <img src="https://img.shields.io/github/license/stephanbuettig/bibox-downloader?style=flat-square" alt="License"/>
</p>

<p align="center">
  <a href="https://github.com/stephanbuettig/bibox-downloader/releases/latest">
    <img src="https://img.shields.io/badge/%E2%AC%87%EF%B8%8F_Download-Windows_%7C_Linux-28a745?style=for-the-badge" alt="Download"/>
  </a>
</p>

---

## Was ist das?

Der **BiBox Downloader** lädt Schulbücher und Lernmaterialien aus deinem BiBox-Account herunter und speichert sie offline — als hochauflösende PNGs, zusammengefasste PDFs und sortierte Materialien-Sammlungen. Einmal herunterladen, überall nutzen — ohne Internet, ohne App, ohne DRM-Einschränkungen.

> **Hinweis:** Du benötigst einen gültigen BiBox-Account mit lizenzierten Büchern. Dieses Tool lädt nur Inhalte herunter, für die du bereits eine Lizenz besitzt.

---

## Download

<table>
<tr>
<td align="center" width="50%">

**Windows** (x64)

[BiBox-Downloader-v1.0.0-win-x64.zip](https://github.com/stephanbuettig/bibox-downloader/releases/download/v1.0.0/BiBox-Downloader-v1.0.0-win-x64.zip)

~117 MB · ZIP entpacken · `BiBox Downloader.exe` starten

</td>
<td align="center" width="50%">

**Linux** (x64)

[BiBox-Downloader-v1.0.0-linux-x64.zip](https://github.com/stephanbuettig/bibox-downloader/releases/download/v1.0.0/BiBox-Downloader-v1.0.0-linux-x64.zip)

~106 MB · ZIP entpacken · `./electron` starten

</td>
</tr>
</table>

> Kein Installer nötig. Direkt von USB-Stick oder Netzlaufwerk startbar.

---

## Features

<table>
<tr><td width="30"><strong>📖</strong></td><td><strong>Buch-Download</strong> — Alle Seiten als hochauflösende PNGs + automatisch generiertes PDF</td></tr>
<tr><td><strong>📎</strong></td><td><strong>Materialien-Sammlung</strong> — Alle Arbeitsblätter, Lösungen und Zusatzmaterialien in einer einzigen PDF</td></tr>
<tr><td><strong>🔓</strong></td><td><strong>PDF-Entschlüsselung</strong> — Automatische Entschlüsselung geschützter Arbeitsblätter via Chromium (Zero Dependencies)</td></tr>
<tr><td><strong>📝</strong></td><td><strong>Word → PDF</strong> — DOC/DOCX-Dateien werden via MS Word COM oder Textextraktion konvertiert</td></tr>
<tr><td><strong>⏯️</strong></td><td><strong>Fortschritt & Resume</strong> — Echtzeit-Fortschritt, Geschwindigkeitsanzeige, abgebrochene Downloads fortsetzbar</td></tr>
<tr><td><strong>🛡️</strong></td><td><strong>Rate Limiting</strong> — Intelligente Drosselung (3 Verbindungen, 200ms Delay) — serverschonend</td></tr>
<tr><td><strong>💾</strong></td><td><strong>Portable</strong> — Kein Installer nötig — direkt von USB-Stick oder Netzlaufwerk startbar</td></tr>
</table>

---

## Schnellstart

### Option 1: Fertige App herunterladen (empfohlen)

1. **[Neuesten Release herunterladen](https://github.com/stephanbuettig/bibox-downloader/releases/latest)**
2. ZIP entpacken
3. `BiBox Downloader.exe` starten
4. Mit deinem BiBox-Account einloggen
5. Buch auswählen und herunterladen

### Option 2: Selbst kompilieren

```bash
git clone https://github.com/stephanbuettig/bibox-downloader.git
cd bibox-downloader
npm install
npm run dev        # Entwicklungsmodus
# oder
build.bat          # Produktions-Build (Windows)
```

Die fertige App liegt anschließend in `release/win-unpacked/`.

> Detaillierte Build-Anleitung: **[BUILDING.md](BUILDING.md)**

---

## Voraussetzungen

| | Voraussetzung | Hinweis |
|:---:|---|---|
| **Nutzer** | Windows 10/11 (64-bit) | Linux-Version verfügbar |
| **Nutzer** | BiBox-Account mit Lizenz | Für den Login |
| **Optional** | Microsoft Word | Für beste DOC/DOCX-Konvertierung |
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

<details>
<summary><strong>Technologie-Stack</strong></summary>

| Komponente | Technologie | Version |
|---|---|---|
| Framework | Electron | 34 |
| Frontend | React + TypeScript | 19 / 5.7 |
| State | Zustand | 5 |
| Bundler | Vite | 6 |
| PDF | pdf-lib | 1.17 |
| HTTP | undici | 6 |
| Build | electron-builder | 25 |

</details>

<details>
<summary><strong>Projektstruktur</strong></summary>

```
bibox-downloader/
├── src/
│   ├── main/                    # Electron Main Process
│   │   ├── api/                 #   BiBox API Client + ETag-Cache
│   │   ├── auth/                #   OAuth2 Login + Token-Verwaltung
│   │   ├── download/            #   Download-Engine + Materialien
│   │   ├── ipc/                 #   IPC-Handler (Main <-> Renderer)
│   │   ├── logging/             #   Strukturierter Logger
│   │   ├── pdf/                 #   PDF-Builder + Entschlüsselung
│   │   └── storage/             #   Dateiverwaltung + JSON-Store
│   ├── renderer/                # React 19 Frontend
│   │   ├── components/          #   UI-Komponenten
│   │   └── stores/              #   Zustand State Management
│   └── shared/                  # Geteilte Typen + Utils
├── dist/                        # Kompilierter Code (vorkompiliert)
├── assets/                      # Icons und Bilder
├── build.bat                    # Windows One-Click Build
├── electron-builder.yml         # Build-Konfiguration
└── package.json
```

</details>

---

## Technische Highlights

<details>
<summary><strong>🔓 PDF-Entschlüsselung via Chromium</strong></summary>

Viele BiBox-Arbeitsblätter sind mit AES-128 verschlüsselt (V=4, R=4). Nach dem Testen von 6 verschiedenen Methoden (pdf-lib, Byte-Manipulation, Word COM, Edge Headless) hat sich Electrons eingebauter Chromium-PDF-Viewer als einzige funktionierende Lösung erwiesen: Ein unsichtbares `BrowserWindow` lädt die verschlüsselte PDF, und `printToPDF()` erzeugt eine saubere, entschlüsselte Kopie — komplett ohne externe Tools.

</details>

<details>
<summary><strong>🔍 Magic-Byte-Erkennung</strong></summary>

Dateien mit unbekanntem MIME-Type (`application/octet-stream`) werden anhand ihrer ersten Bytes identifiziert: MP3, WAV, FLAC, OGG, MIDI, M4A, WebM, PDF, DOCX, PNG, JPEG, GIF — alles wird korrekt einsortiert. Unbekannte Formate werden übersprungen.

</details>

<details>
<summary><strong>📄 Word COM Batch-Konvertierung</strong></summary>

DOC/DOCX-Dateien werden über einen einzigen Word-COM-Prozess konvertiert, mit einer Dateilisten-Methode die auch Sonderzeichen in Dateinamen (Apostrophe, Umlaute) zuverlässig handhabt.

</details>

> Alle Learnings und Architekturentscheidungen: **[DEVELOPMENT.md](DEVELOPMENT.md)**

---

## Unterstützen

Wenn dir der BiBox Downloader gefällt, freue ich mich über einen kleinen Kaffee:

<p align="center">
  <a href="http://paypal.me/stephanbuettig/10">
    <img src="assets/images/paypal-spenden-button.png" alt="PayPal Spenden" width="200"/>
  </a>
</p>

---

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](LICENSE).

Die heruntergeladenen Inhalte (Schulbücher, Arbeitsblätter etc.) unterliegen dem Urheberrecht der Westermann Gruppe und dürfen nur im Rahmen der jeweiligen BiBox-Lizenz genutzt werden.

## Haftungsausschluss

Dieses Tool ist ein unabhängiges Open-Source-Projekt und steht in keiner Verbindung zur Westermann Gruppe oder BiBox. Die Nutzung erfolgt auf eigene Verantwortung.
