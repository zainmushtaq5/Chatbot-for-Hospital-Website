import requests
import config
from prompts import SYSTEM_PROMPT
import google.generativeai as genai

if config.GEMINI_API_KEY:
    genai.configure(api_key=config.GEMINI_API_KEY)

def call_gemini(system_prompt, user_message, context):
    model = genai.GenerativeModel(
        model_name=config.GEMINI_MODEL,
        system_instruction=system_prompt,
    )
    
    prompt = f"Context:\n{context}\n\nQuestion: {user_message}"
    
    generation_config = genai.types.GenerationConfig(
        temperature=0.3,
        max_output_tokens=500
    )
    
    response = model.generate_content(prompt, generation_config=generation_config)
    return response.text

def call_qwen(system_prompt, user_message, context):
    url = config.OLLAMA_URL
    prompt_str = f"System Instruction:\n{system_prompt}\n\nContext:\n{context}\n\nUser Question: {user_message}\n\nAnswer:"
    data = {
        "model": config.OLLAMA_MODEL,
        "prompt": prompt_str,
        "stream": False
    }
    try:
        response = requests.post(url, json=data, timeout=15)
        response.raise_for_status()
        res_json = response.json()
        return res_json.get("response", "")
    except Exception as e:
        print(f"Ollama call failed: {e}")
        return "I'm sorry, I'm currently offline and unable to answer. Please call us at +92-21-3456-7890."

def get_llm_response(user_message, context):
    try:
        print("Attempting to call Gemini via Google API...")
        return call_gemini(SYSTEM_PROMPT, user_message, context), "gemini"
    except Exception as e:
        print(f"Gemini call failed with error: {e}. Falling back to local Qwen (Ollama)...")
        return call_qwen(SYSTEM_PROMPT, user_message, context), "qwen"

if __name__ == "__main__":
    # Test llm.py when run directly
    test_context = "Al-Shifa General Hospital has 15 doctors. Dr. Ahmed Khan is a cardiologist."
    test_message = "Who is the cardiologist?"
    
    # We can run it if prompts.py exists, otherwise we mock SYSTEM_PROMPT here for direct execution
    try:
        res = get_llm_response(test_message, test_context)
        print("LLM Response:\n", res)
    except Exception as err:
        print("Could not complete test run:", err)
