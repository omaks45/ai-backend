import { Module }              from '@nestjs/common';
import { HttpModule }          from '@nestjs/axios';
import { AgentController }     from './agents.controller';
import { AgentExecutorService }  from './agent-executor.service';
import { AgentMetricsService }   from '../agents/services/agent-metrics.service';
import { AgentEventsListener }   from '../agents/agent-events.listener';
import { SearchModule }          from '../search/search.module';
import { DocumentsModule }       from '../documents/documents.module';
import { RbacModule }            from '../rbac/rbac.module';

// ─────────────────────────────────────────────────────────────────────────────
// AgentModule
//
// HttpModule     — HttpService for OpenAI/Ollama LLM calls
// SearchModule   — SearchService for the search_documents tool
// DocumentsModule — DocumentsService for document list + summaries
// RbacModule     — RbacService required by PermissionsGuard on AgentController
//
// Why RbacModule is needed here:
// AgentController uses @UseGuards(PermissionsGuard). PermissionsGuard injects
// RbacService to check the user's permissions. NestJS resolves guard
// dependencies from the host module's context — so every module whose
// controller uses PermissionsGuard must import RbacModule.
// ConversationsModule, DocumentsModule etc. all do the same.
// ─────────────────────────────────────────────────────────────────────────────

@Module({
  imports: [
    HttpModule,      // HttpService → AgentExecutorService
    SearchModule,    // SearchService → AgentExecutorService (ToolContext)
    DocumentsModule, // DocumentsService → AgentController + AgentExecutorService (ToolContext)
    RbacModule,      // RbacService → PermissionsGuard on AgentController
  ],
  controllers: [AgentController],
  providers: [
    AgentExecutorService,
    AgentMetricsService,
    AgentEventsListener,
  ],
  exports: [
    AgentExecutorService,
    AgentMetricsService,
  ],
})
export class AgentModule {}