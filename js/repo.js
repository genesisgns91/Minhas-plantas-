// Escritas no Firestore: todo documento novo recebe o dono (ownerId) e exclusões devolvem uma função "desfazer".
import { S } from './state.js';
import { db, doc, addDoc, setDoc, updateDoc, deleteDoc, speciesCol, vasesCol } from './firebase.js';

const stripId = ({ firestoreId, ...rest }) => rest;
const owned = (data) => ({ ...data, ownerId: S.user.uid });

export const addSpecies = (data) => addDoc(speciesCol, owned(data));
export const addVase = (data) => addDoc(vasesCol, owned(data));
export const patchSpecies = (id, payload) => updateDoc(doc(db, 'species', id), payload);
export const patchVase = (id, payload) => updateDoc(doc(db, 'vases', id), payload);

/** Recria um documento excluído com o mesmo id (usado pelo "Desfazer"). */
export const restoreDoc = (col, item) => setDoc(doc(db, col, item.firestoreId), owned(stripId(item)));

export async function deleteVaseDoc(vase) {
  await deleteDoc(doc(db, 'vases', vase.firestoreId));
  return () => restoreDoc('vases', vase);
}

export async function deleteSpeciesCascade(species, vases) {
  await Promise.all(vases.map(v => deleteDoc(doc(db, 'vases', v.firestoreId))));
  await deleteDoc(doc(db, 'species', species.firestoreId));
  return async () => {
    await restoreDoc('species', species);
    await Promise.all(vases.map(v => restoreDoc('vases', v)));
  };
}
