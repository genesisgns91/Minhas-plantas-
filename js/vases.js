import { $, DAY_MS, esc, fmtDate, plural } from './utils.js';
import { S } from './state.js';
import { emptyPlantSvg } from './species.js';
import { activePests, waterStatus } from './care.js';
import { buildPhotoAddPayload, docBytes, vaseCover, vasePhotos } from './photos.js';
import { closeActiveDrawer, openDrawer } from './ui/drawers.js';
import { friendlyError, toast } from './ui/feedback.js';
import { DOC_SAFE_BYTES, imgSrc, isDataUrl, storePhoto } from './images.js';
import { addVase, patchVase, deleteVaseDoc } from './repo.js';
import { askConfirm } from './ui/dialogs.js';

// ==================== RENDER: VASOS ====================
function sparklineHtml(history) {
  const regas = history.filter(h => h.type === 'lastWater').map(h => new Date(h.date)).filter(d => !isNaN(d)).sort((a, b) => a - b);
  if (regas.length < 2) return `<div class="spark-empty">Registre mais regas para ver o ritmo.</div>`;
  const intervals = [];
  for (let i = 1; i < regas.length; i++) {
    intervals.push(Math.max(1, Math.round((regas[i] - regas[i - 1]) / DAY_MS)));
  }
  const last = intervals.slice(-10);
  const max = Math.max(...last, 1);
  return `<div class="spark-bars">${last.map((v, k) => `<div class="spark-bar" style="--h:${Math.max(12, Math.round(v / max * 100))}%; --k:${k}"><i>${v}d</i></div>`).join('')}</div>`;
}

