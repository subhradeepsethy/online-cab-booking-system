import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Google Maps, Places and fonts need these hosts (per Google's Maps JavaScript API CSP guide).
const googleHosts = 'https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com';

// Adds a strict Content-Security-Policy to the production build only. (The dev server needs
// inline scripts for hot reload, so it can't run under this policy.) This limits what an
// injected script could do: code may only load from this site and Google Maps, and data may
// only be sent to the API and Google.
function contentSecurityPolicy(apiBaseUrl) {
  // A relative API URL ("/api") means the API serves this site: 'self' covers it (and its
  // WebSocket in modern browsers). An absolute URL is a separate API host to allow explicitly.
  const isRelative = apiBaseUrl.startsWith('/');
  const api = isRelative ? null : new URL(apiBaseUrl);
  const apiSources = api ? `${api.origin} ${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}` : '';
  const directives = [
    "default-src 'self'",
    `script-src 'self' ${googleHosts}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${googleHosts}`,
    `connect-src 'self' ${apiSources} ${googleHosts}`.replace(/\s+/g, ' '),
    `frame-src ${googleHosts}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: directives.join('; ') }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // DEV_HTTPS=true serves the dev site over HTTPS with a self-signed certificate. Phones only
  // allow GPS/location on secure pages, so this is needed to test location from a phone.
  // (Not VITE_-prefixed, so it's never included in the website bundle.)
  const devHttps = command === 'serve' && loadEnv(mode, process.cwd(), '').DEV_HTTPS === 'true';
  return {
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicy(env.VITE_API_BASE_URL || 'http://localhost:5000/api'),
      ...(devHttps ? [basicSsl({ name: 'cab-system-dev' })] : []),
    ],
    server: {
      port: 5173,
      strictPort: true,
      // Listen on the local network too, so phones on the same Wi-Fi can open the dev site.
      host: true,
      // Forward API and live-update traffic to the backend, so the browser only ever talks to
      // this one address (works from a phone, and keeps session cookies same-origin).
      // The Host header is kept, which the backend's same-origin checks rely on.
      proxy: {
        '/api': { target: 'http://localhost:5000' },
        '/socket.io': { target: 'http://localhost:5000', ws: true },
      },
    },
    build: {
      // No source maps in production: they would publish the original source code.
      sourcemap: false,
    },
  };
});
