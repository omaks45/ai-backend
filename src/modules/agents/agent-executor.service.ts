import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 }       from '@nestjs/event-emitter';
import {
    AgentResult,
    AgentConfig,
    TraceStep,
    TerminationReason,
    ToolContext,
} from './tools/tool.types';
import { FinalAnswerParams } from './tools/final-answer.tool';
import { TOOL_REGISTRY, getOpenAIToolSchemas, OpenAITool } from './tools/registry';
import { AgentMetricsService } from './services/agent-metrics.service';
import { AGENT_SYSTEM_PROMPT, agentConfig } from '../../config/agents-prompts.config';
import { SearchService }    from '../../modules/search/search.service';
import { DocumentsService } from '../../modules/documents/documents.service';
import { LlmGatewayService } from './services/llm-gateway.service';
import { McpMessage }         from '../mcp/mcp.types';

// ─────────────────────────────────────────────────────────────────────────────
// AgentExecutorService
//
// Owns the entire agent lifecycle:
//   1. Build the conversation context (system prompt + user question)
//   2. Run the ReAct loop (think → act → observe)
//   3. Enforce all 5 guardrails on every iteration
//   4. Emit observability events when the run ends
//   5. Return a typed AgentResult regardless of how the run ended
//
// LLM ROUTING (updated):
//   All LLM calls now go through LlmGatewayService.complete() which routes
//   through MCP. The raw fetch() + provider-branching logic has been removed
//   from this service entirely. Provider selection, timeout management, and
//   context-window options (num_ctx for Ollama) are all handled inside the
//   gateway — this service only knows "call complete(), get a response".
//
// WHY A SERVICE, NOT A STANDALONE FUNCTION:
//   Making this a NestJS Injectable lets us inject EventEmitter2,
//   AgentMetricsService, and LlmGatewayService without global state.
//   It also makes the executor mockable in unit tests.
// ─────────────────────────────────────────────────────────────────────────────

interface RunAgentOptions {
    question:       string;
    userId:         string;
    correlationId:  string;
    /** Documents available to the user — injected into the system prompt */
    availableDocs?: Array<{ id: string; title: string }>;
    config?:        Partial<AgentConfig>;
}

/**
 * Minimal per-run context stored on the instance so that callLLM (now
 * delegated to LlmGatewayService) can attach userId and correlationId to
 * every MCP request without receiving them as extra parameters on every call.
 *
 * These are always set at the top of runAgent() and cleared in finalise() /
 * the final_answer intercept, so there is no cross-request leakage as long
 * as each request enters its own runAgent() call (guaranteed by NestJS DI
 * when the service is REQUEST-scoped, or by the single-threaded event loop
 * when it is SINGLETON-scoped, since JS awaits are non-preemptive).
 */
interface ActiveRunContext {
    userId:        string;
    correlationId: string;
}

@Injectable()
export class AgentExecutorService {
    private readonly logger = new Logger(AgentExecutorService.name);

    /** Set once per runAgent() call; read by the MCP gateway helper. */
    private activeRun: ActiveRunContext | null = null;

