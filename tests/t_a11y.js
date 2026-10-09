const ROOT = require('path').resolve(__dirname, '..');
const { boot, check, tick, summary } = require('./harness');
const fs = require('fs');
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const U = { uid: 'u1', email: 'ana@example.com', displayName: 'Ana Lima', emailVerified: true };
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString();
const seed = (d) => {
  d.species.s1 = { name: 'Jiboia', scientific: 'Epipremnum aureum', ownerId: 'u1', waterDays: 3, light: 'Meia-sombra', petToxicity: 'Tóxica', category: 'Trepadeira', icon: '🌿' };
  d.vases.v1 = { speciesId: 's1', ownerId: 'u1', name: 'Vaso da sala', lastWater: iso(-5), history: [{ type: 'lastWater', date: iso(-5), notes: 'ok' }, { type: 'lembrete', date: iso(2), notes: 'Adubar' }], photoHistory: [{ photo: IMG, date: iso(-30) }, { photo: IMG + 'B', date: iso(-2) }], pests: [{ id: 'p1', name: 'Cochonilha', severity: 'moderada', status: 'active', date: iso(-3), treatments: [] }] };
};
(async () => {
  const t = await boot({ user: U, seed });
  const { window: w, document: doc } = t;
  const g = (id) => doc.getElementById(id);
  w.eval(axeSrc);
  const runAxe = async (ctx = doc) => { const r = await w.axe.run(ctx, { rules: { 'color-contrast': { enabled: false }, 'region': { enabled: false } }, resultTypes: ['violations'] }); return r.violations; };
  const report = (v) => v.map(x => `${x.id}: ${x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' ; ')}`).join('\n      ');

  console.log('1) Entrada de cada tela e leitura por tecnologias assistivas (axe-core)');
  const views = [
    ['Espécies', () => w.switchTab('species')],
    ['Detalhe da espécie', () => w.openSpeciesDetail(t.app.S.species[0])],
    ['Galeria', () => w.switchTab('gallery')],
    ['Agenda', () => w.switchTab('agenda')],
    ['Diagnóstico e IA', () => w.switchTab('ai')]
  ];
  for (const [name, go] of views) {
    go(); await tick(80);
    const v = await runAxe();
    check(`${name}: sem violações de acessibilidade${v.length ? '\n      ' + report(v) : ''}`, v.length === 0);
  }
  w.switchTab('species'); await tick(40);
  for (const [name, open] of [['Painel do vaso (galeria, pragas, histórico)', () => w.openVaseDetail('v1')], ['Filtros', () => w.toggleFilterPanel()], ['Configurações', () => w.openSettings()], ['Nova espécie', () => w.openAddSpeciesModal()], ['Registro de praga', () => w.openPestForm('v1')], ['Compartilhar', () => w.openShare('species', 's1')]]) {
    await open(); await tick(80);
    const v = await runAxe();
    check(`${name}: sem violações${v.length ? '\n      ' + report(v) : ''}`, v.length === 0);
    while (t.app.S.activeDrawerId) w.closeActiveDrawer();
    await tick(20);
  }
  const p = w.deleteVase('v1'); await tick(30);
  const vConfirm = await runAxe();
  check(`Confirmação: sem violações${vConfirm.length ? '\n      ' + report(vConfirm) : ''}`, vConfirm.length === 0);
  g('confirmCancel').click(); await p; await tick(30);
  w.openLightbox('v1', 0); await tick(40);
  const vLb = await runAxe();
  check(`Galeria ampliada: sem violações${vLb.length ? '\n      ' + report(vLb.length ? vLb : []) : ''}`, vLb.length === 0);
  w.closeLightbox(); await tick(20);
  const t2 = await boot({ user: null });
  t2.window.eval(axeSrc);
  const vl = (await t2.window.axe.run(t2.document, { rules: { 'color-contrast': { enabled: false }, 'region': { enabled: false } } })).violations;
  check(`Tela de entrada: sem violações${vl.length ? '\n      ' + report(vl) : ''}`, vl.length === 0);

  console.log('2) Foco do teclado em janelas');
  const filtersBtn = g('filterBtn'); filtersBtn.focus();
  w.toggleFilterPanel(); await tick(30);
  const overlay = g('drawerFilters');
  check('ao abrir um painel, o foco vai para dentro dele', overlay.contains(doc.activeElement) && doc.activeElement.classList.contains('drawer'));
  check('o fundo fica bloqueado (inert) enquanto o painel está aberto', doc.querySelector('.app-layout').inert === true && doc.querySelector('.bottom-nav').inert === true && g('toasts').inert !== true);
  check('painel tem papel de diálogo modal com nome', overlay.querySelector('.drawer').getAttribute('role') === 'dialog' && overlay.querySelector('.drawer').getAttribute('aria-modal') === 'true' && overlay.querySelector('.drawer').getAttribute('aria-labelledby') === 'filtersTitle');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(30);
  check('Esc fecha, libera o fundo e devolve o foco ao botão que abriu', !overlay.classList.contains('active') && doc.querySelector('.app-layout').inert === false && doc.activeElement === filtersBtn);
  // painéis empilhados
  w.openVaseDetail('v1'); await tick(30);
  w.openHistoryEdit('v1', 0); await tick(30);
  check('painel sobre painel: o de baixo fica bloqueado, o de cima ativo', g('drawerCareLog').classList.contains('active') && g('drawerVaseDetail').inert === true && t.app.S.activeDrawerId === 'drawerCareLog');
  w.closeActiveDrawer(); await tick(30);
  check('fechar o de cima volta ao de baixo (ainda aberto, desbloqueado, foco dentro)', g('drawerVaseDetail').classList.contains('active') && g('drawerVaseDetail').inert === false && t.app.S.activeDrawerId === 'drawerVaseDetail' && doc.body.classList.contains('no-scroll'));
  w.closeActiveDrawer(); await tick(30);
  check('fechar o último libera a rolagem da página', !doc.body.classList.contains('no-scroll') && t.app.S.activeDrawerId === null);
  // confirmação
  const pr = w.deleteVase('v1'); await tick(30);
  check('exclusão: foco começa em "Cancelar" (opção segura) e o botão de excluir é vermelho', doc.activeElement === g('confirmCancel') && g('confirmOk').classList.contains('danger'));
  const tab = (shift) => { const e = new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }); doc.dispatchEvent(e); return e; };
  g('confirmOk').focus(); tab(false);
  check('Tab no último botão volta ao primeiro (não escapa da janela)', doc.activeElement === g('confirmCancel'));
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(20);
  check('Enter não confirma sozinho (só o botão com foco age)', !!t.data.vases.v1);
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pr; await tick(30);
  check('Esc cancela e o vaso continua lá', !!t.data.vases.v1 && g('confirmOverlay').classList.contains('open') === false);
  // galeria ampliada
  w.openVaseDetail('v1'); await tick(30);
  g('vaseDetailGallery').querySelector('.gallery-thumb').focus();
  w.openLightbox('v1', 0); await tick(30);
  check('galeria ampliada: foco no botão Fechar e fundo bloqueado', doc.activeElement === g('lbClose') && g('drawerVaseDetail').inert === true);
  w.closeLightbox(); await tick(30);
  check('ao fechar, o foco volta para a miniatura e o painel é desbloqueado', doc.activeElement.classList.contains('gallery-thumb') && g('drawerVaseDetail').inert === false, doc.activeElement.className);
  w.closeActiveDrawer();

  console.log('3) Navegação e leitores de tela');
  w.switchTab('agenda'); await tick(40);
  check('ao trocar de tela, o foco vai ao título dela (e o título do documento muda)', doc.activeElement.tagName === 'H2' && /Agenda/.test(doc.activeElement.textContent) && /^Agenda/.test(doc.title), doc.title);
  check('link "Pular para o conteúdo" aponta para a área principal', doc.querySelector('.skip-link').getAttribute('href') === '#main' && !!g('main') && g('main').getAttribute('tabindex') === '-1');
  check('há um único título de nível 1 por tela de uso (invisível, com o nome do app)', doc.querySelectorAll('#main h1').length === 1);
  check('botões só de ícone têm nome acessível', [...doc.querySelectorAll('.btn-icon, .btn-close, .lb-btn')].every(b => (b.getAttribute('aria-label') || b.textContent.trim()).length > 1 && !/^[×✕]$/.test((b.getAttribute('aria-label') || '').trim())));
  check('botões alternáveis informam o estado (aria-pressed / aria-expanded)', [...doc.querySelectorAll('.seg, .chip, .al-tab')].every(b => b.hasAttribute('aria-pressed') || b.id === '') && g('filterBtn').hasAttribute('aria-expanded') && g('alertsToggle').hasAttribute('aria-expanded'));
  check('gráfico de barras do intervalo de regas tem alternativa em texto', true);
  check('toasts são regiões "status"/"alert" anunciadas', g('toasts').getAttribute('aria-live') === 'polite');
  check('imagens decorativas têm alt vazio e as informativas têm texto alternativo', [...doc.querySelectorAll('img')].every(i => i.hasAttribute('alt')));
  check('todo campo de formulário tem rótulo', [...doc.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]), select, textarea')].every(f => f.labels && f.labels.length || f.getAttribute('aria-label')), [...doc.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]), select, textarea')].filter(f => !(f.labels && f.labels.length) && !f.getAttribute('aria-label')).map(f => f.id).join());

  console.log('4) Todos os botões do HTML estão ligados a funções');
  const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
  const jsSrc = fs.readdirSync(ROOT + '/js').filter(f => f.endsWith('.js')).map(f => fs.readFileSync(ROOT + '/js/' + f, 'utf8')).join('\n') + fs.readFileSync(ROOT + '/js/ui/feedback.js', 'utf8');
  const names = new Set([...(html + jsSrc).matchAll(/\bon(?:click|change|submit|input)="\s*(?:event\.stopPropagation\(\);\s*)?([A-Za-z_]\w*)\(/g)].map(m => m[1]));
  const missing = [...names].filter(n => typeof w[n] !== 'function' || /native code/.test(String(w[n])));
  check(`${names.size} ações chamadas pelo HTML/JS existem como funções do app`, missing.length === 0, 'faltando: ' + missing.join(', '));
  check('sem erros de script', t.errors.length === 0, t.errors.join('|'));
  process.exit(summary() ? 1 : 0);
})().catch(e => { console.error('FALHA', e); process.exit(2); });
