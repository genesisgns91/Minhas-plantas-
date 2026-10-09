const { boot, check, tick, summary } = require('./harness');
const ADMIN = { uid: 'u-admin', email: 'genesisgns@gmail.com', displayName: 'Gênesis Silva', emailVerified: true, photoURL: '' };
const MARIA = { uid: 'u-maria', email: 'maria@example.com', displayName: 'Maria Souza', emailVerified: true, photoURL: '' };
const seed = (d) => {
  d.species.s1 = { name: 'Jiboia', ownerId: 'u-admin', waterDays: 3 };
  d.species.s2 = { name: 'Samambaia', waterDays: 4 };                    // dado antigo, sem dono
  d.species.s3 = { name: 'Orquídea da vizinha', ownerId: 'u-outra' };
  d.vases.v1 = { speciesId: 's2', name: 'Vaso antigo', history: [] };     // dado antigo, sem dono
  d.vases.v2 = { speciesId: 's3', name: 'Vaso da vizinha', ownerId: 'u-outra', history: [] };
};
(async () => {
  console.log('1) Sem login');
  let t = await boot({ user: null, seed });
  let { document: doc, window: w, fb } = t;
  check('mostra a tela de entrada e esconde o app', doc.body.classList.contains('signed-out') && !doc.getElementById('loginScreen').hidden && doc.querySelector('.app-layout').inert === true);
  check('splash escondido', doc.getElementById('splash').hidden === true);
  check('nenhum dado é lido sem login', fb.subs.filter(s => s.active).length === 0);

  console.log('2) Conta nova (não administradora)');
  fb.popupUser = MARIA;
  doc.getElementById('loginBtn').click(); await tick(150);
  check('entra e mostra o app', doc.body.classList.contains('signed-in') && doc.getElementById('loginScreen').hidden && doc.querySelector('.app-layout').inert === false);
  check('jardim ZERADO: nenhuma espécie nem vaso (nem os antigos sem dono)', t.app.S.species.length === 0 && t.app.S.vases.length === 0 && doc.querySelectorAll('.species-card').length === 0);
  check('estado vazio personalizado com o primeiro nome', /Olá, Maria! Seu jardim está vazio/.test(doc.getElementById('speciesGrid').textContent), doc.getElementById('speciesGrid').textContent.slice(0, 80));
  check('saudação personalizada', /, Maria! 🌿/.test(doc.getElementById('heroGreeting').textContent), doc.getElementById('heroGreeting').textContent);
  check('avatar mostra a inicial e o chip mostra nome e e-mail', doc.querySelector('[data-user-avatar]').textContent === 'M' && /Maria Souza/.test(doc.querySelector('.user-chip').textContent) && /maria@example.com/.test(doc.querySelector('.user-chip').textContent));
  check('dados antigos NÃO foram tomados por essa conta', !fb.data.species.s2.ownerId && !fb.data.vases.v1.ownerId && !fb.data.users['u-maria']);
  check('as consultas filtram por ownerId da própria conta', fb.subs.filter(s => s.active).every(s => s.wheres.some(x => x.field === 'ownerId' && x.value === 'u-maria')));

  console.log('3) Criar dados na conta nova');
  w.openAddSpeciesModal();
  doc.getElementById('specieName').value = 'Hortelã';
  await w.saveSpecies({ preventDefault() {} }); await tick(60);
  const created = Object.values(fb.data.species).find(s => s.name === 'Hortelã');
  check('espécie nova recebe ownerId da conta', created && created.ownerId === 'u-maria');
  check('aparece só para ela', t.app.S.species.length === 1 && doc.querySelectorAll('.species-card').length === 1);
  t.app.S.selectedSpecies = t.app.S.species[0];
  w.openAddVaseModal();
  doc.getElementById('vaseName').value = 'Vaso da cozinha';
  await w.saveVase({ preventDefault() {} }); await tick(60);
  const vase = Object.values(fb.data.vases).find(v => v.name === 'Vaso da cozinha');
  check('vaso novo recebe ownerId', vase && vase.ownerId === 'u-maria' && vase.speciesId === t.app.S.species[0].firestoreId);

  console.log('4) Sair e trocar de conta');
  await w.signOutUser(); await tick(100);
  check('sair volta à tela de entrada e limpa os dados da memória', doc.body.classList.contains('signed-out') && t.app.S.species.length === 0 && !t.app.S.user);
  check('as escutas de dados são encerradas', fb.subs.filter(s => s.active).length === 0);
  fb.popupUser = ADMIN;
  doc.getElementById('loginBtn').click(); await tick(200);

  console.log('5) Conta administradora (genesisgns@gmail.com)');
  check('os dados antigos passam a pertencer ao administrador', fb.data.species.s2.ownerId === 'u-admin' && fb.data.vases.v1.ownerId === 'u-admin');
  check('migração registrada uma vez em users/{uid}', fb.data.users['u-admin'] && fb.data.users['u-admin'].legacyMigrated === true);
  const names = t.app.S.species.map(s => s.name).sort();
  check('vê os seus dados + os antigos, e NADA de outras pessoas', JSON.stringify(names) === JSON.stringify(['Jiboia', 'Samambaia']) && t.app.S.vases.length === 1 && t.app.S.vases[0].name === 'Vaso antigo', JSON.stringify(names));
  check('dados de outra pessoa continuam intactos', fb.data.species.s3.ownerId === 'u-outra' && fb.data.vases.v2.ownerId === 'u-outra');
  check('dados da Maria não aparecem', !t.app.S.species.some(s => s.name === 'Hortelã'));
  const before = fb.log.length;
  await w.signOutUser(); await tick(60);
  doc.getElementById('loginBtn').click(); await tick(200);
  check('segundo login não repete a migração', !fb.log.slice(before).some(l => l[0] === 'update' && l[1] !== 'vases'), JSON.stringify(fb.log.slice(before)));

  console.log('6) Administrador com e-mail NÃO verificado');
  t = await boot({ user: { ...ADMIN, emailVerified: false }, seed });
  check('não recebe os dados antigos (só vê o que já era dele)', !t.fb.data.species.s2.ownerId && !t.fb.data.vases.v1.ownerId && t.app.S.species.map(s => s.name).join() === 'Jiboia' && t.app.S.vases.length === 0);

  console.log('7) Erros de entrada');
  t = await boot({ user: null, seed });
  t.fb.popupError = Object.assign(new Error('x'), { code: 'auth/unauthorized-domain' });
  t.document.getElementById('loginBtn').click(); await tick(80);
  check('domínio não autorizado: explica como resolver', !t.document.getElementById('loginError').hidden && /Domínios autorizados/.test(t.document.getElementById('loginError').textContent));
  check('botão volta a ficar ativo', t.document.getElementById('loginBtn').disabled === false);
  t.fb.popupError = Object.assign(new Error('x'), { code: 'auth/popup-blocked' });
  t.document.getElementById('loginBtn').click(); await tick(80);
  check('pop-up bloqueado: tenta o login por redirecionamento', t.fb.log.some(l => l[0] === 'redirect'));
  t.fb.popupError = Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' });
  t.document.getElementById('loginBtn').click(); await tick(80);
  check('fechar o pop-up não mostra erro', t.document.getElementById('loginError').hidden === true);
  check('sem erros de script', t.errors.length === 0, t.errors.join('|'));
  process.exit(summary() ? 1 : 0);
})().catch(e => { console.error('FALHA', e); process.exit(2); });
