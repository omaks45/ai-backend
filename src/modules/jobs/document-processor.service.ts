import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../database/prisma.service';
import { splitIntoChunks, estimateTokens } from './chunker.util';

export interface DocumentJobData {
    documentId: string;
    userId: string;
    queuedAt: number;
}

@Injectable()
export class DocumentProcessorService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DocumentProcessorService.name);
    private connection!: IORedis;
    private queue!: Queue;
    private worker!: Worker;

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
        private readonly events: EventEmitter2,
    ) {}

    onModuleInit() {
        this.connection = new IORedis({
        host: this.config.get('REDIS_HOST', 'localhost'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        maxRetriesPerRequest: null, // Required by BullMQ
        });

        this.queue = new Queue('document-processing', {
        connection: this.connection,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { count: 200 },
            removeOnFail: { count: 500 },
        },
        });

        this.worker = new Worker(
        'document-processing',
        (job) => this.processDocument(job),
        { connection: this.connection, concurrency: 3 },
        );

        this.worker.on('completed', (job) =>
        this.logger.log(`Job ${job.id} completed — ${job.returnvalue?.chunks} chunks`),
        );

        this.worker.on('failed', (job, err) =>
        this.logger.error(`Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
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

    async enqueue(documentId: string, userId: string): Promise<string> {
        const job = await this.queue.add(
        'process-document',
        { documentId, userId, queuedAt: Date.now() } satisfies DocumentJobData,
        );
        return job.id!;
    }

    async getJobProgress(documentId: string) {
        const jobs = await this.queue.getJobs(['active', 'waiting']);
        const job = jobs.find((j) => j.data.documentId === documentId);
        return job ? job.progress : null;
    }

    private async processDocument(job: Job<DocumentJobData>) {
        const { documentId, userId } = job.data;
        this.logger.log(`Processing ${documentId} (attempt ${job.attemptsMade + 1})`);

        const doc = await this.prisma.document.findUniqueOrThrow({
        where: { id: documentId },
        });

        await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'processing' },
        });

        await job.updateProgress(10);

        try {
        const chunks = splitIntoChunks(doc.content, 500);
        await job.updateProgress(40);

        await this.prisma.$transaction(async (tx) => {
            // Idempotent — safe to retry
            await tx.chunk.deleteMany({ where: { documentId } });

            await tx.chunk.createMany({
            data: chunks.map((text, index) => ({
                documentId,
                index,
                content: text,
                tokenCount: estimateTokens(text),
            })),
            });

            await tx.document.update({
            where: { id: documentId },
            data: { status: 'ready', chunkCount: chunks.length },
            });
        });

        await job.updateProgress(100);

        this.events.emit('document.processed', { documentId, userId, chunkCount: chunks.length });

        return { success: true, chunks: chunks.length };
        } catch (error) {
        // Only mark failed on last attempt — keep retrying while attempts remain
        const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3) - 1;
        if (isLastAttempt) {
            await this.prisma.document.update({
            where: { id: documentId },
            data: { status: 'failed', error: (error as Error).message },
            });
        }
        throw error; // Re-throw so BullMQ retries
        }
    }
}