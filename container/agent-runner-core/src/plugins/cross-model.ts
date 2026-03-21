/**
 * CrossModelPlugin — ask_model tool for cross-model collaboration.
 *
 * Enables any runner (Claude or OpenAI) to delegate tasks to another LLM provider.
 * Supports two modes:
 * 1. Codex Responses API (ChatGPT subscription, free) — preferred
 * 2. Chat Completions API (API key, paid) — fallback
 *
 * Environment variables:
 * - CROSSMODEL_OPENAI_ACCESS_TOKEN: OAuth access token for Codex (subscription mode)
 * - CROSSMODEL_OPENAI_API_KEY: OpenAI API key (paid API mode, fallback)
 * - CROSSMODEL_OPENAI_BASE_URL: Optional custom base URL for Chat Completions
 * - CROSSMODEL_OPENAI_MODEL: Model to use (default: gpt-5.4-mini)
 */

import type { ContextPlugin, PluginContext, ToolDefinition, ToolResult } from '../plugin.js';

export interface CrossModelPluginOptions {
  /** OAuth access token for Codex Responses API (ChatGPT subscription). */
  openaiAccessToken?: string;
  /** OpenAI API key for Chat Completions (paid fallback). */
  openaiApiKey?: string;
  /** Optional base URL override for Chat Completions. */
  openaiBaseUrl?: string;
  /** Model to use for cross-model calls. Default: gpt-5.4-mini */
  openaiModel?: string;
  /** Max tokens for response. Default: 4096 */
  maxTokens?: number;
}

const CODEX_API_URL = 'https://chatgpt.com/backend-api/codex/responses';

export class CrossModelPlugin implements ContextPlugin {
  readonly name = 'cross-model';
  private opts: CrossModelPluginOptions;

  constructor(opts: CrossModelPluginOptions = {}) {
    this.opts = opts;
  }

  isEnabled(): boolean {
    const hasOAuth = !!(this.opts.openaiAccessToken || process.env.CROSSMODEL_OPENAI_ACCESS_TOKEN);
    const hasApiKey = !!(this.opts.openaiApiKey || process.env.CROSSMODEL_OPENAI_API_KEY);
    return hasOAuth || hasApiKey;
  }

  getTools(_ctx: PluginContext): ToolDefinition[] {
    const hasOAuth = !!(this.opts.openaiAccessToken || process.env.CROSSMODEL_OPENAI_ACCESS_TOKEN);
    const modeHint = hasOAuth ? '（使用 ChatGPT 订阅额度，无额外费用）' : '（使用 API Key，按 token 计费）';

    return [
      {
        name: 'ask_model',
        description:
          '向另一个 LLM 模型发送请求并获取回复。' + modeHint +
          '用于：方案评审（让另一个模型审查你的方案）、获取第二意见、翻译、总结等。' +
          '当前支持 OpenAI 模型。返回模型的文本回复。',
        parameters: {
          type: 'object' as const,
          properties: {
            prompt: {
              type: 'string',
              description: '发送给模型的完整 prompt（包含你需要评审/处理的内容）',
            },
            system: {
              type: 'string',
              description: '可选的 system prompt，用于设定模型的角色和行为',
            },
            provider: {
              type: 'string',
              enum: ['openai'],
              description: '目标模型提供商（当前支持 openai）',
            },
            model: {
              type: 'string',
              description:
                '可选：指定具体模型。Codex 订阅支持: gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, codex-mini-latest。' +
                'API Key 额外支持: gpt-5.4-nano, o3。不指定则使用默认模型 gpt-5.4-mini。',
            },
          },
          required: ['prompt'],
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.executeAskModel(args);
        },
      },
    ];
  }

  getSystemPromptSection(): string {
    const hasOAuth = !!(this.opts.openaiAccessToken || process.env.CROSSMODEL_OPENAI_ACCESS_TOKEN);
    const costNote = hasOAuth
      ? '当前使用 ChatGPT 订阅模式，调用不产生额外费用（但受 5 小时窗口限制）。'
      : '当前使用 API Key 模式，调用按 token 计费。';

    return (
      '## 跨模型协同\n\n' +
      '你可以使用 `ask_model` 工具向其他 LLM 模型发送请求。典型用途：\n' +
      '- **方案评审**：完成方案后，让另一个模型审查，获取不同视角的反馈\n' +
      '- **第二意见**：对不确定的问题，咨询另一个模型\n' +
      '- **专长委托**：将特定类型的任务委托给更擅长的模型\n\n' +
      costNote + '\n\n' +
      '使用时，将完整上下文包含在 prompt 中，因为目标模型没有当前对话的历史。'
    );
  }

