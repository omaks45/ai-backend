
// All types for the Model Control Plane.
// Centralised here so McpService, PromptService, RouterService, BudgetService,
// and AuditService share the same contracts without circular imports.

// ─────────────────────────────────────────────────────────────────────────────
// Task types — every LLM call is classified before routing
// ─────────────────────────────────────────────────────────────────────────────

export type TaskType = 'chat' | 'embedding' | 'agent' | 'summary';

// ─────────────────────────────────────────────────────────────────────────────
// Request / response
// ─────────────────────────────────────────────────────────────────────────────

export interface McpMessage {
    role:    'system' | 'user' | 'assistant' | 'tool';
    content: string;
}

export interface McpRequest {
    taskType:       TaskType;
    messages:       McpMessage[];
    userId:         string;
    correlationId:  string;
    tools?:         unknown[];
    maxTokens?:     number;
    temperature?:   number;
}

export interface McpResponse {
    content:       string;
    toolCalls?:    unknown[];
    model:         string;
    promptVersion: string;
    tokensUsed: {
        prompt:     number;
        completion: number;
        total:      number;
    };
    costUsd:      number;
    latencyMs:    number;
    fallbackUsed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model config — pricing + limits per model
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelConfig {
    name:                  string;
    provider:              'openai' | 'ollama';
    costPerMillionInput:   number;
    costPerMillionOutput:  number;
    maxContextTokens:      number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal call result — returned by callWithFallback before cost is computed
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmCallResult {
    content:      string;
    toolCalls?:   unknown[];
    model:        string;
    usage: {
        prompt_tokens:     number;
        completion_tokens: number;
        total_tokens:      number;
    };
    fallbackUsed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget
// ─────────────────────────────────────────────────────────────────────────────

export interface BudgetStatus {
    tier:          string;
    budgetUsd:     number;
    spentUsd:      number;
    remainingUsd:  number;
    percentUsed:   number;
    exhausted:     boolean;
}