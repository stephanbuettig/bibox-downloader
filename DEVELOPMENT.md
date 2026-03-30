# Entwicklerdokumentation

Dieses Dokument fasst die Architekturentscheidungen und gelösten Probleme aus der Entwicklung des BiBox Downloaders zusammen. Es dient als Wissensbasis für die Weiterentwicklung.

## Architektur

### Electron-Architektur (Main und Renderer)

```
┌─────────────────────────────────────────────────┐
│  Renderer Process (React 19 + Zustand 5)        │
│  ┌─────────────┐  ┌──────────┐  ┌───────────┐  │
│  │ LoginScreen  │  │ Library  │  │ Progress  │  │
│  │ (OAuth)      │  │ Grid     │  │ View      │  │
│  └──────┬───────┘  └────┬─────┘  └─────┬─────┘  │
│         │               │              │         │
│         └───── contextBridge (preload.ts) ───────│
│                         │                        │
├─────────────────────────┼────────────────────────┤
│  Main Process           │                        │
│  ┌──────────┐  ┌────────┴───────┐  ┌──────────┐ │
│  │ OAuth    │  │ Download       │  │ PDF      │ │
│  │ + Token  │  │ Engine         │  │ Builder  │ │
│  │ Store    │  │ + Throttle     │  │ + Word   │ │
│  └──────────┘  │ + Checkpoint   │  │ Conv.    │ │
│                │ + Materials DL │  └──────────┘ │
│                └────────────────┘               │
│  ┌──────────────────────────────────────────┐   │
│  │ BiBox API Client (undici + ETag Cache)   │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Datenfluss eines Downloads

1. Der Nutzer wählt ein Buch in der LibraryGrid-Komponente
2. `download-store.ts` sendet einen IPC-Aufruf an den Main Process
3. `engine.ts` orchestriert den Download:
   - Buchdaten von der BiBox-API abrufen (mit ETag-Cache)
   - Seiten herunterladen (parallele PNG-Downloads mit Rate Limiting)
   - Materialien herunterladen (PDF, DOCX, DOC, Bilder, Audio)
   - PDF-Buch aus den Seiten-PNGs zusammenbauen (`builder.ts`)
   - Materialien-Sammel-PDF erstellen (`materials-pdf-builder.ts`)
4. Der Fortschritt wird über IPC-Events an den Renderer gestreamt

## Gelöste Probleme

### 1. PDF-Verschlüsselung (AES-128, V=4, R=4)

Viele BiBox-Arbeitsblätter sind mit einem Owner-Password verschlüsselt. Beim Zusammenfügen der Materialien-PDF erscheinen diese Seiten leer.

Wir haben sechs Methoden getestet:

| Methode | Ergebnis | Details |
|---|---|---|
| pdf-lib `ignoreEncryption: true` | Leere Seiten | Kopiert die verschlüsselten Bytes, entschlüsselt aber nicht |
| Byte-Manipulation (/Encrypt entfernen) | Leere Seiten | Die Content-Streams bleiben verschlüsselt |
| Word COM (`Documents.Open`) | Timeout | Word zeigt einen Konvertierungsdialog und hängt im Non-Interactive-Modus |
| Word COM mit `ConfirmConversions=$false` | Berechtigungsfehler | Word meldet, dass der Autor die Wiederverwendung nicht erlaubt |
| Edge Headless `--print-to-pdf` | Keine Ausgabe | Chromium meldet "Multiple targets not supported in headless mode" |
| **Electron `BrowserWindow.loadURL` + `printToPDF`** | **Funktioniert** | Chromium rendert die PDF nativ und gibt sie entschlüsselt aus |

Die Lösung steckt in `decryptPdfViaChromium()` in `materials-pdf-builder.ts`. Ein unsichtbares `BrowserWindow` mit `plugins: true` lädt die verschlüsselte PDF über eine `file://`-URI. Nach 2,5 Sekunden Wartezeit für das Rendering erzeugt `webContents.printToPDF()` ein entschlüsseltes PDF. Die Ausgabe wird auf eine Mindestgröße von 5 KB geprüft.

