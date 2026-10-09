import { imgSrc, thumb } from './images.js';
import { speciesOfVase } from './care.js';
import { vasePhotos } from './photos.js';
import { galleryItems } from './gallery.js';
import { S } from './state.js';
import { trapFocus, releaseFocus } from './ui/focus.js';
import { $, daysBetween, plural } from './utils.js';
import { friendlyError, toast } from './ui/feedback.js';
import { askConfirm } from './ui/dialogs.js';
import { arrayRemove, arrayUnion, db, doc, updateDoc } from './firebase.js';
import { closeActiveDrawer } from './ui/drawers.js';

// ==================== LIGHTBOX / CARROSSEL ====================
// Duas fontes de fotos: a evolução de UM vaso (source.type = 'vase') ou a galeria geral com as
// fotos de TODOS os vasos (source.type = 'gallery', respeita os filtros da tela de galeria).
export const lb = { open: false, source: null, items: [], index: 0, playing: false, timer: null, zoomed: false, tx: 0, ty: 0 };

const ZOOM_SCALE = 2.4;

const PLAY_MS = 1800;

const photoKey = (it) => `${it.vaseId}|${it.date}|${it.photo.length}`;

export function vasePhotoItems(vase) {
  const sp = speciesOfVase(vase);
  return vasePhotos(vase).map(p => ({ ...p, vaseId: vase.firestoreId, vaseName: vase.name, speciesName: sp ? sp.name : '' }));
}

function lbBuildItems() {
  if (!lb.source) return [];
  if (lb.source.type === 'gallery') return galleryItems();
  const vase = S.vases.find(v => v.firestoreId === lb.source.vaseId);
  return vase ? vasePhotoItems(vase) : [];
}

function lbStart(source, index) {
  lb.source = source;
  const items = lbBuildItems();
  if (!items.length) return false;
  lb.items = items;
  lb.index = Math.max(0, Math.min(index, items.length - 1));
  if (!lb.open) {
    lb.open = true;
    $('lightbox').classList.add('open');
    document.body.classList.add('no-scroll');
    trapFocus($('lightbox'), $('lbClose'));
    history.pushState({ v: 'lightbox' }, '');
  }
  lbBuildThumbs();
  lbRender(null);
  $('lbPlay').style.visibility = items.length > 1 ? 'visible' : 'hidden';
  $('lbVaseBtn').style.display = source.type === 'gallery' ? '' : 'none';
  return true;
}

export function openLightbox(vaseId, index = 0) { lbStart({ type: 'vase', vaseId }, index); }

export function openGalleryLightbox(index = 0) { lbStart({ type: 'gallery' }, index); }

export function openLightboxLatest() {
  if (!S.detailVaseId) return;
  const vase = S.vases.find(v => v.firestoreId === S.detailVaseId);
  if (vase) openLightbox(S.detailVaseId, vasePhotos(vase).length - 1);
}

export function openLightboxEvolution() {
  if (!S.detailVaseId) return;
  openLightbox(S.detailVaseId, 0);
  if (lb.items.length > 1) lbTogglePlay(true);
}

// De dentro da galeria geral, pula para a evolução do vaso da foto atual
export function lbShowVaseEvolution() {
  const it = lb.items[lb.index];
  if (!it) return;
  lbStopPlay();
  const vase = S.vases.find(v => v.firestoreId === it.vaseId);
  if (!vase) return;
  const photos = vasePhotoItems(vase);
  const idx = Math.max(0, photos.findIndex(p => photoKey(p) === photoKey(it)));
  lbStart({ type: 'vase', vaseId: it.vaseId }, idx);
  toast(`Evolução de ${vase.name}`);
}

export function closeLightbox(fromPopstate = false) {
  if (!lb.open) return;
  lbStopPlay();
  lb.open = false;
  lb.zoomed = false;
  $('lightbox').classList.remove('open');
  if (!S.activeDrawerId) document.body.classList.remove('no-scroll');
  if (!fromPopstate && history.state && history.state.v === 'lightbox') history.back();
  releaseFocus($('lightbox'));
}

function lbBuildThumbs() {
  const box = $('lbThumbs');
  box.innerHTML = lb.items.map((it, i) =>
    `<button class="lb-thumb" data-i="${i}" aria-label="Ir para a foto ${i + 1}"><img ${imgSrc(it.photo, 160)} alt="" loading="lazy" /></button>`).join('');
  box.style.display = lb.items.length > 1 ? '' : 'none';
  box.querySelectorAll('.lb-thumb').forEach(b => {
    b.addEventListener('click', () => lbGo(Number(b.dataset.i), true));
  });
}

