@echo off
:: ============================================================================
:: BiBox Downloader — Build Script (Portable .exe + ZIP)
:: ============================================================================
:: Erstellt:
::   1. Portable BiBox-Downloader.exe (NSIS Self-Extractor)
::   2. ZIP-Archiv (Fallback falls SmartScreen die .exe blockiert)
::
:: Voraussetzung: Node.js >= 18 muss installiert sein.
:: ============================================================================

setlocal enabledelayedexpansion

echo ============================================
echo   BiBox Downloader — Build-Skript
echo ============================================
echo.

:: --- Schritt 0: Verzeichnis pruefen ---
cd /d "%~dp0"
if not exist "package.json" (
    echo [FEHLER] package.json nicht gefunden!
    echo Dieses Skript muss im Projektverzeichnis ausgefuehrt werden.
    pause
    exit /b 1
)

:: --- Schritt 1: Node.js pruefen ---
echo [1/7] Pruefe Node.js Installation...
where node >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Node.js nicht gefunden!
    echo Bitte Node.js 18+ installieren: https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo       Node.js Version: %NODE_VERSION%

:: Pruefe Node.js Version (mindestens 18)
for /f "tokens=1 delims=v." %%a in ("%NODE_VERSION%") do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
    echo [FEHLER] Node.js 18+ erforderlich! Aktuell: %NODE_VERSION%
    pause
    exit /b 1
)

:: --- Schritt 2: npm Pakete installieren ---
echo.
echo [2/7] Installiere Abhaengigkeiten (npm install)...
echo       Dies kann beim ersten Mal einige Minuten dauern...

:: Pruefen ob node_modules korrupt ist (fehlende kritische Pakete trotz existierendem Ordner)
if exist "node_modules" (
    if not exist "node_modules\electron\package.json" (
        echo       [INFO] node_modules scheint korrupt — wird bereinigt...
        rmdir /s /q "node_modules" 2>nul
        if exist "node_modules" (
            echo       [WARNUNG] node_modules konnte nicht geloescht werden!
            echo       Bitte alle Programme schliessen, die auf diesen Ordner zugreifen
            echo       ^(VS Code, Terminal, Electron^), dann Rechner neustarten und
            echo       dieses Skript erneut ausfuehren.
            pause
            exit /b 1
        )
    )
)

call npm install 2>&1
if errorlevel 1 (
    echo.
    echo [FEHLER] npm install fehlgeschlagen!
    echo.
    echo Moegliche Loesungen:
    echo   1. Alle Programme schliessen ^(VS Code, Terminal, etc.^)
    echo   2. In CMD ausfuehren: rmdir /s /q node_modules
    echo   3. Falls rmdir fehlschlaegt: Rechner neustarten, dann sofort
    echo      dieses Skript erneut ausfuehren
    echo   4. Falls Node v24+: Node.js 20 LTS empfohlen ^(nodejs.org^)
    pause
    exit /b 1
)
echo       Abhaengigkeiten installiert.

:: --- Schritt 3: Assets-Ordner erstellen (falls noetig) ---
echo.
echo [3/7] Erstelle Asset-Verzeichnisse...

if not exist "assets\icons" (
    mkdir "assets\icons" 2>nul
)

:: Erstelle ein 256x256 Icon falls keines vorhanden
if not exist "assets\icons\icon.ico" (
    echo       [INFO] Kein Icon gefunden — generiere 256x256 Icon...
    echo       Fuer ein eigenes Icon: assets\icons\icon.ico ersetzen
    node scripts\generate-icon.js 2>nul
    if not exist "assets\icons\icon.ico" (
        echo       [WARNUNG] Icon konnte nicht erstellt werden.
        echo       Build wird trotzdem versucht.
    ) else (
        echo       Icon generiert.
    )
)

:: --- Schritt 4: TypeScript kompilieren (Main Process) ---
echo.
echo [4/7] Kompiliere TypeScript (Main Process)...

:: Aufr aeumen
if exist "dist\main" (
    rmdir /s /q "dist\main" 2>nul
)

call npx tsc -p tsconfig.main.json 2>&1
if errorlevel 1 (
    echo [FEHLER] TypeScript-Kompilierung fehlgeschlagen!
    echo Bitte TypeScript-Fehler oben beheben.
    pause
    exit /b 1
)
echo       Main Process kompiliert.

:: --- Schritt 5: Vite Build (Renderer) ---
echo.
echo [5/7] Baue Frontend (Vite Build)...

if exist "dist\renderer" (
    rmdir /s /q "dist\renderer" 2>nul
)

call npx vite build 2>&1
if errorlevel 1 (
    echo [FEHLER] Vite Build fehlgeschlagen!
    echo Bitte Fehler oben pruefen.
    pause
    exit /b 1
)
echo       Frontend gebaut.

