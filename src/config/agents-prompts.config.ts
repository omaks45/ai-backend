// WHY AGENT PROMPTS ARE SEPARATE FROM RAG PROMPTS:
//
// The RAG system prompt governs a single request-response turn.
// The agent system prompt governs an entire reasoning loop — it must explain
// the ReAct workflow, tool contracts, soft guardrails, and termination rules.
// Keeping them separate means you can evolve agent behaviour without risking
// the simpler RAG path, and A/B test agent prompts independently.
//
// SOFT vs HARD GUARDRAILS:
// The prompt contains soft guardrails (max 3 searches, always cite sources).
// Soft guardrails guide normal behaviour but can be ignored by the model.
// Hard guardrails live in AgentExecutorService (iteration limit, timeout, cost).
// Hard guardrails are enforced in code and cannot be bypassed.
//
// PROVIDER SWITCHING:
// Dev  → Ollama (llama3.2) — same prompts, slightly different behaviour
// Prod → OpenAI (gpt-4o)   — same prompts, better instruction-following
// The model is resolved at runtime via EMBEDDING_PROVIDER env var, exactly
// as the RAG pipeline does in rag.config.ts.

// ─────────────────────────────────────────────────────────────────────────────
// Agent model config — mirrors the ProviderConfig shape in rag.config.ts
// ─────────────────────────────────────────────────────────────────────────────

interface AgentProviderConfig {
    provider:            'openai' | 'ollama';
    model:               string;
    apiBase:             string;
    temperature:         number;
    maxTokens:           number;
    maxIterations:       number;
    timeoutMs:           number;
    costCeilingUsd:      number;
    inputCostPerMillion: number;
    outputCostPerMillion: number;
}

const OPENAI_AGENT_CONFIG: AgentProviderConfig = {
    provider:             'openai',
    model:                'gpt-4o',
    apiBase:              'https://api.openai.com/v1',
    temperature:          0.1,       // Low = consistent tool call formatting
    maxTokens:            1_500,
    maxIterations:        10,
    timeoutMs:            60_000,    // 60 s hard ceiling
    costCeilingUsd:       0.50,
    inputCostPerMillion:  2.50,
    outputCostPerMillion: 10.00,
};

const OLLAMA_AGENT_CONFIG: AgentProviderConfig = {
    provider:             'ollama',
    model:                process.env.OLLAMA_CHAT_MODEL ?? 'llama3.2',
    apiBase:              'http://localhost:11434',
    temperature:          0.1,
    maxTokens:            1_500,
    // Tighter limits for local development — prevents long waits on slow hardware
    maxIterations:        6,
    timeoutMs:            120_000,   // Local inference can be slower
    costCeilingUsd:       0,         // No cost — local model
    inputCostPerMillion:  0,
    outputCostPerMillion: 0,
};

/**
 * Returns the active agent provider config based on EMBEDDING_PROVIDER env var.
 * Mirrors ragConfig() in rag.config.ts — same switching logic, same defaults.
 */
export function agentConfig(): AgentProviderConfig {
    const provider = (process.env.EMBEDDING_PROVIDER ?? '').toLowerCase();
    const nodeEnv  = (process.env.NODE_ENV ?? 'development').toLowerCase();

    if (provider === 'openai') return OPENAI_AGENT_CONFIG;
    if (provider === 'ollama') return OLLAMA_AGENT_CONFIG;

    return nodeEnv === 'production' ? OPENAI_AGENT_CONFIG : OLLAMA_AGENT_CONFIG;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT_SYSTEM_PROMPT
//
// This prompt defines:
//   1. The agent's identity and scope
//   2. Available tools and when to use each one
//   3. The expected workflow (soft guardrail on step count)
//   4. Hard rules for citation, honesty, and exit behaviour
//
// The {{DOCUMENT_LIST}} placeholder is replaced at runtime by AgentExecutorService
// so the model knows which documents are available without burning search calls
// just to discover what exists.
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_SYSTEM_PROMPT = `You are DocuChat's research assistant. You help users find, compare, and analyse information across their uploaded documents.

You reason and act in a loop. For each step you must decide: do I have enough information to answer, or do I need to use a tool?

AVAILABLE TOOLS:
- search_documents      — Semantic search across the user's documents. Use this first.
- get_document_summary  — Overview of a specific document's topics and contents.
- analyze_chunks        — Extract and compare specific data points from retrieved passages.
- final_answer          — Deliver your answer. You MUST use this — never respond with plain text.

AVAILABLE DOCUMENTS (UUIDs for get_document_summary):
{{DOCUMENT_LIST}}

WORKFLOW:
1. Read the question carefully. What specific information do you need?
2. Use search_documents with a precise noun-phrase query (not a question).
3. If the first search is insufficient, try one alternative query with different terms.
4. For comparison questions, use analyze_chunks to extract structured data from results.
5. Call final_answer once you have enough evidence, or once you have determined the answer is not available.

SOFT GUARDRAILS (follow these; hard limits are enforced separately):
- Search at most 3 times. If you cannot find the answer in 3 searches, call final_answer with confidence "low".
- Never call get_document_summary more than once per document.
- Never call analyze_chunks without first having called search_documents.

RULES:
1. You MUST call final_answer. Do not output plain text.
2. Only use information from tool results. Never fabricate facts.
3. Include the exact document title in the sources array for every source you cite.
4. If sources conflict, acknowledge both sides in your answer and note the conflict.
5. If the documents do not contain the answer, say so — confidence: "low".
6. Be concise. Users want clear answers, not summaries of your reasoning.`;

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compatible named export for any future services that import
// AGENT_CONFIG directly (mirrors the RAG_CONFIG pattern).
// ─────────────────────────────────────────────────────────────────────────────
export const AGENT_CONFIG = {
    get maxIterations()   { return agentConfig().maxIterations;   },
    get timeoutMs()       { return agentConfig().timeoutMs;       },
    get costCeilingUsd()  { return agentConfig().costCeilingUsd;  },
    get model()           { return agentConfig().model;           },
    get temperature()     { return agentConfig().temperature;     },
    get maxTokens()       { return agentConfig().maxTokens;       },
    get inputCostPerMillion()  { return agentConfig().inputCostPerMillion;  },
    get outputCostPerMillion() { return agentConfig().outputCostPerMillion; },
} as const;