// Single source of look: colours + fonts for UI (CSS vars) and the 3D scene.
export const THEME = {
  accent: '#d8a63a', // brass, the only UI accent
  ink: '#14120f',
  paper: '#f2ecde',
  muted: '#b9b09b',
  panel: '#1c1915',
  teamA: '#b3352b', // crimson army
  teamB: '#2f5f9a', // blue army
  // choosable army colours (first two are the defaults); picker cycles through these
  palette: [{ n: 'Crimson', c: '#b3352b' }, { n: 'Azure', c: '#2f5f9a' }, { n: 'Forest', c: '#3f7a46' }, { n: 'Saffron', c: '#c98a1c' }, { n: 'Violet', c: '#6e4a8a' }, { n: 'Ash', c: '#8a8d8f' }, { n: 'Black', c: '#2a2a2e' }, { n: 'Bone', c: '#d8d0b8' }],
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
