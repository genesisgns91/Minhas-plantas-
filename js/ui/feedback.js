import { $ } from '../utils.js';

// ---------- Avisos (toasts) e confirmação ----------
/**
 * Mostra um aviso. O 3º parâmetro pode ser a duração (ms) ou { ms, action: { label, onClick } }
 * — a ação serve para o botão "Desfazer" depois de excluir algo.
 */
export function toast(message, type = 'ok', options = 3200) {
  const opts = typeof options === 'number' ? { ms: options } : options;
  const ms = opts.ms || 3200;
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  el.appendChild(text);
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  };
  if (opts.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = opts.action.label;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await opts.action.onClick(); } finally { dismiss(); }
    });
    el.appendChild(btn);
  }
  box.appendChild(el);
  setTimeout(dismiss, type === 'error' ? Math.max(ms, 5000) : ms);
  return dismiss;
}

export function friendlyError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (/exceeds the maximum allowed size|too large|1048576|maximum.*size/i.test(msg)) {
    return 'Este vaso atingiu o limite de armazenamento de fotos. Exclua fotos antigas da galeria para adicionar novas.';
  }
  if (/permission|insufficient/i.test(msg)) {
    return 'Sem permissão no banco de dados (verifique as regras do Firestore).';
  }
  return msg;
}
