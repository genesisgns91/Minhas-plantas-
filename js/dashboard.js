import { $, DAY_MS, daysBetween, esc, plural, prefersReducedMotion } from './utils.js';
import { S, activeFilters } from './state.js';
import { ALERT_KINDS, collectAlerts } from './care.js';
import { applyFilters, chipBloom, filteredSpecies, toggleFilter } from './filters.js';
import { toast } from './ui/feedback.js';
import { firstName } from './auth.js';

// ---------- Dicas ----------
const TIPS = [
  'Regue pela manhã cedo ou no fim da tarde: a água evapora menos e as raízes aproveitam melhor.',
  'Antes de regar, enfie o dedo 2 cm no substrato. Se ainda estiver úmido, espere mais um dia.',
  'Folhas amareladas e moles costumam indicar excesso de água; folhas secas nas pontas, falta de umidade no ar.',
  'Gire o vaso um quarto de volta toda semana para a planta crescer por igual em direção à luz.',
  'Limpe as folhas com um pano úmido: elas respiram melhor e fazem mais fotossíntese.',
  'Todo vaso precisa de furos de drenagem. Raízes encharcadas apodrecem rápido.',
  'Registre fotos do mesmo ângulo todo mês: a galeria de evolução fica ainda mais bonita.',
  'Troque o vaso quando as raízes aparecerem pelos furos de drenagem — o ideal é só um tamanho maior.',
  'Água da chuva ou filtrada, em temperatura ambiente, evita choque térmico nas raízes.',
  'Podar pontas secas estimula novos brotos e deixa a planta mais cheia.',
  'Adubo demais queima raízes. Na dúvida, use metade da dose recomendada.',
  'Plantas perto de ar-condicionado ou ventilador perdem umidade mais rápido. Observe-as com mais frequência.'
];

function dayOfYear() { const n = new Date(); return Math.floor((n - new Date(n.getFullYear(), 0, 0)) / DAY_MS); }

function renderTips() {
  const i = dayOfYear();
  $('dailyTip').textContent = TIPS[i % TIPS.length];
  $('dailyTipMain').textContent = TIPS[(i + 5) % TIPS.length];
}

renderTips();

export function updateDashboard() {
  const now = new Date();
  $('statSpeciesCount').textContent = S.species.length;
  $('statPotsCount').textContent = S.vases.length;

  const wateredTodayPots = new Set();
  S.vases.forEach(vase => {
    (vase.history || []).forEach(h => {
      const d = new Date(h.date);
      if (!isNaN(d) && h.type === 'lastWater' && daysBetween(d, now) === 0 && d <= now) wateredTodayPots.add(vase.firestoreId);
    });
  });

  const need = collectAlerts().filter(a => a.kind === 'water').length;
  $('statWateredToday').textContent = wateredTodayPots.size;
  $('statNeedWater').textContent = need;
  $('statNeedCard').classList.toggle('has-alert', need > 0);

  // Hero
  const hour = now.getHours();
  const greet = hour < 5 ? 'Boa madrugada' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const who = firstName(S.user);
  $('heroGreeting').textContent = who ? `${greet}, ${who}! 🌿` : `${greet}! 🌿`;
  $('heroDate').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('heroSub').textContent = !S.speciesLoaded ? 'Carregando seu jardim…'
    : S.vases.length === 0 ? (S.species.length ? 'Agora adicione os vasos de cada espécie para acompanhar rega, adubo e fotos.' : 'Bem-vindo(a)! Cadastre sua primeira espécie e comece a acompanhar o seu jardim.')
    : need > 0 ? `${plural(need, 'vaso precisa', 'vasos precisam')} de água hoje. 💧`
    : 'Tudo em dia — suas plantas agradecem! 💚';

  renderAlertsPanel();
}