export function renderVasesForSpecies(speciesId, { animate = false } = {}) {
  const container = $('vasesGrid');
  const species = S.species.find(s => s.firestoreId === speciesId);
  const myVases = S.vases.filter(v => v.speciesId === speciesId);

  if (!S.vasesLoaded) {
    container.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    return;
  }

  if (myVases.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>Nenhum vaso por aqui ainda</h4><p>Cadastre o primeiro vaso desta espécie para registrar cuidados e fotos.</p><button class="btn btn-primary" onclick="openAddVaseModal()">🪴 Adicionar vaso</button></div>`;
    return;
  }

  container.innerHTML = '';
  myVases.forEach((vase, i) => {
    const ws = waterStatus(vase, species);
    const photos = vasePhotos(vase);
    const cover = photos.length ? photos[photos.length - 1].photo : '';
    const history = vase.history || [];

    const card = document.createElement('div');
    card.className = 'vase-card' + (animate ? ' enter' : '');
    card.style.setProperty('--i', Math.min(i, 10));
    const vid = vase.firestoreId;

    card.innerHTML = `
      <button class="vase-media" onclick="openVaseDetail('${vid}')" aria-label="Abrir detalhes de ${esc(vase.name)}">
        ${cover ? `<img ${imgSrc(cover, 640)} class="vase-img" alt="" loading="lazy" decoding="async" />` : `<div class="vase-img-icon">${esc(vase.icon || '🪴')}</div>`}
        <div class="vase-chips top">
          <span class="pill ${ws.state === 'late' || ws.state === 'due' ? 'late' : 'water'}">${ws.icon} ${esc(ws.title)}</span>
        </div>
        <div class="vase-chips bottom">
          <span>${activePests(vase).length ? `<span class="pill late">🐛 ${plural(activePests(vase).length, 'praga', 'pragas')}</span>` : ''}</span>
          ${photos.length ? `<span class="pill">📸 ${photos.length}</span>` : ''}
        </div>
      </button>

      <div class="vase-body">
        <div class="vase-title-row">
          <div>
            <h4 onclick="openVaseDetail('${vid}')">${esc(vase.name)}</h4>
            <div class="vase-size">${esc(vase.size || 'Tamanho padrão')}</div>
          </div>
          <div class="vase-tools">
            <button class="btn-icon" onclick="editVase('${vid}')" title="Editar vaso" aria-label="Editar vaso">✏️</button>
            <button class="btn-icon danger" onclick="deleteVase('${vid}')" title="Excluir vaso" aria-label="Excluir vaso">🗑</button>
          </div>
        </div>

        <div class="water-meter s-${ws.state}">
          <div class="water-meter-top"><b>${ws.icon} ${esc(ws.title)}</b><span>${esc(ws.sub)}</span></div>
          <div class="water-track"><div class="water-fill" style="--pct:${ws.pct}%"></div></div>
        </div>

        <div class="care-dates">
          <div class="care-date"><span>💧 Rega</span><b>${fmtDate(vase.lastWater, 'Nunca')}</b></div>
          <div class="care-date"><span>🧪 Adubação</span><b>${fmtDate(vase.lastFertilizer, 'Nunca')}</b></div>
          <div class="care-date"><span>✂️ Poda</span><b>${fmtDate(vase.lastPruning, 'Nunca')}</b></div>
          <div class="care-date"><span>🪴 Transbordo</span><b>${fmtDate(vase.lastRepot, 'Não informado')}</b></div>
        </div>

        <div class="spark">
          <div class="spark-title">📊 Intervalo entre regas</div>
          ${sparklineHtml(history)}
        </div>

        <div class="quick-actions">
          <button class="quick-btn water-btn" onclick="recordCareQuick('${vid}', 'lastWater', this)"><span class="q-ico">💧</span>Regar</button>
          <button class="quick-btn" onclick="recordCareQuick('${vid}', 'lastFertilizer', this)"><span class="q-ico">🧪</span>Adubar</button>
          <button class="quick-btn" onclick="recordCareQuick('${vid}', 'lastPruning', this)"><span class="q-ico">✂️</span>Podar</button>
          <button class="quick-btn" onclick="recordCareQuick('${vid}', 'lastRepot', this)"><span class="q-ico">🪴</span>Transplantar</button>
        </div>

        <div class="vase-footer">
          <button class="btn btn-primary" style="padding:.7rem 1rem; font-size:.82rem;" onclick="openVaseDetail('${vid}')">🔍 Detalhes & galeria</button>
          <button class="btn btn-secondary" onclick="openCareLogDrawer('${vid}')" title="Registro retroativo ou lembrete" aria-label="Registro retroativo ou lembrete">⏰</button>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

// ==================== VASOS: CADASTRAR / EDITAR / EXCLUIR ====================
export function openAddVaseModal() {
  $('formVase').reset();
  $('vaseEditId').value = '';
  $('vaseModalTitle').textContent = 'Cadastrar novo vaso';
  $('vasePhotoPreview').style.display = 'none';
  $('vasePhotoPreview').src = '';
  S.vasePhoto = null;
  openDrawer('drawerAddVase');
}

export function editVase(vaseId) {
  const vase = S.vases.find(v => v.firestoreId === vaseId);
  if (!vase) return;

  $('vaseEditId').value = vase.firestoreId;
  $('vaseModalTitle').textContent = 'Editar vaso';

  $('vaseName').value = vase.name || '';
  $('vaseIcon').value = vase.icon || '🪴';
  $('vaseSize').value = vase.size || '';
  $('vaseRepotDate').value = vase.lastRepot ? vase.lastRepot.slice(0, 10) : '';

  S.vasePhoto = null;
  const preview = $('vasePhotoPreview');
  const cover = vaseCover(vase);
  if (cover) {
    preview.src = cover;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
    preview.src = '';
  }

  openDrawer('drawerAddVase');
}

export async function saveVase(event) {
  event.preventDefault();
  if (!S.selectedSpecies) { toast('Selecione uma espécie primeiro.', 'error'); return; }

  const btn = $('btnSaveVase');
  const editId = $('vaseEditId').value;
  const name = $('vaseName').value.trim();
  const icon = $('vaseIcon').value || '🪴';
  const size = $('vaseSize').value.trim();
  const repotDate = $('vaseRepotDate').value;

  btn.disabled = true;
  const label = btn.textContent;

  try {
    let stored = null;
    if (S.vasePhoto) {
      btn.textContent = 'Enviando foto…';
      stored = await storePhoto(S.vasePhoto, ['vaso']);
    }

    if (editId) {
      const vase = S.vases.find(v => v.firestoreId === editId);
      const updatePayload = { name, size, icon };

      if (stored && vase) {
        if (isDataUrl(stored.photo) && docBytes(vase) + stored.photo.length > DOC_SAFE_BYTES) {
          throw new Error('Este vaso já está com a galeria cheia. Exclua fotos antigas antes de adicionar novas.');
        }
        Object.assign(updatePayload, buildPhotoAddPayload(vase, stored));
      }

      if (repotDate) updatePayload.lastRepot = new Date(repotDate).toISOString();

      await patchVase(editId, updatePayload);
    } else {
      const now = new Date().toISOString();
      const vaseData = {
        speciesId: S.selectedSpecies.firestoreId,
        name,
        icon,
        size,
        photo: '', // a capa é sempre a foto mais recente de photoHistory
        photoHistory: stored ? [{ ...stored, date: now }] : [],
        history: [],
        createdAt: now
      };

      if (repotDate) {
        const repotIso = new Date(repotDate).toISOString();
        vaseData.lastRepot = repotIso;
        vaseData.history = [{ type: 'lastRepot', date: repotIso }];
      }

      await addVase(vaseData);
    }

    $('formVase').reset();
    $('vasePhotoPreview').style.display = 'none';
    S.vasePhoto = null;
    closeActiveDrawer();
    toast(editId ? 'Vaso atualizado 🪴' : 'Vaso cadastrado 🪴');
  } catch (err) {
    toast('Erro ao salvar vaso: ' + friendlyError(err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

export async function deleteVase(firestoreId) {
  const vase = S.vases.find(v => v.firestoreId === firestoreId);
  const ok = await askConfirm(`Excluir ${vase ? '“' + vase.name + '”' : 'este vaso'} com todo o histórico e fotos? Essa ação não pode ser desfeita.`, { icon: '🥀', okLabel: 'Excluir' });
  if (!ok) return;
  try {
    const undo = await deleteVaseDoc(vase);
    toast('Vaso excluído.', 'ok', { ms: 8000, action: { label: 'Desfazer', onClick: async () => {
      try { await undo(); toast('Vaso restaurado 🪴'); } catch (err) { toast('Não foi possível restaurar: ' + friendlyError(err), 'error'); }
    } } });
  } catch (err) {
    toast('Erro ao excluir vaso: ' + friendlyError(err), 'error');
  }
}
