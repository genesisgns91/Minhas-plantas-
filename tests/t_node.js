const ROOT = require('path').resolve(__dirname, '..');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execSync } = require('child_process');
const ExcelJS = require('exceljs');
let fails = 0, passes = 0;
const check = (n, c, x = '') => { if (c) { passes++; console.log('  ✔', n); } else { fails++; console.log('  ✘', n, x); } };
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString();

(async () => {
  console.log('1) Planilha Excel');
  execSync(`node -e "import('./bundle.mjs').then(m => m.bundle({ entry: '${ROOT}/js/excel.js', out: '/tmp/excel.cjs', platform: 'node', format: 'cjs' }))"`, { cwd: __dirname, stdio: 'pipe' });
  const { buildWorkbook } = require('/tmp/excel.cjs');
  const species = [
    { firestoreId: 's2', name: 'Samambaia', scientific: 'Nephrolepis', category: 'Folhagem', light: 'Luz indireta', water: 'Frequente', waterDays: 2, humidity: 'Alta', soil: 'Orgânico', fertilizer: 'NPK', naturalFertilizer: 'Borra de café', petToxicity: 'Segura', petWarning: 'Sem riscos', extraTips: 'Borrifar', observations: 'Evitar sol', createdAt: iso(-90), fertilizerDays: 30, pruningDays: 90 },
    { firestoreId: 's1', name: 'Jiboia', scientific: 'Epipremnum aureum', category: 'Trepadeira', light: 'Meia-sombra', waterDays: 3, petToxicity: 'Tóxica', petWarning: 'Irrita a boca' },
    { firestoreId: 's3', name: 'Cacto sem vasos', waterDays: 14 }
  ];
  const cloud = 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg';
  const vases = [
    { firestoreId: 'v1', speciesId: 's1', name: 'Vaso da sala', size: 'Barro 5L', lastWater: iso(-5), lastFertilizer: iso(-40), lastPruning: iso(-100), lastRepot: iso(-200),
      photoHistory: [{ photo: 'data:image/jpeg;base64,AAA', date: iso(-50) }, { photo: cloud, date: iso(-2) }],
      pests: [{ id: 'p1', name: 'Cochonilha', severity: 'grave', status: 'active', date: iso(-6), notes: 'nas folhas', treatments: [{ id: 't1', date: iso(-5), product: 'Óleo de neem', notes: 'à noite', nextDate: iso(1) }] },
              { id: 'p2', name: 'Pulgão', severity: 'leve', status: 'resolved', date: iso(-60), resolvedAt: iso(-50), treatments: [] }], history: [] },
    { firestoreId: 'v2', speciesId: 's1', name: 'Pendente', history: [] },
    { firestoreId: 'v3', speciesId: 's2', name: 'Samambaia da varanda', lastWater: iso(0), history: [], photo: 'data:image/jpeg;base64,BBB' }
  ];
  const wb = buildWorkbook(ExcelJS, species, vases, new Date());
  const buf = await wb.xlsx.writeBuffer();
  fs.writeFileSync('/tmp/teste.xlsx', Buffer.from(buf));
  const back = new ExcelJS.Workbook(); await back.xlsx.load(buf);
  const ws = back.getWorksheet('Vasos');
  const header = ws.getRow(1).values.slice(1);
  check('aba "Vasos" com cabeçalho: espécie primeiro, depois os dados do vaso e da espécie', header[0] === 'Espécie' && header.includes('Vaso') && header.includes('Luz') && header.includes('Adubação natural') && header.includes('Toxicidade para pets') && header.length === 29, header.length + '');
  check('1 linha por vaso, em ordem alfabética de espécie e vaso (Cacto sem vasos; Jiboia: Pendente, Vaso da sala; Samambaia)', ws.rowCount === 1 + 4 && [2, 3, 4, 5].map(r => ws.getRow(r).getCell(4).value).join('|') === '(nenhum vaso)|Pendente|Vaso da sala|Samambaia da varanda', [2, 3, 4, 5].map(r => ws.getRow(r).getCell(4).value).join('|'));
  const r = ws.getRow(4);
  check('dados da espécie repetidos em cada vaso da espécie', r.getCell(1).value === 'Jiboia' && ws.getRow(3).getCell(1).value === 'Jiboia' && r.getCell(2).value === 'Epipremnum aureum' && r.getCell(25).value === 'Tóxica' && r.getCell(26).value === 'Irrita a boca' && r.getCell(18).value === 'Meia-sombra');
  check('datas são datas de verdade do Excel (não texto), com formato dd/mm/aaaa', r.getCell(7).value instanceof Date && r.getCell(7).numFmt === 'dd/mm/yyyy' && r.getCell(10).value instanceof Date && r.getCell(12).value instanceof Date && r.getCell(14).value instanceof Date);
  check('dias desde a rega e ritmo da espécie', r.getCell(8).value === 5 && r.getCell(9).value === 3);
  check('situação da rega em texto (atrasada) e pragas ativas listadas', /Atrasada/.test(r.getCell(6).value) && r.getCell(15).value === 'Cochonilha (grave)' && !/Pulgão/.test(r.getCell(15).value));
  check('nº de fotos e link da foto mais recente (Cloudinary)', r.getCell(16).value === 2 && r.getCell(17).value.hyperlink === cloud && r.getCell(17).value.text === 'Abrir foto');
  check('foto guardada no documento não vira link gigante', ws.getRow(5).getCell(17).value === '(guardada no app)');
  check('espécie sem vasos aparece (em cinza, itálico) para nada se perder', ws.getRow(2).getCell(1).value === 'Cacto sem vasos' && ws.getRow(2).font.italic === true);
  check('linha de cabeçalho: verde escuro, texto branco e negrito; painel congelado e filtro', ws.getRow(1).getCell(1).fill.fgColor.argb === 'FF3A5335' && ws.getRow(1).getCell(1).font.bold === true && ws.views[0].state === 'frozen' && ws.views[0].xSplit === 4 && !!ws.autoFilter);
  check('cores de apoio: situação atrasada em vermelho, toxicidade tóxica em âmbar', ws.getRow(4).getCell(6).font.color.argb === 'FFB3322E' && ws.getRow(4).getCell(25).font.color.argb === 'FFB36B00');
  const wp = back.getWorksheet('Pragas e tratamentos');
  check('2ª aba: uma linha por ocorrência com tratamentos e próxima aplicação', wp && wp.rowCount === 3 && wp.getRow(2).getCell(3).value === 'Cochonilha' && /Óleo de neem \(à noite\)/.test(wp.getRow(2).getCell(8).value) && wp.getRow(2).getCell(9).value instanceof Date && wp.getRow(3).getCell(5).value === 'Resolvida' && wp.getRow(3).getCell(9).value === null);
  const empty = buildWorkbook(ExcelJS, [], [], new Date());
  check('sem dados também gera uma planilha válida', (await empty.xlsx.writeBuffer()).byteLength > 1000);

  console.log('2) Service worker');
  const swSrc = fs.readFileSync(ROOT + '/sw.js', 'utf8');
  function makeSW({ fetchImpl, existingClients = [], subscribed = true } = {}) {
    const listeners = {}, cacheStore = new Map(), shown = [], opened = [];
    const caches = { open: async () => ({ addAll: async () => {}, put: async (req, res) => { cacheStore.set(typeof req === 'string' ? req : req.url, res); } }), keys: async () => ['minhas-plantas-v5', 'minhas-plantas-v6'], delete: async (k) => { cacheStore.set('deleted:' + k, 1); return true; }, match: async (req) => cacheStore.get(typeof req === 'string' ? req : req.url) };
    const self = {
      location: { href: 'https://app.test/sw.js?push=' + encodeURIComponent('https://push.test/'), origin: 'https://app.test' },
      addEventListener: (n, f) => { listeners[n] = f; }, skipWaiting: async () => {},
      registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); }, pushManager: { getSubscription: async () => subscribed ? { endpoint: 'https://fcm.test/xyz' } : null } },
      clients: { claim: async () => {}, matchAll: async () => existingClients, openWindow: async (u) => { opened.push(u); } }
    };
    const ctx = { self, caches, fetch: fetchImpl || (async () => { throw new Error('offline'); }), crypto: require('crypto').webcrypto, TextEncoder, URL, Response, Promise, console };
    vm.createContext(ctx); vm.runInContext(swSrc, ctx);
    const fire = async (name, ev) => { let p; listeners[name]({ ...ev, waitUntil: (x) => { p = x; }, respondWith: (x) => { p = x; } }); return p; };
    return { listeners, fire, shown, opened, cacheStore };
  }
  const { createHash } = require('crypto');
  let seenUrl = '';
  let sw = makeSW({ fetchImpl: async (u) => { seenUrl = String(u); return { ok: true, json: async () => ({ title: '🌿 3 cuidados para hoje', body: '💧 Regar: Jiboia', tag: 'minhas-plantas-diario' }) }; } });
  await sw.fire('push', {});
  check('push: busca o texto no Worker com o id (SHA-256 do endpoint)', seenUrl === 'https://push.test/peek?id=' + createHash('sha256').update('https://fcm.test/xyz').digest('hex'), seenUrl);
  check('push: mostra a notificação com o texto recebido, ícone e idioma', sw.shown[0].title === '🌿 3 cuidados para hoje' && sw.shown[0].body.includes('Regar') && sw.shown[0].icon === 'icon-192.png' && sw.shown[0].lang === 'pt-BR' && sw.shown[0].tag === 'minhas-plantas-diario');
  sw = makeSW({});
  await sw.fire('push', {});
  check('push sem rede: ainda assim mostra uma notificação padrão (exigência dos navegadores)', sw.shown.length === 1 && /cuidados esperando/.test(sw.shown[0].body));
  sw = makeSW({ subscribed: false });
  await sw.fire('push', {});
  check('push sem assinatura local: mensagem padrão', sw.shown.length === 1);
  const focus = []; const posted = [];
  sw = makeSW({ existingClients: [{ focus: async () => { focus.push(1); }, postMessage: (m) => posted.push(m) }] });
  let closed = false;
  await sw.fire('notificationclick', { notification: { close: () => { closed = true; }, data: { tab: 'agenda' } } });
  check('clique: fecha o aviso, foca o app aberto e manda abrir a Agenda', closed && focus.length === 1 && posted[0].type === 'open-tab' && posted[0].tab === 'agenda');
  sw = makeSW({ existingClients: [] });
  await sw.fire('notificationclick', { notification: { close() {}, data: { tab: 'agenda' } } });
  check('clique com o app fechado: abre ./?tab=agenda', sw.opened[0] === './?tab=agenda');
  sw = makeSW({ fetchImpl: async () => { throw new Error('offline'); } });
  sw.cacheStore.set('https://app.test/style.css', { cached: true });
  let res = await sw.fire('fetch', { request: { method: 'GET', url: 'https://app.test/style.css', mode: 'no-cors' } });
  check('offline: arquivos do app vêm da cópia guardada', res && res.cached === true);
  sw = makeSW({ fetchImpl: async () => { throw new Error('offline'); } });
  let intercepted = false; sw.listeners.fetch({ request: { method: 'GET', url: 'https://firestore.googleapis.com/x', mode: 'cors' }, respondWith: () => { intercepted = true; } });
  check('Firebase, Cloudinary e fontes (outros domínios) não são interceptados', !intercepted);
  intercepted = false; sw.listeners.fetch({ request: { method: 'POST', url: 'https://app.test/x', mode: 'cors' }, respondWith: () => { intercepted = true; } });
  check('só intercepta GET', !intercepted);
  sw = makeSW({ fetchImpl: async () => ({ ok: true, clone() { return this; } }) });
  sw.cacheStore.set('https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js', { cached: 'sdk' });
  res = await sw.fire('fetch', { request: { method: 'GET', url: 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js', mode: 'cors' } });
  check('biblioteca do Firebase: usa a cópia guardada primeiro (o app abre sem internet)', res && res.cached === 'sdk');
  res = await sw.fire('fetch', { request: { method: 'GET', url: 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js', mode: 'cors' } });
  check('se ainda não há cópia, baixa e guarda para a próxima vez', res && res.ok === true && sw.cacheStore.has('https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js'));
  sw = makeSW({});
  await sw.fire('activate', {});
  check('ativação apaga caches antigos', sw.cacheStore.has('deleted:minhas-plantas-v5') && !sw.cacheStore.has('deleted:minhas-plantas-v6'));

  console.log('3) Contraste das cores (WCAG AA ≥ 4,5:1 para texto)');
  const css = fs.readFileSync(ROOT + '/style.src.css', 'utf8');
  const block = (re) => { const m = css.match(re); return m ? m[0] : ''; };
  const light = block(/:root \{[\s\S]*?\n\}/), dark = block(/:root\[data-theme="dark"\] \{[\s\S]*?\n\}/);
  const vars = (txt) => Object.fromEntries([...txt.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
  const L = vars(light), D = { ...L, ...vars(dark) };
  const lum = (h) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const texts = ['ink', 'ink-soft', 'heading', 'sage-text', 'terra-text', 'gold-text', 'ok-text', 'water-text', 'danger-text', 'pest-text', 'blossom-text'];
  for (const [name, P] of [['claro', L], ['escuro', D]]) {
    const worst = texts.map(tk => [tk, Math.min(...['paper', 'cream', 'mist-2'].map(sk => cr(P[tk], P[sk])))]).sort((a, b) => a[1] - b[1])[0];
    check(`tema ${name}: todos os textos têm contraste ≥ 4,5 (pior: ${worst[0]} ${worst[1].toFixed(2)})`, worst[1] >= 4.5);
  }
  for (const [name, P] of [['claro', L], ['escuro', D]]) {
    const tints = [['danger-text', 'tint-danger'], ['ok-text', 'tint-ok'], ['terra-text', 'tint-terra'], ['gold-text', 'tint-warn']];
    const w = tints.map(([a, b]) => [a + ' em ' + b, cr(P[a], P[b])]).sort((a, b) => a[1] - b[1])[0];
    check(`tema ${name}: textos sobre os tons de aviso (pior: ${w[0]} ${w[1].toFixed(2)})`, w[1] >= 4.5);
  }
  const fills = { 'botão principal': L.terra, 'folha (selecionado)': L.leaf, 'verde escuro': L.moss, 'água': '#27789c', 'adubo': '#8a6a32', 'poda': '#3f7442', 'praga': '#7d4d92', 'lembrete': '#a85a30' };
  const wf = Object.entries(fills).map(([k, v]) => [k, cr('#ffffff', v)]).sort((a, b) => a[1] - b[1])[0];
  check(`texto branco sobre preenchimentos coloridos (pior: ${wf[0]} ${wf[1].toFixed(2)})`, wf[1] >= 4.5);
  check('anel de foco com contraste ≥ 3:1 nos dois temas', cr(L.focus, L.cream) >= 3 && cr(D.focus, D.cream) >= 3, `${cr(L.focus, L.cream).toFixed(2)} / ${cr(D.focus, D.cream).toFixed(2)}`);
  check('anel de foco sobre fundos sempre escuros (menu, topo) ≥ 3:1', cr(L['focus-on-dark'], L['side-b']) >= 3);
  console.log(fails ? `\n❌ ${fails} falhas (${passes} ok)` : `\n✅ ${passes} verificações passaram`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FALHA', e); process.exit(2); });
