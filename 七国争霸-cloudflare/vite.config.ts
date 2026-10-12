import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// 构建后对 dist/index.html 去掉 crossorigin 属性。
// 同源场景不需要 crossorigin；带 crossorigin + 某些网络/iframe 环境会导致 net::ERR_ABORTED
function removeCrossoriginPlugin() {
  return {
    name: 'remove-crossorigin',
    closeBundle() {
      const htmlPath = path.resolve(__dirname, 'dist', 'index.html');
      if (!fs.existsSync(htmlPath)) return;
      let html = fs.readFileSync(htmlPath, 'utf8');
      const before = html;
      html = html
        .replace(/(<script[^>]*?)\s+crossorigin(?:="[^"]*")?([^>]*>)/gi, '$1$2')
        .replace(/(<link[^>]*?)\s+crossorigin(?:="[^"]*")?([^>]*>)/gi, '$1$2');
      if (html !== before) {
        fs.writeFileSync(htmlPath, html, 'utf8');
        console.log('[remove-crossorigin] 已移除 dist/index.html 中的 crossorigin 属性');
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), removeCrossoriginPlugin()],
  // 相对路径引用资源：构建产物可在任意静态托管（如 deploypages）的任意子路径下直接运行
  base: './',
  build: {
    modulePreload: { polyfill: false },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
})
