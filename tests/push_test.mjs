import { execSync } from 'node:child_process';
execSync('npx esbuild ../worker-push.js --format=esm --outfile=/tmp/worker-push.mjs --log-level=error', { cwd: new URL('.', import.meta.url).pathname });
const { default: worker, buildMessage, runCron } = await import('/tmp/worker-push.mjs');
import { webcrypto as crypto } from 'node:crypto';
let fails = 0;
const check = (n, c, x = '') => { if (c) console.log('  ✔', n); else { fails++; console.log('  ✘', n, x); } };

class KV { constructor() { this.m = new Map(); }
  async get(k, t) { const v = this.m.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); }
  async put(k, v) { this.m.set(k, v); } async delete(k) { this.m.delete(k); }
  async list({ prefix = '' } = {}) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } }
const env = { PUSH_KV: new KV(), ALLOWED_ORIGIN: 'https://x.github.io', CONTACT: 'mailto:a@b.c' };
const call = (path, body, method = body ? 'POST' : 'GET') => worker.fetch(new Request('https://w.test/' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } }), env);
const subscription = (endpoint, auth = 'AUTH1') => ({ endpoint, keys: { auth, p256dh: 'P' } });

const pushes = [];
const realFetch = globalThis.fetch;
let pushStatus = 201;
globalThis.fetch = async (url, opts) => { pushes.push({ url: String(url), headers: opts.headers }); return new Response(null, { status: pushStatus }); };

