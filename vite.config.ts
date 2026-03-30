import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vite plugin: Strip the `crossorigin` attribute from all script/link tags.
 *
 * Why: Electron loads the renderer via file:// protocol. The `crossorigin`
 * attribute causes Chromium to fetch scripts in CORS mode, which fails on
 * file:// because there is no server to send Access-Control-Allow-Origin.
 * This results in an empty/blank window — the React app never loads.
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html: string) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), stripCrossorigin()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    // Disable module preload polyfill — not needed in Electron
    modulePreload: false,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
