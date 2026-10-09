import { filteredSpecies, refreshFilterChrome } from './filters.js';
import { $, esc, plural } from './utils.js';
import { S, activeFilters } from './state.js';
import { DEFAULT_FERT_DAYS, DEFAULT_PRUNE_DAYS, needsWater, petToxicityIcon, vasesOf } from './care.js';
import { leaveDetailUI, showView } from './nav.js';
import { renderVasesForSpecies } from './vases.js';
import { closeActiveDrawer, openDrawer } from './ui/drawers.js';
import { addSpecies, patchSpecies, deleteSpeciesCascade } from './repo.js';
import { imgSrc, storePhoto } from './images.js';
import { friendlyError, toast } from './ui/feedback.js';
import { petalRain } from './ui/fx.js';
import { askConfirm } from './ui/dialogs.js';
import { callWorkers } from './workers.js';
import { firstName } from './auth.js';

// ==================== RENDER: ESPÉCIES ====================
export function emptyPlantSvg() {
  return `<svg viewBox="0 0 160 140" aria-hidden="true">
    <ellipse cx="80" cy="128" rx="46" ry="7" fill="#dbe4d8"/>
    <path d="M52 92h56l-7 34H59z" fill="#c16e41"/><rect x="48" y="86" width="64" height="12" rx="6" fill="#d98557"/>
    <path d="M80 86V50" stroke="#5f8b57" stroke-width="4" stroke-linecap="round"/>
    <path d="M80 62C62 62 50 50 50 32c18 0 30 10 30 30z" fill="#8fcf80"><animateTransform attributeName="transform" type="rotate" values="-4 80 62;4 80 62;-4 80 62" dur="4s" repeatCount="indefinite"/></path>
    <path d="M80 54c0-18 12-30 30-30 0 18-12 30-30 30z" fill="#6b8e63"><animateTransform attributeName="transform" type="rotate" values="4 80 54;-4 80 54;4 80 54" dur="4.4s" repeatCount="indefinite"/></path>
    <circle cx="112" cy="24" r="6" fill="#e9a8b5"/>
  </svg>`;
}

export function renderSpeciesGrid(opts) {
  renderSpeciesGridInner(opts);
  refreshFilterChrome();
}

