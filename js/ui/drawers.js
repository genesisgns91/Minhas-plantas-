import { S } from '../state.js';
import { setBurgerOpen } from '../filters.js';
import { $ } from '../utils.js';
import { trapFocus, releaseFocus } from './focus.js';

// Painéis laterais podem abrir um sobre o outro (ex.: formulário de registro sobre o painel do vaso).
// `open` guarda a pilha; o de cima é o "ativo".
const open = [];

export function openDrawer(id) {
  if (open.includes(id)) return;
  open.push(id);
  S.activeDrawerId = id;
  if (id === 'drawerFilters') setBurgerOpen(true);
  const overlay = $(id);
  overlay.classList.add('active');
  document.body.classList.add('no-scroll');
  trapFocus(overlay);
}

export function closeActiveDrawer() {
  const id = open.pop();
  if (!id) return;
  if (id === 'drawerFilters') setBurgerOpen(false);
  if (id === 'drawerVaseDetail') S.detailVaseId = null;
  const overlay = $(id);
  overlay.classList.remove('active');
  releaseFocus(overlay);
  S.activeDrawerId = open.at(-1) || null;
  if (!S.activeDrawerId) document.body.classList.remove('no-scroll');
}

document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => { if (e.target === ov && S.activeDrawerId === ov.id) closeActiveDrawer(); });
});
