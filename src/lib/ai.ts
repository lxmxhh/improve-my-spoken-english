import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export const AI_BASE_URL =
  process.env.AI_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";

export const AI_MODEL = process.env.AI_MODEL ?? "qwen-plus";

export const AI_API_KEY =
  process.env.AI_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? "";

export const hasAiApiKey = AI_API_KEY.trim().length > 0;

// Qwen3 models (DashScope / Token Plan) enable thinking mode by default, which
// doubles latency on every call. Opt back in with AI_ENABLE_THINKING=1.
const AI_ENABLE_THINKING = process.env.AI_ENABLE_THINKING === "1";

export function withChatDefaults<T extends ChatCompletionCreateParamsNonStreaming>(params: T): T {
  if (AI_ENABLE_THINKING) return params;
  return { ...params, enable_thinking: false } as T;
}

export function getAiClient(): OpenAI {
  if (!hasAiApiKey) {
    throw new Error("AI_API_KEY is not configured");
  }

  return new OpenAI({
    baseURL: AI_BASE_URL,
    apiKey: AI_API_KEY,
  });
}
