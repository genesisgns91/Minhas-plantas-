import { arrayUnion } from './firebase.js';

// ==================== FOTOS / GALERIA DO VASO ====================
// Fonte única das fotos de um vaso, em ordem cronológica (da mais antiga para a mais nova).
// Vasos antigos (só com o campo `photo`) continuam funcionando.
export function vasePhotos(vase) {
  const hist = (vase.photoHistory || [])
    .filter(p => p && p.photo)
    .map(p => ({ photo: p.photo, date: p.date, publicId: p.publicId, raw: p }));
  hist.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!hist.length && vase.photo) {
    return [{ photo: vase.photo, date: vase.createdAt || new Date().toISOString(), legacy: true }];
  }
  return hist;
}

export function vaseCover(vase) {
  const photos = vasePhotos(vase);
  return photos.length ? photos[photos.length - 1].photo : '';
}

export function docBytes(vase) {
  try {
    const rest = { ...vase };
    delete rest.firestoreId;
    return JSON.stringify(rest).length;
  } catch (e) { return 0; }
}

// Monta o update que adiciona uma foto à galeria (migrando a foto antiga do campo `photo`, se existir).
// `stored` = { photo, publicId? } vindo de storePhoto().
export function buildPhotoAddPayload(vase, stored) {
  const now = new Date().toISOString();
  const entries = [];
  const hasHistory = (vase.photoHistory || []).some(p => p && p.photo);
  if (!hasHistory && vase.photo) entries.push({ photo: vase.photo, date: vase.createdAt || now });
  entries.push({ ...stored, date: now });
  const payload = { photoHistory: arrayUnion(...entries) };
  if (vase.photo) payload.photo = ''; // a capa passa a ser sempre a foto mais recente da galeria
  return payload;
}
