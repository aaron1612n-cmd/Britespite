// Single source of look: colours + fonts for UI (CSS vars) and the 3D scene.
export const THEME = {
  accent: '#d8a63a', // brass, the only UI accent
  ink: '#14120f',
  paper: '#f2ecde',
  muted: '#b9b09b',
  panel: 'rgba(20,18,15,0.82)',
  teamA: '#b3352b', // crimson army
  teamB: '#2f5f9a', // blue army
  skin: '#b98d68',
  bronze: '#a9772f',
  wood: '#6b4a2b',
  leather: '#3a2a1e',
  grassA: '#7b8a4a',
  grassB: '#6b7a3f',
  haze: '#c9d3d6',
  fontDisplay: '"Rockwell","Roboto Slab","Georgia",serif',
  fontMono: 'ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace',
};
export function applyTheme() {
  const r = document.documentElement.style;
  r.setProperty('--accent', THEME.accent); r.setProperty('--ink', THEME.ink);
  r.setProperty('--paper', THEME.paper); r.setProperty('--muted', THEME.muted);
  r.setProperty('--panel', THEME.panel); r.setProperty('--teamA', THEME.teamA);
  r.setProperty('--teamB', THEME.teamB); r.setProperty('--display', THEME.fontDisplay);
  r.setProperty('--mono', THEME.fontMono);
}
