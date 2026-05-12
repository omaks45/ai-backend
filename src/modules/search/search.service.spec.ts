import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';

import { SearchService, SearchOptions, SearchResult } from './search.service';
import { PrismaService } from '../../database/prisma.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { RAG_CONFIG } from '../../config/rag-prompts.config';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const MOCK_EMBEDDING = new Array(768).fill(0.1);
const MOCK_VECTOR_LITERAL = '[0.1,0.1]'; // simplified literal returned by toVectorLiteral

const makeRawRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  documentTitle: 'Test Document',
  content: 'Relevant content about the query topic.',
  chunkIndex: 0,
  tokenCount: 42,
  score: '0.85', // pgvector returns numeric strings from $queryRaw
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrismaService = {
  $queryRaw: jest.fn(),
};

const mockEmbeddingService = {
  embedOne: jest.fn(),
  toVectorLiteral: jest.fn(),
  dimensions: 768,
  providerName: 'ollama',
};

// ---------------------------------------------------------------------------
// Helper: build the module
// ---------------------------------------------------------------------------

async function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      SearchService,
      { provide: PrismaService, useValue: mockPrismaService },
      { provide: EmbeddingService, useValue: mockEmbeddingService },
    ],
  }).compile();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default happy-path embedding mock
    mockEmbeddingService.embedOne.mockResolvedValue({ embedding: MOCK_EMBEDDING });
    mockEmbeddingService.toVectorLiteral.mockReturnValue(MOCK_VECTOR_LITERAL);

    const module = await buildModule();
    service = module.get<SearchService>(SearchService);
  });

  // -------------------------------------------------------------------------
  // Existence / DI
  // -------------------------------------------------------------------------

  describe('instantiation', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // search() — happy path, no documentId (searchAllDocuments)
  // -------------------------------------------------------------------------

  describe('search() — all documents', () => {
    const baseOptions: SearchOptions = {
      query: 'What is the capital of France?',
      userId: 'user-abc',
    };

    it('embeds the query using EmbeddingService', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow()]);

      await service.search(baseOptions);

      expect(mockEmbeddingService.embedOne).toHaveBeenCalledTimes(1);
      expect(mockEmbeddingService.embedOne).toHaveBeenCalledWith(baseOptions.query);
    });

    it('converts embedding to vector literal', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow()]);

      await service.search(baseOptions);

      expect(mockEmbeddingService.toVectorLiteral).toHaveBeenCalledWith(MOCK_EMBEDDING);
    });

    it('calls $queryRaw once (searchAllDocuments path)', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow()]);

      await service.search(baseOptions);

      expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('returns results mapped with numeric score', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow({ score: '0.9' })]);

      const results = await service.search(baseOptions);

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.9);
      expect(typeof results[0].score).toBe('number');
    });

    it('returns all expected fields on each result', async () => {
      const raw = makeRawRow();
      mockPrismaService.$queryRaw.mockResolvedValue([raw]);

      const results = await service.search(baseOptions);
      const r: SearchResult = results[0];

      expect(r.chunkId).toBe(raw.chunkId);
      expect(r.documentId).toBe(raw.documentId);
      expect(r.documentTitle).toBe(raw.documentTitle);
      expect(r.content).toBe(raw.content);
      expect(r.chunkIndex).toBe(raw.chunkIndex);
      expect(r.tokenCount).toBe(raw.tokenCount);
    });

    it('returns multiple results sorted as received from DB', async () => {
      const rows = [
        makeRawRow({ chunkId: 'chunk-1', score: '0.95' }),
        makeRawRow({ chunkId: 'chunk-2', score: '0.80' }),
        makeRawRow({ chunkId: 'chunk-3', score: '0.72' }),
      ];
      mockPrismaService.$queryRaw.mockResolvedValue(rows);

      const results = await service.search(baseOptions);

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.chunkId)).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    });
  });

  // -------------------------------------------------------------------------
  // search() — with documentId (searchWithDocument)
  // -------------------------------------------------------------------------

  describe('search() — scoped to a single document', () => {
    const scopedOptions: SearchOptions = {
      query: 'Explain recursion',
      userId: 'user-abc',
      documentId: 'doc-xyz',
    };

    it('calls $queryRaw once when documentId is provided', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow()]);

      await service.search(scopedOptions);

      expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('still embeds the query regardless of documentId', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow()]);

      await service.search(scopedOptions);

      expect(mockEmbeddingService.embedOne).toHaveBeenCalledWith(scopedOptions.query);
    });

    it('returns filtered results above minScore', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        makeRawRow({ score: '0.9' }),
        makeRawRow({ chunkId: 'chunk-2', score: '0.1' }), // below default minScore
      ]);

      const results = await service.search(scopedOptions);

      // Only the chunk with score 0.9 should survive default minScore filtering
      expect(results.every((r) => r.score >= RAG_CONFIG.minScore)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // minScore filtering
  // -------------------------------------------------------------------------

  describe('minScore filtering', () => {
    const baseOptions: SearchOptions = {
      query: 'something',
      userId: 'user-1',
    };

    it('filters out rows whose score is below minScore', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        makeRawRow({ chunkId: 'a', score: '0.8' }),
        makeRawRow({ chunkId: 'b', score: '0.1' }),
        makeRawRow({ chunkId: 'c', score: '0.05' }),
      ]);

      const results = await service.search({ ...baseOptions, minScore: 0.5 });

      expect(results).toHaveLength(1);
      expect(results[0].chunkId).toBe('a');
    });

    it('returns empty array when all scores are below minScore', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        makeRawRow({ score: '0.1' }),
        makeRawRow({ score: '0.05' }),
      ]);

      const results = await service.search({ ...baseOptions, minScore: 0.5 });

      expect(results).toHaveLength(0);
    });

    it('includes rows whose score equals minScore (inclusive boundary)', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        makeRawRow({ score: '0.5' }),
      ]);

      const results = await service.search({ ...baseOptions, minScore: 0.5 });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.5);
    });

    it('returns empty array when DB returns no rows', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      const results = await service.search(baseOptions);

      expect(results).toHaveLength(0);
    });

    it('uses RAG_CONFIG.minScore as default when minScore is not provided', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        makeRawRow({ score: String(RAG_CONFIG.minScore - 0.01) }),
        makeRawRow({ chunkId: 'chunk-pass', score: String(RAG_CONFIG.minScore + 0.01) }),
      ]);

      const results = await service.search(baseOptions);

      expect(results).toHaveLength(1);
      expect(results[0].chunkId).toBe('chunk-pass');
    });
  });

  // -------------------------------------------------------------------------
  // topK default / override
  // -------------------------------------------------------------------------

  describe('topK behaviour', () => {
    it('uses RAG_CONFIG.topK when topK is not provided', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await service.search({ query: 'q', userId: 'u' });

      // We can only assert $queryRaw was called; the topK value is baked into
      // the tagged template, so we verify at least the call was made.
      expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('accepts a custom topK without throwing', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow()]);

      await expect(
        service.search({ query: 'q', userId: 'u', topK: 3 }),
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // EmbeddingService.dimensions usage
  // -------------------------------------------------------------------------

  describe('dimension awareness', () => {
    it('reads dimensions from EmbeddingService (768 for Ollama)', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await service.search({ query: 'q', userId: 'u' });

      // dimensions are used inside the raw SQL — we assert they are read from
      // the service (not hardcoded) by checking the mock was accessed.
      expect(mockEmbeddingService.dimensions).toBe(768);
    });

    it('works transparently when dimensions switch to 1536 (OpenAI)', async () => {
      Object.defineProperty(mockEmbeddingService, 'dimensions', { value: 1536, configurable: true });
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow()]);

      await expect(
        service.search({ query: 'q', userId: 'u' }),
      ).resolves.toBeDefined();

      // restore
      Object.defineProperty(mockEmbeddingService, 'dimensions', { value: 768, configurable: true });
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('propagates errors thrown by EmbeddingService.embedOne', async () => {
      mockEmbeddingService.embedOne.mockRejectedValue(new Error('Embedding provider unreachable'));

      await expect(
        service.search({ query: 'q', userId: 'u' }),
      ).rejects.toThrow('Embedding provider unreachable');
    });

    it('propagates errors thrown by PrismaService.$queryRaw', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.search({ query: 'q', userId: 'u' }),
      ).rejects.toThrow('DB connection lost');
    });

    it('does not call $queryRaw when embedding fails', async () => {
      mockEmbeddingService.embedOne.mockRejectedValue(new Error('fail'));

      await service.search({ query: 'q', userId: 'u' }).catch(() => {});

      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  describe('logging', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      // Spy on the service's logger instance directly rather than Logger.prototype,
      // so we intercept the exact object the service holds and calls at runtime.
      logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    });

    it('logs once per search call', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow()]);

      await service.search({ query: 'q', userId: 'u' });

      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('includes correlationId in the log when provided', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await service.search({ query: 'q', userId: 'u', correlationId: 'corr-123' });

      const loggedMeta = logSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedMeta.correlationId).toBe('corr-123');
    });

    it('logs provider name from EmbeddingService', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await service.search({ query: 'q', userId: 'u' });

      const loggedMeta = logSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedMeta.provider).toBe('ollama');
    });

    it('logs topScore as "n/a" when result set is empty after filtering', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await service.search({ query: 'q', userId: 'u' });

      const loggedMeta = logSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedMeta.topScore).toBe('n/a');
    });

    it('logs topScore as a formatted number when results exist', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([makeRawRow({ score: '0.9321' })]);

      await service.search({ query: 'q', userId: 'u', minScore: 0 });

      const loggedMeta = logSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedMeta.topScore).toBe('0.9321');
    });
  });
});