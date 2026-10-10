// Toda chamada de IA tenta as Workers em ordem (config.js). Se uma falhar (erro, cota esgotada, rota inexistente,
// resposta inválida ou demora demais), passa para a próxima. A última que funcionou passa a ser a primeira
// tentativa das próximas chamadas (guardada no aparelho), para não perder tempo com Workers fora do ar.
import { WORKERS, WORKER_TIMEOUT_MS } from './config.js';
export { WORKERS };

const LAST_OK_KEY = 'mp-last-ok-worker';

// Só o Worker deste app (worker-plantas.js) marca as respostas com service:'minhas-plantas'.
// Um 400 dele é erro do pedido (ex.: foto ausente) e não adianta tentar em outro. Um 400 de uma Worker
// genérica/de outro projeto só significa "não entendi o formato" — aí o certo é seguir para a próxima.
function isFinalError(response, data) {
  return response.status === 400 && data && data.service === 'minhas-plantas';
}

function readLastOk() { try { return localStorage.getItem(LAST_OK_KEY) || ''; } catch (e) { return ''; } }
function saveLastOk(name) { try { localStorage.setItem(LAST_OK_KEY, name); } catch (e) { /* sem storage: ignora */ } }

function orderedWorkers() {
  const last = readLastOk();
  const list = WORKERS.slice();
  const i = list.findIndex(w => w.name === last);
  if (i > 0) list.unshift(list.splice(i, 1)[0]);
  return list;
}

// Lê o corpo UMA vez: JSON quando der, senão guarda um trecho do texto para aparecer nos detalhes técnicos.
async function readBody(response) {
  let text = '';
  try { text = await response.text(); } catch (e) { /* corpo ilegível */ }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* não é JSON */ }
  return { data, text };
}

function snippet(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Tenta cada Worker na ordem. `validate(data)` confere se o JSON devolvido tem o formato esperado
// (uma Worker que responde 200 com algo inesperado também é pulada).
// Devolve { data, worker } com a Worker que respondeu.
export async function callWorkers(path, buildOptions, validate = () => true, onAttempt = () => {}) {
  const failures = [];
  const list = orderedWorkers();

  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    onAttempt(w, i, list.length);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WORKER_TIMEOUT_MS);

    try {
      const response = await fetch(w.url + path, { ...buildOptions(), signal: ctrl.signal });
      const { data, text } = await readBody(response);

      if (response.ok && data && validate(data)) {
        saveLastOk(w.name);
        return { data, worker: w.name };
      }

      const detail = data && (data.error || data.detail || data.message);
      const reason = !response.ok
        ? `status ${response.status}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 160) : (snippet(text) ? ' — ' + snippet(text) : '')}`
        : 'resposta em formato inesperado';
      failures.push(`${w.name}: ${reason}`);
      console.warn(`Worker ${w.name} falhou (${reason}); tentando a próxima da lista…`);
      if (isFinalError(response, data)) {
        throw Object.assign(new Error(data.error || 'Pedido inválido.'), { final: true });
      }
    } catch (err) {
      if (err.final) throw err;
      const reason = err.name === 'AbortError' ? 'demorou demais'
        : (err instanceof TypeError ? 'sem resposta (fora do ar, bloqueada ou sem CORS)' : err.message);
      failures.push(`${w.name}: ${reason}`);
      console.warn(`Worker ${w.name} falhou (${reason}); tentando a próxima da lista…`);
    } finally {
      clearTimeout(timer);
    }
  }

  const err = new Error('Nenhuma das contas de IA respondeu agora. Tente novamente em instantes.');
  err.details = failures;
  throw err;
}
