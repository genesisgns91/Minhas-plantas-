import { $, isDataUrl } from './utils.js';
export { isDataUrl };
import { CLOUDINARY } from './config.js';
import { toast } from './ui/feedback.js';
import { S } from './state.js';

// ==================== COMPRESSÃO DE IMAGEM ====================
// Fotos de câmera chegam com vários MB e estouravam o limite de 1MB por documento do Firestore.
// TODA imagem passa por redimensionamento/compressão via canvas antes de virar base64.
export function compressImage(file, { maxDim = 1280, initialQuality = 0.75, maxBytes = 700000 } = {}) {
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

// ---------- Tamanho das fotos ----------
// Sem Cloudinary configurado, as fotos ficam dentro do documento do Firestore (limite de 1 MB), então
// precisam ser bem pequenas. Com Cloudinary elas são hospedadas fora e podem ter mais qualidade.
export const GALLERY_OPTS = { maxDim: 1080, initialQuality: 0.72, maxBytes: 95000 };
export const CLOUD_OPTS = { maxDim: 1600, initialQuality: 0.82, maxBytes: 900000 };
export const DOC_LIMIT_BYTES = 1048576;
export const DOC_SAFE_BYTES = 980000;

export function dataURLToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: mime });
}

// ==================== CLOUDINARY ====================
export const isCloudUrl = (v) => typeof v === 'string' && /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(v);
export const isCloudConfigured = () => !!CLOUDINARY.cloudName && !/^SEU_/i.test(CLOUDINARY.cloudName);

/** Opções de compressão adequadas ao destino da foto (Cloudinary ou dentro do documento). */
export function photoOptions(forGallery = true) {
  if (isCloudConfigured()) return CLOUD_OPTS;
  return forGallery ? GALLERY_OPTS : undefined;
}

const PRESET_KEY = 'minhasplantas_cloud_preset';
function orderedPresets() {
  let saved = null;
  try { saved = localStorage.getItem(PRESET_KEY); } catch (e) { /* ignora */ }
  const list = [...CLOUDINARY.presets];
  return saved && list.includes(saved) ? [saved, ...list.filter(p => p !== saved)] : list;
}

function cloudError(message) {
  let friendly = message;
  if (/invalid cloud_name/i.test(message)) friendly = 'O “cloud name” do Cloudinary está incorreto. Confira em js/config.js.';
  else if (/preset/i.test(message) && /not found/i.test(message)) friendly = 'O preset do Cloudinary não foi encontrado. Confira o nome em js/config.js.';
  else if (/unsigned/i.test(message)) friendly = 'O preset do Cloudinary precisa estar no modo “Unsigned”.';
  else if (/file size too large|too large/i.test(message)) friendly = 'A foto é grande demais para o Cloudinary.';
  const err = new Error(friendly);
  err.cloud = true;
  return err;
}

/**
 * Envia uma foto ao Cloudinary (upload “unsigned”). Aceita data URL ou Blob.
 * Se o primeiro nome de preset não existir, tenta os demais da lista e lembra o que funcionou.
 */
export async function uploadImage(source, { tags = [] } = {}) {
  if (!isCloudConfigured()) throw cloudError('Cloudinary não configurado');
  const blob = typeof source === 'string' ? dataURLToBlob(source) : source;
  let lastMessage = '';
  for (const preset of orderedPresets()) {
    const fd = new FormData();
    fd.append('file', blob, 'planta.jpg');
    fd.append('upload_preset', preset);
    if (tags.length) fd.append('tags', tags.join(','));
    let res, json = {};
    try {
      res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`, { method: 'POST', body: fd });
      json = await res.json().catch(() => ({}));
    } catch (e) {
      throw cloudError('Sem conexão com o Cloudinary. Verifique a internet e tente de novo.');
    }
    if (res.ok && json.secure_url) {
      try { localStorage.setItem(PRESET_KEY, preset); } catch (e) { /* ignora */ }
      return { url: json.secure_url, publicId: json.public_id, width: json.width, height: json.height };
    }
    lastMessage = (json.error && json.error.message) || `Erro ${res.status}`;
    if (/preset/i.test(lastMessage) && /(not found|invalid|disabled)/i.test(lastMessage)) continue; // tenta o próximo nome
    throw cloudError(lastMessage);
  }
  throw cloudError(lastMessage || 'Falha no envio da foto');
}

/** Dado uma foto pronta (data URL), devolve os campos a gravar: URL do Cloudinary, ou a própria data URL. */
export async function storePhoto(dataUrl, tags = []) {
  if (isDataUrl(dataUrl) && isCloudConfigured()) {
    const up = await uploadImage(dataUrl, { tags });
    return { photo: up.url, publicId: up.publicId };
  }
  return { photo: dataUrl };
}

/** Versão menor da foto (miniaturas) — só para URLs do Cloudinary; outras ficam como estão. */
export function thumb(url, width = 480) {
  if (!isCloudUrl(url) || /\/upload\/(c_|w_|q_|f_)/.test(url)) return url;
  return url.replace('/upload/', `/upload/c_limit,w_${width},q_auto,f_auto/`);
}

/** Atributos de <img> com miniatura e retorno automático para a original se a miniatura falhar. */
export function imgSrc(url, width = 480) {
  const t = thumb(url, width);
  const safe = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return t === url ? `src="${safe(url)}"` : `src="${safe(t)}" data-full="${safe(url)}"`;
}

// Se uma miniatura não carregar (ex.: transformações bloqueadas na conta), usa a imagem original
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img && img.tagName === 'IMG' && img.dataset && img.dataset.full) {
    const full = img.dataset.full;
    delete img.dataset.full;
    img.src = full;
  }
}, true);

// Liga um par de inputs (galeria + câmera) a um callback; devolve a função que processa um File
function wireImagePicker(galleryInputId, cameraInputId, previewId, onSelect, options) {
  const galleryInput = $(galleryInputId);
  const cameraInput = $(cameraInputId);
  const preview = previewId ? $(previewId) : null;

  async function processFile(file) {
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, typeof options === 'function' ? options() : options);
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

wireImagePicker('speciePhotoGallery', 'speciePhotoCamera', 'speciePhotoPreview', (d) => { S.speciePhoto = d; }, () => photoOptions(false));
wireImagePicker('vasePhotoGallery', 'vasePhotoCamera', 'vasePhotoPreview', (d) => { S.vasePhoto = d; }, () => photoOptions(true));
const processAiFile = wireImagePicker('aiImageGallery', 'aiImageCamera', 'aiImagePreview', (d) => { S.aiImage = d; });

// Arrastar e soltar foto no diagnóstico
(function initDropzone() {
  const dz = $('aiDropzone');
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => processAiFile(e.dataTransfer && e.dataTransfer.files[0]));
})();
