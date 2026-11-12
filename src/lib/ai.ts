import type { AiMessage, Settings } from "@/types";

function toApiMessages(messages: AiMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export interface ChatOptions {
  settings: Settings;
  messages: AiMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
}

export interface OllamaDetection {
  ok: boolean;
  baseUrl: string;
  models: string[];
  latencyMs: number;
  message: string;
}

export async function chat({
  settings,
  messages,
  signal,
  onDelta,
  jsonMode,
  jsonSchema,
}: ChatOptions): Promise<string> {
  if (settings.aiProvider === "openai") {
    return chatOpenAI({ settings, messages, signal, onDelta });
  }
  if (settings.aiProvider === "anthropic") {
    return chatAnthropic({ settings, messages, signal, onDelta });
  }
  if (settings.aiProvider === "ollama") {
    return chatOllama({
      settings,
      messages,
      signal,
      onDelta,
      jsonMode,
      jsonSchema,
    });
  }
  throw new Error("AI 未启用，请在设置中配置 Provider 或启动本地 Ollama。");
}

async function chatOpenAI({
  settings,
  messages,
  signal,
  onDelta,
}: ChatOptions): Promise<string> {
  if (!settings.aiApiKey) throw new Error("缺少 OpenAI API Key");
  const base = (settings.aiBaseUrl || "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.aiApiKey}`,
    },
    body: JSON.stringify({
      model: settings.aiModel || "gpt-4o-mini",
      messages: toApiMessages(messages),
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }
  return await readSse(res.body, (evt) => {
    try {
      const j = JSON.parse(evt);
      const delta = j.choices?.[0]?.delta?.content ?? "";
      if (delta) onDelta?.(delta);
      return delta;
    } catch {
      return "";
    }
  });
}

async function chatAnthropic({
  settings,
  messages,
  signal,
  onDelta,
}: ChatOptions): Promise<string> {
  if (!settings.aiApiKey) throw new Error("缺少 Anthropic API Key");
  const sys = messages.find((m) => m.role === "system")?.content ?? "";
  const rest = messages.filter((m) => m.role !== "system");
  const base = (settings.aiBaseUrl || "https://api.anthropic.com").replace(
    /\/+$/,
    "",
  );
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.aiApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.aiModel || "claude-3-5-sonnet-latest",
      max_tokens: 1024,
      system: sys || undefined,
      messages: toApiMessages(rest),
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  return await readSse(res.body, (evt) => {
    try {
      const j = JSON.parse(evt);
      if (j.type === "content_block_delta") {
        const delta = j.delta?.text ?? "";
        if (delta) onDelta?.(delta);
        return delta;
      }
    } catch {}
    return "";
  });
}

async function chatOllama({
  settings,
  messages,
  signal,
  onDelta,
  jsonMode,
  jsonSchema,
}: ChatOptions): Promise<string> {
  const base = normalizeOllamaBase(settings.aiBaseUrl);
  const model = settings.aiModel || (await detectOllama()).models[0];
  if (!model) {
    throw new Error("Ollama 已连接，但没有可用的对话模型");
  }
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    signal,
    // text/plain keeps this a simple request, so Chrome skips CORS preflight.
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({
      model,
      messages: toApiMessages(messages),
      stream: true,
      think: false,
      format: jsonMode ? (jsonSchema ?? "json") : undefined,
      keep_alive: "10m",
      options: {
        temperature: jsonMode ? 0.1 : 0.2,
        num_ctx: 8192,
        num_predict: jsonMode ? 3072 : 2048,
      },
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Ollama ${res.status}: ${text.slice(0, 200) || "请确认服务已启动且模型可用"}`,
    );
  }
  return await readNdjson(res.body, (evt) => {
    try {
      const j = JSON.parse(evt);
      const delta = j.message?.content ?? j.response ?? "";
      if (delta) onDelta?.(delta);
      return delta;
    } catch {
      return "";
    }
  });
}

export async function detectOllama(): Promise<OllamaDetection> {
  const start = performance.now();
  let message = "";
  for (const baseUrl of [
    "http://127.0.0.1:11434",
    "http://localhost:11434",
  ]) {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/api/tags`, 2500);
      if (!res.ok) {
        message = `HTTP ${res.status}`;
        continue;
      }
      const body = (await res.json()) as {
        models?: Array<{ name?: string; model?: string; capabilities?: string[] }>;
      };
      const models = (body.models ?? [])
        .filter((model) => {
          const name = model.name ?? model.model ?? "";
          const caps = model.capabilities ?? [];
          return (
            !!name &&
            !/embed|bge|ocr/i.test(name) &&
            (!caps.length || caps.includes("completion"))
          );
        })
        .sort((a, b) => ollamaModelScore(a.name ?? "") - ollamaModelScore(b.name ?? ""))
        .map((model) => model.name ?? model.model ?? "")
        .filter(Boolean);
      return {
        ok: true,
        baseUrl,
        models,
        latencyMs: Math.round(performance.now() - start),
        message: models.length
          ? `已发现 ${models.length} 个对话模型`
          : "Ollama 已连接，但没有对话模型",
      };
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    ok: false,
    baseUrl: "http://127.0.0.1:11434",
    models: [],
    latencyMs: Math.round(performance.now() - start),
    message,
  };
}

export function normalizeOllamaBase(input: string): string {
  let base = input.trim() || "http://127.0.0.1:11434";
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base.replace(/\/+$/, "").replace(/\/(?:api|v1)$/i, "");
}

export async function unloadOllamaModel(
  settings: Settings,
): Promise<boolean> {
  if (settings.aiProvider !== "ollama" || !settings.aiModel) return false;
  const base = normalizeOllamaBase(settings.aiBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        model: settings.aiModel,
        prompt: "",
        stream: false,
        keep_alive: 0,
      }),
    });
    await res.text().catch(() => "");
    return res.ok;
  } catch (err) {
    console.warn("[smart-bookmark] Ollama unload failed", err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function testAi(settings: Settings): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
}> {
  const start = performance.now();
  try {
    if (settings.aiProvider === "openai") {
      if (!settings.aiApiKey) throw new Error("缺少 API Key");
      const base = (settings.aiBaseUrl || "https://api.openai.com/v1").replace(
        /\/+$/,
        "",
      );
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.aiApiKey}`,
        },
        body: JSON.stringify({
          model: settings.aiModel || "gpt-4o-mini",
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`);
      }
      const j = parseJsonBody(await res.text()) as {
        choices?: Array<{
          message?: { content?: string };
          text?: string;
        }>;
      };
      const txt =
        j.choices?.[0]?.message?.content ??
        j.choices?.[0]?.text ??
        "(空响应)";
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        message: String(txt).slice(0, 80),
      };
    }
    if (settings.aiProvider === "anthropic") {
      if (!settings.aiApiKey) throw new Error("缺少 API Key");
      const base = (settings.aiBaseUrl || "https://api.anthropic.com").replace(
        /\/+$/,
        "",
      );
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.aiApiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: settings.aiModel || "claude-3-5-sonnet-latest",
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`);
      }
      const j = parseJsonBody(await res.text()) as {
        content?: Array<{ text?: string }>;
      };
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        message: String(j.content?.[0]?.text ?? "(空响应)").slice(0, 80),
      };
    }
    if (settings.aiProvider === "ollama") {
      const found = await detectOllama();
      if (!found.ok) {
        throw new Error(
          `未连接到本地 Ollama（${found.baseUrl}）。请先运行 ollama serve。`,
        );
      }
      const model = found.models.includes(settings.aiModel)
        ? settings.aiModel
        : found.models[0];
      if (!model) throw new Error("Ollama 没有可用对话模型");
      const res = await fetch(`${found.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          messages: [{ role: "user", content: "只回复 pong" }],
          options: { num_predict: 8 },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`);
      }
      const j = parseJsonBody(await res.text()) as {
        message?: { content?: string };
        response?: string;
      };
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        message: String(
          j.message?.content ?? j.response ?? "(空响应)",
        ).slice(0, 80),
      };
    }
    throw new Error("请先选择 Provider");
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      message: err?.message ?? String(err),
    };
  }
}

function ollamaModelScore(name: string): number {
  if (/qwen3\.5:4b/i.test(name)) return 0;
  if (/qwen3:8b/i.test(name)) return 1;
  if (/qwen2\.5-coder/i.test(name)) return 2;
  if (/deepseek-r1/i.test(name)) return 3;
  if (/qwen3\.5/i.test(name)) return 4;
  if (/qwen3/i.test(name)) return 5;
  if (/qwen/i.test(name)) return 6;
  if (/llama|deepseek|mistral|gemma/i.test(name)) return 7;
  return 20;
}

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/** 测试连接/解析响应：避免把站点首页的 HTML 误当 JSON。 */
function parseJsonBody(raw: string): unknown {
  const text = raw.trim();
  if (!text) throw new Error("空响应体");
  if (text.startsWith("<") || text.toLowerCase().startsWith("<!doctype")) {
    throw new Error(
      "返回了 HTML 而非 API JSON。请确认 Base URL 是 API 根路径，不要填官网首页。",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `响应不是合法 JSON: ${text.slice(0, 100)}${text.length > 100 ? "…" : ""}`,
    );
  }
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (data: string) => string,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const match = line.match(/^data:\s*(.*)$/);
        if (!match) continue;
        const data = match[1];
        if (data === "[DONE]") return full;
        full += onEvent(data);
      }
    }
  }
  return full;
}

async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onEvent: (data: string) => string,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) full += onEvent(line);
    }
  }
  if (buf.trim()) full += onEvent(buf);
  return full;
}
