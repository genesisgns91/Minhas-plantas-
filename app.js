// ==================== SERVICE WORKER ====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Falha ao registrar service worker:', err));
  });
}

// ==================== FIREBASE ====================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// CONFIGURAÇÃO DO SEU FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyBO2dpMGZG5N7-5wLTexU2puDsGjxzSDaI",
  authDomain: "minhasplantas-9b229.firebaseapp.com",
  projectId: "minhasplantas-9b229",
  storageBucket: "minhasplantas-9b229.firebasestorage.app",
  messagingSenderId: "568939226178",
  appId: "1:568939226178:web:dcc77000360c7fdadcb9db"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const speciesCol = collection(db, "species");
const vasesCol = collection(db, "vases");

// ==================== WORKERS CLOUDFLARE (ORDEM FIXA DE PRIORIDADE) ====================
// Toda chamada de IA começa SEMPRE pela primeira Worker da lista e, se ela não responder
// (erro, cota esgotada, resposta inválida ou demora demais), passa para a próxima, na ordem.
// Para mudar a prioridade, basta reordenar esta lista. As URLs terminam com "/".
const WORKERS = [
  { name: 'certificados-groq-proxy', url: 'https://certificados-groq-proxy.genesisgns.workers.dev/' },
  { name: 'gns91-groq-proxy',        url: 'https://gns91-groq-proxy.genesisgns.workers.dev/' },
  { name: 'forzion-gpt-proxy',       url: 'https://forzion-gpt-proxy.genesisgns.workers.dev/' },
  { name: 'mamoot-gpt-proxy',        url: 'https://mamoot-gpt-proxy.genesisgns.workers.dev/' },
  { name: 'astro-gns-proxy',         url: 'https://astro-gns-proxy.genesisgns.workers.dev/' },
  { name: 'shiny-sky-21dd',          url: 'https://shiny-sky-21dd.genesisgns.workers.dev/' },
  { name: 'astro2',                  url: 'https://astro2.genesisgns.workers.dev/' },
  { name: 'interno',                 url: 'https://interno.genesisgns.workers.dev/' }
];
const WORKER_TIMEOUT_MS = 40000;

// Erro de validação do próprio pedido (400) não adianta tentar em outra conta.
function shouldTryNextWorker(status) { return status !== 400; }

// Tenta cada Worker na ordem. `validate(data)` confere se o JSON devolvido tem o formato esperado
// (uma Worker que responde 200 com algo inesperado também é pulada).
// Devolve { data, worker } com a Worker que respondeu.
async function callWorkers(path, buildOptions, validate = () => true, onAttempt = () => {}) {
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

// ==================== ESTADO ====================
let allSpecies = [];
let allVases = [];
let speciesLoaded = false;
let vasesLoaded = false;
let loadError = '';
let currentSelectedSpecies = null;
let currentDetailVaseId = null;
let activeDrawerId = null;
let searchTerm = '';
const activeFilters = new Set(); // chaves 'grupo:opção' — OU dentro do grupo, E entre grupos

// Imagens já processadas (comprimidas + base64), prontas para salvar ou enviar ao Worker.
let speciePhotoData = null;
let vasePhotoData = null;
let aiImageData = null;

// ==================== UTILITÁRIOS ====================
const $ = (id) => document.getElementById(id);
const DAY_MS = 86400000;
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Escapa texto digitado pelo usuário/IA antes de inserir em innerHTML (evita quebrar o layout ou injetar HTML)
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS); }
function fmtDate(iso, fallback = '—') {
  if (!iso) return fallback;
  const d = new Date(iso);
  return isNaN(d) ? fallback : d.toLocaleDateString('pt-BR');
}
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

// ---------- Avisos (toasts) e confirmação ----------
function toast(message, type = 'ok', ms = 3200) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, type === 'error' ? Math.max(ms, 5000) : ms);
}

function friendlyError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (/exceeds the maximum allowed size|too large|1048576|maximum.*size/i.test(msg)) {
    return 'Este vaso atingiu o limite de armazenamento de fotos. Exclua fotos antigas da galeria para adicionar novas.';
  }
  if (/permission|insufficient/i.test(msg)) {
    return 'Sem permissão no banco de dados (verifique as regras do Firestore).';
  }
  return msg;
}

function askConfirm(message, { icon = '🌿', okLabel = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    const overlay = $('confirmOverlay');
    const ok = $('confirmOk');
    const cancel = $('confirmCancel');
    $('confirmMsg').textContent = message;
    $('confirmIco').textContent = icon;
    ok.textContent = okLabel;
    overlay.classList.add('open');
    ok.focus();

    const finish = (value) => {
      overlay.classList.remove('open');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (e) => { if (e.target === overlay) finish(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
      if (e.key === 'Enter') { e.stopPropagation(); finish(true); }
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}

// ---------- Efeitos: ripple de pétala, gotas, brilhos, chuva de pétalas ----------
document.addEventListener('pointerdown', (e) => {
  const target = e.target.closest('.btn:not(.burger), .chip, .quick-btn, .fab');
  if (!target || target.disabled || prefersReducedMotion) return;
  const rect = target.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.left = (e.clientX - rect.left) + 'px';
  span.style.top = (e.clientY - rect.top) + 'px';
  target.appendChild(span);
  setTimeout(() => span.remove(), 750);
});

const rand = (min, max) => min + Math.random() * (max - min);

function spawnFx(className, text, x, y, dx, dy, dur, rot = 0) {
  const el = document.createElement('span');
  el.className = `fx ${className}`;
  if (text) el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.setProperty('--dx', dx + 'px');
  el.style.setProperty('--dy', dy + 'px');
  el.style.setProperty('--rot', rot + 'deg');
  el.style.setProperty('--dur', dur + 's');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), dur * 1000 + 100);
}

function burst(sourceEl, kind) {
  if (prefersReducedMotion || !sourceEl) return;
  const r = sourceEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  if (kind === 'lastWater') {
    for (let i = 0; i < 9; i++) spawnFx('drop', '', cx + rand(-18, 18), cy - 6, rand(-34, 34), rand(70, 130), rand(.7, 1.1));
    return;
  }
  const sets = { lastFertilizer: ['✨', '🧪', '🌿'], lastPruning: ['🍃', '✂️', '🍃'], lastRepot: ['🌱', '🪴', '🌱'] };
  const set = sets[kind] || ['✨'];
  for (let i = 0; i < 7; i++) {
    spawnFx('emoji', set[i % set.length], cx + rand(-14, 14), cy, rand(-60, 60), rand(-130, -60), rand(.9, 1.4), rand(-40, 40));
  }
}

function petalRain(count = 28) {
  if (prefersReducedMotion) return;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'fx petalfx' + (i % 4 === 0 ? ' leaf' : '');
    el.style.left = rand(0, window.innerWidth) + 'px';
    el.style.top = '-24px';
    el.style.setProperty('--dx', rand(-140, 140) + 'px');
    el.style.setProperty('--dy', (window.innerHeight + 60) + 'px');
    el.style.setProperty('--rot', rand(180, 540) + 'deg');
    el.style.setProperty('--dur', rand(1.8, 3) + 's');
    el.style.animationDelay = rand(0, .5) + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }
}

// Pétalas e folhas flutuando no fundo
(function initPetals() {
  const wrap = $('petals');
  if (!wrap || prefersReducedMotion) return;
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('span');
    p.className = 'petal' + (i % 3 === 0 ? ' leaf' : '');
    p.style.left = rand(0, 100) + '%';
    p.style.setProperty('--s', rand(12, 24) + 'px');
    p.style.setProperty('--d', rand(22, 40) + 's');
    p.style.setProperty('--delay', (-rand(0, 40)) + 's');
    p.style.setProperty('--sway', rand(-70, 90) + 'px');
    wrap.appendChild(p);
  }
})();

// ---------- Dicas ----------
const TIPS = [
  'Regue pela manhã cedo ou no fim da tarde: a água evapora menos e as raízes aproveitam melhor.',
  'Antes de regar, enfie o dedo 2 cm no substrato. Se ainda estiver úmido, espere mais um dia.',
  'Folhas amareladas e moles costumam indicar excesso de água; folhas secas nas pontas, falta de umidade no ar.',
  'Gire o vaso um quarto de volta toda semana para a planta crescer por igual em direção à luz.',
  'Limpe as folhas com um pano úmido: elas respiram melhor e fazem mais fotossíntese.',
  'Todo vaso precisa de furos de drenagem. Raízes encharcadas apodrecem rápido.',
  'Registre fotos do mesmo ângulo todo mês: a galeria de evolução fica ainda mais bonita.',
  'Troque o vaso quando as raízes aparecerem pelos furos de drenagem — o ideal é só um tamanho maior.',
  'Água da chuva ou filtrada, em temperatura ambiente, evita choque térmico nas raízes.',
  'Podar pontas secas estimula novos brotos e deixa a planta mais cheia.',
  'Adubo demais queima raízes. Na dúvida, use metade da dose recomendada.',
  'Plantas perto de ar-condicionado ou ventilador perdem umidade mais rápido. Observe-as com mais frequência.'
];
function dayOfYear() { const n = new Date(); return Math.floor((n - new Date(n.getFullYear(), 0, 0)) / DAY_MS); }
function renderTips() {
  const i = dayOfYear();
  $('dailyTip').textContent = TIPS[i % TIPS.length];
  $('dailyTipMain').textContent = TIPS[(i + 5) % TIPS.length];
}
renderTips();

// ==================== COMPRESSÃO DE IMAGEM ====================
// Fotos de câmera chegam com vários MB e estouravam o limite de 1MB por documento do Firestore.
// TODA imagem passa por redimensionamento/compressão via canvas antes de virar base64.
function compressImage(file, { maxDim = 1280, initialQuality = 0.75, maxBytes = 700000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) {
      reject(new Error('O arquivo selecionado não é uma imagem.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Não foi possível processar essa imagem (formato não suportado pelo navegador).'));
      img.onload = () => {
        let { width, height } = img;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round(height * (maxDim / width));
            width = maxDim;
          } else {
            width = Math.round(width * (maxDim / height));
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        let quality = initialQuality;
        let dataUrl;
        try {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        } catch (err) {
          reject(new Error('Não foi possível comprimir a imagem: ' + err.message));
          return;
        }

        // Reduz a qualidade gradualmente até caber no tamanho máximo desejado
        let attempts = 0;
        while (dataUrl.length > maxBytes * 1.37 && quality > 0.2 && attempts < 8) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', Math.max(quality, 0.2));
          attempts++;
        }

        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Fotos que entram na galeria de evolução ficam menores (~100–130 KB) para caber várias
// no limite de 1 MB de um documento do Firestore.
const GALLERY_OPTS = { maxDim: 1080, initialQuality: 0.72, maxBytes: 95000 };
const DOC_LIMIT_BYTES = 1048576;
const DOC_SAFE_BYTES = 980000;

function dataURLToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: mime });
}

// Liga um par de inputs (galeria + câmera) a um callback; devolve a função que processa um File
function wireImagePicker(galleryInputId, cameraInputId, previewId, onSelect, options) {
  const galleryInput = $(galleryInputId);
  const cameraInput = $(cameraInputId);
  const preview = previewId ? $(previewId) : null;

  async function processFile(file) {
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, options);
      onSelect(dataUrl);
      if (preview) {
        preview.src = dataUrl;
        preview.style.display = 'block';
      }
    } catch (err) {
      toast('Não foi possível usar essa imagem: ' + err.message, 'error');
    }
  }

  async function handle(e) {
    const file = e.target.files[0];
    e.target.value = ''; // permite selecionar o mesmo arquivo novamente depois
    await processFile(file);
  }

  galleryInput.addEventListener('change', handle);
  cameraInput.addEventListener('change', handle);
  return processFile;
}

wireImagePicker('speciePhotoGallery', 'speciePhotoCamera', 'speciePhotoPreview', (d) => { speciePhotoData = d; });
wireImagePicker('vasePhotoGallery', 'vasePhotoCamera', 'vasePhotoPreview', (d) => { vasePhotoData = d; }, GALLERY_OPTS);
const processAiFile = wireImagePicker('aiImageGallery', 'aiImageCamera', 'aiImagePreview', (d) => { aiImageData = d; });

