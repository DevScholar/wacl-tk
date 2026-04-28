import { defineConfig } from 'vite';
import type { Plugin, ResolvedServerUrls } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';

/**
 * Auto-discovers demos/<name>/index.html entries and prints their URLs
 * after Vite's own "Local" / "Network" URL block. Same pattern as em-x11.
 */
function listDemoEntries(): { name: string; path: string }[] {
  const demosDir = resolve(__dirname, 'demos');
  if (!existsSync(demosDir)) return [];
  return readdirSync(demosDir)
    .filter((name) => {
      const entry = resolve(demosDir, name, 'index.html');
      return statSync(resolve(demosDir, name)).isDirectory() && existsSync(entry);
    })
    .map((name) => ({ name, path: `/demos/${name}/` }));
}

function printDemoUrls(): Plugin {
  const demos = listDemoEntries();
  return {
    name: 'wacl-tk-print-demo-urls',
    configureServer(server) {
      const originalPrint = server.printUrls.bind(server);
      server.printUrls = () => {
        originalPrint();
        if (demos.length === 0) return;
        const urls: ResolvedServerUrls | null = server.resolvedUrls;
        const bases = urls ? [...urls.local, ...urls.network] : [];
        const base = bases[0]?.replace(/\/$/, '') ?? '';
        // eslint-disable-next-line no-console
        console.log('\n  \x1b[1mDemos\x1b[0m:');
        for (const d of demos) {
          // eslint-disable-next-line no-console
          console.log(`    \x1b[36m${d.name.padEnd(10)}\x1b[0m ${base}${d.path}`);
        }
        // eslint-disable-next-line no-console
        console.log('');
      };
    },
  };
}

export default defineConfig({
  root: '.',

  plugins: [printDemoUrls()],

  server: {
    headers: {
      // Required for SharedArrayBuffer (emscripten pthreads / Asyncify).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      // Allow serving our own build outputs plus the sibling em-x11 tree
      // (tk-hello/main.ts imports Host from ../../../em-x11/src/host/...).
      // Vite resolves relative paths from project root; allow list is
      // path-prefix based, so listing the sibling dir is enough.
      allow: ['.', 'build', '../em-x11'],
    },
    // Port left unset -- Vite picks 5173, auto-bumps on collision if em-x11's
    // own dev server is already running.
  },

  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: Object.fromEntries(
        [
          ['main', resolve(__dirname, 'index.html')],
          ...listDemoEntries().map((d) => [d.name, resolve(__dirname, `demos/${d.name}/index.html`)]),
        ],
      ),
    },
  },

  assetsInclude: ['**/*.wasm'],
});
