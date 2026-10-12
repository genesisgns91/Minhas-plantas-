// Pedidos de IA no formato das Workers "de conversa" (as suas contas .workers.dev): recebem
// POST em JSON { prompt, imageBase64?, mimeType? } na raiz e devolvem { resposta: "texto" }.
// Aqui ficam os prompts, a leitura da resposta (a Worker só devolve texto, então o app converte em dados)
// e o "juiz" de cada resposta de foto: 'ok' | 'negative' (viu a foto e não há planta) | 'novision'
// (a conta NÃO enxerga imagens — modelo só de texto — e por isso a resposta não vale nada).

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

// ---------- Reconhecer respostas de quem NÃO vê a imagem ----------
// Um modelo só de texto recebe o pedido sem a foto e responde "não vejo imagem" ou, pior, "não há planta".
// Estas frases (só as que falam de NÃO RECEBER/ENXERGAR a imagem) marcam a conta como "sem visão".
const NO_IMAGE_RE = new RegExp([
  'sem_imagem', 'no_image',
  'n[aã]o (consigo|posso|sou capaz de|tenho como) (ver|visualizar|acessar|abrir|processar|analisar|interpretar) (a |uma |nenhuma |as |qualquer )?(imagem|foto|imagens|fotos)',
  'n[aã]o (recebi|vejo|encontrei) nenhuma (imagem|foto)',
  'n[aã]o (recebi|vejo|encontrei) (uma |a )?(imagem|foto) (anexad|enviad|fornecid|dispon|carregad)',
  '(imagem|foto) (anexada |enviada |fornecida )?n[aã]o (foi (anexad|enviad|fornecid|carregad)|chegou|est[aá] (anexad|dispon[ií]vel|presente))',
  '(nenhuma|sem) (imagem|foto) (foi |est[aá] |)(anexad|enviad|fornecid|dispon|carregad)',
  'n[aã]o (h[aá]|existe) (nenhuma )?(imagem|foto) (anexad|enviad|fornecid|dispon|para analisar)',
  'n[aã]o (tenho|possuo) (a capacidade|capacidade|acesso|habilidade).{0,30}(imagem|imagens|foto|visual)',
  'sou (um )?(modelo|assistente|ia).{0,40}(apenas |somente |s[oó] )?de texto',
  '(can(no|\')t|cannot|unable to|do(n\'t| not)) (see|view|access|process|analy[sz]e|open) (the |an |any |this )?(image|photo|picture)',
  'no (image|photo|picture) (was |has been |is |were )?(provided|attached|uploaded|included|sent|visible)'
].join('|'), 'i');

// Respostas de quem VIU a foto e afirma que não há planta (só vale depois de a conta provar que enxerga).
const NO_PLANT_RE = /(n[aã]o (mostra|cont[eé]m|apresenta|h[aá]|vejo|identifiquei|encontrei|aparece|parece haver).{0,40}(planta|vegeta[cç][aã]o|folha)|nenhuma (planta|folha|vegeta[cç][aã]o)|sem (planta|vegeta[cç][aã]o))/i;

export const looksLikeNoImage = (t) => NO_IMAGE_RE.test(String(t || ''));

// ---------- Ficha de cultivo (só texto) ----------
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

// ---------- Diagnóstico por foto ----------
export function diagnoseRequest() {
  const moon = moonInfo();
  const prompt = `Você é um engenheiro agrônomo especialista em plantas ornamentais. Analise a saúde visual da planta que aparece na IMAGEM ANEXADA.
Se você NÃO conseguir ver nenhuma imagem anexada, responda exatamente SEM_IMAGEM e mais nada.
Contexto: Brasil, Lua ${moon.phase}.
Fotos de celular podem estar escuras, tremidas, de perto ou mostrar só parte da planta (folhas, flor, caule, terra). Se aparecer QUALQUER parte de uma planta, mesmo parcial ou dentro de um vaso, analise o que dá para ver e diga o que faltou para um diagnóstico melhor. Só diga que não há planta se a foto realmente não tiver nenhuma folha, flor ou vegetação.
Responda em português do Brasil, em texto simples (sem markdown, sem asteriscos), com estas seções numeradas:
1. Aparência & Saúde Geral
2. Diagnóstico de problemas/pragas
3. Plano de Ação Imediato
4. Dica Lunar (${moon.phase})`;
  return {
    prompt,
    parse(text) {
      const diagnosis = String(text).replace(/\*\*/g, '').trim();
      if (!diagnosis) throw new Error('resposta vazia');
      return { diagnosis, moon_phase: moon.phase, moon_tip: moon.tip };
    },
    judge(d) {
      const t = String((d && d.diagnosis) || '');
      if (looksLikeNoImage(t)) return 'novision';
      // Um relatório de verdade é longo; uma resposta curta dizendo "não há planta" é a negativa.
      if (t.length < 700 && NO_PLANT_RE.test(t)) return 'negative';
      return 'ok';
    }
  };
}

// ---------- Identificar a planta pela foto ----------
export function identifyRequest() {
  const prompt = `Você é um botânico especialista em identificar plantas por foto. Analise a IMAGEM ANEXADA.
Se você NÃO conseguir ver nenhuma imagem anexada, responda exatamente {"no_image": true} e mais nada.
Caso contrário, responda SOMENTE com um objeto JSON válido, sem markdown, em português do Brasil:
{
  "is_plant": true,
  "seen": "o que aparece na foto, em até 10 palavras",
  "name": "nome popular mais comum no Brasil",
  "scientific_name": "nome científico",
  "confidence": 85,
  "description": "2 frases curtas sobre a planta e como reconhecê-la",
  "water_days": 7,
  "light": "necessidade de luz, curta",
  "pet_toxicity": "Segura | Tóxica | Letal",
  "alternatives": [ { "name": "outra possibilidade", "scientific_name": "nome científico" } ]
}
Regras:
- Fotos de celular podem estar escuras, tremidas, de perto ou mostrar só parte da planta (folhas, flor, caule, fruto, terra). Se aparecer QUALQUER parte de uma planta, mesmo parcial, em vaso ou em canteiro, identifique-a: use "is_plant": true e coloque uma confiança baixa se estiver em dúvida.
- Use {"is_plant": false} SOMENTE se a foto não tiver nenhuma planta, folha ou flor (por exemplo: só pessoas, objetos, paredes ou animais).
- "confidence" é um número de 0 a 100 que reflete sua certeza real.
- "alternatives" tem no máximo 3 itens, só quando houver dúvida real (senão, lista vazia).
- "pet_toxicity" deve ser exatamente Segura, Tóxica ou Letal.`;
  return {
    prompt,
    parse(text) {
      let out;
      try { out = parseJsonLoose(text); } catch (err) {
        if (looksLikeNoImage(text)) return { no_image: true };
        throw err;
      }
      if (out.no_image || out.sem_imagem) return { no_image: true };
      if (out.is_plant === false) {
        // "não é planta" escrito por quem na verdade não recebeu a foto também conta como "sem visão"
        return looksLikeNoImage(JSON.stringify(out)) ? { no_image: true } : { is_plant: false };
      }
      if (!out.name) throw new Error('a IA não conseguiu identificar a planta');
      out.is_plant = true;
      out.confidence = Math.max(0, Math.min(100, Math.round(Number(out.confidence) || 0)));
      out.water_days = parseInt(out.water_days, 10) || null;
      out.alternatives = Array.isArray(out.alternatives) ? out.alternatives.slice(0, 3) : [];
      return out;
    },
    judge(d) {
      if (d && d.no_image) return 'novision';
      if (d && d.is_plant === false) return 'negative';
      return 'ok';
    }
  };
}
