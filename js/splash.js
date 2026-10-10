// Abertura do app. O modo é escolhido no <head> (index.html) e fica em <html data-splash>:
//  • "full"  = muda brotando — só ao abrir o app no celular (toque para pular, depois do 1º segundo);
//  • "quick" = brotinho curto — ao recarregar/atualizar a página, ao voltar, ou no computador.
// A tela só sai quando (1) passou o tempo mínimo, (2) TODAS as animações do modo terminaram de verdade
// (mesmo que o celular esteja lento carregando o app e a animação atrase) e (3) a cena final ficou
// parada por um instante (HOLD_MS), para dar tempo de ver a planta completa.
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const full = document.documentElement.dataset.splash === 'full';

const MIN_MS = window.__TEST__ ? 0 : reduced ? (full ? 700 : 300) : (full ? 4200 : 800);
const HOLD_MS = window.__TEST__ || reduced ? 0 : (full ? 1500 : 250);   // cena final parada
const CAP_MS = 12000;                                                    // nunca prende o app além disso
const OUT_MS = full ? 760 : 300;
const SKIP_AFTER_MS = 1200;                                              // ignora toques acidentais no início
const startedAt = performance.now();
let skipped = false;
let token = 0;

const el = () => document.getElementById('splash');
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Espera as animações com fim (as repetidas — balanço, brilho, partículas — ficam de fora).
function animationsDone(s) {
  if (!s || typeof s.getAnimations !== 'function') return Promise.resolve();
  const finite = s.getAnimations({ subtree: true }).filter(a => {
    try { return a.effect.getComputedTiming().iterations !== Infinity; } catch (e) { return false; }
  });
  return Promise.all(finite.map(a => a.finished.catch(() => {})));
}

function finish() {
  const s = el();
  if (!s || s.hidden) return;
  if (window.__TEST__ || reduced) { s.hidden = true; return; }
  s.classList.add('splash-out');
  setTimeout(() => { s.hidden = true; s.classList.remove('splash-out'); }, OUT_MS);
}

/** Mostra a abertura (enquanto a sessão carrega). */
export function showSplash() {
  token++;
  const s = el();
  if (s) { s.hidden = false; s.classList.remove('splash-out'); }
}

/** Esconde a abertura, depois que a animação tocou por inteiro. */
export function hideSplash() {
  const mine = ++token;
  if (skipped || window.__TEST__) { finish(); return; }
  const s = el();
  const minLeft = Math.max(0, MIN_MS - (performance.now() - startedAt));
  const played = Promise.race([animationsDone(s), delay(CAP_MS)]).then(() => delay(HOLD_MS));
  Promise.all([delay(minLeft), played]).then(() => {
    if (mine !== token || document.body.classList.contains('auth-loading')) return; // outra mudança de estado assumiu
    finish();
  });
}

document.addEventListener('click', (e) => {
  const s = el();
  if (!s || s.hidden || !s.contains(e.target)) return;
  if (performance.now() - startedAt < SKIP_AFTER_MS) return;
  skipped = true;
  if (!document.body.classList.contains('auth-loading')) { token++; finish(); }
});
