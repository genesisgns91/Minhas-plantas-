// Service worker mínimo — apenas para habilitar a instalação do app (PWA).
// Não faz cache agressivo porque o app depende de dados em tempo real do Firestore.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

// Passa todas as requisições direto para a rede (sem cache),
// mantendo os dados do Firebase sempre atualizados.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
