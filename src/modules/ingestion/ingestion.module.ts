
// WHY GROUP EXTRACTOR + CHUNKER + EVENTS TOGETHER?
// These three services form the "Extract-Transform" half of the ETL pipeline.
// They have no external dependencies beyond Prisma, so they are cheap to test
// in isolation. Grouping them makes the pipeline boundary visible in the code.

import { Module } from '@nestjs/common';
import { DocumentExtractorService } from './document-extractor.service';
import { ChunkerService } from './chunker.service';
import { IngestionEventsListener } from './ingestion-events.listener';
import { PrismaService } from '../../database/prisma.service';

@Module({
  providers: [
    DocumentExtractorService,
    ChunkerService,
    IngestionEventsListener,
    PrismaService,
  ],
  exports: [DocumentExtractorService, ChunkerService],
})
export class IngestionModule {}
