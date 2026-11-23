import assets from './assets.js';
const cache = new Map();
const bytes = (k) => { let b = cache.get(k); if (!b) { const s = atob(assets[k][1]); b = Uint8Array.from(s, (c) => c.charCodeAt(0)); cache.set(k, b); } return b; };
export default {
  fetch(req) {
    let p = new URL(req.url).pathname; if (p === '/' || !assets[p]) p = '/index.html';
    const h = { 'content-type': assets[p][0], 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'cache-control': p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
    return new Response(req.method === 'HEAD' ? null : bytes(p), { headers: h });
  },
};