console.log('Chaves VAPID e CORS');
let r = await call('vapid-public-key');
const { key } = await r.json();
check('gera a chave pública (65 bytes) e guarda no KV', r.status === 200 && Buffer.from(key.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length === 65 && env.PUSH_KV.m.has('vapid'));
check('chave estável entre chamadas', (await (await call('vapid-public-key')).json()).key === key);
check('CORS restrito à origem configurada', r.headers.get('Access-Control-Allow-Origin') === 'https://x.github.io');
r = await worker.fetch(new Request('https://w.test/subscribe', { method: 'OPTIONS' }), env);
check('OPTIONS 204', r.status === 204);

console.log('Inscrição');
const EP = 'https://push.example.com/send/abc123';
const now = Date.UTC(2026, 9, 6, 11, 5); // 06/10/2026 11:05 UTC = 08:05 em São Paulo (offset 180)
const summary = [
  { k: 'water', n: 'Jiboia', t: now - 3 * DAYMS() }, { k: 'water', n: 'Samambaia', t: now - 1000 }, { k: 'water', n: 'Cacto', t: now + 3 * 3600000 },
  { k: 'fertilizer', n: 'Jiboia', t: now - 5000 }, { k: 'reminder', n: 'Orquídea', t: now + 10 * 3600000 }, { k: 'reminder', n: 'Amanhã', t: now + 20 * 3600000 },
  { k: 'water', n: 'Futura', t: now + 5 * 86400000 }, { k: 'zzz', n: 'x', t: 1 }, { k: 'water', n: 7, t: 1 }
];
function DAYMS() { return 86400000; }
r = await call('subscribe', { subscription: subscription(EP), hour: 8, tzOffset: 180, summary });
check('subscribe ok', r.status === 200);
const id = [...env.PUSH_KV.m.keys()].find(k => k.startsWith('sub:'));
const saved = JSON.parse(env.PUSH_KV.m.get(id));
check('descarta itens inválidos do resumo', saved.summary.length === 7 && saved.hour === 8 && saved.tzOffset === 180);
r = await call('subscribe', { subscription: subscription(EP, 'OUTRA'), hour: 8 });
check('outro aparelho não sobrescreve a assinatura (403)', r.status === 403);
r = await call('subscribe', { subscription: { endpoint: 'http://inseguro', keys: { auth: 'a' } } });
check('endpoint não-https recusado', r.status === 400);
r = await call('summary', { endpoint: EP, auth: 'ERRADA', summary: [] });
check('atualizar resumo exige o segredo (404 com auth errada)', r.status === 404);

console.log('Mensagem do dia');
const msg = buildMessage(saved, now);
check('conta tudo que vence até o fim do dia local (5 itens; “amanhã” e “daqui a 5 dias” ficam de fora)', /5 cuidados/.test(msg.title), msg.title);
check('agrupa por tipo e abrevia nomes', /💧 Regar: Jiboia, Samambaia \+1/.test(msg.body) && /🧪 Adubar: Jiboia/.test(msg.body), msg.body);
check('lembrete de hoje à noite entra; item de 5 dias depois não', /⏰ Lembrete: Orquídea/.test(msg.body) && !/Futura/.test(msg.body) && !/Amanhã/.test(msg.body));
check('sem nada vencendo => null', buildMessage({ summary: [{ k: 'water', n: 'A', t: now + 9 * 86400000 }], tzOffset: 180 }, now) === null);

console.log('/peek');
const hid = id.replace('sub:', '');
r = await call('peek?id=' + hid);
check('/peek devolve título e texto', (await r.json()).body.includes('Regar'));
r = await call('peek?id=naoexiste');
check('/peek de id desconhecido devolve texto genérico', /cuidados esperando/.test((await r.json()).body));

console.log('Envio (cron) e VAPID');
pushes.length = 0;
let n = await runCron(env, now - 3600000);
check('fora do horário (07:05 local) não envia', n === 0 && pushes.length === 0);
n = await runCron(env, now);
check('no horário (08:05 local) envia 1 push', n === 1 && pushes.length === 1 && pushes[0].url === EP);
const auth = pushes[0].headers.Authorization;
const [, t, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/);
check('cabeçalho VAPID com a chave pública', k === key);
const [h, c, s] = t.split('.');
const pub = await crypto.subtle.importKey('raw', Buffer.from(key.replace(/-/g, '+').replace(/_/g, '/'), 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'), new TextEncoder().encode(`${h}.${c}`));
check('assinatura ES256 do JWT é válida', valid);
const claims = JSON.parse(Buffer.from(c.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
check('JWT: audiência = origem do serviço de push, validade ≤ 24h, contato', claims.aud === 'https://push.example.com' && claims.exp - Date.now() / 1000 < 24 * 3600 && claims.sub === 'mailto:a@b.c');
check('TTL definido', pushes[0].headers.TTL === '43200');
n = await runCron(env, now + 60000);
check('não envia 2 vezes no mesmo dia', n === 0 && pushes.length === 1);
n = await runCron(env, now + 86400000);
check('no dia seguinte envia de novo', n === 1);

console.log('Teste, remoção e assinatura expirada');
pushes.length = 0;
r = await call('test', { endpoint: EP, auth: 'AUTH1' });
check('/test envia na hora', (await r.json()).ok === true && pushes.length === 1);
await call('summary', { endpoint: EP, auth: 'AUTH1', summary: [] });
check('/summary atualiza', JSON.parse(env.PUSH_KV.m.get(id)).summary.length === 0);
r = await call('peek?id=' + hid);
check('com nada pendente, o teste mostra "funcionando"', /funcionando/.test((await r.json()).title));
pushStatus = 410;
r = await call('test', { endpoint: EP, auth: 'AUTH1' });
check('410 do serviço de push remove a assinatura', !env.PUSH_KV.m.has(id));
await call('subscribe', { subscription: subscription(EP), hour: 8, tzOffset: 180, summary });
pushStatus = 201;
r = await call('unsubscribe', { endpoint: EP, auth: 'AUTH1' });
check('unsubscribe remove', (await r.json()).ok && !env.PUSH_KV.m.has(id));
r = await call('nada', {}, 'POST');
check('rota desconhecida => 404', r.status === 404);
globalThis.fetch = realFetch;
console.log(fails ? `\n❌ ${fails} falhas` : '\n✅ Worker de notificações OK');
process.exit(fails ? 1 : 0);
