
import {
    Injectable, Logger,
    OnModuleInit, OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../database/prisma.service';
import { DocumentExtractorService } from '../ingestion/document-extractor.service';
import { ChunkerService } from '../ingestion/chunker.service';
import { EmbeddingService } from '../embedding/embedding.service';

// Job data contract

export interface DocumentJobData {
    documentId:    string;
    userId:        string;
    correlationId: string;
    queuedAt:      number;
}

// Progress stages (for frontend polling)

export const PROGRESS = {
    STARTED:           5,
    TEXT_EXTRACTED:   15,
    CHUNKED:          30,
    CHUNKS_STORED:    50,
    EMBEDDINGS_DONE:  85,
    VECTORS_STORED:   95,
    COMPLETE:        100,
} as const;

const QUEUE_NAME   = 'document-processing';
const MAX_ATTEMPTS = 3;

@Injectable()
export class DocumentProcessorService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DocumentProcessorService.name);
    private connection!: IORedis;
    private queue!: Queue;
    private worker!: Worker;

    constructor(
        private readonly prisma:     PrismaService,
        private readonly extractor:  DocumentExtractorService,
        private readonly chunker:    ChunkerService,
        private readonly embedding:  EmbeddingService,
        private readonly config:     ConfigService,
        private readonly events:     EventEmitter2,
    ) {}

    // ── Module lifecycle ───────────────────────────────────────────────────────

    onModuleInit() {
        this.connection = new IORedis({
        host: this.config.get('REDIS_HOST', 'localhost'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        maxRetriesPerRequest: null, // Required by BullMQ
        });

        this.queue = new Queue(QUEUE_NAME, {
        connection: this.connection,
        defaultJobOptions: {
            attempts: MAX_ATTEMPTS,
            backoff: { type: 'exponential', delay: 2_000 },
            removeOnComplete: { count: 200 },
            removeOnFail:     { count: 500 },
        },
        });

        this.worker = new Worker(
        QUEUE_NAME,
        (job) => this.processDocument(job),
        { connection: this.connection, concurrency: 3 },
        );

        this.worker.on('completed', (job) =>
        this.logger.log('Job completed', {
            jobId: job.id,
            chunks: job.returnvalue?.chunkCount,
            durationMs: job.returnvalue?.durationMs,
        }),
        );

        this.worker.on('failed', (job, err) =>
        this.logger.error('Job failed', {
            jobId: job?.id,
            attempt: job?.attemptsMade,
            error: err.message,
        }),
        );

        this.worker.on('error', (err) =>
        this.logger.error('Worker error', err),
        );
    }

    async onModuleDestroy() {
        await this.worker?.close();
        await this.queue?.close();
        await this.connection?.quit();
    }

    // ── Public: enqueue a document ─────────────────────────────────────────────

    async enqueue(
        documentId:    string,
        userId:        string,
        correlationId: string,
    ): Promise<string> {
        const job = await this.queue.add(QUEUE_NAME, {
        documentId,
        userId,
        correlationId,
        queuedAt: Date.now(),
        } satisfies DocumentJobData);

        this.logger.log('Document queued', { jobId: job.id, documentId, correlationId });
        return job.id!;
    }

    async getJobProgress(documentId: string): Promise<number | null> {
        const jobs = await this.queue.getJobs(['active', 'waiting']);
        const job  = jobs.find((j) => j.data.documentId === documentId);
        return job ? (job.progress as number) : null;
    }

    // ── Core pipeline ──────────────────────────────────────────────────────────

    private async processDocument(job: Job<DocumentJobData>): Promise<{
        chunkCount: number;
        durationMs: number;
    }> {
        const { documentId, userId, correlationId } = job.data;
        const startTime = Date.now();
        const log = (msg: string, meta?: object) =>
        this.logger.log(msg, { correlationId, documentId, ...meta });

        log('Processing started', { attempt: job.attemptsMade + 1 });

        await this.prisma.document.update({
        where: { id: documentId },
        data:  { status: 'processing' },
        });
        await job.updateProgress(PROGRESS.STARTED);

        try {
        // ── Step 1: Fetch document ───────────────────────────────────────────
        const doc = await this.prisma.document.findUniqueOrThrow({
            where: { id: documentId },
        });

        // ── Step 2: Extract text ─────────────────────────────────────────────
        const extraction = await this.extractor.extract(doc.content, doc.filename);
        log('Text extracted', { format: extraction.format, chars: extraction.characterCount });
        await job.updateProgress(PROGRESS.TEXT_EXTRACTED);

        // ── Step 3: Chunk ────────────────────────────────────────────────────
        const chunks = this.chunker.chunk(extraction.text, {
            maxTokens:    500,
            overlapTokens: 50,
            minTokens:     50,
        });
        const stats = this.chunker.computeStats(chunks);
        log('Document chunked', stats);
        await job.updateProgress(PROGRESS.CHUNKED);

        // ── Step 4: Persist chunks (idempotent — delete old first) ───────────
        await this.prisma.$transaction(async (tx) => {
            await tx.chunk.deleteMany({ where: { documentId } });
            await tx.chunk.createMany({
            data: chunks.map((c) => ({
                documentId,
                index:      c.index,
                content:    c.text,
                tokenCount: c.tokenEstimate,
                startChar:  c.startChar,
                endChar:    c.endChar,
            })),
            });
        });
        await job.updateProgress(PROGRESS.CHUNKS_STORED);

        // ── Step 5: Generate embeddings (cached + batched) ───────────────────
        const batchResult = await this.embedding.embedBatch(
            chunks.map((c) => c.text),
            { userId, documentId },
        );
        log('Embeddings generated', {
            cacheHits:   batchResult.cacheHits,
            cacheMisses: batchResult.cacheMisses,
            tokensUsed:  batchResult.tokensUsed,
            costUsd:     batchResult.estimatedCostUsd,
        });
        await job.updateProgress(PROGRESS.EMBEDDINGS_DONE);

        // ── Step 6: Store vectors in pgvector ─────────────────────────────────
        const storedChunks = await this.prisma.chunk.findMany({
            where:   { documentId },
            orderBy: { index: 'asc' },
            select:  { id: true },
        });

        await this.prisma.$transaction(
            storedChunks.map((chunk, i) => {
            const vectorStr = this.embedding.toVectorLiteral(batchResult.embeddings[i]);
            return this.prisma.$executeRaw`
                UPDATE "Chunk"
                SET embedding = ${vectorStr}::vector
                WHERE id = ${chunk.id}
            `;
            }),
        );
        await job.updateProgress(PROGRESS.VECTORS_STORED);

        // ── Step 7: Mark ready ────────────────────────────────────────────────
        await this.prisma.document.update({
            where: { id: documentId },
            data:  { status: 'ready', chunkCount: chunks.length, error: null },
        });
        await job.updateProgress(PROGRESS.COMPLETE);

        const durationMs = Date.now() - startTime;

        // ── Step 8: Persist ingestion metrics ─────────────────────────────────
        await this.prisma.ingestionMetric.create({
            data: {
            documentId,
            userId,
            format:           extraction.format,
            chunkCount:       chunks.length,
            totalTokens:      stats.totalTokens,
            embeddingTokens:  batchResult.tokensUsed,
            embeddingCostUsd: batchResult.estimatedCostUsd,
            durationMs,
            pageCount:        extraction.pageCount,
            cacheHits:        batchResult.cacheHits,
            cacheMisses:      batchResult.cacheMisses,
            },
        });

        // ── Step 9: Emit completion event ─────────────────────────────────────
        this.events.emit('document.ingested', {
            documentId,
            userId,
            correlationId,
            chunkCount:  chunks.length,
            durationMs,
            format:      extraction.format,
            pageCount:   extraction.pageCount,
        });

        log('Processing complete', { chunkCount: chunks.length, durationMs });
        return { chunkCount: chunks.length, durationMs };

        } catch (error) {
        // Only mark as permanently failed on last attempt
        const isLastAttempt = job.attemptsMade >= MAX_ATTEMPTS - 1;
        if (isLastAttempt) {
            await this.prisma.document.update({
            where: { id: documentId },
            data:  { status: 'failed', error: (error as Error).message },
            });
            this.events.emit('document.ingestion.failed', { documentId, userId, correlationId });
        }

        this.logger.error('Processing failed', {
            correlationId, documentId,
            error:   (error as Error).message,
            attempt: job.attemptsMade + 1,
            final:   isLastAttempt,
        });

        throw error; // Let BullMQ handle retry
        }
    }
}
