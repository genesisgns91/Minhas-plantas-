// Foco do teclado em janelas (painéis, confirmações, galeria): o fundo fica bloqueado (inert),
// o foco vai para dentro da janela e volta ao botão que a abriu quando ela fecha.
const stack = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Bloqueia o fundo e leva o foco para `el` (ou para `focusEl`, se informado). */
export function trapFocus(el, focusEl) {
  const opener = document.activeElement;
  const blocked = [];
  [...document.body.children].forEach(child => {
    if (child === el || child.contains(el) || child.tagName === 'SCRIPT' || child.id === 'toasts' || child.classList.contains('skip-link')) return;
    if (!child.inert) { child.inert = true; blocked.push(child); }
  });
  stack.push({ el, blocked, opener });
  const target = focusEl || el.querySelector('[role="dialog"], .drawer') || el;
  if (target && !target.hasAttribute('tabindex') && !target.matches(FOCUSABLE)) target.setAttribute('tabindex', '-1');
  try { target.focus({ preventScroll: true }); } catch (e) { /* ignora */ }
}

/** Desfaz o bloqueio feito por trapFocus e devolve o foco a quem abriu a janela. */
export function releaseFocus(el) {
  const i = stack.map(s => s.el).lastIndexOf(el);
  if (i < 0) return;
  const { blocked, opener } = stack.splice(i, 1)[0];
  blocked.forEach(b => { b.inert = false; });
  if (opener && opener.isConnected && opener.focus && !opener.closest('[inert]')) {
    try { opener.focus({ preventScroll: true }); } catch (e) { /* ignora */ }
  }
}

/** Mantém o Tab dentro de `el` (usado nas confirmações). */
export function cycleTab(e, el) {
  if (e.key !== 'Tab') return;
  const items = [...el.querySelectorAll(FOCUSABLE)].filter(x => !x.hidden);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
