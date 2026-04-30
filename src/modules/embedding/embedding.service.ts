import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'crypto';
import { CacheService, CACHE_TTL, CacheKeys } from '../cache/cache.service';

//  Constants

const EMBEDDING_MODEL      = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_BATCH_LIMIT   = 100; // Stay well under OpenAI's 2048 limit
const COST_PER_MILLION_TOKENS = 0.02; // $ per 1M tokens (text-embedding-3-small)

export interface EmbeddingResult {
  embedding: number[];
  fromCache: boolean;
  tokensUsed: number;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  cacheHits: number;
  cacheMisses: number;
  tokensUsed: number;
  estimatedCostUsd: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string;
  private readonly apiBase: string;

  constructor(
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.apiKey  = config.get<string>('OPENAI_API_KEY', '');
    this.apiBase = config.get<string>('OPENAI_API_BASE', 'https://api.openai.com/v1');
  }

  // Single embedding (cached)

  async embedOne(text: string): Promise<EmbeddingResult> {
    const hash     = this.hashText(text);
    const cacheKey = CacheKeys.embedding(hash);

    const cached = await this.cache.get<number[]>(cacheKey);
    if (cached) {
      this.logger.debug('Embedding cache hit', { hash: hash.slice(0, 12) });
      return { embedding: cached, fromCache: true, tokensUsed: 0 };
    }

    const { embeddings, tokensUsed } = await this.callOpenAI([text]);
    const embedding = embeddings[0];

    await this.cache.set(cacheKey, embedding, CACHE_TTL.EMBEDDING);

    this.logger.debug('Embedding generated and cached', { hash: hash.slice(0, 12), tokensUsed });

    return { embedding, fromCache: false, tokensUsed };
  }

  //  Batch embedding (cache-aware, cost-tracked)

  async embedBatch(
    texts: string[],
    context?: { userId?: string; documentId?: string },
  ): Promise<BatchEmbeddingResult> {
    if (!texts.length) {
      return { embeddings: [], cacheHits: 0, cacheMisses: 0, tokensUsed: 0, estimatedCostUsd: 0 };
    }

    // Pre-allocate result array to preserve order
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const uncached: { originalIndex: number; text: string }[] = [];

    // ── 1. Cache check pass ────────────────────────────────────────────────
    await Promise.all(
      texts.map(async (text, i) => {
        const cacheKey = CacheKeys.embedding(this.hashText(text));
        const hit      = await this.cache.get<number[]>(cacheKey);
        if (hit) {
          results[i] = hit;
        } else {
          uncached.push({ originalIndex: i, text });
        }
      }),
    );

    const cacheHits   = texts.length - uncached.length;
    const cacheMisses = uncached.length;

    this.logger.debug('Batch embedding cache check', {
      total: texts.length,
      cacheHits,
      cacheMisses,
    });

    // ── 2. Generate only uncached embeddings ──────────────────────────────
    let tokensUsed = 0;

    if (uncached.length > 0) {
      const batches = this.partition(uncached, OPENAI_BATCH_LIMIT);

      for (const batch of batches) {
        const { embeddings, tokensUsed: batchTokens } = await this.callOpenAI(
          batch.map((u) => u.text),
        );
        tokensUsed += batchTokens;

        // Cache and slot results back into the ordered array
        await Promise.all(
          batch.map(async (item, batchIdx) => {
            const embedding = embeddings[batchIdx];
            results[item.originalIndex] = embedding;

            const cacheKey = CacheKeys.embedding(this.hashText(item.text));
            await this.cache.set(cacheKey, embedding, CACHE_TTL.EMBEDDING);
          }),
        );
      }
    }

    const estimatedCostUsd = (tokensUsed / 1_000_000) * COST_PER_MILLION_TOKENS;

    // 3. Emit cost event 
    if (tokensUsed > 0) {
      this.events.emit('ai.embedding.generated', {
        ...context,
        model:            EMBEDDING_MODEL,
        tokensUsed,
        estimatedCostUsd,
        cacheHits,
        cacheMisses,
      });
    }

    return {
      embeddings: results as number[][],
      cacheHits,
      cacheMisses,
      tokensUsed,
      estimatedCostUsd,
    };
  }

  //  pgvector storage helpers

  /**
   * Convert an embedding array to the pgvector literal format.
   * e.g. [0.1, -0.2, 0.3] → '[0.1,-0.2,0.3]'
   */
  toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  //  Private helpers 

  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private partition<T>(arr: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      batches.push(arr.slice(i, i + size));
    }
    return batches;
  }

  /**
   * Call the OpenAI embeddings endpoint.
   * Uses fetch (Node 18+) — no Axios dependency required here.
   */
  private async callOpenAI(
    texts: string[],
  ): Promise<{ embeddings: number[][]; tokensUsed: number }> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const response = await fetch(`${this.apiBase}/embeddings`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
      signal: AbortSignal.timeout(30_000), // 30s hard timeout
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI embeddings API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      data: { index: number; embedding: number[] }[];
      usage: { total_tokens: number };
    };

    // Sort by index — OpenAI does not guarantee response order
    const sorted = data.data.sort((a, b) => a.index - b.index);

    return {
      embeddings: sorted.map((d) => d.embedding),
      tokensUsed: data.usage.total_tokens,
    };
  }
}
