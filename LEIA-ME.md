# Minhas Plantas — correção das IAs (atualizado)

## Causa real (confirmada pelo console do navegador)
Todas as 8 Workers respondiam `status 500 — No number after minus sign in JSON at position 1`.
Ou seja: elas leem o corpo do pedido como **JSON**, e o app novo enviava **form-data** (que começa com `------WebKit…`;
o `-` na posição 1 é o que quebra o `JSON.parse`). O histórico do repositório mostra o protocolo que essas Workers sempre usaram:
`POST` na raiz, corpo `{prompt, imageBase64, mimeType}`, resposta `{resposta: "texto"}` (o caminho `/auto-fill-plant` é ignorado).

## Correção
- `js/prompts.js` (novo): prompts de ficha, diagnóstico e identificação + leitura da resposta em texto (aceita ```json, etc.).
- `js/workers.js`: fala o protocolo das suas Workers por padrão (JSON → `resposta`). Se uma Worker responder no formato novo
  (`worker-plantas.js`), o app troca sozinho para form-data e lembra qual idioma cada uma usa. Também começa pela última Worker
  que funcionou e mostra no "Ver detalhes técnicos" o motivo de cada falha.
- `js/ai.js`, `js/species.js`: passam os prompts para o `workers.js`.
- `sw.js`: cache v8 (o app instalado pega os arquivos novos).
- `worker-plantas.js` (opcional): continua disponível, agora com fallback de modelos.

**Você não precisa mexer nas Workers do Cloudflare.** Basta enviar ao GitHub: `js/` (workers.js, prompts.js, ai.js,
species.js, config.js) e `sw.js`. Depois recarregue o app (se estiver instalado, feche e abra duas vezes).

Limitação: o diagnóstico/identificação por foto só funciona nas Workers que aceitam imagem (`imageBase64`). As que forem
só de texto falham nesse passo e o app segue para a próxima. A ficha automática funciona em qualquer uma.

---
(Abaixo, o texto da primeira versão — as partes sobre 400 e timeout continuam valendo.)


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
