// src/modules/jobs/jobs.module.ts
//
// WHY IS THE WORKER IN ITS OWN MODULE?
// The document processor wires together all the other pipeline services
// (extractor, chunker, embedding) and owns the BullMQ queue + worker lifecycle.
// Keeping it in a dedicated module means you can run the worker as a completely
// separate Node process in production (just import JobsModule in a worker.ts
// entry point) without carrying the HTTP layer with it.

import { Module } from '@nestjs/common';
import { DocumentProcessorService } from './document-processor.service';
import { IngestionModule } from '../ingestion/ingestion.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { PrismaService } from '../../database/prisma.service';

@Module({
  imports:   [IngestionModule, EmbeddingModule],
  providers: [DocumentProcessorService, PrismaService],
  exports:   [DocumentProcessorService],
})
export class JobsModule {}
