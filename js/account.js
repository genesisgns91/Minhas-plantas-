// Conta do usuário e tela de configurações: perfil, tema, notificações, fotos (Cloudinary) e dados (backup/Excel).
import { S } from './state.js';
import { $, esc, plural } from './utils.js';
import { firstName, signOutUser } from './auth.js';
import { openDrawer } from './ui/drawers.js';
import { toast, friendlyError } from './ui/feedback.js';
import { askConfirm } from './ui/dialogs.js';
import { getThemePref, setTheme } from './theme.js';
import { getPushState, enablePush, disablePush, setPushHour, sendTestPush } from './notifications.js';
import { isCloudConfigured, isDataUrl, storePhoto } from './images.js';
import { vasePhotos } from './photos.js';
import { patchSpecies, patchVase } from './repo.js';

/** Atualiza saudação, avatar e nome em todo o app. */
export function renderUser() {
  const u = S.user;
  const name = u ? firstName(u) : '';
  document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = u ? (u.displayName || u.email) : ''; });
  document.querySelectorAll('[data-user-first]').forEach(el => { el.textContent = name; });
  document.querySelectorAll('[data-user-email]').forEach(el => { el.textContent = u ? (u.email || '') : ''; });
  document.querySelectorAll('[data-user-avatar]').forEach(el => {
    const initial = (name || '?').charAt(0).toUpperCase();
    if (u && u.photoURL) el.innerHTML = `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer" />`;
    else el.textContent = initial;
  });
}

const inlinePhotoCount = () => {
  let n = S.species.filter(s => isDataUrl(s.photo)).length;
  S.vases.forEach(v => { n += vasePhotos(v).filter(p => isDataUrl(p.photo)).length; });
  return n;
};

export async function openSettings() {
  renderUser();
  setTheme(getThemePref());
  renderPhotoStatus();
  await renderPushSection();
  openDrawer('drawerSettings');
}

function renderPhotoStatus() {
  const n = inlinePhotoCount();
  const cloud = isCloudConfigured();
  $('cloudStatus').innerHTML = cloud
    ? '<span class="pill ok">✅ Cloudinary ativo</span> As novas fotos são hospedadas fora do banco de dados, sem limite de 1 MB.'
    : '<span class="pill late">⚠️ Cloudinary não configurado</span> As fotos ainda ficam dentro do banco (limite de cerca de 8 por vaso). Veja o guia de configuração.';
  const btn = $('btnMigratePhotos');
  btn.hidden = !(cloud && n > 0);
  btn.textContent = `☁️ Enviar ${plural(n, 'foto antiga', 'fotos antigas')} para o Cloudinary`;
}

/** Move as fotos que estão dentro dos documentos para o Cloudinary e troca as referências. */
export async function migratePhotos() {
  const total = inlinePhotoCount();
  if (!total) return;
  const ok = await askConfirm(`Enviar ${plural(total, 'foto', 'fotos')} para o Cloudinary? As fotos antigas continuam funcionando até serem trocadas.`, { icon: '☁️', okLabel: 'Enviar' });
  if (!ok) return;
  const btn = $('btnMigratePhotos');
  btn.disabled = true;
  let done = 0, failed = 0;
  const step = () => { btn.textContent = `Enviando… ${done}/${total}`; };
  step();
  for (const sp of S.species.filter(s => isDataUrl(s.photo))) {
    try { await patchSpecies(sp.firestoreId, await storePhoto(sp.photo, ['especie'])); done++; } catch (e) { failed++; }
    step();
  }
  for (const v of S.vases) {
    if (!vasePhotos(v).some(p => isDataUrl(p.photo))) continue;
    try {
      const next = [];
      for (const p of vasePhotos(v)) {
        if (isDataUrl(p.photo)) { next.push({ ...(await storePhoto(p.photo, ['vaso'])), date: p.date }); done++; step(); }
        else next.push(p.raw || { photo: p.photo, date: p.date });
      }
      await patchVase(v.firestoreId, { photoHistory: next, photo: '' });
    } catch (e) { failed++; }
  }
  btn.disabled = false;
  renderPhotoStatus();
  toast(failed ? `${plural(done, 'foto enviada', 'fotos enviadas')}; ${plural(failed, 'item falhou', 'itens falharam')}. Tente de novo.` : `${plural(done, 'foto enviada', 'fotos enviadas')} para o Cloudinary ☁️`, failed ? 'error' : 'ok');
}

// ---------- Notificações ----------
export async function renderPushSection() {
  const st = await getPushState();
  const box = $('pushBox');
  let html;
  if (!st.configured) html = '<p class="muted">As notificações ainda não foram configuradas. Siga o <b>guia de configuração</b> para ativar o aviso diário (é gratuito).</p>';
  else if (!st.supported) html = '<p class="muted">Este navegador não suporta notificações. No iPhone, abra o app pela tela inicial (Compartilhar → Adicionar à Tela de Início).</p>';
  else if (st.permission === 'denied') html = '<p class="muted">As notificações estão bloqueadas neste navegador. Libere nas configurações do site para ativar.</p>';
  else {
    const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === Number(st.hour) ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
    html = `<div class="switch-row">
        <span id="pushLabel">Aviso diário no celular</span>
        <button class="switch" role="switch" aria-checked="${st.subscribed}" aria-labelledby="pushLabel" onclick="togglePush(this)"><i></i></button>
      </div>
      <div class="form-group push-hour" ${st.subscribed ? '' : 'hidden'}>
        <label for="pushHour">Horário do aviso</label>
        <select id="pushHour" class="form-control" onchange="changePushHour(this.value)">${hours}</select>
        <small>Avisa só quando há rega, adubo, poda, tratamento ou lembrete para o dia.</small>
        <button class="btn btn-secondary" onclick="testPush(this)">🔔 Enviar notificação de teste</button>
      </div>`;
  }
  box.innerHTML = html;
}

export async function togglePush(btn) {
  const turnOn = btn.getAttribute('aria-checked') !== 'true';
  btn.disabled = true;
  try {
    if (turnOn) { await enablePush(8); toast('Notificações ativadas 🔔'); } else { await disablePush(); toast('Notificações desativadas.'); }
  } catch (err) { toast(err.message || friendlyError(err), 'error'); }
  await renderPushSection();
}

export async function changePushHour(value) {
  try { await setPushHour(Number(value)); toast(`Aviso diário às ${String(value).padStart(2, '0')}:00 ⏰`); } catch (err) { toast(err.message, 'error'); }
}

export async function testPush(btn) {
  btn.disabled = true;
  try { await sendTestPush(); toast('Teste enviado — a notificação deve chegar em instantes.'); } catch (err) { toast(err.message, 'error'); }
  btn.disabled = false;
}

export function chooseTheme(pref) { setTheme(pref); }

export async function confirmSignOut() {
  const ok = await askConfirm('Sair da sua conta neste aparelho?', { icon: '👋', okLabel: 'Sair' });
  if (ok) await signOutUser();
}

export function pickBackupFile() { $('backupFile').click(); }
