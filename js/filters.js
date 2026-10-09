import { $, daysBetween, esc, normText, plural, prefersReducedMotion, rand } from './utils.js';
import { S, activeFilters } from './state.js';
import { renderSpeciesGrid } from './species.js';
import { ALERT_KINDS, needsWater, vaseAlerts, vasesOf } from './care.js';
import { vasePhotos } from './photos.js';
import { spawnFx } from './ui/fx.js';
import { renderAlertsPanel } from './dashboard.js';
import { closeActiveDrawer, openDrawer } from './ui/drawers.js';

// ==================== BUSCA / FILTROS ====================
export function applySpeciesSearch() {
  const input = $('searchInput');
  S.searchTerm = input.value.trim().toLowerCase();
  $('searchWrap').classList.toggle('has-text', !!input.value);
  renderSpeciesGrid();
}

export function clearSearch() {
  $('searchInput').value = '';
  applySpeciesSearch();
  $('searchInput').focus();
}

function speciesMatchesSearch(sp) {
  if (!S.searchTerm) return true;
  const haystack = [
    sp.name, sp.scientific, sp.category, sp.light, sp.water, sp.pruning,
    sp.soil, sp.fertilizer, sp.naturalFertilizer,
    ...vasesOf(sp).map(v => v.name)
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(S.searchTerm);
}

function speciesMatchesFilter(sp, groups) {
  if (!activeFilters.size) return true;
  const vs = vasesOf(sp);
  return groups.every(g => {
    const selected = g.opts.filter(o => activeFilters.has(`${g.id}:${o.id}`));
    return !selected.length || selected.some(o => o.test(sp, vs)); // OU dentro do grupo
  });
}

export function filteredSpecies() {
  const groups = activeFilters.size ? getFilterGroups(false) : null;
  return S.species.filter(sp => speciesMatchesSearch(sp) && speciesMatchesFilter(sp, groups));
}

// ---------- Painel de filtros (menu sanduíche) ----------
function lightTags(sp) {
  const t = normText(sp.light);
  const tags = [];
  if (!t) return tags;
  if (/sol pleno|pleno sol|sol direto|muito sol|pleno-sol/.test(t)) tags.push('sun');
  if (/meia[ -]?sombra|sol da manha|sol parcial/.test(t)) tags.push('half');
  if (/indireta|difusa|filtrada|claridade/.test(t)) tags.push('indirect');
  if (/pouca luz|baixa luz|pouca claridade/.test(t) || (/sombra/.test(t) && !/meia[ -]?sombra/.test(t))) tags.push('shade');
  return tags;
}

function wateredToday(v) { return !!v.lastWater && daysBetween(new Date(v.lastWater), new Date()) === 0; }

function getFilterGroups(withCounts = true) {
  const groups = [
    { id: 'alert', icon: '🔔', title: 'Alertas', hint: 'tarefas pendentes', opts: ALERT_KINDS.map(k => ({
      id: k.id, icon: k.filterIcon, label: k.id === 'water' ? 'Precisam de rega' : k.id === 'fertilizer' ? 'Precisam de adubo' : k.id === 'pruning' ? 'Precisam de poda' : k.id === 'pest' ? 'Com pragas ativas' : 'Com lembretes',
      test: (sp, vs) => vs.some(v => vaseAlerts(v, sp).some(a => a.kind === k.id))
    })) },
    { id: 'water', icon: '💧', title: 'Rega', hint: 'de qualquer vaso', opts: [
      { id: 'today', icon: '💦', label: 'Regadas hoje', test: (sp, vs) => vs.some(wateredToday) },
      { id: 'ok', icon: '✅', label: 'Em dia', test: (sp, vs) => vs.length > 0 && vs.every(v => v.lastWater && !needsWater(v, sp)) },
      { id: 'never', icon: '❓', label: 'Sem rega registrada', test: (sp, vs) => vs.some(v => !v.lastWater) }
    ] },
    { id: 'pet', icon: '🐾', title: 'Segurança para pets', opts: [
      { id: 'Segura', icon: '🟢', label: 'Segura', test: sp => sp.petToxicity === 'Segura' },
      { id: 'Tóxica', icon: '🟠', label: 'Tóxica', test: sp => sp.petToxicity === 'Tóxica' },
      { id: 'Letal', icon: '🔴', label: 'Letal', test: sp => sp.petToxicity === 'Letal' },
      { id: 'none', icon: '⚪', label: 'Não informado', test: sp => !sp.petToxicity }
    ] },
    { id: 'light', icon: '☀️', title: 'Luz', hint: 'conforme a ficha', opts: [
      { id: 'sun', icon: '☀️', label: 'Sol pleno', test: sp => lightTags(sp).includes('sun') },
      { id: 'half', icon: '⛅', label: 'Meia-sombra', test: sp => lightTags(sp).includes('half') },
      { id: 'indirect', icon: '🪟', label: 'Luz indireta', test: sp => lightTags(sp).includes('indirect') },
      { id: 'shade', icon: '🌑', label: 'Sombra', test: sp => lightTags(sp).includes('shade') }
    ] },
    { id: 'cycle', icon: '🗓️', title: 'Ritmo de rega', opts: [
      { id: 'frequent', icon: '⏱️', label: 'Frequente (até 3 dias)', test: sp => (Number(sp.waterDays) || 5) <= 3 },
      { id: 'moderate', icon: '🔁', label: 'Moderado (4 a 7 dias)', test: sp => { const n = Number(sp.waterDays) || 5; return n >= 4 && n <= 7; } },
      { id: 'spaced', icon: '🌵', label: 'Espaçado (8+ dias)', test: sp => (Number(sp.waterDays) || 5) >= 8 }
    ] }
  ];

  // Categorias: criadas a partir das espécies cadastradas
  const cats = new Map();
  S.species.forEach(sp => {
    const label = String(sp.category || '').trim();
    if (label && !cats.has(normText(label))) cats.set(normText(label), label);
  });
  if (cats.size) {
    groups.push({ id: 'cat', icon: '🏷️', title: 'Categoria', opts: [...cats.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([id, label]) => ({ id, icon: '🌿', label, test: sp => normText(sp.category) === id })) });
  }

  groups.push({ id: 'stock', icon: '🪴', title: 'Vasos e fotos', opts: [
    { id: 'withVases', icon: '🪴', label: 'Com vasos', test: (sp, vs) => vs.length > 0 },
    { id: 'noVases', icon: '🕳️', label: 'Sem vasos', test: (sp, vs) => vs.length === 0 },
    { id: 'withPhotos', icon: '📸', label: 'Com fotos', test: (sp, vs) => !!sp.photo || vs.some(v => vasePhotos(v).length) },
    { id: 'noPhotos', icon: '🌫️', label: 'Sem fotos', test: (sp, vs) => !sp.photo && !vs.some(v => vasePhotos(v).length) }
  ] });

  if (withCounts) {
    const pairs = S.species.map(sp => [sp, vasesOf(sp)]);
    groups.forEach(g => g.opts.forEach(o => { o.count = pairs.filter(([sp, vs]) => o.test(sp, vs)).length; }));
  }
  return groups;
}

function filterLabel(key) {
  for (const g of getFilterGroups(false)) {
    const o = g.opts.find(x => `${g.id}:${x.id}` === key);
    if (o) return `${o.icon} ${o.label}`;
  }
  return null;
}

export function chipBloom(el) {
  if (prefersReducedMotion) return;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI * 2 * i) / 6 + rand(-.3, .3), dist = rand(28, 52);
    spawnFx('petalfx', '', cx, cy, Math.cos(ang) * dist, Math.sin(ang) * dist, rand(.6, .95), rand(-90, 90));
  }
}

