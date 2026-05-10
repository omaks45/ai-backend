// Tests for the provider-agnostic EmbeddingService.
// The service never calls fetch directly — it delegates to EmbeddingProvider.
// We mock the EMBEDDING_PROVIDER token so these tests are provider-neutral:
// they pass whether Ollama or OpenAI is injected at runtime.
//
// Test surface:
//   embedOne   — cache hit, cache miss, provider delegation
//   embedBatch — empty input, all cached, partial cache, order preservation,
//                event emission, no event on full cache hit
//   toVectorLiteral — pgvector format

import { Test, TestingModule }   from '@nestjs/testing';
import { EventEmitter2 }         from '@nestjs/event-emitter';
import { EmbeddingService }      from './embedding.service';
import { CacheService, CACHE_TTL } from '../cache/cache.service';
import { EMBEDDING_PROVIDER }    from './embedding-provider.interface';
import { createHash }            from 'crypto';

//  Helpers

/** Deterministic fake vector — length matches the mock provider's dimensions */
function makeEmbedding(seed = 0, dims = 1536): number[] {
  return Array.from({ length: dims }, (_, i) => Math.sin(i + seed) * 0.01);
}

/** Mirror the service's private cacheKey logic so tests can pre-seed the cache */
function cacheKeyFor(providerName: string, text: string): string {
  const hash = createHash('sha256')
    .update(`${providerName}:${text}`)
    .digest('hex');
  return `embed:${hash}`;
}

//  Mocks

const PROVIDER_NAME = 'openai'; // value returned by the mock provider
const DIMENSIONS    = 1536;

/**
 * Mock EmbeddingProvider — replaces the EMBEDDING_PROVIDER token.
 * Tests control return values via mockResolvedValue / mockImplementation.
 */
const mockProvider = {
  providerName: PROVIDER_NAME,
  dimensions:   DIMENSIONS,
  embed:        jest.fn(),
  embedBatch:   jest.fn(),
};

/**
 * Mock CacheService — all cache operations are no-ops by default.
 * Individual tests override get() to simulate hits or misses.
 */
const mockCache = {
  get: jest.fn().mockResolvedValue(null), // default: cache miss
  set: jest.fn().mockResolvedValue(undefined),
};

const mockEvents = { emit: jest.fn() };

