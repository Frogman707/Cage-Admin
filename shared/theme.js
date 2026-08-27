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
/* The theme used to be picked from a segmented control, #themeToggle, which every screen has
   since replaced with the sun/moon button - so the function that kept that control in step was
   walking an empty list on every call. The button shows its own state through CSS. */
function toggleLoginTheme(){
  setTheme(THEME === 'dark' ? 'light' : 'dark');
}
applyDisplaySettings();
