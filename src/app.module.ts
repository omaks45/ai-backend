import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule }       from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule }    from '@nestjs/throttler';
import { CacheModule }             from './modules/cache/cache.module';
import { AuthModule }              from './modules/auths/auths.module';
import { DocumentsModule }         from './modules/documents/documents.module';
import { ConversationsModule }     from './modules/conversation/conversations.module';
import { AdminModule }             from './modules/admin/admin.module';
import { EmbeddingModule }         from './modules/embedding/embedding.module';
import { IngestionModule }         from './modules/ingestion/ingestion.module';
import { JobsModule }              from './modules/jobs/jobs.module';
import { SearchModule }            from './modules/search/search.module';
import { McpModule }               from './modules/mcp/mcp.module';
import { RagModule }               from './modules/rag/rag.module';
import { AgentModule }             from './modules/agents/agents.module';
import { AuthEventsListener }      from './modules/events/auth.events';
import { DocumentEventsListener }  from './modules/events/document.events';
import { SanitizeMiddleware }       from './common/middleware/sanitize.middleware';
import { RequestLoggerMiddleware }  from './common/middleware/request-logger.middleware';
import { AbuseDetectionMiddleware } from './common/middleware/abuse-detection.middleware';
import { MetricsMiddleware }        from './common/middleware/metrics.middleware';
import { HealthModule }   from './modules/health/health.module';
import { SecurityModule } from './modules/security/security.module';
import { LoggerModule }   from './modules/logger/logger.module';
import { MetricsModule }  from './modules/metrics/metrics.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    EventEmitterModule.forRoot({ maxListeners: 30 }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule, CacheModule, LoggerModule,
    MetricsModule, HealthModule, SecurityModule,
    AuthModule, DocumentsModule, ConversationsModule, AdminModule,
    EmbeddingModule, IngestionModule, JobsModule, SearchModule,
    McpModule,   // must come before RagModule + AgentModule
    RagModule,
    AgentModule,
  ],
  providers: [AuthEventsListener, DocumentEventsListener],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SanitizeMiddleware, RequestLoggerMiddleware, MetricsMiddleware, AbuseDetectionMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}