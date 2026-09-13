import { afterEach, describe, expect, it, vi } from "vitest";

const saved = process.env.AI_ENABLE_THINKING;

async function loadAi(enableThinking?: string) {
  if (enableThinking === undefined) delete process.env.AI_ENABLE_THINKING;
  else process.env.AI_ENABLE_THINKING = enableThinking;
  vi.resetModules();
  return import("@/lib/ai");
}

afterEach(() => {
  if (saved === undefined) delete process.env.AI_ENABLE_THINKING;
  else process.env.AI_ENABLE_THINKING = saved;
});

describe("withChatDefaults", () => {
  it("disables Qwen thinking mode by default and keeps the caller's params", async () => {
    const { withChatDefaults } = await loadAi();
    const params = withChatDefaults({
      model: "qwen3.8-flash",
      max_tokens: 20,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(params).toMatchObject({
      model: "qwen3.8-flash",
      max_tokens: 20,
      enable_thinking: false,
    });
  });

  it("leaves thinking on when AI_ENABLE_THINKING=1", async () => {
    const { withChatDefaults } = await loadAi("1");
    const params = withChatDefaults({ model: "m", messages: [] });
    expect(params).not.toHaveProperty("enable_thinking");
  });
});
