/**
 * Shared GPT/LLM client for all hook modules.
 *
 * Single source of truth for:
 * - API URLs and provider selection
 * - Request construction and response parsing
 * - Retry with backoff on 429
 * - Timeout handling
 * - Codex (subscription) → Chat Completions fallback
 */

// ─── Constants ─────────────────────────────────────────────

export const CODEX_API_URL = 'https://chatgpt.com/backend-api/codex/responses';
export const CHAT_COMPLETIONS_API_URL = 'https://api.openai.com/v1/chat/completions';

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_DELAY_BASE_MS = 2_000;

// ─── Types ─────────────────────────────────────────────────

export interface LlmCallOptions {
  prompt: string;
  system?: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs?: number;
  /** If true, retry once on 429 with backoff. Default: false */
  retryOn429?: boolean;
}

export interface LlmCredentials {
  accessToken?: string;
  apiKey?: string;
}

// ─── Credential Helper ────────────────────────────────────

/** Read credentials from environment. Call once at init, not per-request. */
export function getLlmCredentials(): LlmCredentials {
  return {
    accessToken: process.env.CROSSMODEL_OPENAI_ACCESS_TOKEN,
    apiKey: process.env.CROSSMODEL_OPENAI_API_KEY,
  };
}

export function hasLlmCredentials(creds: LlmCredentials): boolean {
  return !!(creds.accessToken || creds.apiKey);
}

// ─── Core API Call ────────────────────────────────────────

async function callCodex(
  url: string,
  prompt: string,
  system: string,
  token: string,
  model: string,
  effort: string,
  timeoutMs: number,
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      instructions: system,
      input: [{ role: 'user', content: prompt }],
      reasoning: { effort },
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 429) {
    throw new RetryableError('Codex API 429 rate limited');
  }
  if (!response.ok) {
    throw new Error(`Codex API ${response.status}`);
  }

  const data = (await response.json()) as any;
  if (data.output) {
    for (const item of data.output) {
      if (item.type === 'message' && item.content) {
        for (const block of item.content) {
          if (block.type === 'output_text') return block.text;
        }
      }
    }
  }
  throw new Error('No text in Codex response');
}

async function callChatCompletions(
  url: string,
  prompt: string,
  system: string,
  token: string,
  model: string,
  effort: string,
  timeoutMs: number,
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      reasoning_effort: effort,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 429) {
    throw new RetryableError('Chat Completions API 429 rate limited');
  }
  if (!response.ok) {
    throw new Error(`Chat Completions API ${response.status}`);
  }

  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('No text in Chat Completions response');
  }
  return content;
}

// ─── Retryable Error ──────────────────────────────────────

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

// ─── Main Entry Point ─────────────────────────────────────

/**
 * Call an LLM with automatic provider fallback and optional retry.
 *
 * Flow: Codex (subscription, free) → Chat Completions (API key) → throw
 * On 429 with retryOn429=true: wait and retry once before falling through.
 */
export async function callLlm(
  creds: LlmCredentials,
  options: LlmCallOptions,
): Promise<string> {
  const {
    prompt,
    system = '你是一个简洁的助手。',
    model = 'gpt-5.4-mini',
    reasoningEffort = 'medium',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryOn429 = false,
  } = options;

  const providers: Array<{
    name: string;
    fn: () => Promise<string>;
  }> = [];

  if (creds.accessToken) {
    providers.push({
      name: 'codex',
      fn: () => callCodex(CODEX_API_URL, prompt, system, creds.accessToken!, model, reasoningEffort, timeoutMs),
    });
  }

  if (creds.apiKey) {
    providers.push({
      name: 'chat-completions',
      fn: () => callChatCompletions(CHAT_COMPLETIONS_API_URL, prompt, system, creds.apiKey!, model, reasoningEffort, timeoutMs),
    });
  }

  if (providers.length === 0) {
    throw new Error('No LLM credentials available');
  }

  let lastError: Error | undefined;

  for (const provider of providers) {
    try {
      return await provider.fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Retry once on 429 if requested
      if (retryOn429 && err instanceof RetryableError) {
        await sleep(RETRY_DELAY_BASE_MS + Math.random() * 1000);
        try {
          return await provider.fn();
        } catch (retryErr) {
          lastError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
          // Fall through to next provider
        }
      }
      // Non-429 errors or retry exhausted: try next provider
    }
  }

  throw lastError || new Error('All LLM providers failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
