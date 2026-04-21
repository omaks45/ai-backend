import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../database/prisma.service';
import { RbacModule } from '../rbac/rbac.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [RbacModule, JobsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, PrismaService],
  exports: [DocumentsService],
})
export class DocumentsModule {}