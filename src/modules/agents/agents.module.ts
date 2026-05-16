import { Module }              from '@nestjs/common';
import { HttpModule }          from '@nestjs/axios';
import { AgentController }     from './agents.controller';
import { AgentExecutorService }  from './agent-executor.service';
import { AgentMetricsService }   from './services/agent-metrics.service';
import { AgentEventsListener }   from './agent-events.listener';
import { SearchModule }          from '../search/search.module';
import { DocumentsModule }       from '../documents/documents.module';

// ─────────────────────────────────────────────────────────────────────────────
// AgentModule
//
// Wires the agent controller, executor, metrics, and event listener.
// Follows the same structure as RagModule, SearchModule, etc.
//
// HttpModule    — provides HttpService for OpenAI/Ollama LLM calls
// SearchModule  — provides SearchService for the search_documents tool
// DocumentsModule — provides DocumentsService for getAvailableDocs + summaries
//
// AgentMetricsService uses its own private Prometheus Registry to avoid
// metric name collisions with MetricsService. The /metrics endpoint in
// MetricsController should be updated to merge both registries:
//
//   const [main, agent] = await Promise.all([
//     this.metrics.getMetrics(),
//     this.agentMetrics.getMetrics(),
//   ]);
//   res.set('Content-Type', this.metrics.getContentType());
//   res.send(main + '\n' + agent);
// ─────────────────────────────────────────────────────────────────────────────

@Module({
  imports: [
    HttpModule,       // provides HttpService → injected into AgentExecutorService
    SearchModule,     // provides SearchService → injected into AgentExecutorService
    DocumentsModule,  // provides DocumentsService → injected into AgentController
  ],
  controllers: [AgentController],
  providers: [
    AgentExecutorService,
    AgentMetricsService,
    AgentEventsListener,
  ],
  exports: [
    AgentExecutorService,  // exported in case ConversationsModule ever delegates to it
    AgentMetricsService,   // exported so MetricsController can merge the registry
  ],
})
export class AgentModule {}