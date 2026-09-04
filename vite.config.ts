import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {configDefaults} from 'vitest/config';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    test: {
      // quotation-service/ is a standalone package with its own vitest config,
      // deps, and env vars (e.g. QuotationPrompt.md resolved via its own
      // process.cwd()) -- without this exclude, `npm test` at the repo root
      // would also pick up its test files but run them with the WRONG cwd.
      // Run its suite via `npm --prefix quotation-service test` instead.
      exclude: [...configDefaults.exclude, 'quotation-service/**'],
    },
  };
});
