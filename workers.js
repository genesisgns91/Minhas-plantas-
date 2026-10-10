// Toda chamada de IA tenta as Workers em ordem (config.js). Se uma falhar (erro, cota esgotada, resposta
// inválida ou demora demais), passa para a próxima. A última que funcionou passa a ser a primeira tentativa.
//
// Cada Worker pode falar um de dois "idiomas" — o app descobre sozinho e lembra qual:
//  • 'legacy' (padrão, o das suas contas): POST JSON { prompt, imageBase64, mimeType } na raiz → { resposta: "texto" }
//  • 'native' (worker-plantas.js): POST form-data em /diagnose-plant, /identify-plant, /auto-fill-plant → JSON pronto
import { WORKERS, WORKER_TIMEOUT_MS } from './config.js';
export { WORKERS };

const LAST_OK_KEY = 'mp-last-ok-worker';
const PROTO_KEY = 'mp-worker-proto';

function store(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sem storage: ignora */ } }

function orderedWorkers() {
  const last = store(LAST_OK_KEY, '');
  const list = WORKERS.slice();
  const i = list.findIndex(w => w.name === last);
  if (i > 0) list.unshift(list.splice(i, 1)[0]);
  return list;
}

function snippet(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Faz o pedido (com limite de tempo) e lê o corpo UMA vez: JSON quando der, senão guarda um trecho do texto.
async function request(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WORKER_TIMEOUT_MS);
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

// path/buildOptions = idioma 'native'. legacy = { prompt, image (dataURL, opcional), parse(texto) → dados } = idioma 'legacy'.
// Devolve { data, worker } com a Worker que respondeu.
export async function callWorkers(path, buildOptions, validate = () => true, onAttempt = () => {}, legacy = null) {
  const failures = [];
  const list = orderedWorkers();
  const protos = store(PROTO_KEY, {});

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
      for (let step = 0; step < 2; step++) {
        const r = mode === 'legacy' && legacy ? await tryLegacy(w) : await tryNative(w);
        if (r.switchTo) { mode = r.switchTo; continue; }
        if (r.data) {
          save(LAST_OK_KEY, w.name);
          if (protos[w.name] !== mode) { protos[w.name] = mode; save(PROTO_KEY, protos); }
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
    console.warn(`Worker ${w.name} falhou (${failures[failures.length - 1].slice(w.name.length + 2)}); tentando a próxima da lista…`);
  }

  const err = new Error('Nenhuma das contas de IA respondeu agora. Tente novamente em instantes.');
  err.details = failures;
  throw err;
}
