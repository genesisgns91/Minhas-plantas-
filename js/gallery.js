import { imgSrc } from './images.js';
import { S } from './state.js';
import { vasePhotoItems } from './lightbox.js';
import { $, daysBetween, esc, fmtDate, plural } from './utils.js';
import { speciesOfVase } from './care.js';
import { setNavActive } from './nav.js';
import { emptyPlantSvg, openSpeciesDetail } from './species.js';
import { openVaseDetail } from './vasedetail.js';
import { vasePhotos } from './photos.js';

// ==================== GALERIA GERAL ====================
const gal = { view: 'photos', species: 'all', sort: 'new' };

// Fotos de todos os vasos (respeitando o filtro de espécie), já ordenadas — é também a fonte do carrossel geral.
export function galleryItems() {
  const items = [];
  S.vases.forEach(v => {
    if (gal.species !== 'all' && v.speciesId !== gal.species) return;
    items.push(...vasePhotoItems(v));
  });
  const t = (x) => { const n = new Date(x.date).getTime(); return isNaN(n) ? 0 : n; };
  items.sort((a, b) => gal.sort === 'old' ? t(a) - t(b) : t(b) - t(a));
  return items;
}

export function refreshGalleryIfVisible() {
  const sec = $('sec-gallery');
  if (sec && sec.classList.contains('is-active')) renderGallery();
}

export function setGalleryView(view) { gal.view = view; renderGallery({ animate: true }); }

export function setGalleryFilter(id) { gal.species = id; renderGallery({ animate: true }); }

export function setGallerySort(value) { gal.sort = value; renderGallery({ animate: true }); }

export function openVaseFromGallery(vaseId) {
  const vase = S.vases.find(v => v.firestoreId === vaseId);
  const sp = vase && speciesOfVase(vase);
  if (!sp) return;
  setNavActive('species');
  openSpeciesDetail(sp, { fromUser: true });
  openVaseDetail(vaseId);
}

function monthLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { key: 'sem-data', label: 'Sem data' };
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

