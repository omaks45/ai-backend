import { Module } from '@nestjs/common';
import { DocumentProcessorService } from './document-processor.service';
import { PrismaService } from '../../database/prisma.service';

@Module({
  providers: [DocumentProcessorService, PrismaService],
  exports: [DocumentProcessorService],
})
export class JobsModule {}