import { Injectable, Logger } from '@nestjs/common';
import { OnEvent }             from '@nestjs/event-emitter';
import { PrismaService }       from '../../database/prisma.service';
import { TerminationReason }   from '../agents/tools/tool.types';

// ─────────────────────────────────────────────────────────────────────────────
// AgentEventsListener
//
// Mirrors the pattern in document.events.ts and auth.events.ts.
// Listens for 'agent:completed' and persists a UsageLog row so:
//   - The admin dashboard can show per-user agent costs
//   - Finance can reconcile OpenAI spend by user
//   - On-call can pull the full trace via correlationId when debugging
//
// The listener is decoupled from the executor — if logging fails the agent
// result is already returned to the caller.
// ─────────────────────────────────────────────────────────────────────────────

    interface AgentCompletedPayload {
    userId:            string;
    correlationId:     string;
    iterations:        number;
    totalCostUsd:      number;
    terminationReason: TerminationReason;
    toolsUsed:         (string | undefined)[];
    durationMs:        number;
}

@Injectable()
export class AgentEventsListener {
    private readonly logger = new Logger(AgentEventsListener.name);

    constructor(private readonly prisma: PrismaService) {}

    @OnEvent('agent:completed', { async: true })
    async handleAgentCompleted(payload: AgentCompletedPayload): Promise<void> {
        try {
        await this.prisma.usageLog.create({
            data: {
            userId:   payload.userId,
            action:   'agent_run',
            // UsageLog.tokens is Int (non-nullable) in the Prisma schema.
            // Agent runs track cost in costUsd; exact token counts live in
            // the metadata JSON. Store 0 here so the schema constraint is met.
            tokens:   0,
            costUsd:  payload.totalCostUsd,
            metadata: JSON.stringify({
                correlationId:     payload.correlationId,
                iterations:        payload.iterations,
                terminationReason: payload.terminationReason,
                toolsUsed:         payload.toolsUsed.filter(Boolean),
                durationMs:        payload.durationMs,
            }),
            },
        });

        this.logger.debug('Agent run logged to UsageLog', {
            correlationId: payload.correlationId,
            costUsd:       payload.totalCostUsd,
            iterations:    payload.iterations,
        });
        } catch (err) {
        // Never let logging errors surface to the user.
        this.logger.error('Failed to persist agent UsageLog', {
            correlationId: payload.correlationId,
            error:         err instanceof Error ? err.message : String(err),
        });
        }
    }
}