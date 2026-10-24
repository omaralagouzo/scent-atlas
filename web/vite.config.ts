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
  // dev only: proxy to the local backend; drop Origin so its same-origin CSRF check sees a plain same-site request
  server: {
    proxy: Object.fromEntries(
      ['/api', '/img'].map((p) => [
        p,
        { target: 'http://127.0.0.1:8765', configure: (proxy: any) => proxy.on('proxyReq', (req: any) => req.removeHeader('origin')) },
      ]),
    ),
  },
})
