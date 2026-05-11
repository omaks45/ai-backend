
// WHY A SEPARATE CONFIG FILE FOR PROMPTS?
// Prompts are configuration, not code. Keeping them in a dedicated file means:
// - Easy to find, review, and update without touching service logic
// - A/B test prompts by swapping this file
// - Non-engineers can review and improve the instructions
//
// PROVIDER SWITCHING:
// Dev  → Ollama (llama3.2 local model)  — free, no API key, slightly lower quality
// Prod → OpenAI (gpt-4o)                — paid, higher quality, cost tracked
//
// The active config is selected at runtime via EMBEDDING_PROVIDER env var.
// RagService reads ragConfig() and calls the correct provider automatically.

// System prompt (shared across providers)
export const RAG_SYSTEM_PROMPT = `You are DocuChat, an AI assistant that answers questions based exclusively on the provided document context.

RULES:
1. ONLY answer based on the provided context. If the context does not contain the answer, say exactly: "I couldn't find information about that in your documents."
2. NEVER fabricate or infer information not present in the context.
3. Cite sources using [Source N] where N matches the source number in the context.
4. Be concise and direct.
5. If the question is ambiguous, ask for clarification rather than guessing.
6. If the context contains conflicting information, acknowledge the conflict and present both sides with their sources.

Context format you will receive:
[Source N: "Document Title", Section M]
Content of the relevant section...`;

// Per-provider model config 

interface ProviderConfig {
    provider:             'openai' | 'ollama';
    model:                string;
    apiBase:              string;
    temperature:          number;
    maxTokens:            number;
    contextTokenBudget:   number;
    maxHistoryMessages:   number;
    topK:                 number;
    minScore:             number;
    inputCostPerMillion:  number;   // $0 for local providers
    outputCostPerMillion: number;
}

const OPENAI_CONFIG: ProviderConfig = {
    provider:             'openai',
    model:                'gpt-4o',
    apiBase:              'https://api.openai.com/v1',
    temperature:          0.1,     // Low = factual, deterministic answers
    maxTokens:            1_500,
    contextTokenBudget:   3_500,   // Max tokens for retrieved chunks
    maxHistoryMessages:   10,      // Last 5 Q&A pairs
    topK:                 10,      // Max chunks to retrieve
    minScore:             0.3,     // Minimum cosine similarity to include

    // GPT-4o pricing per million tokens (2025)
    inputCostPerMillion:  2.50,
    outputCostPerMillion: 10.00,
};

const OLLAMA_CONFIG: ProviderConfig = {
    provider:             'ollama',
    model:                'llama3.2',   // Change to any model you have pulled locally
    apiBase:              'http://localhost:11434',
    temperature:          0.1,
    maxTokens:            1_500,
    contextTokenBudget:   2_500,   // Smaller budget — local models have tighter context windows
    maxHistoryMessages:   6,       // Fewer history messages to stay within local context limits
    topK:                 8,       // Slightly fewer chunks for local model performance
    minScore:             0.25,    // Slightly lower threshold — local embeddings (768-dim) score differently

    // Local model — no cost
    inputCostPerMillion:  0,
    outputCostPerMillion: 0,
};

/**
 * Returns the active provider config based on EMBEDDING_PROVIDER env var.
 * Defaults to ollama in development, openai in production.
 *
 * RagService calls this at construction time so config is resolved once.
 */
export function ragConfig(): ProviderConfig {
    const provider = (process.env.EMBEDDING_PROVIDER || '').toLowerCase();
    const nodeEnv  = (process.env.NODE_ENV || 'development').toLowerCase();

    if (provider === 'openai') return OPENAI_CONFIG;
    if (provider === 'ollama') return OLLAMA_CONFIG;

    // Fallback based on NODE_ENV
    return nodeEnv === 'production' ? OPENAI_CONFIG : OLLAMA_CONFIG;
}

// Keep RAG_CONFIG as a named export for backwards compatibility with
// ContextAssemblerService and SearchService which import it directly.
// They only use provider-neutral fields (topK, minScore, contextTokenBudget, maxHistoryMessages).
export const RAG_CONFIG = {
    get topK()               { return ragConfig().topK;               },
    get minScore()           { return ragConfig().minScore;           },
    get contextTokenBudget() { return ragConfig().contextTokenBudget; },
    get maxHistoryMessages() { return ragConfig().maxHistoryMessages; },
} as const;