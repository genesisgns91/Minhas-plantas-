# Minhas Plantas — correção das IAs

## O que estava errado
O app chama cada Worker em `<url>/diagnose-plant`, `/identify-plant` e `/auto-fill-plant` (form-data).
Essas rotas só existem no `worker-plantas.js`. As 8 Workers da lista (`certificados-groq-proxy`, `astro-gns-proxy`…)
vieram de outros projetos e, se não receberam esse código, respondem 404/400 ("rota desconhecida", "missing messages"…).

Além disso havia um bug no app (`js/workers.js`): qualquer resposta **400** encerrava a lista na primeira Worker.
Como uma Worker de outro projeto responde 400 a um formato que não entende, o app desistia sem tentar as outras 7.

> Não consegui chamar as Workers daqui (a rede do ambiente bloqueia `*.workers.dev`), então não pude testar as
> suas Workers reais. A correção do app foi testada com respostas simuladas.

## Mudanças
- `js/workers.js`: 400 só encerra se vier do Worker deste app; qualquer outro erro segue para a próxima. Guarda a última
  Worker que funcionou e começa por ela. Os "detalhes técnicos" agora mostram status e trecho da resposta
  (ex.: `status 404 — Not Found`, `sem resposta (fora do ar, bloqueada ou sem CORS)`).
- `js/config.js`: timeout por Worker de 40 s → 25 s (com 8 Workers, uma parada não trava mais por 5 minutos).
- `js/ai.js`: mensagem "tentando outra conta" usa o total correto.
- `worker-plantas.js`: lista de modelos com fallback (se um modelo for desativado, tenta o próximo), fallback entre
  provedores se houver mais de uma chave, tentativa sem `response_format` quando o modelo não aceita, chave Gemini
  enviada por header, e **teste por navegador** (GET no endereço do Worker mostra rotas e provedores configurados).
- `sw.js`: cache `v6` → `v7`, para o app instalado pegar os arquivos novos.

## O que você precisa fazer (a parte que só você consegue)
1. No Cloudflare, abra **uma** Worker (ex.: `shiny-sky-21dd`) → *Edit code* → cole o novo `worker-plantas.js` → Deploy.
2. *Settings → Variables and Secrets*: adicione `GROQ_API_KEY` (ou `GEMINI_API_KEY` / `OPENAI_API_KEY`).
3. Abra `https://shiny-sky-21dd.genesisgns.workers.dev/` no navegador. Deve aparecer
   `{"ok":true,"routes":["auto-fill-plant","diagnose-plant","identify-plant"],"providers":["groq"]}`.
   Se `providers` vier vazio, falta a chave.
4. Repita nas outras Workers que quiser manter (ou remova da lista em `js/config.js` as que não forem do app).
5. Suba os arquivos para o GitHub (`js/`, `worker-plantas.js`, `sw.js`).

Se, depois disso, ainda falhar, abra a aba de IA, tente uma foto e copie o "Ver detalhes técnicos": ele agora diz o motivo de cada Worker.
