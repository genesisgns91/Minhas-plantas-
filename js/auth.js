// Login com Google (Firebase Auth) e estado visual do app: carregando | deslogado | logado.
import { S } from './state.js';
import { $ } from './utils.js';
import {
  auth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut
} from './firebase.js';
import { toast } from './ui/feedback.js';

export function setAppState(state) {
  document.body.classList.remove('auth-loading', 'signed-out', 'signed-in');
  document.body.classList.add(state);
  const app = document.querySelector('.app-layout');
  const bottom = document.querySelector('.bottom-nav');
  const hide = state !== 'signed-in';
  [app, bottom].forEach(el => { if (el) { el.inert = hide; el.setAttribute('aria-hidden', String(hide)); } });
  const login = $('loginScreen');
  if (login) { login.hidden = state !== 'signed-out'; login.inert = state !== 'signed-out'; }
  const splash = $('splash');
  if (splash) splash.hidden = state !== 'auth-loading';
}

export function firstName(user) {
  const n = (user && (user.displayName || user.email) || '').trim();
  return n.split(/[\s@]/)[0] || '';
}

/** Chama onUser(user|null) na entrada, na saída e ao restaurar a sessão. */
export function initAuth(onUser) {
  setAppState('auth-loading');
  setTimeout(() => {
    const msg = document.querySelector('#splash p');
    if (document.body.classList.contains('auth-loading') && msg) msg.textContent = 'Está demorando mais que o normal… confira sua conexão com a internet.';
  }, 12000);
  getRedirectResult(auth).catch(err => showLoginError(err));
  onAuthStateChanged(auth, (user) => { S.user = user; onUser(user); });
}

export async function signInWithGoogle() {
  const btn = $('loginBtn');
  if (btn) btn.disabled = true;
  showLoginError(null);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err && ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err.code)) {
      try { await signInWithRedirect(auth, provider); return; } catch (e2) { err = e2; }
    }
    if (!err || err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') showLoginError(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function signOutUser() {
  try { await signOut(auth); toast('Você saiu da conta.'); } catch (err) { toast('Não foi possível sair: ' + err.message, 'error'); }
}

const LOGIN_ERRORS = {
  'auth/unauthorized-domain': 'Este endereço ainda não foi autorizado no Firebase (Authentication → Configurações → Domínios autorizados).',
  'auth/operation-not-allowed': 'O login com Google ainda não foi ativado no Firebase (Authentication → Método de login).',
  'auth/network-request-failed': 'Sem conexão com a internet. Verifique e tente novamente.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente de novo.'
};

export function showLoginError(err) {
  const el = $('loginError');
  if (!el) return;
  if (!err) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = LOGIN_ERRORS[err.code] || ('Não foi possível entrar: ' + (err.message || err));
}
