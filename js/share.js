// Compartilhar: ficha da planta (imagem), antes e depois (imagem) e vídeo curto da evolução.
// Tudo é desenhado num <canvas> no próprio aparelho; nada é enviado para servidores.
import { S } from './state.js';
import { $, esc, daysBetween, fmtDate, downloadBlob, slugify } from './utils.js';
import { thumb } from './images.js';
import { vasePhotos } from './photos.js';
import { openDrawer } from './ui/drawers.js';
import { toast } from './ui/feedback.js';
import { speciesOfVase, vasesOf } from './care.js';

const C = { forest: '#1b2d1a', moss: '#2f4a2c', leaf: '#8fcf80', petal: '#e9a8b5', cream: '#f6f4ee', terra: '#c16e41' };
const SERIF = '"Playfair Display", Georgia, serif';
const SANS = '"DM Sans", system-ui, sans-serif';

// ---------- Desenho ----------
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Desenha a imagem preenchendo o retângulo (como object-fit: cover), com zoom opcional. */
export function drawCover(ctx, img, x, y, w, h, zoom = 1) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    cut[maxLines - 1] = last.replace(/[\s,.;:]+$/, '') + '…';
    return cut;
  }
  return lines;
}

function background(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, C.moss); g.addColorStop(1, C.forest);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.07; ctx.fillStyle = '#ffffff';
  [[W - 120, 160, 260], [80, H - 220, 200], [W - 60, H - 380, 120]].forEach(([cx, cy, r]) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); });
  ctx.restore();
}

function footer(ctx, W, H, rightText) {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.petal; ctx.font = `700 34px ${SERIF}`; ctx.textAlign = 'left';
  ctx.fillText('🌿 Minhas Plantas', 70, H - 52);
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `500 26px ${SANS}`; ctx.textAlign = 'right';
  ctx.fillText(rightText, W - 70, H - 52);
  ctx.textAlign = 'left';
}

function photoFrame(ctx, img, x, y, w, h, r, fallbackIcon) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r); ctx.clip();
  if (img) drawCover(ctx, img, x, y, w, h);
  else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#dbe4d8'); g.addColorStop(1, '#bcd0b6');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.font = `${Math.round(h * 0.4)}px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000'; ctx.fillText(fallbackIcon || '🪴', x + w / 2, y + h / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 4; roundRect(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore();
}

/** Dados exibidos na ficha, na ordem de prioridade (até 4). */
export function ficheChips(sp) {
  const water = sp.water ? sp.water + (sp.waterDays ? ` · a cada ${sp.waterDays} dias` : '') : (sp.waterDays ? `A cada ${sp.waterDays} dias` : '');
  const pet = sp.petToxicity ? sp.petToxicity + (sp.petWarning ? ` — ${sp.petWarning}` : '') : '';
  return [['☀️', 'Luz', sp.light], ['💧', 'Rega', water], ['🐾', 'Pets', pet], ['🪴', 'Solo', sp.soil], ['💦', 'Umidade', sp.humidity], ['🧪', 'Adubação', sp.fertilizer]]
    .filter(c => c[2]).slice(0, 4);
}