// ---------- Bloco de alertas: abas que filtram as plantas + lista de tarefas ----------
export function renderAlertsPanel() {
  const tabs = $('alertTabs');
  const list = $('remindersList');
  if (!tabs || !list) return;

  const alerts = collectAlerts();
  const byKind = {};
  ALERT_KINDS.forEach(k => { byKind[k.id] = alerts.filter(a => a.kind === k.id); });
  const selected = ALERT_KINDS.filter(k => activeFilters.has(`alert:${k.id}`));

  tabs.innerHTML = ALERT_KINDS.map(k => {
    const n = byKind[k.id].length;
    const on = activeFilters.has(`alert:${k.id}`);
    return `<button class="al-tab${on ? ' on' : ''}${n === 0 ? ' zero' : ''}" data-kind="${k.id}" aria-pressed="${on}" onclick="toggleAlertFilter('${k.id}', this)"><span class="al-ico">${k.icon}</span><span>${k.short}</span><span class="n">${n}</span></button>`;
  }).join('');

  $('alertsClear').hidden = selected.length === 0;

  const total = alerts.length;
  const totalEl = $('alertsTotal');
  totalEl.textContent = (total ? plural(total, 'alerta', 'alertas') : 'Tudo em dia ✓') + (selected.length ? ' · filtrando' : '');
  totalEl.classList.toggle('zero', total === 0);

  const shown = selected.length ? selected : ALERT_KINDS;
  const limit = selected.length ? 6 : 3;
  const rows = [];
  let hidden = 0;
  shown.forEach(k => {
    const items = byKind[k.id];
    items.slice(0, limit).forEach(a => rows.push(a));
    hidden += Math.max(0, items.length - limit);
  });

  if (!alerts.length) {
    list.innerHTML = '<p class="muted al-empty">🌱 Tudo em dia! Nenhum alerta de rega, adubo, poda ou lembrete.</p>';
  } else if (!rows.length) {
    list.innerHTML = '<p class="muted al-empty">Nenhum alerta nesta categoria agora. 🎉</p>';
  } else {
    list.innerHTML = rows.map(a => {
      const k = ALERT_KINDS.find(x => x.id === a.kind);
      const act = k.care
        ? `<button class="al-act" onclick="recordCareQuick('${a.vase.firestoreId}', '${k.care}', this)" >${k.icon} ${k.verb}<span class="sr-only"> ${esc(a.vase.name)}</span></button>`
        : a.kind === 'pest'
          ? `<button class="al-act" onclick="openTreatmentForm('${a.vase.firestoreId}', '${a.pestId}')" >${k.icon} ${k.verb}<span class="sr-only"> ${esc(a.vase.name)}</span></button>`
          : '';
      return `<div class="alert-item k-${a.kind}${a.late ? ' late' : ''}" style="--k:${k.color}">
        <span class="al-badge" aria-hidden="true">${k.icon}</span>
        <button class="al-main" onclick="openVaseFromGallery('${a.vase.firestoreId}')">
          <b>${esc(a.vase.name)}</b><i> · ${esc(a.species.name)}</i>
          <span class="al-text">${esc(a.text)}</span>
          <span class="al-sub">${esc(a.sub)}</span>
        </button>
        ${act}
      </div>`;
    }).join('') + (hidden ? `<p class="muted al-more">+ ${plural(hidden, 'alerta', 'alertas')} — toque numa aba para ver todos</p>` : '');
  }

  // Atalho para ver as plantas filtradas
  const goto = $('alertsGoto');
  if (selected.length) {
    const n = filteredSpecies().length;
    goto.hidden = false;
    goto.textContent = n === 0 ? 'Nenhuma planta com esse alerta' : `↓ Ver ${plural(n, 'planta filtrada', 'plantas filtradas')}`;
  } else {
    goto.hidden = true;
  }
}

// ---------- Expandir / recolher o bloco de alertas ----------
const ALERTS_COLLAPSED_KEY = 'minhasplantas_alerts_collapsed';

try { S.alertsCollapsed = localStorage.getItem(ALERTS_COLLAPSED_KEY) === '1'; } catch (e) { /* ignora */ }

export function applyAlertsCollapsed() {
  const panel = $('alertsPanel');
  if (!panel) return;
  panel.classList.toggle('collapsed', S.alertsCollapsed);
  $('alertsToggle').setAttribute('aria-expanded', String(!S.alertsCollapsed));
  const body = $('alertsBody');
  body.setAttribute('aria-hidden', String(S.alertsCollapsed));
  body.inert = S.alertsCollapsed; // tira os botões escondidos da navegação por teclado
}

export function toggleAlertsPanel() {
  S.alertsCollapsed = !S.alertsCollapsed;
  try { localStorage.setItem(ALERTS_COLLAPSED_KEY, S.alertsCollapsed ? '1' : '0'); } catch (e) { /* ignora */ }
  applyAlertsCollapsed();
}

export function scrollToSpeciesGrid() {
  const el = document.querySelector('#sec-species .toolbar');
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
}

export function toggleAlertFilter(kind, el) {
  const key = `alert:${kind}`;
  const k = ALERT_KINDS.find(x => x.id === kind);
  const count = collectAlerts().filter(a => a.kind === kind).length;
  if (!activeFilters.has(key) && count === 0) {
    toast(`Nenhum alerta de ${k.short.toLowerCase()} agora. 🎉`);
    return;
  }
  const turningOn = !activeFilters.has(key);
  toggleFilter(key, null);
  if (turningOn && el) { const fresh = document.querySelector(`.al-tab[onclick*="'${kind}'"]`); chipBloom(fresh || el); }
}

export function clearAlertFilters() {
  [...activeFilters].forEach(k => { if (k.startsWith('alert:')) activeFilters.delete(k); });
  applyFilters();
}

// O sino "Precisam de rega" funciona como atalho do filtro de rega
export function filterNeedWater() {
  const key = 'alert:water';
  if (activeFilters.has(key)) { activeFilters.delete(key); applyFilters(); return; }
  const items = collectAlerts().filter(a => a.kind === 'water');
  if (!items.length) { toast('Nenhuma planta precisa de água agora. 🎉'); return; }
  activeFilters.add(key);
  applyFilters();
  const spCount = new Set(items.map(a => a.species.firestoreId)).size;
  toast(`💧 ${plural(items.length, 'vaso', 'vasos')} em ${plural(spCount, 'espécie', 'espécies')} precisam de rega`);
  scrollToSpeciesGrid();
}
