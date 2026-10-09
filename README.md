# 🌿 Minhas Plantas

App web (PWA) para cuidar de plantas e vasos: rega, adubo, poda, pragas e tratamentos, agenda, galeria de evolução,
diagnóstico e identificação por IA, notificações no celular e tema claro/escuro. Cada pessoa entra com a conta Google
e tem o seu jardim privado.

- Sem build: arquivos estáticos (HTML, CSS e módulos JavaScript) servidos pelo GitHub Pages.
- Dados no Firebase (Auth + Firestore), fotos no Cloudinary, notificações com um Worker da Cloudflare — tudo no plano gratuito.
- **Configuração passo a passo:** [`GUIA-DE-CONFIGURACAO.md`](GUIA-DE-CONFIGURACAO.md)

## Estrutura
```
index.html            páginas, painéis e formulários
style.css             estilos (gerado; veja "Estilos")
sw.js                 service worker: offline e notificações
js/
  config.js           Firebase, Cloudinary, endereço das notificações
  main.js             inicialização; liga as ações usadas pelo HTML
  state.js            estado compartilhado
  firebase.js · data.js · repo.js     acesso aos dados (sempre filtrado por dono)
  auth.js · account.js                login, perfil e configurações
  care.js · schedule.js               regras de rega/adubo/poda, alertas e agenda
  species.js · vases.js · vasedetail.js · carelog.js · pests.js
  gallery.js · lightbox.js · photos.js · images.js
  filters.js · dashboard.js · agenda.js · nav.js
  ai.js · workers.js · share.js · backup.js · excel.js
  notifications.js · theme.js · utils.js · ui/
worker-plantas.js     exemplo de Worker de IA (3 rotas: ficha, diagnóstico, identificar)
worker-push.js        Worker das notificações
firestore.rules       regras de segurança (com migração)  ·  firestore.rules.estrito
tests/                testes automáticos
```

## Testes
```bash
npm install
npm test        # login/isolamento, fotos, desfazer, pragas, agenda, backup, notificações, acessibilidade…
npm run lint
```

## Estilos
`style.css` contém ícones embutidos (SVG) e é gerado de `style.src.css` por `python3 build_assets.py`.
Para mudar cores, edite as variáveis no início de `style.src.css` (tema claro em `:root`, escuro em `:root[data-theme="dark"]`).