export function drawSpeciesCard(ctx, W, H, d, img) {
  background(ctx, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.petal; ctx.font = `700 26px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillText('FICHA DA PLANTA', 70, 92);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  // O quadro da foto se ajusta ao tamanho do texto: nome (1 ou 2 linhas), nome científico e cartões.
  ctx.font = `700 76px ${SERIF}`;
  const nameLines = wrapLines(ctx, d.name, W - 140, 2);
  const chips = d.chips || [];
  const rows = Math.ceil(chips.length / 2), CH = 132, GAP = 18;
  const chipsH = rows ? rows * CH + (rows - 1) * GAP : 0;
  const textBlock = 62 + (nameLines.length - 1) * 84 + (d.scientific ? 50 : 0) + 16;
  const photoY = 124, footerTop = H - 120;
  const photoH = Math.max(360, Math.min(700, footerTop - photoY - 36 - textBlock - (rows ? 30 + chipsH : 0) - 30));
  photoFrame(ctx, img, 70, photoY, W - 140, photoH, 40, d.icon);

  let y = photoY + photoH + 36 + 62;
  ctx.fillStyle = '#ffffff'; ctx.font = `700 76px ${SERIF}`;
  nameLines.forEach((l, i) => ctx.fillText(l, 70, y + i * 84));
  y += (nameLines.length - 1) * 84;
  if (d.scientific) {
    ctx.fillStyle = C.leaf; ctx.font = `italic 400 34px ${SERIF}`;
    ctx.fillText(wrapLines(ctx, d.scientific, W - 140, 1)[0], 70, y + 50);
    y += 50;
  }

  const cw = (W - 140 - 24) / 2;
  const top = y + 16 + 30;
  chips.forEach((c, i) => {
    const cx = 70 + (i % 2) * (cw + 24), cy = top + Math.floor(i / 2) * (CH + GAP);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(ctx, cx, cy, cw, CH, 28); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.font = `700 22px ${SANS}`;
    ctx.fillText(`${c[0]}  ${c[1].toUpperCase()}`, cx + 28, cy + 40);
    ctx.fillStyle = '#ffffff'; ctx.font = `500 27px ${SANS}`;
    wrapLines(ctx, c[2], cw - 56, 2).forEach((l, k) => ctx.fillText(l, cx + 28, cy + 80 + k * 32));
  });
  footer(ctx, W, H, d.footer || '');
}

export function drawBeforeAfter(ctx, W, H, d, imgA, imgB) {
  background(ctx, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.petal; ctx.font = `700 26px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillText('EVOLUÇÃO', 70, 92);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = '#ffffff'; ctx.font = `700 68px ${SERIF}`;
  const lines = wrapLines(ctx, d.title, W - 140, 2);
  lines.forEach((l, i) => ctx.fillText(l, 70, 168 + i * 76));
  if (d.subtitle) { ctx.fillStyle = C.leaf; ctx.font = `italic 400 32px ${SERIF}`; ctx.fillText(d.subtitle, 70, 168 + lines.length * 76 - 14); }

  const pw = 470, ph = 700, py = 330, gap = 40, px = (W - pw * 2 - gap) / 2;
  photoFrame(ctx, imgA, px, py, pw, ph, 34, d.icon);
  photoFrame(ctx, imgB, px + pw + gap, py, pw, ph, 34, d.icon);
  [[d.dateA, 'ANTES', px], [d.dateB, 'DEPOIS', px + pw + gap]].forEach(([date, label, x]) => {
    ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = `700 24px ${SANS}`; ctx.fillText(label, x + 8, py + ph + 56);
    ctx.fillStyle = '#ffffff'; ctx.font = `600 34px ${SANS}`; ctx.fillText(date, x + 8, py + ph + 100);
  });
  // selo com os dias de crescimento
  const bx = W / 2, by = py + ph / 2;
  ctx.fillStyle = C.terra; ctx.beginPath(); ctx.arc(bx, by, 78, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
  ctx.font = `700 46px ${SERIF}`; ctx.fillText(`+${d.days}`, bx, by + 6);
  ctx.font = `600 22px ${SANS}`; ctx.fillText(d.days === 1 ? 'dia' : 'dias', bx, by + 38);
  ctx.textAlign = 'left';
  footer(ctx, W, H, d.footer || '');
}

// ---------- Vídeo ----------
export const VIDEO = { W: 720, H: 960, FRAME_MS: 1400, FADE_MS: 380 };

/** Desenha o quadro do vídeo no instante t (ms): foto atual com zoom suave, transição e legendas. */
export function drawVideoFrame(ctx, frames, t, meta) {
  const { W, H, FRAME_MS, FADE_MS } = VIDEO;
  const total = frames.length * FRAME_MS;
  const tt = Math.min(Math.max(t, 0), total - 1);
  const idx = Math.min(frames.length - 1, Math.floor(tt / FRAME_MS));
  const local = tt - idx * FRAME_MS;
  ctx.fillStyle = '#10170f'; ctx.fillRect(0, 0, W, H);
  drawCover(ctx, frames[idx].img, 0, 0, W, H, 1 + 0.06 * (local / FRAME_MS));
  if (idx < frames.length - 1 && local > FRAME_MS - FADE_MS) {
    ctx.save();
    ctx.globalAlpha = (local - (FRAME_MS - FADE_MS)) / FADE_MS;
    drawCover(ctx, frames[idx + 1].img, 0, 0, W, H, 1);
    ctx.restore();
  }
  const shown = idx < frames.length - 1 && local > FRAME_MS - FADE_MS / 2 ? idx + 1 : idx;
  const g1 = ctx.createLinearGradient(0, 0, 0, 260); g1.addColorStop(0, 'rgba(10,18,9,.7)'); g1.addColorStop(1, 'rgba(10,18,9,0)');
  ctx.fillStyle = g1; ctx.fillRect(0, 0, W, 260);
  const g2 = ctx.createLinearGradient(0, H - 340, 0, H); g2.addColorStop(0, 'rgba(10,18,9,0)'); g2.addColorStop(1, 'rgba(10,18,9,.8)');
  ctx.fillStyle = g2; ctx.fillRect(0, H - 340, W, 340);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff'; ctx.font = `700 46px ${SERIF}`;
  ctx.fillText(wrapLines(ctx, meta.title, W - 100, 1)[0], 50, 92);
  if (meta.subtitle) { ctx.fillStyle = C.leaf; ctx.font = `italic 400 26px ${SERIF}`; ctx.fillText(meta.subtitle, 50, 134); }

  const f = frames[shown];
  ctx.fillStyle = '#ffffff'; ctx.font = `700 54px ${SERIF}`;
  ctx.fillText(f.dateLabel, 50, H - 128);
  const days = f.days;
  const label = days === 0 ? '🌱 Início da jornada' : `🌿 +${days} ${days === 1 ? 'dia' : 'dias'}`;
  ctx.font = `600 30px ${SANS}`;
  const tw = ctx.measureText(label).width + 44;
  ctx.fillStyle = days === 0 ? 'rgba(255,255,255,.2)' : C.terra; roundRect(ctx, 50, H - 104, tw, 52, 26); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillText(label, 72, H - 68);
  ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(50, H - 36, W - 100, 6);
  ctx.fillStyle = C.petal; ctx.fillRect(50, H - 36, (W - 100) * (tt / total), 6);
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = `600 22px ${SERIF}`; ctx.textAlign = 'right';
  ctx.fillText('🌿 Minhas Plantas', W - 50, 134 + (meta.subtitle ? 0 : -40));
  ctx.textAlign = 'left';
}

export function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || null;
}

/** Até `max` fotos, escolhidas de forma uniforme (sempre com a primeira e a última). */
export function sampleEvenly(list, max = 12) {
  if (list.length <= max) return list;
  return Array.from({ length: max }, (_, i) => list[Math.round(i * (list.length - 1) / (max - 1))]);
}

function recordVideo(canvas, ctx, frames, meta, onProgress) {
  const mime = pickVideoMime();
  if (!mime) return Promise.reject(new Error('Este navegador não consegue gerar vídeos. Use a imagem “antes e depois” ou tente no Chrome/Safari atualizado.'));
  const total = frames.length * VIDEO.FRAME_MS;
  return new Promise((resolve, reject) => {
    const chunks = [];
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 3500000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = () => reject(new Error('Falha ao gravar o vídeo.'));
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    rec.start();
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      drawVideoFrame(ctx, frames, Math.min(t, total - 1), meta);
      if (onProgress) onProgress(Math.min(1, t / total));
      if (t < total + 250) requestAnimationFrame(tick); else rec.stop();
    };
    tick();
  });
}