Das funktioniert, weil Chromiums eingebauter PDF-Viewer (PDFium) PDFs mit leerem User-Password nativ öffnen kann. `printToPDF()` erzeugt daraus eine neue, unverschlüsselte PDF.

### 2. Apostrophe in Dateinamen (Word COM)

Dateinamen wie `Sonata_pian'_e_forte.docx` brechen die PowerShell-Ausführung, weil das Apostroph den PS-String vorzeitig beendet.

Statt Dateipfade direkt im PowerShell-Skript einzubetten, wird jetzt eine separate `_filelist.txt` geschrieben. Jede Zeile enthält `inputPath|outputPath`. Das PS-Skript liest diese per `Get-Content -LiteralPath` und splittet am Pipe-Zeichen. So werden Sonderzeichen in Dateinamen komplett umgangen.

### 3. Magic-Byte-Erkennung für unbekannte Dateitypen

BiBox liefert manche Dateien als `application/octet-stream`. Ohne Erkennung wurden diese als nutzlose `.bin`-Dateien gespeichert.

`detectMimeByMagicBytes()` in `material-downloader.ts` prüft jetzt die ersten Bytes:

```
49 44 33       → MP3 (ID3 Tag)
FF FB/F3/F2    → MP3 (Sync Word)
52 49 46 46    → WAV/FLAC (RIFF Container)
66 4C 61 43    → FLAC
4F 67 67 53    → OGG
4D 54 68 64    → MIDI
00 00 00 xx 66 74 79 70 → M4A/MP4 (ftyp Box)
1A 45 DF A3    → WebM/MKV
25 50 44 46    → PDF
50 4B          → ZIP/DOCX
89 50 4E 47    → PNG
FF D8 FF       → JPEG
47 49 46       → GIF
```

Unbekannte Dateien werden übersprungen statt als `.bin` gespeichert.

### 4. A4-Dimensionen statt Cover-Pixel

Die Materialien-PDF verwendete die Pixel-Dimensionen des Cover-PNGs (z.B. 2244x3071 Pixel) als Seitengröße. Dadurch waren eingebettete A4-PDFs winzig.

Die Lösung ist einfach: `refPageWidth` und `refPageHeight` werden immer auf A4 gesetzt (595.28 × 841.89 PDF-Punkte).

### 5. PowerShell-Encoding auf Windows

PowerShell-Skripte, die von Node.js geschrieben und ausgeführt werden, müssen UTF-8 BOM und CRLF-Zeilenenden haben. Ohne diese Kombination kann Windows PowerShell die Dateien nicht korrekt lesen.

Alle dynamisch generierten PS-Skripte bekommen deshalb einen BOM-Header (`Buffer.from([0xEF, 0xBB, 0xBF])`) und `\r\n` als Zeilentrenner.

### 6. Electron und Node.js Versionsunterschiede

Electron 34 bringt intern **Node.js v20.19.1** mit, auch wenn auf dem System Node.js v24 installiert ist. Zur Laufzeit nutzt die App also Node.js v20 Features. Beim Build nutzt `electron-builder` dagegen das System-Node.js. Das `app-builder-bin`-Paket (Dependency von electron-builder) hat unter Node.js v24 Probleme mit NSIS-Targets. Zum Bauen sollte deshalb am besten Node.js 20 LTS verwendet werden, oder man nutzt nur das `dir`-Target.

### 7. Rate Limiting für die BiBox-API

Die BiBox-API wird mit folgenden Parametern angesprochen:

- Maximal 3 parallele Verbindungen (`p-queue`)
- 200ms Pause zwischen Anfragen
- ETag-basiertes Caching für API-Antworten
- Automatische Retry-Logik bei 429/503-Fehlern

Diese Parameter schützen den Server und vermeiden IP-Sperren.

## Datei-Referenz

### Main Process (Kern-Logik)

