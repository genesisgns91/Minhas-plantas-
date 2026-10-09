import { S } from './state.js';
import { burst, petalRain } from './ui/fx.js';
import { arrayUnion, db, doc, updateDoc } from './firebase.js';
import { patchVase } from './repo.js';
import { friendlyError, toast } from './ui/feedback.js';
import { filteredSpecies } from './filters.js';
import { askConfirm } from './ui/dialogs.js';
import { $, esc, plural } from './utils.js';
import { closeActiveDrawer, openDrawer } from './ui/drawers.js';

// ==================== CUIDADOS ====================
const CARE_LABELS = {
  lastWater: { done: '💧 Rega registrada', verb: 'Rega' },
  lastFertilizer: { done: '🧪 Adubação registrada', verb: 'Adubação' },
  lastPruning: { done: '✂️ Poda registrada', verb: 'Poda' },
  lastRepot: { done: '🪴 Transplante registrado', verb: 'Transplante' }
};

export async function recordCareQuick(vaseId, careType, btn) {
  const now = new Date().toISOString();
  const vase = S.vases.find(v => v.firestoreId === vaseId);
  burst(btn, careType);

  try {
    await updateDoc(doc(db, "vases", vaseId), {
      [careType]: now,
      history: arrayUnion({ type: careType, date: now, notes: "Registro rápido" })
    });
    toast(`${CARE_LABELS[careType].done}${vase ? ' · ' + vase.name : ''}`);
  } catch (err) {
    toast('Erro ao registrar ação: ' + friendlyError(err), 'error');
  }
}

// REGAR TODOS OS VASOS DAS ESPÉCIES ATUALMENTE FILTRADAS/VISÍVEIS
export async function waterAllFiltered() {
  const speciesIds = new Set(filteredSpecies().map(s => s.firestoreId));
  const vasesToWater = S.vases.filter(v => speciesIds.has(v.speciesId));

  if (vasesToWater.length === 0) {
    toast('Nenhum vaso encontrado para regar.', 'error');
    return;
  }

  const ok = await askConfirm(`Regar ${plural(vasesToWater.length, 'vaso', 'vasos')} agora?`, { icon: '💧', okLabel: 'Regar todos' });
  if (!ok) return;

  const now = new Date().toISOString();
  try {
    await Promise.all(vasesToWater.map(v => updateDoc(doc(db, "vases", v.firestoreId), {
      lastWater: now,
      history: arrayUnion({ type: 'lastWater', date: now, notes: 'Rega em lote (Regar Todos)' })
    })));
    petalRain();
    toast(`💧 ${plural(vasesToWater.length, 'vaso regado', 'vasos regados')}!`);
  } catch (err) {
    toast('Erro ao regar vasos: ' + friendlyError(err), 'error');
  }
}

const CARE_FIELDS = ['lastWater', 'lastFertilizer', 'lastPruning', 'lastRepot'];

