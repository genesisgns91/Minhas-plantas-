// Ponto único de acesso ao Firebase (Auth + Firestore). Os demais módulos importam daqui.
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, collection, query, where, onSnapshot, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, writeBatch, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { FIREBASE_CONFIG } from './config.js';

const app = initializeApp(FIREBASE_CONFIG);
export const db = getFirestore(app);
export const auth = getAuth(app);

export const speciesCol = collection(db, 'species');
export const vasesCol = collection(db, 'vases');

export {
  collection, query, where, onSnapshot, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, writeBatch,
  arrayUnion, arrayRemove, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut
};
