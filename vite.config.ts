import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

// Upstream PriceTag gateway. Defaults to the local standalone metering stack
// (~/git/pricetag-metering, docker-compose.standalone.yaml). Point UPSTREAM at
// the live gateway (https://32.198.91.108:8443) to develop against real data.
const upstream = process.env.UPSTREAM ?? 'http://127.0.0.1:8080'

// TLS verification stays on for https upstreams unless explicitly disabled
// with UPSTREAM_INSECURE=1. The only expected use is the live gateway's
// self-signed certificate; anything else should be verified.
const upstreamInsecure =
  upstream.startsWith('https://') && process.env.UPSTREAM_INSECURE === '1'

// The gateway's same-origin CSRF check on session-changing POSTs (/login,
// /logout, /admin/impersonate) compares the Origin header against its
// MANAGEMENT_PUBLIC_ORIGIN. This dev server fronts a different origin, so the
// forwarded Origin is rewritten to the value the upstream expects. CSRF
// protection is preserved: the rewrite only affects requests that already
// reached this loopback-bound dev server, and the browser's Sec-Fetch-Site
// header (which the gateway also checks and which cannot be forged
// cross-site) passes through untouched. This is a developer-controlled
// setting with the same trust level as UPSTREAM itself, and it is NOT
// derived from UPSTREAM because they legitimately differ: the local stack
// is reached at http://127.0.0.1:8080 but expects Origin
// http://localhost:8080. For the live gateway, use
// https://32.198.91.108:8443.
const upstreamPublicOrigin = process.env.UPSTREAM_PUBLIC_ORIGIN ?? 'http://localhost:8080'

const proxyOptions: ProxyOptions = {
  target: upstream,
  changeOrigin: true,
  // Verified by default; see upstreamInsecure above.
  secure: !upstreamInsecure,
}

function sessionProxy(bypass?: ProxyOptions['bypass']): ProxyOptions {
  return {
    ...proxyOptions,
    ...(bypass ? { bypass } : {}),
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        if (req.headers.origin) {
          proxyReq.setHeader('Origin', upstreamPublicOrigin)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Explicit loopback address: this proxy forwards authenticated gateway
    // sessions and rewrites CSRF headers, so it must not be reachable from
    // other hosts.
    host: '127.0.0.1',
    proxy: {
      '/api': sessionProxy(),
      '/whoami': proxyOptions,
      '/me': proxyOptions,
      '/oauth': proxyOptions,
      '/admin/impersonate': sessionProxy(),
      '/login': sessionProxy(
        // The SPA owns the login page; only the credential POST is proxied.
        (req) => (req.method === 'GET' ? '/index.html' : undefined),
      ),
      '/logout': sessionProxy(),
    },
  },
})
