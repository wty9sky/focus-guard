import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: r('./src'),
  publicDir: r('./public'),
  plugins: [vue()],
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    target: 'esnext',
    modulePreload: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        popup: r('./src/popup/index.html'),
        blocked: r('./src/blocked/index.html'),
        background: r('./src/background/index.js')
      },
      output: {
        // service worker 必须是稳定文件名
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
})
