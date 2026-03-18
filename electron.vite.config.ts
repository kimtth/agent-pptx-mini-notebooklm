import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    build: {
      externalizeDeps: {
        exclude: [
          '@github/copilot-sdk',
          '@github/copilot',
          'vscode-jsonrpc',
          'zod',
          'archiver',
          'adm-zip',
          'jszip',
          'cheerio',
          'csv-parse',
          'balanced-match',
          'undici',
        ],
      },
      rollupOptions: {
        input: { main: path.resolve(__dirname, 'electron/main.ts') },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { preload: path.resolve(__dirname, 'electron/preload.ts') },
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: { index: path.resolve(__dirname, 'index.html') },
      },
    },
    server: {
      watch: {
        ignored: ['**/samples/**', '**/temp/**', '**/scripts/tempfiles/**', '**/scripts/__pycache__/**', '**/previews/**', '**/*.pptx', '**/*.pptapp'],
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  },
})
