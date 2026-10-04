// =====================================================================
// MINHAS PLANTAS — Worker de IA (Cloudflare Workers)
// ---------------------------------------------------------------------
// Rotas (todas POST, com CORS liberado):
//   /auto-fill-plant  · form-data: plant_name            → ficha de cultivo
//   /diagnose-plant   · form-data: file (imagem)         → diagnóstico de saúde + fase da lua
//   /identify-plant   · form-data: file (imagem)         → identifica a espécie pela foto
//
// Provedor: escolhido pelo segredo que existir no Worker (nesta ordem):
//   GROQ_API_KEY   → Groq   (visão: llama-4-scout)
//   OPENAI_API_KEY → OpenAI (visão: gpt-4o-mini)
//   GEMINI_API_KEY → Gemini (visão: gemini-2.0-flash)
// Para trocar o modelo sem editar o código, crie as variáveis opcionais:
//   VISION_MODEL (imagens) e TEXT_MODEL (só texto).
//
// Como usar: Workers & Pages → seu Worker → Edit code → cole este arquivo →
// Settings → Variables and Secrets → adicione a chave do provedor → Deploy.
// =====================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

// ---------- Provedores ----------
function pickProvider(env) {
  if (env.GROQ_API_KEY) {
    return { kind: 'openai-compat', base: 'https://api.groq.com/openai/v1', key: env.GROQ_API_KEY,
      vision: env.VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct', text: env.TEXT_MODEL || 'llama-3.3-70b-versatile' };
  }
  if (env.OPENAI_API_KEY) {
    return { kind: 'openai-compat', base: 'https://api.openai.com/v1', key: env.OPENAI_API_KEY,
      vision: env.VISION_MODEL || 'gpt-4o-mini', text: env.TEXT_MODEL || 'gpt-4o-mini' };
  }
  if (env.GEMINI_API_KEY) {
    return { kind: 'gemini', key: env.GEMINI_API_KEY,
      vision: env.VISION_MODEL || 'gemini-2.0-flash', text: env.TEXT_MODEL || 'gemini-2.0-flash' };
  }
  return null;
}

// Envia o pedido ao provedor e devolve o texto da resposta. `image` = { mime, base64 } (opcional).
async function askModel(provider, { prompt, image, asJson }) {
  const model = image ? provider.vision : provider.text;

  if (provider.kind === 'gemini') {
    const parts = [{ text: prompt }];
    if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.base64 } });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.3, ...(asJson ? { responseMimeType: 'application/json' } : {}) }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(data.error && data.error.message) || 'erro'}`);
    const text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
      && data.candidates[0].content.parts.map(p => p.text || '').join('');
    if (!text) throw new Error('Gemini devolveu resposta vazia');
    return text;
  }

  const content = [{ type: 'text', text: prompt }];
  if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } });
  const res = await fetch(`${provider.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [{ role: 'user', content }],
      ...(asJson ? { response_format: { type: 'json_object' } } : {})
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${(data.error && data.error.message) || 'erro do provedor'}`);
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('Provedor devolveu resposta vazia');
  return text;
}

// Extrai o JSON mesmo que o modelo coloque ```json ou texto em volta
function parseJsonLoose(text) {
  const clean = String(text).replace(/```json|```/gi, '').trim();
  try { return JSON.parse(clean); } catch (e) { /* tenta recortar */ }
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(clean.slice(a, b + 1));
  throw new Error('A IA não devolveu um JSON válido');
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function readImage(form) {
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.arrayBuffer) return null;
  const buf = await file.arrayBuffer();
  if (!buf.byteLength) return null;
  return { mime: file.type || 'image/jpeg', base64: toBase64(buf) };
}

// ---------- Fase da lua (mesma lógica do backend antigo) ----------
function moonInfo(now = new Date()) {
  const SYNODIC = 29.530588853;
  const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14); // lua nova conhecida
  const days = (now.getTime() - NEW_MOON_REF) / 86400000;
  const lunation = ((days % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;

  let phase, tip;
  if (lunation < 0.03 || lunation > 0.97) { phase = 'Nova'; tip = 'Seiva concentrada nas raízes. Fase ideal para adubação profunda.'; }
  else if (lunation < 0.22) { phase = 'Crescente Inicial'; tip = 'Seiva subindo para os ramos. Boa época para regas.'; }
  else if (lunation < 0.28) { phase = 'Quarto Crescente'; tip = 'Ótimo momento para plantio e fortalecimento foliar.'; }
  else if (lunation < 0.47) { phase = 'Crescente Gibosa'; tip = 'Desenvolvimento acelerado das folhas.'; }
  else if (lunation < 0.53) { phase = 'Cheia'; tip = 'Seiva no topo. Evite podas drásticas hoje!'; }
  else if (lunation < 0.72) { phase = 'Minguante Gibosa'; tip = 'Bom período para limpeza de folhas secas.'; }
  else if (lunation < 0.78) { phase = 'Quarto Minguante'; tip = 'Momento ideal para poda e controle de pragas.'; }
  else { phase = 'Minguante Final'; tip = 'Repouso vegetativo. Bom momento para preparar o solo.'; }
  return { phase, tip, lunation_percent: Math.round(lunation * 1000) / 10 };
}

// ---------- Rotas ----------
async function autoFill(provider, form) {
  const name = String(form.get('plant_name') || '').trim();
  if (!name) return json({ error: 'Informe o nome da planta (plant_name).' }, 400);

  const prompt = `Você é um botânico especialista em plantas ornamentais e de vaso no Brasil.
Forneça a ficha de cultivo da planta "${name}". Responda SOMENTE com um objeto JSON válido, em português do Brasil, neste formato:
{
  "scientific_name": "nome(s) científico(s) e outros nomes populares",
  "category": "categoria (ex: Trepadeira, Suculenta, Folhagem)",
  "light": "necessidade de luz e sol direto",
  "water": "necessidade de rega, em uma frase curta",
  "water_days": 5,
  "pruning": "tolerância e cuidados com poda",
  "humidity": "umidade do ar ideal",
  "soil": "tipo de solo e drenagem",
  "fertilizer": "adubação comercial recomendada e frequência",
  "natural_fertilizer": "opção de adubação natural",
  "extra_tips": "uma dica extra útil",
  "observations": "o que evitar",
  "pet_toxicity": "Segura | Tóxica | Letal",
  "pet_warning": "explicação breve sobre toxicidade para cães e gatos"
}
"water_days" deve ser um número inteiro (dias entre regas em condições médias). "pet_toxicity" deve ser exatamente uma das três opções.`;

  const out = parseJsonLoose(await askModel(provider, { prompt, asJson: true }));
  out.water_days = Math.max(1, parseInt(out.water_days, 10) || 5);
  return json(out);
}

async function diagnose(provider, form) {
  const image = await readImage(form);
  if (!image) return json({ error: 'Envie uma imagem no campo "file".' }, 400);

  const moon = moonInfo();
  const prompt = `Você é um engenheiro agrônomo especialista em plantas ornamentais. Analise a saúde visual da planta nesta imagem.
Contexto: Brasil, Lua ${moon.phase}.
Responda em português do Brasil, em texto simples (sem markdown, sem asteriscos), com estas seções numeradas:
1. Aparência & Saúde Geral
2. Diagnóstico de problemas/pragas
3. Plano de Ação Imediato
4. Dica Lunar (${moon.phase})
Se a imagem não mostrar uma planta, diga isso com educação.`;

  const diagnosis = (await askModel(provider, { prompt, image })).trim();
  return json({ diagnosis, moon_phase: moon.phase, moon_tip: moon.tip });
}

async function identify(provider, form) {
  const image = await readImage(form);
  if (!image) return json({ error: 'Envie uma imagem no campo "file".' }, 400);

  const prompt = `Você é um botânico especialista em identificar plantas por foto.
Identifique a planta da imagem. Responda SOMENTE com um objeto JSON válido, em português do Brasil:
{
  "is_plant": true,
  "name": "nome popular mais comum no Brasil",
  "scientific_name": "nome científico",
  "confidence": 85,
  "description": "2 frases curtas sobre a planta e como reconhecê-la",
  "water_days": 7,
  "light": "necessidade de luz, curta",
  "pet_toxicity": "Segura | Tóxica | Letal",
  "alternatives": [ { "name": "outra possibilidade", "scientific_name": "nome científico" } ]
}
Regras: "confidence" é um número de 0 a 100 que reflete sua certeza real (use valores baixos se a foto for ruim ou a espécie ambígua).
"alternatives" tem no máximo 3 itens, só quando houver dúvida real (senão, lista vazia).
"pet_toxicity" deve ser exatamente Segura, Tóxica ou Letal.
Se a imagem NÃO mostrar uma planta, responda apenas {"is_plant": false}.`;

  const out = parseJsonLoose(await askModel(provider, { prompt, image, asJson: true }));
  if (out.is_plant === false) return json({ is_plant: false });
  if (!out.name) throw new Error('A IA não conseguiu identificar a planta');
  out.is_plant = true;
  out.confidence = Math.max(0, Math.min(100, Math.round(Number(out.confidence) || 0)));
  out.water_days = parseInt(out.water_days, 10) || null;
  out.alternatives = Array.isArray(out.alternatives) ? out.alternatives.slice(0, 3) : [];
  return json(out);
}

const ROUTES = { 'auto-fill-plant': autoFill, 'diagnose-plant': diagnose, 'identify-plant': identify };

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

    const route = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '').replace(/^api\//, '');
    const handler = ROUTES[route];
    if (!handler) return json({ error: `Rota desconhecida: ${route || '/'}` }, 404);

    const provider = pickProvider(env);
    if (!provider) return json({ error: 'Nenhuma chave de IA configurada (GROQ_API_KEY, OPENAI_API_KEY ou GEMINI_API_KEY).' }, 500);

    try {
      const form = await request.formData();
      return await handler(provider, form);
    } catch (err) {
      // 502 faz o app tentar a próxima Worker da lista
      return json({ error: String(err && err.message ? err.message : err) }, 502);
    }
  }
};
