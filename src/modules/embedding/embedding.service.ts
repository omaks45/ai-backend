// Provider-agnostic embedding service.
// Talks only to EmbeddingProvider — never to Ollama or OpenAI directly.
//
// CACHING STRATEGY (Redis):
//   Cache key = SHA-256(providerName + ":" + text)
//   Including the provider name is critical: Ollama returns 768-dim vectors,
//   OpenAI returns 1536-dim. Without the provider in the key, a cache hit
//   from dev (Ollama) could be returned in prod (OpenAI), silently breaking
//   vector search with wrong-dimension data.
//   TTL: 7 days — embeddings are deterministic for the same text + model.
//
// COST TRACKING:
//   Every non-cached batch emits an 'ai.embedding.generated' event.
//   Ollama cost is always $0. OpenAI cost is calculated from tokensUsed.
//   Wire up a listener in the analytics/billing module to persist this.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 }              from '@nestjs/event-emitter';
import { createHash }                 from 'crypto';
import { CacheService, CACHE_TTL }    from '../cache/cache.service';
import {
  EmbeddingProvider,
  EMBEDDING_PROVIDER,
} from './embedding-provider.interface';

export interface EmbeddingResult {
  embedding:  number[];
  fromCache:  boolean;
  tokensUsed: number;
}

export interface BatchEmbeddingResult {
  embeddings:       number[][];
  cacheHits:        number;
  cacheMisses:      number;
  tokensUsed:       number;
  estimatedCostUsd: number;
}

// Cost per 1M tokens — $0 for local providers
const COST_PER_MILLION_TOKENS: Record<string, number> = {
  openai: 0.02,
  ollama: 0.00,
};

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @Inject(EMBEDDING_PROVIDER)
    private readonly provider: EmbeddingProvider,
    private readonly cache:    CacheService,
    private readonly events:   EventEmitter2,
  ) {
    // Log which provider is active so startup logs make it obvious
    this.logger.log(
      `EmbeddingService ready — provider=${provider.providerName}, dimensions=${provider.dimensions}`,
    );
  }

  /** Expose provider metadata so callers can react to dimensions/name */
  get providerName(): string { return this.provider.providerName; }
  get dimensions():   number { return this.provider.dimensions;   }

  // Single embedding (cached)

  async embedOne(text: string): Promise<EmbeddingResult> {
    const key    = this.cacheKey(text);
    const cached = await this.cache.get<number[]>(key);

    if (cached) {
      this.logger.debug('Cache hit (single)', { provider: this.providerName });
      return { embedding: cached, fromCache: true, tokensUsed: 0 };
    }

    const embedding = await this.provider.embed(text);
    await this.cache.set(key, embedding, CACHE_TTL.EMBEDDING);

    // Approximate token count for single embeds (provider doesn't return usage here)
    const tokensUsed = Math.ceil(text.length / 4);

    this.logger.debug('Embedding generated (single)', {
      provider: this.providerName,
      tokensUsed,
    });

    return { embedding, fromCache: false, tokensUsed };
  }

  //  Batch embeddings (cache-aware, cost-tracked)

  async embedBatch(
    texts:    string[],
    context?: { userId?: string; documentId?: string },
  ): Promise<BatchEmbeddingResult> {
    if (!texts.length) {
      return { embeddings: [], cacheHits: 0, cacheMisses: 0, tokensUsed: 0, estimatedCostUsd: 0 };
    }

    // Pre-allocate result array to preserve original order
    const results:  (number[] | null)[]              = new Array(texts.length).fill(null);
    const uncached: { idx: number; text: string }[]  = [];

    //  1. Cache check pass
    await Promise.all(
      texts.map(async (text, i) => {
        const hit = await this.cache.get<number[]>(this.cacheKey(text));
        if (hit) results[i] = hit;
        else     uncached.push({ idx: i, text });
      }),
    );

    const cacheHits   = texts.length - uncached.length;
    const cacheMisses = uncached.length;

    this.logger.log('Batch cache check', {
      total:     texts.length,
      cacheHits,
      cacheMisses,
      provider:  this.providerName,
    });

    //  2. Embed only uncached texts via provider ─────────────────────────
    let tokensUsed = 0;

    if (uncached.length > 0) {
      const { embeddings, tokensUsed: t } = await this.provider.embedBatch(
        uncached.map((u) => u.text),
      );
      tokensUsed = t;

      // Slot back into ordered array and cache each result
      await Promise.all(
        uncached.map(async (item, batchIdx) => {
          const embedding       = embeddings[batchIdx];
          results[item.idx]     = embedding;
          await this.cache.set(this.cacheKey(item.text), embedding, CACHE_TTL.EMBEDDING);
        }),
      );
    }

    const costRate       = COST_PER_MILLION_TOKENS[this.providerName] ?? 0;
    const estimatedCostUsd = (tokensUsed / 1_000_000) * costRate;

    //  3. Emit cost/usage event (only when we actually called the provider)
    if (tokensUsed > 0 || cacheMisses > 0) {
      this.events.emit('ai.embedding.generated', {
        ...context,
        provider:         this.providerName,
        dimensions:       this.dimensions,
        tokensUsed,
        estimatedCostUsd,
        cacheHits,
        cacheMisses,
        totalTexts:       texts.length,
      });
    }

    return {
      embeddings:       results as number[][],
      cacheHits,
      cacheMisses,
      tokensUsed,
      estimatedCostUsd,
    };
  }

  // pgvector helper

  /**
   * Convert a float array to the pgvector literal string.
   * e.g. [0.1, -0.2, 0.3] → '[0.1,-0.2,0.3]'
   * Use this when writing raw SQL / TypeORM query builder inserts.
   */
  toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  // Private

  /**
   * Cache key includes providerName so Ollama (768-dim) and OpenAI (1536-dim)
   * vectors never collide in Redis when you switch environments.
   */
  private cacheKey(text: string): string {
    const hash = createHash('sha256')
      .update(`${this.providerName}:${text}`)
      .digest('hex');
    return `embed:${hash}`;
  }
}