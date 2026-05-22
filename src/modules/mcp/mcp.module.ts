import { Module }          from '@nestjs/common';
import { McpController }   from './mcp.controller';
import { McpService }      from './services/mcp.service';
import { PromptService }   from './services/prompt.service';
import { RouterService }   from './services/router.service';
import { BudgetService }   from './services/budget.service';
import { AuditService }    from './services/audit.service';
import { RbacModule }      from '../rbac/rbac.module';

// ─────────────────────────────────────────────────────────────────────────────
// McpModule
//
// Registers all five MCP services so NestJS DI can resolve them.
// Without all providers listed here, McpService cannot inject its
// constructor dependencies (PromptService, RouterService, etc.).
//
// RbacModule is imported so PermissionsGuard on McpController can
// resolve RbacService — same pattern as AgentModule and ConversationsModule.
// ─────────────────────────────────────────────────────────────────────────────

@Module({
  imports:     [RbacModule],
  controllers: [McpController],
  providers:   [
    McpService,       // orchestrates the 6-step pipeline
    PromptService,    // DB-backed prompt versioning with Redis cache
    RouterService,    // model routing + fallback chains
    BudgetService,    // per-user cost governance
    AuditService,     // AI audit logging
  ],
  exports: [
    McpService,       // RagModule + AgentModule call mcp.complete()
  ],
})
export class McpModule {}