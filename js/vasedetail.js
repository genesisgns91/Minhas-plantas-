import { S } from './state.js';
import { openDrawer } from './ui/drawers.js';
import { $, DAY_MS, esc, fmtDate, plural } from './utils.js';
import { buildPhotoAddPayload, docBytes, vasePhotos } from './photos.js';
import { DOC_LIMIT_BYTES, DOC_SAFE_BYTES, compressImage, isCloudConfigured, isDataUrl, photoOptions, storePhoto, imgSrc } from './images.js';
import { friendlyError, toast } from './ui/feedback.js';
import { patchVase } from './repo.js';
import { renderVasePests } from './pests.js';

// ==================== DETALHES DO VASO: HISTÓRICO & GALERIA ====================
export function openVaseDetail(vaseId) {
  S.detailVaseId = vaseId;
  renderVaseDetail(vaseId);
  openDrawer('drawerVaseDetail');
}

export function renderVaseDetail(vaseId) {
  const vase = S.vases.find(v => v.firestoreId === vaseId);
  if (!vase) return;

  $('vaseDetailName').textContent = vase.name;

  const photos = vasePhotos(vase);
  const hero = $('vaseDetailHero');
  if (photos.length) {
    hero.disabled = false;
    hero.innerHTML = `<img ${imgSrc(photos[photos.length - 1].photo, 1000)} alt="Foto mais recente de ${esc(vase.name)}" /><span class="pill hint">🔍 Ampliar${photos.length > 1 ? ' · ' + photos.length + ' fotos' : ''}</span>`;
  } else {
    hero.disabled = true;
    hero.innerHTML = `<div class="hero-ph">${esc(vase.icon || '🌱')}</div>`;
  }

  const history = vase.history || [];

  // ----- Frequência de cuidados -----
  const CARE_TYPES = [
    { key: 'lastWater', label: '💧 Rega' },
    { key: 'lastFertilizer', label: '🧪 Adubação' },
    { key: 'lastPruning', label: '✂️ Poda' },
    { key: 'lastRepot', label: '🪴 Transbordo' }
  ];

  $('vaseDetailStats').innerHTML = CARE_TYPES.map(ct => {
    const events = history.filter(h => h.type === ct.key).map(h => new Date(h.date)).filter(d => !isNaN(d)).sort((a, b) => a - b);
    let freqText = 'Mínimo de 2 registros necessário';
    if (events.length >= 2) {
      let total = 0;
      for (let i = 1; i < events.length; i++) total += (events[i] - events[i - 1]) / DAY_MS;
      freqText = `Média: a cada ${(total / (events.length - 1)).toFixed(1).replace('.', ',')} dias`;
    }
    return `<div class="stat-mini"><div class="t">${ct.label}</div><div class="d">Última: ${fmtDate(vase[ct.key], 'nunca registrada')}</div><div class="f">${freqText}</div></div>`;
  }).join('');

  // ----- Histórico -----
  const typeLabels = { lastWater: '💧 Regou', lastFertilizer: '🧪 Adubou', lastPruning: '✂️ Podou', lastRepot: '🪴 Transbordou', lembrete: '⏰ Lembrete', nota: '📝 Nota' };
  const sortedHistory = history.map((h, i) => ({ h, i })).sort((a, b) => new Date(b.h.date) - new Date(a.h.date));
  $('vaseDetailHistory').innerHTML = sortedHistory.length === 0
    ? '<p class="muted">Nenhum registro de cuidado ainda.</p>'
    : sortedHistory.map(({ h, i }) => {
        const d = new Date(h.date);
        return `<div class="timeline-item">
          <span class="timeline-date">${d.toLocaleDateString('pt-BR')} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          <div class="tl-body"><span><b>${typeLabels[h.type] || esc(h.type)}</b> — ${esc(h.notes || 'Sem observação')}</span>
            <span class="tl-actions">
              <button class="btn-icon" onclick="openHistoryEdit('${vaseId}', ${i})" aria-label="Editar registro de ${d.toLocaleDateString('pt-BR')}">✏️</button>
              <button class="btn-icon danger" onclick="deleteHistoryEntry('${vaseId}', ${i})" aria-label="Excluir registro de ${d.toLocaleDateString('pt-BR')}">🗑</button>
            </span></div>
        </div>`;
      }).join('');

  // ----- Galeria clicável -----
  const used = docBytes(vase);
  const pct = Math.min(100, Math.round(used / DOC_LIMIT_BYTES * 100));
  const meter = $('galleryMeter');
  const hasInline = photos.some(p => isDataUrl(p.photo)); // só fotos gravadas dentro do documento ocupam o limite de 1 MB
  meter.hidden = !hasInline;
  meter.style.setProperty('--pct', pct + '%');
  meter.classList.toggle('full', pct >= 85);
  $('galleryNote').textContent = !photos.length
    ? 'Adicione a primeira foto para começar a acompanhar a evolução.'
    : hasInline
      ? `${plural(photos.length, 'foto', 'fotos')} · ${pct}% do espaço deste vaso usado${pct >= 85 ? ' — exclua fotos antigas para adicionar novas' : ''}`
      : plural(photos.length, 'foto', 'fotos');
  $('btnPlayEvolution').disabled = photos.length < 2;

  const galleryEl = $('vaseDetailGallery');
  if (photos.length === 0) {
    galleryEl.innerHTML = '<p class="muted" style="grid-column:1/-1;">Nenhuma foto na galeria ainda. 📷</p>';
  } else {
    galleryEl.innerHTML = photos.map((g, i) => `
      <button class="gallery-thumb${i === photos.length - 1 ? ' latest' : ''}" onclick="openLightbox('${vaseId}', ${i})" aria-label="Ampliar foto ${i + 1} de ${photos.length}">
        <img ${imgSrc(g.photo, 320)} alt="" loading="lazy" decoding="async" />
        <span class="g-num">${i === photos.length - 1 && photos.length > 1 ? 'Atual' : '#' + (i + 1)}</span>
        <span class="g-date">${fmtDate(g.date)}</span>
      </button>`).join('');
  }

  renderVasePests(vase);
}

export async function addGalleryPhoto(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !S.detailVaseId) return;
  const vase = S.vases.find(v => v.firestoreId === S.detailVaseId);
  if (!vase) return;

  try {
    const dataUrl = await compressImage(file, photoOptions(true));
    if (isCloudConfigured()) toast('Enviando foto…');
    const stored = await storePhoto(dataUrl, ['vaso']);
    if (isDataUrl(stored.photo) && docBytes(vase) + stored.photo.length > DOC_SAFE_BYTES) {
      toast('A galeria deste vaso está cheia. Exclua fotos antigas para adicionar novas.', 'error');
      return;
    }
    await patchVase(S.detailVaseId, buildPhotoAddPayload(vase, stored));
    toast('Foto adicionada à galeria 📸');
  } catch (err) {
    toast('Erro ao adicionar foto: ' + friendlyError(err), 'error');
  }
}