/** Data/hora no formato do <input type="datetime-local"> (horário local). */
export function toLocalInput(value) {
  const d = value ? new Date(value) : new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Depois de editar ou excluir registros, "última rega/adubação/poda/transbordo" volta a refletir o histórico. */
export function recomputeLastFields(history) {
  const out = {};
  for (const field of CARE_FIELDS) {
    const times = history.filter(h => h.type === field).map(h => new Date(h.date).getTime()).filter(n => !isNaN(n));
    out[field] = times.length ? new Date(Math.max(...times)).toISOString() : '';
  }
  return out;
}

export function openCareLogDrawer(vaseId) {
  $('logVaseId').value = vaseId;
  $('logVaseGroup').hidden = true;
  $('logEditIndex').value = '';
  $('careLogTitle').textContent = 'Registrar cuidado / lembrete';
  $('btnSaveLog').textContent = 'Salvar registro';
  $('logDate').value = toLocalInput();
  openDrawer('drawerCareLog');
}

/** Novo lembrete criado pela agenda: o usuário escolhe o vaso e o dia. */
export function openReminderForm(dayKey) {
  if (!S.vases.length) { toast('Cadastre um vaso primeiro para criar lembretes.', 'error'); return; }
  const select = $('logVaseSelect');
  select.innerHTML = '<option value="">Escolha o vaso…</option>' + S.vases.map(v => {
    const sp = S.species.find(x => x.firestoreId === v.speciesId);
    return `<option value="${esc(v.firestoreId)}">${esc(v.name)}${sp ? ' · ' + esc(sp.name) : ''}</option>`;
  }).join('');
  $('logVaseGroup').hidden = false;
  $('logVaseId').value = '';
  $('logEditIndex').value = '';
  $('careLogTitle').textContent = 'Novo lembrete';
  $('btnSaveLog').textContent = 'Salvar lembrete';
  $('logActionType').value = 'lembrete';
  $('logDate').value = `${dayKey || toLocalInput().slice(0, 10)}T09:00`;
  $('logNotes').value = '';
  openDrawer('drawerCareLog');
}

export function openHistoryEdit(vaseId, index) {
  const vase = S.vases.find(v => v.firestoreId === vaseId);
  const entry = vase && (vase.history || [])[index];
  if (!entry) return;
  $('logVaseId').value = vaseId;
  $('logVaseGroup').hidden = true;
  $('logEditIndex').value = String(index);
  $('careLogTitle').textContent = 'Editar registro';
  $('btnSaveLog').textContent = 'Salvar alterações';
  $('logActionType').value = entry.type;
  $('logDate').value = toLocalInput(entry.date);
  $('logNotes').value = entry.notes || '';
  openDrawer('drawerCareLog');
}

export async function deleteHistoryEntry(vaseId, index) {
  const vase = S.vases.find(v => v.firestoreId === vaseId);
  if (!vase || !(vase.history || [])[index]) return;
  const before = { history: [...vase.history] };
  CARE_FIELDS.forEach(f => { before[f] = vase[f] || ''; });
  const next = vase.history.filter((_, i) => i !== index);
  try {
    await patchVase(vaseId, { history: next, ...recomputeLastFields(next) });
    toast('Registro excluído.', 'ok', { ms: 8000, action: { label: 'Desfazer', onClick: async () => {
      try { await patchVase(vaseId, before); toast('Registro restaurado ✅'); } catch (err) { toast('Não foi possível restaurar: ' + friendlyError(err), 'error'); }
    } } });
  } catch (err) {
    toast('Erro ao excluir registro: ' + friendlyError(err), 'error');
  }
}

export async function saveCareLog(e) {
  e.preventDefault();
  const vaseId = $('logVaseId').value || $('logVaseSelect').value;
  const actionType = $('logActionType').value;
  const dateVal = $('logDate').value;
  const notes = $('logNotes').value;

  if (!vaseId || !dateVal) return;

  const btn = $('btnSaveLog');
  btn.disabled = true;
  const isoDate = new Date(dateVal).toISOString();

  try {
    const editIdx = $('logEditIndex').value;
    if (editIdx !== '') {
      const vase = S.vases.find(v => v.firestoreId === vaseId);
      const next = [...((vase && vase.history) || [])];
      next[Number(editIdx)] = { type: actionType, date: isoDate, notes };
      await patchVase(vaseId, { history: next, ...recomputeLastFields(next) });
      closeActiveDrawer();
      $('formCareLog').reset();
      toast('Registro atualizado ✏️');
      return;
    }
    const updatePayload = { history: arrayUnion({ type: actionType, date: isoDate, notes }) };
    if (actionType !== 'lembrete' && actionType !== 'nota') {
      updatePayload[actionType] = isoDate;
    }
    await updateDoc(doc(db, "vases", vaseId), updatePayload);
    closeActiveDrawer();
    $('formCareLog').reset();
    toast('Registro salvo 🌿');
  } catch (err) {
    toast('Erro ao salvar registro: ' + friendlyError(err), 'error');
  } finally {
    btn.disabled = false;
  }
}