// Arrastar e soltar foto no diagnóstico
(function initDropzone() {
  const dz = $('aiDropzone');
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => processAiFile(e.dataTransfer && e.dataTransfer.files[0]));
})();

// ==================== FOTOS / GALERIA DO VASO ====================
// Fonte única das fotos de um vaso, em ordem cronológica (da mais antiga para a mais nova).
// Vasos antigos (só com o campo `photo`) continuam funcionando.
function vasePhotos(vase) {
  const hist = (vase.photoHistory || [])
    .filter(p => p && p.photo)
    .map(p => ({ photo: p.photo, date: p.date, raw: p }));
  hist.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!hist.length && vase.photo) {
    return [{ photo: vase.photo, date: vase.createdAt || new Date().toISOString(), legacy: true }];
  }
  return hist;
}

function vaseCover(vase) {
  const photos = vasePhotos(vase);
  return photos.length ? photos[photos.length - 1].photo : '';
}

function docBytes(vase) {
  try {
    const { firestoreId, ...rest } = vase;
    return JSON.stringify(rest).length;
  } catch (e) { return 0; }
}

// Monta o update que adiciona uma foto à galeria (migrando a foto antiga do campo `photo`, se existir)
function buildPhotoAddPayload(vase, dataUrl) {
  const now = new Date().toISOString();
  const entries = [];
  const hasHistory = (vase.photoHistory || []).some(p => p && p.photo);
  if (!hasHistory && vase.photo) entries.push({ photo: vase.photo, date: vase.createdAt || now });
  entries.push({ photo: dataUrl, date: now });
  const payload = { photoHistory: arrayUnion(...entries) };
  if (vase.photo) payload.photo = ''; // a capa passa a ser sempre a foto mais recente da galeria
  return payload;
}

// ==================== BUSCA / FILTROS ====================
window.applySpeciesSearch = function() {
  const input = $('searchInput');
  searchTerm = input.value.trim().toLowerCase();
  $('searchWrap').classList.toggle('has-text', !!input.value);
  renderSpeciesGrid();
};

window.clearSearch = function() {
  $('searchInput').value = '';
  applySpeciesSearch();
  $('searchInput').focus();
};

function vasesOf(sp) { return allVases.filter(v => v.speciesId === sp.firestoreId); }

function speciesMatchesSearch(sp) {
  if (!searchTerm) return true;
  const haystack = [
    sp.name, sp.scientific, sp.category, sp.light, sp.water, sp.pruning,
    sp.soil, sp.fertilizer, sp.naturalFertilizer,
    ...vasesOf(sp).map(v => v.name)
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(searchTerm);
}

function speciesMatchesFilter(sp, groups) {
  if (!activeFilters.size) return true;
  const vs = vasesOf(sp);
  return groups.every(g => {
    const selected = g.opts.filter(o => activeFilters.has(`${g.id}:${o.id}`));
    return !selected.length || selected.some(o => o.test(sp, vs)); // OU dentro do grupo
  });
}

function filteredSpecies() {
  const groups = activeFilters.size ? getFilterGroups(false) : null;
  return allSpecies.filter(sp => speciesMatchesSearch(sp) && speciesMatchesFilter(sp, groups));
}

// ---------- Painel de filtros (menu sanduíche) ----------
function lightTags(sp) {
  const t = normText(sp.light);
  const tags = [];
  if (!t) return tags;
  if (/sol pleno|pleno sol|sol direto|muito sol|pleno-sol/.test(t)) tags.push('sun');
  if (/meia[ -]?sombra|sol da manha|sol parcial/.test(t)) tags.push('half');
  if (/indireta|difusa|filtrada|claridade/.test(t)) tags.push('indirect');
  if (/pouca luz|baixa luz|pouca claridade/.test(t) || (/sombra/.test(t) && !/meia[ -]?sombra/.test(t))) tags.push('shade');
  return tags;
}

function wateredToday(v) { return !!v.lastWater && daysBetween(new Date(v.lastWater), new Date()) === 0; }

function getFilterGroups(withCounts = true) {
  const groups = [
    { id: 'water', icon: '💧', title: 'Rega', hint: 'de qualquer vaso', opts: [
      { id: 'thirsty', icon: '🚿', label: 'Precisam de rega', test: (sp, vs) => vs.some(v => needsWater(v, sp)) },
      { id: 'today', icon: '💦', label: 'Regadas hoje', test: (sp, vs) => vs.some(wateredToday) },
      { id: 'ok', icon: '✅', label: 'Em dia', test: (sp, vs) => vs.length > 0 && vs.every(v => v.lastWater && !needsWater(v, sp)) },
      { id: 'never', icon: '❓', label: 'Sem rega registrada', test: (sp, vs) => vs.some(v => !v.lastWater) }
    ] },
    { id: 'pet', icon: '🐾', title: 'Segurança para pets', opts: [
      { id: 'Segura', icon: '🟢', label: 'Segura', test: sp => sp.petToxicity === 'Segura' },
      { id: 'Tóxica', icon: '🟠', label: 'Tóxica', test: sp => sp.petToxicity === 'Tóxica' },
      { id: 'Letal', icon: '🔴', label: 'Letal', test: sp => sp.petToxicity === 'Letal' },
      { id: 'none', icon: '⚪', label: 'Não informado', test: sp => !sp.petToxicity }
    ] },
    { id: 'light', icon: '☀️', title: 'Luz', hint: 'conforme a ficha', opts: [
      { id: 'sun', icon: '☀️', label: 'Sol pleno', test: sp => lightTags(sp).includes('sun') },
      { id: 'half', icon: '⛅', label: 'Meia-sombra', test: sp => lightTags(sp).includes('half') },
      { id: 'indirect', icon: '🪟', label: 'Luz indireta', test: sp => lightTags(sp).includes('indirect') },
      { id: 'shade', icon: '🌑', label: 'Sombra', test: sp => lightTags(sp).includes('shade') }
    ] },
    { id: 'cycle', icon: '🗓️', title: 'Ritmo de rega', opts: [
      { id: 'frequent', icon: '⏱️', label: 'Frequente (até 3 dias)', test: sp => (Number(sp.waterDays) || 5) <= 3 },
      { id: 'moderate', icon: '🔁', label: 'Moderado (4 a 7 dias)', test: sp => { const n = Number(sp.waterDays) || 5; return n >= 4 && n <= 7; } },
      { id: 'spaced', icon: '🌵', label: 'Espaçado (8+ dias)', test: sp => (Number(sp.waterDays) || 5) >= 8 }
    ] }
  ];

  // Categorias: criadas a partir das espécies cadastradas
  const cats = new Map();
  allSpecies.forEach(sp => {
    const label = String(sp.category || '').trim();
    if (label && !cats.has(normText(label))) cats.set(normText(label), label);
  });
  if (cats.size) {
    groups.push({ id: 'cat', icon: '🏷️', title: 'Categoria', opts: [...cats.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([id, label]) => ({ id, icon: '🌿', label, test: sp => normText(sp.category) === id })) });
  }

  groups.push({ id: 'stock', icon: '🪴', title: 'Vasos e fotos', opts: [
    { id: 'withVases', icon: '🪴', label: 'Com vasos', test: (sp, vs) => vs.length > 0 },
    { id: 'noVases', icon: '🕳️', label: 'Sem vasos', test: (sp, vs) => vs.length === 0 },
    { id: 'withPhotos', icon: '📸', label: 'Com fotos', test: (sp, vs) => !!sp.photo || vs.some(v => vasePhotos(v).length) },
    { id: 'noPhotos', icon: '🌫️', label: 'Sem fotos', test: (sp, vs) => !sp.photo && !vs.some(v => vasePhotos(v).length) }
  ] });

  if (withCounts) {
    const pairs = allSpecies.map(sp => [sp, vasesOf(sp)]);
    groups.forEach(g => g.opts.forEach(o => { o.count = pairs.filter(([sp, vs]) => o.test(sp, vs)).length; }));
  }
  return groups;
}

function filterLabel(key) {
  for (const g of getFilterGroups(false)) {
    const o = g.opts.find(x => `${g.id}:${x.id}` === key);
    if (o) return `${o.icon} ${o.label}`;
  }
  return null;
}

function chipBloom(el) {
  if (prefersReducedMotion) return;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI * 2 * i) / 6 + rand(-.3, .3), dist = rand(28, 52);
    spawnFx('petalfx', '', cx, cy, Math.cos(ang) * dist, Math.sin(ang) * dist, rand(.6, .95), rand(-90, 90));
  }
}

function setBurgerOpen(open) {
  const b = $('filterBtn');
  if (!b) return;
  b.classList.toggle('open', open);
  b.setAttribute('aria-expanded', String(open));
}

