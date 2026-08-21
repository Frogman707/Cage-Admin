/* ============================================================
   CAGE ADMIN 5.0 — display settings (light/dark theme). Applied
   as data-theme on <html> so every screen (login, lobby, table)
   picks it up through the shared CSS custom properties.
   ============================================================ */
let THEME = localStorage.getItem('cageTheme') || 'dark';

function applyDisplaySettings(){
  document.documentElement.setAttribute('data-theme', THEME);
}
function setTheme(v){
  THEME = v;
  localStorage.setItem('cageTheme', v);
  applyDisplaySettings();
  if (typeof onDisplaySettingsChange === 'function') onDisplaySettingsChange();
}
function syncDisplayToggleUI(){
  document.querySelectorAll('#themeToggle .seg-btn').forEach(b=> b.classList.toggle('active', b.dataset.v===THEME));
}
function toggleLoginTheme(){
  setTheme(THEME === 'dark' ? 'light' : 'dark');
  syncDisplayToggleUI();
}
applyDisplaySettings();
