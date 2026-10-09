// Toda chamada de IA começa SEMPRE pela primeira Worker da lista (em config.js) e, se ela não responder
// (erro, cota esgotada, resposta inválida ou demora demais), passa para a próxima, na ordem.
import { WORKERS, WORKER_TIMEOUT_MS } from './config.js';
export { WORKERS };

// Erro de validação do próprio pedido (400) não adianta tentar em outra conta.
function shouldTryNextWorker(status) { return status !== 400; }

// Tenta cada Worker na ordem. `validate(data)` confere se o JSON devolvido tem o formato esperado
// (uma Worker que responde 200 com algo inesperado também é pulada).
// Devolve { data, worker } com a Worker que respondeu.
export async function callWorkers(path, buildOptions, validate = () => true, onAttempt = () => {}) {
  const failures = [];

  for (let i = 0; i < WORKERS.length; i++) {
    const w = WORKERS[i];
    onAttempt(w, i);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WORKER_TIMEOUT_MS);

    try {
      const response = await fetch(w.url + path, { ...buildOptions(), signal: ctrl.signal });
      let data = null;
      try { data = await response.json(); } catch (e) { /* corpo não-JSON */ }

      if (response.ok && data && validate(data)) {
        return { data, worker: w.name };
      }

      const reason = !response.ok
        ? `status ${response.status}${data && (data.error || data.detail) ? ' — ' + (data.error || data.detail) : ''}`
        : 'resposta em formato inesperado';
      failures.push(`${w.name}: ${reason}`);
      console.warn(`Worker ${w.name} falhou (${reason}); tentando a próxima da lista…`);
      if (!response.ok && !shouldTryNextWorker(response.status)) {
        throw Object.assign(new Error((data && (data.error || data.detail)) || 'Pedido inválido.'), { final: true });
      }
    } catch (err) {
      if (err.final) throw err;
      const reason = err.name === 'AbortError' ? 'demorou demais' : err.message;
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
