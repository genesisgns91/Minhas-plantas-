// Service worker do Minhas Plantas: abre o app mesmo sem internet e recebe as notificações (Web Push).
// Não guarda dados do Firebase nem fotos: só os arquivos do próprio app.
const CACHE = 'minhas-plantas-v11';
const PUSH_URL = new URL(self.location.href).searchParams.get('push') || '';
const SHELL = ['./', './index.html', './style.css', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Rede primeiro (sempre a versão mais nova); se estiver offline, usa a cópia guardada.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Biblioteca do Firebase (versão fixa, nunca muda): cópia local primeiro, para o app abrir sem internet
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return; // dados do Firebase, Cloudinary, fontes etc. passam direto
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// O aviso chega sem conteúdo; o texto é pedido ao Worker (que sabe o que vence hoje).
async function showDailyNotification() {
  let msg = { title: '🌿 Minhas Plantas', body: 'Há cuidados esperando por você hoje.', tag: 'minhas-plantas-diario' };
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (sub && PUSH_URL) {
      const res = await fetch(`${PUSH_URL}peek?id=${await sha256Hex(sub.endpoint)}`);
      if (res.ok) msg = { ...msg, ...(await res.json()) };
    }
  } catch (e) { /* usa a mensagem padrão */ }
  await self.registration.showNotification(msg.title, {
    body: msg.body, tag: msg.tag, icon: 'icon-192.png', badge: 'icon-192.png', lang: 'pt-BR', data: { tab: 'agenda' }
  });
}

self.addEventListener('push', (event) => { event.waitUntil(showDailyNotification()); });

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const tab = (event.notification.data && event.notification.data.tab) || 'agenda';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ('focus' in client) { client.postMessage({ type: 'open-tab', tab }); return client.focus(); }
    }
    return self.clients.openWindow(`./?tab=${tab}`);
  }));
});