function renderSpeciesGridInner({ animate = false } = {}) {
  const container = $('speciesGrid');

  if (!S.speciesLoaded) return; // mantém o esqueleto de carregamento

  if (S.loadError) {
    container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>Não foi possível carregar</h4><p>${esc(S.loadError)}</p></div>`;
    $('speciesCountChip').textContent = '0';
    return;
  }

  if (S.species.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>${S.user && firstName(S.user) ? 'Olá, ' + esc(firstName(S.user)) + '! ' : ''}Seu jardim está vazio</h4><p>Cadastre a primeira espécie para começar a acompanhar rega, adubação e evolução.</p><button class="btn btn-primary" onclick="openAddSpeciesModal()">+ Cadastrar primeira espécie</button></div>`;
    $('speciesCountChip').textContent = '0';
    return;
  }

  const list = filteredSpecies();
  $('speciesCountChip').textContent = list.length;

  if (list.length === 0) {
    const onlyThirsty = activeFilters.size === 1 && activeFilters.has('alert:water') && !S.searchTerm;
    if (activeFilters.size && !onlyThirsty) {
      container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>Nenhuma espécie combina com esses filtros</h4><p>Tente remover algum filtro ou limpar a seleção.</p><button class="btn btn-primary" onclick="clearFilters()">Limpar filtros</button></div>`;
      return;
    }
    const msg = onlyThirsty ? 'Nenhuma planta precisa de água agora. 🎉' : 'Nenhum resultado para essa busca.';
    container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>${msg}</h4></div>`;
    return;
  }

  container.innerHTML = '';
  list.forEach((sp, i) => {
    const vs = vasesOf(sp);
    const thirsty = vs.filter(v => needsWater(v, sp)).length;

    const card = document.createElement('div');
    card.className = 'species-card' + (animate ? ' enter' : '');
    card.style.setProperty('--i', Math.min(i, 14));
    // O cartão inteiro é clicável com o mouse; para teclado e leitores de tela o botão do nome é o controle principal.
    card.onclick = () => openSpeciesDetail(sp, { fromUser: true });

    const media = sp.photo
      ? `<img ${imgSrc(sp.photo, 640)} class="species-card-cover" alt="" loading="lazy" decoding="async" />`
      : `<div class="species-card-cover-icon">${esc(sp.icon || '🪴')}</div>`;

    const badges = [];
    if (thirsty > 0) badges.push(`<span class="pill late">💧 ${plural(thirsty, 'precisa', 'precisam')} de rega</span>`);
    if (sp.petToxicity) badges.push(`<span class="pill">${petToxicityIcon(sp.petToxicity)} Pets: ${esc(sp.petToxicity)}</span>`);

    card.innerHTML = `
      <div class="species-card-media">
        ${media}
        <div class="species-card-actions">
          <button class="btn-icon" onclick="event.stopPropagation(); editSpecies('${sp.firestoreId}')" title="Editar" aria-label="Editar ${esc(sp.name)}">✏️</button>
          <button class="btn-icon danger" onclick="event.stopPropagation(); deleteSpecies('${sp.firestoreId}')" title="Excluir" aria-label="Excluir ${esc(sp.name)}">🗑</button>
        </div>
        ${badges.length ? `<div class="species-card-badges">${badges.join('')}</div>` : ''}
      </div>
      <div class="species-card-body">
        <h3><button type="button" class="card-link" onclick="event.stopPropagation(); openSpeciesById('${sp.firestoreId}')">${esc(sp.name)}</button></h3>
        <p class="sci">${esc(sp.scientific || '')}</p>
        <div class="species-card-foot">
          <span>🪴 ${plural(vs.length, 'vaso', 'vasos')}</span>
          <span class="go" aria-hidden="true">→</span>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

// ==================== DETALHE DA ESPÉCIE ====================
export function openSpeciesDetail(species, { fromUser = false } = {}) {
  const firstOpen = !S.selectedSpecies || S.selectedSpecies.firestoreId !== species.firestoreId;
  S.selectedSpecies = species;
  if (fromUser && !(history.state && history.state.v === 'detail')) history.pushState({ v: 'detail' }, '');
  showView('sec-species-detail');

  $('detailSpeciesName').textContent = species.name;
  $('breadcrumbName').textContent = species.name;
  $('detailSpeciesNameVases').textContent = species.name;
  $('detailSpeciesScientific').textContent = species.scientific || '';

  const coverEl = $('detailSpeciesCover');
  if (species.photo) {
    coverEl.className = 'cover-photo-lg';
    coverEl.innerHTML = `<img ${imgSrc(species.photo, 240)} alt="" />`;
  } else {
    coverEl.className = 'cover-icon-lg';
    coverEl.textContent = species.icon || '🪴';
  }

  const careGrid = $('detailSpeciesCareGrid');
  const careFields = [
    { icon: "🏷️", label: "Categoria", val: species.category },
    { icon: "☀️", label: "Luz / Sol", val: species.light },
    { icon: "💧", label: "Rega", val: species.water, extra: species.waterDays ? ` · a cada ${species.waterDays} dias` : '' },
    { icon: "✂️", label: "Poda", val: species.pruning, extra: species.pruningDays ? ` · a cada ${species.pruningDays} dias` : '' },
    { icon: "💦", label: "Umidade", val: species.humidity },
    { icon: "🪱", label: "Solo", val: species.soil },
    { icon: "🧪", label: "Adubação comercial", val: species.fertilizer, extra: species.fertilizerDays ? ` · a cada ${species.fertilizerDays} dias` : '' },
    { icon: "🍌", label: "Adubação natural", val: species.naturalFertilizer },
    { icon: "💡", label: "Dica extra", val: species.extraTips },
    { icon: "⚠️", label: "Observações", val: species.observations },
    {
      icon: petToxicityIcon(species.petToxicity), label: "Toxicidade pet", tox: species.petToxicity,
      val: species.petToxicity ? (species.petWarning ? `${species.petToxicity} — ${species.petWarning}` : species.petToxicity) : null
    }
  ];

  let html = '';
  careFields.forEach(f => {
    if (!f.val) return;
    html += `
      <div class="care-item ${f.tox ? 'tox-' + esc(f.tox) : ''}">
        <span class="ci-ico">${f.icon}</span>
        <div><div class="ci-label">${f.label}</div><div class="ci-val">${esc(f.val)}${esc(f.extra || '')}</div></div>
      </div>`;
  });

  if (!html && species.care) { // formato legado
    html = `<div class="care-item"><span class="ci-ico">📋</span><div class="ci-val">${esc(species.care)}</div></div>`;
  } else if (!html) {
    html = `<p class="muted">Nenhuma instrução específica cadastrada. Toque em “Editar espécie” para preencher (ou use a IA).</p>`;
  }
  careGrid.innerHTML = html;

  renderVasesForSpecies(species.firestoreId, { animate: firstOpen });
}

export function backToSpecies() {
  if (history.state && history.state.v === 'detail') history.back();
  else leaveDetailUI();
}

// ==================== ESPÉCIES: SALVAR / EDITAR / EXCLUIR ====================
export function openAddSpeciesModal() {
  $('formSpecies').reset();
  $('speciesEditId').value = '';
  $('speciesModalTitle').textContent = 'Cadastrar nova espécie';
  $('speciePhotoPreview').style.display = 'none';
  $('speciePhotoPreview').src = '';
  S.speciePhoto = null;
  openDrawer('drawerAddSpecies');
}

export function editSpecies(firestoreId) {
  const sp = S.species.find(s => s.firestoreId === firestoreId);
  if (!sp) return;

  $('speciesEditId').value = sp.firestoreId;
  $('speciesModalTitle').textContent = 'Editar espécie';

  $('specieName').value = sp.name || '';
  $('specieScientific').value = sp.scientific || '';
  $('specieIcon').value = sp.icon || '🪴';
  $('fieldCategory').value = sp.category || '';
  $('fieldLight').value = sp.light || '';
  $('fieldWater').value = sp.water || '';
  $('specieWaterDays').value = sp.waterDays || '';
  $('specieFertDays').value = sp.fertilizerDays || '';
  $('speciePruneDays').value = sp.pruningDays || '';
  $('fieldPruning').value = sp.pruning || '';
  $('fieldHumidity').value = sp.humidity || '';
  $('fieldSoil').value = sp.soil || '';
  $('fieldFertilizer').value = sp.fertilizer || '';
  $('fieldNaturalFertilizer').value = sp.naturalFertilizer || '';
  $('fieldExtraTips').value = sp.extraTips || '';
  $('fieldObservations').value = sp.observations || '';
  $('fieldPetToxicity').value = sp.petToxicity || '';
  $('fieldPetWarning').value = sp.petWarning || '';

  S.speciePhoto = null;
  const preview = $('speciePhotoPreview');
  if (sp.photo) {
    preview.src = sp.photo;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
    preview.src = '';
  }

  openDrawer('drawerAddSpecies');
}

export function editCurrentSpecies() {
  if (S.selectedSpecies) editSpecies(S.selectedSpecies.firestoreId);
}

export async function saveSpecies(event) {
  event.preventDefault();
  const btn = $('btnSaveSpecies');
  const editId = $('speciesEditId').value;

  const speciesData = {
    name: $('specieName').value.trim(),
    scientific: $('specieScientific').value.trim(),
    icon: $('specieIcon').value || '🪴',
    category: $('fieldCategory').value.trim(),
    light: $('fieldLight').value.trim(),
    water: $('fieldWater').value.trim(),
    waterDays: Number($('specieWaterDays').value) || 5,
    fertilizerDays: Number($('specieFertDays').value) || DEFAULT_FERT_DAYS,
    pruningDays: Number($('speciePruneDays').value) || DEFAULT_PRUNE_DAYS,
    pruning: $('fieldPruning').value.trim(),
    humidity: $('fieldHumidity').value.trim(),
    soil: $('fieldSoil').value.trim(),
    fertilizer: $('fieldFertilizer').value.trim(),
    naturalFertilizer: $('fieldNaturalFertilizer').value.trim(),
    extraTips: $('fieldExtraTips').value.trim(),
    observations: $('fieldObservations').value.trim(),
    petToxicity: $('fieldPetToxicity').value,
    petWarning: $('fieldPetWarning').value.trim(),
  };

  btn.disabled = true;
  const label = btn.textContent;

  try {
    if (S.speciePhoto) {
      btn.textContent = 'Enviando foto…';
      Object.assign(speciesData, await storePhoto(S.speciePhoto, ['especie']));
    }

    if (editId) {
      await patchSpecies(editId, speciesData);
    } else {
      if (!speciesData.photo) speciesData.photo = '';
      speciesData.createdAt = new Date().toISOString();
      await addSpecies(speciesData);
    }
    $('formSpecies').reset();
    $('speciePhotoPreview').style.display = 'none';
    S.speciePhoto = null;
    closeActiveDrawer();
    toast(editId ? 'Espécie atualizada 🌿' : 'Espécie cadastrada 🌱');
    if (!editId) petalRain(16);
  } catch (err) {
    toast('Erro ao salvar espécie: ' + friendlyError(err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

export async function deleteSpecies(firestoreId) {
  const sp = S.species.find(s => s.firestoreId === firestoreId);
  const vs = sp ? vasesOf(sp) : [];
  const extra = vs.length ? ` Os ${plural(vs.length, 'vaso', 'vasos')} desta espécie (com histórico e fotos) também serão excluídos.` : '';
  const ok = await askConfirm(`Excluir ${sp ? '“' + sp.name + '”' : 'esta espécie'}?${extra} Essa ação não pode ser desfeita.`, { icon: '🥀', okLabel: 'Excluir' });
  if (!ok) return;
  try {
    const undo = await deleteSpeciesCascade(sp, vs);
    if (S.selectedSpecies && S.selectedSpecies.firestoreId === firestoreId) backToSpecies();
    toast('Espécie excluída.', 'ok', { ms: 8000, action: { label: 'Desfazer', onClick: async () => {
      try { await undo(); toast('Espécie restaurada 🌱'); } catch (err) { toast('Não foi possível restaurar: ' + friendlyError(err), 'error'); }
    } } });
  } catch (err) {
    toast('Erro ao excluir espécie: ' + friendlyError(err), 'error');
  }
}

// PREENCHIMENTO AUTOMÁTICO COM IA
export async function autoFillWithAI(btn) {
  const name = $('specieName').value.trim();
  if (!name) { toast('Digite o nome da planta primeiro.', 'error'); $('specieName').focus(); return; }

  btn.disabled = true;
  btn.textContent = '✨ Consultando IA…';

  try {
    const { data } = await callWorkers(
      'auto-fill-plant',
      () => { const fd = new FormData(); fd.append('plant_name', name); return { method: 'POST', body: fd }; },
      (d) => d && (d.scientific_name || d.water_days || d.light || d.soil)
    );

    $('specieScientific').value = data.scientific_name || '';
    $('fieldCategory').value = data.category || '';
    $('fieldLight').value = data.light || '';
    $('fieldWater').value = data.water || '';
    $('specieWaterDays').value = data.water_days || 5;
    $('fieldPruning').value = data.pruning || '';
    $('fieldHumidity').value = data.humidity || '';
    $('fieldSoil').value = data.soil || '';
    $('fieldFertilizer').value = data.fertilizer || '';
    $('fieldNaturalFertilizer').value = data.natural_fertilizer || '';
    $('fieldExtraTips').value = data.extra_tips || '';
    $('fieldObservations').value = data.observations || '';

    const validLevels = ['Segura', 'Tóxica', 'Letal'];
    $('fieldPetToxicity').value = validLevels.includes(data.pet_toxicity) ? data.pet_toxicity : '';
    $('fieldPetWarning').value = data.pet_warning || '';
    toast('Ficha preenchida pela IA ✨');
  } catch (err) {
    toast('Erro ao consultar IA: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Preencher ficha com IA';
  }
}

/** Abre o detalhe de uma espécie pelo id (usado pelo botão do nome no cartão). */
export function openSpeciesById(id) {
  const sp = S.species.find(s => s.firestoreId === id);
  if (sp) openSpeciesDetail(sp, { fromUser: true });
}
