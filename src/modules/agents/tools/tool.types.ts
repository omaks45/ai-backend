import { z } from 'zod';
// Core tool contracts
//
// Every tool the agent can call must satisfy ToolDefinition.
// The schema is used to:
//   1. Describe the tool to the LLM (converted to OpenAI function format)
//   2. Validate inputs with Zod before execution (hard guardrail)
//   3. Type-check handler inputs at compile time

export interface ToolContext {
    /** Authenticated user making the request */
    userId: string;
    /** Trace correlation ID — propagated through every log and event */
    correlationId: string;
}

export interface ToolResult<T = unknown> {
    success:      boolean;
    data:         T;
    /** Optional token cost of running this tool (for LLM-backed tools) */
    tokensCost?:  number;
}

export interface ToolDefinition<TSchema extends z.ZodSchema = z.ZodSchema> {
    name:        string;
    description: string;
    parameters:  TSchema;
    handler:     (
        params:  z.infer<TSchema>,
        context: ToolContext,
    ) => Promise<ToolResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trace types — captured for every think/act/observe step
// ─────────────────────────────────────────────────────────────────────────────

export type TracePhase = 'think' | 'act' | 'observe';

export interface TraceStep {
    step:       number;
    phase:      TracePhase;
    tool?:      string;
    input?:     unknown;
    output?:    unknown;
    durationMs: number;
    costUsd:    number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent result — returned from runAgent regardless of termination reason
// ─────────────────────────────────────────────────────────────────────────────

export type TerminationReason =
    | 'completed'
    | 'iteration_limit'
    | 'timeout'
    | 'cost_limit'
    | 'error';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface AgentResult {
    answer:            string;
    sources:           string[];
    confidence:        ConfidenceLevel;
    iterations:        number;
    totalCostUsd:      number;
    terminationReason: TerminationReason;
    trace:             TraceStep[];
}

export interface AgentConfig {
    maxIterations:    number;
    timeoutMs:        number;
    costCeilingUsd:   number;
    model:            string;
    temperature:      number;
    maxTokens:        number;
}