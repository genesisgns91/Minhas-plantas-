// Pragas e tratamentos por vaso: histórico de ocorrências, tratamentos aplicados e reaplicações combinadas.
import { S } from './state.js';
import { $, esc, fmtDate, plural, daysBetween } from './utils.js';
import { patchVase } from './repo.js';
import { activePests, SEVERITIES, pestNextDate } from './care.js';
import { openDrawer, closeActiveDrawer } from './ui/drawers.js';
import { toast, friendlyError } from './ui/feedback.js';
import { askConfirm } from './ui/dialogs.js';
import { toLocalInput } from './carelog.js';

const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const vaseById = (id) => S.vases.find(v => v.firestoreId === id);
const pestsOf = (vase) => [...(vase.pests || [])];
const dateInput = (iso) => (iso ? toLocalInput(iso).slice(0, 10) : '');
const fromDateInput = (v) => (v ? new Date(v + 'T12:00:00').toISOString() : '');

async function savePests(vaseId, pests, okMessage, undoPests) {
  try {
    await patchVase(vaseId, { pests });
    if (okMessage) {
      const opts = undoPests ? { ms: 8000, action: { label: 'Desfazer', onClick: async () => {
        try { await patchVase(vaseId, { pests: undoPests }); toast('Alteração desfeita ✅'); } catch (err) { toast('Não foi possível desfazer: ' + friendlyError(err), 'error'); }
      } } } : 3200;
      toast(okMessage, 'ok', opts);
    }
    return true;
  } catch (err) {
    toast('Erro ao salvar: ' + friendlyError(err), 'error');
    return false;
  }
}

