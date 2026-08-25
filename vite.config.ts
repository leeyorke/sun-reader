import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 渲染层独立成 Vite root：index.html 与 React 源码都在 src/renderer 下，
// 开发服务器仍从 http://localhost:5173/ 提供服务，产物输出到项目根的 dist/
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/renderer/src"),
    },
  },
  base: './',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
