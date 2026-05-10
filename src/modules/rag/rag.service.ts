// CONCEPT: RAG ORCHESTRATION (Retrieval-Augmented Generation)
//
// Wires together the three RAG steps:
//   RETRIEVE  → SearchService.search()            — find relevant chunks via pgvector
//   AUGMENT   → ContextAssemblerService.assemble() — select chunks, build prompt context
//   GENERATE  → callChatAPI()                     — send prompt to LLM, get answer
//
// PROVIDER SWITCHING:
//   Dev  → Ollama  — calls http://localhost:11434/api/chat  (OpenAI-compatible format)
//   Prod → OpenAI  — calls https://api.openai.com/v1/chat/completions
//
//   Both use the same message format. The only difference is the base URL,
//   model name, and whether an Authorization header is sent.
//
// WHY TEMPERATURE 0.1?
//   Higher temperature = more creative = more likely to fabricate.
//   For document Q&A we want the model to closely paraphrase context text.
//
// WHY LIMIT CONVERSATION HISTORY?
//   Including full history can exceed the context window and buries the current
//   question under old context. We cap at maxHistoryMessages from ragConfig().
//   Ollama gets a tighter cap (6) than OpenAI (10) due to smaller context windows.
//
// COST TRACKING:
//   OpenAI emits cost events so UsageLog can record them.
//   Ollama always emits $0 — no billing applies to local models.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }       from '@nestjs/config';
import { EventEmitter2 }       from '@nestjs/event-emitter';
import { AssembledContext, Citation } from './context-assembler.service';
import { ragConfig, RAG_SYSTEM_PROMPT } from '../../config/rag-prompts.config';

export interface RAGResponse {
  answer:     string;
  citations:  Citation[];
  tokensUsed: { prompt: number; completion: number; total: number };
  costUsd:    number;
  model:      string;
  provider:   string;
}

interface ChatMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly openaiApiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.openaiApiKey = config.get<string>('OPENAI_API_KEY', '');

    const cfg = ragConfig();
    this.logger.log(
      `RagService ready — provider=${cfg.provider}, model=${cfg.model}`,
    );
  }

  async generate(options: {
    question:            string;
    context:             AssembledContext;
    conversationHistory: ChatMessage[];
    userId:              string;
    conversationId:      string;
    correlationId:       string;
  }): Promise<RAGResponse> {
    const { question, context, conversationHistory, userId, conversationId, correlationId } = options;

    const cfg      = ragConfig();
    const messages = this.buildMessages(question, context, conversationHistory);
    const start    = Date.now();

    const data = await this.callChatAPI(messages, cfg);

    // Normalise response — Ollama and OpenAI share the same response shape
    const answer     = data.choices[0].message.content as string;
    const usage      = data.usage as {
      prompt_tokens:     number;
      completion_tokens: number;
      total_tokens:      number;
    };

    // Ollama may not return usage — default to 0 safely
    const promptTokens     = usage?.prompt_tokens     ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const totalTokens      = usage?.total_tokens      ?? 0;

    const costUsd    = this.calculateCost(promptTokens, completionTokens, cfg);
    const durationMs = Date.now() - start;

    this.logger.log('RAG response generated', {
      correlationId,
      conversationId,
      provider:         cfg.provider,
      model:            cfg.model,
      contextChunks:    context.chunks.length,
      promptTokens,
      completionTokens,
      costUsd:          costUsd.toFixed(6),
      durationMs,
    });

    // Emit usage event — listeners record to UsageLog
    // Ollama will always emit $0 cost, which is correct
    this.events.emit('ai.chat.completed', {
      userId,
      conversationId,
      correlationId,
      provider:         cfg.provider,
      model:            cfg.model,
      promptTokens,
      completionTokens,
      costUsd,
    });

    return {
      answer,
      citations:  context.citations,
      tokensUsed: {
        prompt:     promptTokens,
        completion: completionTokens,
        total:      totalTokens,
      },
      costUsd,
      model:    cfg.model,
      provider: cfg.provider,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  buildMessages(
    question:            string,
    context:             AssembledContext,
    conversationHistory: ChatMessage[],
  ): ChatMessage[] {
    const cfg      = ragConfig();
    const messages: ChatMessage[] = [
      { role: 'system', content: RAG_SYSTEM_PROMPT },
    ];

    // Recent history for conversational continuity
    if (conversationHistory.length > 0) {
      messages.push(...conversationHistory.slice(-cfg.maxHistoryMessages));
    }

    // Context + question
    if (context.chunks.length > 0) {
      messages.push({
        role: 'user',
        content: [
          'Here is the relevant context from my documents:',
          '',
          context.contextText,
          '',
          '---',
          '',
          `My question: ${question}`,
        ].join('\n'),
      });
    } else {
      messages.push({
        role:    'user',
        content: `No relevant context was found in my documents.\n\nMy question: ${question}`,
      });
    }

    return messages;
  }

  private calculateCost(
    promptTokens:     number,
    completionTokens: number,
    cfg:              ReturnType<typeof ragConfig>,
  ): number {
    return (
      (promptTokens     / 1_000_000) * cfg.inputCostPerMillion +
      (completionTokens / 1_000_000) * cfg.outputCostPerMillion
    );
  }

  private async callChatAPI(
    messages: ChatMessage[],
    cfg:      ReturnType<typeof ragConfig>,
  ): Promise<any> {
    // ── Ollama ────────────────────────────────────────────────────────────
    // Ollama's /api/chat endpoint uses the OpenAI-compatible message format.
    // No API key required. The base URL is always localhost.
    if (cfg.provider === 'ollama') {
      const response = await fetch(`${cfg.apiBase}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:    cfg.model,
          messages,
          stream:   false,        // we want the full response, not a stream
          options: {
            temperature: cfg.temperature,
            num_predict: cfg.maxTokens,
          },
        }),
        signal: AbortSignal.timeout(120_000), // 120s — local models can be slow on first call
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama chat API error ${response.status}: ${body}`);
      }

      const data = await response.json() as {
        message: { content: string };
        prompt_eval_count?:  number;
        eval_count?:         number;
      };

      // Normalise Ollama response to OpenAI shape so the caller is provider-agnostic
      return {
        choices: [{ message: { content: data.message.content } }],
        usage: {
          prompt_tokens:     data.prompt_eval_count     ?? 0,
          completion_tokens: data.eval_count            ?? 0,
          total_tokens:      (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
      };
    }

    // ── OpenAI ────────────────────────────────────────────────────────────
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const response = await fetch(`${cfg.apiBase}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model:       cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens:  cfg.maxTokens,
      }),
      signal: AbortSignal.timeout(60_000), // 60s — cloud LLMs are faster than local
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI chat API error ${response.status}: ${body}`);
    }

    return response.json();
  }
}