const iso = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
export default { build: { target: 'es2022', chunkSizeWarningLimit: 1200 }, worker: { format: 'es' }, server: { headers: iso }, preview: { headers: iso } };
