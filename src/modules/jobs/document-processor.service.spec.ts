// src/modules/jobs/document-processor.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DocumentProcessorService, PROGRESS } from './document-processor.service';
import { PrismaService } from '../../database/prisma.service';
import { DocumentExtractorService } from '../ingestion/document-extractor.service';
import { ChunkerService } from '../ingestion/chunker.service';
import { EmbeddingService } from '../embedding/embedding.service';

//  BullMQ mock

const mockJob = {
    id:             'job-1',
    data:           { documentId: 'doc-1', userId: 'user-1', correlationId: 'corr-1', queuedAt: Date.now() },
    attemptsMade:   0,
    opts:           { attempts: 3 },
    updateProgress: jest.fn(),
};

jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add:     jest.fn().mockResolvedValue({ id: 'job-1' }),
        getJobs: jest.fn().mockResolvedValue([]),
        close:   jest.fn(),
    })),
    Worker: jest.fn().mockImplementation(() => ({
        on:    jest.fn(),
        close: jest.fn(),
    })),
}));

jest.mock('ioredis', () =>
    jest.fn().mockImplementation(() => ({ quit: jest.fn(), on: jest.fn() })),
);

// Typed mock interfaces

type MockPrisma = {
    document:        { update: jest.Mock; findUniqueOrThrow: jest.Mock };
    chunk:           { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
    ingestionMetric: { create: jest.Mock };
    $transaction:    jest.Mock;
    $executeRaw:     jest.Mock;
};

// Service mocks

const mockPrisma: MockPrisma = {
    document: {
        update:            jest.fn(),
        findUniqueOrThrow: jest.fn(),
    },
    chunk: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany:   jest.fn(),
    },
    ingestionMetric: {
        create: jest.fn(),
    },
    // Explicit param/return types break the circular reference that caused implicit-any
    $transaction: jest.fn(async (ops: unknown): Promise<unknown> => {
        if (Array.isArray(ops)) return Promise.all(ops);
        return (ops as (tx: MockPrisma) => Promise<unknown>)(mockPrisma);
    }),
    $executeRaw: jest.fn(),
};

const mockExtractor = {
    extract: jest.fn().mockResolvedValue({
        text:           'Sample text content for testing.',
        format:         'text',
        characterCount: 32,
        pageCount:      1,           // added — prevents undefined in IngestionMetric
    }),
};

const mockChunker = {
    chunk: jest.fn().mockReturnValue([
        { index: 0, text: 'Chunk one.', tokenEstimate: 10, startChar: 0,  endChar: 10 },
        { index: 1, text: 'Chunk two.', tokenEstimate: 10, startChar: 11, endChar: 21 },
    ]),
    computeStats: jest.fn().mockReturnValue({
        count: 2, totalTokens: 20, avgTokens: 10, minTokens: 10, maxTokens: 10,
    }),
};

const mockEmbedding = {
    embedBatch: jest.fn().mockResolvedValue({
        embeddings:       [Array(1536).fill(0.1), Array(1536).fill(0.2)],
        cacheHits:        0,
        cacheMisses:      2,
        tokensUsed:       20,
        estimatedCostUsd: 0.0000004,
    }),
    toVectorLiteral: jest.fn().mockReturnValue('[0.1,0.2]'),
};

const mockConfig = { get: jest.fn((k: string, d?: unknown) => d ?? k) };
const mockEvents = { emit: jest.fn() };

//  Tests

