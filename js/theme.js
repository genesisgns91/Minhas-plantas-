// Tema claro/escuro. "auto" segue o sistema; a escolha fica guardada neste aparelho.
const KEY = 'minhasplantas_theme';
const META = { light: '#2f4a2c', dark: '#10170f' };

export function getThemePref() {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'auto') return v; } catch (e) { /* ignora */ }
  return 'auto';
}

const systemDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

export function resolveTheme(pref = getThemePref()) { return pref === 'auto' ? (systemDark() ? 'dark' : 'light') : pref; }

export function applyTheme(pref = getThemePref()) {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePref = pref;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META[resolved]);
  document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === pref)));
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    b.textContent = resolved === 'dark' ? '☀️' : '🌙';
    b.setAttribute('aria-label', resolved === 'dark' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
    b.setAttribute('title', resolved === 'dark' ? 'Tema claro' : 'Tema escuro');
  });
}

export function setTheme(pref) {
  try { localStorage.setItem(KEY, pref); } catch (e) { /* ignora */ }
  // suaviza a troca de cores (só quando a pessoa pede; respeita "reduzir movimento")
  const root = document.documentElement;
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calm) { root.classList.add('theme-fade'); setTimeout(() => root.classList.remove('theme-fade'), 600); }
  applyTheme(pref);
}

/** Botão rápido: alterna entre claro e escuro. */
export function toggleTheme() { setTheme(resolveTheme() === 'dark' ? 'light' : 'dark'); }

if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (getThemePref() === 'auto') applyTheme('auto'); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
}
