const ROOT = require('path').resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');

const { execSync } = require('child_process');
const W = ROOT + '/';
execSync('node bundle.mjs', { cwd: __dirname, stdio: 'pipe' });
const html = fs.readFileSync(W + 'index.html', 'utf8').replace(/<script type="module" src="js\/main.js"><\/script>/, '');
const bundle = fs.readFileSync('/tmp/app.bundle.js', 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message || e)));
vc.on('error', e => errors.push('console.error: ' + e));
vc.on('warn', () => {});

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const { window } = dom;
const document = window.document;
window.__TEST__ = true;
let data, fire;
const ADMIN = { uid: 'u-admin', email: 'genesisgns@gmail.com', displayName: 'Gênesis Silva', emailVerified: true, photoURL: '' };
window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = function () {};

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
let fails = 0;
function check(name, cond, extra = '') { if (cond) console.log('  ✔', name); else { fails++; console.log('  ✘', name, extra); } }

(async () => {
  window.eval(bundle);
  data = window.__fbstate.data; fire = (n) => window.__fbstate.fire(n);
  await tick(10);
  window.__fbstate.setUser(ADMIN);
  await tick(80);

  console.log('1) Estado vazio');
  check('grade mostra estado vazio (sem esqueleto)', !!document.querySelector('#speciesGrid .empty-state') && !document.querySelector('#speciesGrid .skeleton'));
  check('saudação preenchida', /Bom dia|Boa tarde|Boa noite|Boa madrugada/.test(document.getElementById('heroGreeting').textContent));
  check('dica do dia preenchida', document.getElementById('dailyTip').textContent.length > 20);

  // dados de teste
  const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const day = 86400000, now = Date.now();
  const iso = d => new Date(now - d * day).toISOString();
  data.species.s1 = { name: 'Jiboia <img src=x onerror=alert(1)>', scientific: 'Jiboia-verde', icon: '🌿', category: 'Trepadeira', waterDays: 3, petToxicity: 'Tóxica', petWarning: 'Irrita', light: 'Meia-sombra', photo: '' };
  data.species.s2 = { name: 'Cacto', category: 'Suculenta', icon: '🌵', waterDays: 14, petToxicity: 'Segura', photo: '' };
  data.vases.v1 = { speciesId: 's1', name: 'Vaso da sala', size: '25cm', icon: '🪴', photo: '', createdAt: iso(40), lastWater: iso(7), lastFertilizer: iso(45), lastPruning: iso(100),
    photoHistory: [{ photo: px + 'A', date: iso(30) }, { photo: px + 'B', date: iso(15) }, { photo: px + 'C', date: iso(1) }],
    history: [{ type: 'lastWater', date: iso(14) }, { type: 'lastWater', date: iso(7) }, { type: 'lembrete', date: new Date(now + 2 * day).toISOString(), notes: 'Adubar' }] };
  data.vases.v2 = { speciesId: 's1', name: 'Vaso legado', icon: '🌱', photo: px + 'L', createdAt: iso(60), lastWater: iso(0), history: [{ type: 'lastWater', date: iso(0) }] };
  data.vases.v3 = { speciesId: 's2', name: 'Cacto mesa', icon: '🌵', photo: '', photoHistory: [], history: [] };
  [...Object.values(data.species), ...Object.values(data.vases)].forEach(d => { d.ownerId = 'u-admin'; });
  fire('species'); fire('vases'); await tick();

  console.log('2) Dashboard e grade');
  check('2 espécies renderizadas', document.querySelectorAll('.species-card').length === 2);
  check('contadores corretos', document.getElementById('statSpeciesCount').textContent === '2' && document.getElementById('statPotsCount').textContent === '3');
  check('vaso v1 atrasado (7 dias, ciclo 3) conta como precisa de rega', document.getElementById('statNeedWater').textContent === '1', document.getElementById('statNeedWater').textContent);
  check('regado hoje = 1', document.getElementById('statWateredToday').textContent === '1');
  check('lembrete futuro listado', /Adubar/.test(document.getElementById('remindersList').textContent));
  check('HTML malicioso escapado (sem <img> injetado)', !document.querySelector('#speciesGrid img[src="x"]') && document.querySelector('.species-card h3').textContent.includes('<img'));

  console.log('3) Filtros e busca');
  window.setFilter('thirsty'); await tick();
  check('filtro "precisam de rega" => 1 espécie', document.querySelectorAll('.species-card').length === 1);
  window.setFilter('all'); window.setFilter('safe'); await tick();
  check('filtro "pets seguros" => 1 espécie (Cacto)', document.querySelectorAll('.species-card').length === 1 && /Cacto/.test(document.querySelector('.species-card h3').textContent));
  window.setFilter('all');
  document.getElementById('searchInput').value = 'cacto mesa'; window.applySpeciesSearch(); await tick();
  check('busca por nome de vaso encontra a espécie', document.querySelectorAll('.species-card').length === 1);
  window.clearSearch(); await tick();
  check('limpar busca volta às 2 espécies', document.querySelectorAll('.species-card').length === 2);



  console.log('3a) Filtro sanduíche (multisseleção)');
  const burger = document.getElementById('filterBtn');
  check('botão sanduíche existe, fechado', !!burger && !burger.classList.contains('open') && burger.getAttribute('aria-expanded') === 'false');
  window.toggleFilterPanel(); await tick();
  check('painel abre e o sanduíche vira "X" (open + aria-expanded)', document.getElementById('drawerFilters').classList.contains('active') && burger.classList.contains('open') && burger.getAttribute('aria-expanded') === 'true');
  const gids = [...document.querySelectorAll('#filterGroups .f-group')].map(g => g.dataset.g);
  check('7 grupos: alertas, rega, pets, luz, ritmo, categoria, vasos/fotos', JSON.stringify(gids) === JSON.stringify(['alert','water','pet','light','cycle','cat','stock']), JSON.stringify(gids));
  const optCount = (key) => document.querySelector(`#filterGroups .f-opt[data-key="${key}"] .f-n`).textContent;
  check('contagens por opção corretas', optCount('alert:water') === '1' && optCount('alert:fertilizer') === '1' && optCount('alert:pruning') === '1' && optCount('alert:reminder') === '1' && optCount('water:never') === '1' && optCount('water:ok') === '0' && optCount('pet:Segura') === '1' && optCount('light:half') === '1' && optCount('cycle:frequent') === '1' && optCount('cycle:spaced') === '1' && optCount('stock:noPhotos') === '1', ['alert:water','water:never','water:ok','pet:Segura','light:half','cycle:frequent','cycle:spaced','stock:noPhotos'].map(optCount).join(','));
  check('categorias vêm das espécies cadastradas', document.querySelectorAll('#filterGroups [data-g="cat"] .f-opt').length === 2);
  check('opção com 0 resultados fica esmaecida', document.querySelector('#filterGroups .f-opt[data-key="water:ok"]').classList.contains('zero'));
  check('sem filtros: mensagem neutra + botão limpar desabilitado', /nenhum filtro ativo/.test(document.getElementById('fLive').textContent) && document.getElementById('fClear').disabled);

  const optEl = (key) => document.querySelector(`#filterGroups .f-opt[data-key="${key}"]`);
  window.toggleFilter('alert:water', optEl('alert:water')); await tick();
  check('1 filtro: só a Jiboia (vaso atrasado)', document.querySelectorAll('.species-card').length === 1 && /Jiboia/.test(document.querySelector('.species-card h3').textContent));
  check('opção marcada (.on + aria-pressed) e pétalas disparadas', optEl('alert:water').classList.contains('on') && optEl('alert:water').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.fx.petalfx').length > 0);
  window.toggleFilter('alert:water', optEl('alert:water')); await tick();
  window.toggleFilter('water:today', optEl('water:today')); await tick();
  window.toggleFilter('water:never', optEl('water:never')); await tick();
  check('OU dentro do grupo: regadas hoje OU sem rega registrada => 2 espécies', document.querySelectorAll('.species-card').length === 2);
  check('selo do botão mostra 2', burger.classList.contains('has-filters') && document.getElementById('filterBadge').textContent === '2');
  window.toggleFilter('pet:Segura', optEl('pet:Segura')); await tick();
  check('E entre grupos: (thirsty OU never) E Segura => só o Cacto', document.querySelectorAll('.species-card').length === 1 && /Cacto/.test(document.querySelector('.species-card h3').textContent));
  check('contador ao vivo: Mostrando 1 de 2', /Mostrando\s*1\s*de 2/.test(document.getElementById('fLive').textContent), document.getElementById('fLive').textContent);
  check('rodapé: "Ver 1 espécie"', document.getElementById('fApply').textContent === 'Ver 1 espécie', document.getElementById('fApply').textContent);
  check('faixa de filtros ativos com 3 chips', !document.getElementById('activeFilters').hidden && document.querySelectorAll('#activeFilters .af-chip').length === 3);
  check('"Limpar" do grupo aparece só onde há seleção', document.querySelector('#filterGroups [data-g="pet"]').classList.contains('has-sel') && !document.querySelector('#filterGroups [data-g="light"]').classList.contains('has-sel'));
  window.removeFilter('water:never'); await tick();
  check('remover pela faixa: thirsty E Segura => ninguém + estado vazio com botão', document.querySelectorAll('.species-card').length === 0 && /combina com esses filtros/.test(document.getElementById('speciesGrid').textContent) && !!document.querySelector('#speciesGrid .empty-state .btn'));
  check('painel acompanha a remoção (never desmarcado)', !optEl('water:never').classList.contains('on'));
  check('rodapé vira "Nenhuma espécie"', document.getElementById('fApply').textContent === 'Nenhuma espécie');
  window.clearFilterGroup('water'); await tick();
  check('limpar grupo Rega => só Segura => Cacto', document.querySelectorAll('.species-card').length === 1 && document.getElementById('filterBadge').textContent === '1');
  window.toggleFilter('light:half', optEl('light:half')); await tick();
  check('Segura E Meia-sombra => ninguém (Cacto sem luz cadastrada)', document.querySelectorAll('.species-card').length === 0);
  window.clearFilters(); await tick();
  check('limpar tudo: 2 espécies, selo e faixa somem', document.querySelectorAll('.species-card').length === 2 && !burger.classList.contains('has-filters') && document.getElementById('activeFilters').hidden);
  window.toggleFilter('stock:withPhotos', optEl('stock:withPhotos')); await tick();
  check('"Com fotos" => só a Jiboia', document.querySelectorAll('.species-card').length === 1 && /Jiboia/.test(document.querySelector('.species-card h3').textContent));
  window.toggleFilter('cat:suculenta', document.querySelector('#filterGroups .f-opt[data-key="cat:suculenta"]')); await tick();
  check('categoria Suculenta + Com fotos => ninguém', document.querySelectorAll('.species-card').length === 0);
  window.clearFilters();
  window.toggleFilter('stock:noPhotos'); await tick();
  check('"Sem fotos" => Cacto', document.querySelectorAll('.species-card').length === 1 && /Cacto/.test(document.querySelector('.species-card h3').textContent));
  window.clearFilters();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
  check('Esc fecha o painel e o sanduíche volta ao normal', !document.getElementById('drawerFilters').classList.contains('active') && !burger.classList.contains('open') && burger.getAttribute('aria-expanded') === 'false');

  // atalhos rápidos usam os mesmos filtros
  window.setFilter('safe'); await tick();
  check('atalho "Seguras p/ pets" liga o mesmo filtro do painel', burger.classList.contains('has-filters') && document.querySelector('.chip[data-filter="safe"]').classList.contains('active') && !document.querySelector('.chip[data-filter="all"]').classList.contains('active'));
  window.toggleFilterPanel(); await tick();
  check('painel abre já refletindo o atalho', document.querySelector('#filterGroups .f-opt[data-key="pet:Segura"]').classList.contains('on'));
  window.setFilter('thirsty'); await tick();
  check('atalhos combinam (E entre grupos): Segura E Precisam de rega => ninguém', document.querySelectorAll('.species-card').length === 0);
  check('painel aberto atualiza ao usar atalho', document.querySelector('#filterGroups .f-opt[data-key="alert:water"]').classList.contains('on'));
  window.setFilter('all'); await tick();
  check('"Todas" limpa tudo', document.querySelectorAll('.species-card').length === 2 && !burger.classList.contains('has-filters'));
  window.toggleFilterPanel(); await tick();
  check('clicar no sanduíche aberto fecha o painel', !document.getElementById('drawerFilters').classList.contains('active') && !burger.classList.contains('open'));

  // filtro some se a categoria deixar de existir
  window.toggleFilterPanel(); window.toggleFilter('cat:trepadeira'); await tick();
  const keep = data.species.s1; delete data.species.s1; fire('species'); await tick();
  check('filtro de categoria inexistente é removido sozinho', !document.getElementById('filterBadge').classList.contains('x') && document.getElementById('filterBadge').textContent === '0');
  data.species.s1 = keep; fire('species'); await tick();
  window.closeActiveDrawer(); await tick();


  console.log('3d) Alertas: sino, abas, lista e ações');
  window.setFilter('all'); window.closeActiveDrawer && 0; await tick();
  const bell = document.getElementById('statNeedCard');
  const cardsN = () => document.querySelectorAll('.species-card').length;
  check('sino é um botão acessível (aria-pressed=false)', bell.tagName === 'BUTTON' && bell.getAttribute('aria-pressed') === 'false' && /ver as plantas/.test(document.getElementById('statNeedHint').textContent));
  window.HTMLElement.prototype.scrollIntoView = function () { window.__scr = this.className; };
  window.__scr = '';
  bell.click(); await tick();
  check('clicar no sino filtra: só a espécie com rega atrasada (Jiboia)', cardsN() === 1 && /Jiboia/.test(document.querySelector('.species-card h3').textContent));
  check('sino fica ativo (filtering, aria-pressed, dica "filtrando")', bell.classList.contains('filtering') && bell.getAttribute('aria-pressed') === 'true' && /filtrando/.test(document.getElementById('statNeedHint').textContent));
  check('faixa de filtros mostra "Precisam de rega"', /Precisam de rega/.test(document.getElementById('activeFilters').textContent));
  check('aviso informa vasos e espécies', /1 vaso em 1 espécie/.test([...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')));
  check('rola até a lista filtrada', /toolbar/.test(window.__scr), window.__scr);
  bell.click(); await tick();
  check('clicar de novo limpa o filtro', cardsN() === 2 && !bell.classList.contains('filtering'));
  window.setFilter('thirsty'); await tick();
  check('atalho "Precisam de rega" e o sino usam o mesmo filtro', bell.classList.contains('filtering') && document.querySelector('.chip[data-filter="thirsty"]').classList.contains('active'));
  window.setFilter('all'); await tick();

  const tabs = () => [...document.querySelectorAll('#alertTabs .al-tab')];
  const rows = () => document.querySelectorAll('#remindersList .alert-item');
  check('5 abas: Rega, Adubo, Poda, Pragas, Lembretes (1,1,1,0,1)', tabs().length === 5 && tabs().map(t => t.querySelector('.n').textContent).join(',') === '1,1,1,0,1', tabs().map(t => t.textContent.trim()).join('|'));
  const alertsPanel = document.getElementById('alertsPanel'), alertsToggle = document.getElementById('alertsToggle'), alertsBody = document.getElementById('alertsBody');
  check('bloco começa expandido (aria-expanded=true) com total "4 alertas" no cabeçalho', !alertsPanel.classList.contains('collapsed') && alertsToggle.getAttribute('aria-expanded') === 'true' && /^4 alertas$/.test(document.getElementById('alertsTotal').textContent.trim()), document.getElementById('alertsTotal').textContent);
  alertsToggle.click(); await tick();
  check('recolher: classe collapsed, aria-expanded=false, corpo escondido (aria-hidden)', alertsPanel.classList.contains('collapsed') && alertsToggle.getAttribute('aria-expanded') === 'false' && alertsBody.getAttribute('aria-hidden') === 'true');
  check('recolhido: o total de alertas continua visível', /4 alertas/.test(document.getElementById('alertsTotal').textContent));
  check('recolher guarda a preferência', window.localStorage.getItem('minhasplantas_alerts_collapsed') === '1');
  tabs()[1].click(); await tick();
  check('com filtro de alerta ativo o cabeçalho avisa "filtrando"', /4 alertas · filtrando/.test(document.getElementById('alertsTotal').textContent), document.getElementById('alertsTotal').textContent);
  window.clearAlertFilters(); await tick();
  alertsToggle.click(); await tick();
  check('expandir: volta ao normal e salva 0', !alertsPanel.classList.contains('collapsed') && alertsToggle.getAttribute('aria-expanded') === 'true' && alertsBody.getAttribute('aria-hidden') === 'false' && window.localStorage.getItem('minhasplantas_alerts_collapsed') === '0');
  check('total acompanha mudanças (poda em dia => 3 alertas)', (data.vases.v1.lastPruning = new Date().toISOString(), fire('vases'), true));
  await tick();
  check('...cabeçalho mostra "3 alertas"', /^3 alertas$/.test(document.getElementById('alertsTotal').textContent.trim()), document.getElementById('alertsTotal').textContent);
  data.vases.v1.lastPruning = iso(100); fire('vases'); await tick();
  check('sem filtro: lista mostra 1 alerta de cada tipo', rows().length === 4 && ['k-water','k-fertilizer','k-pruning','k-reminder'].every(k => document.querySelector('#remindersList .' + k)));
  check('alerta de adubo calcula atraso: "Adubação atrasada 15 dias" (45 − ciclo 30)', /Adubação atrasada 15 dias/.test(document.querySelector('.k-fertilizer').textContent), document.querySelector('.k-fertilizer').textContent.trim());
  check('alerta de poda usa ciclo padrão 90: "Poda atrasada 10 dias"', /Poda atrasada 10 dias/.test(document.querySelector('.k-pruning').textContent));
  check('lembrete aparece com a anotação', /Adubar/.test(document.querySelector('.k-reminder').textContent));
  tabs()[1].click(); await tick();
  check('aba Adubo: lista só de adubo + grade filtrada (Jiboia)', rows().length === 1 && !!document.querySelector('.k-fertilizer') && cardsN() === 1 && tabs()[1].classList.contains('on') && tabs()[1].getAttribute('aria-pressed') === 'true');
  check('mostra o atalho "Ver 1 planta filtrada"', !document.getElementById('alertsGoto').hidden && /1 planta filtrada/.test(document.getElementById('alertsGoto').textContent), document.getElementById('alertsGoto').textContent);
  check('botão "Limpar" do bloco aparece', !document.getElementById('alertsClear').hidden);
  tabs()[2].click(); await tick();
  check('Adubo OU Poda: 2 itens na lista', rows().length === 2 && document.getElementById('filterBadge').textContent === '2');
  tabs()[0].click(); await tick();
  check('+ Rega: 3 itens; faixa com 3 etiquetas', rows().length === 3 && document.querySelectorAll('#activeFilters .af-chip').length === 3);
  check('painel de filtros reflete as mesmas escolhas', (window.toggleFilterPanel(), true) && ['alert:water','alert:fertilizer','alert:pruning'].every(k => document.querySelector(`#filterGroups .f-opt[data-key="${k}"]`).classList.contains('on')));
  window.closeActiveDrawer(); await tick();
  document.getElementById('alertsClear').click(); await tick();
  check('"Limpar" do bloco remove só os filtros de alerta', cardsN() === 2 && document.getElementById('filterBadge').textContent === '0' && document.getElementById('alertsGoto').hidden);

  // categoria sem alertas: não aplica filtro, só avisa
  data.vases.v1.lastPruning = new Date().toISOString(); fire('vases'); await tick();
  check('poda em dia => aba com 0', tabs()[2].querySelector('.n').textContent === '0' && tabs()[2].classList.contains('zero'));
  tabs()[2].click(); await tick();
  check('aba com 0 não filtra e avisa', cardsN() === 2 && !tabs()[2].classList.contains('on') && /Nenhum alerta de poda/.test([...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')));
  data.vases.v1.lastPruning = iso(100); fire('vases'); await tick();

  // ação rápida direto do alerta
  document.querySelector('#remindersList .k-water .al-act').click(); await tick();
  check('"Regar" no alerta registra a rega no banco', Date.now() - new Date(data.vases.v1.lastWater).getTime() < 5000);
  check('alerta de rega some e o sino zera', !document.querySelector('#remindersList .k-water') && document.getElementById('statNeedWater').textContent === '0');
  data.vases.v1.lastWater = iso(7); data.vases.v1.history = data.vases.v1.history.filter(h => !(h.type === 'lastWater' && Date.now() - new Date(h.date) < 5000)); fire('vases'); await tick();
  check('(restaurado) sino volta a 1', document.getElementById('statNeedWater').textContent === '1');
  bell.click(); await tick(); bell.click(); await tick();

  // clicar no alerta abre o vaso
  document.querySelector('#remindersList .k-pruning .al-main').click(); await tick();
  check('clicar no alerta abre a espécie e o vaso', document.getElementById('sec-species-detail').classList.contains('is-active') && document.getElementById('drawerVaseDetail').classList.contains('active') && document.getElementById('vaseDetailName').textContent === 'Vaso da sala');
  window.closeActiveDrawer(); window.switchTab('species'); await tick();

  // ciclos de adubo/poda na espécie
  window.editSpecies('s2'); await tick();
  check('formulário tem os campos de ciclo (vazios p/ espécie antiga)', document.getElementById('specieFertDays').value === '' && document.getElementById('speciePruneDays').value === '');
  document.getElementById('specieFertDays').value = '20';
  await window.saveSpecies({ preventDefault() {} }); await tick();
  check('salvar grava ciclo informado (20) e padrão da poda (90)', data.species.s2.fertilizerDays === 20 && data.species.s2.pruningDays === 90, JSON.stringify([data.species.s2.fertilizerDays, data.species.s2.pruningDays]));
  data.vases.v3.lastFertilizer = iso(25); fire('vases'); await tick();
  check('ciclo da espécie vale no alerta (25 dias > 20 => adubo do Cacto)', [...document.querySelectorAll('#alertTabs .al-tab')][1].querySelector('.n').textContent === '2');
  delete data.vases.v3.lastFertilizer; fire('vases'); await tick();

  // mobile: bloco "Sabia que?" escondido
  const cssTxt = fs.readFileSync(W + 'style.css', 'utf8');
  const mobileBlock = cssTxt.match(/@media \(max-width: 768px\) \{\s*\.tip-panel \{ display: none; \}/);
  check('CSS: "Sabia que?" some no celular (max-width 768px)', !!mobileBlock);
  check('CSS: bloco aparece normalmente no desktop (sem display:none global)', !/^\.tip-panel \{[^}]*display: none/m.test(cssTxt));

  console.log('3b) Galeria geral');
  window.switchTab('gallery'); await tick();
  check('seção da galeria ativa', document.getElementById('sec-gallery').classList.contains('is-active'));
  check('nav marca "gallery" (menu + barra mobile)', document.querySelectorAll('.nav-btn[data-tab="gallery"].active').length === 2);
  check('4 fotos listadas (3 do v1 + 1 legada do v2)', document.querySelectorAll('.g-tile').length === 4, String(document.querySelectorAll('.g-tile').length));
  check('agrupadas em seções de mês', document.querySelectorAll('.g-month').length >= 1);
  check('chip "Todas · 4" + 1 chip de espécie (só quem tem foto)', document.querySelectorAll('#galChips .chip').length === 2 && /Todas · 4/.test(document.querySelector('#galChips .chip').textContent), document.getElementById('galChips').textContent);
  check('estatística: 4 fotos · 2 vasos · 1 vaso sem foto', /4 fotos · 2 vasos · 1 vaso sem foto/.test(document.getElementById('galStats').textContent), document.getElementById('galStats').textContent);
  check('tile mostra vaso e espécie', /Vaso da sala/.test(document.querySelector('.g-tile .g-over').textContent) && /Jiboia/.test(document.querySelector('.g-tile .g-over').textContent));
  document.querySelectorAll('.g-tile')[0].click(); await tick();
  const lbx = window.__app.lb;
  check('clicar abre o carrossel GERAL', lbx.open && lbx.source.type === 'gallery' && lbx.items.length === 4);
  check('mais recente primeiro (Vaso da sala)', document.getElementById('lbVase').textContent === 'Vaso da sala', document.getElementById('lbVase').textContent);
  check('contador inclui a espécie', /^Foto 1 de 4 · Jiboia/.test(document.getElementById('lbCounter').textContent), document.getElementById('lbCounter').textContent);
  check('botão "evolução do vaso" visível', document.getElementById('lbVaseBtn').style.display !== 'none');
  window.lbNext(); window.lbNext(); window.lbNext(); await tick();
  check('última foto é do outro vaso (legado)', document.getElementById('lbVase').textContent === 'Vaso legado');
  check('chip: única foto deste vaso', /Única foto/.test(document.getElementById('lbChip').textContent));
  window.lbGo && 0;
  document.getElementById('lbThumbs').querySelectorAll('.lb-thumb')[0].click(); await tick();
  window.lbShowVaseEvolution(); await tick();
  check('"evolução do vaso" troca a fonte para o vaso', window.__app.lb.source.type === 'vase' && window.__app.lb.items.length === 3 && /^Foto 3 de 3$/.test(document.getElementById('lbCounter').textContent), document.getElementById('lbCounter').textContent);
  check('botão do vaso some no modo vaso', document.getElementById('lbVaseBtn').style.display === 'none');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
  check('Esc fecha o carrossel', !window.__app.lb.open);

  window.setGallerySort('old'); await tick();
  check('ordem "mais antigas": 1º tile é do Vaso legado', /Vaso legado/.test(document.querySelector('.g-tile .g-over').textContent));
  window.setGallerySort('new');
  window.setGalleryFilter('s2'); await tick();
  check('filtro de espécie sem fotos volta para "todas"', document.querySelectorAll('.g-tile').length === 4);
  window.setGalleryView('vases'); await tick();
  check('visão "por vaso": 2 cartões', document.querySelectorAll('.g-vase').length === 2);
  check('vaso com 1 foto: botão ▶ desabilitado', [...document.querySelectorAll('.g-vase')].some(c => c.querySelector('.g-vase-actions .btn-secondary').disabled));
  document.querySelector('.g-vase-cover').click(); await tick();
  check('capa abre a evolução do vaso (última foto)', window.__app.lb.open && window.__app.lb.source.type === 'vase' && /^Foto 3 de 3$/.test(document.getElementById('lbCounter').textContent));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
  window.openVaseFromGallery('v1'); await tick();
  check('"Abrir vaso" leva à espécie com o vaso aberto', document.getElementById('sec-species-detail').classList.contains('is-active') && document.getElementById('drawerVaseDetail').classList.contains('active'));
  window.closeActiveDrawer(); window.switchTab('species'); await tick();

  console.log('3c) IA — ordem das Workers, identificação e diagnóstico');
  const ORDER = ['certificados-groq-proxy','gns91-groq-proxy','forzion-gpt-proxy','mamoot-gpt-proxy','astro-gns-proxy','shiny-sky-21dd','astro2','interno'];
  const fetched = [];
  let plan = [];
  window.fetch = async (url, opts) => {
    fetched.push(url);
    const step = plan[fetched.length - 1] || { status: 200, body: {} };
    if (step.throw) throw new Error(step.throw);
    return { ok: step.status >= 200 && step.status < 300, status: step.status, json: async () => { if (step.raw) throw new Error('bad json'); return step.body; } };
  };
  const host = u => new URL(u).hostname.split('.')[0];
  window.__app.S.aiImage = 'data:image/jpeg;base64,/9j/AAAA';
  window.switchTab('ai');
  window.setAiMode('identify');
  check('modo identificar: título e botão mudam', /Qual planta/.test(document.getElementById('aiTitle').textContent) && /Identificar/.test(document.getElementById('aiRunBtn').textContent));

  plan = [ { status: 500, body: { error: 'cota' } }, { throw: 'Failed to fetch' }, { status: 200, body: { foo: 1 } }, { status: 200, raw: true },
           { status: 200, body: { is_plant: true, name: 'Cacto', scientific_name: 'Cactaceae', confidence: 0.64, description: 'Suculenta.', water_days: 14, pet_toxicity: 'Segura', alternatives: [{ name: 'Suculenta' }, 'Agave'] } } ];
  await window.runAI(); await tick();
  check('tentou na ORDEM: certificados → gns91 → forzion → mamoot → astro-gns', JSON.stringify(fetched.map(host)) === JSON.stringify(ORDER.slice(0, 5)), JSON.stringify(fetched.map(host)));
  check('pula Worker com resposta de formato inesperado e com JSON quebrado', /identify-plant$/.test(fetched[0]) );
  const res = document.getElementById('aiResult');
  check('resultado mostra a planta, confiança 64% e "via astro-gns-proxy"', /Cacto/.test(res.textContent) && /64%/.test(res.textContent) && /via astro-gns-proxy/.test(res.textContent), res.textContent.slice(0, 200));
  check('reconhece espécie já cadastrada', /Você já tem esta espécie/.test(res.textContent));
  check('mostra 2 alternativas (chips)', res.querySelectorAll('.id-alts .chip').length === 2);
  check('barra de confiança média (amarela)', !!res.querySelector('.conf.mid'));
  window.pickIdentification(0); await tick();
  check('tocar numa alternativa a torna a principal', /Suculenta/.test(res.querySelector('.id-head h4').textContent) && /Cacto/.test(res.querySelector('.id-alts').textContent));
  window.registerFromIdentification(); await tick();
  check('"Cadastrar" abre o drawer já preenchido (nome + foto)', document.getElementById('drawerAddSpecies').classList.contains('active') && document.getElementById('specieName').value === 'Suculenta' && document.getElementById('speciePhotoPreview').style.display === 'block');
  window.closeActiveDrawer();

  // Segunda chamada recomeça da PRIMEIRA Worker (sem "grudar" na que funcionou)
  fetched.length = 0; plan = [ { status: 200, body: { is_plant: false } } ];
  await window.runAI(); await tick();
  check('nova chamada recomeça em certificados-groq-proxy', host(fetched[0]) === 'certificados-groq-proxy' && fetched.length === 1);
  check('foto sem planta é tratada', /Não encontrei uma planta/.test(document.getElementById('aiResult').textContent));

  // 400 não passa adiante
  fetched.length = 0; plan = [ { status: 400, body: { error: 'Envie uma imagem' } } ];
  await window.runAI(); await tick();
  check('erro 400 não tenta outras Workers', fetched.length === 1 && /Envie uma imagem/.test(document.getElementById('aiResult').textContent));

  // todas falham
  fetched.length = 0; plan = ORDER.map(() => ({ status: 503, body: { error: 'fora' } }));
  await window.runAI(); await tick();
  check('todas falham: tentou as 8, na ordem', JSON.stringify(fetched.map(host)) === JSON.stringify(ORDER), JSON.stringify(fetched.map(host)));
  check('mensagem amigável + detalhes técnicos', /Nenhuma das contas de IA/.test(document.getElementById('aiResult').textContent) && document.querySelectorAll('#aiResult .ai-details li').length === 8);
  check('botão reabilitado após a falha', !document.getElementById('aiRunBtn').disabled);

  // diagnóstico
  window.setAiMode('diagnose');
  fetched.length = 0; plan = [ { status: 200, body: { diagnosis: '1. Saudável <b>x</b>', moon_phase: 'Cheia', moon_tip: 'Evite podas.' } } ];
  await window.runAI(); await tick();
  check('diagnóstico usa a rota diagnose-plant na 1ª Worker', /diagnose-plant$/.test(fetched[0]) && host(fetched[0]) === 'certificados-groq-proxy');
  check('diagnóstico renderiza texto escapado + lua + via', /Saudável <b>x<\/b>/.test(document.getElementById('aiResult').textContent) && /Cheia/.test(document.getElementById('aiResult').textContent) && !document.querySelector('#aiResult .ai-text b') && /via certificados-groq-proxy/.test(document.getElementById('aiResult').textContent));
  // diagnóstico sem campos da lua (outras Workers) não quebra
  fetched.length = 0; plan = [ { status: 200, body: { diagnosis: 'Tudo certo' } } ];
  await window.runAI(); await tick();
  check('diagnóstico sem fase da lua não quebra', /Tudo certo/.test(document.getElementById('aiResult').textContent) && !/Fase da lua/.test(document.getElementById('aiResult').textContent));
  // auto-fill também segue a ordem
  fetched.length = 0; plan = [ { status: 500, body: {} }, { status: 200, body: { scientific_name: 'Epipremnum', water_days: 6, light: 'Meia-sombra' } } ];
  window.openAddSpeciesModal(); document.getElementById('specieName').value = 'Jiboia';
  await window.autoFillWithAI(document.getElementById('btnAutoFill')); await tick();
  check('auto-fill: certificados falha → gns91 responde', fetched.length === 2 && host(fetched[1]) === 'gns91-groq-proxy' && /auto-fill-plant$/.test(fetched[1]) && document.getElementById('specieWaterDays').value === '6');
  window.closeActiveDrawer(); window.switchTab('species'); await tick();

  console.log('4) Detalhe da espécie');
  [...document.querySelectorAll('.species-card')].find(c => /Jiboia/.test(c.textContent)).click(); await tick();
  check('seção de detalhe ativa', document.getElementById('sec-species-detail').classList.contains('is-active') && !document.getElementById('sec-species').classList.contains('is-active'));
  check('2 vasos da Jiboia', document.querySelectorAll('.vase-card').length === 2);
  check('medidor atrasado (s-late)', !!document.querySelector('.water-meter.s-late'));
  check('medidor "regada hoje" (s-fresh)', !!document.querySelector('.water-meter.s-fresh'));
  check('ficha técnica renderizada', document.querySelectorAll('.care-item').length >= 2);
  check('badge de fotos no card (📸 3)', /📸 3/.test(document.querySelector('.vase-card').textContent));
  check('capa do vaso = foto mais recente (C)', document.querySelector('.vase-card .vase-img').getAttribute('src').endsWith('C'));

  console.log('5) Detalhe do vaso + galeria clicável');
  window.openVaseDetail('v1'); await tick();
  check('drawer aberto', document.getElementById('drawerVaseDetail').classList.contains('active'));
  const thumbs = document.querySelectorAll('#vaseDetailGallery .gallery-thumb');
  check('3 miniaturas clicáveis', thumbs.length === 3);
  check('botão "Ver evolução" habilitado', !document.getElementById('btnPlayEvolution').disabled);
  check('medidor de espaço preenchido', document.getElementById('galleryNote').textContent.includes('3 fotos'));

  console.log('6) Carrossel');
  thumbs[1].click(); await tick();
  const lbEl = document.getElementById('lightbox');
  check('lightbox abriu', lbEl.classList.contains('open'));
  check('abre na foto clicada (2 de 3)', document.getElementById('lbCounter').textContent === 'Foto 2 de 3', document.getElementById('lbCounter').textContent);
  check('chip mostra dias de crescimento', /\+15 dias/.test(document.getElementById('lbChip').textContent), document.getElementById('lbChip').textContent);
  window.lbNext(); await tick();
  check('próxima => 3 de 3 e botão "próxima" desabilita', document.getElementById('lbCounter').textContent === 'Foto 3 de 3' && document.getElementById('lbNext').disabled);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await tick();
  check('seta ← volta para a foto 2', document.getElementById('lbCounter').textContent === 'Foto 2 de 3');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await tick();
  check('Home vai para "Início da jornada"', /Início da jornada/.test(document.getElementById('lbChip').textContent));
  check('miniatura ativa acompanha', document.querySelector('.lb-thumb.active').dataset.i === '0');
  window.lbTogglePlay(); await tick();
  check('reprodução automática liga', document.getElementById('lbPlay').classList.contains('on'));
  await tick(1950);
  check('avançou sozinho', document.getElementById('lbCounter').textContent !== 'Foto 1 de 3', document.getElementById('lbCounter').textContent);
  window.lbToggleZoom(); 
  check('zoom ativa e pausa a reprodução', document.getElementById('lbStage').classList.contains('zoomed') && !document.getElementById('lbPlay').classList.contains('on'));
  window.lbToggleZoom();

  console.log('7) Excluir foto pelo carrossel (tempo real)');
  window.lbGo && 0;
  const before = data.vases.v1.photoHistory.length;
  const delP = window.lbDelete();
  await tick();
  check('diálogo de confirmação abriu', document.getElementById('confirmOverlay').classList.contains('open'));
  document.getElementById('confirmOk').click(); await delP; await tick();
  check('foto removida do banco', data.vases.v1.photoHistory.length === before - 1);
  check('carrossel atualizou para 2 fotos', /de 2$/.test(document.getElementById('lbCounter').textContent), document.getElementById('lbCounter').textContent);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
  check('Esc fecha o carrossel e mantém o drawer', !lbEl.classList.contains('open') && document.getElementById('drawerVaseDetail').classList.contains('active'));

  console.log('8) Vaso legado (só campo photo)');
  window.closeActiveDrawer(); window.openVaseDetail('v2'); await tick();
  check('legado aparece como 1 foto', document.querySelectorAll('#vaseDetailGallery .gallery-thumb').length === 1);
  check('"Ver evolução" desabilitado com 1 foto', document.getElementById('btnPlayEvolution').disabled);

  console.log('9) Cuidado rápido');
  window.closeActiveDrawer();
  const waterBtn = document.querySelector('.vase-card .quick-btn.water-btn');
  waterBtn.click(); await tick();
  check('rega registrada no banco', data.vases.v1.history.filter(h => h.type === 'lastWater').length >= 3);
  check('toast exibido', document.querySelectorAll('.toast').length >= 1);
  check('partículas de gota criadas', document.querySelectorAll('.fx.drop').length > 0);

  console.log('10) Navegação / menu');
  window.switchTab('ai'); await tick();
  check('aba IA ativa', document.getElementById('sec-ai').classList.contains('is-active') && !document.getElementById('sec-species-detail').classList.contains('is-active'));
  check('dois botões de nav marcados (menu + mobile)', document.querySelectorAll('.nav-btn[data-tab="ai"].active').length === 2);
  window.toggleSidebar();
  check('menu recolhe', document.body.classList.contains('sidebar-collapsed'));
  window.toggleSidebar();

  console.log('11) Excluir espécie (cascata)');
  window.switchTab('species');
  const p = window.deleteSpecies('s1'); await tick();
  check('confirmação cita os vasos', /vasos/.test(document.getElementById('confirmMsg').textContent));
  document.getElementById('confirmOk').click(); await p; await tick();
  check('espécie e vasos removidos', !data.species.s1 && !data.vases.v1 && !data.vases.v2 && !!data.vases.v3);

  console.log('\nErros capturados:', errors.length ? errors : 'nenhum');
  console.log(fails ? `\n❌ ${fails} verificação(ões) falharam` : '\n✅ Todas as verificações passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FALHA NO TESTE', e); process.exit(2); });
