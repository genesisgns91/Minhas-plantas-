// =====================================================================
// MINHAS PLANTAS — Worker de notificações (Cloudflare Workers, plano gratuito)
// ---------------------------------------------------------------------
// Envia o aviso diário "o que fazer hoje" para o celular (Web Push), sem servidor pago e sem Firebase Functions.
//
// Como funciona:
//   • O app envia a este Worker um resumo de datas (o que vence e quando) — nada de fotos.
//   • Um Cron Trigger roda a cada hora; no horário escolhido por cada pessoa, o Worker manda um aviso sem
//     conteúdo (“push vazio”, assinado com VAPID). O service worker do app então pergunta aqui o texto (/peek).
//   • As chaves VAPID são geradas sozinhas na primeira chamada e guardadas no KV.
//
// Rotas: GET /vapid-public-key · POST /subscribe · POST /summary · POST /unsubscribe · POST /test · GET /peek?id=
// Configuração: veja GUIA-DE-CONFIGURACAO.md (crie um KV com o binding PUSH_KV e um Cron Trigger "0 * * * *").
// Variáveis opcionais: ALLOWED_ORIGIN (ex.: https://seu-usuario.github.io) e CONTACT (ex.: mailto:voce@exemplo.com).
// =====================================================================

const DAY = 86400000;
const KINDS = {
  water: ['💧', 'Regar'], fertilizer: ['🧪', 'Adubar'], pruning: ['✂️', 'Podar'], pest: ['🐛', 'Tratar'], reminder: ['⏰', 'Lembrete']
};

const cors = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
});
const json = (env, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env) } });

// ---------- util ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textB64url = (text) => b64url(new TextEncoder().encode(text));
async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- chaves VAPID ----------
let keyCache = null;
async function getKeys(env) {
  if (keyCache) return keyCache;
  const saved = await env.PUSH_KV.get('vapid', 'json');
  if (saved) { keyCache = saved; return saved; }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  keyCache = { publicKey, privateJwk };
  await env.PUSH_KV.put('vapid', JSON.stringify(keyCache));
  return keyCache;
}