function lbRender(direction) {
  const it = lb.items[lb.index];
  if (!it) return;
  const n = lb.items.length;
  const img = $('lbImg');
  const gallery = lb.source && lb.source.type === 'gallery';

  img.classList.remove('in-next', 'in-prev', 'dragging');
  img.style.transform = '';
  lb.zoomed = false; lb.tx = 0; lb.ty = 0;
  $('lbStage').classList.remove('zoomed');
  $('lbZoom').classList.remove('on');
  img.src = it.photo;
  if (direction) { void img.offsetWidth; img.classList.add(direction === 'next' ? 'in-next' : 'in-prev'); }

  $('lbBg').style.backgroundImage = `url("${thumb(it.photo, 400)}")`;
  $('lbVase').textContent = it.vaseName;
  $('lbCounter').textContent = `Foto ${lb.index + 1} de ${n}` + (gallery && it.speciesName ? ` · ${it.speciesName}` : '');

  const d = new Date(it.date);
  $('lbDate').textContent = isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  // O "tempo de crescimento" sempre conta a partir da primeira foto DO MESMO vaso
  const vase = S.vases.find(v => v.firestoreId === it.vaseId);
  const own = vase ? vasePhotos(vase) : [];
  const first = own.length ? new Date(own[0].date) : d;
  const chip = $('lbChip');
  if (own.length <= 1) { chip.textContent = '📸 Única foto deste vaso'; chip.className = 'chipd'; }
  else if (own[0].date === it.date && own[0].photo === it.photo) { chip.textContent = '🌱 Início da jornada'; chip.className = 'chipd'; }
  else {
    const days = Math.max(0, daysBetween(first, d));
    chip.textContent = days === 0 ? '🌿 No mesmo dia da 1ª foto' : `🌿 +${plural(days, 'dia', 'dias')} de crescimento`;
    chip.className = 'chipd grow';
  }

  $('lbPrev').disabled = lb.index === 0;
  $('lbNext').disabled = lb.index === n - 1;

  const dl = $('lbDownload');
  const slug = (it.vaseName || 'planta').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  dl.href = it.photo;
  dl.download = `${slug}-${isNaN(d) ? 'foto' : d.toISOString().slice(0, 10)}.jpg`;

  $('lbThumbs').querySelectorAll('.lb-thumb').forEach((b, i) => {
    const active = i === lb.index;
    b.classList.toggle('active', active);
    if (active && b.scrollIntoView) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: direction ? 'smooth' : 'auto' });
  });

  // Pré-carrega as vizinhas
  [lb.index - 1, lb.index + 1].forEach(i => { if (lb.items[i]) { const p = new Image(); p.src = lb.items[i].photo; } });

  lbRestartProgress();
}

function lbRestartProgress() {
  const bar = $('lbProgress');
  bar.classList.remove('run');
  if (lb.playing) {
    bar.style.setProperty('--play', PLAY_MS + 'ms');
    void bar.offsetWidth;
    bar.classList.add('run');
  }
}

function lbGo(i, manual = false) {
  if (i < 0 || i >= lb.items.length || i === lb.index) return;
  if (manual) lbStopPlay();
  const dir = i > lb.index ? 'next' : 'prev';
  lb.index = i;
  lbRender(dir);
}

export function lbPrev() { lbGo(lb.index - 1, true); }

export function lbNext() { lbGo(lb.index + 1, true); }

function lbStopPlay() {
  lb.playing = false;
  clearInterval(lb.timer);
  lb.timer = null;
  const btn = $('lbPlay');
  btn.textContent = '▶';
  btn.classList.remove('on');
  $('lbProgress').classList.remove('run');
}

export function lbTogglePlay(forceOn) {
  if (lb.items.length < 2) return;
  if (lb.playing && forceOn !== true) { lbStopPlay(); return; }
  lb.playing = true;
  const btn = $('lbPlay');
  btn.textContent = '⏸';
  btn.classList.add('on');
  clearInterval(lb.timer);
  lb.timer = setInterval(() => {
    const next = (lb.index + 1) % lb.items.length;
    lb.index = next;
    lbRender(next === 0 ? 'prev' : 'next');
  }, PLAY_MS);
  lbRestartProgress();
}

function lbApplyTransform(animated = true) {
  const img = $('lbImg');
  img.classList.toggle('dragging', !animated);
  img.style.transform = lb.zoomed ? `translate(${lb.tx}px, ${lb.ty}px) scale(${ZOOM_SCALE})` : '';
  $('lbStage').classList.toggle('zoomed', lb.zoomed);
  $('lbZoom').classList.toggle('on', lb.zoomed);
}

