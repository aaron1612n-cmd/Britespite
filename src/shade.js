// One lighting model for every soldier LOD. The near/mid meshes evaluate it per pixel in GLSL (SHADE_GLSL);
// the far billboards cannot, so they multiply by `meanLit`, the same formula averaged over a unit's facing,
// and a soldier therefore keeps the same brightness as it crosses from one LOD to the next.
export const WRAP = 0.6; // diffuse wrap: surfaces facing away from the sun still keep some light
export const AO_FLOOR = 0.78; // feet and lower body are only slightly darker than the chest

export const SHADE_GLSL = /* glsl */`
vec3 shadeSoldier(vec3 n, float ly, vec3 sun, vec3 sunCol, vec3 ambS, vec3 ambG) {
  float w = clamp((dot(n, sun) + ${WRAP.toFixed(2)}) / ${(1 + WRAP).toFixed(2)}, 0.0, 1.0);
  vec3 amb = mix(ambG, ambS, n.y * 0.5 + 0.5);
  float ao = mix(${AO_FLOOR.toFixed(2)}, 1.0, smoothstep(0.0, 0.9, ly));
  return amb * ao + sunCol * w;
}`;

/** same maths as shadeSoldier, in JS. sun/sunCol/ambS/ambG are {x,y,z} */
export function shadeJS(nx, ny, nz, ly, sun, sunCol, ambS, ambG, out) {
  let w = (nx * sun.x + ny * sun.y + nz * sun.z + WRAP) / (1 + WRAP); w = w < 0 ? 0 : w > 1 ? 1 : w;
  const k = ny * 0.5 + 0.5, t = Math.min(1, Math.max(0, ly / 0.9)), ao = AO_FLOOR + (1 - AO_FLOOR) * t * t * (3 - 2 * t);
  out[0] = (ambG.x + (ambS.x - ambG.x) * k) * ao + sunCol.x * w; out[1] = (ambG.y + (ambS.y - ambG.y) * k) * ao + sunCol.y * w; out[2] = (ambG.z + (ambS.z - ambG.z) * k) * ao + sunCol.z * w;
  return out;
}

/** Collect [nx,ny,nz,y] samples (bind pose) of the vertices with material `mat`, thinned to at most `max`. */
export function normalSamples(geo, mat, max = 160) {
  const p = geo.attributes.position, n = geo.attributes.normal, m = geo.attributes.aMat, all = [];
  for (let i = 0; i < p.count; i++) if (Math.round(m.getX(i)) === mat) all.push(i);
  const step = Math.max(1, Math.floor(all.length / max)), out = [];
  for (let k = 0; k < all.length; k += step) { const i = all[k]; out.push(n.getX(i), n.getY(i), n.getZ(i), p.getY(i)); }
  return Float32Array.from(out);
}

/** Mean light on a soldier over every facing, plus the dimmest and brightest facing (luminance). */
export function meanLit(samples, sun, sunCol, ambS, ambG, yaws = 12) {
  const o = [0, 0, 0], sum = [0, 0, 0], N = samples.length / 4; let lo = 1e9, hi = 0;
  for (let k = 0; k < yaws; k++) {
    const a = (k / yaws) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), f = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const nx = samples[i * 4], ny = samples[i * 4 + 1], nz = samples[i * 4 + 2];
      shadeJS(c * nx + s * nz, ny, -s * nx + c * nz, samples[i * 4 + 3], sun, sunCol, ambS, ambG, o); f[0] += o[0]; f[1] += o[1]; f[2] += o[2];
    }
    const l = (f[0] * 0.3 + f[1] * 0.59 + f[2] * 0.11) / N; lo = Math.min(lo, l); hi = Math.max(hi, l);
    sum[0] += f[0]; sum[1] += f[1]; sum[2] += f[2];
  }
  const d = N * yaws; return { mean: [sum[0] / d, sum[1] / d, sum[2] / d], lo, hi };
}
