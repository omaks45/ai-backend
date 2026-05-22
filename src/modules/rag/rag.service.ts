// src/modules/rag/rag.service.ts
//
// REFACTORED: RagService no longer calls OpenAI/Ollama directly.
// All LLM calls now go through McpService which handles:
//   - Prompt version resolution (from DB, with Redis cache)
//   - Model routing (task type → model)
//   - Fallback chains (gpt-4o → gpt-4o-mini on failure)
//   - Cost tracking (Redis INCRBYFLOAT + UsageLog event)
//   - Audit logging (AIAuditLog entry per call)

import { Injectable, Logger } from '@nestjs/common';
import { AssembledContext, Citation } from './context-assembler.service';
import { McpService }                 from '../mcp/services/mcp.service';

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

  constructor(private readonly mcp: McpService) {
    this.logger.log('RagService ready — using McpService for LLM calls');
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

    const messages = this.buildMessages(question, context, conversationHistory);

    const mcpResponse = await this.mcp.complete({
      taskType:      'chat',
      messages,
      userId,
      correlationId,
      temperature:   0.1,
      maxTokens:     1_500,
    });

    this.logger.log('RAG response generated', {
      correlationId, conversationId,
      model:         mcpResponse.model,
      promptVersion: mcpResponse.promptVersion,
      fallbackUsed:  mcpResponse.fallbackUsed,
      contextChunks: context.chunks.length,
      costUsd:       mcpResponse.costUsd.toFixed(6),
      latencyMs:     mcpResponse.latencyMs,
    });

    return {
      answer:    mcpResponse.content,
      citations: context.citations,
      tokensUsed: {
        prompt:     mcpResponse.tokensUsed.prompt,
        completion: mcpResponse.tokensUsed.completion,
        total:      mcpResponse.tokensUsed.total,
      },
      costUsd:  mcpResponse.costUsd,
      model:    mcpResponse.model,
      provider: mcpResponse.model.startsWith('gpt') ? 'openai' : 'ollama',
    };
  }

  buildMessages(
    question:            string,
    context:             AssembledContext,
    conversationHistory: ChatMessage[],
    maxHistoryMessages = 10,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (conversationHistory.length > 0) {
      const recent = conversationHistory
        .slice(-maxHistoryMessages)
        .filter(m => m.role === 'user' || m.role === 'assistant') as Array<{
          role: 'user' | 'assistant'; content: string;
        }>;
      messages.push(...recent);
    }

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
}