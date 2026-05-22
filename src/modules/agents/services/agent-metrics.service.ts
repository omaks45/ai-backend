import { Injectable } from '@nestjs/common';
import * as promClient from 'prom-client';
import { TerminationReason } from '../tools/tool.types';

// ─────────────────────────────────────────────────────────────────────────────
// AgentMetricsService
//
// Extends the project's existing metrics pattern (see MetricsService) with
// agent-specific counters and histograms. Uses the same private Registry
// approach to avoid collisions with the global default registry.
//
// Key operational questions these metrics answer:
//
//   agentIterations          → Are agents efficient (1–3) or stuck (8–10)?
//   agentCostUsd             → Are we near the per-request cost ceiling?
//   agentTerminations        → Is iteration_limit rising? (prompt/tool problem)
//   agentToolCallsTotal      → Which tools are over-used or under-used?
//   agentDurationSeconds     → p95 latency — is the timeout too tight?
//   agentRunsTotal           → Overall throughput and error rate
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AgentMetricsService {
    private readonly registry: promClient.Registry;

    /** Distribution of iterations per completed (or terminated) agent run */
    readonly agentIterations: promClient.Histogram<string>;

    /** Distribution of total cost per agent run in USD */
    readonly agentCostUsd: promClient.Histogram<string>;

    /**
     * Counts by termination reason.
     * Alert when reason="iteration_limit" or reason="cost_limit" climbs —
     * it means agents are getting stuck or prompts are inefficient.
     */
    readonly agentTerminations: promClient.Counter<string>;

    /** Every tool invocation, labelled by tool name and success/failure */
    readonly agentToolCallsTotal: promClient.Counter<string>;

    /** End-to-end wall-clock duration including all tool calls and LLM rounds */
    readonly agentDurationSeconds: promClient.Histogram<string>;

    /** Total agent requests, labelled by confidence level of the final answer */
    readonly agentRunsTotal: promClient.Counter<string>;

    constructor() {
        this.registry = new promClient.Registry();

        this.agentIterations = new promClient.Histogram({
        name:      'docuchat_agent_iterations',
        help:      'Number of ReAct iterations per agent run',
        // Buckets align with the 10-iteration hard limit so we can see the
        // distribution clearly: most runs should land in the 1–3 range.
        buckets:   [1, 2, 3, 4, 5, 7, 10],
        registers: [this.registry],
        });

        this.agentCostUsd = new promClient.Histogram({
        name:      'docuchat_agent_cost_usd',
        help:      'Total LLM cost per agent run in USD',
        // Buckets up to the $0.50 ceiling. Anything in 0.25–0.50 warrants review.
        buckets:   [0.01, 0.05, 0.10, 0.20, 0.35, 0.50],
        registers: [this.registry],
        });

        this.agentTerminations = new promClient.Counter({
        name:       'docuchat_agent_terminations_total',
        help:       'Agent run terminations by reason',
        labelNames: ['reason'],
        registers:  [this.registry],
        });

        this.agentToolCallsTotal = new promClient.Counter({
        name:       'docuchat_agent_tool_calls_total',
        help:       'Agent tool invocations by tool name and outcome',
        labelNames: ['tool', 'outcome'], // outcome: success | error | rejected
        registers:  [this.registry],
        });

        this.agentDurationSeconds = new promClient.Histogram({
        name:      'docuchat_agent_duration_seconds',
        help:      'End-to-end agent run wall-clock duration in seconds',
        buckets:   [1, 2, 5, 10, 20, 30, 45, 60],
        registers:  [this.registry],
        });

        this.agentRunsTotal = new promClient.Counter({
        name:       'docuchat_agent_runs_total',
        help:       'Agent runs by final confidence level',
        labelNames: ['confidence'],
        registers:  [this.registry],
        });
    }

    // ─── Helper methods ────────────────────────────────────────────────────────

    /**
     * Called once at the end of every agent run.
     * Records all high-level metrics in a single call so callers don't
     * have to remember which counters to update.
     */
    recordRun(options: {
        terminationReason: TerminationReason;
        iterations:        number;
        costUsd:           number;
        durationMs:        number;
        confidence:        string;
    }): void {
        const { terminationReason, iterations, costUsd, durationMs, confidence } = options;

        this.agentTerminations.inc({ reason: terminationReason });
        this.agentIterations.observe(iterations);
        this.agentCostUsd.observe(costUsd);
        this.agentDurationSeconds.observe(durationMs / 1_000);
        this.agentRunsTotal.inc({ confidence });
    }

    /**
     * Called after every tool dispatch attempt.
     * outcome is 'success', 'error' (tool threw), or 'rejected' (not in registry).
     */
    recordToolCall(tool: string, outcome: 'success' | 'error' | 'rejected'): void {
        this.agentToolCallsTotal.inc({ tool, outcome });
    }

    /** Scrape endpoint — merged into the main /metrics response by MetricsController */
    async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }

    getContentType(): string {
        return this.registry.contentType;
    }
}