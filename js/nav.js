import { $ } from './utils.js';
import { S } from './state.js';
import { renderSpeciesGrid } from './species.js';
import { renderGallery } from './gallery.js';
import { renderAgenda } from './agenda.js';
import { closeLightbox, lb } from './lightbox.js';

// ==================== VIEWS / NAVEGAÇÃO ====================
const VIEWS = ['sec-species', 'sec-species-detail', 'sec-gallery', 'sec-agenda', 'sec-ai'];
const TAB_VIEW = { species: 'sec-species', gallery: 'sec-gallery', agenda: 'sec-agenda', ai: 'sec-ai' };
const TAB_TITLE = { species: 'Espécies e vasos', gallery: 'Galeria de fotos', agenda: 'Agenda', ai: 'Diagnóstico e IA' };

export function showView(id) {
  const wasActive = $(id).classList.contains('is-active');
  VIEWS.forEach(v => $(v).classList.toggle('is-active', v === id));
  if (!wasActive) window.scrollTo({ top: 0, behavior: 'auto' });
}

/** Leva o foco ao título da tela para leitores de tela perceberem a troca de seção. */
function focusViewHeading(viewId) {
  const h = document.querySelector(`#${viewId} h2`);
  if (!h) return;
  h.setAttribute('tabindex', '-1');
  h.focus({ preventScroll: true });
}

export function leaveDetailUI() {
  S.selectedSpecies = null;
  showView('sec-species');
  renderSpeciesGrid({ animate: true });
}

export function setNavActive(tab) {
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
}

export function switchTab(tab) {
  S.selectedSpecies = null;
  if (history.state && history.state.v === 'detail') history.replaceState(null, '');
  const view = TAB_VIEW[tab] || 'sec-species';
  showView(view);
  setNavActive(tab);
  document.title = `${TAB_TITLE[tab] || TAB_TITLE.species} · Minhas Plantas`;
  if (tab === 'gallery') renderGallery({ animate: true });
  if (tab === 'agenda') renderAgenda();
  focusViewHeading(view);
}

export function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('minhasplantas_sidebar', collapsed ? '1' : '0'); } catch (e) { /* ignora */ }
}

try {
  if (localStorage.getItem('minhasplantas_sidebar') === '1') document.body.classList.add('sidebar-collapsed');
} catch (e) { /* ignora */ }

window.addEventListener('popstate', () => {
  if (lb.open) closeLightbox(true);
  const v = history.state && history.state.v;
  if (S.selectedSpecies && v !== 'detail' && v !== 'lightbox') leaveDetailUI();
});
