// Tela de Agenda: calendário mensal + lista do dia + próximos dias, com ações para concluir tarefas.
import { S } from './state.js';
import { $, esc, plural, startOfDay, daysBetween } from './utils.js';
import { agendaItems, dateKey } from './schedule.js';
import { ALERT_KINDS, speciesOfVase } from './care.js';
import { recordCareQuick } from './carelog.js';
import { recomputeLastFields } from './carelog.js';
import { openTreatmentForm } from './pests.js';
import { patchVase } from './repo.js';
import { toast, friendlyError } from './ui/feedback.js';

const ag = { month: startOfDay(new Date()), selected: dateKey(new Date()), items: new Map() };
ag.month.setDate(1);

const KIND = Object.fromEntries(ALERT_KINDS.map(k => [k.id, k]));
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

const longDay = (d) => cap(new Date(d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));

function gridRange() {
  const first = new Date(ag.month);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const end = new Date(start); end.setDate(start.getDate() + 41);
  return { start, end };
}

function dayLabel(item, today) {
  if (item.overdue) return `<span class="ag-tag late">atrasada ${plural(item.late, 'dia', 'dias')}</span>`;
  if (item.projected) return '<span class="ag-tag proj">prevista</span>';
  if (item.time && item.kind === 'reminder') return `<span class="ag-tag">${item.time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>`;
  return daysBetween(today, item.date) === 0 ? '<span class="ag-tag">hoje</span>' : '';
}

function itemHtml(item, today) {
  const k = KIND[item.kind];
  const vid = item.vase.firestoreId;
  let action = '';
  if (!item.projected) {
    if (k.care) action = `<button class="al-act" onclick="agendaComplete('${esc(item.id)}', this)" >${k.icon} ${k.verb}<span class="sr-only"> ${esc(item.vase.name)}</span></button>`;
    else if (item.kind === 'reminder') action = `<button class="al-act" onclick="agendaComplete('${esc(item.id)}', this)" >✓ Feito<span class="sr-only"> ${esc(item.text)}</span></button>`;
    else if (item.kind === 'pest') action = `<button class="al-act" onclick="agendaComplete('${esc(item.id)}', this)" >${k.icon} Tratar<span class="sr-only"> ${esc(item.vase.name)}</span></button>`;
  }
  return `<li class="alert-item k-${item.kind}${item.overdue ? ' late' : ''}${item.projected ? ' projected' : ''}" style="--k:${k.color}">
    <span class="al-badge" aria-hidden="true">${k.icon}</span>
    <button class="al-main" onclick="openVaseFromGallery('${vid}')">
      <b>${esc(item.text)}</b>
      <i> · ${esc(item.species.name)}</i>
      <span class="al-sub">${dayLabel(item, today)}</span>
    </button>
    ${action}
  </li>`;
}

