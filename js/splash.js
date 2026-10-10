// Abertura do app: a animação da muda brotando dura ~3,4 s. Mesmo que o login resolva antes, a tela
// fica até o fim da animação (toque para pular). Em recarregamentos na mesma aba ela é mais curta.
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let seen = false;
try { seen = sessionStorage.getItem('mp-splash-seen') === '1'; sessionStorage.setItem('mp-splash-seen', '1'); } catch (e) { /* sem storage */ }

const MIN_MS = window.__TEST__ ? 0 : reduced ? 700 : seen ? 1700 : 3500;
const startedAt = performance.now();
let skipped = false;
let timer = null;

function el() { return document.getElementById('splash'); }

function finish() {
  const s = el();
  if (!s || s.hidden) return;
  if (window.__TEST__ || reduced) { s.hidden = true; return; }
  s.classList.add('splash-out');
  setTimeout(() => { s.hidden = true; s.classList.remove('splash-out'); }, 760);
}

/** Mostra a abertura (enquanto a sessão carrega). */
export function showSplash() {
  clearTimeout(timer);
  const s = el();
  if (s) { s.hidden = false; s.classList.remove('splash-out'); }
}

/** Esconde a abertura, respeitando o tempo mínimo da animação. */
export function hideSplash() {
  clearTimeout(timer);
  const wait = skipped ? 0 : Math.max(0, MIN_MS - (performance.now() - startedAt));
  if (wait <= 0) finish(); else timer = setTimeout(finish, wait);
}

document.addEventListener('click', (e) => {
  const s = el();
  if (!s || s.hidden || !s.contains(e.target)) return;
  skipped = true;
  if (!document.body.classList.contains('auth-loading')) { clearTimeout(timer); finish(); }
});