| Datei | Aufgabe |
|---|---|
| `src/main/index.ts` | App-Start, BrowserWindow, Auto-Update-Check |
| `src/main/preload.ts` | contextBridge, sichere IPC-Brücke zum Renderer |
| `src/main/api/bibox-api.ts` | BiBox 2.0 REST-API (Buchliste, Seiten, Materialien) |
| `src/main/api/client.ts` | HTTP-Client (undici) mit Auth-Header-Injection |
| `src/main/api/etag-cache.ts` | ETag-basierter Response-Cache |
| `src/main/auth/oauth.ts` | OAuth2-Login (BrowserWindow-basiert) |
| `src/main/auth/token-store.ts` | Token-Persistierung (verschlüsselt) |
| `src/main/download/engine.ts` | Download-Orchestrator (Seiten + Materialien + PDF-Build) |
| `src/main/download/page-downloader.ts` | Seiten-PNG-Download mit Retry |
| `src/main/download/material-downloader.ts` | Material-Download und Magic-Byte-Erkennung |
| `src/main/download/throttle.ts` | Rate Limiter (p-queue Wrapper) |
| `src/main/download/checkpoint.ts` | Download-Fortschritt speichern und laden |
| `src/main/pdf/builder.ts` | Buch-PDF aus Seiten-PNGs zusammenbauen |
| `src/main/pdf/materials-pdf-builder.ts` | Materialien-Sammel-PDF, inklusive Entschlüsselung |
| `src/main/pdf/word-to-pdf-converter.ts` | DOC/DOCX zu PDF über Word COM oder Textextraktion |
| `src/main/storage/file-organizer.ts` | Datei-Ablage und MIME-Type-Mapping |
| `src/main/storage/disk-check.ts` | Festplattenplatz prüfen |
| `src/main/storage/json-store.ts` | Persistenter JSON-Speicher |
| `src/main/logging/logger.ts` | Strukturierter File- und Console-Logger |

### Renderer (UI)

| Datei | Aufgabe |
|---|---|
| `src/renderer/App.tsx` | Haupt-App-Komponente und Routing |
| `src/renderer/components/LoginScreen.tsx` | BiBox-Login (OAuth2) |
| `src/renderer/components/LibraryGrid.tsx` | Buchregal-Ansicht |
| `src/renderer/components/BookCard.tsx` | Einzelne Buchkarte |
| `src/renderer/components/DownloadConfig.tsx` | Download-Einstellungen |
| `src/renderer/components/ProgressView.tsx` | Fortschrittsanzeige |
| `src/renderer/components/ResultView.tsx` | Ergebnis-Ansicht |
| `src/renderer/components/ResumeDialog.tsx` | Dialog zum Fortsetzen |
| `src/renderer/components/SplashScreen.tsx` | Ladebildschirm |
| `src/renderer/stores/auth-store.ts` | Auth-State (Zustand) |
| `src/renderer/stores/books-store.ts` | Buchliste-State (Zustand) |
| `src/renderer/stores/download-store.ts` | Download-State (Zustand) |

## Tipps für die Weiterentwicklung

1. **TypeScript strikt halten:** `npx tsc --noEmit` prüft alle Typen ohne zu kompilieren
2. **Neue Dateitypen:** Magic Bytes in `material-downloader.ts` und MIME-Mapping in `file-organizer.ts` ergänzen
3. **PDF-Entschlüsselung:** Falls künftige PDFs andere Verschlüsselungen nutzen, die Wartezeit in `decryptPdfViaChromium()` (2500ms) erhöhen oder `qpdf` als Fallback einbauen
4. **Electron-Update:** Bei Major-Updates die `BrowserWindow`-API-Kompatibilität prüfen, besonders die `printToPDF()`-Optionen
5. **Linux/macOS:** Die App ist grundsätzlich plattformunabhängig, aber die Word-COM-Konvertierung funktioniert nur unter Windows. Auf Linux und macOS werden DOC/DOCX-Dateien nur per Textextraktion konvertiert
