import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 }      from '@nestjs/event-emitter';
import {
    AgentResult,
    AgentConfig,
    TraceStep,
    TerminationReason,
    ToolContext,
} from '../agents/tools/tool.types';
import { FinalAnswerParams } from '../agents/tools/final-answer.tool';
import { TOOL_REGISTRY, getOpenAIToolSchemas, OpenAITool } from '../agents/tools/registry';
import { AgentMetricsService } from './services/agent-metrics.service';
import { AGENT_SYSTEM_PROMPT, agentConfig } from '../../config/agents-prompts.config';

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
// WHY A SERVICE, NOT A STANDALONE FUNCTION:
// Making this a NestJS Injectable lets us inject EventEmitter2 and
// AgentMetricsService without global state. It also makes the executor
// mockable in unit tests.
// ─────────────────────────────────────────────────────────────────────────────

interface RunAgentOptions {
    question:       string;
    userId:         string;
    correlationId:  string;
    /** Documents available to the user — injected into the system prompt */
    availableDocs?: Array<{ id: string; title: string }>;
    config?:        Partial<AgentConfig>;
}

@Injectable()
export class AgentExecutorService {
    private readonly logger = new Logger(AgentExecutorService.name);

    constructor(
        private readonly metrics:  AgentMetricsService,
        private readonly events:   EventEmitter2,
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
        const toolContext: ToolContext = { userId, correlationId };

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
        provider:      providerCfg.provider,
        model:         cfg.model,
        });

        // ── REACT LOOP ──────────────────────────────────────────────────────────
        while (iteration < cfg.maxIterations) {

        // ── GUARDRAIL 1: timeout ──────────────────────────────────────────────
        const elapsedMs = Date.now() - startTime;
        if (elapsedMs > cfg.timeoutMs) {
            this.logger.warn('Agent timeout', { correlationId, iteration, elapsedMs });
            return this.finalise('timeout', trace, totalCostUsd, iteration, startTime, toolContext);
        }

        // ── GUARDRAIL 2: cost ceiling ─────────────────────────────────────────
        // Skip cost check for Ollama (free) — costCeilingUsd is 0 for local
        if (cfg.costCeilingUsd > 0 && totalCostUsd >= cfg.costCeilingUsd) {
            this.logger.warn('Agent cost ceiling reached', {
            correlationId, iteration, totalCostUsd, ceiling: cfg.costCeilingUsd,
            });
            return this.finalise('cost_limit', trace, totalCostUsd, iteration, startTime, toolContext);
        }

        iteration++;
        const stepStart = Date.now();

        // ── PHASE: THINK ─────────────────────────────────────────────────────
        // Ask the model what to do next given the current conversation state.
        let llmResponse: Record<string, unknown>;
        try {
            llmResponse = await this.callLLM(cfg, messages, toolSchemas, providerCfg.provider);
        } catch (err) {
            this.logger.error('LLM call failed', { correlationId, iteration, err });
            return this.finalise('error', trace, totalCostUsd, iteration, startTime, toolContext);
        }

        // Track cost (Ollama returns no usage object — default to 0)
        const usage = (llmResponse as any).usage ?? { prompt_tokens: 0, completion_tokens: 0 };
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

        // ── NO TOOL CALL: model responded with plain text ────────────────────
        // This violates our rule ("MUST call final_answer") but we handle it
        // gracefully rather than crashing — the model may be on Ollama which
        // doesn't always respect function calling constraints.
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

        // ── PHASE: ACT — iterate over tool calls in this response ─────────────
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
            // The model sent invalid JSON — feed the error back for self-correction
            messages.push({
                role:        'tool',
                tool_call_id: toolCall.id,
                content:     `Error: could not parse tool arguments as JSON. Please retry.`,
            });
            this.metrics.recordToolCall(toolName, 'error');
            continue;
            }

            // ── GUARDRAIL 3: tool whitelist ──────────────────────────────────────
            const toolDef = TOOL_REGISTRY[toolName];
            if (!toolDef) {
            const knownTools = Object.keys(TOOL_REGISTRY).join(', ');
            messages.push({
                role:        'tool',
                tool_call_id: toolCall.id,
                content:     `Error: unknown tool "${toolName}". Available tools: ${knownTools}`,
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

            // ── INTERCEPT: final_answer ──────────────────────────────────────────
            // Validate and exit immediately — don't run the handler.
            if (toolName === 'final_answer') {
            const validation = toolDef.parameters.safeParse(parsedArgs);
            if (!validation.success) {
                messages.push({
                role:        'tool',
                tool_call_id: toolCall.id,
                content:     `Validation error in final_answer: ${validation.error.message}. Please retry with valid fields.`,
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

            return this.buildResult('completed', trace, totalCostUsd, iteration, finalArgs);
            }

            // ── GUARDRAIL 4: input validation ────────────────────────────────────
            const validation = toolDef.parameters.safeParse(parsedArgs);
            if (!validation.success) {
            messages.push({
                role:        'tool',
                tool_call_id: toolCall.id,
                content:     `Validation error for tool "${toolName}": ${validation.error.message}`,
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

            // ── PHASE: OBSERVE — execute the tool and feed result back ───────────
            try {
            const toolResult = await toolDef.handler(validation.data, toolContext);

            // ── GUARDRAIL 5: execution trace ──────────────────────────────────
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
                role:        'tool',
                tool_call_id: toolCall.id,
                content:     JSON.stringify(toolResult.data),
            });

            this.metrics.recordToolCall(toolName, 'success');
            } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.logger.error('Tool execution error', {
                correlationId, iteration, tool: toolName, error: errMsg,
            });

            // Feed the error back — the model can try a different approach.
            // Never throw here: one broken tool call should not crash the run.
            messages.push({
                role:        'tool',
                tool_call_id: toolCall.id,
                content:     `Tool error (${toolName}): ${errMsg}. Try a different approach.`,
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
        correlationId, iterations: iteration, totalCostUsd,
        });
        return this.finalise('iteration_limit', trace, totalCostUsd, iteration, startTime, toolContext);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Calls the LLM via the configured provider.
     * Ollama uses an OpenAI-compatible /v1/chat/completions endpoint.
     */
    private async callLLM(
        cfg:      AgentConfig,
        messages: Array<Record<string, unknown>>,
        tools:    OpenAITool[],
        provider: 'openai' | 'ollama',
    ): Promise<Record<string, unknown>> {
        const { openaiBreaker } = await import('../../lib/http/openai.breaker');

        const payload: Record<string, unknown> = {
        model:       cfg.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: cfg.temperature,
        max_tokens:  cfg.maxTokens,
        };

        // Ollama's OpenAI-compat layer uses the same payload shape.
        // The circuit breaker is already pointed at the correct apiBase
        // for the active provider via EMBEDDING_PROVIDER.
        const response = await openaiBreaker.fire('/chat/completions', payload);
        return response.data as Record<string, unknown>;
    }

    /**
     * Builds the partial-result returned when a guardrail terminates the run.
     * Attempts to surface the last successful observe step as a partial answer.
     */
    private finalise(
        reason:      TerminationReason,
        trace:       TraceStep[],
        totalCostUsd: number,
        iterations:  number,
        startTime:   number,
        context:     ToolContext,
    ): AgentResult {
        this.emitCompleted(reason, trace, totalCostUsd, iterations, startTime, context);

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
        confidence: 'unknown', // resolved by buildResult caller for completed runs
        });
    }
}