function buildCalendar(byDay, today) {
  const { start } = gridRange();
  const title = cap(ag.month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  $('calTitle').textContent = title;
  let html = WEEKDAYS.map(w => `<div class="cal-wd" aria-hidden="true">${w}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = dateKey(d);
    const list = byDay.get(key) || [];
    const kinds = [...new Set(list.map(x => x.kind))];
    const other = d.getMonth() !== ag.month.getMonth();
    const isToday = key === dateKey(today);
    const overdue = list.some(x => x.overdue);
    const label = `${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}${isToday ? ', hoje' : ''}${list.length ? ', ' + plural(list.length, 'tarefa', 'tarefas') : ', sem tarefas'}`;
    html += `<button class="cal-day${other ? ' other' : ''}${isToday ? ' today' : ''}${key === ag.selected ? ' selected' : ''}${list.length ? ' has' : ''}${overdue ? ' overdue' : ''}"
      data-key="${key}" onclick="agendaSelect('${key}')" aria-pressed="${key === ag.selected}" aria-label="${esc(label)}">
      <span class="cal-num">${d.getDate()}</span>
      <span class="cal-dots" aria-hidden="true">${kinds.slice(0, 4).map(kd => `<i style="--k:${KIND[kd].color}"></i>`).join('')}</span>
      ${list.length > 1 ? `<span class="cal-count" aria-hidden="true">${list.length}</span>` : ''}
    </button>`;
  }
  $('calGrid').innerHTML = html;
}

export function renderAgenda() {
  if (!$('sec-agenda') || !S.vasesLoaded) return;
  const today = startOfDay(new Date());
  const { start, end } = gridRange();
  const upcomingEnd = new Date(today); upcomingEnd.setDate(today.getDate() + 7);
  const items = agendaItems(S.vases, speciesOfVase, start < today ? start : today, end > upcomingEnd ? end : upcomingEnd);
  ag.items = new Map(items.map(i => [i.id, i]));

  const byDay = new Map();
  items.filter(i => i.date >= start && i.date <= end).forEach(i => {
    const k = dateKey(i.date);
    byDay.set(k, [...(byDay.get(k) || []), i]);
  });
  buildCalendar(byDay, today);

  // Dia selecionado
  const dayItems = byDay.get(ag.selected) || [];
  const selDate = new Date(ag.selected + 'T12:00:00');
  $('agendaDayTitle').textContent = ag.selected === dateKey(today) ? `Hoje · ${longDay(selDate)}` : longDay(selDate);
  $('agendaDayCount').textContent = dayItems.length ? plural(dayItems.length, 'tarefa', 'tarefas') : '';
  $('agendaDayList').innerHTML = dayItems.length
    ? dayItems.map(i => itemHtml(i, today)).join('')
    : `<li class="ag-empty">🌿 Nada marcado para este dia.<br><button class="btn btn-secondary" onclick="openReminderForm('${ag.selected}')">+ Criar lembrete</button></li>`;

  // Próximos 7 dias (sem repetir o dia selecionado vazio)
  const groups = new Map();
  items.filter(i => !i.projected && i.date > today && i.date <= upcomingEnd).forEach(i => {
    const k = dateKey(i.date);
    groups.set(k, [...(groups.get(k) || []), i]);
  });
  $('agendaUpcoming').innerHTML = groups.size
    ? [...groups.entries()].map(([k, list]) => `<li class="ag-group"><button class="ag-group-head" onclick="agendaSelect('${k}')">${longDay(new Date(k + 'T12:00:00'))} <span class="count">${list.length}</span></button></li>`).join('')
    : '<li class="muted ag-empty">Sem tarefas nos próximos 7 dias.</li>';

  const overdueCount = items.filter(i => i.overdue).length;
  $('agendaSummary').textContent = overdueCount ? plural(overdueCount, 'tarefa atrasada', 'tarefas atrasadas') : 'Tudo em dia 🌱';
}

export function agendaSelect(key) { ag.selected = key; renderAgenda(); }

export function agendaMonth(delta) {
  ag.month = new Date(ag.month.getFullYear(), ag.month.getMonth() + delta, 1);
  renderAgenda();
}

export function agendaToday() {
  const t = startOfDay(new Date());
  ag.month = new Date(t.getFullYear(), t.getMonth(), 1);
  ag.selected = dateKey(t);
  renderAgenda();
}

export function refreshAgendaIfVisible() {
  const sec = $('sec-agenda');
  if (sec && sec.classList.contains('is-active')) renderAgenda();
}

/** Conclui uma tarefa da agenda (rega/adubo/poda, lembrete ou tratamento). */
export async function agendaComplete(id, btn) {
  const item = ag.items.get(id);
  if (!item) return;
  const vid = item.vase.firestoreId;
  const care = KIND[item.kind].care;
  if (care) { await recordCareQuick(vid, care, btn); return; }
  if (item.kind === 'pest') { openTreatmentForm(vid, item.pestId); return; }
  if (item.kind === 'reminder') {
    const vase = S.vases.find(v => v.firestoreId === vid);
    const history = [...((vase && vase.history) || [])];
    const entry = history[item.entryIndex];
    if (!entry) return;
    const careField = ['lastWater', 'lastFertilizer', 'lastPruning', 'lastRepot'].includes(entry.type) ? entry.type : null;
    try {
      if (careField) { await recordCareQuick(vid, careField, btn); return; }
      history[item.entryIndex] = { type: 'nota', date: new Date().toISOString(), notes: '✔ ' + (entry.notes || 'Lembrete concluído') };
      await patchVase(vid, { history, ...recomputeLastFields(history) });
      toast('Lembrete concluído ✅');
    } catch (err) { toast('Erro ao concluir: ' + friendlyError(err), 'error'); }
  }
}
