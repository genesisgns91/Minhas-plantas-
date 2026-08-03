import os
import json
import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import google.generativeai as genai
import ephem

app = FastAPI(
    title="Minhas Plantas - API",
    version="1.0.0"
)

# CORS liberado para o Cloudflare/GitHub Pages
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


def calculate_moon_phase():
    now = ephem.Date(datetime.datetime.now(datetime.timezone.utc))
    next_new = ephem.next_new_moon(now)
    prev_new = ephem.previous_new_moon(now)
    lunation = (now - prev_new) / (next_new - prev_new)
    
    if lunation < 0.03 or lunation > 0.97:
        phase = "Nova"
        tip = "Seiva concentrada nas raízes. Fase ideal para adubação profunda."
    elif lunation < 0.22:
        phase = "Crescente Inicial"
        tip = "Seiva subindo para os ramos. Boa época para regas."
    elif lunation < 0.28:
        phase = "Quarto Crescente"
        tip = "Ótimo momento para plantio e fortalecimento foliar."
    elif lunation < 0.47:
        phase = "Crescente Gibosa"
        tip = "Desenvolvimento acelerado das folhas."
    elif lunation < 0.53:
        phase = "Cheia"
        tip = "Seiva no topo. Evite podas drásticas hoje!"
    elif lunation < 0.72:
        phase = "Minguante Gibosa"
        tip = "Bom período para limpeza de folhas secas."
    elif lunation < 0.78:
        phase = "Quarto Minguante"
        tip = "Momento ideal para poda e controle de pragas."
    else:
        phase = "Minguante Final"
        tip = "Repouso vegetativo. Bom momento para preparar o solo."

    return {
        "phase": phase,
        "lunation_percent": round(lunation * 100, 1),
        "gardening_tip": tip
    }


@app.get("/")
def read_root():
    moon = calculate_moon_phase()
    return {
        "status": "API Minhas Plantas rodando com sucesso! 🌿",
        "moon_info": moon,
        "gemini_configured": bool(GEMINI_API_KEY)
    }


# Rotas para preenchimento de IA (aceita com ou sem /api)
@app.post("/auto-fill-plant")
@app.post("/api/auto-fill-plant")
async def auto_fill_plant(plant_name: str = Form(...)):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Chave GEMINI_API_KEY não configurada no Render.")

    prompt = f"""
    Você é um botânico especialista. Forneça dados de cultivo sobre a planta '{plant_name}'.
    Responda EXCLUSIVAMENTE em formato JSON VÁLIDO:
    {{
        "scientific_name": "Nome científico exato",
        "water_days": 5,
        "soil": "Recomendação de solo e drenagem",
        "fertilizer": "Recomendação de adubação",
        "light": "Necessidade de iluminação",
        "pet_toxic": true,
        "pet_warning": "Explicação breve se é tóxica para pets"
    }}
    """

    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(prompt)
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "")
        return json.loads(cleaned_response)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro no Gemini: {str(e)}")


# Rotas para Diagnóstico por Foto
@app.post("/diagnose-plant")
@app.post("/api/diagnose-plant")
async def diagnose_plant(
    file: UploadFile = File(...),
    city: str = Form("São José dos Pinhais"),
    season: str = Form("Atual")
):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Chave GEMINI_API_KEY não configurada no Render.")

    moon_info = calculate_moon_phase()
    image_bytes = await file.read()

    prompt = f"""
    Analise a saúde visual da planta nesta imagem.
    Contexto: Cidade {city}, Clima {season}, Lua {moon_info['phase']}.

    Responda com:
    1. Aparência & Saúde Geral
    2. Diagnóstico de problemas/pragas
    3. Plano de Ação Imediato
    4. Dica Lunar ({moon_info['phase']})
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
        raise HTTPException(status_code=500, detail=f"Erro na análise: {str(e)}")
