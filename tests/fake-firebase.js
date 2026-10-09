// Firebase falso, em memória, usado só nos testes (Auth + Firestore com consultas por ownerId).
const st = globalThis.__fbstate = globalThis.__fbstate || {
  data: { species: {}, vases: {}, users: {} }, subs: [], authSubs: [], user: null, idc: 0, log: [],
  popupUser: null, popupError: null
};
const clone = (o) => JSON.parse(JSON.stringify(o));

function applyPayload(d, payload) {
  for (const [k, v] of Object.entries(payload)) {
    if (v && v.__op === 'union') { d[k] = d[k] || []; v.items.forEach(it => { if (!d[k].some(x => JSON.stringify(x) === JSON.stringify(it))) d[k].push(clone(it)); }); }
    else if (v && v.__op === 'remove') { d[k] = (d[k] || []).filter(x => !v.items.some(it => JSON.stringify(it) === JSON.stringify(x))); }
    else d[k] = v;
  }
}
const matches = (d, wheres) => wheres.every(w => w.op === '==' ? d[w.field] === w.value : true);
const docsOf = (name, wheres = []) => Object.entries(st.data[name]).filter(([, d]) => matches(d, wheres))
  .map(([id, d]) => ({ id, ref: { col: name, id }, data: () => clone(d), exists: () => true }));
const snapOf = (name, wheres) => { const docs = docsOf(name, wheres); return { docs, size: docs.length, forEach: (fn) => docs.forEach(fn) }; };
const targetOf = (t) => t.kind === 'query' ? { name: t.col.name, wheres: t.wheres } : { name: t.name, wheres: [] };

st.fire = (name) => st.subs.filter(s => s.name === name && s.active).forEach(s => s.cb(snapOf(s.name, s.wheres)));
st.setUser = (u) => { st.user = u; st.authSubs.forEach(cb => cb(u)); };
st.reset = () => { st.data.species = {}; st.data.vases = {}; st.data.users = {}; st.subs.length = 0; st.log.length = 0; };

export const initializeApp = () => ({});
export const getFirestore = () => ({});
export const getAuth = () => ({});
export const collection = (db, name) => ({ kind: 'col', name });
export const where = (field, op, value) => ({ field, op, value });
export const query = (col, ...wheres) => ({ kind: 'query', col, wheres });
export const doc = (db, col, id) => ({ col, id });
export const arrayUnion = (...items) => ({ __op: 'union', items });
export const arrayRemove = (...items) => ({ __op: 'remove', items });

export const onSnapshot = (target, cb) => {
  const { name, wheres } = targetOf(target);
  const sub = { name, wheres, cb, active: true };
  st.subs.push(sub);
  setTimeout(() => { if (sub.active) cb(snapOf(name, wheres)); }, 0);
  return () => { sub.active = false; };
};
export const addDoc = async (c, d) => { const id = 'id' + (++st.idc); st.data[c.name][id] = clone(d); st.log.push(['add', c.name, id]); st.fire(c.name); return { id }; };
export const setDoc = async (r, d, opts) => {
  st.data[r.col] = st.data[r.col] || {};
  st.data[r.col][r.id] = opts && opts.merge ? { ...(st.data[r.col][r.id] || {}), ...clone(d) } : clone(d);
  st.log.push(['set', r.col, r.id]); st.fire(r.col);
};
export const updateDoc = async (r, p) => {
  if (!st.data[r.col][r.id]) throw new Error('No document to update: ' + r.col + '/' + r.id);
  applyPayload(st.data[r.col][r.id], p); st.log.push(['update', r.col, r.id]); st.fire(r.col);
};
export const deleteDoc = async (r) => { delete st.data[r.col][r.id]; st.log.push(['delete', r.col, r.id]); st.fire(r.col); };
export const getDoc = async (r) => { const d = (st.data[r.col] || {})[r.id]; return { exists: () => !!d, data: () => clone(d || {}), id: r.id }; };
export const getDocs = async (t) => { const { name, wheres } = targetOf(t); return snapOf(name, wheres); };
export const writeBatch = () => {
  const ops = [];
  return {
    update: (r, p) => ops.push(() => applyPayload(st.data[r.col][r.id], p)),
    set: (r, d) => ops.push(() => { st.data[r.col][r.id] = clone(d); }),
    delete: (r) => ops.push(() => { delete st.data[r.col][r.id]; }),
    commit: async () => { ops.forEach(f => f()); ['species', 'vases'].forEach(n => st.fire(n)); }
  };
};

export const onAuthStateChanged = (a, cb) => { st.authSubs.push(cb); setTimeout(() => cb(st.user), 0); return () => {}; };
export class GoogleAuthProvider { setCustomParameters() {} }
export const signInWithPopup = async () => { if (st.popupError) throw st.popupError; st.setUser(st.popupUser); return { user: st.popupUser }; };
export const signInWithRedirect = async () => { st.log.push(['redirect']); };
export const getRedirectResult = async () => null;
export const signOut = async () => { st.setUser(null); };
