import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  // GitHub Pages serves a project site under /<repository>/, so the built
  // index.html has to ask for its assets from there. The deploy workflow passes
  // VITE_BASE; everywhere else — the dev server, the nginx container — the app
  // owns the root of its host and the default is right.
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@/styles': path.resolve(__dirname, './src/styles'),
      '@': path.resolve(__dirname, './src/app'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    allowedHosts: true,
    // Proxy the API so the browser sees one origin in development. Without
    // this, every request to /api would need CORS headers on the Next side.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    watch: {
      // The api/ folder has its own dev server. Watching it makes Vite reload
      // the page every time Next.js writes to .next.
      ignored: ['**/api/.next/**', '**/api/node_modules/**', '**/api/data/**'],
    },
  },
})
