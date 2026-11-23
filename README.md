# Britespite

Free-camera spear army battle test, built as a Cloudflare Worker serving static assets.

- `npm run dev` local dev, `npm run build` bundle to `dist/`, `npm test` automated suite, `npm run deploy` build + `wrangler deploy` (needs `CLOUDFLARE_API_TOKEN`).
- Fly: WASD / Space / C, mouse (click to look), Shift turbo, wheel speed, 1/2/3 camera spots, P pause, M sound, R restart. Touch: left pad + drag to look, ▲ ▼ »
- Soldiers are GPU-instanced with baked bone-matrix clips, three LODs (full model, light model, impostor), simulated in a Web Worker with a spatial-hash. `?n=20000` sets soldiers per side.
- Look tokens live in `src/theme.js`.
- Cameras: click/tap a soldier (or F for the one at screen centre) to follow; V toggles chase / first person; T auto cinematic camera; Y replays the last seconds in slow motion (speed button cycles 0.4x / 0.15x / 1x); Esc or any fly key returns to free cam. Logic lives in `src/camdirector.js`.