// ---------- Carregamento de imagens e contexto ----------
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar uma das fotos.'));
    img.src = url;
  });
}
async function loadPhoto(url) {
  try { return await loadImage(thumb(url, 1400)); } catch (e) { return loadImage(url); }
}
async function fontsReady() {
  try { await Promise.all([document.fonts.load(`700 64px ${SERIF}`), document.fonts.load(`italic 400 32px ${SERIF}`), document.fonts.load(`500 28px ${SANS}`)]); } catch (e) { /* usa as fontes de reserva */ }
}
const canvasBlob = (canvas) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Não foi possível gerar a imagem.')), 'image/png'));

const ctxState = { kind: null, id: null, result: null };

function context() {
  if (ctxState.kind === 'vase') {
    const vase = S.vases.find(v => v.firestoreId === ctxState.id);
    return vase ? { vase, species: speciesOfVase(vase), photos: vasePhotos(vase) } : null;
  }
  const species = S.species.find(s => s.firestoreId === ctxState.id);
  if (!species) return null;
  const all = vasesOf(species).flatMap(v => vasePhotos(v)).sort((a, b) => new Date(a.date) - new Date(b.date));
  return { species, vase: null, photos: all };
}

function coverUrl(ctx) {
  if (ctx.vase && ctx.photos.length) return ctx.photos[ctx.photos.length - 1].photo;
  if (ctx.species.photo) return ctx.species.photo;
  return ctx.photos.length ? ctx.photos[ctx.photos.length - 1].photo : '';
}

