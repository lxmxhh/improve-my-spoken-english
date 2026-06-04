import OpenAI from "openai";

export const AI_BASE_URL =
  process.env.AI_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";

export const AI_MODEL = process.env.AI_MODEL ?? "qwen-plus";

export const AI_API_KEY =
  process.env.AI_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? "";

export const hasAiApiKey = AI_API_KEY.trim().length > 0;

export function getAiClient(): OpenAI {
  if (!hasAiApiKey) {
    throw new Error("AI_API_KEY is not configured");
  }

  return new OpenAI({
    baseURL: AI_BASE_URL,
    apiKey: AI_API_KEY,
  });
}
