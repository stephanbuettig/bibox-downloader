# Entwicklerdokumentation und Learnings

Dieses Dokument fasst die Architekturentscheidungen, gelöste Probleme und Erkenntnisse aus der Entwicklung des BiBox Downloaders zusammen. Es dient als Wissensbasis für die Weiterentwicklung.

## Architektur-Überblick

### Electron-Architektur (Main ↔ Renderer)

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

1. User wählt Buch in der LibraryGrid-Komponente
2. `download-store.ts` sendet IPC-Aufruf an Main Process
3. `engine.ts` orchestriert den Download:
   a. Buchdaten von BiBox-API abrufen (inkl. ETag-Cache)
   b. Seiten herunterladen (parallele PNG-Downloads mit Rate Limiting)
   c. Materialien herunterladen (PDF, DOCX, DOC, Bilder, Audio)
   d. PDF-Buch aus Seiten-PNGs zusammenbauen (`builder.ts`)
   e. Materialien-Sammel-PDF erstellen (`materials-pdf-builder.ts`)
4. Fortschritt wird via IPC-Events an den Renderer gestreamt

## Kritische Learnings

### 1. PDF-Verschlüsselung (AES-128, V=4, R=4)

**Problem**: Viele BiBox-Arbeitsblätter sind mit Owner-Password verschlüsselt. Beim Zusammenfügen der Materialien-PDF erscheinen diese als leere Seiten.

**Getestete Methoden**:

| Methode | Ergebnis | Details |
|---|---|---|
| pdf-lib `ignoreEncryption: true` | Leere Seiten | Kopiert verschlüsselte Bytes, entschlüsselt nicht |
| Byte-Manipulation (/Encrypt entfernen) | Leere Seiten | Content-Streams bleiben verschlüsselt |
| Word COM (`Documents.Open`) | Timeout/Fehler | Word zeigt PDF-Konvertierungsdialog, hängt in Non-Interactive-Modus |
| Word COM mit `ConfirmConversions=$false` | Berechtigungsfehler | "Autor hat Berechtigungen festgelegt, die keine Wiederverwendung erlauben" |
| Edge Headless `--print-to-pdf` | Keine Ausgabe | Chromium meldet "Multiple targets not supported in headless mode" |
| **Electron `BrowserWindow.loadURL` + `printToPDF`** | **Funktioniert!** | Chromium rendert die PDF nativ und gibt sie entschlüsselt aus |

**Lösung**: `decryptPdfViaChromium()` in `materials-pdf-builder.ts`:
- Erstellt unsichtbares `BrowserWindow` mit `plugins: true`
- Lädt die verschlüsselte PDF via `file://`-URI
- Wartet 2.5 Sekunden für das Rendering
- `webContents.printToPDF()` erzeugt entschlüsseltes PDF
- Validiert Ausgabe auf Mindestgröße (>5KB)

**Warum das funktioniert**: Chromiums eingebauter PDF-Viewer (PDFium) kann PDFs mit leerem User-Password nativ öffnen. `printToPDF()` erzeugt eine neue, unverschlüsselte PDF aus dem gerenderten Inhalt.

### 2. Word COM — Apostrophe in Dateinamen

**Problem**: Dateinamen wie `Sonata_pian'_e_forte.docx` oder `I've_got_you.docx` brechen die PowerShell-Ausführung, weil das Apostroph die PS-String-Literale beendet.

**Fehler im Log**: `Unerwartetes Token "_e_forte_-_Lösungen.docx'"` — das `'` im Dateinamen beendete den PS-String vorzeitig.

**Lösung**: Statt Dateipfade direkt im PowerShell-Skript einzubetten, wird eine separate `_filelist.txt` geschrieben mit `inputPath|outputPath` pro Zeile. Das PS-Skript liest diese via `Get-Content -LiteralPath` und `$line.Split("|", 2)`. So werden Sonderzeichen in Dateinamen komplett vermieden.

### 3. Magic-Byte-Erkennung für unbekannte Dateitypen

**Problem**: BiBox liefert manche Dateien als `application/octet-stream`. Ohne korrekte Erkennung wurden diese als nutzlose `.bin`-Dateien gespeichert.

**Lösung**: `detectMimeByMagicBytes()` in `material-downloader.ts` prüft die ersten Bytes:

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

Unbekannte Dateien (`'unknown'`) werden übersprungen statt als `.bin` gespeichert.

### 4. A4-Dimensionen statt Cover-Page-Pixel

**Problem**: Die Materialien-PDF verwendete die Pixel-Dimensionen des Cover-PNGs (z.B. 2244x3071 Pixel) als Seitengröße. Dadurch waren eingebettete A4-PDFs winzig.