// ---------- Lista no painel do vaso ----------
export function renderVasePests(vase) {
  const box = $('vasePests');
  if (!box) return;
  const pests = [...(vase.pests || [])].sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved') || new Date(b.date) - new Date(a.date));
  const active = activePests(vase).length;
  $('pestsCount').textContent = active ? plural(active, 'ativa', 'ativas') : (pests.length ? 'nenhuma ativa' : '');

  if (!pests.length) {
    box.innerHTML = '<p class="muted">Nenhuma praga registrada neste vaso. 🌿 Quando aparecer algo, registre aqui para acompanhar os tratamentos.</p>';
    return;
  }
  const now = new Date();
  box.innerHTML = pests.map(p => {
    const sev = SEVERITIES[p.severity] || SEVERITIES.leve;
    const resolved = p.status === 'resolved';
    const days = Math.max(0, daysBetween(new Date(p.date), resolved && p.resolvedAt ? new Date(p.resolvedAt) : now));
    const next = !resolved && pestNextDate(p);
    const treatments = [...(p.treatments || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
    const vid = vase.firestoreId;
    return `<article class="pest-card ${resolved ? 'resolved' : 'active'} sev-${esc(p.severity || 'leve')}">
      <header class="pest-head">
        <h5>🐛 ${esc(p.name)}</h5>
        <span class="pill sev">${sev.label}</span>
        <span class="pill state">${resolved ? '✅ Resolvida' : '⚠️ Ativa'}</span>
      </header>
      <p class="pest-meta">Detectada em ${fmtDate(p.date)} · ${resolved ? `resolvida após ${plural(days, 'dia', 'dias')}` : `há ${plural(days, 'dia', 'dias')}`}</p>
      ${p.notes ? `<p class="pest-notes">${esc(p.notes)}</p>` : ''}
      ${next ? `<p class="pest-next">🔁 Próxima aplicação: <b>${fmtDate(next)}</b></p>` : ''}
      ${treatments.length ? `<ul class="treat-list">${treatments.map(t => `<li>
        <span><b>${fmtDate(t.date)}</b> — ${esc(t.product)}${t.notes ? ` <i>· ${esc(t.notes)}</i>` : ''}${t.nextDate ? ` · reaplicar em ${fmtDate(t.nextDate)}` : ''}</span>
        <button class="btn-icon danger" onclick="deleteTreatment('${vid}', '${p.id}', '${t.id}')" aria-label="Excluir tratamento de ${fmtDate(t.date)}">🗑</button></li>`).join('')}</ul>` : ''}
      <div class="pest-actions">
        ${resolved ? '' : `<button class="btn btn-secondary" onclick="openTreatmentForm('${vid}', '${p.id}')">＋ Tratamento</button>`}
        <button class="btn btn-ghost" onclick="togglePestResolved('${vid}', '${p.id}')">${resolved ? '↺ Reabrir' : '✓ Marcar resolvida'}</button>
        <button class="btn-icon" onclick="openPestForm('${vid}', '${p.id}')" aria-label="Editar ${esc(p.name)}">✏️</button>
        <button class="btn-icon danger" onclick="deletePest('${vid}', '${p.id}')" aria-label="Excluir ${esc(p.name)}">🗑</button>
      </div>
    </article>`;
  }).join('');
}

// ---------- Registrar / editar ocorrência ----------
export function openPestForm(vaseId, pestId, prefill = {}) {
  $('formPest').reset();
  const select = $('pestVase');
  const choose = !vaseId; // vindo do diagnóstico da IA: escolher o vaso
  $('pestVaseGroup').hidden = !choose;
  if (choose) {
    select.innerHTML = '<option value="">Escolha o vaso…</option>' + S.vases.map(v => {
      const sp = S.species.find(s => s.firestoreId === v.speciesId);
      return `<option value="${esc(v.firestoreId)}">${esc(v.name)}${sp ? ' · ' + esc(sp.name) : ''}</option>`;
    }).join('');
    select.required = true;
  } else { select.required = false; }
  $('pestVaseId').value = vaseId || '';
  $('pestEditId').value = pestId || '';
  $('pestDate').value = dateInput(new Date().toISOString());
  $('pestSeverity').value = 'moderada';
  $('pestModalTitle').textContent = pestId ? 'Editar ocorrência' : 'Registrar praga ou doença';
  $('btnSavePest').textContent = pestId ? 'Salvar alterações' : 'Registrar ocorrência';
  if (pestId) {
    const p = (vaseById(vaseId).pests || []).find(x => x.id === pestId);
    if (p) {
      $('pestName').value = p.name; $('pestSeverity').value = p.severity || 'moderada';
      $('pestDate').value = dateInput(p.date); $('pestNotes').value = p.notes || '';
    }
  } else {
    if (prefill.notes) $('pestNotes').value = prefill.notes;
    if (prefill.name) $('pestName').value = prefill.name;
  }
  openDrawer('drawerPest');
}

export async function savePest(event) {
  event.preventDefault();
  const vaseId = $('pestVaseId').value || $('pestVase').value;
  const vase = vaseById(vaseId);
  if (!vase) { toast('Escolha o vaso da ocorrência.', 'error'); return; }
  const editId = $('pestEditId').value;
  const before = pestsOf(vase);
  const data = {
    name: $('pestName').value.trim(),
    severity: $('pestSeverity').value,
    date: fromDateInput($('pestDate').value) || new Date().toISOString(),
    notes: $('pestNotes').value.trim()
  };
  if (!data.name) { $('pestName').focus(); return; }
  const btn = $('btnSavePest');
  btn.disabled = true;
  let next;
  if (editId) next = before.map(p => p.id === editId ? { ...p, ...data } : p);
  else next = [...before, { id: newId(), status: 'active', treatments: [], ...data }];
  const ok = await savePests(vaseId, next, editId ? 'Ocorrência atualizada 🐛' : 'Ocorrência registrada. Que tal já anotar um tratamento? 🐛');
  btn.disabled = false;
  if (ok) closeActiveDrawer();
}

export async function deletePest(vaseId, pestId) {
  const vase = vaseById(vaseId);
  const pest = vase && (vase.pests || []).find(p => p.id === pestId);
  if (!pest) return;
  const ok = await askConfirm(`Excluir o registro de “${pest.name}” e seus tratamentos?`, { icon: '🥀', okLabel: 'Excluir' });
  if (!ok) return;
  const before = pestsOf(vase);
  await savePests(vaseId, before.filter(p => p.id !== pestId), 'Ocorrência excluída.', before);
}

export async function togglePestResolved(vaseId, pestId) {
  const vase = vaseById(vaseId);
  if (!vase) return;
  const before = pestsOf(vase);
  const next = before.map(p => {
    if (p.id !== pestId) return p;
    if (p.status === 'resolved') { const rest = { ...p }; delete rest.resolvedAt; return { ...rest, status: 'active' }; }
    return { ...p, status: 'resolved', resolvedAt: new Date().toISOString() };
  });
  const nowResolved = next.find(p => p.id === pestId).status === 'resolved';
  await savePests(vaseId, next, nowResolved ? 'Praga resolvida! 🎉' : 'Ocorrência reaberta.', before);
}

// ---------- Tratamentos ----------
export function openTreatmentForm(vaseId, pestId) {
  const vase = vaseById(vaseId);
  const pest = vase && (vase.pests || []).find(p => p.id === pestId);
  if (!pest) return;
  $('formTreatment').reset();
  $('treatVaseId').value = vaseId;
  $('treatPestId').value = pestId;
  $('treatDate').value = toLocalInput();
  $('treatSubtitle').textContent = `${pest.name} · ${vase.name}`;
  openDrawer('drawerTreatment');
}

export async function saveTreatment(event) {
  event.preventDefault();
  const vaseId = $('treatVaseId').value, pestId = $('treatPestId').value;
  const vase = vaseById(vaseId);
  if (!vase) return;
  const before = pestsOf(vase);
  const treatment = {
    id: newId(),
    date: new Date($('treatDate').value || Date.now()).toISOString(),
    product: $('treatProduct').value.trim(),
    notes: $('treatNotes').value.trim()
  };
  const nextDate = fromDateInput($('treatNext').value);
  if (nextDate) treatment.nextDate = nextDate;
  if (!treatment.product) { $('treatProduct').focus(); return; }
  const markResolved = $('treatResolve').checked;
  const next = before.map(p => p.id !== pestId ? p : {
    ...p, treatments: [...(p.treatments || []), treatment],
    ...(markResolved ? { status: 'resolved', resolvedAt: new Date().toISOString() } : {})
  });
  const btn = $('btnSaveTreatment');
  btn.disabled = true;
  const ok = await savePests(vaseId, next, markResolved ? 'Tratamento registrado e praga resolvida 🎉' : 'Tratamento registrado 💊', before);
  btn.disabled = false;
  if (ok) closeActiveDrawer();
}

export async function deleteTreatment(vaseId, pestId, treatId) {
  const vase = vaseById(vaseId);
  if (!vase) return;
  const before = pestsOf(vase);
  const next = before.map(p => p.id !== pestId ? p : { ...p, treatments: (p.treatments || []).filter(t => t.id !== treatId) });
  await savePests(vaseId, next, 'Tratamento excluído.', before);
}

// Atalho do diagnóstico por IA: guarda o relatório como ocorrência de um vaso
export function savePestFromDiagnosis() {
  const el = document.querySelector('#aiResult .ai-text');
  const text = el ? el.textContent.trim().slice(0, 900) : '';
  if (!S.vases.length) { toast('Cadastre um vaso primeiro para guardar o diagnóstico.', 'error'); return; }
  openPestForm(null, null, { notes: text });
}

export function openPestFormForCurrent() { if (S.detailVaseId) openPestForm(S.detailVaseId); }