function updateFilterPanelState() {
  document.querySelectorAll('#filterGroups .f-opt').forEach(b => {
    const on = activeFilters.has(b.dataset.key);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('#filterGroups .f-group').forEach(g => g.classList.toggle('has-sel', !!g.querySelector('.f-opt.on')));

  const n = filteredSpecies().length, total = allSpecies.length;
  const live = $('fLive');
  const msg = activeFilters.size
    ? `Mostrando <b class="bump">${n}</b> de ${total} ${total === 1 ? 'espécie' : 'espécies'}`
    : `${total} ${total === 1 ? 'espécie' : 'espécies'} · nenhum filtro ativo`;
  if (live.innerHTML !== msg) {
    live.innerHTML = msg;
  }
  $('fApply').textContent = n === 0 ? 'Nenhuma espécie' : `Ver ${plural(n, 'espécie', 'espécies')}`;
  $('fClear').disabled = !activeFilters.size;
}

function renderFilterPanel({ animate = true } = {}) {
  const box = $('filterGroups');
  const groups = getFilterGroups();
  box.classList.toggle('static', !animate);
  box.innerHTML = groups.map((g, gi) => `
    <section class="f-group" data-g="${g.id}" style="--g:${gi}">
      <div class="f-group-head">
        <h4 class="f-group-title"><span class="f-gico">${g.icon}</span>${esc(g.title)}${g.hint ? ` <small>${esc(g.hint)}</small>` : ''}</h4>
        <button class="f-clear-group" onclick="clearFilterGroup('${g.id}')">Limpar</button>
      </div>
      <div class="f-opts">
        ${g.opts.map(o => `<button class="f-opt${o.count === 0 ? ' zero' : ''}" data-key="${esc(g.id + ':' + o.id)}" aria-pressed="false" onclick="toggleFilter(this.dataset.key, this)"><span class="f-ico">${o.icon}</span><span class="f-txt">${esc(o.label)}</span><span class="f-n">${o.count}</span></button>`).join('')}
      </div>
    </section>`).join('');
  updateFilterPanelState();
}

function renderActiveStrip() {
  const el = $('activeFilters');
  if (!el) return;
  const keys = [...activeFilters];
  el.hidden = keys.length === 0;
  if (!keys.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="af-label">Filtrando por</span>` +
    keys.map(k => `<span class="af-chip">${esc(filterLabel(k) || k)}<button onclick="removeFilter(this.dataset.key)" data-key="${esc(k)}" aria-label="Remover filtro ${esc(filterLabel(k) || '')}">×</button></span>`).join('') +
    `<button class="af-clear" onclick="clearFilters()">Limpar tudo</button>`;
}

// Atualiza tudo o que depende dos filtros (botão, faixa, chips rápidos, painel)
function refreshFilterChrome() {
  if (speciesLoaded) {
    const valid = new Set(getFilterGroups(false).flatMap(g => g.opts.map(o => `${g.id}:${o.id}`)));
    [...activeFilters].forEach(k => { if (!valid.has(k)) activeFilters.delete(k); });
  }
  const n = activeFilters.size;
  const btn = $('filterBtn');
  if (btn) {
    btn.classList.toggle('has-filters', n > 0);
    $('filterBadge').textContent = n;
    btn.setAttribute('aria-label', n ? `Filtros (${n} ativos)` : 'Filtros');
  }
  document.querySelectorAll('.chip[data-filter]').forEach(c => {
    const f = c.dataset.filter;
    const on = f === 'all' ? n === 0 : f === 'thirsty' ? activeFilters.has('water:thirsty') : activeFilters.has('pet:Segura');
    c.classList.toggle('active', on);
  });
  renderActiveStrip();
  if (activeDrawerId === 'drawerFilters') renderFilterPanel({ animate: false });
}

function applyFilters() { renderSpeciesGrid({ animate: true }); }

window.toggleFilter = function(key, el) {
  const turningOn = !activeFilters.has(key);
  if (turningOn) activeFilters.add(key); else activeFilters.delete(key);
  if (el) { updateFilterPanelState(); if (turningOn) chipBloom(el); }
  applyFilters();
};

window.removeFilter = function(key) { activeFilters.delete(key); applyFilters(); };

window.clearFilterGroup = function(groupId) {
  [...activeFilters].forEach(k => { if (k.startsWith(groupId + ':')) activeFilters.delete(k); });
  applyFilters();
};

window.clearFilters = function() { activeFilters.clear(); applyFilters(); };

// Atalhos rápidos (chips ao lado da busca) — mexem nos mesmos filtros do painel
window.setFilter = function(mode) {
  if (mode === 'all') activeFilters.clear();
  else {
    const key = mode === 'thirsty' ? 'water:thirsty' : 'pet:Segura';
    if (activeFilters.has(key)) activeFilters.delete(key); else activeFilters.add(key);
  }
  applyFilters();
};

window.toggleFilterPanel = function() {
  if (activeDrawerId === 'drawerFilters') { closeActiveDrawer(); return; }
  renderFilterPanel({ animate: true });
  openDrawer('drawerFilters');
};

function petToxicityIcon(level) {
  if (level === 'Letal') return '🔴';
  if (level === 'Tóxica') return '🟠';
  if (level === 'Segura') return '🟢';
  return '🐾';
}

// ==================== STATUS DE REGA ====================
function waterStatus(vase, species) {
  const due = Math.max(1, Number(species && species.waterDays) || 5);
  if (!vase.lastWater) {
    return { state: 'never', pct: 0, title: 'Sem rega registrada', sub: 'Toque em Regar para começar', icon: '💧' };
  }
  const d = new Date(vase.lastWater);
  const days = Math.max(0, daysBetween(d, new Date()));
  const pct = Math.min(100, Math.round((days / due) * 100));
  if (days === 0) return { state: 'fresh', pct, title: 'Regada hoje', sub: `próxima em ${plural(due, 'dia', 'dias')}`, icon: '💦' };
  if (days < due) {
    const left = due - days;
    return { state: left === 1 ? 'soon' : 'ok', pct, title: `Regada há ${plural(days, 'dia', 'dias')}`, sub: left === 1 ? 'regar amanhã' : `próxima em ${left} dias`, icon: '💧' };
  }
  if (days === due) return { state: 'due', pct: 100, title: 'Hora de regar!', sub: `ciclo de ${plural(due, 'dia', 'dias')} completo`, icon: '🚿' };
  return { state: 'late', pct: 100, title: `Atrasada ${plural(days - due, 'dia', 'dias')}`, sub: `última rega há ${days} dias`, icon: '⚠️' };
}

function needsWater(vase, species) {
  const s = waterStatus(vase, species).state;
  return s === 'due' || s === 'late';
}

function speciesOfVase(vase) { return allSpecies.find(s => s.firestoreId === vase.speciesId); }

// ==================== FIREBASE EM TEMPO REAL ====================
function onLoadError(err) {
  console.error('Erro ao carregar dados do Firestore:', err);
  loadError = friendlyError(err);
  speciesLoaded = vasesLoaded = true;
  toast('Não foi possível carregar seus dados: ' + loadError, 'error');
  renderSpeciesGrid();
}

onSnapshot(speciesCol, (snapshot) => {
  const firstLoad = !speciesLoaded;
  speciesLoaded = true;
  loadError = '';
  allSpecies = snapshot.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  renderSpeciesGrid({ animate: firstLoad });
  updateDashboard();
  refreshGalleryIfVisible();
  if (currentSelectedSpecies) {
    const updated = allSpecies.find(s => s.firestoreId === currentSelectedSpecies.firestoreId);
    if (updated) openSpeciesDetail(updated);
    else leaveDetailUI(); // espécie foi excluída em outro dispositivo
  }
}, onLoadError);

onSnapshot(vasesCol, (snapshot) => {
  vasesLoaded = true;
  allVases = snapshot.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  renderSpeciesGrid();
  updateDashboard();
  if (currentSelectedSpecies) renderVasesForSpecies(currentSelectedSpecies.firestoreId);
  if (currentDetailVaseId) renderVaseDetail(currentDetailVaseId);
  refreshGalleryIfVisible();
  lbRefreshData();
}, onLoadError);

// ==================== DASHBOARD ====================
function relativeWhen(d) {
  const now = new Date();
  const diff = daysBetween(now, d);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `hoje ${time}`;
  if (diff === 1) return `amanhã ${time}`;
  if (diff === -1) return `ontem ${time}`;
  if (diff > 1 && diff < 7) return `em ${diff} dias`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + time;
}

function updateDashboard() {
  const now = new Date();
  $('statSpeciesCount').textContent = allSpecies.length;
  $('statPotsCount').textContent = allVases.length;

  const wateredTodayPots = new Set();
  const reminders = [];

  allVases.forEach(vase => {
    (vase.history || []).forEach(h => {
      const d = new Date(h.date);
      if (isNaN(d)) return;
      if (h.type === 'lastWater' && daysBetween(d, now) === 0 && d <= now) wateredTodayPots.add(vase.firestoreId);
      const upcoming = d >= now;
      const recentlyMissed = h.type === 'lembrete' && d < now && (now - d) < 7 * DAY_MS;
      if (upcoming || recentlyMissed) reminders.push({ vaseName: vase.name, late: !upcoming, ...h, _d: d });
    });
  });

  const need = allVases.filter(v => needsWater(v, speciesOfVase(v))).length;
  $('statWateredToday').textContent = wateredTodayPots.size;
  $('statNeedWater').textContent = need;
  $('statNeedCard').classList.toggle('has-alert', need > 0);

  // Hero
  const hour = now.getHours();
  const greet = hour < 5 ? 'Boa madrugada' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  $('heroGreeting').textContent = `${greet}! 🌿`;
  $('heroDate').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('heroSub').textContent = !speciesLoaded ? 'Carregando seu jardim…'
    : allVases.length === 0 ? 'Cadastre sua primeira espécie e comece a acompanhar o seu jardim.'
    : need > 0 ? `${plural(need, 'vaso precisa', 'vasos precisam')} de água hoje. 💧`
    : 'Tudo em dia — suas plantas agradecem! 💚';

  // Lembretes
  const list = $('remindersList');
  if (reminders.length === 0) {
    list.innerHTML = '<p class="muted">Nenhum lembrete próximo. Agende um pelo botão “Registro retroativo / lembrete” de um vaso.</p>';
  } else {
    reminders.sort((a, b) => a._d - b._d);
    list.innerHTML = reminders.slice(0, 6).map(r => `
      <div class="reminder-item ${r.late ? 'late' : ''}">
        <div><b>${esc(r.vaseName)}:</b> ${esc(r.notes || 'Lembrete agendado')}</div>
        <span class="reminder-when">${r.late ? '⚠ atrasado · ' : ''}${esc(relativeWhen(r._d))}</span>
      </div>`).join('');
  }
}

// ==================== RENDER: ESPÉCIES ====================
function emptyPlantSvg() {
  return `<svg viewBox="0 0 160 140" aria-hidden="true">
    <ellipse cx="80" cy="128" rx="46" ry="7" fill="#dbe4d8"/>
    <path d="M52 92h56l-7 34H59z" fill="#c16e41"/><rect x="48" y="86" width="64" height="12" rx="6" fill="#d98557"/>
    <path d="M80 86V50" stroke="#5f8b57" stroke-width="4" stroke-linecap="round"/>
    <path d="M80 62C62 62 50 50 50 32c18 0 30 10 30 30z" fill="#8fcf80"><animateTransform attributeName="transform" type="rotate" values="-4 80 62;4 80 62;-4 80 62" dur="4s" repeatCount="indefinite"/></path>
    <path d="M80 54c0-18 12-30 30-30 0 18-12 30-30 30z" fill="#6b8e63"><animateTransform attributeName="transform" type="rotate" values="4 80 54;-4 80 54;4 80 54" dur="4.4s" repeatCount="indefinite"/></path>
    <circle cx="112" cy="24" r="6" fill="#e9a8b5"/>
  </svg>`;
}

function renderSpeciesGrid(opts) {
  renderSpeciesGridInner(opts);
  refreshFilterChrome();
}

function renderSpeciesGridInner({ animate = false } = {}) {
  const container = $('speciesGrid');

  if (!speciesLoaded) return; // mantém o esqueleto de carregamento

  if (loadError) {
    container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>Não foi possível carregar</h4><p>${esc(loadError)}</p></div>`;
    $('speciesCountChip').textContent = '0';
    return;
  }

  if (allSpecies.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>Seu jardim está vazio</h4><p>Cadastre a primeira espécie para começar a acompanhar rega, adubação e evolução.</p><button class="btn btn-primary" onclick="openAddSpeciesModal()">+ Cadastrar primeira espécie</button></div>`;
    $('speciesCountChip').textContent = '0';
    return;
  }

  const list = filteredSpecies();
  $('speciesCountChip').textContent = list.length;

  if (list.length === 0) {
    const onlyThirsty = activeFilters.size === 1 && activeFilters.has('water:thirsty') && !searchTerm;
    if (activeFilters.size && !onlyThirsty) {
      container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>Nenhuma espécie combina com esses filtros</h4><p>Tente remover algum filtro ou limpar a seleção.</p><button class="btn btn-primary" onclick="clearFilters()">Limpar filtros</button></div>`;
      return;
    }
    const msg = onlyThirsty ? 'Nenhuma planta precisa de água agora. 🎉' : 'Nenhum resultado para essa busca.';
    container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>${msg}</h4></div>`;
    return;
  }

  container.innerHTML = '';
  list.forEach((sp, i) => {
    const vs = vasesOf(sp);
    const thirsty = vs.filter(v => needsWater(v, sp)).length;

    const card = document.createElement('div');
    card.className = 'species-card' + (animate ? ' enter' : '');
    card.style.setProperty('--i', Math.min(i, 14));
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Abrir ${sp.name}`);
    card.onclick = () => openSpeciesDetail(sp, { fromUser: true });
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSpeciesDetail(sp, { fromUser: true }); } };

    const media = sp.photo
      ? `<img src="${esc(sp.photo)}" class="species-card-cover" alt="" loading="lazy" decoding="async" />`
      : `<div class="species-card-cover-icon">${esc(sp.icon || '🪴')}</div>`;

    const badges = [];
    if (thirsty > 0) badges.push(`<span class="pill late">💧 ${plural(thirsty, 'precisa', 'precisam')} de rega</span>`);
    if (sp.petToxicity) badges.push(`<span class="pill">${petToxicityIcon(sp.petToxicity)} Pets: ${esc(sp.petToxicity)}</span>`);

    card.innerHTML = `
      <div class="species-card-media">
        ${media}
        <div class="species-card-actions">
          <button class="btn-icon" onclick="event.stopPropagation(); editSpecies('${sp.firestoreId}')" title="Editar" aria-label="Editar ${esc(sp.name)}">✏️</button>
          <button class="btn-icon danger" onclick="event.stopPropagation(); deleteSpecies('${sp.firestoreId}')" title="Excluir" aria-label="Excluir ${esc(sp.name)}">🗑</button>
        </div>
        ${badges.length ? `<div class="species-card-badges">${badges.join('')}</div>` : ''}
      </div>
      <div class="species-card-body">
        <h3>${esc(sp.name)}</h3>
        <p class="sci">${esc(sp.scientific || '')}</p>
        <div class="species-card-foot">
          <span>🪴 ${plural(vs.length, 'vaso', 'vasos')}</span>
          <span class="go" aria-hidden="true">→</span>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

// ==================== VIEWS / NAVEGAÇÃO ====================
const VIEWS = ['sec-species', 'sec-species-detail', 'sec-gallery', 'sec-ai'];
function showView(id) {
  const wasActive = $(id).classList.contains('is-active');
  VIEWS.forEach(v => $(v).classList.toggle('is-active', v === id));
  if (!wasActive) window.scrollTo({ top: 0, behavior: 'auto' });
}

function leaveDetailUI() {
  currentSelectedSpecies = null;
  showView('sec-species');
  renderSpeciesGrid({ animate: true });
}

function setNavActive(tab) {
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
}

window.switchTab = function(tab) {
  currentSelectedSpecies = null;
  if (history.state && history.state.v === 'detail') history.replaceState(null, '');
  showView(tab === 'ai' ? 'sec-ai' : tab === 'gallery' ? 'sec-gallery' : 'sec-species');
  setNavActive(tab);
  if (tab === 'gallery') renderGallery({ animate: true });
};

window.toggleSidebar = function() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('minhasplantas_sidebar', collapsed ? '1' : '0'); } catch (e) { /* ignora */ }
};
try {
  if (localStorage.getItem('minhasplantas_sidebar') === '1') document.body.classList.add('sidebar-collapsed');
} catch (e) { /* ignora */ }

window.addEventListener('popstate', () => {
  if (lb.open) closeLightbox(true);
  const v = history.state && history.state.v;
  if (currentSelectedSpecies && v !== 'detail' && v !== 'lightbox') leaveDetailUI();
});

// ==================== DETALHE DA ESPÉCIE ====================
window.openSpeciesDetail = function(species, { fromUser = false } = {}) {
  const firstOpen = !currentSelectedSpecies || currentSelectedSpecies.firestoreId !== species.firestoreId;
  currentSelectedSpecies = species;
  if (fromUser && !(history.state && history.state.v === 'detail')) history.pushState({ v: 'detail' }, '');
  showView('sec-species-detail');

  $('detailSpeciesName').textContent = species.name;
  $('breadcrumbName').textContent = species.name;
  $('detailSpeciesNameVases').textContent = species.name;
  $('detailSpeciesScientific').textContent = species.scientific || '';

  const coverEl = $('detailSpeciesCover');
  if (species.photo) {
    coverEl.className = 'cover-photo-lg';
    coverEl.innerHTML = `<img src="${esc(species.photo)}" alt="" />`;
  } else {
    coverEl.className = 'cover-icon-lg';
    coverEl.textContent = species.icon || '🪴';
  }

  const careGrid = $('detailSpeciesCareGrid');
  const careFields = [
    { icon: "🏷️", label: "Categoria", val: species.category },
    { icon: "☀️", label: "Luz / Sol", val: species.light },
    { icon: "💧", label: "Rega", val: species.water, extra: species.waterDays ? ` · a cada ${species.waterDays} dias` : '' },
    { icon: "✂️", label: "Poda", val: species.pruning },
    { icon: "💦", label: "Umidade", val: species.humidity },
    { icon: "🪱", label: "Solo", val: species.soil },
    { icon: "🧪", label: "Adubação comercial", val: species.fertilizer },
    { icon: "🍌", label: "Adubação natural", val: species.naturalFertilizer },
    { icon: "💡", label: "Dica extra", val: species.extraTips },
    { icon: "⚠️", label: "Observações", val: species.observations },
    {
      icon: petToxicityIcon(species.petToxicity), label: "Toxicidade pet", tox: species.petToxicity,
      val: species.petToxicity ? (species.petWarning ? `${species.petToxicity} — ${species.petWarning}` : species.petToxicity) : null
    }
  ];

  let html = '';
  careFields.forEach(f => {
    if (!f.val) return;
    html += `
      <div class="care-item ${f.tox ? 'tox-' + esc(f.tox) : ''}">
        <span class="ci-ico">${f.icon}</span>
        <div><div class="ci-label">${f.label}</div><div class="ci-val">${esc(f.val)}${esc(f.extra || '')}</div></div>
      </div>`;
  });

  if (!html && species.care) { // formato legado
    html = `<div class="care-item"><span class="ci-ico">📋</span><div class="ci-val">${esc(species.care)}</div></div>`;
  } else if (!html) {
    html = `<p class="muted">Nenhuma instrução específica cadastrada. Toque em “Editar espécie” para preencher (ou use a IA).</p>`;
  }
  careGrid.innerHTML = html;

  renderVasesForSpecies(species.firestoreId, { animate: firstOpen });
};

window.backToSpecies = function() {
  if (history.state && history.state.v === 'detail') history.back();
  else leaveDetailUI();
};

// ==================== RENDER: VASOS ====================
function sparklineHtml(history) {
  const regas = history.filter(h => h.type === 'lastWater').map(h => new Date(h.date)).filter(d => !isNaN(d)).sort((a, b) => a - b);
  if (regas.length < 2) return `<div class="spark-empty">Registre mais regas para ver o ritmo.</div>`;
  const intervals = [];
  for (let i = 1; i < regas.length; i++) {
    intervals.push(Math.max(1, Math.round((regas[i] - regas[i - 1]) / DAY_MS)));
  }
  const last = intervals.slice(-10);
  const max = Math.max(...last, 1);
  return `<div class="spark-bars">${last.map((v, k) => `<div class="spark-bar" style="--h:${Math.max(12, Math.round(v / max * 100))}%; --k:${k}"><i>${v}d</i></div>`).join('')}</div>`;
}

function renderVasesForSpecies(speciesId, { animate = false } = {}) {
  const container = $('vasesGrid');
  const species = allSpecies.find(s => s.firestoreId === speciesId);
  const myVases = allVases.filter(v => v.speciesId === speciesId);

  if (!vasesLoaded) {
    container.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    return;
  }

  if (myVases.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>Nenhum vaso por aqui ainda</h4><p>Cadastre o primeiro vaso desta espécie para registrar cuidados e fotos.</p><button class="btn btn-primary" onclick="openAddVaseModal()">🪴 Adicionar vaso</button></div>`;
    return;
  }

  container.innerHTML = '';
  myVases.forEach((vase, i) => {
    const ws = waterStatus(vase, species);
    const photos = vasePhotos(vase);
    const cover = photos.length ? photos[photos.length - 1].photo : '';
    const history = vase.history || [];

    const card = document.createElement('div');
    card.className = 'vase-card' + (animate ? ' enter' : '');
    card.style.setProperty('--i', Math.min(i, 10));
    const vid = vase.firestoreId;

    card.innerHTML = `
      <button class="vase-media" onclick="openVaseDetail('${vid}')" aria-label="Abrir detalhes de ${esc(vase.name)}">
        ${cover ? `<img src="${esc(cover)}" class="vase-img" alt="" loading="lazy" decoding="async" />` : `<div class="vase-img-icon">${esc(vase.icon || '🪴')}</div>`}
        <div class="vase-chips top">
          <span class="pill ${ws.state === 'late' || ws.state === 'due' ? 'late' : 'water'}">${ws.icon} ${esc(ws.title)}</span>
        </div>
        <div class="vase-chips bottom">
          <span></span>
          ${photos.length ? `<span class="pill">📸 ${photos.length}</span>` : ''}
        </div>
      </button>

      <div class="vase-body">
        <div class="vase-title-row">
          <div>
            <h4 onclick="openVaseDetail('${vid}')">${esc(vase.name)}</h4>
            <div class="vase-size">${esc(vase.size || 'Tamanho padrão')}</div>
          </div>
          <div class="vase-tools">
            <button class="btn-icon" onclick="editVase('${vid}')" title="Editar vaso" aria-label="Editar vaso">✏️</button>
            <button class="btn-icon danger" onclick="deleteVase('${vid}')" title="Excluir vaso" aria-label="Excluir vaso">🗑</button>
          </div>
        </div>

        <div class="water-meter s-${ws.state}">
          <div class="water-meter-top"><b>${ws.icon} ${esc(ws.title)}</b><span>${esc(ws.sub)}</span></div>
          <div class="water-track"><div class="water-fill" style="--pct:${ws.pct}%"></div></div>
        </div>

        <div class="care-dates">
          <div class="care-date"><span>💧 Rega</span><b>${fmtDate(vase.lastWater, 'Nunca')}</b></div>
          <div class="care-date"><span>🧪 Adubação</span><b>${fmtDate(vase.lastFertilizer, 'Nunca')}</b></div>
          <div class="care-date"><span>✂️ Poda</span><b>${fmtDate(vase.lastPruning, 'Nunca')}</b></div>
          <div class="care-date"><span>🪴 Transbordo</span><b>${fmtDate(vase.lastRepot, 'Não informado')}</b></div>
        </div>

        <div class="spark">
          <div class="spark-title">📊 Intervalo entre regas</div>
          ${sparklineHtml(history)}
        </div>

        <div class="quick-actions">
          <button class="quick-btn water-btn" onclick="recordCareQuick('${vid}', 'lastWater', this)"><span class="q-ico">💧</span>Regar</button>
          <button class="quick-btn" onclick="recordCareQuick('${vid}', 'lastFertilizer', this)"><span class="q-ico">🧪</span>Adubar</button>
          <button class="quick-btn" onclick="recordCareQuick('${vid}', 'lastPruning', this)"><span class="q-ico">✂️</span>Podar</button>
          <button class="quick-btn" onclick="recordCareQuick('${vid}', 'lastRepot', this)"><span class="q-ico">🪴</span>Transplantar</button>
        </div>

        <div class="vase-footer">
          <button class="btn btn-primary" style="padding:.7rem 1rem; font-size:.82rem;" onclick="openVaseDetail('${vid}')">🔍 Detalhes & galeria</button>
          <button class="btn btn-secondary" onclick="openCareLogDrawer('${vid}')" title="Registro retroativo ou lembrete" aria-label="Registro retroativo ou lembrete">⏰</button>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

// ==================== CUIDADOS ====================
const CARE_LABELS = {
  lastWater: { done: '💧 Rega registrada', verb: 'Rega' },
  lastFertilizer: { done: '🧪 Adubação registrada', verb: 'Adubação' },
  lastPruning: { done: '✂️ Poda registrada', verb: 'Poda' },
  lastRepot: { done: '🪴 Transplante registrado', verb: 'Transplante' }
};

window.recordCareQuick = async function(vaseId, careType, btn) {
  const now = new Date().toISOString();
  const vase = allVases.find(v => v.firestoreId === vaseId);
  burst(btn, careType);

  try {
    await updateDoc(doc(db, "vases", vaseId), {
      [careType]: now,
      history: arrayUnion({ type: careType, date: now, notes: "Registro rápido" })
    });
    toast(`${CARE_LABELS[careType].done}${vase ? ' · ' + vase.name : ''}`);
  } catch (err) {
    toast('Erro ao registrar ação: ' + friendlyError(err), 'error');
  }
};

// REGAR TODOS OS VASOS DAS ESPÉCIES ATUALMENTE FILTRADAS/VISÍVEIS
window.waterAllFiltered = async function() {
  const speciesIds = new Set(filteredSpecies().map(s => s.firestoreId));
  const vasesToWater = allVases.filter(v => speciesIds.has(v.speciesId));

  if (vasesToWater.length === 0) {
    toast('Nenhum vaso encontrado para regar.', 'error');
    return;
  }

  const ok = await askConfirm(`Regar ${plural(vasesToWater.length, 'vaso', 'vasos')} agora?`, { icon: '💧', okLabel: 'Regar todos' });
  if (!ok) return;

  const now = new Date().toISOString();
  try {
    await Promise.all(vasesToWater.map(v => updateDoc(doc(db, "vases", v.firestoreId), {
      lastWater: now,
      history: arrayUnion({ type: 'lastWater', date: now, notes: 'Rega em lote (Regar Todos)' })
    })));
    petalRain();
    toast(`💧 ${plural(vasesToWater.length, 'vaso regado', 'vasos regados')}!`);
  } catch (err) {
    toast('Erro ao regar vasos: ' + friendlyError(err), 'error');
  }
};

window.openCareLogDrawer = function(vaseId) {
  $('logVaseId').value = vaseId;
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $('logDate').value = now.toISOString().slice(0, 16);
  openDrawer('drawerCareLog');
};

window.saveCareLog = async function(e) {
  e.preventDefault();
  const vaseId = $('logVaseId').value;
  const actionType = $('logActionType').value;
  const dateVal = $('logDate').value;
  const notes = $('logNotes').value;

  if (!vaseId || !dateVal) return;

  const btn = $('btnSaveLog');
  btn.disabled = true;
  const isoDate = new Date(dateVal).toISOString();

  try {
    const updatePayload = { history: arrayUnion({ type: actionType, date: isoDate, notes }) };
    if (actionType !== 'lembrete' && actionType !== 'nota') {
      updatePayload[actionType] = isoDate;
    }
    await updateDoc(doc(db, "vases", vaseId), updatePayload);
    closeActiveDrawer();
    $('formCareLog').reset();
    toast('Registro salvo 🌿');
  } catch (err) {
    toast('Erro ao salvar registro: ' + friendlyError(err), 'error');
  } finally {
    btn.disabled = false;
  }
};

// ==================== DRAWERS ====================
window.openDrawer = function(id) {
  activeDrawerId = id;
  if (id === 'drawerFilters') setBurgerOpen(true);
  $(id).classList.add('active');
  document.body.classList.add('no-scroll');
};

window.closeActiveDrawer = function() {
  if (!activeDrawerId) return;
  if (activeDrawerId === 'drawerFilters') setBurgerOpen(false);
  if (activeDrawerId === 'drawerVaseDetail') currentDetailVaseId = null;
  $(activeDrawerId).classList.remove('active');
  activeDrawerId = null;
  document.body.classList.remove('no-scroll');
};

document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => { if (e.target === ov) closeActiveDrawer(); });
});

// ==================== ESPÉCIES: SALVAR / EDITAR / EXCLUIR ====================
window.openAddSpeciesModal = function() {
  $('formSpecies').reset();
  $('speciesEditId').value = '';
  $('speciesModalTitle').textContent = 'Cadastrar nova espécie';
  $('speciePhotoPreview').style.display = 'none';
  $('speciePhotoPreview').src = '';
  speciePhotoData = null;
  openDrawer('drawerAddSpecies');
};

window.editSpecies = function(firestoreId) {
  const sp = allSpecies.find(s => s.firestoreId === firestoreId);
  if (!sp) return;

  $('speciesEditId').value = sp.firestoreId;
  $('speciesModalTitle').textContent = 'Editar espécie';

  $('specieName').value = sp.name || '';
  $('specieScientific').value = sp.scientific || '';
  $('specieIcon').value = sp.icon || '🪴';
  $('fieldCategory').value = sp.category || '';
  $('fieldLight').value = sp.light || '';
  $('fieldWater').value = sp.water || '';
  $('specieWaterDays').value = sp.waterDays || '';
  $('fieldPruning').value = sp.pruning || '';
  $('fieldHumidity').value = sp.humidity || '';
  $('fieldSoil').value = sp.soil || '';
  $('fieldFertilizer').value = sp.fertilizer || '';
  $('fieldNaturalFertilizer').value = sp.naturalFertilizer || '';
  $('fieldExtraTips').value = sp.extraTips || '';
  $('fieldObservations').value = sp.observations || '';
  $('fieldPetToxicity').value = sp.petToxicity || '';
  $('fieldPetWarning').value = sp.petWarning || '';

  speciePhotoData = null;
  const preview = $('speciePhotoPreview');
  if (sp.photo) {
    preview.src = sp.photo;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
    preview.src = '';
  }

  openDrawer('drawerAddSpecies');
};

window.editCurrentSpecies = function() {
  if (currentSelectedSpecies) editSpecies(currentSelectedSpecies.firestoreId);
};

window.saveSpecies = async function(event) {
  event.preventDefault();
  const btn = $('btnSaveSpecies');
  const editId = $('speciesEditId').value;

  const speciesData = {
    name: $('specieName').value.trim(),
    scientific: $('specieScientific').value.trim(),
    icon: $('specieIcon').value || '🪴',
    category: $('fieldCategory').value.trim(),
    light: $('fieldLight').value.trim(),
    water: $('fieldWater').value.trim(),
    waterDays: Number($('specieWaterDays').value) || 5,
    pruning: $('fieldPruning').value.trim(),
    humidity: $('fieldHumidity').value.trim(),
    soil: $('fieldSoil').value.trim(),
    fertilizer: $('fieldFertilizer').value.trim(),
    naturalFertilizer: $('fieldNaturalFertilizer').value.trim(),
    extraTips: $('fieldExtraTips').value.trim(),
    observations: $('fieldObservations').value.trim(),
    petToxicity: $('fieldPetToxicity').value,
    petWarning: $('fieldPetWarning').value.trim(),
  };

  btn.disabled = true;

  try {
    if (speciePhotoData) speciesData.photo = speciePhotoData;

    if (editId) {
      await updateDoc(doc(db, "species", editId), speciesData);
    } else {
      if (!speciesData.photo) speciesData.photo = '';
      speciesData.createdAt = new Date().toISOString();
      await addDoc(speciesCol, speciesData);
    }
    $('formSpecies').reset();
    $('speciePhotoPreview').style.display = 'none';
    speciePhotoData = null;
    closeActiveDrawer();
    toast(editId ? 'Espécie atualizada 🌿' : 'Espécie cadastrada 🌱');
    if (!editId) petalRain(16);
  } catch (err) {
    toast('Erro ao salvar espécie: ' + friendlyError(err), 'error');
  } finally {
    btn.disabled = false;
  }
};

window.deleteSpecies = async function(firestoreId) {
  const sp = allSpecies.find(s => s.firestoreId === firestoreId);
  const vs = sp ? vasesOf(sp) : [];
  const extra = vs.length ? ` Os ${plural(vs.length, 'vaso', 'vasos')} desta espécie (com histórico e fotos) também serão excluídos.` : '';
  const ok = await askConfirm(`Excluir ${sp ? '“' + sp.name + '”' : 'esta espécie'}?${extra} Essa ação não pode ser desfeita.`, { icon: '🥀', okLabel: 'Excluir' });
  if (!ok) return;
  try {
    await Promise.all(vs.map(v => deleteDoc(doc(db, "vases", v.firestoreId))));
    await deleteDoc(doc(db, "species", firestoreId));
    if (currentSelectedSpecies && currentSelectedSpecies.firestoreId === firestoreId) backToSpecies();
    toast('Espécie excluída.');
  } catch (err) {
    toast('Erro ao excluir espécie: ' + friendlyError(err), 'error');
  }
};

// PREENCHIMENTO AUTOMÁTICO COM IA
window.autoFillWithAI = async function(btn) {
  const name = $('specieName').value.trim();
  if (!name) { toast('Digite o nome da planta primeiro.', 'error'); $('specieName').focus(); return; }

  btn.disabled = true;
  btn.textContent = '✨ Consultando IA…';

  try {
    const { data } = await callWorkers(
      'auto-fill-plant',
      () => { const fd = new FormData(); fd.append('plant_name', name); return { method: 'POST', body: fd }; },
      (d) => d && (d.scientific_name || d.water_days || d.light || d.soil)
    );

    $('specieScientific').value = data.scientific_name || '';
    $('fieldCategory').value = data.category || '';
    $('fieldLight').value = data.light || '';
    $('fieldWater').value = data.water || '';
    $('specieWaterDays').value = data.water_days || 5;
    $('fieldPruning').value = data.pruning || '';
    $('fieldHumidity').value = data.humidity || '';
    $('fieldSoil').value = data.soil || '';
    $('fieldFertilizer').value = data.fertilizer || '';
    $('fieldNaturalFertilizer').value = data.natural_fertilizer || '';
    $('fieldExtraTips').value = data.extra_tips || '';
    $('fieldObservations').value = data.observations || '';

    const validLevels = ['Segura', 'Tóxica', 'Letal'];
    $('fieldPetToxicity').value = validLevels.includes(data.pet_toxicity) ? data.pet_toxicity : '';
    $('fieldPetWarning').value = data.pet_warning || '';
    toast('Ficha preenchida pela IA ✨');
  } catch (err) {
    toast('Erro ao consultar IA: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Preencher ficha com IA';
  }
};

// ==================== VASOS: CADASTRAR / EDITAR / EXCLUIR ====================
window.openAddVaseModal = function() {
  $('formVase').reset();
  $('vaseEditId').value = '';
  $('vaseModalTitle').textContent = 'Cadastrar novo vaso';
  $('vasePhotoPreview').style.display = 'none';
  $('vasePhotoPreview').src = '';
  vasePhotoData = null;
  openDrawer('drawerAddVase');
};

window.editVase = function(vaseId) {
  const vase = allVases.find(v => v.firestoreId === vaseId);
  if (!vase) return;

  $('vaseEditId').value = vase.firestoreId;
  $('vaseModalTitle').textContent = 'Editar vaso';

  $('vaseName').value = vase.name || '';
  $('vaseIcon').value = vase.icon || '🪴';
  $('vaseSize').value = vase.size || '';
  $('vaseRepotDate').value = vase.lastRepot ? vase.lastRepot.slice(0, 10) : '';

  vasePhotoData = null;
  const preview = $('vasePhotoPreview');
  const cover = vaseCover(vase);
  if (cover) {
    preview.src = cover;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
    preview.src = '';
  }

  openDrawer('drawerAddVase');
};

window.saveVase = async function(event) {
  event.preventDefault();
  if (!currentSelectedSpecies) { toast('Selecione uma espécie primeiro.', 'error'); return; }

  const btn = $('btnSaveVase');
  const editId = $('vaseEditId').value;
  const name = $('vaseName').value.trim();
  const icon = $('vaseIcon').value || '🪴';
  const size = $('vaseSize').value.trim();
  const repotDate = $('vaseRepotDate').value;

  btn.disabled = true;

  try {
    if (editId) {
      const vase = allVases.find(v => v.firestoreId === editId);
      const updatePayload = { name, size, icon };

      if (vasePhotoData && vase) {
        if (docBytes(vase) + vasePhotoData.length > DOC_SAFE_BYTES) {
          throw new Error('Este vaso já está com a galeria cheia. Exclua fotos antigas antes de adicionar novas.');
        }
        Object.assign(updatePayload, buildPhotoAddPayload(vase, vasePhotoData));
      }

      if (repotDate) updatePayload.lastRepot = new Date(repotDate).toISOString();

      await updateDoc(doc(db, "vases", editId), updatePayload);
    } else {
      const now = new Date().toISOString();
      const vaseData = {
        speciesId: currentSelectedSpecies.firestoreId,
        name,
        icon,
        size,
        photo: '', // a capa é sempre a foto mais recente de photoHistory
        photoHistory: vasePhotoData ? [{ photo: vasePhotoData, date: now }] : [],
        history: [],
        createdAt: now
      };

      if (repotDate) {
        const repotIso = new Date(repotDate).toISOString();
        vaseData.lastRepot = repotIso;
        vaseData.history = [{ type: 'lastRepot', date: repotIso }];
      }

      await addDoc(vasesCol, vaseData);
    }

    $('formVase').reset();
    $('vasePhotoPreview').style.display = 'none';
    vasePhotoData = null;
    closeActiveDrawer();
    toast(editId ? 'Vaso atualizado 🪴' : 'Vaso cadastrado 🪴');
  } catch (err) {
    toast('Erro ao salvar vaso: ' + friendlyError(err), 'error');
  } finally {
    btn.disabled = false;
  }
};

window.deleteVase = async function(firestoreId) {
  const vase = allVases.find(v => v.firestoreId === firestoreId);
  const ok = await askConfirm(`Excluir ${vase ? '“' + vase.name + '”' : 'este vaso'} com todo o histórico e fotos? Essa ação não pode ser desfeita.`, { icon: '🥀', okLabel: 'Excluir' });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "vases", firestoreId));
    toast('Vaso excluído.');
  } catch (err) {
    toast('Erro ao excluir vaso: ' + friendlyError(err), 'error');
  }
};

// ==================== DETALHES DO VASO: HISTÓRICO & GALERIA ====================
window.openVaseDetail = function(vaseId) {
  currentDetailVaseId = vaseId;
  renderVaseDetail(vaseId);
  openDrawer('drawerVaseDetail');
};

function renderVaseDetail(vaseId) {
  const vase = allVases.find(v => v.firestoreId === vaseId);
  if (!vase) return;

  $('vaseDetailName').textContent = vase.name;

  const photos = vasePhotos(vase);
  const hero = $('vaseDetailHero');
  if (photos.length) {
    hero.disabled = false;
    hero.innerHTML = `<img src="${esc(photos[photos.length - 1].photo)}" alt="Foto mais recente de ${esc(vase.name)}" /><span class="pill hint">🔍 Ampliar${photos.length > 1 ? ' · ' + photos.length + ' fotos' : ''}</span>`;
  } else {
    hero.disabled = true;
    hero.innerHTML = `<div class="hero-ph">${esc(vase.icon || '🌱')}</div>`;
  }

  const history = vase.history || [];

  // ----- Frequência de cuidados -----
  const CARE_TYPES = [
    { key: 'lastWater', label: '💧 Rega' },
    { key: 'lastFertilizer', label: '🧪 Adubação' },
    { key: 'lastPruning', label: '✂️ Poda' },
    { key: 'lastRepot', label: '🪴 Transbordo' }
  ];

  $('vaseDetailStats').innerHTML = CARE_TYPES.map(ct => {
    const events = history.filter(h => h.type === ct.key).map(h => new Date(h.date)).filter(d => !isNaN(d)).sort((a, b) => a - b);
    let freqText = 'Mínimo de 2 registros necessário';
    if (events.length >= 2) {
      let total = 0;
      for (let i = 1; i < events.length; i++) total += (events[i] - events[i - 1]) / DAY_MS;
      freqText = `Média: a cada ${(total / (events.length - 1)).toFixed(1).replace('.', ',')} dias`;
    }
    return `<div class="stat-mini"><div class="t">${ct.label}</div><div class="d">Última: ${fmtDate(vase[ct.key], 'nunca registrada')}</div><div class="f">${freqText}</div></div>`;
  }).join('');

  // ----- Histórico -----
  const typeLabels = { lastWater: '💧 Regou', lastFertilizer: '🧪 Adubou', lastPruning: '✂️ Podou', lastRepot: '🪴 Transbordou', lembrete: '⏰ Lembrete', nota: '📝 Nota' };
  const sortedHistory = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
  $('vaseDetailHistory').innerHTML = sortedHistory.length === 0
    ? '<p class="muted">Nenhum registro de cuidado ainda.</p>'
    : sortedHistory.map(h => {
        const d = new Date(h.date);
        return `<div class="timeline-item">
          <span class="timeline-date">${d.toLocaleDateString('pt-BR')} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          <div><b>${typeLabels[h.type] || esc(h.type)}</b> — ${esc(h.notes || 'Sem observação')}</div>
        </div>`;
      }).join('');

  // ----- Galeria clicável -----
  const used = docBytes(vase);
  const pct = Math.min(100, Math.round(used / DOC_LIMIT_BYTES * 100));
  const meter = $('galleryMeter');
  meter.style.setProperty('--pct', pct + '%');
  meter.classList.toggle('full', pct >= 85);
  $('galleryNote').textContent = photos.length
    ? `${plural(photos.length, 'foto', 'fotos')} · ${pct}% do espaço deste vaso usado${pct >= 85 ? ' — exclua fotos antigas para adicionar novas' : ''}`
    : 'Adicione a primeira foto para começar a acompanhar a evolução.';
  $('btnPlayEvolution').disabled = photos.length < 2;

  const galleryEl = $('vaseDetailGallery');
  if (photos.length === 0) {
    galleryEl.innerHTML = '<p class="muted" style="grid-column:1/-1;">Nenhuma foto na galeria ainda. 📷</p>';
  } else {
    galleryEl.innerHTML = photos.map((g, i) => `
      <button class="gallery-thumb${i === photos.length - 1 ? ' latest' : ''}" onclick="openLightbox('${vaseId}', ${i})" aria-label="Ampliar foto ${i + 1} de ${photos.length}">
        <img src="${esc(g.photo)}" alt="" loading="lazy" decoding="async" />
        <span class="g-num">${i === photos.length - 1 && photos.length > 1 ? 'Atual' : '#' + (i + 1)}</span>
        <span class="g-date">${fmtDate(g.date)}</span>
      </button>`).join('');
  }
}

window.addGalleryPhoto = async function(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentDetailVaseId) return;
  const vase = allVases.find(v => v.firestoreId === currentDetailVaseId);
  if (!vase) return;

  try {
    const photoBase64 = await compressImage(file, GALLERY_OPTS);
    if (docBytes(vase) + photoBase64.length > DOC_SAFE_BYTES) {
      toast('A galeria deste vaso está cheia. Exclua fotos antigas para adicionar novas.', 'error');
      return;
    }
    await updateDoc(doc(db, "vases", currentDetailVaseId), buildPhotoAddPayload(vase, photoBase64));
    toast('Foto adicionada à galeria 📸');
  } catch (err) {
    toast('Erro ao adicionar foto: ' + friendlyError(err), 'error');
  }
};

// ==================== LIGHTBOX / CARROSSEL ====================
// Duas fontes de fotos: a evolução de UM vaso (source.type = 'vase') ou a galeria geral com as
// fotos de TODOS os vasos (source.type = 'gallery', respeita os filtros da tela de galeria).
const lb = { open: false, source: null, items: [], index: 0, playing: false, timer: null, zoomed: false, tx: 0, ty: 0, lastFocus: null };
const ZOOM_SCALE = 2.4;
const PLAY_MS = 1800;

const photoKey = (it) => `${it.vaseId}|${it.date}|${it.photo.length}`;

function vasePhotoItems(vase) {
  const sp = speciesOfVase(vase);
  return vasePhotos(vase).map(p => ({ ...p, vaseId: vase.firestoreId, vaseName: vase.name, speciesName: sp ? sp.name : '' }));
}

function lbBuildItems() {
  if (!lb.source) return [];
  if (lb.source.type === 'gallery') return galleryItems();
  const vase = allVases.find(v => v.firestoreId === lb.source.vaseId);
  return vase ? vasePhotoItems(vase) : [];
}

function lbStart(source, index) {
  lb.source = source;
  const items = lbBuildItems();
  if (!items.length) return false;
  lb.items = items;
  lb.index = Math.max(0, Math.min(index, items.length - 1));
  if (!lb.open) {
    lb.lastFocus = document.activeElement;
    lb.open = true;
    $('lightbox').classList.add('open');
    document.body.classList.add('no-scroll');
    history.pushState({ v: 'lightbox' }, '');
  }
  lbBuildThumbs();
  lbRender(null);
  $('lbPlay').style.visibility = items.length > 1 ? 'visible' : 'hidden';
  $('lbVaseBtn').style.display = source.type === 'gallery' ? '' : 'none';
  return true;
}

window.openLightbox = function(vaseId, index = 0) { lbStart({ type: 'vase', vaseId }, index); };

window.openGalleryLightbox = function(index = 0) { lbStart({ type: 'gallery' }, index); };

window.openLightboxLatest = function() {
  if (!currentDetailVaseId) return;
  const vase = allVases.find(v => v.firestoreId === currentDetailVaseId);
  if (vase) openLightbox(currentDetailVaseId, vasePhotos(vase).length - 1);
};

window.openLightboxEvolution = function() {
  if (!currentDetailVaseId) return;
  openLightbox(currentDetailVaseId, 0);
  if (lb.items.length > 1) lbTogglePlay(true);
};

// De dentro da galeria geral, pula para a evolução do vaso da foto atual
window.lbShowVaseEvolution = function() {
  const it = lb.items[lb.index];
  if (!it) return;
  lbStopPlay();
  const vase = allVases.find(v => v.firestoreId === it.vaseId);
  if (!vase) return;
  const photos = vasePhotoItems(vase);
  const idx = Math.max(0, photos.findIndex(p => photoKey(p) === photoKey(it)));
  lbStart({ type: 'vase', vaseId: it.vaseId }, idx);
  toast(`Evolução de ${vase.name}`);
};

window.closeLightbox = function(fromPopstate = false) {
  if (!lb.open) return;
  lbStopPlay();
  lb.open = false;
  lb.zoomed = false;
  $('lightbox').classList.remove('open');
  if (!activeDrawerId) document.body.classList.remove('no-scroll');
  if (!fromPopstate && history.state && history.state.v === 'lightbox') history.back();
  if (lb.lastFocus && lb.lastFocus.focus) { try { lb.lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignora */ } }
};

function lbBuildThumbs() {
  const box = $('lbThumbs');
  box.innerHTML = lb.items.map((it, i) =>
    `<button class="lb-thumb" data-i="${i}" aria-label="Ir para a foto ${i + 1}"><img src="${esc(it.photo)}" alt="" loading="lazy" /></button>`).join('');
  box.style.display = lb.items.length > 1 ? '' : 'none';
  box.querySelectorAll('.lb-thumb').forEach(b => {
    b.addEventListener('click', () => lbGo(Number(b.dataset.i), true));
  });
}

function lbRender(direction) {
  const it = lb.items[lb.index];
  if (!it) return;
  const n = lb.items.length;
  const img = $('lbImg');
  const gallery = lb.source && lb.source.type === 'gallery';

  img.classList.remove('in-next', 'in-prev', 'dragging');
  img.style.transform = '';
  lb.zoomed = false; lb.tx = 0; lb.ty = 0;
  $('lbStage').classList.remove('zoomed');
  $('lbZoom').classList.remove('on');
  img.src = it.photo;
  if (direction) { void img.offsetWidth; img.classList.add(direction === 'next' ? 'in-next' : 'in-prev'); }

  $('lbBg').style.backgroundImage = `url("${it.photo}")`;
  $('lbVase').textContent = it.vaseName;
  $('lbCounter').textContent = `Foto ${lb.index + 1} de ${n}` + (gallery && it.speciesName ? ` · ${it.speciesName}` : '');

  const d = new Date(it.date);
  $('lbDate').textContent = isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  // O "tempo de crescimento" sempre conta a partir da primeira foto DO MESMO vaso
  const vase = allVases.find(v => v.firestoreId === it.vaseId);
  const own = vase ? vasePhotos(vase) : [];
  const first = own.length ? new Date(own[0].date) : d;
  const chip = $('lbChip');
  if (own.length <= 1) { chip.textContent = '📸 Única foto deste vaso'; chip.className = 'chipd'; }
  else if (own[0].date === it.date && own[0].photo === it.photo) { chip.textContent = '🌱 Início da jornada'; chip.className = 'chipd'; }
  else {
    const days = Math.max(0, daysBetween(first, d));
    chip.textContent = days === 0 ? '🌿 No mesmo dia da 1ª foto' : `🌿 +${plural(days, 'dia', 'dias')} de crescimento`;
    chip.className = 'chipd grow';
  }

  $('lbPrev').disabled = lb.index === 0;
  $('lbNext').disabled = lb.index === n - 1;

  const dl = $('lbDownload');
  const slug = (it.vaseName || 'planta').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  dl.href = it.photo;
  dl.download = `${slug}-${isNaN(d) ? 'foto' : d.toISOString().slice(0, 10)}.jpg`;

  $('lbThumbs').querySelectorAll('.lb-thumb').forEach((b, i) => {
    const active = i === lb.index;
    b.classList.toggle('active', active);
    if (active && b.scrollIntoView) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: direction ? 'smooth' : 'auto' });
  });

  // Pré-carrega as vizinhas
  [lb.index - 1, lb.index + 1].forEach(i => { if (lb.items[i]) { const p = new Image(); p.src = lb.items[i].photo; } });

  lbRestartProgress();
}

function lbRestartProgress() {
  const bar = $('lbProgress');
  bar.classList.remove('run');
  if (lb.playing) {
    bar.style.setProperty('--play', PLAY_MS + 'ms');
    void bar.offsetWidth;
    bar.classList.add('run');
  }
}

function lbGo(i, manual = false) {
  if (i < 0 || i >= lb.items.length || i === lb.index) return;
  if (manual) lbStopPlay();
  const dir = i > lb.index ? 'next' : 'prev';
  lb.index = i;
  lbRender(dir);
}

window.lbPrev = function() { lbGo(lb.index - 1, true); };
window.lbNext = function() { lbGo(lb.index + 1, true); };

function lbStopPlay() {
  lb.playing = false;
  clearInterval(lb.timer);
  lb.timer = null;
  const btn = $('lbPlay');
  btn.textContent = '▶';
  btn.classList.remove('on');
  $('lbProgress').classList.remove('run');
}

window.lbTogglePlay = function(forceOn) {
  if (lb.items.length < 2) return;
  if (lb.playing && forceOn !== true) { lbStopPlay(); return; }
  lb.playing = true;
  const btn = $('lbPlay');
  btn.textContent = '⏸';
  btn.classList.add('on');
  clearInterval(lb.timer);
  lb.timer = setInterval(() => {
    const next = (lb.index + 1) % lb.items.length;
    lb.index = next;
    lbRender(next === 0 ? 'prev' : 'next');
  }, PLAY_MS);
  lbRestartProgress();
};

function lbApplyTransform(animated = true) {
  const img = $('lbImg');
  img.classList.toggle('dragging', !animated);
  img.style.transform = lb.zoomed ? `translate(${lb.tx}px, ${lb.ty}px) scale(${ZOOM_SCALE})` : '';
  $('lbStage').classList.toggle('zoomed', lb.zoomed);
  $('lbZoom').classList.toggle('on', lb.zoomed);
}

window.lbToggleZoom = function(pt) {
  const img = $('lbImg');
  if (!lb.zoomed) {
    lbStopPlay();
    const r = img.getBoundingClientRect();
    if (pt && typeof pt.x === 'number') {
      lb.tx = -(pt.x - (r.left + r.width / 2)) * (ZOOM_SCALE - 1);
      lb.ty = -(pt.y - (r.top + r.height / 2)) * (ZOOM_SCALE - 1);
    } else { lb.tx = 0; lb.ty = 0; }
  } else { lb.tx = 0; lb.ty = 0; }
  lb.zoomed = !lb.zoomed;
  lbApplyTransform(true);
};

window.lbDelete = async function() {
  const it = lb.items[lb.index];
  if (!it) return;
  lbStopPlay();
  const ok = await askConfirm(`Excluir esta foto de “${it.vaseName}”? Essa ação não pode ser desfeita.`, { icon: '🗑', okLabel: 'Excluir foto' });
  if (!ok) return;
  try {
    const ref = doc(db, "vases", it.vaseId);
    if (it.legacy) await updateDoc(ref, { photo: '' });
    else await updateDoc(ref, { photoHistory: arrayRemove(it.raw) });
    toast('Foto excluída.');
  } catch (err) {
    toast('Erro ao excluir foto: ' + friendlyError(err), 'error');
  }
};

// Atualiza o carrossel se os dados mudarem enquanto ele está aberto (outra aba, exclusão, nova foto…)
function lbRefreshData() {
  if (!lb.open) return;
  const items = lbBuildItems();
  if (!items.length) { closeLightbox(); return; }

  const same = items.length === lb.items.length && items.every((it, i) => photoKey(it) === photoKey(lb.items[i]));
  if (same) return;

  const currentKey = lb.items[lb.index] ? photoKey(lb.items[lb.index]) : null;
  let idx = items.findIndex(it => photoKey(it) === currentKey);
  if (idx < 0) idx = Math.min(lb.index, items.length - 1);
  lb.items = items;
  lb.index = idx;
  if (items.length < 2) lbStopPlay();
  $('lbPlay').style.visibility = items.length > 1 ? 'visible' : 'hidden';
  lbBuildThumbs();
  lbRender(null);
}

// Gestos: arrastar para trocar de foto, toque duplo para zoom, arrastar com zoom para mover
(function initLightboxGestures() {
  const stage = $('lbStage');
  const img = $('lbImg');
  let drag = null;
  let lastTap = 0;

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, tx: lb.tx, ty: lb.ty, moved: false, id: e.pointerId };
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) drag.moved = true;
    if (lb.zoomed) {
      lb.tx = drag.tx + dx;
      lb.ty = drag.ty + dy;
      lbApplyTransform(false);
    } else if (drag.moved) {
      img.classList.add('dragging');
      img.style.transform = `translateX(${dx}px) rotate(${dx / 60}deg)`;
    }
  });

  const end = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const wasMoved = drag.moved;
    drag = null;
    if (lb.zoomed) { lbApplyTransform(true); return; }
    img.classList.remove('dragging');

    if (wasMoved && Math.abs(dx) > 60) {
      img.style.transform = '';
      if (dx < 0) lbNext(); else lbPrev();
      return;
    }
    img.style.transform = '';

    if (!wasMoved) {
      const now = Date.now();
      if (now - lastTap < 320) { lastTap = 0; lbToggleZoom({ x: e.clientX, y: e.clientY }); }
      else lastTap = now;
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', () => { drag = null; img.classList.remove('dragging'); img.style.transform = lb.zoomed ? img.style.transform : ''; });
})();

// Teclado global: setas, espaço, Home/End, Esc
document.addEventListener('keydown', (e) => {
  if (lb.open) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); lbPrev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbNext(); }
    else if (e.key === 'Home') { e.preventDefault(); lbGo(0, true); }
    else if (e.key === 'End') { e.preventDefault(); lbGo(lb.items.length - 1, true); }
    else if (e.key === ' ') { e.preventDefault(); lbTogglePlay(); }
    else if (e.key === 'z' || e.key === 'Z') { lbToggleZoom(); }
    return;
  }
  if (e.key === 'Escape' && activeDrawerId) closeActiveDrawer();
});

// ==================== GALERIA GERAL ====================
const gal = { view: 'photos', species: 'all', sort: 'new' };

// Fotos de todos os vasos (respeitando o filtro de espécie), já ordenadas — é também a fonte do carrossel geral.
function galleryItems() {
  const items = [];
  allVases.forEach(v => {
    if (gal.species !== 'all' && v.speciesId !== gal.species) return;
    items.push(...vasePhotoItems(v));
  });
  const t = (x) => { const n = new Date(x.date).getTime(); return isNaN(n) ? 0 : n; };
  items.sort((a, b) => gal.sort === 'old' ? t(a) - t(b) : t(b) - t(a));
  return items;
}

function refreshGalleryIfVisible() {
  const sec = $('sec-gallery');
  if (sec && sec.classList.contains('is-active')) renderGallery();
}

window.setGalleryView = function(view) { gal.view = view; renderGallery({ animate: true }); };
window.setGalleryFilter = function(id) { gal.species = id; renderGallery({ animate: true }); };
window.setGallerySort = function(value) { gal.sort = value; renderGallery({ animate: true }); };

window.openVaseFromGallery = function(vaseId) {
  const vase = allVases.find(v => v.firestoreId === vaseId);
  const sp = vase && speciesOfVase(vase);
  if (!sp) return;
  setNavActive('species');
  openSpeciesDetail(sp, { fromUser: true });
  openVaseDetail(vaseId);
};

function monthLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { key: 'sem-data', label: 'Sem data' };
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

function renderGallery({ animate = false } = {}) {
  const content = $('galContent');
  if (!content) return;

  if (!speciesLoaded || !vasesLoaded) {
    content.innerHTML = '<div class="g-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    return;
  }

  // Contagem de fotos por espécie (para os filtros)
  const counts = {};
  let totalPhotos = 0, vasesWithPhotos = 0;
  allVases.forEach(v => {
    const n = vasePhotos(v).length;
    if (!n) return;
    vasesWithPhotos++; totalPhotos += n;
    counts[v.speciesId] = (counts[v.speciesId] || 0) + n;
  });
  const speciesWithPhotos = allSpecies.filter(sp => counts[sp.firestoreId]).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (gal.species !== 'all' && !counts[gal.species]) gal.species = 'all';

  // Controles
  document.querySelectorAll('[data-gview]').forEach(b => b.classList.toggle('active', b.dataset.gview === gal.view));
  $('galSortWrap').style.display = gal.view === 'photos' ? '' : 'none';
  $('galSort').value = gal.sort;
  $('galChips').innerHTML =
    `<button class="chip btn-chip ${gal.species === 'all' ? 'active' : ''}" onclick="setGalleryFilter('all')">🌿 Todas · ${totalPhotos}</button>` +
    speciesWithPhotos.map(sp => `<button class="chip btn-chip ${gal.species === sp.firestoreId ? 'active' : ''}" onclick="setGalleryFilter('${sp.firestoreId}')">${esc(sp.icon || '🪴')} ${esc(sp.name)} · ${counts[sp.firestoreId]}</button>`).join('');

  const shownVases = allVases.filter(v => (gal.species === 'all' || v.speciesId === gal.species) && vasePhotos(v).length);
  const shownPhotos = gal.species === 'all' ? totalPhotos : counts[gal.species] || 0;
  $('galStats').textContent = totalPhotos
    ? `${plural(shownPhotos, 'foto', 'fotos')} · ${plural(shownVases.length, 'vaso', 'vasos')}${allVases.length > vasesWithPhotos ? ` · ${plural(allVases.length - vasesWithPhotos, 'vaso sem foto', 'vasos sem foto')}` : ''}`
    : '';

  if (!totalPhotos) {
    content.innerHTML = `<div class="empty-state">${emptyPlantSvg()}<h4>Nenhuma foto por aqui ainda</h4><p>Fotografe seus vasos para acompanhar o crescimento. Elas aparecem aqui automaticamente.</p><button class="btn btn-primary" onclick="switchTab('species')">🌱 Ir para as espécies</button></div>`;
    return;
  }

  const enter = animate ? ' enter' : '';

  if (gal.view === 'vases') {
    const sorted = [...shownVases].sort((a, b) => {
      const sa = (speciesOfVase(a) || {}).name || '', sb = (speciesOfVase(b) || {}).name || '';
      return sa.localeCompare(sb, 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR');
    });
    content.innerHTML = `<div class="g-vases">${sorted.map((v, i) => {
      const photos = vasePhotos(v);
      const sp = speciesOfVase(v);
      const first = new Date(photos[0].date), last = new Date(photos[photos.length - 1].date);
      const span = Math.max(0, daysBetween(first, last));
      const range = photos.length > 1
        ? `${fmtDate(photos[0].date)} → ${fmtDate(photos[photos.length - 1].date)} · ${plural(span, 'dia', 'dias')} de evolução`
        : `Foto de ${fmtDate(photos[0].date)}`;
      return `<article class="g-vase${enter}" style="--i:${Math.min(i, 14)}">
        <button class="g-vase-cover" onclick="openLightbox('${v.firestoreId}', ${photos.length - 1})" aria-label="Ver fotos de ${esc(v.name)}">
          <img src="${esc(photos[photos.length - 1].photo)}" alt="" loading="lazy" decoding="async" />
          <span class="pill hint">📸 ${photos.length}</span>
        </button>
        <div class="g-vase-body">
          <h4>${esc(v.name)}</h4>
          <p class="g-sp">${esc(sp ? sp.name : '')}</p>
          <p class="g-range">${esc(range)}</p>
          <div class="g-vase-actions">
            <button class="btn btn-secondary" ${photos.length < 2 ? 'disabled' : ''} onclick="openLightbox('${v.firestoreId}', 0); lbTogglePlay(true)">▶ Evolução</button>
            <button class="btn btn-ghost" onclick="openVaseFromGallery('${v.firestoreId}')">Abrir vaso →</button>
          </div>
        </div>
      </article>`;
    }).join('')}</div>`;
    return;
  }

  // Visão "Fotos": agrupadas por mês, na ordem escolhida
  const items = galleryItems();
  const groups = [];
  items.forEach((it, i) => {
    const m = monthLabel(it.date);
    let g = groups[groups.length - 1];
    if (!g || g.key !== m.key) { g = { key: m.key, label: m.label, items: [] }; groups.push(g); }
    g.items.push({ it, i });
  });

  content.innerHTML = groups.map(g => `
    <section class="g-month">
      <h4 class="g-month-title">${esc(g.label)} <span class="count">${g.items.length}</span></h4>
      <div class="g-grid">
        ${g.items.map(({ it, i }, k) => `
          <button class="g-tile${k === 0 && g.items.length >= 5 ? ' big' : ''}${enter}" style="--i:${Math.min(i, 24)}" onclick="openGalleryLightbox(${i})" aria-label="Ampliar foto de ${esc(it.vaseName)} em ${fmtDate(it.date)}">
            <img src="${esc(it.photo)}" alt="" loading="lazy" decoding="async" />
            <span class="g-when">${fmtDate(it.date)}</span>
            <span class="g-over"><b>${esc(it.vaseName)}</b><i>${esc(it.speciesName)}</i></span>
          </button>`).join('')}
      </div>
    </section>`).join('');
}

// ==================== IA: DIAGNÓSTICO E IDENTIFICAÇÃO ====================
let aiMode = 'diagnose'; // diagnose | identify
let aiBusy = false;
let lastIdentify = null;

const AI_TEXT = {
  diagnose: {
    title: 'Diagnóstico de saúde 🩺',
    sub: 'Envie uma foto para a IA analisar pragas, doenças ou deficiências',
    btn: '🔍 Analisar com IA',
    placeholder: 'O relatório aparecerá aqui depois da análise.',
    tip: 'Dica: mostre bem a parte afetada (folhas manchadas, pontas secas, pragas) com boa luz.'
  },
  identify: {
    title: 'Qual planta é essa? 🔎',
    sub: 'Envie uma foto e a IA descobre a espécie para você',
    btn: '🔎 Identificar planta',
    placeholder: 'A espécie identificada aparecerá aqui.',
    tip: 'Dica: fotografe de perto, com boa luz, mostrando as folhas e, se tiver, flores ou frutos.'
  }
};

window.setAiMode = function(mode) {
  if (aiBusy) return;
  aiMode = mode;
  const t = AI_TEXT[mode];
  $('aiTitle').textContent = t.title;
  $('aiSubtitle').textContent = t.sub;
  $('aiRunBtn').textContent = t.btn;
  $('aiPlaceholderText').textContent = t.placeholder;
  $('aiTip').textContent = t.tip;
  document.querySelectorAll('[data-aimode]').forEach(b => b.classList.toggle('active', b.dataset.aimode === mode));
  $('aiResult').classList.remove('show');
  $('aiPlaceholder').style.display = '';
};

function aiLoading() {
  const resultEl = $('aiResult');
  $('aiPlaceholder').style.display = 'none';
  resultEl.classList.add('show');
  resultEl.innerHTML = '<div class="loader"><i></i><i></i><i></i> <span id="aiLoadMsg">Analisando a foto com IA, aguarde…</span></div>';
  return (w, i) => {
    const el = $('aiLoadMsg');
    if (el && i > 0) el.textContent = `Tentando outra conta de IA (${i + 1} de ${WORKERS.length})…`;
  };
}

function aiFailure(err) {
  const det = err.details && err.details.length
    ? `<details class="ai-details"><summary>Ver detalhes técnicos</summary><ul>${err.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul></details>` : '';
  $('aiResult').innerHTML = `<h4>😕 Não foi possível concluir</h4><p>${esc(err.message)}</p>${det}`;
}

window.runAI = async function() {
  if (aiBusy) return;
  if (!aiImageData) { toast('Selecione ou tire uma foto da planta primeiro.', 'error'); return; }

  aiBusy = true;
  const btn = $('aiRunBtn');
  btn.disabled = true;
  const onAttempt = aiLoading();
  const buildOptions = () => {
    const fd = new FormData();
    fd.append('file', dataURLToBlob(aiImageData), 'planta.jpg');
    return { method: 'POST', body: fd };
  };

  try {
    if (aiMode === 'identify') await runIdentify(buildOptions, onAttempt);
    else await runDiagnosis(buildOptions, onAttempt);
  } catch (err) {
    aiFailure(err);
  } finally {
    aiBusy = false;
    btn.disabled = false;
  }
};

async function runDiagnosis(buildOptions, onAttempt) {
  const { data, worker } = await callWorkers('diagnose-plant', buildOptions, (d) => d && typeof d.diagnosis === 'string' && d.diagnosis.trim(), onAttempt);
  const moon = data.moon_phase
    ? `<div class="ai-moon">🌙 Fase da lua: <b>${esc(data.moon_phase)}</b>${data.moon_tip ? ' — ' + esc(data.moon_tip) : ''}</div>` : '';
  $('aiResult').innerHTML = `
    <h4>🩺 Relatório agronômico</h4>
    <div class="ai-text">${esc(data.diagnosis)}</div>
    ${moon}
    <div class="ai-via">via ${esc(worker)}</div>`;
}

// ---------- Identificação ----------
function normText(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

function looseSame(a, b) {
  if (!a || !b) return false;
  return a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
}

function findSpeciesMatch(c) {
  const wanted = [normText(c.name), normText(c.scientific_name)].filter(Boolean);
  return allSpecies.find(sp => {
    const names = [sp.name, ...String(sp.scientific || '').split(/[,;/]/)].map(normText).filter(Boolean);
    return wanted.some(w => names.some(n => looseSame(w, n)));
  });
}

function confidencePct(c) {
  if (typeof c === 'number') return Math.round(Math.max(0, Math.min(100, c <= 1 ? c * 100 : c)));
  const n = parseFloat(String(c || '').replace(',', '.'));
  if (!isNaN(n)) return confidencePct(n);
  const t = normText(c);
  if (t.startsWith('alta')) return 88;
  if (t.startsWith('med')) return 62;
  if (t.startsWith('baix')) return 35;
  return null;
}

function normalizeIdentify(d) {
  const main = {
    name: d.name || d.common_name || d.plant_name || '',
    scientific_name: d.scientific_name || d.scientific || '',
    description: d.description || d.summary || '',
    water_days: Number(d.water_days) || null,
    light: d.light || '',
    pet_toxicity: ['Segura', 'Tóxica', 'Letal'].includes(d.pet_toxicity) ? d.pet_toxicity : '',
    confidence: confidencePct(d.confidence)
  };
  const alts = (Array.isArray(d.alternatives) ? d.alternatives : [])
    .map(a => typeof a === 'string' ? { name: a } : { name: a.name || a.common_name || '', scientific_name: a.scientific_name || '' })
    .filter(a => a.name).slice(0, 3);
  return { is_plant: d.is_plant !== false, main, alts };
}

async function runIdentify(buildOptions, onAttempt) {
  const { data, worker } = await callWorkers('identify-plant', buildOptions,
    (d) => d && (d.is_plant === false || d.name || d.common_name || d.plant_name), onAttempt);
  lastIdentify = { ...normalizeIdentify(data), worker };
  renderIdentify();
}

function renderIdentify() {
  const el = $('aiResult');
  const r = lastIdentify;
  if (!r) return;

  if (!r.is_plant) {
    el.innerHTML = `<h4>🤔 Não encontrei uma planta nessa foto</h4>
      <p>Tente outra imagem, mais de perto e com boa luz, mostrando folhas ou flores.</p>
      <div class="ai-via">via ${esc(r.worker)}</div>`;
    return;
  }

  const c = r.main;
  const match = findSpeciesMatch(c);
  const pct = c.confidence;
  const level = pct === null ? 'mid' : pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low';

  const tags = [];
  if (c.water_days) tags.push(`<span class="id-tag">💧 a cada ${c.water_days} dias</span>`);
  if (c.light) tags.push(`<span class="id-tag">☀️ ${esc(c.light)}</span>`);
  if (c.pet_toxicity) tags.push(`<span class="id-tag">${petToxicityIcon(c.pet_toxicity)} Pets: ${esc(c.pet_toxicity)}</span>`);

  const alts = r.alts.length ? `
    <div class="id-alts"><span>Pode ser também (toque para ver):</span>
      ${r.alts.map((a, i) => `<button class="chip btn-chip" onclick="pickIdentification(${i})">${esc(a.name)}</button>`).join('')}
    </div>` : '';

  el.innerHTML = `
    <div class="id-card">
      <div class="id-head">
        <div class="id-badge" aria-hidden="true">🌿</div>
        <div>
          <span class="id-eyebrow">Parece ser</span>
          <h4>${esc(c.name)}</h4>
          ${c.scientific_name ? `<p class="id-sci">${esc(c.scientific_name)}</p>` : ''}
        </div>
      </div>
      ${pct !== null ? `
      <div class="conf ${level}">
        <div class="conf-top"><b>Confiança</b><span>${pct}%</span></div>
        <div class="conf-track"><i style="--pct:${pct}%"></i></div>
        ${level === 'low' ? '<small>Confiança baixa — tente outra foto com mais detalhes de folhas, flores ou frutos.</small>' : ''}
      </div>` : ''}
      ${c.description ? `<p class="id-desc">${esc(c.description)}</p>` : ''}
      ${tags.length ? `<div class="id-tags">${tags.join('')}</div>` : ''}
      ${alts}
      ${match ? `<div class="id-owned">✅ Você já tem esta espécie cadastrada: <b>${esc(match.name)}</b></div>` : ''}
      <div class="id-actions">
        ${match
          ? `<button class="btn btn-primary" onclick="openMatchedSpecies('${match.firestoreId}')">🌱 Abrir ${esc(match.name)}</button>
             <button class="btn btn-secondary" onclick="registerFromIdentification()">➕ Cadastrar outra</button>`
          : `<button class="btn btn-primary" onclick="registerFromIdentification()">➕ Cadastrar espécie</button>`}
        <button class="btn btn-ghost" onclick="setAiMode('diagnose'); runAI()">🩺 Diagnosticar saúde</button>
      </div>
      <div class="ai-via">via ${esc(r.worker)}</div>
    </div>`;
}

// Troca a sugestão principal por uma das alternativas
window.pickIdentification = function(i) {
  if (!lastIdentify || !lastIdentify.alts[i]) return;
  const alt = lastIdentify.alts[i];
  const old = lastIdentify.main;
  lastIdentify.main = { name: alt.name, scientific_name: alt.scientific_name || '', description: '', water_days: null, light: '', pet_toxicity: '', confidence: null };
  lastIdentify.alts[i] = { name: old.name, scientific_name: old.scientific_name };
  renderIdentify();
};

window.openMatchedSpecies = function(id) {
  const sp = allSpecies.find(s => s.firestoreId === id);
  if (!sp) return;
  setNavActive('species');
  openSpeciesDetail(sp, { fromUser: true });
};

window.registerFromIdentification = function() {
  if (!lastIdentify || !lastIdentify.is_plant) return;
  const c = lastIdentify.main;
  openAddSpeciesModal();
  $('specieName').value = c.name;
  $('specieScientific').value = c.scientific_name || '';
  if (c.water_days) $('specieWaterDays').value = c.water_days;
  if (c.light) $('fieldLight').value = c.light;
  if (c.pet_toxicity) $('fieldPetToxicity').value = c.pet_toxicity;
  if (aiImageData) {
    speciePhotoData = aiImageData;
    const pv = $('speciePhotoPreview');
    pv.src = aiImageData;
    pv.style.display = 'block';
  }
  toast('Dados preenchidos! Use ✨ para completar a ficha de cuidados.');
};

// ==================== INICIALIZAÇÃO ====================
updateDashboard();

// Atualiza medidores de rega e saudação quando o dia vira (ou a aba fica aberta por muito tempo)
setInterval(() => {
  updateDashboard();
  renderSpeciesGrid();
  if (currentSelectedSpecies) renderVasesForSpecies(currentSelectedSpecies.firestoreId);
}, 10 * 60 * 1000);
