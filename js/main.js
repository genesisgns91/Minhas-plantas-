// Ponto de entrada: carrega os módulos, expõe as ações usadas pelos atributos onclick do HTML e inicia o app.
import { S, activeFilters } from './state.js';
import { PUSH_URL, CLOUDINARY } from './config.js';
import * as utils from './utils.js';
import * as feedback from './ui/feedback.js';
import * as dialogs from './ui/dialogs.js';
import * as fx from './ui/fx.js';
import * as drawers from './ui/drawers.js';
import * as workers from './workers.js';
import * as images from './images.js';
import * as photos from './photos.js';
import * as filters from './filters.js';
import * as care from './care.js';
import * as dashboard from './dashboard.js';
import * as species from './species.js';
import * as nav from './nav.js';
import * as vases from './vases.js';
import * as carelog from './carelog.js';
import * as vasedetail from './vasedetail.js';
import * as lightbox from './lightbox.js';
import * as gallery from './gallery.js';
import * as ai from './ai.js';
import * as auth from './auth.js';
import * as data from './data.js';
import * as pests from './pests.js';
import * as agenda from './agenda.js';
import * as theme from './theme.js';
import * as share from './share.js';
import * as backup from './backup.js';
import * as account from './account.js';
import * as notifications from './notifications.js';
import * as schedule from './schedule.js';
import * as excel from './excel.js';
import * as recovery from './recovery.js';
import { lb } from './lightbox.js';
import { applyAlertsCollapsed, updateDashboard } from './dashboard.js';
import { renderSpeciesGrid } from './species.js';
import { renderVasesForSpecies } from './vases.js';
import { switchTab } from './nav.js';

// As ações (funções exportadas) ficam disponíveis para os atributos onclick="..." do HTML.
// (Não sobrescreve nada que já seja do próprio navegador, como alert ou open.)
for (const mod of [utils, feedback, dialogs, fx, drawers, workers, images, photos, filters, care, dashboard, species, nav,
  vases, carelog, vasedetail, lightbox, gallery, ai, auth, data, pests, agenda, theme, share, backup, account, notifications, schedule, excel, recovery]) {
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn === 'function' && !Object.prototype.hasOwnProperty.call(window, name)) window[name] = fn;
  }
}
if (window.__TEST__) window.__app = { S, lb, activeFilters, CLOUDINARY };

theme.applyTheme();

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    const url = 'sw.js' + (PUSH_URL ? `?push=${encodeURIComponent(PUSH_URL)}` : '');
    navigator.serviceWorker.register(url).catch(err => console.warn('Falha ao registrar service worker:', err));
  });
  // Toque numa notificação com o app aberto: abre a aba indicada
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'open-tab' && S.user) switchTab(e.data.tab);
  });
}

// Atualiza a agenda e os alertas quando os dados mudam
data.onDataChange('vases', () => agenda.refreshAgendaIfVisible());
data.onDataChange('species', () => agenda.refreshAgendaIfVisible());

let firstSignIn = true;
async function onUserChanged(user) {
  if (!user) {
    data.stopSync();
    auth.setAppState('signed-out');
    firstSignIn = true;
    return;
  }
  auth.setAppState('auth-loading');
  try { await data.migrateLegacyData(user); } catch (err) { console.warn('Migração dos dados antigos falhou:', err); }
  account.renderUser();
  data.startSync(user.uid);
  applyAlertsCollapsed();
  updateDashboard();
  auth.setAppState('signed-in');
  if (firstSignIn) {
    firstSignIn = false;
    const tab = new URLSearchParams(location.search).get('tab'); // vindo de uma notificação
    if (['agenda', 'gallery', 'ai'].includes(tab)) switchTab(tab);
  }
}

registerServiceWorker();
auth.initAuth(onUserChanged);

// Atualiza medidores de rega e saudação quando o dia vira (ou a aba fica aberta por muito tempo)
setInterval(() => {
  if (!S.user) return;
  updateDashboard();
  renderSpeciesGrid();
  agenda.refreshAgendaIfVisible();
  if (S.selectedSpecies) renderVasesForSpecies(S.selectedSpecies.firestoreId);
}, 10 * 60 * 1000);