**Lösung**: `refPageWidth`/`refPageHeight` werden immer auf A4 (595.28 x 841.89 PDF-Punkte) gesetzt, statt die Cover-Größe zu erkennen.

### 5. PowerShell-Encoding auf Windows

**Problem**: PowerShell-Skripte die von Node.js geschrieben und ausgeführt werden, müssen UTF-8 BOM + CRLF-Zeilenenden haben, damit Windows PowerShell sie korrekt parst.

**Lösung**: Alle dynamisch generierten PS-Skripte werden mit `Buffer.from([0xEF, 0xBB, 0xBF])` (BOM) vorangestellt und mit `\r\n` (CRLF) als Zeilentrenner geschrieben.

### 6. Electron + Node.js Version Kompatibilität

**Wichtig**: Electron 34 bringt intern **Node.js v20.19.1** mit, auch wenn auf dem System Node.js v24 läuft. Das bedeutet:
- **Zur Laufzeit** nutzt die App Node.js v20 Features (Electrons eingebautes Node)
- **Beim Build** nutzt `electron-builder` das System-Node.js
- `app-builder-bin` (Dependency von electron-builder) hat unter Node.js v24 Probleme mit NSIS-Targets
- **Empfehlung**: Zum Bauen Node.js 20 LTS verwenden, oder nur `dir`-Target nutzen

### 7. Rate Limiting und BiBox-API

Die BiBox-API wird mit folgenden Parametern angesprochen:
- Max. 3 parallele Verbindungen (`p-queue`)
- 200ms Delay zwischen Anfragen
- ETag-basiertes Caching für API-Antworten
- Automatische Retry-Logik bei 429/503-Fehlern

Diese Parameter schützen den Server und vermeiden IP-Sperren.

## Datei-Referenz

### Main Process (Kern-Logik)

| Datei | Verantwortung |
|---|---|
| `src/main/index.ts` | App-Start, BrowserWindow, Auto-Update-Check |
| `src/main/preload.ts` | contextBridge — sichere IPC-Brücke zum Renderer |
| `src/main/api/bibox-api.ts` | BiBox 2.0 REST-API (Buchliste, Seiten, Materialien) |
| `src/main/api/client.ts` | HTTP-Client (undici) mit Auth-Header-Injection |
| `src/main/api/etag-cache.ts` | ETag-basierter Response-Cache |
| `src/main/auth/oauth.ts` | OAuth2-Login (BrowserWindow-basiert) |
| `src/main/auth/token-store.ts` | Token-Persistierung (verschlüsselt) |
| `src/main/download/engine.ts` | Download-Orchestrator (Seiten + Materialien + PDF-Build) |
| `src/main/download/page-downloader.ts` | Seiten-PNG-Download mit Retry |
| `src/main/download/material-downloader.ts` | Material-Download + Magic-Byte-Erkennung |
| `src/main/download/throttle.ts` | Rate Limiter (p-queue Wrapper) |
| `src/main/download/checkpoint.ts` | Download-Fortschritt speichern/laden |
| `src/main/pdf/builder.ts` | Buch-PDF aus Seiten-PNGs zusammenbauen |
| `src/main/pdf/materials-pdf-builder.ts` | Materialien-Sammel-PDF (inkl. PDF-Entschlüsselung) |
| `src/main/pdf/word-to-pdf-converter.ts` | DOC/DOCX → PDF via Word COM oder Textextraktion |
| `src/main/storage/file-organizer.ts` | Datei-Ablage + MIME-Type-Mapping |
| `src/main/storage/disk-check.ts` | Festplattenplatz prüfen |
| `src/main/storage/json-store.ts` | Persistenter JSON-Speicher |
| `src/main/logging/logger.ts` | Strukturierter File+Console-Logger |

### Renderer (UI)

| Datei | Verantwortung |
|---|---|
| `src/renderer/App.tsx` | Haupt-App-Komponente + Routing |
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

1. **TypeScript strikt halten**: `npx tsc --noEmit` prüft alle Typen ohne zu kompilieren
2. **Neue Dateitypen**: Magic Bytes in `material-downloader.ts` und MIME-Mapping in `file-organizer.ts` ergänzen
3. **PDF-Entschlüsselung**: Falls künftige PDFs andere Verschlüsselung nutzen, die `decryptPdfViaChromium()`-Wartezeit (2500ms) erhöhen oder `qpdf` als Fallback einbauen
4. **Electron-Update**: Bei Electron-Major-Updates die `BrowserWindow`-API-Kompatibilität prüfen, besonders `printToPDF()` Optionen
5. **Linux/macOS**: Grundsätzlich plattformunabhängig, aber Word-COM-Konvertierung ist Windows-only. Auf Linux/macOS werden DOC/DOCX nur via Textextraktion konvertiert