async function vapidHeader(env, endpoint) {
  const { publicKey, privateJwk } = await getKeys(env);
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = textB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = textB64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.CONTACT || 'mailto:contato@minhasplantas.app' }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${publicKey}`;
}

/** Envia um push vazio. Devolve 'ok', 'gone' (assinatura inválida/expirada) ou 'error'. */
async function sendPush(env, sub) {
  try {
    const res = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(env, sub.endpoint), TTL: '43200', Urgency: 'normal' } });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch (e) { return 'error'; }
}

// ---------- mensagem do dia ----------
const localDate = (sub, now) => new Date(now - (sub.tzOffset || 0) * 60000);
const endOfLocalDay = (sub, now) => {
  const l = localDate(sub, now);
  return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + 1) + (sub.tzOffset || 0) * 60000;
};

export function buildMessage(sub, now = Date.now()) {
  const limit = endOfLocalDay(sub, now);
  const due = (sub.summary || []).filter(i => KINDS[i.k] && i.t < limit);
  if (!due.length) return null;
  const lines = Object.keys(KINDS).map(k => {
    const items = due.filter(i => i.k === k);
    if (!items.length) return null;
    const names = [...new Set(items.map(i => i.n))];
    const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
    return `${KINDS[k][0]} ${KINDS[k][1]}: ${shown}`;
  }).filter(Boolean);
  return { title: `🌿 ${due.length === 1 ? '1 cuidado' : due.length + ' cuidados'} para hoje`, body: lines.join('\n'), tag: 'minhas-plantas-diario' };
}

// ---------- armazenamento ----------
const subKey = (id) => `sub:${id}`;
async function getSub(env, endpoint) {
  const id = await sha256Hex(endpoint);
  return { id, sub: await env.PUSH_KV.get(subKey(id), 'json') };
}
const authOk = (sub, auth) => !!sub && !!auth && sub.auth === auth;

const cleanSummary = (s) => (Array.isArray(s) ? s : []).slice(0, 400)
  .filter(i => i && KINDS[i.k] && typeof i.n === 'string' && Number.isFinite(i.t))
  .map(i => ({ k: i.k, n: i.n.slice(0, 40), t: i.t }));
const cleanHour = (h) => { const n = Math.round(Number(h)); return n >= 0 && n <= 23 ? n : 8; };
const cleanOffset = (o) => { const n = Math.round(Number(o)); return Number.isFinite(n) && Math.abs(n) <= 840 ? n : 0; };

// ---------- rotas ----------
async function handle(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/+|\/+$/g, '');

  if (request.method === 'GET' && route === 'vapid-public-key') return json(env, { key: (await getKeys(env)).publicKey });

  if (request.method === 'GET' && route === 'peek') {
    const sub = await env.PUSH_KV.get(subKey(url.searchParams.get('id') || ''), 'json');
    if (!sub) return json(env, { title: '🌿 Minhas Plantas', body: 'Há cuidados esperando por você hoje.', tag: 'minhas-plantas-diario' });
    const msg = buildMessage(sub);
    if (msg) return json(env, msg);
    if (sub.testUntil && sub.testUntil > Date.now()) return json(env, { title: '🔔 Notificações funcionando!', body: 'Tudo certo — hoje não há cuidados pendentes. 🌱', tag: 'minhas-plantas-teste' });
    return json(env, { title: '🌿 Minhas Plantas', body: 'Abra o app para ver sua agenda.', tag: 'minhas-plantas-diario' });
  }

  if (request.method !== 'POST') return json(env, { error: 'Método não permitido.' }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json(env, { error: 'Corpo inválido.' }, 400); }

  if (route === 'subscribe') {
    const s = body.subscription;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.auth) return json(env, { error: 'Assinatura inválida.' }, 400);
    const { id, sub: existing } = await getSub(env, s.endpoint);
    if (existing && existing.auth !== s.keys.auth) return json(env, { error: 'Assinatura já registrada por outro aparelho.' }, 403);
    const sub = { endpoint: s.endpoint, auth: s.keys.auth, hour: cleanHour(body.hour), tzOffset: cleanOffset(body.tzOffset),
      summary: cleanSummary(body.summary), lastSent: existing ? existing.lastSent : '', created: existing ? existing.created : Date.now() };
    await env.PUSH_KV.put(subKey(id), JSON.stringify(sub));
    return json(env, { ok: true });
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  const { id, sub } = await getSub(env, endpoint);
  if (!authOk(sub, body.auth)) return json(env, { error: 'Assinatura não encontrada.' }, 404);

  if (route === 'summary') {
    sub.summary = cleanSummary(body.summary);
    if (body.tzOffset !== undefined) sub.tzOffset = cleanOffset(body.tzOffset);
    await env.PUSH_KV.put(subKey(id), JSON.stringify(sub));
    return json(env, { ok: true });
  }
  if (route === 'unsubscribe') { await env.PUSH_KV.delete(subKey(id)); return json(env, { ok: true }); }
  if (route === 'test') {
    sub.testUntil = Date.now() + 5 * 60000;
    await env.PUSH_KV.put(subKey(id), JSON.stringify(sub));
    const result = await sendPush(env, sub);
    if (result === 'gone') await env.PUSH_KV.delete(subKey(id));
    return json(env, { ok: result === 'ok', result });
  }
  return json(env, { error: 'Rota desconhecida.' }, 404);
}

/** Roda a cada hora: avisa quem está no horário escolhido e tem algo para hoje (no máximo 1 aviso por dia). */
export async function runCron(env, now = Date.now()) {
  let cursor, sent = 0;
  do {
    const page = await env.PUSH_KV.list({ prefix: 'sub:', cursor });
    for (const { name } of page.keys) {
      const sub = await env.PUSH_KV.get(name, 'json');
      if (!sub) continue;
      const l = localDate(sub, now);
      const today = l.toISOString().slice(0, 10);
      if (l.getUTCHours() !== sub.hour || sub.lastSent === today || !buildMessage(sub, now)) continue;
      const result = await sendPush(env, sub);
      if (result === 'gone') { await env.PUSH_KV.delete(name); continue; }
      if (result === 'ok') { sub.lastSent = today; await env.PUSH_KV.put(name, JSON.stringify(sub)); sent++; }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return sent;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    try { return await handle(request, env); } catch (err) { return json(env, { error: 'Erro interno: ' + (err && err.message ? err.message : err) }, 500); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env)); }
};
