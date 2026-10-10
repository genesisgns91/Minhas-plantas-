// Pedidos de IA no formato das Workers "de conversa" (as suas contas .workers.dev): recebem
// POST em JSON { prompt, imageBase64?, mimeType? } na raiz e devolvem { resposta: "texto" }.
// Aqui ficam os prompts e a leitura da resposta (a Worker só devolve texto, então o app converte em dados).

function moonInfo(now = new Date()) {
  const SYNODIC = 29.530588853;
  const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14);
  const lunation = ((((now.getTime() - NEW_MOON_REF) / 86400000) % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
  if (lunation < 0.03 || lunation > 0.97) return { phase: 'Nova', tip: 'Seiva concentrada nas raízes. Fase ideal para adubação profunda.' };
  if (lunation < 0.22) return { phase: 'Crescente Inicial', tip: 'Seiva subindo para os ramos. Boa época para regas.' };
  if (lunation < 0.28) return { phase: 'Quarto Crescente', tip: 'Ótimo momento para plantio e fortalecimento foliar.' };
  if (lunation < 0.47) return { phase: 'Crescente Gibosa', tip: 'Desenvolvimento acelerado das folhas.' };
  if (lunation < 0.53) return { phase: 'Cheia', tip: 'Seiva no topo. Evite podas drásticas hoje!' };
  if (lunation < 0.72) return { phase: 'Minguante Gibosa', tip: 'Bom período para limpeza de folhas secas.' };
  if (lunation < 0.78) return { phase: 'Quarto Minguante', tip: 'Momento ideal para poda e controle de pragas.' };
  return { phase: 'Minguante Final', tip: 'Repouso vegetativo. Bom momento para preparar o solo.' };
}

// Aceita ```json, texto em volta etc.
export function parseJsonLoose(text) {
  const clean = String(text).replace(/```json|```/gi, '').trim();
  try { return JSON.parse(clean); } catch (e) { /* tenta recortar */ }
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(clean.slice(a, b + 1));
  throw new Error('a IA não devolveu um JSON válido');
}

export function autoFillRequest(name) {
  const prompt = `Você é um botânico especialista em plantas ornamentais e de vaso no Brasil.
Forneça a ficha de cultivo da planta "${name}". Responda SOMENTE com um objeto JSON válido, sem markdown, em português do Brasil, neste formato:
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
  return {
    prompt,
    parse(text) {
      const out = parseJsonLoose(text);
      out.water_days = Math.max(1, parseInt(out.water_days, 10) || 5);
      return out;
    }
  };
}

export function diagnoseRequest() {
  const moon = moonInfo();
  const prompt = `Você é um engenheiro agrônomo especialista em plantas ornamentais. Analise a saúde visual da planta nesta imagem.
Contexto: Brasil, Lua ${moon.phase}.
Responda em português do Brasil, em texto simples (sem markdown, sem asteriscos), com estas seções numeradas:
1. Aparência & Saúde Geral
2. Diagnóstico de problemas/pragas
3. Plano de Ação Imediato
4. Dica Lunar (${moon.phase})
Se a imagem não mostrar uma planta, diga isso com educação.`;
  return {
    prompt,
    parse(text) {
      const diagnosis = String(text).replace(/\*\*/g, '').trim();
      if (!diagnosis) throw new Error('resposta vazia');
      return { diagnosis, moon_phase: moon.phase, moon_tip: moon.tip };
    }
  };
}

export function identifyRequest() {
  const prompt = `Você é um botânico especialista em identificar plantas por foto.
Identifique a planta da imagem. Responda SOMENTE com um objeto JSON válido, sem markdown, em português do Brasil:
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
  return {
    prompt,
    parse(text) {
      const out = parseJsonLoose(text);
      if (out.is_plant === false) return { is_plant: false };
      if (!out.name) throw new Error('a IA não conseguiu identificar a planta');
      out.is_plant = true;
      out.confidence = Math.max(0, Math.min(100, Math.round(Number(out.confidence) || 0)));
      out.water_days = parseInt(out.water_days, 10) || null;
      out.alternatives = Array.isArray(out.alternatives) ? out.alternatives.slice(0, 3) : [];
      return out;
    }
  };
}
