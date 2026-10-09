import { S } from './state.js';
import { DAY_MS, daysBetween, plural } from './utils.js';

export function vasesOf(sp) { return S.vases.filter(v => v.speciesId === sp.firestoreId); }

export function petToxicityIcon(level) {
  if (level === 'Letal') return '🔴';
  if (level === 'Tóxica') return '🟠';
  if (level === 'Segura') return '🟢';
  return '🐾';
}

// ==================== STATUS DE REGA ====================
export function waterStatus(vase, species) {
  const due = Math.max(1, Number(species && species.waterDays) || 5);
  if (!vase.lastWater) {
    return { state: 'never', pct: 0, title: 'Sem rega registrada', sub: 'Toque em Regar para começar', icon: '💧' };
  }
  const d = new Date(vase.lastWater);
  const days = Math.max(0, daysBetween(d, new Date()));
  const pct = Math.min(100, Math.round((days / due) * 100));
  if (days === 0) return { state: 'fresh', pct, title: 'Regada hoje', sub: `próxima em ${plural(due, 'dia', 'dias')}`, icon: '💦' };
  if (days < due) {
    const left = due - days;
    return { state: left === 1 ? 'soon' : 'ok', pct, title: `Regada há ${plural(days, 'dia', 'dias')}`, sub: left === 1 ? 'regar amanhã' : `próxima em ${left} dias`, icon: '💧' };
  }
  if (days === due) return { state: 'due', pct: 100, title: 'Hora de regar!', sub: `ciclo de ${plural(due, 'dia', 'dias')} completo`, icon: '🚿' };
  return { state: 'late', pct: 100, title: `Atrasada ${plural(days - due, 'dia', 'dias')}`, sub: `última rega há ${days} dias`, icon: '⚠️' };
}

export function needsWater(vase, species) {
  const s = waterStatus(vase, species).state;
  return s === 'due' || s === 'late';
}

export function speciesOfVase(vase) { return S.species.find(s => s.firestoreId === vase.speciesId); }

// ==================== DASHBOARD ====================
function relativeWhen(d) {
  const now = new Date();
  const diff = daysBetween(now, d);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `hoje ${time}`;
  if (diff === 1) return `amanhã ${time}`;
  if (diff === -1) return `ontem ${time}`;
  if (diff > 1 && diff < 7) return `em ${diff} dias`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + time;
}

// ---------- Alertas de cuidado (rega, adubo, poda, lembretes) ----------
export const ALERT_KINDS = [
  { id: 'water',      icon: '💧', short: 'Rega',      filterIcon: '🚿', color: '#4f9bbd', care: 'lastWater',      verb: 'Regar' },
  { id: 'fertilizer', icon: '🧪', short: 'Adubo',     filterIcon: '🧪', color: '#b38b4d', care: 'lastFertilizer', verb: 'Adubar' },
  { id: 'pruning',    icon: '✂️', short: 'Poda',      filterIcon: '✂️', color: '#5f8b57', care: 'lastPruning',    verb: 'Podar' },
  { id: 'pest',       icon: '🐛', short: 'Pragas',    filterIcon: '🐛', color: '#8e5ea2', care: null,             verb: 'Tratar' },
  { id: 'reminder',   icon: '⏰', short: 'Lembretes', filterIcon: '⏰', color: '#c16e41', care: null,             verb: '' }
];

// ---------- Pragas e tratamentos ----------
export const SEVERITIES = {
  leve:     { label: 'Leve',     weight: 1 },
  moderada: { label: 'Moderada', weight: 2 },
  grave:    { label: 'Grave',    weight: 3 }
};

export const activePests = (vase) => (vase.pests || []).filter(p => p && p.status !== 'resolved');

/** Data da próxima reaplicação combinada no tratamento mais recente que tenha uma (ou null). */
export function pestNextDate(pest) {
  const withNext = (pest.treatments || []).filter(t => t.nextDate).sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!withNext.length) return null;
  const d = new Date(withNext[0].nextDate);
  return isNaN(d) ? null : d;
}

export const DEFAULT_FERT_DAYS = 30;

export const DEFAULT_PRUNE_DAYS = 90;

// Alertas de UM vaso. Adubo e poda só alertam quando já existe um registro anterior vencido
// (sem nenhum registro não há como saber se está atrasado).
export function vaseAlerts(vase, species) {
  const now = new Date();
  const out = [];

  const ws = waterStatus(vase, species);
  if (ws.state === 'due' || ws.state === 'late') {
    const due = Math.max(1, Number(species && species.waterDays) || 5);
    const over = daysBetween(new Date(vase.lastWater), now) - due;
    out.push({ kind: 'water', vase, species, text: ws.title, sub: ws.sub, rank: over });
  }

  [['fertilizer', 'lastFertilizer', 'fertilizerDays', DEFAULT_FERT_DAYS, 'adubação'],
   ['pruning', 'lastPruning', 'pruningDays', DEFAULT_PRUNE_DAYS, 'poda']].forEach(([kind, field, dayField, def, noun]) => {
    if (!vase[field]) return;
    const d = new Date(vase[field]);
    if (isNaN(d)) return;
    const every = Math.max(1, Number(species && species[dayField]) || def);
    const days = daysBetween(d, now);
    if (days < every) return;
    const over = days - every;
    out.push({ kind, vase, species, rank: over,
      text: over === 0 ? `Hora da ${noun}!` : `${noun.charAt(0).toUpperCase() + noun.slice(1)} atrasada ${plural(over, 'dia', 'dias')}`,
      sub: `última ${noun} há ${plural(days, 'dia', 'dias')} · ciclo de ${every}` });
  });

  activePests(vase).forEach(p => {
    const detected = new Date(p.date);
    const days = isNaN(detected) ? 0 : Math.max(0, daysBetween(detected, now));
    const next = pestNextDate(p);
    const reapply = next && daysBetween(now, next) <= 0;
    const sev = SEVERITIES[p.severity] || SEVERITIES.leve;
    const treated = (p.treatments || []).length;
    out.push({ kind: 'pest', vase, species, pestId: p.id, rank: sev.weight * 1000 + days + (reapply ? 500 : 0),
      text: `${p.name} · ${sev.label.toLowerCase()}`,
      sub: reapply ? `Reaplicar o tratamento (${daysBetween(now, next) === 0 ? 'hoje' : 'atrasado ' + plural(-daysBetween(now, next), 'dia', 'dias')})`
        : `Ativa há ${plural(days, 'dia', 'dias')} · ${treated ? plural(treated, 'tratamento', 'tratamentos') : 'sem tratamento'}` });
  });

  (vase.history || []).forEach(h => {
    const d = new Date(h.date);
    if (isNaN(d)) return;
    const upcoming = d >= now;
    const missed = h.type === 'lembrete' && d < now && (now - d) < 7 * DAY_MS;
    if (upcoming || missed) {
      out.push({ kind: 'reminder', vase, species, late: !upcoming, when: d, rank: -d.getTime(),
        text: h.notes || 'Lembrete agendado', sub: (!upcoming ? '⚠ atrasado · ' : '') + relativeWhen(d) });
    }
  });
  return out;
}

export function collectAlerts() {
  const all = [];
  S.vases.forEach(v => {
    const sp = speciesOfVase(v);
    if (sp) all.push(...vaseAlerts(v, sp));
  });
  all.sort((a, b) => b.rank - a.rank);
  return all;
}
