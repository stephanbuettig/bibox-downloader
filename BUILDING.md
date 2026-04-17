# Build-Anleitung

Diese Anleitung beschreibt, wie du den BiBox Downloader selbst kompilierst.

## Voraussetzungen

| Software | Version | Hinweis |
|---|---|---|
| Node.js | 18+ (empfohlen 20 LTS) | Node 24 funktioniert, allerdings mit Einschränkungen bei NSIS-Builds |
| npm | 9+ | Wird mit Node.js mitgeliefert |
| Betriebssystem | Windows 10/11, macOS 10.12+, Linux (x64) | Jeder Host kann nur für das eigene OS bauen |
| MS Word | Optional, nur Windows | DOC/DOCX-Konvertierung; auf Mac/Linux wird automatisch der `word-extractor`-Fallback genutzt |

## Schnell-Build (Windows)

Am einfachsten geht es mit dem mitgelieferten Build-Skript:

```cmd
build.bat
```

Das Skript führt automatisch alle Schritte aus:

1. Node.js-Version prüfen
2. `npm install` (Abhängigkeiten installieren)
3. Assets und Icons erstellen, falls nötig
4. TypeScript kompilieren (Main Process nach `dist/main/`)
5. Vite Build (Renderer/Frontend nach `dist/renderer/`)
6. electron-builder ausführen (`release/win-unpacked/`)
7. ZIP-Archiv erstellen (`release/BiBox-Downloader-1.0.0.zip`)

## Manueller Build (Schritt für Schritt)

### 1. Abhängigkeiten installieren

```bash
npm install
```

### 2. TypeScript kompilieren (Main Process)

```bash
npx tsc -p tsconfig.main.json
```

Kompiliert alle `src/main/**/*.ts` Dateien nach `dist/main/`. Die `tsconfig.main.json` nutzt ES2022 als Target, CommonJS als Modulsystem (Electron Main Process erfordert CJS) und hat die strikte Typprüfung aktiviert.

### 3. Vite Build (Renderer/Frontend)

```bash
npx vite build
```

Baut das React-Frontend nach `dist/renderer/`. Die Konfiguration in `vite.config.ts` nutzt React 19 mit dem offiziellen Vite-Plugin und setzt den Base-Path auf `./` für Electron file://-Kompatibilität.

### 4. Electron-Builder (App paketieren)

```bash
# Code-Signing deaktivieren, da keine Zertifikate nötig
set CSC_IDENTITY_AUTO_DISCOVERY=false

npx electron-builder --win --dir
```

Erstellt die portable App in `release/win-unpacked/`.

## Schnell-Build (macOS)

Auf macOS (getestet auf Apple Silicon, arm64):

```bash
npm install
npm run dist:mac
```

Ergebnis: `release/BiBox Downloader-1.0.0-arm64.dmg` (~103 MB). Die DMG lässt sich per Doppelklick mounten; die App wird dann in den Programme-Ordner gezogen.

Hinweise:

- Code-Signing wird übersprungen, da kein Apple Developer Zertifikat konfiguriert ist. Beim ersten Start zeigt macOS deshalb eine Gatekeeper-Warnung; via Rechtsklick → „Öffnen" bestätigen oder in den Systemeinstellungen freigeben.
- Für einen Intel-Build (x64) zusätzlich `--x64` übergeben: `npx electron-builder --mac dmg --x64`.
- Die DOC/DOCX-Konvertierung nutzt auf macOS automatisch den `word-extractor`-Fallback, da MS Word COM nur unter Windows verfügbar ist.

## Schnell-Build (Linux)

```bash
npm install
npm run dist:linux
```

Ergebnis: `release/BiBox Downloader-1.0.0.AppImage`. Ausführbar machen und direkt starten:

```bash
chmod +x release/BiBox\ Downloader-1.0.0.AppImage
./release/BiBox\ Downloader-1.0.0.AppImage
```

Für AppImage wird `libfuse2` auf dem Zielsystem benötigt (auf Ubuntu 22.04+ als `libfuse2t64` paketiert).

## Build-Targets

| Target | Befehl | Ergebnis | Status |
|---|---|---|---|
| Directory | `npm run dist` | `release/win-unpacked/` | Funktioniert |
| NSIS Installer | `npm run dist:win` | `.exe` Setup | Erfordert Node 20 LTS |
| Portable .exe | (in electron-builder.yml aktivieren) | Single `.exe` | Erfordert Node 20 LTS |
| Linux AppImage | `npm run dist:linux` | `.AppImage` | Funktioniert |
| macOS DMG (arm64) | `npm run dist:mac` | `.dmg` | Funktioniert (getestet auf macOS 25.1) |
| macOS DMG (x64) | `npx electron-builder --mac dmg --x64` | `.dmg` | Funktioniert |

### Hinweis zu NSIS/Portable Builds

Die NSIS- und Portable-Targets sind in `electron-builder.yml` auskommentiert, weil `app-builder-bin` unter Node.js v24 nicht richtig funktioniert. So aktivierst du sie:

1. Node.js 20 LTS installieren (nodejs.org)
2. `node_modules/` löschen und `npm install` erneut ausführen
3. In `electron-builder.yml` die NSIS/Portable-Sektionen einkommentieren
4. `npm run dist:win` ausführen

## Bekannte Build-Probleme

### winCodeSign Symlink-Fehler

```
Error: EPERM: operation not permitted, symlink
```

Dieser Fehler tritt auf, wenn der Windows-Entwicklermodus nicht aktiviert ist. Der `dir`-Target-Build funktioniert trotzdem, da kein Code-Signing verwendet wird. Um den Fehler zu vermeiden, kannst du unter Windows-Einstellungen den Entwicklermodus aktivieren.

### macOS: Icon muss als .icns vorliegen

electron-builder erwartet für den Mac-Target zwingend `assets/icons/icon.icns` (konfiguriert in `electron-builder.yml`). Fehlt die Datei oder ist sie kleiner als 512×512, bricht der Build mit einem Go-Panic im Icon-Converter ab. Die `.icns` lässt sich auf macOS aus der vorhandenen `icon.png` erzeugen:

```bash
mkdir icon.iconset
sips -z 16 16     assets/icons/icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     assets/icons/icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     assets/icons/icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     assets/icons/icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   assets/icons/icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   assets/icons/icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   assets/icons/icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   assets/icons/icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   assets/icons/icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 assets/icons/icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o assets/icons/icon.icns
```

### node_modules Korruption

Falls `npm install` nach einem abgebrochenen Build fehlschlägt:

```cmd
rmdir /s /q node_modules
npm install
```

Falls `rmdir` nicht funktioniert, schließe alle Programme (VS Code, Terminal, Electron), starte den Rechner neu und führe `build.bat` direkt aus.

## Entwicklungsmodus

```bash
# Startet TypeScript-Compiler (Watch) und Vite Dev Server parallel
npm run dev
```

Oder einzeln:

```bash
npm run dev:main      # TypeScript Watch-Modus
npm run dev:renderer  # Vite Dev Server (Hot Reload)
npm start             # Electron starten (nachdem kompiliert)
```

## Verzeichnisstruktur nach dem Build

```
bibox-downloader/
  dist/
    main/           # Kompiliertes TypeScript (Main Process)
    renderer/       # Vite-Build (React Frontend)
  release/
    win-unpacked/   # Fertige portable App
      BiBox Downloader.exe
      resources/    # App-Code und Electron-Ressourcen
      ...
    BiBox-Downloader-1.0.0.zip
```
