// ==================== SERVICE WORKER ====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Falha ao registrar service worker:', err));
  });
}

// ==================== FIREBASE ====================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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

// ==================== WORKERS CLOUDFLARE (MULTI-CONTA COM FALLBACK) ====================
// Cada Worker abaixo usa uma conta/chave de IA (Gemini) diferente. Quando a cota de uma
// esgota (ou ela falha por qualquer motivo), o app tenta automaticamente a próxima da lista.
// Todas sempre terminam com "/", as rotas são concatenadas nas chamadas fetch.
const WORKER_URLS = [
  "https://shiny-sky-21dd.genesisgns.workers.dev/",
  "https://astro2.genesisgns.workers.dev/",
  "https://astro-gns-proxy.genesisgns.workers.dev/"
];

// Lembra qual Worker funcionou por último, para já começar por ela na próxima vez
// (evita insistir sempre na que já sabemos que está sem cota).
const WORKER_INDEX_KEY = 'minhasplantas_worker_index';
let currentWorkerIndex = 0;
try {
  const savedIndex = Number(localStorage.getItem(WORKER_INDEX_KEY));
  if (!Number.isNaN(savedIndex) && savedIndex >= 0 && savedIndex < WORKER_URLS.length) {
    currentWorkerIndex = savedIndex;
  }
} catch (e) { /* localStorage indisponível, segue com o índice 0 */ }

function saveWorkerIndex() {
  try { localStorage.setItem(WORKER_INDEX_KEY, String(currentWorkerIndex)); } catch (e) { /* ignora */ }
}

// Erros de validação do próprio pedido (ex: campo obrigatório faltando) não têm por quê
// serem tentados de novo em outra conta — o erro se repetiria em todas. Qualquer outro
// status (cota estourada, chave não configurada, erro interno, etc.) ou falha de rede
// dispara a tentativa na próxima Worker da lista.
function shouldTryNextWorker(status) {
  return status !== 400;
}

// Faz a chamada tentando cada Worker em sequência, começando pela última que funcionou.
// `path` é a rota (ex: 'auto-fill-plant'), `options` são as opções do fetch (method, body...).
async function fetchFromWorkers(path, options) {
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 0; attempt < WORKER_URLS.length; attempt++) {
    const index = (currentWorkerIndex + attempt) % WORKER_URLS.length;
    const url = WORKER_URLS[index] + path;

    try {
      const response = await fetch(url, options);

      if (response.ok) {
        if (index !== currentWorkerIndex) {
          currentWorkerIndex = index;
          saveWorkerIndex();
        }
        return response;
      }

      lastResponse = response;
      if (!shouldTryNextWorker(response.status)) {
        return response; // erro do próprio pedido, não adianta tentar outra conta
      }
      console.warn(`Worker ${url} respondeu status ${response.status}, tentando a próxima conta...`);
    } catch (err) {
      lastError = err;
      console.warn(`Worker ${url} falhou (${err.message}), tentando a próxima conta...`);
    }
  }

  // Todas as Workers falharam
  if (lastResponse) return lastResponse;
  throw new Error('Não foi possível conectar a nenhuma das contas de IA disponíveis. Tente novamente mais tarde.');
}

let allSpecies = [];
let allVases = [];
let currentSelectedSpecies = null;
let currentDetailVaseId = null;
let activeDrawerId = null;
let searchTerm = '';

// Imagens já processadas (comprimidas + em base64), prontas para salvar no Firestore
// ou enviar para o Worker. Guardadas fora dos inputs, já que dois inputs distintos
// (galeria e câmera) alimentam a mesma foto.
let speciePhotoData = null;
let vasePhotoData = null;
let aiImageData = null;

// ==================== COMPRESSÃO DE IMAGEM ====================
// Fotos tiradas com a câmera do celular costumam vir em resolução muito maior
// (vários MB) do que fotos escolhidas na galeria/compartilhadas. Isso estourava
// o limite de 1MB por documento do Firestore e causava erro ao salvar. Agora,
// TODA imagem (seja da galeria ou da câmera) passa por este redimensionamento/
// compressão via canvas antes de virar base64, então o tamanho final é sempre
// controlado, independente da origem.
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
        while (dataUrl.length > maxBytes * 1.37 && quality > 0.2 && attempts < 6) {
          quality -= 0.15;
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

// Converte uma dataURL (base64) de volta para Blob, usado para enviar a foto
// de diagnóstico por multipart/form-data ao Worker.
function dataURLToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: mime });
}

