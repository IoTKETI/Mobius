import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The build output lands where admin/server.js serves static files. During development the dev server proxies /api to the console server (7580); cookies must travel on the same origin for the session to attach.
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7580',
        changeOrigin: false,
      },
    },
  },
})
