import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

GEMINI_MODEL = "gemini-1.5-flash"
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "qwen3:8b"
CHROMA_PATH = "/tmp/chroma_db" if os.getenv("VERCEL") else "./chroma_db"
DOCS_PATH = "./docs"
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
