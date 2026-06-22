import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

GEMINI_MODEL = "openrouter/gemini-3.5-flash"
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "qwen3:8b"
CHROMA_PATH = "./chroma_db"
DOCS_PATH = "./docs"
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
