/* ============================================================
   CAGE ADMIN 5.0 — display settings (light/dark theme, modern/
   classic table skin). Applied as data-theme / data-skin on
   <html> so every screen (login, lobby, table) picks it up
   through the shared CSS custom properties.
   ============================================================ */
let THEME = localStorage.getItem('cageTheme') || 'dark';
let SKIN = localStorage.getItem('cageSkin') || 'modern';

function applyDisplaySettings(){
  document.documentElement.setAttribute('data-theme', THEME);
  document.documentElement.setAttribute('data-skin', SKIN);
}
function setTheme(v){
  THEME = v;
  localStorage.setItem('cageTheme', v);
  applyDisplaySettings();
  if (typeof onDisplaySettingsChange === 'function') onDisplaySettingsChange();
}
function setSkin(v){
  SKIN = v;
  localStorage.setItem('cageSkin', v);
  applyDisplaySettings();
  if (typeof onDisplaySettingsChange === 'function') onDisplaySettingsChange();
}
function syncDisplayToggleUI(){
  document.querySelectorAll('#themeToggle .seg-btn').forEach(b=> b.classList.toggle('active', b.dataset.v===THEME));
  document.querySelectorAll('#skinToggle .seg-btn').forEach(b=> b.classList.toggle('active', b.dataset.v===SKIN));
}
applyDisplaySettings();
