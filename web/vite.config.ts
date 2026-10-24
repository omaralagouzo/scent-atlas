import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Built into app/static/next and served by FastAPI at /next/ (the current site stays at / until the switch).
export default defineConfig({
  base: '/next/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: { outDir: '../app/static/next', emptyOutDir: true, chunkSizeWarningLimit: 700 },
  server: { proxy: { '/api': 'http://127.0.0.1:8765', '/img': 'http://127.0.0.1:8765' } },
})
