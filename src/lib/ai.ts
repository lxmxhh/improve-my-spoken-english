import OpenAI from "openai";

export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  defaultHeaders: {
    "HTTP-Referer": "https://english-speaking-practice.vercel.app",
    "X-Title": "English Speaking Practice",
  },
});

export const MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o";
