// src/modules/mcp/mcp.service.ts
//
// THE MODEL CONTROL PLANE — 6-STEP PIPELINE
//
// Every LLM call in DocuChat flows through mcpComplete():
//   1. checkBudget    — abort before spending money if budget exhausted
//   2. resolvePrompt  — fetch active prompt version (Redis cache → DB)
//   3. routeModel     — select model by task type
//   4. callWithFallback — execute with graceful degradation
//   5. trackCost      — atomic Redis increment + DB via UsageLog event
//   6. auditLog       — write AIAuditLog record (never crashes)
//
// APPLICATION CODE CHANGES:
// Before MCP: RagService called OpenAI directly with a hardcoded model.
// After MCP:  RagService calls mcpComplete() — model, prompt version,
//             budget, fallback, and audit are all handled transparently.
//
// WHY THIS ORDER:
//   Budget BEFORE model call — fail fast, don't waste money on rejected requests.
//   Audit AFTER everything    — needs the actual model used + cost + latency.
//   Cost tracking AFTER call  — we only charge for successful calls.

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 }      from '@nestjs/event-emitter';
import { PromptService }      from '../services/prompt.service';
import { RouterService }      from '../services/router.service';
import { BudgetService }      from '../services/budget.service';
import { AuditService }       from '../services/audit.service';
import { McpRequest, McpResponse, TaskType } from '../mcp.types';

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly prompts: PromptService,
    private readonly router:  RouterService,
    private readonly budget:  BudgetService,
    private readonly audit:   AuditService,
    private readonly events:  EventEmitter2,
  ) {}

  /**
   * Complete an LLM request through the full MCP pipeline.
   *
   * This is the single entry point for all LLM calls in the application.
   * RagService and AgentExecutorService call this instead of hitting
   * providers directly.
   */
  async complete(request: McpRequest): Promise<McpResponse> {
    const startTime = Date.now();

    // ── Step 1: Budget enforcement ────────────────────────────────────────
    // Checked BEFORE the LLM call — fail fast so we don't spend money on
    // requests that would be rejected anyway.
    await this.budget.checkAndEnforce(request.userId);

    // ── Step 2: Resolve prompt version ───────────────────────────────────
    // Loads from Redis (O(1)) or DB (O(log n)) with 5-minute TTL.
    // Uses A/B splitting if userId is provided and multiple versions active.
    const prompt = await this.prompts.resolveAB(request.taskType, request.userId);

    // ── Step 3: Route to model ────────────────────────────────────────────
    // O(1) map lookup. Returns ModelConfig with pricing info.
    const model = this.router.routeModel(request.taskType);

    // ── Step 4: Call with fallback ────────────────────────────────────────
    // Tries primary model, falls back to secondary if it fails.
    // Returns the actual model used (may differ from routed model).
    const result = await this.router.callWithFallback(model, {
      systemPrompt:  prompt.content,
      messages:      request.messages,
      tools:         request.tools,
      temperature:   request.temperature,
      maxTokens:     request.maxTokens,
      correlationId: request.correlationId,
    });

    // ── Step 5: Track cost ────────────────────────────────────────────────
    // O(1) Redis INCRBYFLOAT. Cost uses the actual model, not the intended one.
    const costUsd = this.router.calculateCost(result.model, result.usage);
    await this.budget.trackCost(request.userId, costUsd);

    // Emit event so UsageLog is updated via the existing event listener pattern
    this.events.emit('ai.chat.completed', {
      userId:          request.userId,
      correlationId:   request.correlationId,
      provider:        result.model.startsWith('gpt') ? 'openai' : 'ollama',
      model:           result.model,
      promptTokens:    result.usage.prompt_tokens,
      completionTokens:result.usage.completion_tokens,
      costUsd,
    });

    const latencyMs = Date.now() - startTime;

    // ── Step 6: Audit log ─────────────────────────────────────────────────
    // Fire-and-forget — wrapped in try/catch inside AuditService.
    // Never delays the response or crashes the request.
    void this.audit.log({
      userId:        request.userId,
      correlationId: request.correlationId,
      taskType:      request.taskType,
      model:         result.model,
      promptVersion: prompt.version,
      inputTokens:   result.usage.prompt_tokens,
      outputTokens:  result.usage.completion_tokens,
      costUsd,
      latencyMs,
      fallbackUsed:  result.fallbackUsed,
      messages:      request.messages,
      response:      result.content,
    });

    this.logger.log('MCP call completed', {
      correlationId: request.correlationId,
      taskType:      request.taskType,
      model:         result.model,
      promptVersion: prompt.version,
      fallbackUsed:  result.fallbackUsed,
      costUsd:       costUsd.toFixed(6),
      latencyMs,
    });

    return {
      content:       result.content,
      toolCalls:     result.toolCalls,
      model:         result.model,
      promptVersion: prompt.version,
      tokensUsed: {
        prompt:     result.usage.prompt_tokens,
        completion: result.usage.completion_tokens,
        total:      result.usage.total_tokens,
      },
      costUsd,
      latencyMs,
      fallbackUsed:  result.fallbackUsed,
    };
  }

  // ── Convenience delegation methods ───────────────────────────────────────
  // These let callers perform admin operations without importing sub-services.

  async activatePrompt(taskType: TaskType, version: string) {
    return this.prompts.activatePrompt(taskType, version);
  }

  async createPromptVersion(data: Parameters<PromptService['createVersion']>[0]) {
    return this.prompts.createVersion(data);
  }

  async listPromptVersions(taskType: TaskType) {
    return this.prompts.listVersions(taskType);
  }

  async getBudgetStatus(userId: string) {
    return this.budget.getBudgetStatus(userId);
  }

  async getAuditStats(since: Date) {
    return this.audit.getStats(since);
  }

  async getAuditByUser(userId: string, limit?: number, offset?: number) {
    return this.audit.findByUser(userId, limit, offset);
  }
}