// Liga um par de inputs (galeria + câmera) a um callback que recebe a imagem
// já comprimida em base64, e atualiza um preview opcional.
function wireImagePicker(galleryInputId, cameraInputId, previewId, onSelect) {
  const galleryInput = document.getElementById(galleryInputId);
  const cameraInput = document.getElementById(cameraInputId);
  const preview = previewId ? document.getElementById(previewId) : null;

  async function handle(e) {
    const file = e.target.files[0];
    e.target.value = ''; // permite selecionar o mesmo arquivo novamente depois
    if (!file) return;

    try {
      const dataUrl = await compressImage(file);
      onSelect(dataUrl);
      if (preview) {
        preview.src = dataUrl;
        preview.style.display = 'block';
      }
    } catch (err) {
      alert('Não foi possível usar essa imagem: ' + err.message);
    }
  }

  galleryInput.addEventListener('change', handle);
  cameraInput.addEventListener('change', handle);
}

wireImagePicker('speciePhotoGallery', 'speciePhotoCamera', 'speciePhotoPreview', (dataUrl) => { speciePhotoData = dataUrl; });
wireImagePicker('vasePhotoGallery', 'vasePhotoCamera', 'vasePhotoPreview', (dataUrl) => { vasePhotoData = dataUrl; });
wireImagePicker('aiImageGallery', 'aiImageCamera', 'aiImagePreview', (dataUrl) => { aiImageData = dataUrl; });

// ==================== BUSCA / FILTRO ====================
window.applySpeciesSearch = function() {
  searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
  renderSpeciesGrid();
};

