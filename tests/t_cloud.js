const { boot, check, tick, summary } = require('./harness');
const U = { uid: 'u1', email: 'a@b.c', displayName: 'Ana Lima', emailVerified: true };
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const iso = (d) => new Date(Date.now() - d * 86400000).toISOString();
(async () => {
  const t = await boot({ user: U, seed: (d) => {
    d.species.s1 = { name: 'Jiboia', ownerId: 'u1', waterDays: 3, photo: '' };
    d.vases.v1 = { speciesId: 's1', ownerId: 'u1', name: 'Vaso da sala', photo: '', photoHistory: [{ photo: IMG, date: iso(20) }], lastWater: iso(4), history: [{ type: 'lastWater', date: iso(10), notes: 'a' }, { type: 'lastWater', date: iso(4), notes: 'b' }], createdAt: iso(30) };
  } });
  const { window: w, document: doc, fb, app } = t;
  const calls = [];
  const cloudReply = (plan) => { w.fetch = async (url, opts) => { const fd = opts.body; calls.push({ url, preset: fd.get('upload_preset'), tags: fd.get('tags'), file: fd.get('file') }); const r = plan[calls.length - 1] || plan[plan.length - 1]; return { ok: r.status === 200, status: r.status, json: async () => r.body }; }; };

  console.log('1) Cloudinary sem configurar');
  check('sem cloud name, a foto continua como está (fica no documento)', (await w.storePhoto(IMG)).photo === IMG && !w.isCloudConfigured());
  check('compressão usa o limite pequeno quando não há Cloudinary', w.photoOptions(true).maxBytes === 95000);

  console.log('2) Cloudinary configurado');
  app.CLOUDINARY.cloudName = 'democloud';
  check('configurado e opções maiores', w.isCloudConfigured() && w.photoOptions(true).maxDim === 1600);
  cloudReply([{ status: 400, body: { error: { message: 'Upload preset not found' } } }, { status: 200, body: { secure_url: 'https://res.cloudinary.com/democloud/image/upload/v1/MyPlants/abc.jpg', public_id: 'MyPlants/abc', width: 1200, height: 900 } }]);
  let up = await w.uploadImage(IMG, { tags: ['vaso'] });
  check('tenta o 1º preset (c5wrwkf8), falha por "not found" e usa o próximo (MyPlants)', calls.length === 2 && calls[0].preset === 'c5wrwkf8' && calls[1].preset === 'MyPlants', JSON.stringify(calls.map(c => c.preset)));
  check('envia ao endpoint do cloud name, com tag e arquivo', calls[0].url === 'https://api.cloudinary.com/v1_1/democloud/image/upload' && calls[0].tags === 'vaso' && !!calls[0].file);
  check('devolve URL segura e id público', up.url.startsWith('https://res.cloudinary.com/democloud/') && up.publicId === 'MyPlants/abc');
  calls.length = 0;
  cloudReply([{ status: 200, body: { secure_url: 'https://res.cloudinary.com/democloud/image/upload/v1/x.jpg', public_id: 'x' } }]);
  await w.uploadImage(IMG);
  check('lembra o preset que funcionou e começa por ele', calls[0].preset === 'MyPlants' && calls.length === 1);

  console.log('3) Erros do Cloudinary');
  cloudReply([{ status: 401, body: { error: { message: 'Invalid cloud_name democloud' } } }]);
  let err = await w.uploadImage(IMG).catch(e => e);
  check('cloud name errado: mensagem em português apontando o arquivo de configuração', /cloud name/i.test(err.message) && /config\.js/.test(err.message), err.message);
  cloudReply([{ status: 400, body: { error: { message: 'Upload preset must be whitelisted for unsigned uploads' } } }]);
  err = await w.uploadImage(IMG).catch(e => e);
  check('preset não-unsigned: explica', /Unsigned/.test(err.message), err.message);
  w.fetch = async () => { throw new TypeError('Failed to fetch'); };
  err = await w.uploadImage(IMG).catch(e => e);
  check('sem internet: mensagem amigável', /conexão/i.test(err.message));

  console.log('4) Miniaturas');
  const full = 'https://res.cloudinary.com/democloud/image/upload/v1/MyPlants/abc.jpg';
  check('thumb insere transformação (largura, qualidade e formato automáticos)', w.thumb(full, 480) === 'https://res.cloudinary.com/democloud/image/upload/c_limit,w_480,q_auto,f_auto/v1/MyPlants/abc.jpg');
  check('thumb é idempotente e ignora fotos que não são do Cloudinary', w.thumb(w.thumb(full)) === w.thumb(full) && w.thumb(IMG) === IMG && w.thumb('https://x.com/a.jpg') === 'https://x.com/a.jpg');
  const attr = w.imgSrc(full, 320);
  check('imgSrc guarda a original em data-full para o plano B', /src="[^"]*w_320/.test(attr) && attr.includes('data-full="' + full + '"'));
  const holder = doc.createElement('div'); holder.innerHTML = `<img ${attr} alt="">`; doc.body.appendChild(holder);
  const img = holder.querySelector('img');
  img.dispatchEvent(new w.Event('error'));
  check('se a miniatura falhar, a imagem original é usada (uma vez só)', img.getAttribute('src') === full && !img.dataset.full);
  holder.remove();

  console.log('5) Salvando vaso com foto');
  cloudReply([{ status: 200, body: { secure_url: full, public_id: 'MyPlants/abc' } }]);
  app.S.selectedSpecies = app.S.species[0];
  w.openAddVaseModal();
  doc.getElementById('vaseName').value = 'Vaso com foto';
  app.S.vasePhoto = IMG;
  await w.saveVase({ preventDefault() {} }); await tick(80);
  const nv = Object.values(fb.data.vases).find(v => v.name === 'Vaso com foto');
  check('o documento guarda só a URL (e não a imagem inteira)', nv.photoHistory.length === 1 && nv.photoHistory[0].photo === full && nv.photoHistory[0].publicId === 'MyPlants/abc' && JSON.stringify(nv).length < 1500, JSON.stringify(nv).length + '');
  check('foi enviada com a tag "vaso"', calls.at(-1).tags === 'vaso');
  check('botão de salvar voltou ao texto original', doc.getElementById('btnSaveVase').textContent === 'Salvar vaso' && !doc.getElementById('btnSaveVase').disabled);
  // falha no envio não grava nada e mostra o erro
  cloudReply([{ status: 401, body: { error: { message: 'Invalid cloud_name democloud' } } }]);
  w.openAddVaseModal(); doc.getElementById('vaseName').value = 'Vaso que falha'; app.S.vasePhoto = IMG;
  await w.saveVase({ preventDefault() {} }); await tick(60);
  check('falha no Cloudinary: vaso não é criado e aparece aviso de erro', !Object.values(fb.data.vases).some(v => v.name === 'Vaso que falha') && /cloud name/i.test(t.toasts()));
  w.closeActiveDrawer();

  console.log('6) Capa da espécie no Cloudinary');
  cloudReply([{ status: 200, body: { secure_url: full, public_id: 'MyPlants/capa' } }]);
  w.editSpecies('s1'); app.S.speciePhoto = IMG;
  await w.saveSpecies({ preventDefault() {} }); await tick(60);
  check('espécie guarda URL e id público', fb.data.species.s1.photo === full && fb.data.species.s1.publicId === 'MyPlants/capa');
  check('sem Cloudinary de novo: a capa seria gravada inline (compatibilidade)', (app.CLOUDINARY.cloudName = 'SEU_CLOUD_NAME', (await w.storePhoto(IMG)).photo === IMG));
  app.CLOUDINARY.cloudName = 'democloud';

  console.log('7) Migrar fotos antigas');
  w.openSettings(); await tick(80);
  const mig = doc.getElementById('btnMigratePhotos');
  check('botão aparece quando há fotos guardadas no documento', !mig.hidden && /1 foto antiga/.test(mig.textContent), mig.textContent + '|' + mig.hidden);
  cloudReply([{ status: 200, body: { secure_url: 'https://res.cloudinary.com/democloud/image/upload/v2/MyPlants/migrada.jpg', public_id: 'MyPlants/migrada' } }]);
  const p = w.migratePhotos(); await tick(30);
  doc.getElementById('confirmOk').click(); await p; await tick(80);
  const v1 = fb.data.vases.v1;
  check('foto antiga trocada por URL, com a data original preservada', v1.photoHistory.length === 1 && v1.photoHistory[0].photo.includes('migrada') && !!v1.photoHistory[0].date && v1.photoHistory[0].date.slice(0, 10) === new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10));
  check('botão some depois da migração', doc.getElementById('btnMigratePhotos').hidden === true);
  w.closeActiveDrawer();

  console.log('8) Desfazer exclusões');
  const confirmNext = async (fn) => { const pr = fn(); await tick(30); doc.getElementById('confirmOk').click(); await pr; await tick(60); };
  const undo = async () => { const b = [...doc.querySelectorAll('.toast-action')].pop(); b.click(); await tick(80); };
  await confirmNext(() => w.deleteVase('v1'));
  check('excluir vaso: some e aparece "Desfazer"', !fb.data.vases.v1 && !!doc.querySelector('.toast-action') && /Desfazer/.test(doc.querySelector('.toast-action').textContent));
  await undo();
  check('desfazer: vaso volta com o mesmo id, dono e dados', fb.data.vases.v1 && fb.data.vases.v1.ownerId === 'u1' && fb.data.vases.v1.name === 'Vaso da sala' && fb.data.vases.v1.history.length === 2);
  await confirmNext(() => w.deleteSpecies('s1'));
  check('excluir espécie leva os vasos junto', !fb.data.species.s1 && !fb.data.vases.v1 && Object.keys(fb.data.vases).length === 0);
  await undo();
  check('desfazer restaura espécie e todos os vasos', !!fb.data.species.s1 && !!fb.data.vases.v1 && fb.data.vases.v1.speciesId === 's1' && Object.values(fb.data.vases).some(v => v.name === 'Vaso com foto'));
  // registros do histórico
  const lastBefore = fb.data.vases.v1.lastWater;
  await w.deleteHistoryEntry('v1', 1); await tick(60);
  check('excluir o registro mais recente refaz a "última rega" a partir do histórico', fb.data.vases.v1.history.length === 1 && fb.data.vases.v1.lastWater !== lastBefore && fb.data.vases.v1.lastWater.slice(0, 10) === iso(10).slice(0, 10), JSON.stringify([fb.data.vases.v1.history.map(h=>h.date), fb.data.vases.v1.lastWater, lastBefore, iso(10)]));
  await undo();
  check('desfazer devolve o registro e a última rega', fb.data.vases.v1.history.length === 2 && fb.data.vases.v1.lastWater === lastBefore);
  await w.deleteHistoryEntry('v1', 0); await w.deleteHistoryEntry('v1', 0); await tick(60);
  check('sem nenhum registro de rega, a última rega fica vazia', fb.data.vases.v1.lastWater === '' && fb.data.vases.v1.history.length === 0);
  await undo(); await tick(40);
  console.log('9) Editar registro do histórico');
  w.openHistoryEdit('v1', 0); await tick(30);
  check('o formulário abre preenchido em modo de edição', doc.getElementById('careLogTitle').textContent === 'Editar registro' && doc.getElementById('logNotes').value && doc.getElementById('logEditIndex').value === '0' && doc.getElementById('logVaseGroup').hidden);
  doc.getElementById('logNotes').value = 'corrigido';
  doc.getElementById('logDate').value = w.toLocalInput(iso(2));
  await w.saveCareLog({ preventDefault() {} }); await tick(60);
  const edited = fb.data.vases.v1.history[0];
  check('registro atualizado e última rega recalculada (agora 2 dias atrás)', edited.notes === 'corrigido' && fb.data.vases.v1.lastWater.slice(0, 10) === iso(2).slice(0, 10), fb.data.vases.v1.lastWater);
  check('sem erros de script', t.errors.length === 0, t.errors.join('|'));
  process.exit(summary() ? 1 : 0);
})().catch(e => { console.error('FALHA', e); process.exit(2); });
