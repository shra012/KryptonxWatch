// Minimal OpenAI-compatible chat client. Works with OpenRouter and with local servers
// on the GB10 (vLLM, SGLang, llama.cpp server, Ollama) by changing baseUrl only.
// No runtime imports, so scripts/vlm-benchmark.ts can use it under plain Node.

export interface VlmConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Extra request fields, e.g. OpenRouter's {"reasoning":{"enabled":false}}. */
  extraBody?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ChatResult { text: string; latencyMs: number; promptTokens?: number; completionTokens?: number; cost?: number }

export class VlmError extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

const isOpenRouter = (url: string) => /openrouter\.ai/.test(url);

export function defaultExtraBody(baseUrl: string): Record<string, unknown> {
  // Disable hidden reasoning (slow, costly, not needed for per-window labels) and return cost.
  return isOpenRouter(baseUrl) ? { reasoning: { enabled: false }, usage: { include: true } } : {};
}

export async function chat(config: VlmConfig, messages: unknown[], options: { maxTokens?: number; temperature?: number; retries?: number; signal?: AbortSignal } = {}): Promise<ChatResult> {
  const { maxTokens = 500, temperature = 0, retries = 3 } = options;
  const body = { model: config.model, messages, max_tokens: maxTokens, temperature, ...(config.extraBody ?? defaultExtraBody(config.baseUrl)) };
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const timeout = AbortSignal.timeout(config.timeoutMs ?? 90_000);
    try {
      const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          ...(isOpenRouter(config.baseUrl) ? { "HTTP-Referer": "https://github.com/shra012/KryptonxWatch", "X-Title": "Sentinel Machines" } : {}),
        },
        body: JSON.stringify(body),
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.error) {
        const message = payload.error?.message ?? `HTTP ${res.status}`;
        const status = payload.error?.code ?? res.status;
        // Retry rate limits and upstream provider errors; fail fast on bad requests.
        if ((status === 429 || status >= 500 || status === 408) && attempt < retries) {
          lastError = new VlmError(message, status);
          await new Promise(r => setTimeout(r, 1500 * 2 ** attempt));
          continue;
        }
        throw new VlmError(message, status);
      }
      const text = payload.choices?.[0]?.message?.content ?? "";
      if (!text && attempt < retries) { lastError = new VlmError("Empty model reply"); continue; }
      return {
        text,
        latencyMs: Date.now() - started,
        promptTokens: payload.usage?.prompt_tokens,
        completionTokens: payload.usage?.completion_tokens,
        cost: payload.usage?.cost,
      };
    } catch (e) {
      if (options.signal?.aborted) throw e;
      if (e instanceof VlmError && !(e.status === 429 || (e.status ?? 0) >= 500)) throw e;
      lastError = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new VlmError(String(lastError));
}
