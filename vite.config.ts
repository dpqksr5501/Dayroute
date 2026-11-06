import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { handleTransport } from './server/transport';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const release = { version: pkg.version, build: process.env.DAYROUTE_BUILD_ID || new Date().toISOString() };
export default defineConfig(({ mode }) => ({
  plugins: [react(), {
    name: 'release-metadata',
    enforce: 'post',
    configureServer(server) {
      const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/api/transport') { void handleTransport(req, res, env); return; }
        if (req.url?.split('?')[0] !== '/version.json') return next();
        res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(release));
      });
    },
    generateBundle(_options, bundle) {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(release) });
      const files = ['/index.html', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest',
        ...Object.keys(bundle).filter(f => /\.(js|css)$/.test(f)).map(f => `/${f}`)];
      const source = `const CACHE = ${JSON.stringify('dayroute-' + release.build)};
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); });
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('dayroute-') && k !== CACHE).map(k => caches.delete(k))))); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/version.json') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(async response => { if(response.ok) { const cache = await caches.open(CACHE); await cache.put('/index.html', response.clone()); } return response; }).catch(() => caches.match('/index.html', { ignoreVary: true })));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname, { ignoreVary: true })).then(cached => cached || fetch(event.request)));
  }
});`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  }],
  define: { __APP_RELEASE__: JSON.stringify(release) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
}));
