// Cálculo da agenda: próximas tarefas (rega, adubo, poda, pragas e lembretes) por data. Funções puras.
import { DAY_MS, daysBetween, startOfDay } from './utils.js';
import { DEFAULT_FERT_DAYS, DEFAULT_PRUNE_DAYS, activePests, pestNextDate } from './care.js';

const addDays = (date, n) => { const d = startOfDay(date); d.setDate(d.getDate() + n); return d; };
const HORIZON_DAYS = 400;
const TYPE_LABELS = { lastWater: 'Rega agendada', lastFertilizer: 'Adubação agendada', lastPruning: 'Poda agendada', lastRepot: 'Transplante agendado', nota: 'Nota agendada' };

export const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const CYCLES = [
  { kind: 'water', field: 'lastWater', days: (sp) => Math.max(1, Number(sp && sp.waterDays) || 5), verb: 'Regar' },
  { kind: 'fertilizer', field: 'lastFertilizer', days: (sp) => Math.max(1, Number(sp && sp.fertilizerDays) || DEFAULT_FERT_DAYS), verb: 'Adubar' },
  { kind: 'pruning', field: 'lastPruning', days: (sp) => Math.max(1, Number(sp && sp.pruningDays) || DEFAULT_PRUNE_DAYS), verb: 'Podar' }
];

/**
 * Tarefas de todos os vasos entre `from` e `to` (inclusive).
 * - Cuidados periódicos: a próxima data = último registro + ciclo da espécie; as seguintes são "previstas".
 * - Tarefas atrasadas aparecem no dia de hoje, marcadas como `overdue`.
 * Sem registro anterior não há como prever, então o vaso não gera tarefa de rega/adubo/poda.
 */
export function agendaItems(vases, speciesOf, from, to, now = new Date()) {
  const today = startOfDay(now);
  const a = startOfDay(from), b = startOfDay(to);
  const items = [];
  const push = (it) => { const t = it.date.getTime(); if (t >= a.getTime() && t <= b.getTime()) items.push(it); };

  for (const vase of vases) {
    const species = speciesOf(vase);
    if (!species) continue;

    for (const c of CYCLES) {
      if (!vase[c.field]) continue;
      const last = new Date(vase[c.field]);
      if (isNaN(last)) continue;
      const cycle = c.days(species);
      const first = addDays(last, cycle);
      const overdue = first < today;
      const base = overdue ? today : first;
      push({ id: `${c.kind}:${vase.firestoreId}:${dateKey(base)}`, kind: c.kind, date: base, overdue, projected: false, vase, species,
        late: overdue ? daysBetween(first, today) : 0, text: `${c.verb} ${vase.name}` });
      // repetições previstas (a cada `cycle` dias) dentro do período pedido
      const horizon = addDays(today, HORIZON_DAYS);
      const stop = b < horizon ? b : horizon;
      if (stop > base) {
        const k0 = Math.max(1, Math.ceil((a - base) / (cycle * DAY_MS)));
        for (let k = k0; ; k++) {
          const d = addDays(base, k * cycle);
          if (d > stop) break;
          push({ id: `${c.kind}:${vase.firestoreId}:${dateKey(d)}`, kind: c.kind, date: d, overdue: false, projected: true, vase, species, late: 0, text: `${c.verb} ${vase.name}` });
        }
      }
    }

    // lembretes (e registros agendados no futuro): no dia combinado; lembretes que passaram há até 7 dias aparecem hoje, atrasados
    (vase.history || []).forEach((h, index) => {
      const d = new Date(h.date);
      if (isNaN(d)) return;
      const day = startOfDay(d);
      const text = h.notes || TYPE_LABELS[h.type] || 'Lembrete';
      const base = { id: `reminder:${vase.firestoreId}:${index}`, kind: 'reminder', projected: false, vase, species, entryIndex: index, text, time: d };
      if (day >= today) push({ ...base, date: day, overdue: false, late: 0 });
      else if (h.type === 'lembrete' && daysBetween(day, today) <= 7) push({ ...base, date: today, overdue: true, late: daysBetween(day, today) });
    });

    // tratamentos de pragas: reaplicação combinada
    activePests(vase).forEach(p => {
      const next = pestNextDate(p);
      if (!next) return;
      const day = startOfDay(next);
      const overdue = day < today;
      push({ id: `pest:${vase.firestoreId}:${p.id}`, kind: 'pest', date: overdue ? today : day, overdue, projected: false, vase, species,
        late: overdue ? daysBetween(day, today) : 0, pestId: p.id, text: `Reaplicar tratamento · ${p.name}` });
    });
  }
  return items.sort((x, y) => x.date - y.date || (y.overdue - x.overdue) || x.kind.localeCompare(y.kind) || x.vase.name.localeCompare(y.vase.name, 'pt-BR'));
}

/** Resumo enviado ao Worker de notificações: só datas (nada de fotos ou textos longos). */
export function pushSummary(vases, speciesOf, now = new Date()) {
  const horizon = addDays(now, 30);
  return agendaItems(vases, speciesOf, startOfDay(now), horizon, now)
    .filter(i => !i.projected)
    .map(i => ({ k: i.kind, n: i.vase.name, t: i.date.getTime() + (i.time ? (i.time.getHours() * 60 + i.time.getMinutes()) * 60000 : 0) }));
}
