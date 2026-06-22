import axios from "axios";
import { config } from "./config.js";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "empty-key-to-init",
});

export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  context: string,
  history: any[] = [],
): Promise<string> {
  if (
    config.OPENROUTER_API_KEY &&
    config.OPENROUTER_API_KEY !== "your_key_here"
  ) {
    try {
      const messages = [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({
          role: m.role === "bot" ? "assistant" : "user",
          content: m.content,
        })),
        {
          role: "user",
          content: `Context:\n${context}\n\nUser: ${userMessage}`,
        },
      ];
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: config.GEMINI_MODEL,
          temperature: 0.3,
          max_tokens: 500,
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
            "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
            "Content-Type": "application/json",
          },
        },
      );
      return response.data.choices[0].message.content;
    } catch (e) {
      console.error("OpenRouter fail:", e);
      throw e;
    }
  } else {
    if (process.env.GEMINI_API_KEY) {
      if (
        process.env.GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE" ||
        process.env.GEMINI_API_KEY === "MY_GEMINI_API_KEY"
      ) {
        throw new Error(
          "GEMINI_API_KEY is using a placeholder. Please set your actual API key in .env.local",
        );
      }
      const contents = [
        ...history.map((m) => ({
          role: m.role === "bot" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        {
          role: "user",
          parts: [{ text: `Context:\n${context}\n\nUser: ${userMessage}` }],
        },
      ];
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contents as any,
        config: { systemInstruction: systemPrompt, temperature: 0.3 },
      });
      return response.text || "";
    } else {
      throw new Error("No API keys available structure configured.");
    }
  }
}

/**
 * callQwen — Ollama local LLM with optional streaming.
 * Pass onToken callback to receive tokens as they arrive.
 * Without onToken, falls back to non-streaming (blocking).
 */
export async function callQwen(
  systemPrompt: string,
  userMessage: string,
  context: string,
  history: any[] = [],
  onToken?: (token: string) => void,
): Promise<string> {
  // Trim history to last 6 exchanges to reduce prompt size → faster TTFT
  const recentHistory = history.slice(-6);
  const historyText = recentHistory
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const prompt = `${systemPrompt}\n\nHistory:\n${historyText}\n\nContext: ${context}\n\nUser: ${userMessage}\nAssistant:`;

  const body = {
    model: config.OLLAMA_MODEL,
    prompt,
    stream: !!onToken,
    options: {
      num_predict: 350, // max tokens to generate — keeps answers short & fast
      num_ctx: 2048, // smaller context window → faster first token
      temperature: 0.3,
    },
  };

  try {
    if (onToken) {
      // Streaming mode — responseType stream so axios gives us chunks
      const response = await axios.post(config.OLLAMA_URL, body, {
        responseType: "stream",
        timeout: 120_000,
      });

      let full = "";
      await new Promise<void>((resolve, reject) => {
        response.data.on("data", (chunk: Buffer) => {
          const lines = chunk.toString().split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.response) {
                full += json.response;
                onToken(json.response);
              }
              if (json.done) resolve();
            } catch {
              // partial JSON chunk — skip
            }
          }
        });
        response.data.on("end", resolve);
        response.data.on("error", reject);
      });

      return full;
    } else {
      // Non-streaming fallback (used by getLlmResponse)
      const response = await axios.post(
        config.OLLAMA_URL,
        { ...body, stream: false },
        {
          timeout: 120_000,
        },
      );
      return response.data.response;
    }
  } catch (error) {
    return "I'm sorry, I'm currently offline and unable to answer. Please call us at +92-21-3456-7890.";
  }
}

export async function getLlmResponse(
  systemPrompt: string,
  userMessage: string,
  context: string,
  history: any[] = [],
): Promise<{ response: string; source: string }> {
  try {
    const result = await callGemini(
      systemPrompt,
      userMessage,
      context,
      history,
    );
    return { response: result, source: "gemini" };
  } catch (e) {
    console.error("Gemini API Error:", e);
    const fallbackResponse = await callQwen(
      systemPrompt,
      userMessage,
      context,
      history,
    );
    return { response: fallbackResponse, source: "qwen" };
  }
}
