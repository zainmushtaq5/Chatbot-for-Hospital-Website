import dotenv from "dotenv";
import fs from "fs";
if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}
dotenv.config();

export const config = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
  GEMINI_MODEL: "meta-llama/llama-4-scout:free",
  OLLAMA_URL: "http://localhost:11434/api/generate",
  OLLAMA_MODEL: "phi4-mini",
  DOCS_PATH: "./docs",
  CHROMA_PATH: "./chroma_db",
  EMBEDDING_MODEL: "Supabase/bge-small-en",
};
