import { S } from './state.js';
import { $, esc, normText } from './utils.js';
import { WORKERS, callWorkers } from './workers.js';
import { toast } from './ui/feedback.js';
import { dataURLToBlob } from './images.js';
import { petToxicityIcon } from './care.js';
import { setNavActive } from './nav.js';
import { openAddSpeciesModal, openSpeciesDetail } from './species.js';

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

export function setAiMode(mode) {
  if (S.aiBusy) return;
  S.aiMode = mode;
  const t = AI_TEXT[mode];
  $('aiTitle').textContent = t.title;
  $('aiSubtitle').textContent = t.sub;
  $('aiRunBtn').textContent = t.btn;
  $('aiPlaceholderText').textContent = t.placeholder;
  $('aiTip').textContent = t.tip;
  document.querySelectorAll('[data-aimode]').forEach(b => b.classList.toggle('active', b.dataset.aimode === mode));
  $('aiResult').classList.remove('show');
  $('aiPlaceholder').style.display = '';
}

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

export async function runAI() {
  if (S.aiBusy) return;
  if (!S.aiImage) { toast('Selecione ou tire uma foto da planta primeiro.', 'error'); return; }

  S.aiBusy = true;
  const btn = $('aiRunBtn');
  btn.disabled = true;
  const onAttempt = aiLoading();
  const buildOptions = () => {
    const fd = new FormData();
    fd.append('file', dataURLToBlob(S.aiImage), 'planta.jpg');
    return { method: 'POST', body: fd };
  };

  try {
    if (S.aiMode === 'identify') await runIdentify(buildOptions, onAttempt);
    else await runDiagnosis(buildOptions, onAttempt);
  } catch (err) {
    aiFailure(err);
  } finally {
    S.aiBusy = false;
    btn.disabled = false;
  }
}

async function runDiagnosis(buildOptions, onAttempt) {
  const { data, worker } = await callWorkers('diagnose-plant', buildOptions, (d) => d && typeof d.diagnosis === 'string' && d.diagnosis.trim(), onAttempt);
  const moon = data.moon_phase
    ? `<div class="ai-moon">🌙 Fase da lua: <b>${esc(data.moon_phase)}</b>${data.moon_tip ? ' — ' + esc(data.moon_tip) : ''}</div>` : '';
  $('aiResult').innerHTML = `
    <h4>🩺 Relatório agronômico</h4>
    <div class="ai-text">${esc(data.diagnosis)}</div>
    <div class="ai-actions"><button class="btn btn-secondary" onclick="savePestFromDiagnosis()">📌 Guardar no histórico de um vaso</button></div>
    ${moon}
    <div class="ai-via">via ${esc(worker)}</div>`;
}

function looseSame(a, b) {
  if (!a || !b) return false;
  return a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
}

function findSpeciesMatch(c) {
  const wanted = [normText(c.name), normText(c.scientific_name)].filter(Boolean);
  return S.species.find(sp => {
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
  S.lastIdentify = { ...normalizeIdentify(data), worker };
  renderIdentify();
}

function renderIdentify() {
  const el = $('aiResult');
  const r = S.lastIdentify;
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
export function pickIdentification(i) {
  if (!S.lastIdentify || !S.lastIdentify.alts[i]) return;
  const alt = S.lastIdentify.alts[i];
  const old = S.lastIdentify.main;
  S.lastIdentify.main = { name: alt.name, scientific_name: alt.scientific_name || '', description: '', water_days: null, light: '', pet_toxicity: '', confidence: null };
  S.lastIdentify.alts[i] = { name: old.name, scientific_name: old.scientific_name };
  renderIdentify();
}

export function openMatchedSpecies(id) {
  const sp = S.species.find(s => s.firestoreId === id);
  if (!sp) return;
  setNavActive('species');
  openSpeciesDetail(sp, { fromUser: true });
}

export function registerFromIdentification() {
  if (!S.lastIdentify || !S.lastIdentify.is_plant) return;
  const c = S.lastIdentify.main;
  openAddSpeciesModal();
  $('specieName').value = c.name;
  $('specieScientific').value = c.scientific_name || '';
  if (c.water_days) $('specieWaterDays').value = c.water_days;
  if (c.light) $('fieldLight').value = c.light;
  if (c.pet_toxicity) $('fieldPetToxicity').value = c.pet_toxicity;
  if (S.aiImage) {
    S.speciePhoto = S.aiImage;
    const pv = $('speciePhotoPreview');
    pv.src = S.aiImage;
    pv.style.display = 'block';
  }
  toast('Dados preenchidos! Use ✨ para completar a ficha de cuidados.');
}
