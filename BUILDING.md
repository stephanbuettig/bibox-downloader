# Build-Anleitung

Detaillierte Anleitung zum Kompilieren und Bauen des BiBox Downloaders.

## Voraussetzungen

| Software | Version | Hinweis |
|---|---|---|
| Node.js | 18+ (empfohlen: 20 LTS) | Node 24 funktioniert, hat aber Einschraenkungen bei NSIS-Builds |
| npm | 9+ | Wird mit Node.js mitgeliefert |
| Windows | 10/11 (64-bit) | Fuer den Build und die Ausfuehrung |
| MS Word | Optional | Nur fuer DOC/DOCX → PDF Konvertierung zur Laufzeit |

## Schnell-Build (Windows)

Der einfachste Weg ist das mitgelieferte Build-Skript:

```cmd
build.bat
```

Das Skript fuehrt alle 7 Schritte automatisch aus:

1. Node.js-Version pruefen
2. `npm install` (Abhaengigkeiten)
3. Assets/Icons erstellen (falls noetig)
4. TypeScript kompilieren (Main Process → `dist/main/`)
5. Vite Build (Renderer/Frontend → `dist/renderer/`)
6. electron-builder (`release/win-unpacked/`)
7. ZIP-Archiv erstellen (`release/BiBox-Downloader-1.0.0.zip`)

## Manueller Build (Schritt fuer Schritt)

### 1. Abhaengigkeiten installieren

```bash
npm install
```

### 2. TypeScript kompilieren (Main Process)

```bash
npx tsc -p tsconfig.main.json
```

Kompiliert alle `src/main/**/*.ts` Dateien nach `dist/main/`. Die Konfiguration in `tsconfig.main.json`:

- Target: ES2022
- Module: CommonJS (Electron Main Process erfordert CJS)
- Strikte Typpruefung aktiviert

### 3. Vite Build (Renderer/Frontend)

```bash
npx vite build
```

Baut das React-Frontend nach `dist/renderer/`. Konfiguration in `vite.config.ts`:

- React 19 mit dem offiziellen Vite-Plugin
- Output: `dist/renderer/`
- Base-Path: `./ `(relativ, fuer Electron file:// Kompatibilitaet)

### 4. Electron-Builder (App paketieren)

```bash
# Code-Signing deaktivieren (keine Zertifikate noetig)
set CSC_IDENTITY_AUTO_DISCOVERY=false

npx electron-builder --win --dir
```

Erstellt die portable App in `release/win-unpacked/`.

## Build-Targets

| Target | Befehl | Ergebnis | Status |
|---|---|---|---|
| Directory | `npm run dist` | `release/win-unpacked/` | Funktioniert |
| NSIS Installer | `npm run dist:win` | `.exe` Setup | Erfordert Node 20 LTS |
| Portable .exe | (in electron-builder.yml aktivieren) | Single `.exe` | Erfordert Node 20 LTS |
| Linux AppImage | `npm run dist:linux` | `.AppImage` | Nicht getestet |
| macOS DMG | `npm run dist:mac` | `.dmg` | Nicht getestet |

### Hinweis zu NSIS/Portable Builds

Die NSIS- und Portable-Targets sind in `electron-builder.yml` auskommentiert, weil `app-builder-bin` unter Node.js v24 Kompatibilitaetsprobleme hat. Um diese Targets zu nutzen:

1. Node.js 20 LTS installieren (nodejs.org)
2. `node_modules/` loeschen und `npm install` erneut ausfuehren
3. In `electron-builder.yml` die NSIS/Portable-Sektionen einkommentieren
4. `npm run dist:win` ausfuehren

## Bekannte Build-Probleme

### winCodeSign Symlink-Fehler

```
Error: EPERM: operation not permitted, symlink
```

Tritt auf, wenn Windows keinen Entwicklermodus aktiviert hat. Der `dir`-Target-Build funktioniert trotzdem, da kein Code-Signing verwendet wird. Um den Fehler zu vermeiden: Windows-Einstellungen → Fuer Entwickler → Entwicklermodus aktivieren.

### node_modules Korruption

Falls `npm install` nach einem abgebrochenen Build fehlschlaegt:

```cmd
rmdir /s /q node_modules
npm install
```

Falls `rmdir` fehlschlaegt: Alle Programme schliessen (VS Code, Terminal, Electron), Rechner neustarten und sofort `build.bat` erneut ausfuehren.

## Entwicklungsmodus

```bash
# Startet Main-Process-Compiler (Watch) + Vite Dev Server parallel
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
      resources/    # App-Code + Electron-Ressourcen
      ...
    BiBox-Downloader-1.0.0.zip  # ZIP-Archiv (Fallback)
```