  // ─── Internal ─────────────────────────────────────────────

  private async executeAskModel(args: Record<string, unknown>): Promise<ToolResult> {
    const prompt = String(args.prompt || '');
    const system = args.system ? String(args.system) : undefined;
    const model = args.model
      ? String(args.model)
      : (this.opts.openaiModel || process.env.CROSSMODEL_OPENAI_MODEL || 'gpt-5.4-mini');

    if (!prompt.trim()) {
      return { content: 'Error: prompt is required', isError: true };
    }

    // Prefer Codex (subscription, free) over Chat Completions (API key, paid)
    const accessToken = this.opts.openaiAccessToken || process.env.CROSSMODEL_OPENAI_ACCESS_TOKEN;
    if (accessToken) {
      return this.callCodexApi(accessToken, model, prompt, system);
    }

    const apiKey = this.opts.openaiApiKey || process.env.CROSSMODEL_OPENAI_API_KEY;
    if (apiKey) {
      return this.callChatCompletionsApi(apiKey, model, prompt, system);
    }

    return { content: 'Error: 未配置 OpenAI 认证（需要 OAuth token 或 API Key）', isError: true };
  }

  /**
   * Call Codex Responses API (ChatGPT subscription, no extra cost).
   * Uses SSE streaming, collects full response text.
   */
  private async callCodexApi(
    accessToken: string,
    model: string,
    prompt: string,
    system?: string,
  ): Promise<ToolResult> {
    try {
      const response = await fetch(CODEX_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          model,
          instructions: system || '',
          input: prompt,
          tools: [],
          stream: true,
          store: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        // If Codex fails (token expired, rate limited), hint about fallback
        return {
          content: `Error from Codex API (${response.status}): ${errorText.slice(0, 500)}`,
          isError: true,
        };
      }

      if (!response.body) {
        return { content: 'Error: Codex API returned no response body', isError: true };
      }

      // Parse SSE stream to collect text output
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let resultText = '';
      let usageInfo = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr.trim()) continue;

          try {
            const event = JSON.parse(jsonStr);

            // Collect text from output_text.delta events
            if (event.type === 'response.output_text.delta' && event.delta) {
              resultText += event.delta;
            }

            // Collect usage from response.completed
            if (event.type === 'response.completed' && event.response?.usage) {
              const u = event.response.usage;
              usageInfo = `\n\n---\n_Token usage: ${u.input_tokens || 0} input + ${u.output_tokens || 0} output = ${u.total_tokens || 0} total (Codex 订阅)_`;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      if (!resultText) {
        return { content: `**[${model}]** via Codex: (empty response)` };
      }

      return { content: `**[${model}]** via Codex 的回复：\n\n${resultText}${usageInfo}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error calling Codex API: ${msg}`, isError: true };
    }
  }

  /**
   * Call Chat Completions API (API key, paid per token).
   */
  private async callChatCompletionsApi(
    apiKey: string,
    model: string,
    prompt: string,
    system?: string,
  ): Promise<ToolResult> {
    const baseUrl = this.opts.openaiBaseUrl || process.env.CROSSMODEL_OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const maxTokens = this.opts.maxTokens || 4096;

    try {
      const messages: Array<{ role: string; content: string }> = [];
      if (system) {
        messages.push({ role: 'system', content: system });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_completion_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: `Error from OpenAI API (${response.status}): ${errorText.slice(0, 500)}`,
          isError: true,
        };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const reply = data.choices?.[0]?.message?.content || '(empty response)';
      const usage = data.usage;

      let result = `**[${model}]** via API 的回复：\n\n${reply}`;
      if (usage) {
        result += `\n\n---\n_Token usage: ${usage.prompt_tokens} input + ${usage.completion_tokens} output = ${usage.total_tokens} total (API 计费)_`;
      }

      return { content: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error calling OpenAI API: ${msg}`, isError: true };
    }
  }
}
