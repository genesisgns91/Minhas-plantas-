// Toda chamada de IA tenta as Workers em ordem (config.js). Se uma falhar (erro, cota esgotada, resposta
// inválida ou demora demais), passa para a próxima. A última que funcionou passa a ser a primeira tentativa.
//
// Cada Worker pode falar um de dois "idiomas" — o app descobre sozinho e lembra qual:
//  • 'legacy' (padrão, o das suas contas): POST JSON { prompt, imageBase64, mimeType } na raiz → { resposta: "texto" }
//  • 'native' (worker-plantas.js): POST form-data em /diagnose-plant, /identify-plant, /auto-fill-plant → JSON pronto
//
// FOTOS (identificar / diagnosticar): nem toda conta de IA enxerga imagens — um modelo só de texto recebe o pedido sem a
// foto e responde "não há planta na imagem". Por isso, antes de confiar numa conta para fotos, o app faz um TESTE
// rápido (uma figurinha com um quadrado colorido e um número) e lembra o resultado. Contas que não passam são puladas
// nas fotos (mas continuam valendo para a ficha de cultivo, que é só texto).
import { WORKERS, WORKER_TIMEOUT_MS } from './config.js';
import { normText } from './utils.js';
export { WORKERS };

const LAST_OK_KEY = 'mp-last-ok-worker';
const PROTO_KEY = 'mp-worker-proto';
const VISION_KEY = 'mp-worker-vision';
const VISION_TTL_MS = { yes: 14 * 86400000, no: 3 * 86400000 };   // quanto tempo vale um resultado do teste
const PROBE_TIMEOUT_MS = 15000;

function store(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sem storage: ignora */ } }

// ---------- Memória: quais contas enxergam fotos ----------
/** true = enxerga, false = só texto, undefined = ainda não sabemos (ou o resultado venceu). */
export function visionCap(name) {
  const e = store(VISION_KEY, {})[name];
  if (!e) return undefined;
  return Date.now() - e.t < (e.cap ? VISION_TTL_MS.yes : VISION_TTL_MS.no) ? !!e.cap : undefined;
}
function saveVision(name, cap) {
  const all = store(VISION_KEY, {});
  all[name] = { cap: !!cap, t: Date.now() };
  save(VISION_KEY, all);
}

function orderedWorkers(forImage) {
  const last = store(LAST_OK_KEY, '');
  let list = WORKERS.filter(w => !(forImage && w.vision === false)); // vision:false no config.js = nunca usar em fotos
  const i = list.findIndex(w => w.name === last);
  if (i > 0) list.unshift(list.splice(i, 1)[0]);
  if (forImage) {
    // quem já provou enxergar vem primeiro; depois as ainda não testadas; contas "só texto" ficam de fora
    const rank = (w) => { const c = visionCap(w.name); return c === true ? 0 : c === undefined ? 1 : 2; };
    list = list.map((w, k) => ({ w, k })).sort((a, b) => rank(a.w) - rank(b.w) || a.k - b.k).map(x => x.w);
  }
  return list;
}

function snippet(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Faz o pedido (com limite de tempo) e lê o corpo UMA vez: JSON quando der, senão guarda um trecho do texto.
async function request(url, options, timeoutMs = WORKER_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: ctrl.signal });
    let text = '';
    try { text = await response.text(); } catch (e) { /* corpo ilegível */ }
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* não é JSON */ }
    return { response, data, text };
  } finally {
    clearTimeout(timer);
  }
}

// Texto da resposta de uma Worker "de conversa" (aceita os formatos mais comuns).
function extractText(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  const pick = d.resposta ?? d.response ?? d.text ?? d.result ?? d.output ?? d.answer ?? d.content ?? d.message;
  if (typeof pick === 'string') return pick;
  if (d.choices && d.choices[0] && d.choices[0].message && typeof d.choices[0].message.content === 'string') return d.choices[0].message.content;
  const parts = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
  if (Array.isArray(parts)) return parts.map(p => p.text || '').join('');
  return '';
}

function failureReason(response, data, text) {
  const detail = data && (data.error || data.detail || data.message);
  return `status ${response.status}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 160) : (snippet(text) ? ' — ' + snippet(text) : '')}`;
}

