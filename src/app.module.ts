import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auths/auths.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ConversationsModule } from './modules/conversation/conversations.module';
import { AdminModule } from './modules/admin/admin.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';
import { AuthEventsListener } from './modules/events/auth.events';
import { DocumentEventsListener } from './modules/events/document.events';
import { EmbeddingModule } from './modules/embedding/embedding.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { CacheModule } from './modules/cache/cache.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    EventEmitterModule.forRoot({ maxListeners: 30 }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
    CacheModule,
    DocumentsModule,
    ConversationsModule,
    AdminModule,
    JobsModule,
    EmbeddingModule,  // OpenAI embeddings + caching
    IngestionModule,  // Text extraction + chunking + event listeners
    JobsModule,       // BullMQ worker + queue
  ],
  providers: [
    PrismaService,
    RedisService,
    AuthEventsListener,
    DocumentEventsListener,
  ],
})
export class AppModule {}