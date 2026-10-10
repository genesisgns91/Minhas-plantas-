// Recuperação de dados antigos (só para a conta administradora, em ⚙️ Conta e configurações).
// 1) Diagnóstico: conta, em cada coleção, o que já é seu, o que não tem dono e o que pertence a outro uid.
// 2) "Assumir": passa para a sua conta tudo o que está em species/vases sem dono ou com outro dono.
// 3) "Importar plants": converte a coleção antiga `plants` (versão de abril) em espécies novas.
import { S } from './state.js';
import { $, esc, plural, normText } from './utils.js';
import { db, doc, getDocs, setDoc, writeBatch, collection } from './firebase.js';
import { isAdmin } from './data.js';
import { toast, friendlyError } from './ui/feedback.js';
import { askConfirm } from './ui/dialogs.js';

let lastScan = null;

const waterDaysFrom = (freq) => {
  const t = normText(freq || '');
  const n = t.match(/(\d+)\s*dia/);
  if (n) return Number(n[1]);
  if (t.includes('diaria')) return 1;
  if (t.includes('quinzen')) return 15;
  if (t.includes('mensal')) return 30;
  if (t.includes('semanal')) return 7;
  return 5;
};
const toxicityFrom = (v) => {
  const t = normText(v || '');
  if (t === 'segura') return 'Segura';
  if (t === 'fatal') return 'Letal';
  if (t.includes('toxica')) return 'Tóxica';
  return '';
};

// Converte um documento antigo de `plants` na ficha de espécie do app atual.
export function plantToSpecies(id, p, uid) {
  return {
    name: p.name || id,
    scientific: p.scientific || '',
    icon: p.emoji || '🪴',
    category: p.cat || '',
    light: [p.sun, p.directSun === 'sim' ? 'sol direto' : ''].filter(Boolean).join(' · '),
    water: [p.water, p.waterFreq].filter(Boolean).join(' · '),
    waterDays: waterDaysFrom(p.waterFreq),
    soil: [p.soil, p.substrate].filter(Boolean).join(' — '),
    fertilizer: p.fertNPK || '',
    naturalFertilizer: p.fertOrg || '',
    extraTips: p.tip || '',
    petToxicity: toxicityFrom(p.petSafety),
    photo: '',
    createdAt: new Date().toISOString(),
    ownerId: uid
  };
}

async function countCollection(name, uid) {
  try {
    const snap = await getDocs(collection(db, name));
    let mine = 0, orphan = 0, other = 0;
    snap.docs.forEach(d => {
      const o = d.data().ownerId;
      if (!o) orphan++; else if (o === uid) mine++; else other++;
    });
    return { total: snap.size, mine, orphan, other, docs: snap.docs };
  } catch (err) {
    return { error: friendlyError(err), code: err && err.code };
  }
}

export async function renderRecovery() {
  const card = $('setRecoveryCard');
  if (!card) return;
  const show = isAdmin(S.user);
  card.hidden = !show;
  if (!show) return;
  $('recoveryBox').innerHTML = '<p class="muted">Clique em “Verificar” para ver o que existe no banco de dados.</p><button class="btn btn-secondary" onclick="scanRecovery(this)">🔍 Verificar banco de dados</button>';
}

export async function scanRecovery(btn) {
  if (!isAdmin(S.user)) return;
  if (btn) btn.disabled = true;
  const box = $('recoveryBox');
  box.innerHTML = '<p class="muted">Verificando…</p>';
  const uid = S.user.uid;
  const [species, vases, plants] = await Promise.all([countCollection('species', uid), countCollection('vases', uid), countCollection('plants', uid)]);
  lastScan = { species, vases, plants };

  const line = (label, r) => r.error
    ? `<li><b>${label}:</b> não foi possível ler (${esc(r.error)})</li>`
    : `<li><b>${label}:</b> ${r.total} no total — ${r.mine} na sua conta, ${r.orphan} sem dono, ${r.other} de outra conta</li>`;
  const foreign = (species.orphan || 0) + (species.other || 0) + (vases.orphan || 0) + (vases.other || 0);
  const denied = [species, vases].some(r => r.code === 'permission-denied');

  box.innerHTML = `
    <ul style="padding-left:1.1rem;display:flex;flex-direction:column;gap:.35rem">${line('Espécies', species)}${line('Vasos', vases)}${line('Plantas antigas (plants)', plants)}</ul>
    ${denied ? '<p class="muted">⚠️ O banco recusou a leitura. Publique o arquivo <b>firestore.rules</b> (não o “estrito”) em Firestore → Regras e verifique de novo.</p>' : ''}
    ${foreign ? `<button class="btn btn-primary" onclick="claimRecovery(this)">📥 Trazer ${plural(foreign, 'item', 'itens')} para a minha conta</button>` : ''}
    ${plants.total ? `<button class="btn btn-secondary" onclick="importLegacyPlants(this)">🌱 Importar ${plural(plants.total, 'planta antiga', 'plantas antigas')} como espécies</button>` : ''}
    ${!foreign && !plants.total && !denied ? '<p class="muted">Nada para recuperar: tudo o que existe nas espécies e vasos já está na sua conta.</p>' : ''}
    <button class="btn btn-ghost" onclick="scanRecovery(this)">🔄 Verificar de novo</button>`;
}

export async function claimRecovery(btn) {
  if (!isAdmin(S.user) || !lastScan) return;
  const uid = S.user.uid;
  const todo = [];
  for (const [col, r] of [['species', lastScan.species], ['vases', lastScan.vases]]) {
    (r.docs || []).forEach(d => { if (d.data().ownerId !== uid) todo.push(doc(db, col, d.id)); });
  }
  if (!todo.length) return;
  const ok = await askConfirm(`Passar ${plural(todo.length, 'item', 'itens')} (espécies e vasos) para a conta ${S.user.email}?`, { icon: '📥', okLabel: 'Trazer para cá' });
  if (!ok) return;
  btn.disabled = true;
  try {
    for (let i = 0; i < todo.length; i += 400) {
      const batch = writeBatch(db);
      todo.slice(i, i + 400).forEach(ref => batch.update(ref, { ownerId: uid }));
      await batch.commit();
    }
    toast(`${plural(todo.length, 'item recuperado', 'itens recuperados')} 🌿`);
  } catch (err) {
    toast('Não foi possível recuperar: ' + friendlyError(err), 'error');
  }
  await scanRecovery();
}

export async function importLegacyPlants(btn) {
  if (!isAdmin(S.user) || !lastScan || !lastScan.plants.docs) return;
  const uid = S.user.uid;
  const have = new Set(S.species.map(s => normText(s.name)));
  const fresh = lastScan.plants.docs.filter(d => !have.has(normText(d.data().name || d.id)));
  if (!fresh.length) { toast('Todas as plantas antigas já existem como espécies.'); return; }
  const ok = await askConfirm(`Criar ${plural(fresh.length, 'espécie', 'espécies')} a partir das plantas antigas? As que já existem com o mesmo nome são ignoradas.`, { icon: '🌱', okLabel: 'Importar' });
  if (!ok) return;
  btn.disabled = true;
  let done = 0;
  try {
    for (const d of fresh) {
      await setDoc(doc(db, 'species', 'legacy-' + d.id), plantToSpecies(d.id, d.data(), uid));
      done++;
    }
    toast(`${plural(done, 'espécie importada', 'espécies importadas')} 🌱`);
  } catch (err) {
    toast(`Importou ${done}; erro: ${friendlyError(err)}`, 'error');
  }
  await scanRecovery();
}
