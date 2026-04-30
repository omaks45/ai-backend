// src/modules/ingestion/ingestion-events.listener.spec.ts
//
// WHY TEST EVENT LISTENERS?
// Listeners are fire-and-forget side effects. If they silently break, nobody
// notices until audit logs are missing or cost tracking is wrong.
// These tests verify that every event type correctly writes a UsageLog row
// AND that a listener failure never propagates (it must be swallowed and logged).

import { Test, TestingModule } from '@nestjs/testing';
import { IngestionEventsListener } from './ingestion-events.listener';
import { PrismaService } from '../../database/prisma.service';

const mockPrisma = {
  usageLog: { create: jest.fn() },
};

describe('IngestionEventsListener', () => {
  let listener: IngestionEventsListener;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionEventsListener,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    listener = module.get<IngestionEventsListener>(IngestionEventsListener);
    jest.clearAllMocks();
  });

  // ── document.ingested ──────────────────────────────────────────────────────

  describe('onDocumentIngested', () => {
    const payload = {
      documentId:    'doc-1',
      userId:        'user-1',
      correlationId: 'corr-1',
      chunkCount:    10,
      durationMs:    1200,
      format:        'text' as const,
    };

    it('creates a UsageLog row with action=document_ingested', async () => {
      mockPrisma.usageLog.create.mockResolvedValue({});
      await listener.onDocumentIngested(payload);

      expect(mockPrisma.usageLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId:  'user-1',
            action:  'document_ingested',
            tokens:  0,
            costUsd: 0,
          }),
        }),
      );
    });

    it('includes documentId and chunkCount in metadata', async () => {
      mockPrisma.usageLog.create.mockResolvedValue({});
      await listener.onDocumentIngested(payload);

      const call = mockPrisma.usageLog.create.mock.calls[0][0];
      expect(call.data.metadata).toMatchObject({
        documentId: 'doc-1',
        chunkCount: 10,
      });
    });

    it('does NOT throw when Prisma fails (side-effect resilience)', async () => {
      mockPrisma.usageLog.create.mockRejectedValue(new Error('DB down'));
      // Should resolve without throwing
      await expect(listener.onDocumentIngested(payload)).resolves.toBeUndefined();
    });
  });

  // ── ai.embedding.generated ────────────────────────────────────────────────

  describe('onEmbeddingGenerated', () => {
    const payload = {
      userId:          'user-1',
      documentId:      'doc-1',
      model:           'text-embedding-3-small',
      tokensUsed:      500,
      estimatedCostUsd: 0.00001,
      cacheHits:       3,
      cacheMisses:     7,
    };

    it('creates a UsageLog row with correct tokens and cost', async () => {
      mockPrisma.usageLog.create.mockResolvedValue({});
      await listener.onEmbeddingGenerated(payload);

      expect(mockPrisma.usageLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId:  'user-1',
            action:  'embedding_generated',
            tokens:  500,
            costUsd: 0.00001,
          }),
        }),
      );
    });

    it('skips logging when userId is absent (anonymous context)', async () => {
      await listener.onEmbeddingGenerated({ ...payload, userId: undefined });
      expect(mockPrisma.usageLog.create).not.toHaveBeenCalled();
    });

    it('does NOT throw when Prisma fails', async () => {
      mockPrisma.usageLog.create.mockRejectedValue(new Error('timeout'));
      await expect(listener.onEmbeddingGenerated(payload)).resolves.toBeUndefined();
    });
  });

  // ── document.ingestion.failed ─────────────────────────────────────────────

  describe('onIngestionFailed', () => {
    it('logs the failure as a UsageLog row', async () => {
      mockPrisma.usageLog.create.mockResolvedValue({});
      await listener.onIngestionFailed({ documentId: 'doc-1', userId: 'user-1' });

      expect(mockPrisma.usageLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'document_ingestion_failed',
          }),
        }),
      );
    });

    it('does NOT throw when Prisma fails', async () => {
      mockPrisma.usageLog.create.mockRejectedValue(new Error('connection lost'));
      await expect(
        listener.onIngestionFailed({ documentId: 'doc-1', userId: 'user-1' }),
      ).resolves.toBeUndefined();
    });
  });
});