describe('DocumentProcessorService', () => {
    let service: DocumentProcessorService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [
            DocumentProcessorService,
            { provide: PrismaService,            useValue: mockPrisma    },
            { provide: DocumentExtractorService, useValue: mockExtractor },
            { provide: ChunkerService,           useValue: mockChunker   },
            { provide: EmbeddingService,         useValue: mockEmbedding },
            { provide: ConfigService,            useValue: mockConfig    },
            { provide: EventEmitter2,            useValue: mockEvents    },
        ],
        }).compile();

        service = module.get<DocumentProcessorService>(DocumentProcessorService);

        // Bypass real Redis/BullMQ initialisation
        (service as any).queue = {
        add:     jest.fn().mockResolvedValue({ id: 'job-1' }),
        getJobs: jest.fn().mockResolvedValue([]),
        close:   jest.fn(),
        };
        (service as any).worker = { on: jest.fn(), close: jest.fn() };

        jest.clearAllMocks();
    });

    //  enqueue

    describe('enqueue', () => {
        it('adds a job to the queue and returns its ID', async () => {
        const jobId = await service.enqueue('doc-1', 'user-1', 'corr-1');

        expect(jobId).toBe('job-1');
        expect((service as any).queue.add).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ documentId: 'doc-1', userId: 'user-1', correlationId: 'corr-1' }),
        );
        });
    });

    // processDocument — happy path 

    describe('processDocument — happy path', () => {
        beforeEach(() => {
        mockPrisma.document.findUniqueOrThrow.mockResolvedValue({
            id: 'doc-1', filename: 'test.txt', content: 'Sample text.', userId: 'user-1',
        });
        mockPrisma.chunk.findMany.mockResolvedValue([{ id: 'chunk-1' }, { id: 'chunk-2' }]);
        mockPrisma.document.update.mockResolvedValue({});
        mockPrisma.chunk.deleteMany.mockResolvedValue({});
        mockPrisma.chunk.createMany.mockResolvedValue({});
        mockPrisma.ingestionMetric.create.mockResolvedValue({});
        mockPrisma.$executeRaw.mockResolvedValue(1);
        });

        it('marks document as processing then ready', async () => {
        await (service as any).processDocument(mockJob);

        const statuses = mockPrisma.document.update.mock.calls.map((c: any) => c[0].data.status);
        expect(statuses).toContain('processing');
        expect(statuses).toContain('ready');
        });

        it('reports progress through all pipeline stages', async () => {
        await (service as any).processDocument(mockJob);

        const progressValues = mockJob.updateProgress.mock.calls.map((c: unknown[]) => c[0]);
        expect(progressValues).toContain(PROGRESS.STARTED);
        expect(progressValues).toContain(PROGRESS.TEXT_EXTRACTED);
        expect(progressValues).toContain(PROGRESS.CHUNKED);
        expect(progressValues).toContain(PROGRESS.CHUNKS_STORED);
        expect(progressValues).toContain(PROGRESS.EMBEDDINGS_DONE);
        expect(progressValues).toContain(PROGRESS.VECTORS_STORED);
        expect(progressValues).toContain(PROGRESS.COMPLETE);
        });

        it('calls extractor with document content and filename', async () => {
        await (service as any).processDocument(mockJob);
        expect(mockExtractor.extract).toHaveBeenCalledWith('Sample text.', 'test.txt');
        });

        it('deletes existing chunks before creating new ones (idempotent)', async () => {
        await (service as any).processDocument(mockJob);
        expect(mockPrisma.chunk.deleteMany).toHaveBeenCalledWith({ where: { documentId: 'doc-1' } });
        expect(mockPrisma.chunk.createMany).toHaveBeenCalled();
        });

        it('calls embedBatch with all chunk texts', async () => {
        await (service as any).processDocument(mockJob);
        expect(mockEmbedding.embedBatch).toHaveBeenCalledWith(
            ['Chunk one.', 'Chunk two.'],
            expect.objectContaining({ documentId: 'doc-1', userId: 'user-1' }),
        );
        });

        it('persists ingestion metrics including pageCount', async () => {
        await (service as any).processDocument(mockJob);
        expect(mockPrisma.ingestionMetric.create).toHaveBeenCalledWith(
            expect.objectContaining({
            data: expect.objectContaining({
                documentId:  'doc-1',
                userId:      'user-1',
                format:      'text',
                chunkCount:  2,
                pageCount:   1,           // now verified — not undefined
                cacheHits:   0,
                cacheMisses: 2,
            }),
            }),
        );
        });

        it('emits document.ingested event with correct payload', async () => {
        await (service as any).processDocument(mockJob);
        expect(mockEvents.emit).toHaveBeenCalledWith(
            'document.ingested',
            expect.objectContaining({
            documentId:    'doc-1',
            userId:        'user-1',
            correlationId: 'corr-1',
            chunkCount:    2,
            }),
        );
        });

        it('returns chunkCount and a non-negative durationMs', async () => {
        const result = await (service as any).processDocument(mockJob);
        expect(result.chunkCount).toBe(2);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('clears the document error field when marking ready', async () => {
        await (service as any).processDocument(mockJob);
        const readyCall = mockPrisma.document.update.mock.calls.find(
            (c: any) => c[0].data.status === 'ready',
        );
        expect(readyCall[0].data.error).toBeNull();
        });
    });

    // ── processDocument — failure handling ────────────────────────────────────

    describe('processDocument — failure handling', () => {
        beforeEach(() => {
        mockPrisma.document.update.mockResolvedValue({});
        });

        it('marks document as failed only on the last attempt', async () => {
        mockPrisma.document.findUniqueOrThrow.mockRejectedValue(new Error('DB error'));
        const lastAttemptJob = { ...mockJob, attemptsMade: 2, opts: { attempts: 3 } };

        await expect(
            (service as any).processDocument(lastAttemptJob),
        ).rejects.toThrow('DB error');

        const failedCall = mockPrisma.document.update.mock.calls.find(
            (c: any) => c[0].data.status === 'failed',
        );
        expect(failedCall).toBeDefined();
        expect(failedCall[0].data.error).toBe('DB error');
        });

        it('does NOT mark as failed on first attempt (retry will follow)', async () => {
        mockPrisma.document.findUniqueOrThrow.mockRejectedValue(new Error('Transient'));
        const firstAttemptJob = { ...mockJob, attemptsMade: 0, opts: { attempts: 3 } };

        await expect(
            (service as any).processDocument(firstAttemptJob),
        ).rejects.toThrow('Transient');

        const failedCall = mockPrisma.document.update.mock.calls.find(
            (c: any) => c[0].data.status === 'failed',
        );
        expect(failedCall).toBeUndefined();
        });

        it('re-throws the error so BullMQ can retry', async () => {
        mockPrisma.document.findUniqueOrThrow.mockRejectedValue(new Error('Boom'));

        await expect(
            (service as any).processDocument(mockJob),
        ).rejects.toThrow('Boom');
        });

        it('emits document.ingestion.failed event on last attempt', async () => {
        mockPrisma.document.findUniqueOrThrow.mockRejectedValue(new Error('Fatal'));
        const lastAttemptJob = { ...mockJob, attemptsMade: 2, opts: { attempts: 3 } };

        await expect(
            (service as any).processDocument(lastAttemptJob),
        ).rejects.toThrow('Fatal');

        expect(mockEvents.emit).toHaveBeenCalledWith(
            'document.ingestion.failed',
            expect.objectContaining({ documentId: 'doc-1', correlationId: 'corr-1' }),
        );
        });

        it('does NOT emit ingestion.failed event on non-final attempts', async () => {
        mockPrisma.document.findUniqueOrThrow.mockRejectedValue(new Error('Transient'));
        const firstAttemptJob = { ...mockJob, attemptsMade: 0, opts: { attempts: 3 } };

        await expect(
            (service as any).processDocument(firstAttemptJob),
        ).rejects.toThrow();

        const failedEmit = mockEvents.emit.mock.calls.find(
            (c: any) => c[0] === 'document.ingestion.failed',
        );
        expect(failedEmit).toBeUndefined();
        });
    });

    // ── PROGRESS constants ─────────────────────────────────────────────────────

    describe('PROGRESS constants', () => {
        it('are monotonically increasing from 5 to 100', () => {
        const values = Object.values(PROGRESS);
        for (let i = 1; i < values.length; i++) {
            expect(values[i]).toBeGreaterThan(values[i - 1]);
        }
        expect(values[0]).toBe(5);
        expect(values[values.length - 1]).toBe(100);
        });

        it('contains all expected stage keys', () => {
        expect(PROGRESS).toMatchObject({
            STARTED:          expect.any(Number),
            TEXT_EXTRACTED:   expect.any(Number),
            CHUNKED:          expect.any(Number),
            CHUNKS_STORED:    expect.any(Number),
            EMBEDDINGS_DONE:  expect.any(Number),
            VECTORS_STORED:   expect.any(Number),
            COMPLETE:         expect.any(Number),
        });
        });
    });
});