function splitDataURL(dataURL) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataURL || '');
  return m ? { mimeType: m[1], imageBase64: m[2] } : null;
}

// ---------- Teste de visão ----------
// Figurinha: quadrado de uma cor sorteada + número sorteado. Quem enxerga acerta os dois; quem não enxerga, não.
const CANARY_COLORS = [
  ['vermelho', 'red', '#d62828'], ['azul', 'blue', '#1d4ed8'], ['verde', 'green', '#15803d'],
  ['amarelo', 'yellow', '#facc15'], ['roxo', 'purple', '#7e22ce'], ['laranja', 'orange', '#ea580c']
];

function makeCanary() {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 192;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const [pt, en, hex] = CANARY_COLORS[Math.floor(Math.random() * CANARY_COLORS.length)];
    const number = String(10 + Math.floor(Math.random() * 90));
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 192, 192);
    ctx.fillStyle = hex; ctx.fillRect(36, 12, 120, 120);
    ctx.fillStyle = '#111111'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(number, 96, 162);
    const dataURL = c.toDataURL('image/jpeg', 0.85);
    return dataURL.startsWith('data:image/jpeg') ? { dataURL, pt, en, number } : null;
  } catch (e) { return null; }
}

/** Pergunta a uma conta a cor e o número da figurinha. Devolve { cap: true|false|undefined, error?, answer? }. */
export async function probeVision(w) {
  const canary = makeCanary();
  if (!canary) return { cap: undefined, noCanary: true, error: 'este navegador não consegue gerar a imagem de teste' };
  const img = splitDataURL(canary.dataURL);
  const prompt = 'Olhe a IMAGEM ANEXADA: ela tem um quadrado grande de uma cor e um número escrito embaixo. ' +
    'Responda SOMENTE com JSON: {"cor_do_quadrado":"<cor, em português>","numero":"<número escrito>"}. ' +
    'Se você não conseguir ver nenhuma imagem anexada, responda {"sem_imagem":true}.';
  try {
    const { response, data, text } = await request(w.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, ...img })
    }, PROBE_TIMEOUT_MS);
    if (data && data.service === 'minhas-plantas') return { cap: true };   // Worker do próprio app: sempre com visão
    if (!response.ok) return { cap: undefined, error: failureReason(response, data, text) };
    const answer = normText(extractText(data) || text);
    const ok = (answer.includes(normText(canary.pt)) || answer.includes(canary.en)) && answer.includes(canary.number);
    return { cap: ok, answer: snippet(answer) };
  } catch (err) {
    return { cap: undefined, error: err.name === 'AbortError' ? 'demorou demais' : (err instanceof TypeError ? 'sem resposta (fora do ar, bloqueada ou sem CORS)' : err.message) };
  }
}

/** Testa todas as contas ao mesmo tempo (botão "Testar as contas de IA") e guarda o resultado. */
export async function testWorkers() {
  const protos = store(PROTO_KEY, {});
  const out = await Promise.all(WORKERS.map(async (w) => {
    if (w.vision === false) return { name: w.name, cap: false, note: 'marcada como vision:false em config.js' };
    const r = protos[w.name] === 'native' ? { cap: true } : await probeVision(w);
    if (r.cap !== undefined) saveVision(w.name, r.cap);
    return { name: w.name, ...r };
  }));
  return out;
}

