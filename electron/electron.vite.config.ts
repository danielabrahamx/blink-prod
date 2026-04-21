import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'node:path';

// electron-vite drives three build targets from one config: main / preload / renderer.
// The renderer pipeline is Vite + React; `@frontend` alias lets us import
// ../frontend/src/App.tsx without duplicating the React app.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
      },
      outDir: 'out/main',
      rollupOptions: {
        external: ['keytar', 'electron-store', 'electron-updater', 'pino'],
      },
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
      },
      outDir: 'out/preload',
    },
    resolve: {
      alias: {
        '@preload': resolve(__dirname, 'src/preload'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // The frontend React app (imported via `@frontend`) depends on
    // `@circlefin/x402-batching` which uses Node crypto primitives.
    // nodePolyfills mirrors the setup in `frontend/vite.config.ts` so both
    // build pipelines behave identically.
    plugins: [nodePolyfills(), react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@frontend': resolve(__dirname, '../frontend/src'),
        '@': resolve(__dirname, '../frontend/src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  },
});
