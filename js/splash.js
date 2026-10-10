// Abertura do app. O modo é escolhido no <head> (index.html) e fica em <html data-splash>:
//  • "full"  = muda brotando (~3,4 s) — só ao abrir o app no celular (toque para pular);
//  • "quick" = brotinho curto (~0,7 s) — ao recarregar/atualizar a página, ao voltar, ou no computador.
// Mesmo que o login resolva antes, a tela fica até o fim da animação do modo escolhido.
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const full = document.documentElement.dataset.splash === 'full';

const MIN_MS = window.__TEST__ ? 0 : reduced ? (full ? 700 : 300) : (full ? 3500 : 700);
const OUT_MS = full ? 760 : 300;
const startedAt = performance.now();
let skipped = false;
let timer = null;

function el() { return document.getElementById('splash'); }

function finish() {
  const s = el();
  if (!s || s.hidden) return;
  if (window.__TEST__ || reduced) { s.hidden = true; return; }
  s.classList.add('splash-out');
  setTimeout(() => { s.hidden = true; s.classList.remove('splash-out'); }, OUT_MS);
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