export function renderGallery({ animate = false } = {}) {
  const content = $('galContent');
  if (!content) return;

  if (!S.speciesLoaded || !S.vasesLoaded) {
    content.innerHTML = '<div class="g-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    return;
  }

  // Contagem de fotos por espécie (para os filtros)
  const counts = {};
  let totalPhotos = 0, vasesWithPhotos = 0;
  S.vases.forEach(v => {
    const n = vasePhotos(v).length;
    if (!n) return;
    vasesWithPhotos++; totalPhotos += n;
    counts[v.speciesId] = (counts[v.speciesId] || 0) + n;
  });
  const speciesWithPhotos = S.species.filter(sp => counts[sp.firestoreId]).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (gal.species !== 'all' && !counts[gal.species]) gal.species = 'all';

  // Controles
  document.querySelectorAll('[data-gview]').forEach(b => { const on = b.dataset.gview === gal.view; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  $('galSortWrap').style.display = gal.view === 'photos' ? '' : 'none';
  $('galSort').value = gal.sort;
  $('galChips').innerHTML =
    `<button class="chip btn-chip ${gal.species === 'all' ? 'active' : ''}" onclick="setGalleryFilter('all')">🌿 Todas · ${totalPhotos}</button>` +
    speciesWithPhotos.map(sp => `<button class="chip btn-chip ${gal.species === sp.firestoreId ? 'active' : ''}" onclick="setGalleryFilter('${sp.firestoreId}')">${esc(sp.icon || '🪴')} ${esc(sp.name)} · ${counts[sp.firestoreId]}</button>`).join('');

  const shownVases = S.vases.filter(v => (gal.species === 'all' || v.speciesId === gal.species) && vasePhotos(v).length);
  const shownPhotos = gal.species === 'all' ? totalPhotos : counts[gal.species] || 0;
  $('galStats').textContent = totalPhotos
    ? `${plural(shownPhotos, 'foto', 'fotos')} · ${plural(shownVases.length, 'vaso', 'vasos')}${S.vases.length > vasesWithPhotos ? ` · ${plural(S.vases.length - vasesWithPhotos, 'vaso sem foto', 'vasos sem foto')}` : ''}`
    : '';

  if (!totalPhotos) {
    content.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>Nenhuma foto por aqui ainda</h4><p>Fotografe seus vasos para acompanhar o crescimento. Elas aparecem aqui automaticamente.</p><button class="btn btn-primary" onclick="switchTab('species')">🌱 Ir para as espécies</button></div>`;
    return;
  }

  const enter = animate ? ' enter' : '';

  if (gal.view === 'vases') {
    const sorted = [...shownVases].sort((a, b) => {
      const sa = (speciesOfVase(a) || {}).name || '', sb = (speciesOfVase(b) || {}).name || '';
      return sa.localeCompare(sb, 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR');
    });
    content.innerHTML = `<div class="g-vases">${sorted.map((v, i) => {
      const photos = vasePhotos(v);
      const sp = speciesOfVase(v);
      const first = new Date(photos[0].date), last = new Date(photos[photos.length - 1].date);
      const span = Math.max(0, daysBetween(first, last));
      const range = photos.length > 1
        ? `${fmtDate(photos[0].date)} → ${fmtDate(photos[photos.length - 1].date)} · ${plural(span, 'dia', 'dias')} de evolução`
        : `Foto de ${fmtDate(photos[0].date)}`;
      return `<article class="g-vase${enter}" style="--i:${Math.min(i, 14)}">
        <button class="g-vase-cover" onclick="openLightbox('${v.firestoreId}', ${photos.length - 1})" aria-label="Ver fotos de ${esc(v.name)}">
          <img ${imgSrc(photos[photos.length - 1].photo, 640)} alt="" loading="lazy" decoding="async" />
          <span class="pill hint">📸 ${photos.length}</span>
        </button>
        <div class="g-vase-body">
          <h4>${esc(v.name)}</h4>
          <p class="g-sp">${esc(sp ? sp.name : '')}</p>
          <p class="g-range">${esc(range)}</p>
          <div class="g-vase-actions">
            <button class="btn btn-secondary" ${photos.length < 2 ? 'disabled' : ''} onclick="openLightbox('${v.firestoreId}', 0); lbTogglePlay(true)">▶ Evolução</button>
            <button class="btn btn-ghost" onclick="openVaseFromGallery('${v.firestoreId}')">Abrir vaso →</button>
          </div>
        </div>
      </article>`;
    }).join('')}</div>`;
    return;
  }

  // Visão "Fotos": agrupadas por mês, na ordem escolhida
  const items = galleryItems();
  const groups = [];
  items.forEach((it, i) => {
    const m = monthLabel(it.date);
    let g = groups[groups.length - 1];
    if (!g || g.key !== m.key) { g = { key: m.key, label: m.label, items: [] }; groups.push(g); }
    g.items.push({ it, i });
  });

  content.innerHTML = groups.map(g => `
    <section class="g-month">
      <h3 class="g-month-title">${esc(g.label)} <span class="count">${g.items.length}</span></h3>
      <div class="g-grid">
        ${g.items.map(({ it, i }, k) => `
          <button class="g-tile${k === 0 && g.items.length >= 5 ? ' big' : ''}${enter}" style="--i:${Math.min(i, 24)}" onclick="openGalleryLightbox(${i})" aria-label="Ampliar foto de ${esc(it.vaseName)} em ${fmtDate(it.date)}">
            <img ${imgSrc(it.photo, 420)} alt="" loading="lazy" decoding="async" />
            <span class="g-when">${fmtDate(it.date)}</span>
            <span class="g-over"><b>${esc(it.vaseName)}</b><i>${esc(it.speciesName)}</i></span>
          </button>`).join('')}
      </div>
    </section>`).join('');
}
