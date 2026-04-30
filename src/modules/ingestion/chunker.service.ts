// src/modules/ingestion/ingestion-events.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

interface DocumentIngestedPayload {
    documentId:    string;
    userId:        string;
    correlationId: string;
    chunkCount:    number;
    durationMs:    number;
    format:        string;
    pageCount?:    number;
}

interface EmbeddingGeneratedPayload {
    userId?:          string;
    documentId?:      string;
    model:            string;
    tokensUsed:       number;
    estimatedCostUsd: number;
    cacheHits:        number;
    cacheMisses:      number;
}

@Injectable()
export class IngestionEventsListener {
    private readonly logger = new Logger(IngestionEventsListener.name);

    constructor(private readonly prisma: PrismaService) {}

    @OnEvent('document.ingested')
    async onDocumentIngested(payload: DocumentIngestedPayload) {
        try {
        await this.prisma.usageLog.create({
            data: {
            userId:  payload.userId,
            action:  'document_ingested',
            tokens:  0,
            costUsd: 0,
            metadata: {
                documentId:    payload.documentId,
                chunkCount:    payload.chunkCount,
                durationMs:    payload.durationMs,
                format:        payload.format,
                pageCount:     payload.pageCount,
                correlationId: payload.correlationId,
            },
            },
        });

        this.logger.log('Ingestion logged', {
            documentId: payload.documentId,
            chunkCount: payload.chunkCount,
            durationMs: payload.durationMs,
        });
        } catch (err) {
        // Side-effect failure must not crash the pipeline
        this.logger.error('Failed to log document.ingested', err);
        }
    }

    @OnEvent('ai.embedding.generated')
    async onEmbeddingGenerated(payload: EmbeddingGeneratedPayload) {
        if (!payload.userId) return; // Anonymous context — skip

        try {
        await this.prisma.usageLog.create({
            data: {
            userId:  payload.userId,
            action:  'embedding_generated',
            tokens:  payload.tokensUsed,
            costUsd: payload.estimatedCostUsd,
            metadata: {
                documentId:      payload.documentId,
                model:           payload.model,
                cacheHits:       payload.cacheHits,
                cacheMisses:     payload.cacheMisses,
            },
            },
        });
        } catch (err) {
        this.logger.error('Failed to log ai.embedding.generated', err);
        }
    }

    @OnEvent('document.ingestion.failed')
    async onIngestionFailed(payload: { documentId: string; userId: string }) {
        try {
        await this.prisma.usageLog.create({
            data: {
            userId:  payload.userId,
            action:  'document_ingestion_failed',
            tokens:  0,
            costUsd: 0,
            metadata: { documentId: payload.documentId },
            },
        });
        } catch (err) {
        this.logger.error('Failed to log ingestion failure', err);
        }
    }
}
