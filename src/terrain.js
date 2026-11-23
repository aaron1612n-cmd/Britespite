// Gentle, mostly flat ground shared by the sim and the renderer.
export function heightAt(x, z) {
  return 0.9 * Math.sin(x * 0.0046 + 1.3) * Math.cos(z * 0.0039 + 0.4) + 0.45 * Math.sin(x * 0.012 + z * 0.009) + 0.12 * Math.sin(x * 0.05) * Math.sin(z * 0.045);
}
