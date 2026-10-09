// ==================== UTILITÁRIOS ====================
export const $ = (id) => document.getElementById(id);

export const DAY_MS = 86400000;

export const prefersReducedMotion = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Escapa texto digitado pelo usuário/IA antes de inserir em innerHTML (evita quebrar o layout ou injetar HTML)
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS); }

export function fmtDate(iso, fallback = '—') {
  if (!iso) return fallback;
  const d = new Date(iso);
  return isNaN(d) ? fallback : d.toLocaleDateString('pt-BR');
}

export function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

export const rand = (min, max) => min + Math.random() * (max - min);

// ---------- Identificação ----------
export function normText(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

/** Baixa um arquivo gerado no navegador. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Carrega um script externo uma única vez (usado para a biblioteca de planilhas). */
const scriptCache = {};
export function loadScript(src) {
  if (!scriptCache[src]) {
    scriptCache[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = resolve;
      el.onerror = () => { delete scriptCache[src]; reject(new Error('Não foi possível carregar um componente necessário. Verifique a internet.')); };
      document.head.appendChild(el);
    });
  }
  return scriptCache[src];
}

/** Nome de arquivo seguro, sem acentos nem caracteres especiais. */
export const slugify = (t) => String(t || 'planta').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'planta';

/** Foto guardada dentro do próprio documento (em vez de uma URL do Cloudinary). */
export const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');
