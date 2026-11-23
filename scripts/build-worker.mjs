// Inlines dist/ into worker/assets.js so the Worker serves the site without a separate asset upload.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
const out = {}; const walk = (d, p = '') => { for (const f of readdirSync(d)) { const full = join(d, f), key = p + '/' + f; if (statSync(full).isDirectory()) walk(full, key); else if (f !== '_headers') out[key] = [T[extname(f)] || 'application/octet-stream', readFileSync(full).toString('base64')]; } };
walk('dist'); writeFileSync('worker/assets.js', 'export default ' + JSON.stringify(out) + ';\n');
console.log('inlined', Object.keys(out).length, 'files');