// ---------- Geradores ----------
export async function buildFicheBlob() {
  const c = context();
  const url = coverUrl(c);
  const [img] = await Promise.all([url ? loadPhoto(url).catch(() => null) : null, fontsReady()]);
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  drawSpeciesCard(canvas.getContext('2d'), 1080, 1350, {
    name: c.species.name, scientific: c.species.scientific, icon: c.species.icon, chips: ficheChips(c.species),
    footer: new Date().toLocaleDateString('pt-BR')
  }, img);
  return { blob: await canvasBlob(canvas), filename: `ficha-${slugify(c.species.name)}.png`, text: `Ficha da planta: ${c.species.name}` };
}

export async function buildBeforeAfterBlob() {
  const c = context();
  const a = c.photos[0], b = c.photos[c.photos.length - 1];
  const [imgA, imgB] = await Promise.all([loadPhoto(a.photo), loadPhoto(b.photo), fontsReady()]);
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  drawBeforeAfter(canvas.getContext('2d'), 1080, 1350, {
    title: c.vase.name, subtitle: c.species ? c.species.name : '', icon: c.vase.icon,
    dateA: fmtDate(a.date), dateB: fmtDate(b.date), days: Math.max(0, daysBetween(new Date(a.date), new Date(b.date))),
    footer: new Date().toLocaleDateString('pt-BR')
  }, imgA, imgB);
  return { blob: await canvasBlob(canvas), filename: `evolucao-${slugify(c.vase.name)}.png`, text: `Evolução de ${c.vase.name}` };
}

