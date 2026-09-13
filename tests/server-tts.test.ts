import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "TTS_PROVIDER",
  "TTS_CACHE_DIR",
  "QWEN_TTS_API",
  "QWEN_TTS_BASE_URL",
  "QWEN_TTS_MODEL",
  "QWEN_TTS_VOICE",
  "QWEN_TTS_FORMAT",
  "QWEN_TTS_API_KEY",
  "DASHSCOPE_API_KEY",
  "AI_API_KEY",
];

let cacheDir: string;
const savedEnv: Record<string, string | undefined> = {};

async function loadServerTts(env: Record<string, string>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env, { TTS_CACHE_DIR: cacheDir });
  vi.resetModules();
  return import("@/lib/server-tts");
}

function mockQwenFetch(audioBytes: number[]) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void init;
    const url = String(input);
    if (url.startsWith("https://download.example/")) {
      return new Response(Buffer.from(audioBytes), { status: 200 });
    }
    return Response.json({
      output: { audio: { url: "https://download.example/audio.bin" } },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  cacheDir = await mkdtemp(join(tmpdir(), "tts-cache-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(cacheDir, { recursive: true, force: true });
});

describe("qwen speech-synthesizer API (Token Plan)", () => {
  const env = {
    TTS_PROVIDER: "qwen",
    QWEN_TTS_API: "speech-synthesizer",
    QWEN_TTS_BASE_URL: "https://token-plan.example/api/v1",
    QWEN_TTS_MODEL: "qwen-audio-3.0-tts-plus",
    QWEN_TTS_VOICE: "longanhuan_v3.6",
    QWEN_TTS_FORMAT: "mp3",
    QWEN_TTS_API_KEY: "tp-key",
  };

  it("posts to the SpeechSynthesizer endpoint with voice and format", async () => {
    const fetchMock = mockQwenFetch([1, 2, 3]);
    const { generateCachedSpeech } = await loadServerTts(env);

    const result = await generateCachedSpeech("Hello there.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://token-plan.example/api/v1/services/audio/tts/SpeechSynthesizer");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tp-key");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "qwen-audio-3.0-tts-plus",
      input: { text: "Hello there.", voice: "longanhuan_v3.6", format: "mp3" },
    });
    expect(result.contentType).toBe("audio/mpeg");
    expect([...result.audio]).toEqual([1, 2, 3]);
  });

  it("caches as .mp3 and serves the cache on the next call", async () => {
    const fetchMock = mockQwenFetch([9, 9]);
    const { generateCachedSpeech } = await loadServerTts(env);

    await generateCachedSpeech("Cache me.");
    const files = await readdir(cacheDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.mp3$/);

    fetchMock.mockClear();
    const again = await generateCachedSpeech("Cache me.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(again.contentType).toBe("audio/mpeg");
    expect([...again.audio]).toEqual([9, 9]);
  });
});

describe("qwen multimodal API (legacy DashScope)", () => {
  it("keeps the old endpoint, language_type body and wav cache by default", async () => {
    const fetchMock = mockQwenFetch([7]);
    const { generateCachedSpeech } = await loadServerTts({
      TTS_PROVIDER: "qwen",
      QWEN_TTS_API_KEY: "ds-key",
    });

    const result = await generateCachedSpeech("Legacy path.");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    );
    expect(JSON.parse(String(init.body))).toEqual({
      model: "qwen3-tts-flash",
      input: { text: "Legacy path.", voice: "Ethan", language_type: "English" },
    });
    expect(result.contentType).toBe("audio/wav");
    const files = await readdir(cacheDir);
    expect(files[0]).toMatch(/\.wav$/);
  });

  it("uses a different cache entry when the output format changes", async () => {
    mockQwenFetch([1]);
    const legacy = await loadServerTts({ TTS_PROVIDER: "qwen", QWEN_TTS_API_KEY: "k" });
    await legacy.generateCachedSpeech("Same text.");

    mockQwenFetch([2]);
    const mp3 = await loadServerTts({
      TTS_PROVIDER: "qwen",
      QWEN_TTS_API_KEY: "k",
      QWEN_TTS_FORMAT: "mp3",
    });
    const result = await mp3.generateCachedSpeech("Same text.");

    expect([...result.audio]).toEqual([2]);
    expect((await readdir(cacheDir)).sort()).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.wav$/), expect.stringMatching(/\.mp3$/)])
    );
  });
});
