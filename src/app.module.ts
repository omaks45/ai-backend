// src/app.module.ts
//
// ROOT MODULE — HOW EVERYTHING CONNECTS
//
// MODULE DEPENDENCY TREE:
//
//  AppModule
//  ├── ConfigModule (global)         — env vars available everywhere
//  ├── EventEmitterModule (global)   — event bus available everywhere
//  ├── ThrottlerModule               — base rate limit guard
//  ├── CacheModule (global)          — Redis cache available everywhere
//  ├── AuthModule                    — register, login, refresh, logout
//  ├── DocumentsModule               — CRUD + soft delete
//  │   └── JobsModule                — BullMQ worker (enqueue on upload)
//  │       └── IngestionModule       — extractor + chunker
//  ├── EmbeddingModule               — provider-switching (Ollama dev / OpenAI prod)
//  ├── SearchModule                  — pgvector semantic search
//  ├── RagModule                     — context assembler + LLM generation
//  ├── ConversationsModule           — messages + RAG pipeline
//  └── AdminModule                   — role management
//
// PROVIDER SWITCHING (embedding + RAG):
//   EMBEDDING_PROVIDER=ollama → nomic-embed-text (768-dim), llama3.2 chat
//   EMBEDDING_PROVIDER=openai → text-embedding-3-small (1536-dim), gpt-4o chat
//   Controlled entirely by .env — no code changes needed when deploying.

import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule }       from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule }    from '@nestjs/throttler';

// Infrastructure modules
import { CacheModule }  from './modules/cache/cache.module';

// Feature modules 
import { AuthModule }          from './modules/auths/auths.module';
import { DocumentsModule }     from './modules/documents/documents.module';
import { ConversationsModule } from './modules/conversation/conversations.module';
import { AdminModule }         from './modules/admin/admin.module';

//AI pipeline modules
import { EmbeddingModule } from './modules/embedding/embedding.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { JobsModule }      from './modules/jobs/jobs.module';
import { SearchModule }    from './modules/search/search.module';
import { RagModule }       from './modules/rag/rag.module';

//  Event listeners
import { AuthEventsListener }     from './modules/events/auth.events';
import { DocumentEventsListener } from './modules/events/document.events';
import { SanitizeMiddleware } from './common/middleware/sanitize.middleware';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { AbuseDetectionMiddleware } from './common/middleware/abuse-detection.middleware';
import { MetricsService } from './common/middleware/metrics.middleware';
import { HealthModule } from './modules/health/health.module';
import { SecurityModule } from './modules/security/security.module';
import { LoggerModule } from './modules/logger/logger.module';

@Module({
  imports: [
    //  Global infrastructure
    // ConfigModule.isGlobal — ConfigService injectable in every module
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    // EventEmitterModule — emit/listen to domain events across modules
    EventEmitterModule.forRoot({ maxListeners: 30 }),

    // Base throttle guard (overridden per-route by specific limiters in main.ts)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    // CacheModule is @Global() — Redis cache injectable everywhere without re-importing
    CacheModule,
    LoggerModule,  // @Global() — Winston logger everywhere

    // Observability
    MetricsService, // Prometheus metrics for HTTP requests, queue jobs, embedding ops
    HealthModule,
    SecurityModule,

    // Feature modules
    AuthModule,           // register, login, refresh, logout, RBAC
    DocumentsModule,      // document CRUD + soft delete
    ConversationsModule,  // conversation + message management + RAG orchestration
    AdminModule,          // role and permission management

    //  AI pipeline
    // Order matters for readability — ingestion feeds search feeds RAG

    // Provider-switching embeddings:
    //   EMBEDDING_PROVIDER=ollama → nomic-embed-text (768-dim vectors)
    //   EMBEDDING_PROVIDER=openai → text-embedding-3-small (1536-dim vectors)
    EmbeddingModule,

    // Text extraction (PDF/markdown/plain text) → chunker → embed → store vectors
    IngestionModule,

    // BullMQ workers — dequeues document upload jobs and triggers ingestion
    JobsModule,

    // pgvector semantic search — cosine similarity over Chunk.embedding
    // Reads EmbeddingService.dimensions to cast ::vector(768) or ::vector(1536)
    SearchModule,

    // Context assembler + LLM generation (Ollama local or OpenAI GPT-4o)
    // Wired together in ConversationsModule but declared here for visibility
    RagModule,
  ],

  providers: [
    AuthEventsListener,
    DocumentEventsListener,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        SanitizeMiddleware,       // strip XSS from body/query/params
        RequestLoggerMiddleware,  // correlationId + structured logging
        MetricsService,        // Prometheus HTTP metrics
        AbuseDetectionMiddleware, // scraping pattern detection
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}