//  Suite 

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        { provide: EMBEDDING_PROVIDER, useValue: mockProvider },
        { provide: CacheService,       useValue: mockCache    },
        { provide: EventEmitter2,      useValue: mockEvents   },
      ],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
    jest.clearAllMocks();

    // Re-apply defaults after clearAllMocks() wipes them
    mockCache.get.mockResolvedValue(null);
    mockCache.set.mockResolvedValue(undefined);
  });

  //  Metadata getters ────────────────────────────────────────────────────────

  describe('provider metadata', () => {
    it('exposes providerName from the injected provider', () => {
      expect(service.providerName).toBe(PROVIDER_NAME);
    });

    it('exposes dimensions from the injected provider', () => {
      expect(service.dimensions).toBe(DIMENSIONS);
    });
  });

  //  embedOne ─────────────────────────────────────────────────────────────────

  describe('embedOne', () => {
    it('returns cached embedding without calling the provider', async () => {
      const cached = makeEmbedding(1);
      mockCache.get.mockResolvedValue(cached);

      const result = await service.embedOne('cached text');

      expect(result.fromCache).toBe(true);
      expect(result.tokensUsed).toBe(0);
      expect(result.embedding).toEqual(cached);
      expect(mockProvider.embed).not.toHaveBeenCalled();
    });

    it('calls provider on cache miss, caches the result, returns fromCache=false', async () => {
      const embedding = makeEmbedding(2);
      mockCache.get.mockResolvedValue(null);
      mockProvider.embed.mockResolvedValue(embedding);

      const result = await service.embedOne('test text');

      expect(result.fromCache).toBe(false);
      expect(result.embedding).toEqual(embedding);
      expect(result.tokensUsed).toBeGreaterThan(0); // approximate: ceil(length/4)
      expect(mockProvider.embed).toHaveBeenCalledWith('test text');
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^embed:/),
        embedding,
        CACHE_TTL.EMBEDDING,
      );
    });

    it('uses the correct cache key (includes provider name)', async () => {
      const embedding = makeEmbedding(3);
      mockProvider.embed.mockResolvedValue(embedding);

      await service.embedOne('key test');

      const expectedKey = cacheKeyFor(PROVIDER_NAME, 'key test');
      expect(mockCache.get).toHaveBeenCalledWith(expectedKey);
      expect(mockCache.set).toHaveBeenCalledWith(expectedKey, embedding, CACHE_TTL.EMBEDDING);
    });

    it('propagates provider errors to the caller', async () => {
      mockCache.get.mockResolvedValue(null);
      mockProvider.embed.mockRejectedValue(new Error('Provider unavailable'));

      await expect(service.embedOne('text')).rejects.toThrow('Provider unavailable');
    });
  });

  //  embedBatch

  describe('embedBatch', () => {
    it('returns empty result for empty input without calling provider', async () => {
      const result = await service.embedBatch([]);

      expect(result.embeddings).toEqual([]);
      expect(result.cacheHits).toBe(0);
      expect(result.cacheMisses).toBe(0);
      expect(result.tokensUsed).toBe(0);
      expect(result.estimatedCostUsd).toBe(0);
      expect(mockProvider.embedBatch).not.toHaveBeenCalled();
    });

    it('serves all from cache when all texts are cached', async () => {
      const cached = makeEmbedding(0);
      mockCache.get.mockResolvedValue(cached);

      const result = await service.embedBatch(['a', 'b', 'c']);

      expect(result.cacheHits).toBe(3);
      expect(result.cacheMisses).toBe(0);
      expect(result.tokensUsed).toBe(0);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.embeddings).toHaveLength(3);
      expect(mockProvider.embedBatch).not.toHaveBeenCalled();
    });

    it('calls provider only for cache misses', async () => {
      const cachedEmbedding = makeEmbedding(0);
      const apiEmbeddings   = [makeEmbedding(1), makeEmbedding(2)];

      // First text is a cache hit, rest are misses
      mockCache.get
        .mockResolvedValueOnce(cachedEmbedding) // 'a' → hit
        .mockResolvedValue(null);               // 'b', 'c' → miss

      mockProvider.embedBatch.mockResolvedValue({
        embeddings: apiEmbeddings,
        tokensUsed: 20,
      });

      const result = await service.embedBatch(['a', 'b', 'c']);

      expect(result.cacheHits).toBe(1);
      expect(result.cacheMisses).toBe(2);
      expect(result.embeddings).toHaveLength(3);
      expect(mockProvider.embedBatch).toHaveBeenCalledWith(['b', 'c']);
      expect(mockProvider.embedBatch).toHaveBeenCalledTimes(1);
    });

    it('preserves original index order when mixing cache hits and misses', async () => {
      const hitEmbedding  = makeEmbedding(99); // index 1 ('middle') is cached
      const missEmbedding = makeEmbedding(1);

      mockCache.get.mockImplementation(async (key: string) => {
        return key === cacheKeyFor(PROVIDER_NAME, 'middle') ? hitEmbedding : null;
      });

      mockProvider.embedBatch.mockResolvedValue({
        embeddings: [missEmbedding, missEmbedding], // for 'first' and 'last'
        tokensUsed: 20,
      });

      const result = await service.embedBatch(['first', 'middle', 'last']);

      expect(result.embeddings).toHaveLength(3);
      // 'middle' (index 1) must be the cached vector, not an API vector
      expect(result.embeddings[1]).toEqual(hitEmbedding);
      // 'first' and 'last' come from the provider
      expect(result.embeddings[0]).toEqual(missEmbedding);
      expect(result.embeddings[2]).toEqual(missEmbedding);
    });

    it('caches all newly generated embeddings', async () => {
      const embeddings = [makeEmbedding(1), makeEmbedding(2)];
      mockCache.get.mockResolvedValue(null);
      mockProvider.embedBatch.mockResolvedValue({ embeddings, tokensUsed: 20 });

      await service.embedBatch(['x', 'y']);

      expect(mockCache.set).toHaveBeenCalledTimes(2);
      expect(mockCache.set).toHaveBeenCalledWith(
        cacheKeyFor(PROVIDER_NAME, 'x'),
        embeddings[0],
        CACHE_TTL.EMBEDDING,
      );
      expect(mockCache.set).toHaveBeenCalledWith(
        cacheKeyFor(PROVIDER_NAME, 'y'),
        embeddings[1],
        CACHE_TTL.EMBEDDING,
      );
    });

    it('emits ai.embedding.generated with full context on provider call', async () => {
      mockCache.get.mockResolvedValue(null);
      mockProvider.embedBatch.mockResolvedValue({
        embeddings: [makeEmbedding(1)],
        tokensUsed: 10,
      });

      await service.embedBatch(['text'], { userId: 'u1', documentId: 'd1' });

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'ai.embedding.generated',
        expect.objectContaining({
          userId:           'u1',
          documentId:       'd1',
          provider:         PROVIDER_NAME,
          dimensions:       DIMENSIONS,
          tokensUsed:       10,
          estimatedCostUsd: expect.any(Number),
          cacheHits:        0,
          cacheMisses:      1,
          totalTexts:       1,
        }),
      );
    });

    it('does NOT emit event when all results come from cache', async () => {
      mockCache.get.mockResolvedValue(makeEmbedding(0));

      await service.embedBatch(['a', 'b']);

      expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    it('calculates estimated cost correctly for openai provider', async () => {
      mockCache.get.mockResolvedValue(null);
      mockProvider.embedBatch.mockResolvedValue({
        embeddings: [makeEmbedding(0)],
        tokensUsed: 1_000_000, // 1M tokens → $0.02
      });

      const result = await service.embedBatch(['text']);

      // openai: $0.02 per 1M tokens
      expect(result.estimatedCostUsd).toBeCloseTo(0.02, 6);
    });

    it('propagates provider errors to the caller', async () => {
      mockCache.get.mockResolvedValue(null);
      mockProvider.embedBatch.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(service.embedBatch(['text'])).rejects.toThrow('Rate limit exceeded');
    });
  });

  //  toVectorLiteral

  describe('toVectorLiteral', () => {
    it('formats a float array as a pgvector literal', () => {
      expect(service.toVectorLiteral([0.1, -0.2, 0.3])).toBe('[0.1,-0.2,0.3]');
    });

    it('handles a single-element array', () => {
      expect(service.toVectorLiteral([1.5])).toBe('[1.5]');
    });

    it('handles an empty array', () => {
      expect(service.toVectorLiteral([])).toBe('[]');
    });
  });
});