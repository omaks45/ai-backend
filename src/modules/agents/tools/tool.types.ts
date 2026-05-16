import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// ToolContext
//
// Passed to every tool handler by the executor.
// Services are injected here by AgentExecutorService — no dynamic imports.
//
// Path context: this file is at src/modules/agents/tools/
// So sibling modules are reached via:
//   ../../search/search.service      → src/modules/search/search.service
//   ../../documents/documents.service → src/modules/documents/documents.service
// ─────────────────────────────────────────────────────────────────────────────

import { SearchService }    from '../../search/search.service';
import { DocumentsService } from '../../documents/documents.service';

export interface ToolContext {
    userId:           string;
    correlationId:    string;
    /** Injected by AgentExecutorService — used by search_documents tool */
    searchService:    SearchService;
    /** Injected by AgentExecutorService — used by get_document_summary tool */
    documentsService: DocumentsService;
}

export interface ToolResult<T = unknown> {
    success:     boolean;
    data:        T;
    tokensCost?: number;
}

export interface ToolDefinition<TSchema extends z.ZodSchema = z.ZodSchema> {
    name:        string;
    description: string;
    parameters:  TSchema;
    handler: (
        params:  z.infer<TSchema>,
        context: ToolContext,
    ) => Promise<ToolResult>;
}

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
    maxIterations:  number;
    timeoutMs:      number;
    costCeilingUsd: number;
    model:          string;
    temperature:    number;
    maxTokens:      number;
}