export async function buildVideoBlob(onProgress) {
  const c = context();
  const picked = sampleEvenly(c.photos, 12);
  const first = new Date(picked[0].date);
  const [imgs] = await Promise.all([Promise.all(picked.map(p => loadPhoto(p.photo))), fontsReady()]);
  const frames = picked.map((p, i) => ({ img: imgs[i], dateLabel: fmtDate(p.date), days: Math.max(0, daysBetween(first, new Date(p.date))) }));
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO.W; canvas.height = VIDEO.H;
  const blob = await recordVideo(canvas, canvas.getContext('2d'), frames, { title: c.vase.name, subtitle: c.species ? c.species.name : '' }, onProgress);
  return { blob, filename: `evolucao-${slugify(c.vase.name)}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, text: `Evolução de ${c.vase.name}` };
}

// ---------- Interface ----------
export function openShare(kind, id) {
  ctxState.kind = kind; ctxState.id = id; ctxState.result = null;
  const c = context();
  if (!c) return;
  const opts = [{ id: 'fiche', icon: '🪪', title: 'Ficha da planta', desc: 'Imagem com foto e cuidados principais', ok: true }];
  if (kind === 'vase') {
    opts.push({ id: 'beforeafter', icon: '🔀', title: 'Antes e depois', desc: c.photos.length >= 2 ? 'Primeira e última foto lado a lado, com os dias de crescimento' : 'Precisa de pelo menos 2 fotos', ok: c.photos.length >= 2 });
    opts.push({ id: 'video', icon: '🎬', title: 'Vídeo da evolução', desc: c.photos.length >= 2 ? `Slideshow de ${Math.min(12, c.photos.length)} fotos, cerca de ${Math.round(Math.min(12, c.photos.length) * VIDEO.FRAME_MS / 1000)} s` : 'Precisa de pelo menos 2 fotos', ok: c.photos.length >= 2 && !!pickVideoMime() });
  }
  $('shareTitle').textContent = kind === 'vase' ? `Compartilhar · ${c.vase.name}` : `Compartilhar · ${c.species.name}`;
  $('shareOptions').innerHTML = opts.map(o => `<button class="share-opt" ${o.ok ? '' : 'disabled'} onclick="runShare('${o.id}')">
      <span class="share-ico" aria-hidden="true">${o.icon}</span><span><b>${o.title}</b><small>${esc(o.ok ? o.desc : (o.id === 'video' && c.photos.length >= 2 ? 'Seu navegador não suporta gravar vídeo' : o.desc))}</small></span></button>`).join('');
  $('sharePreview').innerHTML = '<p class="muted">Escolha uma opção acima para gerar a prévia.</p>';
  openDrawer('drawerShare');
}

export async function runShare(option) {
  const box = $('sharePreview');
  box.innerHTML = '<div class="loader"><i></i><i></i><i></i> <span id="shareLoadMsg">Gerando…</span></div>';
  document.querySelectorAll('#shareOptions button').forEach(b => { b.disabled = true; });
  try {
    const result = option === 'video'
      ? await buildVideoBlob((p) => { const el = $('shareLoadMsg'); if (el) el.textContent = `Gravando o vídeo… ${Math.round(p * 100)}%`; })
      : option === 'beforeafter' ? await buildBeforeAfterBlob() : await buildFicheBlob();
    ctxState.result = result;
    const url = URL.createObjectURL(result.blob);
    const media = result.blob.type.startsWith('video')
      ? `<video src="${url}" controls playsinline loop muted autoplay aria-label="Prévia do vídeo"></video>`
      : `<img src="${url}" alt="Prévia da imagem gerada" />`;
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([result.blob], result.filename, { type: result.blob.type })] }));
    box.innerHTML = `${media}<div class="share-actions">
      ${canShare ? '<button class="btn btn-primary" onclick="shareResult()">📤 Compartilhar</button>' : ''}
      <button class="btn ${canShare ? 'btn-secondary' : 'btn-primary'}" onclick="downloadShareResult()">⬇ Baixar</button></div>`;
  } catch (err) {
    box.innerHTML = `<p class="share-error" role="alert">😕 ${esc(err.message || 'Não foi possível gerar.')}</p>`;
  } finally {
    const c = context();
    if (c) openShareOptionsRefresh(c);
  }
}

function openShareOptionsRefresh(c) {
  // reabilita as opções que continuam válidas
  document.querySelectorAll('#shareOptions button').forEach(b => {
    const id = (b.getAttribute('onclick') || '').match(/runShare\('(\w+)'\)/);
    if (!id) return;
    b.disabled = (id[1] !== 'fiche' && c.photos.length < 2) || (id[1] === 'video' && !pickVideoMime());
  });
}

export async function shareResult() {
  const r = ctxState.result;
  if (!r) return;
  try {
    await navigator.share({ files: [new File([r.blob], r.filename, { type: r.blob.type })], title: 'Minhas Plantas', text: r.text });
  } catch (err) {
    if (err && err.name !== 'AbortError') toast('Não foi possível compartilhar. Use o botão Baixar.', 'error');
  }
}

export function downloadShareResult() {
  const r = ctxState.result;
  if (r) { downloadBlob(r.blob, r.filename); toast('Arquivo salvo ⬇'); }
}

export function shareCurrentVase() { if (S.detailVaseId) openShare('vase', S.detailVaseId); }
export function shareCurrentSpecies() { if (S.selectedSpecies) openShare('species', S.selectedSpecies.firestoreId); }