export function setBurgerOpen(open) {
  const b = $('filterBtn');
  if (!b) return;
  b.classList.toggle('open', open);
  b.setAttribute('aria-expanded', String(open));
}

function updateFilterPanelState() {
  document.querySelectorAll('#filterGroups .f-opt').forEach(b => {
    const on = activeFilters.has(b.dataset.key);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('#filterGroups .f-group').forEach(g => g.classList.toggle('has-sel', !!g.querySelector('.f-opt.on')));

  const n = filteredSpecies().length, total = S.species.length;
  const live = $('fLive');
  const msg = activeFilters.size
    ? `Mostrando <b class="bump">${n}</b> de ${total} ${total === 1 ? 'espécie' : 'espécies'}`
    : `${total} ${total === 1 ? 'espécie' : 'espécies'} · nenhum filtro ativo`;
  if (live.innerHTML !== msg) {
    live.innerHTML = msg;
  }
  $('fApply').textContent = n === 0 ? 'Nenhuma espécie' : `Ver ${plural(n, 'espécie', 'espécies')}`;
  $('fClear').disabled = !activeFilters.size;
}

function renderFilterPanel({ animate = true } = {}) {
  const box = $('filterGroups');
  const groups = getFilterGroups();
  box.classList.toggle('static', !animate);
  box.innerHTML = groups.map((g, gi) => `
    <section class="f-group" data-g="${g.id}" style="--g:${gi}">
      <div class="f-group-head">
        <h4 class="f-group-title"><span class="f-gico">${g.icon}</span>${esc(g.title)}${g.hint ? ` <small>${esc(g.hint)}</small>` : ''}</h4>
        <button class="f-clear-group" onclick="clearFilterGroup('${g.id}')">Limpar</button>
      </div>
      <div class="f-opts">
        ${g.opts.map(o => `<button class="f-opt${o.count === 0 ? ' zero' : ''}" data-key="${esc(g.id + ':' + o.id)}" aria-pressed="false" onclick="toggleFilter(this.dataset.key, this)"><span class="f-ico">${o.icon}</span><span class="f-txt">${esc(o.label)}</span><span class="f-n">${o.count}</span></button>`).join('')}
      </div>
    </section>`).join('');
  updateFilterPanelState();
}

function renderActiveStrip() {
  const el = $('activeFilters');
  if (!el) return;
  const keys = [...activeFilters];
  el.hidden = keys.length === 0;
  if (!keys.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="af-label">Filtrando por</span>` +
    keys.map(k => `<span class="af-chip">${esc(filterLabel(k) || k)}<button onclick="removeFilter(this.dataset.key)" data-key="${esc(k)}" aria-label="Remover filtro ${esc(filterLabel(k) || '')}">×</button></span>`).join('') +
    `<button class="af-clear" onclick="clearFilters()">Limpar tudo</button>`;
}

// Atualiza tudo o que depende dos filtros (botão, faixa, chips rápidos, painel)
export function refreshFilterChrome() {
  if (S.speciesLoaded) {
    const valid = new Set(getFilterGroups(false).flatMap(g => g.opts.map(o => `${g.id}:${o.id}`)));
    [...activeFilters].forEach(k => { if (!valid.has(k)) activeFilters.delete(k); });
  }
  const n = activeFilters.size;
  const btn = $('filterBtn');
  if (btn) {
    btn.classList.toggle('has-filters', n > 0);
    $('filterBadge').textContent = n;
    btn.setAttribute('aria-label', n ? `Filtros (${n} ativos)` : 'Filtros');
  }
  document.querySelectorAll('.chip[data-filter]').forEach(c => {
    const f = c.dataset.filter;
    const on = f === 'all' ? n === 0 : f === 'thirsty' ? activeFilters.has('alert:water') : activeFilters.has('pet:Segura');
    c.classList.toggle('active', on);
  });
  renderActiveStrip();
  const bell = $('statNeedCard');
  if (bell) {
    const on = activeFilters.has('alert:water');
    bell.classList.toggle('filtering', on);
    bell.setAttribute('aria-pressed', String(on));
    $('statNeedHint').textContent = on ? 'filtrando · toque para limpar' : 'toque para ver as plantas';
  }
  if (S.speciesLoaded) renderAlertsPanel();
  if (S.activeDrawerId === 'drawerFilters') renderFilterPanel({ animate: false });
}

export function applyFilters() { renderSpeciesGrid({ animate: true }); }

export function toggleFilter(key, el) {
  const turningOn = !activeFilters.has(key);
  if (turningOn) activeFilters.add(key); else activeFilters.delete(key);
  if (el) { updateFilterPanelState(); if (turningOn) chipBloom(el); }
  applyFilters();
}

export function removeFilter(key) { activeFilters.delete(key); applyFilters(); }

export function clearFilterGroup(groupId) {
  [...activeFilters].forEach(k => { if (k.startsWith(groupId + ':')) activeFilters.delete(k); });
  applyFilters();
}

export function clearFilters() { activeFilters.clear(); applyFilters(); }

// Atalhos rápidos (chips ao lado da busca) — mexem nos mesmos filtros do painel
export function setFilter(mode) {
  if (mode === 'all') activeFilters.clear();
  else {
    const key = mode === 'thirsty' ? 'alert:water' : 'pet:Segura';
    if (activeFilters.has(key)) activeFilters.delete(key); else activeFilters.add(key);
  }
  applyFilters();
}

export function toggleFilterPanel() {
  if (S.activeDrawerId === 'drawerFilters') { closeActiveDrawer(); return; }
  renderFilterPanel({ animate: true });
  openDrawer('drawerFilters');
}