:: --- Schritt 6: Electron-Builder (Directory Build) ---
echo.
echo [6/7] Erstelle App-Verzeichnis mit electron-builder...
echo       Dies dauert einige Minuten (Electron wird heruntergeladen)...

:: Bereinige alten release-Ordner
if exist "release\win-unpacked" (
    echo       Bereinige alten Build...
    rmdir /s /q "release\win-unpacked" 2>nul
)

:: Bereinige alten Portable-Cache im TEMP (verhindert Start von altem Code)
if exist "%TEMP%\BiBox-Downloader" (
    echo       Bereinige alten Portable-Cache in TEMP...
    rmdir /s /q "%TEMP%\BiBox-Downloader" 2>nul
)

:: Bereinige GESAMTEN winCodeSign-Cache (Symlink-Fehler bei Extraktion)
:: Die 7z-Archive enthalten macOS-Symlinks die ohne Admin/Entwicklermodus
:: nicht erstellt werden koennen. Da wir nicht signieren, brauchen wir es nicht.
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" (
    echo       Bereinige winCodeSign-Cache...
    rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" 2>nul
)

:: Code-Signing komplett deaktivieren (wir signieren nicht)
set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=
set WIN_CSC_LINK=

:: Build dir target (NSIS/portable disabled — requires Node.js v20 LTS)
call npx electron-builder --win --dir 2>&1
if errorlevel 1 (
    :: Pruefe ob der Build trotz Fehlermeldung erfolgreich war
    :: (winCodeSign-Symlink-Fehler ist nicht fatal fuer unsignierten dir-Build)
    if exist "release\win-unpacked\BiBox Downloader.exe" (
        echo.
        echo       [INFO] electron-builder meldete Fehler, aber Build war erfolgreich!
        echo       ^(winCodeSign Symlink-Warnung kann ignoriert werden^)
    ) else (
        echo.
        echo [FEHLER] electron-builder fehlgeschlagen!
        echo.
        echo Moegliche Ursachen und Loesungen:
        echo   1. Symlink-Berechtigungsfehler:
        echo      Windows-Einstellungen ^> Fuer Entwickler ^> Entwicklermodus AN
        echo   2. Kein Internet fuer Electron-Download
        echo   3. Antivirus blockiert den Build
        echo   4. Fehlende Berechtigungen im release-Ordner
        echo   5. Node.js v24 Kompatibilitaetsprobleme:
        echo      Node.js 20 LTS empfohlen ^(nodejs.org^)
        pause
        exit /b 1
    )
)

:: --- Schritt 7: ZIP-Archiv erstellen (Fallback) ---
echo.
echo [7/7] Erstelle ZIP-Archiv als Fallback...

if exist "release\win-unpacked" (
    :: Verwende PowerShell zum Erstellen des ZIP
    set "ZIP_NAME=release\BiBox-Downloader-1.0.0.zip"
    if exist "!ZIP_NAME!" del /f "!ZIP_NAME!" 2>nul
    powershell -NoProfile -Command "Compress-Archive -Path 'release\win-unpacked\*' -DestinationPath '!ZIP_NAME!' -Force" 2>&1
    if exist "!ZIP_NAME!" (
        echo       ZIP erstellt: !ZIP_NAME!
    ) else (
        echo       [WARNUNG] ZIP konnte nicht erstellt werden.
        echo       Du kannst den Ordner release\win-unpacked direkt verwenden.
    )
) else (
    echo       [INFO] win-unpacked Ordner nicht gefunden, ZIP uebersprungen.
)

:: --- Ergebnis ---
echo.
echo ============================================
echo   BUILD ERFOLGREICH!
echo ============================================
echo.

if exist "release\win-unpacked" (
    echo   App-Verzeichnis: release\win-unpacked\
    echo.
    :: Zeige Groesse
    for %%f in ("release\win-unpacked\BiBox Downloader.exe") do (
        if exist "%%f" echo   Starten mit:     "release\win-unpacked\BiBox Downloader.exe"
    )
) else (
    echo   [WARNUNG] win-unpacked Ordner nicht gefunden!
)

:: ZIP info
if exist "release\BiBox-Downloader-1.0.0.zip" (
    echo.
    echo   ZIP-Archiv:      release\BiBox-Downloader-1.0.0.zip
    for %%s in ("release\BiBox-Downloader-1.0.0.zip") do echo   ZIP-Groesse:     %%~zs Bytes
)

echo.
echo   VERWENDUNG:
echo   - Variante 1: Direkt starten aus release\win-unpacked\
echo   - Variante 2: ZIP entpacken und "BiBox Downloader.exe" starten
echo   - Beide Varianten auf USB-Stick kopierbar
echo.
echo   HINWEIS:
echo   Falls Windows SmartScreen warnt:
echo   "Weitere Informationen" ^> "Trotzdem ausfuehren"
echo.
echo ============================================

pause
exit /b 0
