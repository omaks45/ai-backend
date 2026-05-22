// src/modules/mcp/services/router.service.ts
//
// MODEL ROUTING + FALLBACK CHAINS
//
// ROUTING STRATEGY:
// Task type → default model. Simple and predictable.
//   chat    → gpt-4o-mini  (simple Q&A, cheap, fast)
//   summary → gpt-4o-mini  (straightforward task)
//   agent   → gpt-4o       (multi-step reasoning needs stronger model)
//
// For Ollama (dev), all tasks route to the configured local model since
// we only run one model locally.
//
// FALLBACK CHAINS:
// If gpt-4o fails → try gpt-4o-mini before returning an error.
// If gpt-4o-mini fails → try gpt-4o (already paid for reasoning, use it).
// The fallbackUsed flag propagates to the caller for metrics and audit.
//
// TIME COMPLEXITY:
//   routeModel       — O(1) map lookup
//   callWithFallback — O(k) where k = chain length (always 2)
//   calculateCost    — O(1)

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }      from '@nestjs/config';
import { ModelConfig, LlmCallResult, TaskType, McpMessage } from '../mcp.types';

// ─────────────────────────────────────────────────────────────────────────────
// Model registry — single source of truth for pricing and limits.
// Update this when OpenAI changes pricing — one place, not six.
// ─────────────────────────────────────────────────────────────────────────────

const MODELS: Readonly<Record<string, ModelConfig>> = {
  'gpt-4o': {
    name:                 'gpt-4o',
    provider:             'openai',
    costPerMillionInput:  2.50,
    costPerMillionOutput: 10.00,
    maxContextTokens:     128_000,
  },
  'gpt-4o-mini': {
    name:                 'gpt-4o-mini',
    provider:             'openai',
    costPerMillionInput:  0.15,
    costPerMillionOutput: 0.60,
    maxContextTokens:     128_000,
  },
  // Ollama placeholder — costPerMillion is 0 (local, free)
  'ollama-local': {
    name:                 'ollama-local',
    provider:             'ollama',
    costPerMillionInput:  0,
    costPerMillionOutput: 0,
    maxContextTokens:     8_192,
  },
} as const;

// Task → primary model name for OpenAI
const MODEL_ROUTING: Readonly<Record<TaskType, string>> = {
  chat:      'gpt-4o-mini',  // Simple Q&A — cheap model is sufficient
  summary:   'gpt-4o-mini',  // Summarisation is straightforward
  agent:     'gpt-4o',       // ReAct reasoning needs the stronger model
  embedding: 'gpt-4o-mini',  // Not used for completions but kept for completeness
} as const;

// Fallback chains — ordered list of models to try if primary fails
const FALLBACK_CHAINS: Readonly<Record<string, string[]>> = {
  'gpt-4o':      ['gpt-4o', 'gpt-4o-mini'],
  'gpt-4o-mini': ['gpt-4o-mini', 'gpt-4o'],
  'ollama-local': ['ollama-local'],             // No fallback for local dev
} as const;

// Per-call fetch timeouts
const FETCH_TIMEOUT_MS: Readonly<Record<'openai' | 'ollama', number>> = {
  openai: 60_000,   // 60s — cloud inference is fast
  ollama: 300_000,  // 300s — CPU inference can be slow
};

@Injectable()
export class RouterService {
    private readonly logger = new Logger(RouterService.name);
    private readonly openaiApiKey: string;
    private readonly ollamaBase:   string;
    private readonly provider:     'openai' | 'ollama';
    private readonly localModel:   string;

