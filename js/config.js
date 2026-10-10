// Configurações do app. Para trocar a prioridade das IAs, a conta do Cloudinary etc., edite só este arquivo.

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBO2dpMGZG5N7-5wLTexU2puDsGjxzSDaI",
  authDomain: "minhasplantas-9b229.firebaseapp.com",
  projectId: "minhasplantas-9b229",
  storageBucket: "minhasplantas-9b229.firebasestorage.app",
  messagingSenderId: "568939226178",
  appId: "1:568939226178:web:dcc77000360c7fdadcb9db"
};

// Só esta conta recebe os dados que já existiam antes do login (migração automática no 1º acesso).
export const ADMIN_EMAIL = 'genesisgns@gmail.com';

// Hospedagem das fotos (Cloudinary, plano gratuito). Preencha o "Cloud name" que aparece no painel do Cloudinary.
// Enquanto não for preenchido, as fotos continuam sendo gravadas dentro do Firestore (com limite de tamanho).
export const CLOUDINARY = {
  cloudName: 'SEU_CLOUD_NAME',
  // Nome do preset "Unsigned". Se o primeiro não existir, o app tenta o próximo da lista.
  presets: ['c5wrwkf8', 'MyPlants']
};

// Endereço do Worker de notificações (veja GUIA-DE-CONFIGURACAO.md). Vazio = notificações desativadas.
export const PUSH_URL = '';

// ==================== IAs (Cloudflare Workers) — ORDEM DE PRIORIDADE ====================
// Cada chamada de IA começa pela primeira e, se ela não responder, passa para a próxima.
// Para mudar a prioridade, basta reordenar a lista. As URLs terminam com "/".
export const WORKERS = [
  { name: 'certificados-groq-proxy', url: 'https://certificados-groq-proxy.genesisgns.workers.dev/' },
  { name: 'gns91-groq-proxy',        url: 'https://gns91-groq-proxy.genesisgns.workers.dev/' },
  { name: 'forzion-gpt-proxy',       url: 'https://forzion-gpt-proxy.genesisgns.workers.dev/' },
  { name: 'mamoot-gpt-proxy',        url: 'https://mamoot-gpt-proxy.genesisgns.workers.dev/' },
  { name: 'astro-gns-proxy',         url: 'https://astro-gns-proxy.genesisgns.workers.dev/' },
  { name: 'shiny-sky-21dd',          url: 'https://shiny-sky-21dd.genesisgns.workers.dev/' },
  { name: 'astro2',                  url: 'https://astro2.genesisgns.workers.dev/' },
  { name: 'interno',                 url: 'https://interno.genesisgns.workers.dev/' }
];

export const WORKER_TIMEOUT_MS = 25000;
