import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.API_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png', 'brand/familypulse-logo.svg', 'brand/familypulse-mark.svg'],
      manifest: {
        name: 'FamilyPulse',
        short_name: 'FamilyPulse',
        description: 'Shared household budgets, a collaborative ledger and cash-flow forecasts in one place.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#F4FAF5',
        theme_color: '#EFFBF1',
        categories: ['finance', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the static app shell is cached. API responses (financial data) are never cached
        // by the service worker; they are always fetched from the network.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': { target: API, changeOrigin: false } } },
  preview: { port: 4173, proxy: { '/api': { target: API, changeOrigin: false } } },
  build: { sourcemap: false, target: 'es2022' },
});
