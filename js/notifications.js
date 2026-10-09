// Notificações no celular (Web Push) sem custo: um Worker gratuito da Cloudflare envia o aviso diário.
// O app só envia ao Worker um resumo de datas (o que vence e quando); nenhuma foto ou texto longo.
import { S } from './state.js';
import { PUSH_URL } from './config.js';
import { speciesOfVase } from './care.js';
import { pushSummary } from './schedule.js';
import { onDataChange } from './data.js';

const KEY = 'minhasplantas_push';
const readLocal = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
const writeLocal = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* ignora */ } };

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushConfigured = () => !!PUSH_URL;

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function post(path, body) {
  const res = await fetch(PUSH_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Erro ${res.status} no servidor de notificações`);
  return json;
}

const payload = (sub, hour) => ({
  subscription: sub.toJSON(), hour, tzOffset: new Date().getTimezoneOffset(), summary: pushSummary(S.vases, speciesOfVase)
});

/** Estado para a tela de configurações. */
export async function getPushState() {
  const local = readLocal();
  const base = { supported: pushSupported(), configured: pushConfigured(), permission: pushSupported() ? Notification.permission : 'unsupported', subscribed: false, hour: local.hour ?? 8 };
  if (!base.supported || !base.configured) return base;
  try {
    const reg = await navigator.serviceWorker.ready;
    base.subscribed = !!(await reg.pushManager.getSubscription()) && base.permission === 'granted';
  } catch (e) { /* ignora */ }
  return base;
}

export async function enablePush(hour = 8) {
  if (!pushSupported()) throw new Error('Este navegador não suporta notificações. No iPhone, instale o app na tela inicial primeiro.');
  if (!pushConfigured()) throw new Error('As notificações ainda não foram configuradas (veja o guia de configuração).');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permissão negada. Libere as notificações nas configurações do navegador.');
  const reg = await navigator.serviceWorker.ready;
  const keyRes = await fetch(PUSH_URL + 'vapid-public-key');
  if (!keyRes.ok) throw new Error('Não foi possível falar com o servidor de notificações.');
  const { key } = await keyRes.json();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await post('subscribe', payload(sub, hour));
  writeLocal({ ...readLocal(), hour, enabled: true });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { await post('unsubscribe', { endpoint: sub.endpoint, auth: sub.toJSON().keys.auth }); } catch (e) { /* ignora */ }
    await sub.unsubscribe();
  }
  writeLocal({ ...readLocal(), enabled: false });
}

export async function setPushHour(hour) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await post('subscribe', payload(sub, hour));
  writeLocal({ ...readLocal(), hour });
}

export async function sendTestPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('Ative as notificações primeiro.');
  await post('test', { endpoint: sub.endpoint, auth: sub.toJSON().keys.auth });
}

// Mantém o resumo do Worker atualizado quando os dados mudam (no máximo a cada alguns minutos)
let timer = null, lastSent = '';
/** Envia agora o resumo atualizado (normalmente é chamado pelo temporizador abaixo). */
export async function syncSummary() {
  if (!pushSupported() || !pushConfigured() || !readLocal().enabled || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const summary = pushSummary(S.vases, speciesOfVase);
    const sig = JSON.stringify(summary);
    if (sig === lastSent) return;
    await post('summary', { endpoint: sub.endpoint, auth: sub.toJSON().keys.auth, summary, tzOffset: new Date().getTimezoneOffset() });
    lastSent = sig;
  } catch (e) { console.warn('Não foi possível atualizar o resumo das notificações:', e.message); }
}
export function scheduleSummarySync() { clearTimeout(timer); timer = setTimeout(syncSummary, 20000); }
onDataChange('vases', scheduleSummarySync);