    constructor(private readonly config: ConfigService) {
        this.openaiApiKey = config.get<string>('OPENAI_API_KEY', '');
        this.ollamaBase   = config.get<string>('OLLAMA_API_BASE', 'http://localhost:11434');
        this.localModel   = config.get<string>('OLLAMA_CHAT_MODEL', 'llama3.2');

        const embeddingProvider = (
        config.get<string>('EMBEDDING_PROVIDER', '') ||
        (config.get<string>('NODE_ENV', 'development') === 'production' ? 'openai' : 'ollama')
        ).toLowerCase() as 'openai' | 'ollama';

        this.provider = embeddingProvider;

        this.logger.log('RouterService ready', {
        provider: this.provider,
        routing:  MODEL_ROUTING,
        });
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Select the model config for a given task type.
     * O(1) — two map lookups.
     */
    routeModel(taskType: TaskType): ModelConfig {
        if (this.provider === 'ollama') {
        // Local dev: all tasks use the single local model
        return { ...MODELS['ollama-local'], name: this.localModel };
        }
        const modelName = MODEL_ROUTING[taskType] ?? 'gpt-4o-mini';
        return MODELS[modelName] ?? MODELS['gpt-4o-mini'];
    }

    /**
     * Compute the cost of an LLM call from actual token usage.
     * Always uses the model that was actually called (post-fallback).
     * O(1).
     */
    calculateCost(
        modelName: string,
        usage: { prompt_tokens: number; completion_tokens: number },
    ): number {
        const model = MODELS[modelName] ?? MODELS['ollama-local'];
        return (
        (usage.prompt_tokens     / 1_000_000) * model.costPerMillionInput +
        (usage.completion_tokens / 1_000_000) * model.costPerMillionOutput
        );
    }

    /**
     * Call the LLM with fallback.
     * Tries the primary model first, then each fallback in order.
     * Returns on the first success. Throws only if ALL models fail.
     * O(k) where k = fallback chain length (always 1–2).
     */
    async callWithFallback(
        primaryModel: ModelConfig,
        request: {
        systemPrompt:  string;
        messages:      McpMessage[];
        tools?:        unknown[];
        temperature?:  number;
        maxTokens?:    number;
        correlationId: string;
        },
    ): Promise<LlmCallResult> {
        const chain = this.provider === 'ollama'
        ? [primaryModel.name]
        : (FALLBACK_CHAINS[primaryModel.name] ?? [primaryModel.name]);

        for (let i = 0; i < chain.length; i++) {
        const modelName  = chain[i];
        const isFallback = i > 0;

        try {
            const result = await this.callModel(modelName, request);

            if (isFallback) {
            this.logger.warn('Fallback model used', {
                correlationId: request.correlationId,
                primary:  primaryModel.name,
                fallback: modelName,
            });
            }

            return { ...result, fallbackUsed: isFallback };

        } catch (err) {
            const isLast = i === chain.length - 1;
            this.logger.error(`Model call failed`, {
            correlationId: request.correlationId,
            model:         modelName,
            error:         err instanceof Error ? err.message : String(err),
            isLastFallback: isLast,
            });

            if (isLast) throw err; // All models exhausted
            // Continue to next in chain
        }
        }

        // TypeScript safety — unreachable because the loop either returns or throws
        throw new Error('All models in fallback chain failed');
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private async callModel(
        modelName: string,
        request: {
        systemPrompt:  string;
        messages:      McpMessage[];
        tools?:        unknown[];
        temperature?:  number;
        maxTokens?:    number;
        correlationId: string;
        },
    ): Promise<Omit<LlmCallResult, 'fallbackUsed'>> {
        const isOllama = this.provider === 'ollama';
        const apiBase  = isOllama
        ? `${this.ollamaBase}/v1`
        : 'https://api.openai.com/v1';

        const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        };
        if (!isOllama) {
        if (!this.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured');
        headers['Authorization'] = `Bearer ${this.openaiApiKey}`;
        }

        // Build messages — always prepend the system prompt from the resolved template
        const fullMessages = [
        { role: 'system', content: request.systemPrompt },
        ...request.messages,
        ];

        const payload: Record<string, unknown> = {
        model:       isOllama ? this.localModel : modelName,
        messages:    fullMessages,
        temperature: request.temperature ?? 0.1,
        max_tokens:  request.maxTokens   ?? 1_500,
        // Ollama context window cap — directly controls inference speed on CPU
        ...(isOllama ? { options: { num_ctx: 4096 } } : {}),
        };

        // Only include tools for non-embedding tasks
        if (request.tools?.length) {
        payload.tools       = request.tools;
        payload.tool_choice = 'auto';
        }

        const timeoutMs = FETCH_TIMEOUT_MS[isOllama ? 'ollama' : 'openai'];

        const response = await fetch(`${apiBase}/chat/completions`, {
        method:  'POST',
        headers,
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `${isOllama ? 'Ollama' : 'OpenAI'} API error ${response.status}: ${body}`,
        );
        }

        const data = await response.json() as {
        choices: Array<{
            message: {
            content:    string | null;
            tool_calls?: unknown[];
            };
        }>;
        usage?: {
            prompt_tokens:     number;
            completion_tokens: number;
            total_tokens:      number;
        };
        };

        return {
        content:   data.choices[0]?.message.content   ?? '',
        toolCalls: data.choices[0]?.message.tool_calls ?? [],
        model:     modelName,
        usage: {
            prompt_tokens:     data.usage?.prompt_tokens     ?? 0,
            completion_tokens: data.usage?.completion_tokens ?? 0,
            total_tokens:      data.usage?.total_tokens      ?? 0,
        },
        };
    }
}