// WHY AN INTERFACE?
// Both OllamaProvider and OpenAIProvider must satisfy the same contract.
// The EmbeddingService depends on this interface, not on either concrete
// provider. Swapping providers = changing one env var. No service code changes.
// This is the Dependency Inversion Principle.

export interface EmbeddingProvider {
    /**
     * Generate an embedding for a single text string.
     * Returns a number[] of fixed length (768 for Ollama, 1536 for OpenAI).
     */
    embed(text: string): Promise<number[]>;

    /**
     * Generate embeddings for multiple texts in one API call.
     * Implementations must preserve the input order in the returned array.
     */
    embedBatch(texts: string[]): Promise<{ embeddings: number[][]; tokensUsed: number }>;

    /** Human-readable name used in logs and metrics */
    readonly providerName: string;

    /** Number of dimensions this provider produces */
    readonly dimensions: number;
}

export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER_TOKEN';