# Mitarbeit

Beiträge zum BiBox Downloader sind willkommen. Hier ein paar Hinweise, damit alles reibungslos läuft.

## Bugs melden

Erstelle ein [Issue](https://github.com/stephanbuettig/bibox-downloader/issues) mit folgenden Infos:

- Betriebssystem und Version
- Node.js-Version (falls selbst kompiliert)
- Was du erwartet hast und was stattdessen passiert ist
- Falls vorhanden, die relevanten Zeilen aus der Log-Datei

## Code beitragen

1. Forke das Repository
2. Erstelle einen Feature-Branch (`git checkout -b mein-feature`)
3. Nimm deine Änderungen vor
4. Prüfe, ob TypeScript fehlerfrei kompiliert: `npx tsc --noEmit`
5. Committe deine Änderungen (`git commit -m "Kurze Beschreibung"`)
6. Pushe den Branch (`git push origin mein-feature`)
7. Erstelle einen Pull Request

## Entwicklungsumgebung einrichten

```bash
git clone https://github.com/stephanbuettig/bibox-downloader.git
cd bibox-downloader
npm install
npm run dev
```

Weitere Details findest du in [BUILDING.md](BUILDING.md).

## Stil und Konventionen

- TypeScript strict mode ist aktiv
- Der Main Process nutzt CommonJS, der Renderer wird über Vite gebundelt
- Neue Dateitypen bitte in `material-downloader.ts` (Magic Bytes) und `file-organizer.ts` (MIME-Mapping) ergänzen