    constructor(
        private readonly metrics:     AgentMetricsService,
        private readonly events:      EventEmitter2,
        private readonly search:      SearchService,
        private readonly documents:   DocumentsService,
        private readonly llmGateway:  LlmGatewayService,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // runAgent — public entry point
    // ─────────────────────────────────────────────────────────────────────────

    async runAgent(options: RunAgentOptions): Promise<AgentResult> {
        const providerCfg = agentConfig();
        const cfg: AgentConfig = {
            maxIterations:  providerCfg.maxIterations,
            timeoutMs:      providerCfg.timeoutMs,
            costCeilingUsd: providerCfg.costCeilingUsd,
            model:          providerCfg.model,
            temperature:    providerCfg.temperature,
            maxTokens:      providerCfg.maxTokens,
            ...options.config,
        };

        const { question, userId, correlationId, availableDocs = [] } = options;

        // Store per-run identity so the MCP gateway call in callLLM can read it
        this.activeRun = { userId, correlationId };

        const toolContext: ToolContext = {
            userId,
            correlationId,
            searchService:    this.search,
            documentsService: this.documents,
        };

        const trace:     TraceStep[] = [];
        let totalCostUsd = 0;
        let iteration    = 0;
        const startTime  = Date.now();

        // Build system prompt with the user's document list substituted in
        const docList = availableDocs.length > 0
            ? availableDocs.map(d => `  - "${d.title}" (${d.id})`).join('\n')
            : '  (No documents uploaded yet)';
        const systemPrompt = AGENT_SYSTEM_PROMPT.replace('{{DOCUMENT_LIST}}', docList);

        const messages: Array<Record<string, unknown>> = [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: question },
        ];

        const toolSchemas: OpenAITool[] = getOpenAIToolSchemas();

        this.logger.log('Agent run started', {
            correlationId,
            question:      question.substring(0, 120),
            maxIterations: cfg.maxIterations,
            costCeiling:   cfg.costCeilingUsd,
            model:         cfg.model,
        });

        // ── REACT LOOP ──────────────────────────────────────────────────────────
        while (iteration < cfg.maxIterations) {

            // ── GUARDRAIL 1: timeout ────────────────────────────────────────────
            const elapsedMs = Date.now() - startTime;
            if (elapsedMs >= cfg.timeoutMs) {
                this.logger.warn('Agent timeout', { correlationId, iteration, elapsedMs });
                return this.finalise('timeout', trace, totalCostUsd, iteration, startTime, toolContext);
            }

            // ── GUARDRAIL 2: cost ceiling ───────────────────────────────────────
            // costCeilingUsd is 0 for Ollama (free) — skip the check in that case
            if (cfg.costCeilingUsd > 0 && totalCostUsd >= cfg.costCeilingUsd) {
                this.logger.warn('Agent cost ceiling reached', {
                    correlationId, iteration, totalCostUsd, ceiling: cfg.costCeilingUsd,
                });
                return this.finalise('cost_limit', trace, totalCostUsd, iteration, startTime, toolContext);
            }

            iteration++;
            const stepStart = Date.now();

            // ── PHASE: THINK ──────────────────────────────────────────────────
            // Route the completion request through MCP instead of calling the
            // provider HTTP endpoint directly. LlmGatewayService owns all
            // provider-specific logic (base URL, auth header, timeout, num_ctx).
            let llmResponse: Record<string, unknown>;
            try {
                llmResponse = await this.callLLM(cfg, messages, toolSchemas);
            } catch (err) {
                this.logger.error('LLM call failed', { correlationId, iteration, err });
                return this.finalise('error', trace, totalCostUsd, iteration, startTime, toolContext);
            }

            // Track cost (Ollama / MCP may return no usage object — default to 0)
            const usage    = (llmResponse as any).usage ?? { prompt_tokens: 0, completion_tokens: 0 };
            const stepCost = providerCfg.provider === 'openai'
                ? (usage.prompt_tokens     / 1_000_000) * providerCfg.inputCostPerMillion
                + (usage.completion_tokens / 1_000_000) * providerCfg.outputCostPerMillion
                : 0;
            totalCostUsd += stepCost;

            const choice:    Record<string, unknown> = (llmResponse as any).choices?.[0] ?? {};
            const assistant: Record<string, unknown> = (choice as any).message ?? {};
            const toolCalls: unknown[] = (assistant as any).tool_calls ?? [];

            // Add assistant turn to conversation history (required by OpenAI API)
            messages.push({ role: 'assistant', ...assistant });

            // ── NO TOOL CALL: model responded with plain text ─────────────────
            // Handles Ollama models that don't always honour function-calling.
            if (!toolCalls.length) {
                const content = String((assistant as any).content ?? '');
                this.logger.warn('Agent responded without tool call — treating as final answer', {
                    correlationId, iteration,
                });
                trace.push({
                    step: iteration, phase: 'think',
                    output: content,
                    durationMs: Date.now() - stepStart,
                    costUsd: stepCost,
                });
                return this.buildResult('completed', trace, totalCostUsd, iteration, {
                    answer:     content,
                    sources:    [],
                    confidence: 'medium',
                    conflicts:  undefined,
                });
            }

            // ── PHASE: ACT — iterate over tool calls in this response ──────────
            for (const rawCall of toolCalls) {
                const toolCall = rawCall as {
                    id:       string;
                    function: { name: string; arguments: string };
                };

                const toolName = toolCall.function.name;
                let parsedArgs: unknown;

                try {
                    parsedArgs = JSON.parse(toolCall.function.arguments);
                } catch {
                    // Invalid JSON from the model — feed the error back for self-correction
                    messages.push({
                        role:         'tool',
                        tool_call_id: toolCall.id,
                        content:      `Error: could not parse tool arguments as JSON. Please retry.`,
                    });
                    this.metrics.recordToolCall(toolName, 'error');
                    continue;
                }

                // ── GUARDRAIL 3: tool whitelist ─────────────────────────────────
                const toolDef = TOOL_REGISTRY[toolName];
                if (!toolDef) {
                    const knownTools = Object.keys(TOOL_REGISTRY).join(', ');
                    messages.push({
                        role:         'tool',
                        tool_call_id: toolCall.id,
                        content:      `Error: unknown tool "${toolName}". Available tools: ${knownTools}`,
                    });
                    this.metrics.recordToolCall(toolName, 'rejected');
                    trace.push({
                        step: iteration, phase: 'act', tool: toolName,
                        input:  parsedArgs,
                        output: { error: 'Unknown tool' },
                        durationMs: Date.now() - stepStart,
                        costUsd:    stepCost,
                    });
                    continue;
                }

                // ── INTERCEPT: final_answer ─────────────────────────────────────
                // Validate and exit immediately — don't run the handler.
                if (toolName === 'final_answer') {
                    const validation = toolDef.parameters.safeParse(parsedArgs);
                    if (!validation.success) {
                        messages.push({
                            role:         'tool',
                            tool_call_id: toolCall.id,
                            content:      `Validation error in final_answer: ${validation.error.message}. Please retry with valid fields.`,
                        });
                        this.metrics.recordToolCall('final_answer', 'error');
                        continue;
                    }

                    const finalArgs = validation.data as FinalAnswerParams;
                    trace.push({
                        step: iteration, phase: 'act', tool: 'final_answer',
                        input: finalArgs,
                        durationMs: Date.now() - stepStart,
                        costUsd:    stepCost,
                    });
                    this.metrics.recordToolCall('final_answer', 'success');

                    // final_answer bypasses finalise() so emitCompleted is called explicitly
                    this.emitCompleted('completed', trace, totalCostUsd, iteration, startTime, toolContext);
                    this.activeRun = null;

                    return this.buildResult('completed', trace, totalCostUsd, iteration, finalArgs);
                }

                // ── GUARDRAIL 4: input validation ───────────────────────────────
                const validation = toolDef.parameters.safeParse(parsedArgs);
                if (!validation.success) {
                    messages.push({
                        role:         'tool',
                        tool_call_id: toolCall.id,
                        content:      `Validation error for tool "${toolName}": ${validation.error.message}`,
                    });
                    this.metrics.recordToolCall(toolName, 'error');
                    trace.push({
                        step: iteration, phase: 'act', tool: toolName,
                        input:  parsedArgs,
                        output: { error: validation.error.message },
                        durationMs: Date.now() - stepStart,
                        costUsd:    stepCost,
                    });
                    continue;
                }

                this.logger.log('Agent tool call', {
                    correlationId, iteration, tool: toolName, args: validation.data,
                });

                // ── PHASE: OBSERVE — execute the tool and feed result back ────────
                try {
                    const toolResult = await toolDef.handler(validation.data, toolContext);

                    // ── GUARDRAIL 5: execution trace ──────────────────────────────
                    trace.push({
                        step:  iteration,
                        phase: 'observe',
                        tool:  toolName,
                        input: validation.data,
                        output: toolResult.data,
                        durationMs: Date.now() - stepStart,
                        costUsd:    stepCost + (toolResult.tokensCost ?? 0),
                    });

                    messages.push({
                        role:         'tool',
                        tool_call_id: toolCall.id,
                        content:      JSON.stringify(toolResult.data),
                    });

                    this.metrics.recordToolCall(toolName, 'success');
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    this.logger.error('Tool execution error', {
                        correlationId, iteration, tool: toolName, error: errMsg,
                    });

                    // Feed the error back — the model can try a different approach.
                    // Never throw: one broken tool call must not crash the run.
                    messages.push({
                        role:         'tool',
                        tool_call_id: toolCall.id,
                        content:      `Tool error (${toolName}): ${errMsg}. Try a different approach.`,
                    });

                    trace.push({
                        step:  iteration,
                        phase: 'observe',
                        tool:  toolName,
                        input: validation.data,
                        output: { error: errMsg },
                        durationMs: Date.now() - stepStart,
                        costUsd:    stepCost,
                    });

                    this.metrics.recordToolCall(toolName, 'error');
                }
            }
        }

        // ── GUARDRAIL 1 (iteration limit) — loop exhausted ─────────────────────
        this.logger.warn('Agent iteration limit reached', {
            correlationId: this.activeRun?.correlationId,
            iterations: iteration,
            totalCostUsd,
        });
        return this.finalise('iteration_limit', trace, totalCostUsd, iteration, startTime, toolContext);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Delegates LLM completion to LlmGatewayService (MCP route).
     *
     * Provider selection, base URL resolution, auth headers, timeout budgets,
     * and Ollama num_ctx options have all moved into LlmGatewayService.
     * AgentExecutorService no longer needs to know which provider is active.
     *
     * userId and correlationId are read from this.activeRun which is set at
     * the top of every runAgent() call and cleared when the run ends.
     */
    private async callLLM(
        cfg:      AgentConfig,
        messages: Array<Record<string, unknown>>,
        tools:    OpenAITool[],
    ): Promise<Record<string, unknown>> {
        if (!this.activeRun) {
            throw new Error('callLLM called outside of an active runAgent() context');
        }

        return this.llmGateway.complete({
            taskType:      'agent',
            messages:      messages as McpMessage[],
            userId:        this.activeRun.userId,
            correlationId: this.activeRun.correlationId,
            tools,
            temperature:   cfg.temperature,
            maxTokens:     cfg.maxTokens,
        });
    }

    /**
     * Builds the partial result returned when a guardrail terminates the run.
     * Surfaces the last successful observe step as a partial answer if available.
     */
    private finalise(
        reason:       TerminationReason,
        trace:        TraceStep[],
        totalCostUsd: number,
        iterations:   number,
        startTime:    number,
        context:      ToolContext,
    ): AgentResult {
        this.emitCompleted(reason, trace, totalCostUsd, iterations, startTime, context);
        this.activeRun = null;

        const lastObserve = [...trace]
            .reverse()
            .find(s => s.phase === 'observe' && s.output && !(s.output as any).error);

        const partialNote = lastObserve
            ? `Partial results: ${JSON.stringify(lastObserve.output)}`
            : 'No partial results are available.';

        const reasonMessages: Record<TerminationReason, string> = {
            timeout:         'The research timed out before completing.',
            cost_limit:      'The request reached its cost limit before completing.',
            iteration_limit: 'The maximum number of research steps was reached.',
            error:           'An unexpected error stopped the research.',
            completed:       '',
        };

        return this.buildResult(reason, trace, totalCostUsd, iterations, {
            answer:     `${reasonMessages[reason]} ${partialNote}`,
            sources:    [],
            confidence: 'low',
            conflicts:  undefined,
        });
    }

    private buildResult(
        terminationReason: TerminationReason,
        trace:             TraceStep[],
        totalCostUsd:      number,
        iterations:        number,
        answer:            FinalAnswerParams,
    ): AgentResult {
        return {
            answer:            answer.answer,
            sources:           answer.sources,
            confidence:        answer.confidence,
            iterations,
            totalCostUsd,
            terminationReason,
            trace,
        };
    }

    private emitCompleted(
        terminationReason: TerminationReason,
        trace:             TraceStep[],
        totalCostUsd:      number,
        iterations:        number,
        startTime:         number,
        context:           ToolContext,
    ): void {
        const durationMs = Date.now() - startTime;

        // Emit event for UsageLog persistence (handled in agent.events.ts)
        this.events.emit('agent:completed', {
            userId:            context.userId,
            correlationId:     context.correlationId,
            iterations,
            totalCostUsd,
            terminationReason,
            toolsUsed:         [...new Set(trace.filter(s => s.tool).map(s => s.tool))],
            durationMs,
        });

        // Record Prometheus metrics
        this.metrics.recordRun({
            terminationReason,
            iterations,
            costUsd:    totalCostUsd,
            durationMs,
            confidence: 'unknown',
        });
    }
}