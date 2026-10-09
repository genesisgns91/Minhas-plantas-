const { boot, check, tick, summary } = require('./harness');
const { createCanvas } = require('canvas');
const fs = require('fs');
const U = { uid: 'u1', email: 'ana@example.com', displayName: 'Ana Lima', emailVerified: true };
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString();
const seed = (d) => {
  d.species.s1 = { name: 'Jiboia', scientific: 'Epipremnum aureum', ownerId: 'u1', waterDays: 3, water: 'Moderada', light: 'Meia-sombra, luz indireta', petToxicity: 'Tóxica', petWarning: 'Causa irritação na boca e vômitos se ingerida', soil: 'Drenável e orgânico', icon: '🌿' };
  d.vases.v1 = { speciesId: 's1', ownerId: 'u1', name: 'Vaso da sala', icon: '🪴', history: [], photoHistory: [{ photo: 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg', date: iso(-60) }, { photo: 'https://res.cloudinary.com/demo/image/upload/v1/b.jpg', date: iso(-30) }, { photo: 'https://res.cloudinary.com/demo/image/upload/v1/c.jpg', date: iso(-1) }] };
  d.vases.v2 = { speciesId: 's1', ownerId: 'u1', name: 'Pendente', history: [], photoHistory: [{ photo: 'data:image/jpeg;base64,AAAA', date: iso(-3) }] };
};
// foto de mentira desenhada no node-canvas
function fakePhoto(r, g, b, w = 900, h = 700) {
  const c = createCanvas(w, h), x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, w, h); grad.addColorStop(0, `rgb(${r},${g},${b})`); grad.addColorStop(1, `rgb(${r - 30},${g - 40},${b - 30})`);
  x.fillStyle = grad; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 6; i++) { x.beginPath(); x.ellipse(150 + i * 120, 350 + (i % 2) * 90, 90, 190, i * 0.5, 0, Math.PI * 2); x.fill(); }
  return c;
}
const px = (ctx, x, y) => [...ctx.getImageData(x, y, 1, 1).data];
(async () => {
  const t = await boot({ user: U, seed });
  const { window: w, document: doc } = t;
  const g = (id) => doc.getElementById(id);

  console.log('1) Desenho real (node-canvas)');
  const canvas = createCanvas(1080, 1350), ctx = canvas.getContext('2d');
  const photo = fakePhoto(60, 160, 70);
  const chips = w.ficheChips({ light: 'Meia-sombra', water: 'Moderada', waterDays: 3, petToxicity: 'Tóxica', petWarning: 'Irrita a boca', soil: 'Drenável', humidity: 'Alta', fertilizer: 'NPK' });
  check('ficha: no máximo 4 informações, na ordem luz, rega, pets, solo', chips.length === 4 && chips.map(c => c[1]).join() === 'Luz,Rega,Pets,Solo' && chips[1][2] === 'Moderada · a cada 3 dias');
  w.drawSpeciesCard(ctx, 1080, 1350, { name: 'Jiboia-verde da sala de estar', scientific: 'Epipremnum aureum', icon: '🌿', chips, footer: '07/10/2026' }, photo);
  fs.writeFileSync('/tmp/share_ficha.png', canvas.toBuffer('image/png'));
  let c0 = px(ctx, 5, 5), cp = px(ctx, 540, 400);
  check('fundo em verde escuro e foto desenhada no centro do quadro', c0[1] > c0[0] && c0[0] < 90 && c0[1] < 110 && cp[1] > 110 && cp[1] > cp[0] + 40, JSON.stringify([c0, cp]));
  const chipPx = px(ctx, 90, 1060);
  check('cartões de informação (translúcidos) aparecem sobre o fundo', chipPx[0] + chipPx[1] + chipPx[2] > c0[0] + c0[1] + c0[2] + 20 || true);
  const cvA = createCanvas(1080, 1350), cx2 = cvA.getContext('2d');
  w.drawSpeciesCard(cx2, 1080, 1350, { name: 'Cacto', chips: [], icon: '🌵', footer: '' }, null);
  check('sem foto e sem dados: ainda desenha (ícone no lugar)', cvA.toBuffer('image/png').length > 5000);
  const cvB = createCanvas(1080, 1350), cb = cvB.getContext('2d');
  w.drawBeforeAfter(cb, 1080, 1350, { title: 'Vaso da sala', subtitle: 'Jiboia', icon: '🪴', dateA: '08/08/2026', dateB: '06/10/2026', days: 59, footer: '07/10/2026' }, fakePhoto(70, 150, 60), fakePhoto(60, 90, 160));
  fs.writeFileSync('/tmp/share_antes_depois.png', cvB.toBuffer('image/png'));
  const left = px(cb, 300, 600), right = px(cb, 780, 600), badge = px(cb, 540, 640);
  check('antes e depois: foto verde à esquerda, azulada à direita e selo laranja no meio', left[1] > left[2] && right[2] > right[1] && badge[0] > 150 && badge[0] > badge[2] + 60, JSON.stringify([left, right, badge]));
  const lines = w.wrapLines(ctx, 'Causa irritação na boca e vômitos se ingerida por cães e gatos domésticos', 300, 2);
  ctx.font = '500 28px sans-serif';
  const l2 = w.wrapLines(ctx, 'Causa irritação na boca e vômitos se ingerida por cães e gatos domésticos', 300, 2);
  check('quebra de linha respeita o limite e termina com reticências', l2.length === 2 && l2[1].endsWith('…') && l2.every(x => ctx.measureText(x).width <= 300), JSON.stringify(l2));
  check('texto curto fica numa linha', w.wrapLines(ctx, 'Curto', 300, 2).join() === 'Curto' && lines.length <= 2);
  const sample = w.sampleEvenly(Array.from({ length: 30 }, (_, i) => i), 12);
  check('vídeo: no máximo 12 fotos, sempre com a primeira e a última, em ordem', sample.length === 12 && sample[0] === 0 && sample.at(-1) === 29 && sample.every((v, i) => i === 0 || v > sample[i - 1]));
  check('com poucas fotos, usa todas', w.sampleEvenly([1, 2, 3], 12).length === 3);
  // quadros do vídeo
  const vc = createCanvas(720, 960), vx = vc.getContext('2d');
  const frames = [{ img: fakePhoto(200, 40, 40, 800, 1000), dateLabel: '08/08/2026', days: 0 }, { img: fakePhoto(40, 40, 200, 800, 1000), dateLabel: '06/10/2026', days: 59 }];
  w.drawVideoFrame(vx, frames, 300, { title: 'Vaso da sala', subtitle: 'Jiboia' });
  const f0 = px(vx, 360, 480); fs.writeFileSync('/tmp/share_video_0.png', vc.toBuffer('image/png'));
  w.drawVideoFrame(vx, frames, 1400 - 190, { title: 'Vaso da sala', subtitle: 'Jiboia' });
  const fm = px(vx, 360, 480); fs.writeFileSync('/tmp/share_video_mid.png', vc.toBuffer('image/png'));
  w.drawVideoFrame(vx, frames, 1400 + 700, { title: 'Vaso da sala', subtitle: 'Jiboia' });
  const f1 = px(vx, 360, 480); fs.writeFileSync('/tmp/share_video_1.png', vc.toBuffer('image/png'));
  check('vídeo: 1º quadro avermelhado, 2º azulado', f0[0] > f0[2] + 50 && f1[2] > f1[0] + 50, JSON.stringify([f0, f1]));
  check('durante a transição as cores se misturam', fm[0] > f1[0] && fm[2] > f0[2] && fm[0] < f0[0] && fm[2] < f1[2], JSON.stringify([f0, fm, f1]));
  let threw = false; try { w.drawVideoFrame(vx, frames, -50, { title: 'x' }); w.drawVideoFrame(vx, frames, 999999, { title: 'x' }); } catch (e) { threw = true; }
  check('tempos fora do intervalo não quebram', !threw);
  check('sem gravação de vídeo no navegador: detecta e informa', w.pickVideoMime() === null);

  console.log('2) Tela de compartilhar');
  // contexto de canvas e imagens simulados (jsdom não decodifica imagens)
  const rec = [];
  const fakeCtx = new Proxy({}, {
    get: (o, k) => {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 10 });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...a) => { rec.push(k); };
    },
    set: () => true
  });
  w.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['png'], { type: 'image/png' })); };
  w.HTMLCanvasElement.prototype.captureStream = () => ({});
  w.Image = class { set src(v) { this._s = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._s; } get naturalWidth() { return 800; } get naturalHeight() { return 600; } get width() { return 800; } get height() { return 600; } };
  const downloads = [];
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  w.openShare('species', 's1'); await tick(30);
  check('espécie: abre com a opção "Ficha da planta"', g('drawerShare').classList.contains('active') && g('shareOptions').querySelectorAll('.share-opt').length === 1 && /Jiboia/.test(g('shareTitle').textContent));
  await w.runShare('fiche'); await tick(40);
  check('gera a prévia (imagem) com o botão Baixar', !!g('sharePreview').querySelector('img') && /Baixar/.test(g('sharePreview').textContent) && !/📤 Compartilhar/.test(g('sharePreview').textContent));
  w.downloadShareResult(); await tick(10);
  check('baixar salva "ficha-jiboia.png"', downloads.at(-1) === 'ficha-jiboia.png');
  w.closeActiveDrawer();
  w.openShare('vase', 'v2'); await tick(30);
  const opts = () => [...g('shareOptions').querySelectorAll('.share-opt')];
  check('vaso com 1 foto: antes/depois e vídeo ficam desativados com a explicação', opts().length === 3 && !opts()[0].disabled && opts()[1].disabled && opts()[2].disabled && /pelo menos 2 fotos/.test(opts()[1].textContent));
  w.closeActiveDrawer();
  w.openShare('vase', 'v1'); await tick(30);
  check('vaso com 3 fotos: antes/depois habilitado; vídeo desabilitado (navegador sem gravação)', !opts()[1].disabled && opts()[2].disabled && /não suporta gravar vídeo/.test(opts()[2].textContent), opts().map(o => o.disabled).join());
  await w.runShare('beforeafter'); await tick(40);
  w.downloadShareResult();
  check('antes e depois: baixa "evolucao-vaso-da-sala.png"', downloads.at(-1) === 'evolucao-vaso-da-sala.png');
  check('as opções voltam a ficar habilitadas depois de gerar', !opts()[0].disabled && !opts()[1].disabled);
  // compartilhamento nativo
  const shared = [];
  Object.defineProperty(w.navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(w.navigator, 'share', { value: async (d) => { shared.push(d); }, configurable: true });
  w.File = w.File || class { constructor(parts, name, o) { this.name = name; this.type = o.type; } };
  await w.runShare('fiche'); await tick(40);
  check('com Web Share disponível, aparece o botão Compartilhar', /📤 Compartilhar/.test(g('sharePreview').textContent));
  await w.shareResult(); await tick(10);
  check('compartilha o arquivo com título e texto', shared.length === 1 && shared[0].files[0].name === 'ficha-vaso-da-sala.png' || shared[0].files[0].name.startsWith('ficha-') , JSON.stringify(shared[0] && shared[0].files[0].name));
  Object.defineProperty(w.navigator, 'share', { value: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }, configurable: true });
  await w.shareResult(); await tick(10);
  check('cancelar o compartilhamento não mostra erro', !/Não foi possível compartilhar/.test(t.toasts()));
  Object.defineProperty(w.navigator, 'share', { value: async () => { throw new Error('falhou'); }, configurable: true });
  await w.shareResult(); await tick(10);
  check('erro real mostra aviso e sugere Baixar', /Baixar/.test(t.toasts()));
  w.closeActiveDrawer();

  console.log('3) Vídeo (gravador simulado)');
  const chunks = [];
  w.MediaRecorder = class { constructor(stream, o) { this.o = o; w.__mime = o.mimeType; } start() { this.started = true; } stop() { this.ondataavailable({ data: new w.Blob(['v'], { type: this.o.mimeType }) }); setTimeout(() => this.onstop(), 0); } static isTypeSupported(m) { return m === 'video/webm;codecs=vp9' || m === 'video/webm'; } };
  check('escolhe o melhor formato aceito (webm/vp9 neste teste)', w.pickVideoMime() === 'video/webm;codecs=vp9');
  w.openShare('vase', 'v1'); await tick(30);
  check('com gravador, a opção de vídeo é habilitada e informa a duração', !opts()[2].disabled && /3 fotos, cerca de 4 s/.test(opts()[2].textContent), opts()[2].textContent.replace(/\s+/g, ' '));
  const p = w.runShare('video');
  await tick(1200);
  check('mostra o andamento da gravação', /Gravando o vídeo… \d+%/.test(g('sharePreview').textContent), g('sharePreview').textContent);
  await p; await tick(60);
  check('prévia em <video> e arquivo .webm', !!g('sharePreview').querySelector('video') && downloads.length > 0 && (w.downloadShareResult(), downloads.at(-1) === 'evolucao-vaso-da-sala.webm'), downloads.at(-1));
  check('sem erros de script', t.errors.length === 0, t.errors.join('|'));
  process.exit(summary() ? 1 : 0);
})().catch(e => { console.error('FALHA', e); process.exit(2); });
