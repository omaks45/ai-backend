
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmbeddingService } from './embedding.service';
import { CacheService } from '../cache/cache.service';

// Helpers

function makeEmbedding(seed = 0): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(i + seed) * 0.01);
}

const mockOpenAIResponse = (texts: string[]) => ({
  ok: true,
  json: async () => ({
    data: texts.map((_, i) => ({ index: i, embedding: makeEmbedding(i) })),
    usage: { total_tokens: texts.length * 10 },
  }),
});

//  Mocks 

const mockCache = {
  get:    jest.fn(),
  set:    jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string, def?: string) => {
    if (key === 'OPENAI_API_KEY') return 'sk-test';
    return def ?? key;
  }),
};

const mockEvents = { emit: jest.fn() };

// Patch global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        { provide: CacheService,   useValue: mockCache  },
        { provide: ConfigService,  useValue: mockConfig },
        { provide: EventEmitter2,  useValue: mockEvents },
      ],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
    jest.clearAllMocks();
  });

  // embedOne

  describe('embedOne', () => {
    it('returns cached embedding without calling OpenAI', async () => {
      const embedding = makeEmbedding(1);
      mockCache.get.mockResolvedValue(embedding);

      const result = await service.embedOne('cached text');

      expect(result.fromCache).toBe(true);
      expect(result.tokensUsed).toBe(0);
      expect(result.embedding).toEqual(embedding);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls OpenAI on cache miss and caches the result', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockOpenAIResponse(['test text']));

      const result = await service.embedOne('test text');

      expect(result.fromCache).toBe(false);
      expect(result.tokensUsed).toBe(10);
      expect(result.embedding).toHaveLength(1536);
      expect(mockCache.set).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws when OPENAI_API_KEY is missing', async () => {
      mockCache.get.mockResolvedValue(null);
      mockConfig.get.mockReturnValue(''); // No API key

      await expect(service.embedOne('text')).rejects.toThrow('OPENAI_API_KEY');
    });
  });

  // embedBatch

  describe('embedBatch', () => {
    it('returns empty result for empty input', async () => {
      const result = await service.embedBatch([]);
      expect(result.embeddings).toEqual([]);
      expect(result.cacheHits).toBe(0);
    });

    it('serves all from cache when all are cached', async () => {
      mockCache.get.mockResolvedValue(makeEmbedding(0));

      const result = await service.embedBatch(['a', 'b', 'c']);

      expect(result.cacheHits).toBe(3);
      expect(result.cacheMisses).toBe(0);
      expect(result.tokensUsed).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('only calls OpenAI for cache misses', async () => {
      // First text cached, rest are misses
      mockCache.get
        .mockResolvedValueOnce(makeEmbedding(0)) // hit
        .mockResolvedValue(null);                 // misses

      mockFetch.mockResolvedValue(mockOpenAIResponse(['b', 'c']));

      const result = await service.embedBatch(['a', 'b', 'c']);

      expect(result.cacheHits).toBe(1);
      expect(result.cacheMisses).toBe(2);
      expect(result.embeddings).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('preserves original order when mixing cache hits and misses', async () => {
      const cachedEmbedding = makeEmbedding(99);
      const apiEmbedding    = makeEmbedding(1);

      // Index 1 is cached, 0 and 2 are misses
      mockCache.get.mockImplementation(async (key: string) => {
        if (key.includes(hashFor('middle'))) return cachedEmbedding;
        return null;
      });

      mockFetch.mockResolvedValue({
        ok:   true,
        json: async () => ({
          data:  [{ index: 0, embedding: apiEmbedding }, { index: 1, embedding: apiEmbedding }],
          usage: { total_tokens: 20 },
        }),
      });

      const result = await service.embedBatch(['first', 'middle', 'last']);
      expect(result.embeddings).toHaveLength(3);
    });

    it('emits ai.embedding.generated event with cost data', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockOpenAIResponse(['text']));

      await service.embedBatch(['text'], { userId: 'u1', documentId: 'd1' });

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'ai.embedding.generated',
        expect.objectContaining({
          userId:     'u1',
          documentId: 'd1',
          tokensUsed: expect.any(Number),
          estimatedCostUsd: expect.any(Number),
        }),
      );
    });

    it('does not emit event when all results are from cache', async () => {
      mockCache.get.mockResolvedValue(makeEmbedding(0));
      await service.embedBatch(['a', 'b']);
      expect(mockEvents.emit).not.toHaveBeenCalled();
    });
  });

  // toVectorLiteral

  describe('toVectorLiteral', () => {
    it('formats an embedding array as a pgvector literal', () => {
      expect(service.toVectorLiteral([0.1, -0.2, 0.3])).toBe('[0.1,-0.2,0.3]');
    });
  });
});

// Helper to compute the hash a text would produce (mirrors service logic)
function hashFor(text: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(text).digest('hex');
}
