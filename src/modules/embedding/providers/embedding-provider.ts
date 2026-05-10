// OLLAMA LOCAL PROVIDER
//
// Ollama runs models locally — no API key, no cost, no rate limits.
// Used for local development via EMBEDDING_PROVIDER=ollama in .env
//
// nomic-embed-text produces 768-dimensional vectors.
// The Ollama API differs from OpenAI:
//   - Endpoint: POST /api/embeddings
//   - Request field: "prompt" (not "input")
//   - No batch endpoint — we loop and call one at a time
//   - No token usage returned — we estimate from character count
//
// WHY NO BATCH?
// Ollama's /api/embeddings only accepts a single prompt per call.
// We run them sequentially. This is fine for development where speed
// is not critical. Production uses OpenAI which supports true batching.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }      from '@nestjs/config';
import { EmbeddingProvider }  from '../embedding-provider.interface';

@Injectable()
export class OllamaProvider implements EmbeddingProvider {
    private readonly logger   = new Logger(OllamaProvider.name);
    private readonly baseUrl:  string;
    private readonly model:    string;

    readonly providerName = 'ollama';
    readonly dimensions   = 768; // nomic-embed-text output size

    constructor(private readonly config: ConfigService) {
        this.baseUrl = config.get<string>('OLLAMA_BASE_URL', 'http://localhost:11434');
        this.model   = config.get<string>('OLLAMA_EMBED_MODEL', 'nomic-embed-text');
    }

    async embed(text: string): Promise<number[]> {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: this.model, prompt: text }),
        signal:  AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama embedding error ${response.status}: ${body}`);
        }

        const data = (await response.json()) as { embedding: number[] };
        return data.embedding;
    }

    async embedBatch(texts: string[]): Promise<{ embeddings: number[][]; tokensUsed: number }> {
        if (!texts.length) return { embeddings: [], tokensUsed: 0 };

        // Ollama has no batch endpoint — run sequentially
        const embeddings: number[][] = [];
        for (const text of texts) {
        embeddings.push(await this.embed(text));
        }

        // Ollama doesn't return token counts — estimate: ~4 chars per token
        const tokensUsed = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);

        this.logger.debug('Ollama batch complete', { count: texts.length, tokensUsed });

        return { embeddings, tokensUsed };
    }
}