export function lbToggleZoom(pt) {
  const img = $('lbImg');
  if (!lb.zoomed) {
    lbStopPlay();
    const r = img.getBoundingClientRect();
    if (pt && typeof pt.x === 'number') {
      lb.tx = -(pt.x - (r.left + r.width / 2)) * (ZOOM_SCALE - 1);
      lb.ty = -(pt.y - (r.top + r.height / 2)) * (ZOOM_SCALE - 1);
    } else { lb.tx = 0; lb.ty = 0; }
  } else { lb.tx = 0; lb.ty = 0; }
  lb.zoomed = !lb.zoomed;
  lbApplyTransform(true);
}

export async function lbDelete() {
  const it = lb.items[lb.index];
  if (!it) return;
  lbStopPlay();
  const ok = await askConfirm(`Excluir esta foto de “${it.vaseName}”? Essa ação não pode ser desfeita.`, { icon: '🗑', okLabel: 'Excluir foto' });
  if (!ok) return;
  try {
    const ref = doc(db, "vases", it.vaseId);
    if (it.legacy) await updateDoc(ref, { photo: '' });
    else await updateDoc(ref, { photoHistory: arrayRemove(it.raw) });
    // A foto continua no Cloudinary; aqui só sai da galeria. "Desfazer" recoloca a referência.
    toast('Foto excluída.', 'ok', { ms: 8000, action: { label: 'Desfazer', onClick: async () => {
      try {
        await updateDoc(ref, it.legacy ? { photo: it.photo } : { photoHistory: arrayUnion(it.raw) });
        toast('Foto restaurada 📸');
      } catch (err) { toast('Não foi possível restaurar: ' + friendlyError(err), 'error'); }
    } } });
  } catch (err) {
    toast('Erro ao excluir foto: ' + friendlyError(err), 'error');
  }
}

// Atualiza o carrossel se os dados mudarem enquanto ele está aberto (outra aba, exclusão, nova foto…)
export function lbRefreshData() {
  if (!lb.open) return;
  const items = lbBuildItems();
  if (!items.length) { closeLightbox(); return; }

  const same = items.length === lb.items.length && items.every((it, i) => photoKey(it) === photoKey(lb.items[i]));
  if (same) return;

  const currentKey = lb.items[lb.index] ? photoKey(lb.items[lb.index]) : null;
  let idx = items.findIndex(it => photoKey(it) === currentKey);
  if (idx < 0) idx = Math.min(lb.index, items.length - 1);
  lb.items = items;
  lb.index = idx;
  if (items.length < 2) lbStopPlay();
  $('lbPlay').style.visibility = items.length > 1 ? 'visible' : 'hidden';
  lbBuildThumbs();
  lbRender(null);
}

// Gestos: arrastar para trocar de foto, toque duplo para zoom, arrastar com zoom para mover
(function initLightboxGestures() {
  const stage = $('lbStage');
  const img = $('lbImg');
  let drag = null;
  let lastTap = 0;

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, tx: lb.tx, ty: lb.ty, moved: false, id: e.pointerId };
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) drag.moved = true;
    if (lb.zoomed) {
      lb.tx = drag.tx + dx;
      lb.ty = drag.ty + dy;
      lbApplyTransform(false);
    } else if (drag.moved) {
      img.classList.add('dragging');
      img.style.transform = `translateX(${dx}px) rotate(${dx / 60}deg)`;
    }
  });

  const end = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const wasMoved = drag.moved;
    drag = null;
    if (lb.zoomed) { lbApplyTransform(true); return; }
    img.classList.remove('dragging');

    if (wasMoved && Math.abs(dx) > 60) {
      img.style.transform = '';
      if (dx < 0) lbNext(); else lbPrev();
      return;
    }
    img.style.transform = '';

    if (!wasMoved) {
      const now = Date.now();
      if (now - lastTap < 320) { lastTap = 0; lbToggleZoom({ x: e.clientX, y: e.clientY }); }
      else lastTap = now;
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', () => { drag = null; img.classList.remove('dragging'); img.style.transform = lb.zoomed ? img.style.transform : ''; });
})();

// Teclado global: setas, espaço, Home/End, Esc
document.addEventListener('keydown', (e) => {
  if (lb.open) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); lbPrev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbNext(); }
    else if (e.key === 'Home') { e.preventDefault(); lbGo(0, true); }
    else if (e.key === 'End') { e.preventDefault(); lbGo(lb.items.length - 1, true); }
    else if (e.key === ' ') { e.preventDefault(); lbTogglePlay(); }
    else if (e.key === 'z' || e.key === 'Z') { lbToggleZoom(); }
    return;
  }
  if (e.key === 'Escape' && S.activeDrawerId) closeActiveDrawer();
});
