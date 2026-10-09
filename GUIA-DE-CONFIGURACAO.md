# Guia de configuração — Minhas Plantas

Tudo aqui usa **planos gratuitos, sem cartão**: GitHub Pages, Firebase (plano Spark), Cloudinary e Cloudflare Workers.
Faça na ordem. Cada etapa leva poucos minutos.

---

## 1. Colocar os arquivos no GitHub
1. No repositório, apague os arquivos antigos que foram substituídos (`app.js`) e envie **todo o conteúdo** desta pasta (arquivos e a pasta `js/`), mantendo a estrutura.
2. Em *Settings → Pages*, confirme que o site é publicado a partir da branch principal.
3. Anote o endereço do site (algo como `https://SEU-USUARIO.github.io/Minhas-plantas-/`).

## 2. Login com Google (Firebase Authentication)
1. Abra o [console do Firebase](https://console.firebase.google.com) → seu projeto **minhasplantas-9b229**.
2. **Authentication → Começar → Método de login → Google → Ativar** (escolha um e-mail de suporte e salve).
3. **Authentication → Configurações → Domínios autorizados → Adicionar domínio**: coloque o endereço do seu site **sem** `https://` e sem barra no fim (ex.: `seu-usuario.github.io`).

## 3. Regras de segurança (cada pessoa só vê o que é seu)
1. **Firestore Database → Regras**.
2. Apague o texto atual, cole o conteúdo de **`firestore.rules`** e clique em **Publicar**.
3. Abra o app e **entre com `genesisgns@gmail.com`**: os dados que já existiam passam a ser seus automaticamente.
   Qualquer outra conta entra com o jardim vazio e nunca vê esses dados.
4. Depois de conferir que seus dados apareceram, volte em *Regras* e cole **`firestore.rules.estrito`**. Ele tira a exceção usada só na migração (ninguém, nem o administrador, lê dados de outra pessoa).

> Importante: publique as regras **depois** de enviar o app novo ao GitHub. O app antigo (sem login) deixa de funcionar com as regras novas.

## 4. Fotos no Cloudinary
1. Abra `js/config.js` e troque `SEU_CLOUD_NAME` pelo **Cloud name** que aparece no painel do Cloudinary (Dashboard, canto superior esquerdo).
2. O preset **Unsigned** já está listado (`c5wrwkf8`; se esse nome não existir o app tenta `MyPlants`). Se o seu tiver outro nome, acrescente na lista `presets`.
3. Nas configurações do app (⚙️), o botão **“Enviar fotos antigas para o Cloudinary”** move as fotos que já estavam no banco.

## 5. Notificações no celular (Cloudflare Workers — grátis)
1. Em [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Worker**. Dê o nome `plantas-push` e abra **Edit code**. Cole o conteúdo de **`worker-push.js`** e faça **Deploy**.
2. **Storage & Databases → KV → Create namespace** (nome `plantas-push`). No Worker: **Settings → Bindings → Add → KV namespace**, com o nome da variável **`PUSH_KV`**.
3. No Worker: **Settings → Trigger Events → Cron Triggers → Add** → `0 * * * *` (uma vez por hora).
4. (Opcional, recomendado) **Settings → Variables**: `ALLOWED_ORIGIN` = `https://SEU-USUARIO.github.io` e `CONTACT` = `mailto:seu@email.com`.
5. Copie o endereço do Worker (termina em `.workers.dev`) para `js/config.js`, em `PUSH_URL`, **com a barra no final**: `https://plantas-push.SEU-SUBDOMINIO.workers.dev/`.
6. No app: ⚙️ → **Notificações no celular** → ligue o interruptor, escolha o horário e toque em **Enviar notificação de teste**.
   - **Android/Chrome**: funciona direto.
   - **iPhone**: abra o site no Safari → Compartilhar → **Adicionar à Tela de Início**, e ative as notificações pelo app instalado (iOS 16.4 ou mais novo).

## 6. IAs (diagnóstico, identificar planta, ficha automática)
As Workers de IA continuam na ordem definida em `js/config.js`/`js/workers.js`. Cada uma precisa responder às rotas
`auto-fill-plant`, `diagnose-plant` e `identify-plant` (o arquivo `worker-plantas.js` é um exemplo completo).

---

## Se algo não funcionar
| Sintoma | O que fazer |
|---|---|
| “Este endereço ainda não foi autorizado” ao entrar | Etapa 2, item 3 (domínios autorizados) |
| “O login com Google ainda não foi ativado” | Etapa 2, item 2 |
| Entra, mas aparece “Sem permissão no banco de dados” | Etapa 3: regras publicadas? Conta correta? |
| Foto não envia / “cloud name incorreto” | Etapa 4, item 1 |
| “Preset não encontrado” | Confira o nome do preset e se está como **Unsigned** |
| Notificação não chega | Teste pelo botão do app; no iPhone use o app instalado; confira `PUSH_URL` e o KV `PUSH_KV` |

## Limites do plano gratuito (folga grande para uso pessoal)
- **Firestore**: 50 mil leituras e 20 mil gravações por dia.
- **Cloudinary**: 25 “créditos” por mês (armazenamento, banda e transformações).
- **Cloudflare**: 100 mil requisições por dia; KV com 1 mil gravações por dia.
