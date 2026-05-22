import { Injectable, Logger } from '@nestjs/common';
import { McpService }         from '../../mcp/services/mcp.service';
import { TaskType, McpMessage } from '../../mcp/mcp.types';

// ─────────────────────────────────────────────────────────────────────────────
// LlmGatewayService
//
// Single responsibility: translate an AgentExecutorService completion request
// into an MCP complete() call and return the raw OpenAI-compatible response.
//
// TYPE ALIGNMENT:
//   All types are imported directly from mcp.types.ts so this service and
//   McpService share the exact same contracts — no local re-declarations that
//   can drift out of sync.
//
//   • TaskType    — canonical union from mcp.types ('chat'|'embedding'|'agent'|'summary')
//   • McpMessage  — canonical interface from mcp.types (content: string)
//
//   The previous local McpTaskType included 'rag' which does not exist in the
//   canonical TaskType union → was the source of the first TS error.
//   The previous local McpMessage typed content as `unknown` whereas
//   mcp.types types it as `string` → was the source of the second TS error.
//
// AgentExecutorService now calls this.llmGateway.complete() and gets back
// the same Record<string, unknown> shape it always expected — zero changes
// to how it reads choices, usage, or tool_calls.
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmCompleteParams {
    taskType:      TaskType;      // imported — 'chat' | 'embedding' | 'agent' | 'summary'
    messages:      McpMessage[];  // imported — content is string, not unknown
    userId:        string;
    correlationId: string;
    tools?:        unknown[];
    temperature?:  number;
    maxTokens?:    number;
}

// Re-export so agent-executor.service.ts can import McpMessage from here
// without a second import path — keeping its existing import line valid.
export type { McpMessage, TaskType };

@Injectable()
export class LlmGatewayService {
    private readonly logger = new Logger(LlmGatewayService.name);

    constructor(private readonly mcp: McpService) {}

    /**
     * Routes a completion request through MCP.
     *
     * Returns the raw OpenAI-compatible response object so callers can read
     * choices[0].message, usage, and tool_calls without any adapter layer.
     *
     * Throws on HTTP/network errors — AgentExecutorService catches these in
     * its callLLM() try/catch and maps them to an 'error' termination reason.
     */
    async complete(params: LlmCompleteParams): Promise<Record<string, unknown>> {
        const { taskType, messages, userId, correlationId, tools, temperature, maxTokens } = params;

        this.logger.debug('LlmGateway routing completion via MCP', {
            taskType,
            userId,
            correlationId,
            messageCount: messages.length,
            toolCount:    tools?.length ?? 0,
        });

        const response = await this.mcp.complete({
            taskType,
            messages,
            userId,
            correlationId,
            tools,
            temperature,
            maxTokens,
        });

        return response as unknown as Record<string, unknown>;
    }
}