function speciesMatchesSearch(sp) {
  if (!searchTerm) return true;
  const speciesVases = allVases.filter(v => v.speciesId === sp.firestoreId);
  const haystack = [
    sp.name, sp.scientific, sp.category, sp.light, sp.water, sp.pruning,
    sp.soil, sp.fertilizer, sp.naturalFertilizer,
    ...speciesVases.map(v => v.name)
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(searchTerm);
}

function petToxicityIcon(level) {
  if (level === 'Letal') return '🔴';
  if (level === 'Tóxica') return '🟠';
  if (level === 'Segura') return '🟢';
  return '🐾';
}

// ESCUTAR FIREBASE EM TEMPO REAL
onSnapshot(speciesCol, (snapshot) => {
  allSpecies = snapshot.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  renderSpeciesGrid();
  updateDashboard();
  if (currentSelectedSpecies) {
    const updated = allSpecies.find(s => s.firestoreId === currentSelectedSpecies.firestoreId);
    if (updated) openSpeciesDetail(updated);
  }
});

onSnapshot(vasesCol, (snapshot) => {
  allVases = snapshot.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  renderSpeciesGrid();
  updateDashboard();
  if (currentSelectedSpecies) {
    renderVasesForSpecies(currentSelectedSpecies.firestoreId);
  }
  if (currentDetailVaseId) {
    renderVaseDetail(currentDetailVaseId);
  }
});

// ATUALIZAR DASHBOARD (CONTADORES & LEMBRETES)
function updateDashboard() {
  document.getElementById('statSpeciesCount').innerText = allSpecies.length;
  document.getElementById('statPotsCount').innerText = allVases.length;

  const todayStr = new Date().toISOString().split('T')[0];
  const wateredTodayPots = new Set();

  const allReminders = [];

  allVases.forEach(vase => {
    const history = vase.history || [];
    history.forEach(h => {
      if (h.type === 'lastWater' && h.date && h.date.startsWith(todayStr)) {
        wateredTodayPots.add(vase.firestoreId);
      }
      if (h.type === 'lembrete' || new Date(h.date) >= new Date()) {
        allReminders.push({ vaseName: vase.name, ...h });
      }
    });
  });

  document.getElementById('statWateredToday').innerText = wateredTodayPots.size;

  const remindersList = document.getElementById('remindersList');
  if (allReminders.length === 0) {
    remindersList.innerHTML = '<p style="color:#888; font-size:0.85rem;">Nenhum lembrete próximo no momento.</p>';
  } else {
    remindersList.innerHTML = '';
    allReminders
      .sort((a,b) => new Date(a.date) - new Date(b.date))
      .slice(0, 5)
      .forEach(rem => {
        const dateFormatted = new Date(rem.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        const item = document.createElement('div');
        item.className = 'reminder-item';
        item.innerHTML = `
          <div><b>${rem.vaseName}:</b> ${rem.notes || 'Lembrete agendado'}</div>
          <span style="font-weight:700; color:var(--terra);">${dateFormatted}</span>
        `;
        remindersList.appendChild(item);
      });
  }
}

// RENDERIZAR CARDS DAS ESPÉCIES NA HOME
function renderSpeciesGrid() {
  const container = document.getElementById('speciesGrid');
  container.innerHTML = '';

  if (allSpecies.length === 0) {
    container.innerHTML = '<p style="color:#666;">Nenhuma espécie cadastrada ainda.</p>';
    return;
  }

  const filteredSpecies = allSpecies.filter(speciesMatchesSearch);

  if (filteredSpecies.length === 0) {
    container.innerHTML = '<p style="color:#666;">Nenhum resultado encontrado para essa busca.</p>';
    return;
  }

  filteredSpecies.forEach(sp => {
    const countVases = allVases.filter(v => v.speciesId === sp.firestoreId).length;

    const card = document.createElement('div');
    card.className = 'species-card';
    card.onclick = () => openSpeciesDetail(sp);

    const coverHtml = sp.photo
      ? `<img src="${sp.photo}" class="species-card-cover" />`
      : `<div class="species-card-cover-icon">${sp.icon || '🪴'}</div>`;

    card.innerHTML = `
      <div class="species-card-actions">
        <button class="btn-icon edit-icon" onclick="event.stopPropagation(); editSpecies('${sp.firestoreId}')" title="Editar">✏️</button>
        <button class="btn-icon" onclick="event.stopPropagation(); deleteSpecies('${sp.firestoreId}')" title="Excluir">&times;</button>
      </div>
      ${coverHtml}
      <div class="species-card-body">
        <h3 style="font-family:'Playfair Display', serif; color:var(--ink);">${sp.name}</h3>
        <p style="font-size:0.8rem; color:var(--sage);">${sp.scientific || ''}</p>
        <div style="margin-top:1rem; font-size:0.85rem; font-weight:700; color:var(--terra);">
          🪴 ${countVases} ${countVases === 1 ? 'Vaso cadastrado' : 'Vasos cadastrados'}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// ABRIR DETALHES DE UMA ESPÉCIE & SEUS VASOS
window.openSpeciesDetail = function(species) {
  currentSelectedSpecies = species;
  document.getElementById('sec-species').style.display = 'none';
  document.getElementById('sec-species-detail').style.display = 'block';

  document.getElementById('detailSpeciesName').innerText = species.name;
  document.getElementById('detailSpeciesNameVases').innerText = species.name;
  document.getElementById('detailSpeciesScientific').innerText = species.scientific || '';

  const coverEl = document.getElementById('detailSpeciesCover');
  if (species.photo) {
    coverEl.className = 'cover-photo-lg';
    coverEl.innerHTML = `<img src="${species.photo}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;" />`;
  } else {
    coverEl.className = 'cover-icon-lg';
    coverEl.innerHTML = species.icon || '🪴';
  }

  // RENDERIZAR MINI CARDS DE CUIDADOS DA ESPÉCIE
  const careGrid = document.getElementById('detailSpeciesCareGrid');
  careGrid.innerHTML = '';

  const careFields = [
    { icon: "🏷️", label: "Categoria", val: species.category },
    { icon: "☀️", label: "Luz / Sol", val: species.light },
    { icon: "💧", label: "Rega", val: species.water },
    { icon: "✂️", label: "Poda", val: species.pruning },
    { icon: "💦", label: "Umidade", val: species.humidity },
    { icon: "🪱", label: "Solo", val: species.soil },
    { icon: "🧪", label: "Adubação Comercial", val: species.fertilizer },
    { icon: "🍌", label: "Adubação Natural", val: species.naturalFertilizer },
    { icon: "💡", label: "Dica Extra", val: species.extraTips, wide: true },
    { icon: "⚠️", label: "Observações", val: species.observations, wide: true },
    {
      icon: petToxicityIcon(species.petToxicity),
      label: "Toxicidade Pet",
      val: species.petToxicity
        ? (species.petWarning ? `${species.petToxicity} — ${species.petWarning}` : species.petToxicity)
        : null,
      wide: true
    }
  ];

  let countBadges = 0;
  careFields.forEach(f => {
    if (f.val) {
      countBadges++;
      careGrid.innerHTML += `
        <div class="care-badge-item${f.wide ? ' care-badge-wide' : ''}">
          <span class="care-badge-label"><span class="care-badge-icon">${f.icon}</span>${f.label}</span>
          <span class="care-badge-val">${f.val}</span>
        </div>`;
    }
  });

  // Suporte a cadastro em formato legados de versão anterior
  if (countBadges === 0 && species.care) {
    careGrid.innerHTML = `<div class="care-badge-item" style="grid-column: 1/-1;"><span class="care-badge-val">${species.care}</span></div>`;
  } else if (countBadges === 0) {
    careGrid.innerHTML = `<p style="font-size:0.8rem; color:#888;">Nenhuma instrução específica cadastrada.</p>`;
  }

  renderVasesForSpecies(species.firestoreId);
};

window.backToSpecies = function() {
  currentSelectedSpecies = null;
  document.getElementById('sec-species-detail').style.display = 'none';
  document.getElementById('sec-species').style.display = 'block';
};

// RENDERIZAR VASOS DA ESPÉCIE SELECIONADA
function renderVasesForSpecies(speciesId) {
  const container = document.getElementById('vasesGrid');
  container.innerHTML = '';

  const myVases = allVases.filter(v => v.speciesId === speciesId);

  if (myVases.length === 0) {
    container.innerHTML = '<p style="color:#666; grid-column: 1/-1;">Você ainda não cadastrou nenhum vaso para esta espécie.</p>';
    return;
  }

  myVases.forEach(vase => {
    const lastWater = vase.lastWater ? new Date(vase.lastWater).toLocaleDateString('pt-BR') : 'Nunca registrado';
    const lastFertilizer = vase.lastFertilizer ? new Date(vase.lastFertilizer).toLocaleDateString('pt-BR') : 'Nunca registrado';
    const lastPruning = vase.lastPruning ? new Date(vase.lastPruning).toLocaleDateString('pt-BR') : 'Nunca registrado';
    const lastRepot = vase.lastRepot ? new Date(vase.lastRepot).toLocaleDateString('pt-BR') : 'Não informado';

    const history = (vase.history || []).sort((a,b) => new Date(b.date) - new Date(a.date));

    const card = document.createElement('div');
    card.className = 'vase-card';
    card.innerHTML = `
      ${vase.photo
        ? `<img src="${vase.photo}" class="vase-img" style="cursor:pointer;" onclick="openVaseDetail('${vase.firestoreId}')" />`
        : `<div class="vase-img" style="display:flex; align-items:center; justify-content:center; font-size:2.6rem; cursor:pointer;" onclick="openVaseDetail('${vase.firestoreId}')">${vase.icon || '🪴'}</div>`}

      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="font-size:1.1rem; color:var(--moss); cursor:pointer;" onclick="openVaseDetail('${vase.firestoreId}')">${vase.name}</h4>
        <div style="display:flex; gap:0.2rem;">
          <button class="btn-icon" onclick="editVase('${vase.firestoreId}')" title="Editar Vaso">✏️</button>
          <button class="btn-icon" onclick="deleteVase('${vase.firestoreId}')" title="Excluir Vaso">&times;</button>
        </div>
      </div>

      <p style="font-size:0.75rem; color:#666;"><b>Tamanho/Material:</b> ${vase.size || 'Padrão'}</p>

      <div style="background:var(--cream); padding:0.6rem; border-radius:8px; font-size:0.78rem;">
        <div>💧 <b>Última Rega:</b> ${lastWater}</div>
        <div>🧪 <b>Última Adubação:</b> ${lastFertilizer}</div>
        <div>✂️ <b>Última Poda:</b> ${lastPruning}</div>
        <div>🪴 <b>Último Transbordo:</b> ${lastRepot}</div>
      </div>

      <div class="mini-chart-container">
        <div class="mini-chart-title">📊 Frequência de Regas (Dias)</div>
        <canvas id="chart-${vase.firestoreId}" width="250" height="40"></canvas>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.4rem;">
        <button class="btn-secondary" style="font-size:0.75rem;" onclick="recordCareQuick('${vase.firestoreId}', 'lastWater')">💧 Regar Hoje</button>
        <button class="btn-secondary" style="font-size:0.75rem;" onclick="recordCareQuick('${vase.firestoreId}', 'lastFertilizer')">🧪 Adubar Hoje</button>
        <button class="btn-secondary" style="font-size:0.75rem;" onclick="recordCareQuick('${vase.firestoreId}', 'lastPruning')">✂️ Podar Hoje</button>
        <button class="btn-secondary" style="font-size:0.75rem;" onclick="recordCareQuick('${vase.firestoreId}', 'lastRepot')">🪴 Transplantar Hoje</button>
      </div>

      <button class="btn-primary" style="font-size:0.78rem; padding:0.5rem;" onclick="openCareLogDrawer('${vase.firestoreId}')">
        + Registro Retroativo / Lembrete
      </button>

      <button class="btn-secondary" style="font-size:0.75rem; background:var(--gold);" onclick="openVaseDetail('${vase.firestoreId}')">
        🔍 Ver Detalhes & Galeria
      </button>
    `;
    container.appendChild(card);

    setTimeout(() => drawMiniChart(vase.firestoreId, history), 50);
  });
}

// DESENHAR MINI GRÁFICO DE FREQUÊNCIA
function drawMiniChart(vaseId, history) {
  const canvas = document.getElementById(`chart-${vaseId}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const regas = history.filter(h => h.type === 'lastWater').reverse();
  if (regas.length < 2) {
    ctx.fillStyle = '#aaa';
    ctx.font = '10px sans-serif';
    ctx.fillText('Histórico suficiente necessário', 10, 24);
    return;
  }

  const intervals = [];
  for (let i = 1; i < regas.length; i++) {
    const diff = (new Date(regas[i].date) - new Date(regas[i-1].date)) / (1000 * 60 * 60 * 24);
    intervals.push(Math.max(1, Math.round(diff)));
  }

  const maxVal = Math.max(...intervals, 10);
  const barWidth = Math.min(20, (canvas.width - 20) / intervals.length);

  intervals.forEach((val, index) => {
    const h = (val / maxVal) * (canvas.height - 10);
    const x = 10 + index * (barWidth + 4);
    const y = canvas.height - h;

    ctx.fillStyle = '#6b8e63';
    ctx.fillRect(x, y, barWidth, h);

    ctx.fillStyle = '#1c241b';
    ctx.font = '8px sans-serif';
    ctx.fillText(`${val}d`, x, y - 2);
  });
}

// REGISTRO RÁPIDO DO DIA DE HOJE
window.recordCareQuick = async function(vaseId, careType) {
  const now = new Date().toISOString();
  const vaseDoc = doc(db, "vases", vaseId);

  try {
    await updateDoc(vaseDoc, {
      [careType]: now,
      history: arrayUnion({ type: careType, date: now, notes: "Registro rápido" })
    });
  } catch (err) {
    alert("Erro ao registrar ação: " + err.message);
  }
};

// REGAR TODOS OS VASOS DAS ESPÉCIES ATUALMENTE FILTRADAS/VISÍVEIS NA BUSCA
window.waterAllFiltered = async function() {
  const filteredSpecies = allSpecies.filter(speciesMatchesSearch);
  const speciesIds = new Set(filteredSpecies.map(s => s.firestoreId));
  const vasesToWater = allVases.filter(v => speciesIds.has(v.speciesId));

  if (vasesToWater.length === 0) {
    alert('Nenhum vaso encontrado para regar.');
    return;
  }

  if (!confirm(`Regar ${vasesToWater.length} vaso(s) agora?`)) return;

  const now = new Date().toISOString();
  try {
    await Promise.all(vasesToWater.map(v => updateDoc(doc(db, "vases", v.firestoreId), {
      lastWater: now,
      history: arrayUnion({ type: 'lastWater', date: now, notes: 'Rega em lote (Regar Todos)' })
    })));
  } catch (err) {
    alert('Erro ao regar vasos: ' + err.message);
  }
};

// ABRIR DRAWER REGISTRO RETROATIVO
window.openCareLogDrawer = function(vaseId) {
  document.getElementById('logVaseId').value = vaseId;
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('logDate').value = now.toISOString().slice(0, 16);
  openDrawer('drawerCareLog');
};

window.saveCareLog = async function(e) {
  e.preventDefault();
  const vaseId = document.getElementById('logVaseId').value;
  const actionType = document.getElementById('logActionType').value;
  const dateVal = document.getElementById('logDate').value;
  const notes = document.getElementById('logNotes').value;

  if (!vaseId || !dateVal) return;

  const isoDate = new Date(dateVal).toISOString();
  const vaseDoc = doc(db, "vases", vaseId);

  try {
    const updatePayload = {
      history: arrayUnion({ type: actionType, date: isoDate, notes: notes })
    };
    if (actionType !== 'lembrete' && actionType !== 'nota') {
      updatePayload[actionType] = isoDate;
    }

    await updateDoc(vaseDoc, updatePayload);
    closeActiveDrawer();
    document.getElementById('formCareLog').reset();
  } catch (err) {
    alert("Erro ao salvar log: " + err.message);
  }
};

// ==================== NAVEGAÇÃO ====================
window.switchTab = function(tab) {
  document.getElementById('sec-species').style.display = tab === 'species' ? 'block' : 'none';
  document.getElementById('sec-species-detail').style.display = 'none';
  document.getElementById('sec-ai').style.display = tab === 'ai' ? 'block' : 'none';

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll(`.nav-btn[onclick="switchTab('${tab}')"]`).forEach(btn => btn.classList.add('active'));
};

window.openDrawer = function(id) {
  activeDrawerId = id;
  document.getElementById(id).classList.add('active');
};

window.closeActiveDrawer = function() {
  if (activeDrawerId) {
    document.getElementById(activeDrawerId).classList.remove('active');
    activeDrawerId = null;
  }
};

// ==================== ESPÉCIES: SALVAR / EDITAR / EXCLUIR ====================
window.openAddSpeciesModal = function() {
  document.getElementById('formSpecies').reset();
  document.getElementById('speciesEditId').value = '';
  document.getElementById('speciesModalTitle').innerText = 'Cadastrar Nova Espécie';
  document.getElementById('speciePhotoPreview').style.display = 'none';
  document.getElementById('speciePhotoPreview').src = '';
  speciePhotoData = null;
  openDrawer('drawerAddSpecies');
};

window.editSpecies = function(firestoreId) {
  const sp = allSpecies.find(s => s.firestoreId === firestoreId);
  if (!sp) return;

  document.getElementById('speciesEditId').value = sp.firestoreId;
  document.getElementById('speciesModalTitle').innerText = 'Editar Espécie';

  document.getElementById('specieName').value = sp.name || '';
  document.getElementById('specieScientific').value = sp.scientific || '';
  document.getElementById('specieIcon').value = sp.icon || '🪴';
  document.getElementById('fieldCategory').value = sp.category || '';
  document.getElementById('fieldLight').value = sp.light || '';
  document.getElementById('fieldWater').value = sp.water || '';
  document.getElementById('specieWaterDays').value = sp.waterDays || '';
  document.getElementById('fieldPruning').value = sp.pruning || '';
  document.getElementById('fieldHumidity').value = sp.humidity || '';
  document.getElementById('fieldSoil').value = sp.soil || '';
  document.getElementById('fieldFertilizer').value = sp.fertilizer || '';
  document.getElementById('fieldNaturalFertilizer').value = sp.naturalFertilizer || '';
  document.getElementById('fieldExtraTips').value = sp.extraTips || '';
  document.getElementById('fieldObservations').value = sp.observations || '';
  document.getElementById('fieldPetToxicity').value = sp.petToxicity || '';
  document.getElementById('fieldPetWarning').value = sp.petWarning || '';

  speciePhotoData = null;
  const preview = document.getElementById('speciePhotoPreview');
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
  const btn = document.getElementById('btnSaveSpecies');
  const editId = document.getElementById('speciesEditId').value;

  const speciesData = {
    name: document.getElementById('specieName').value.trim(),
    scientific: document.getElementById('specieScientific').value.trim(),
    icon: document.getElementById('specieIcon').value || '🪴',
    category: document.getElementById('fieldCategory').value.trim(),
    light: document.getElementById('fieldLight').value.trim(),
    water: document.getElementById('fieldWater').value.trim(),
    waterDays: Number(document.getElementById('specieWaterDays').value) || 5,
    pruning: document.getElementById('fieldPruning').value.trim(),
    humidity: document.getElementById('fieldHumidity').value.trim(),
    soil: document.getElementById('fieldSoil').value.trim(),
    fertilizer: document.getElementById('fieldFertilizer').value.trim(),
    naturalFertilizer: document.getElementById('fieldNaturalFertilizer').value.trim(),
    extraTips: document.getElementById('fieldExtraTips').value.trim(),
    observations: document.getElementById('fieldObservations').value.trim(),
    petToxicity: document.getElementById('fieldPetToxicity').value,
    petWarning: document.getElementById('fieldPetWarning').value.trim(),
  };

  btn.disabled = true;

  try {
    if (speciePhotoData) {
      speciesData.photo = speciePhotoData;
    }

    if (editId) {
      await updateDoc(doc(db, "species", editId), speciesData);
    } else {
      if (!speciesData.photo) speciesData.photo = '';
      speciesData.createdAt = new Date().toISOString();
      await addDoc(speciesCol, speciesData);
    }
    document.getElementById('formSpecies').reset();
    document.getElementById('speciePhotoPreview').style.display = 'none';
    speciePhotoData = null;
    closeActiveDrawer();
  } catch (err) {
    alert('Erro ao salvar espécie: ' + err.message);
  } finally {
    btn.disabled = false;
  }
};

window.deleteSpecies = async function(firestoreId) {
  if (!confirm('Tem certeza que deseja excluir esta espécie?')) return;
  try {
    await deleteDoc(doc(db, "species", firestoreId));
    if (currentSelectedSpecies && currentSelectedSpecies.firestoreId === firestoreId) {
      backToSpecies();
    }
  } catch (err) {
    alert('Erro ao excluir espécie: ' + err.message);
  }
};

// PREENCHIMENTO AUTOMÁTICO COM IA (CAMPOS SEPARADOS)
window.autoFillWithAI = async function() {
  const name = document.getElementById('specieName').value.trim();
  if (!name) return alert('Digite o nome da planta primeiro.');

  const btn = event.target;
  btn.disabled = true;
  btn.innerText = '✨ Consultando IA...';

  try {
    const formData = new FormData();
    formData.append('plant_name', name);

    const response = await fetchFromWorkers('auto-fill-plant', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro desconhecido ao consultar a IA (todas as contas indisponíveis no momento).');
    }

    document.getElementById('specieScientific').value = data.scientific_name || '';
    document.getElementById('fieldCategory').value = data.category || '';
    document.getElementById('fieldLight').value = data.light || '';
    document.getElementById('fieldWater').value = data.water || '';
    document.getElementById('specieWaterDays').value = data.water_days || 5;
    document.getElementById('fieldPruning').value = data.pruning || '';
    document.getElementById('fieldHumidity').value = data.humidity || '';
    document.getElementById('fieldSoil').value = data.soil || '';
    document.getElementById('fieldFertilizer').value = data.fertilizer || '';
    document.getElementById('fieldNaturalFertilizer').value = data.natural_fertilizer || '';
    document.getElementById('fieldExtraTips').value = data.extra_tips || '';
    document.getElementById('fieldObservations').value = data.observations || '';

    const validLevels = ['Segura', 'Tóxica', 'Letal'];
    document.getElementById('fieldPetToxicity').value = validLevels.includes(data.pet_toxicity) ? data.pet_toxicity : '';
    document.getElementById('fieldPetWarning').value = data.pet_warning || '';
  } catch (err) {
    alert('Erro ao consultar IA: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = '✨ Preencher Ficha com IA';
  }
};

// ==================== VASOS: CADASTRAR / EDITAR / EXCLUIR ====================
window.openAddVaseModal = function() {
  document.getElementById('formVase').reset();
  document.getElementById('vaseEditId').value = '';
  document.getElementById('vaseModalTitle').innerText = 'Cadastrar Novo Vaso';
  document.getElementById('vasePhotoPreview').style.display = 'none';
  document.getElementById('vasePhotoPreview').src = '';
  vasePhotoData = null;
  openDrawer('drawerAddVase');
};

window.editVase = function(vaseId) {
  const vase = allVases.find(v => v.firestoreId === vaseId);
  if (!vase) return;

  document.getElementById('vaseEditId').value = vase.firestoreId;
  document.getElementById('vaseModalTitle').innerText = 'Editar Vaso';

  document.getElementById('vaseName').value = vase.name || '';
  document.getElementById('vaseIcon').value = vase.icon || '🪴';
  document.getElementById('vaseSize').value = vase.size || '';
  document.getElementById('vaseRepotDate').value = vase.lastRepot ? vase.lastRepot.slice(0, 10) : '';

  vasePhotoData = null;
  const preview = document.getElementById('vasePhotoPreview');
  if (vase.photo) {
    preview.src = vase.photo;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
    preview.src = '';
  }

  openDrawer('drawerAddVase');
};

window.saveVase = async function(event) {
  event.preventDefault();
  if (!currentSelectedSpecies) return alert('Selecione uma espécie primeiro.');

  const btn = document.getElementById('btnSaveVase');
  const editId = document.getElementById('vaseEditId').value;
  const name = document.getElementById('vaseName').value.trim();
  const icon = document.getElementById('vaseIcon').value || '🪴';
  const size = document.getElementById('vaseSize').value.trim();
  const repotDate = document.getElementById('vaseRepotDate').value;

  btn.disabled = true;

  try {
    if (editId) {
      const vaseDoc = doc(db, "vases", editId);
      const updatePayload = { name, size, icon };

      if (vasePhotoData) {
        updatePayload.photo = vasePhotoData;
        updatePayload.photoHistory = arrayUnion({ photo: vasePhotoData, date: new Date().toISOString() });
      }

      if (repotDate) {
        updatePayload.lastRepot = new Date(repotDate).toISOString();
      }

      await updateDoc(vaseDoc, updatePayload);
    } else {
      let photoBase64 = '';
      let photoHistory = [];

      if (vasePhotoData) {
        photoBase64 = vasePhotoData;
        photoHistory = [{ photo: photoBase64, date: new Date().toISOString() }];
      }

      const vaseData = {
        speciesId: currentSelectedSpecies.firestoreId,
        name,
        icon,
        size,
        photo: photoBase64,
        photoHistory,
        history: [],
        createdAt: new Date().toISOString()
      };

      if (repotDate) {
        const repotIso = new Date(repotDate).toISOString();
        vaseData.lastRepot = repotIso;
        vaseData.history = [{ type: 'lastRepot', date: repotIso }];
      }

      await addDoc(vasesCol, vaseData);
    }

    document.getElementById('formVase').reset();
    document.getElementById('vasePhotoPreview').style.display = 'none';
    vasePhotoData = null;
    closeActiveDrawer();
  } catch (err) {
    alert('Erro ao salvar vaso: ' + err.message);
  } finally {
    btn.disabled = false;
  }
};

window.deleteVase = async function(firestoreId) {
  if (!confirm('Tem certeza que deseja excluir este vaso?')) return;
  try {
    await deleteDoc(doc(db, "vases", firestoreId));
  } catch (err) {
    alert('Erro ao excluir vaso: ' + err.message);
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

  document.getElementById('vaseDetailName').innerText = vase.name;

  const photoEl = document.getElementById('vaseDetailPhoto');
  const photoPlaceholder = document.getElementById('vaseDetailPhotoPlaceholder');
  if (vase.photo) {
    photoEl.src = vase.photo;
    photoEl.style.display = 'block';
    photoPlaceholder.style.display = 'none';
  } else {
    photoEl.style.display = 'none';
    photoPlaceholder.style.display = 'flex';
    photoPlaceholder.innerText = vase.icon || '🌱';
  }

  const history = vase.history || [];

  // STATS DE FREQUÊNCIA
  const CARE_TYPES = [
    { key: 'lastWater', label: '💧 Rega' },
    { key: 'lastFertilizer', label: '🧪 Adubação' },
    { key: 'lastPruning', label: '✂️ Poda' },
    { key: 'lastRepot', label: '🪴 Transbordo' }
  ];

  let statsHtml = '';
  CARE_TYPES.forEach(ct => {
    const lastDate = vase[ct.key] ? new Date(vase[ct.key]).toLocaleDateString('pt-BR') : 'Nunca registrado';
    const events = history.filter(h => h.type === ct.key).map(h => new Date(h.date)).sort((a, b) => a - b);

    let freqText = 'Mínimo 2 registros necessários';
    if (events.length >= 2) {
      let totalDays = 0;
      for (let i = 1; i < events.length; i++) {
        totalDays += (events[i] - events[i - 1]) / (1000 * 60 * 60 * 24);
      }
      const avg = totalDays / (events.length - 1);
      freqText = `Média: a cada ${avg.toFixed(1)} dias`;
    }

    statsHtml += `
      <div style="padding: 0.4rem 0; border-bottom: 1px solid rgba(0,0,0,0.06);">
        <div><b>${ct.label}</b> — última: ${lastDate}</div>
        <div style="color: var(--sage); font-size: 0.78rem;">${freqText}</div>
      </div>`;
  });
  document.getElementById('vaseDetailStats').innerHTML = statsHtml;

  // HISTÓRICO EM ORDEM CRONOLÓGICA DECRESCENTE (RETROATIVO CORRETO)
  const sortedHistory = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
  const historyEl = document.getElementById('vaseDetailHistory');

  const typeLabels = {
    lastWater: '💧 Regou',
    lastFertilizer: '🧪 Adubou',
    lastPruning: '✂️ Podou',
    lastRepot: '🪴 Transbordou',
    lembrete: '⏰ Lembrete',
    nota: '📝 Nota'
  };

  if (sortedHistory.length === 0) {
    historyEl.innerHTML = '<p style="color:#666; font-size:0.8rem;">Nenhum registro de cuidado ainda.</p>';
  } else {
    historyEl.innerHTML = sortedHistory.map(h => `
      <div class="timeline-item">
        <span class="timeline-date">${new Date(h.date).toLocaleDateString('pt-BR')} ${new Date(h.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        <div><b>${typeLabels[h.type] || h.type}:</b> ${h.notes || 'Sem observação'}</div>
      </div>`).join('');
  }

  // GALERIA
  const gallery = vase.photoHistory || [];
  const galleryEl = document.getElementById('vaseDetailGallery');
  if (gallery.length === 0) {
    galleryEl.innerHTML = '<p style="color:#666; grid-column:1/-1; font-size:0.8rem;">Nenhuma foto na galeria.</p>';
  } else {
    const sortedGallery = [...gallery].sort((a, b) => new Date(b.date) - new Date(a.date));
    galleryEl.innerHTML = sortedGallery.map(g => `
      <div style="text-align:center;">
        <img src="${g.photo}" style="width:100%; height:100px; object-fit:cover; border-radius:8px; border:1px solid var(--mist);" />
        <div style="font-size:0.65rem; color:#666; margin-top:0.25rem;">${new Date(g.date).toLocaleDateString('pt-BR')}</div>
      </div>`).join('');
  }
}

window.addGalleryPhoto = async function(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentDetailVaseId) return;

  try {
    const photoBase64 = await compressImage(file);
    const vaseDoc = doc(db, "vases", currentDetailVaseId);
    await updateDoc(vaseDoc, {
      photo: photoBase64,
      photoHistory: arrayUnion({ photo: photoBase64, date: new Date().toISOString() })
    });
  } catch (err) {
    alert('Erro ao adicionar foto: ' + err.message);
  }
};

// DIAGNÓSTICO IA
window.runAIDiagnosis = async function() {
  const resultEl = document.getElementById('aiResult');

  if (!aiImageData) return alert('Selecione ou tire uma foto da planta primeiro.');

  resultEl.style.display = 'block';
  resultEl.innerHTML = '🔍 Analisando a foto com IA, aguarde...';

  try {
    const formData = new FormData();
    formData.append('file', dataURLToBlob(aiImageData), 'diagnostico.jpg');

    const response = await fetchFromWorkers('diagnose-plant', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro desconhecido na análise (todas as contas indisponíveis no momento).');
    }

    resultEl.innerHTML = `
      <h4>🩺 Relatório Agronômico:</h4>
      <div style="white-space: pre-line; margin-top:0.8rem;">${data.diagnosis}</div>
      <div style="margin-top:1rem; padding-top:0.8rem; border-top:1px solid var(--mist); font-size:0.85rem; color:var(--sage);">
        🌙 Fase da Lua: <b>${data.moon_phase}</b> — ${data.moon_tip}
      </div>`;
  } catch (err) {
    resultEl.innerHTML = `❌ Erro ao analisar a imagem: ${err.message}`;
  }
};
