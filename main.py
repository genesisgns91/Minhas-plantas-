import os
import json
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import google.generativeai as genai
import ephem  # Biblioteca para cálculo astronômico preciso

app = FastAPI(
    title="Minhas Plantas - API de Inteligência Artificial",
    description="Backend Python para diagnóstico de plantas, cálculo de fases da lua e dicas automatizadas.",
    version="1.0.0"
)

# Habilita CORS para permitir requisições do seu Frontend hospedado no Cloudflare Pages
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Em produção, você pode alterar para o domínio do seu Cloudflare
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuração do Google Gemini API
# A chave de API deve ser configurada nas Variáveis de Ambiente do Render/Hugging Face com o nome GEMINI_API_KEY
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


def calculate_moon_phase():
    """
    Calcula a fase atual da lua com base no horário UTC atual.
    Retorna o nome da fase em português e uma breve recomendação agronômica.
    """
    now = ephem.Date(datetime.utcnow())
    next_new = ephem.next_new_moon(now)
    prev_new = ephem.previous_new_moon(now)
    
    # Progresso da lunação (0.0 a 1.0)
    lunation = (now - prev_new) / (next_new - prev_new)
    
    if lunation < 0.03 or lunation > 0.97:
        phase = "Nova"
        tip = "Seiva concentrada nas raízes. Fase ideal para plantio de raiz e adubação profunda."
    elif lunation < 0.22:
        phase = "Crescente Inicial"
        tip = "Seiva subindo para os ramos. Boa época para regas e transplantes."
    elif lunation < 0.28:
        phase = "Quarto Crescente"
        tip = "Seiva impulsionada para cima. Ótimo momento para plantio e fortalecimento foliar."
    elif lunation < 0.47:
        phase = "Crescente Gibosa"
        tip = "Desenvolvimento acelerado das folhas. Mantenha boa hidratação."
    elif lunation < 0.53:
        phase = "Cheia"
        tip = "Seiva totalmente no topo/folhas. Evite podas drásticas hoje! Foco em regas regulares."
    elif lunation < 0.72:
        phase = "Minguante Gibosa"
        tip = "Seiva começando a descer. Bom período para limpeza de folhas secas."
    elif lunation < 0.78:
        phase = "Quarto Minguante"
        tip = "Seiva descendo para o tronco e raízes. Momento ideal para poda de contenção e controle de pragas."
    else:
        phase = "Minguante Final"
        tip = "Repouso vegetativo. Ótimo momento para preparar o solo e adubar."

    return {
        "phase": phase,
        "lunation_percent": round(lunation * 100, 1),
        "gardening_tip": tip
    }


@app.get("/")
def read_root():
    """Endpoint de teste de saúde do servidor"""
    moon = calculate_moon_phase()
    return {
        "status": "API Minhas Plantas rodando com sucesso! 🌿",
        "moon_info": moon,
        "gemini_configured": bool(GEMINI_API_KEY)
    }


@app.post("/api/auto-fill-plant")
async def auto_fill_plant(plant_name: str = Form(...)):
    """
    Recebe o nome da planta e retorna dados estruturados (dicas de cuidado, rega e alerta para pets)
    """
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Chave GEMINI_API_KEY não configurada no servidor.")

    prompt = f"""
    Você é um botânico especialista. Forneça dados de cultivo sobre a planta '{plant_name}'.
    Responda EXCLUSIVAMENTE em formato JSON VÁLIDO sem marcações markdown extra ou texto explicativo:
    {{
        "scientific_name": "Nome científico exato",
        "water_days": 5,
        "soil": "Recomendação de solo e drenagem",
        "fertilizer": "Recomendação de frequência e tipo de adubação",
        "light": "Necessidade de iluminação (Ex: Luz indireta, Sol pleno)",
        "pet_toxic": true,
        "pet_warning": "Explicação breve se é tóxica para cães e gatos e quais os sintomas/cuidados"
    }}
    """

    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(prompt)
        
        # Limpa formatação Markdown se o modelo retornar com ```json ... ```
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "")
        data = json.loads(cleaned_response)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar informação da planta: {str(e)}")


@app.post("/api/diagnose-plant")
async def diagnose_plant(
    file: UploadFile = File(...),
    city: str = Form("São José dos Pinhais"),
    season: str = Form("Atual")
):
    """
    Analisa a foto da folha/planta enviada, cruza com dados de Clima, Estação do Ano e Fase da Lua.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Chave GEMINI_API_KEY não configurada no servidor.")

    moon_info = calculate_moon_phase()
    image_bytes = await file.read()

    prompt = f"""
    Você é um agrônomo especialista em fitossanidade e cultivo doméstico.
    Analise a saúde visual da planta contida nesta imagem.

    CONTEXTO ATUAL DE CULTIVO DO USUÁRIO:
    - Região/Cidade: {city}
    - Estação / Clima Atual: {season}
    - Fase Astronômica da Lua: {moon_info['phase']} (Seiva: {moon_info['gardening_tip']})

    Gere um relatório objetivo e acolhedor cobrindo:
    1. **Aparência & Saúde Geral**: O que você observa nas folhas/caule?
    2. **Diagnóstico**: Há sinais de deficiência nutricional, amarelamento por excesso/falta de água ou infestação de pragas (cochonilha, ácaros, fungos)?
    3. **Plano de Ação Imediato**: O que o usuário deve fazer nos próximos dias para tratar ou manter a planta saudável?
    4. **Orientação Lunar & Sazonal**: Com base na fase da lua ({moon_info['phase']}) e no clima de {city}, é seguro podar ou adubar esta planta hoje? Justifique.
    """

    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content([
            prompt,
            {"mime_type": file.content_type, "data": image_bytes}
        ])

        return {
            "diagnosis": response.text,
            "moon_phase": moon_info['phase'],
            "moon_tip": moon_info['gardening_tip']
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao analisar imagem com IA: {str(e)}")
