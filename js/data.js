// Sincronização com o Firestore: cada usuário só enxerga os documentos em que ownerId == seu uid.
import { S } from './state.js';
import { ADMIN_EMAIL } from './config.js';
import {
  db, speciesCol, vasesCol, query, where, onSnapshot, doc, getDoc, getDocs, setDoc, writeBatch
} from './firebase.js';
import { toast, friendlyError } from './ui/feedback.js';
import { renderSpeciesGrid, openSpeciesDetail } from './species.js';
import { leaveDetailUI } from './nav.js';
import { updateDashboard } from './dashboard.js';
import { refreshGalleryIfVisible } from './gallery.js';
import { renderVasesForSpecies } from './vases.js';
import { renderVaseDetail } from './vasedetail.js';
import { lbRefreshData } from './lightbox.js';

let unsubscribers = [];
const afterVasesHooks = [];
const afterSpeciesHooks = [];

/** Permite que outros módulos (agenda, notificações…) reajam às mudanças dos dados. */
export function onDataChange(kind, fn) { (kind === 'vases' ? afterVasesHooks : afterSpeciesHooks).push(fn); }

function snapshotToList(snapshot) {
  return snapshot.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
}

function onLoadError(err) {
  console.error('Erro ao carregar dados do Firestore:', err);
  S.loadError = friendlyError(err);
  S.speciesLoaded = S.vasesLoaded = true;
  toast('Não foi possível carregar seus dados: ' + S.loadError, 'error');
  renderSpeciesGrid();
}

export function startSync(uid) {
  stopSync();
  unsubscribers.push(onSnapshot(query(speciesCol, where('ownerId', '==', uid)), (snapshot) => {
    const firstLoad = !S.speciesLoaded;
    S.speciesLoaded = true;
    S.loadError = '';
    S.species = snapshotToList(snapshot);
    renderSpeciesGrid({ animate: firstLoad });
    updateDashboard();
    refreshGalleryIfVisible();
    if (S.selectedSpecies) {
      const updated = S.species.find(s => s.firestoreId === S.selectedSpecies.firestoreId);
      if (updated) openSpeciesDetail(updated);
      else leaveDetailUI(); // espécie excluída em outro dispositivo
    }
    afterSpeciesHooks.forEach(fn => fn());
  }, onLoadError));

  unsubscribers.push(onSnapshot(query(vasesCol, where('ownerId', '==', uid)), (snapshot) => {
    S.vasesLoaded = true;
    S.vases = snapshotToList(snapshot);
    renderSpeciesGrid();
    updateDashboard();
    if (S.selectedSpecies) renderVasesForSpecies(S.selectedSpecies.firestoreId);
    if (S.detailVaseId) renderVaseDetail(S.detailVaseId);
    refreshGalleryIfVisible();
    lbRefreshData();
    afterVasesHooks.forEach(fn => fn());
  }, onLoadError));
}

export function stopSync() {
  unsubscribers.forEach(fn => { try { fn(); } catch (e) { /* ignora */ } });
  unsubscribers = [];
  S.species = []; S.vases = [];
  S.speciesLoaded = S.vasesLoaded = false;
  S.loadError = '';
  S.selectedSpecies = null; S.detailVaseId = null;
}

export const isAdmin = (user) => !!user && user.email === ADMIN_EMAIL && user.emailVerified !== false;

/**
 * Dados criados antes do login não têm dono (ownerId). Na primeira entrada da conta administradora
 * eles passam a pertencer a ela; outras contas nunca os enxergam. Roda uma vez (marcado em users/{uid}).
 */
export async function migrateLegacyData(user) {
  if (!isAdmin(user)) return { migrated: 0 };
  const flagRef = doc(db, 'users', user.uid);
  const flag = await getDoc(flagRef);
  if (flag.exists() && flag.data().legacyMigrated) return { migrated: 0 };

  let migrated = 0;
  for (const col of [speciesCol, vasesCol]) {
    const snap = await getDocs(col);
    const orphans = snap.docs.filter(d => !d.data().ownerId);
    for (let i = 0; i < orphans.length; i += 400) {
      const batch = writeBatch(db);
      orphans.slice(i, i + 400).forEach(d => batch.update(d.ref || doc(db, col.name || col.id, d.id), { ownerId: user.uid }));
      await batch.commit();
      migrated += Math.min(400, orphans.length - i);
    }
  }
  await setDoc(flagRef, { legacyMigrated: true, migratedAt: new Date().toISOString(), email: user.email }, { merge: true });
  return { migrated };
}