// path/buildOptions = idioma 'native'. legacy = { prompt, image (dataURL, opcional), parse(texto) → dados, judge(dados) } = idioma 'legacy'.
// Com `legacy.image` a chamada é "de foto": só contas que enxergam imagens são usadas.
// Devolve { data, worker } com a Worker que respondeu.
export async function callWorkers(path, buildOptions, validate = () => true, onAttempt = () => {}, legacy = null) {
  const failures = [];
  const isImage = !!(legacy && legacy.image);
  const judge = legacy && legacy.judge;
  const list = orderedWorkers(isImage);
  const protos = store(PROTO_KEY, {});
  let blind = 0; // quantas contas foram descartadas por não enxergar fotos

  async function tryLegacy(w) {
    const img = legacy.image ? splitDataURL(legacy.image) : null;
    const body = { prompt: legacy.prompt, ...(img || {}) };
    const { response, data, text } = await request(w.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // Quem respondeu é um Worker no formato novo (worker-plantas.js): passa para o idioma 'native'.
    if (data && data.service === 'minhas-plantas') return { switchTo: 'native' };
    if (!response.ok) return { reason: failureReason(response, data, text) };
    const answer = extractText(data) || (data ? '' : text);
    if (!answer || !answer.trim()) return { reason: 'resposta vazia' };
    let parsed;
    try { parsed = legacy.parse(answer); } catch (e) { return { reason: `resposta ilegível (${e.message})` }; }
    if (!validate(parsed)) return { reason: 'resposta em formato inesperado' };
    return { data: parsed };
  }

  async function tryNative(w) {
    const { response, data, text } = await request(w.url + path, { ...buildOptions() });
    // 400 de um Worker do app = erro do pedido (ex.: foto ausente): não adianta tentar em outro.
    if (response.status === 400 && data && data.service === 'minhas-plantas') {
      throw Object.assign(new Error(data.error || 'Pedido inválido.'), { final: true });
    }
    if (response.ok && data && validate(data)) return { data };
    return { reason: response.ok ? 'resposta em formato inesperado' : failureReason(response, data, text) };
  }

  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    onAttempt(w, i, list.length);
    let mode = protos[w.name] || (legacy ? 'legacy' : 'native');
    const reasons = [];

    try {
      // Porta da visão: antes de usar uma conta em foto, confirma que ela enxerga (uma vez; o resultado fica guardado).
      if (isImage && mode === 'legacy') {
        let cap = visionCap(w.name);
        if (cap === undefined) {
          const pr = await probeVision(w);
          if (pr.cap !== undefined) { saveVision(w.name, pr.cap); cap = pr.cap; }
          else if (!pr.noCanary) { failures.push(`${w.name}: ${pr.error || 'sem resposta no teste'}`); continue; }
        }
        if (cap === false) {
          blind++;
          failures.push(`${w.name}: não enxerga fotos (modelo só de texto) — pulada`);
          continue;
        }
      }

      for (let step = 0; step < 2; step++) {
        const r = mode === 'legacy' && legacy ? await tryLegacy(w) : await tryNative(w);
        if (r.switchTo) { mode = r.switchTo; continue; }
        if (r.data) {
          if (isImage && judge && judge(r.data) === 'novision') {
            saveVision(w.name, false);
            blind++;
            reasons.push('respondeu que não enxerga a foto (modelo só de texto) — pulada');
            break;
          }
          save(LAST_OK_KEY, w.name);
          if (protos[w.name] !== mode) { protos[w.name] = mode; save(PROTO_KEY, protos); }
          if (isImage && mode === 'legacy' && visionCap(w.name) !== true) saveVision(w.name, true);
          return { data: r.data, worker: w.name };
        }
        reasons.push(r.reason);
        // Falhou no idioma lembrado: na primeira vez que vemos esta Worker, ainda tenta o outro idioma.
        if (!protos[w.name] && legacy && mode === 'legacy' && step === 0 && /status (404|405|415)/.test(r.reason || '')) { mode = 'native'; continue; }
        break;
      }
      failures.push(`${w.name}: ${reasons.join(' / ') || 'sem resposta'}`);
    } catch (err) {
      if (err.final) throw err;
      const reason = err.name === 'AbortError' ? 'demorou demais'
        : (err instanceof TypeError ? 'sem resposta (fora do ar, bloqueada ou sem CORS)' : err.message);
      failures.push(`${w.name}: ${reason}`);
    }
    console.warn(`Worker ${w.name} falhou (${(failures[failures.length - 1] || '').slice(w.name.length + 2)}); tentando a próxima da lista…`);
  }

  const err = new Error(isImage && blind
    ? 'Nenhuma conta de IA que enxergue fotos respondeu agora. Toque em “Testar as contas de IA” para ver quais funcionam.'
    : 'Nenhuma das contas de IA respondeu agora. Tente novamente em instantes.');
  err.details = failures;
  throw err;
}
