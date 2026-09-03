import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 빌드 산출물은 admin/server.js 가 정적으로 서빙하는 자리로 떨어진다.
// 개발 중에는 dev server 가 /api 를 콘솔 서버(7580)로 프록시한다 — 쿠키가
// 같은 오리진으로 오가야 세션이 붙는다.
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
