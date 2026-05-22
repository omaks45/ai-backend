// src/modules/mcp/services/audit.service.ts
//
// AI AUDIT LOGGING
//
// Every MCP call produces one AIAuditLog row. This gives:
//   1. Debugging — see exact prompt + response for any correlationId
//   2. Compliance — prove what data was sent to the AI and what it returned
//   3. Quality analysis — identify patterns in bad answers, prompt iterations
//
// PII HANDLING:
// We store summaries (first 500 chars), not the full text.
// Full document content is never stored in the audit log — it stays in the
// Document/Chunk tables under proper access control.
//
// NEVER CRASHES REQUESTS:
// The entire log() method is wrapped in try/catch. Audit logging is a side
// effect. If the DB is full or the insert fails, the user's request already
// succeeded — we log the failure to Winston and move on.
//
// TIME COMPLEXITY:
//   log — O(1) DB insert (async, non-blocking to caller)

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../../../database/prisma.service';
import { TaskType, McpMessage } from '../mcp.types';

const SUMMARY_MAX_CHARS = 500;

export interface AuditEntry {
    userId:        string;
    correlationId: string;
    taskType:      TaskType;
    model:         string;
    promptVersion: string;
    inputTokens:   number;
    outputTokens:  number;
    costUsd:       number;
    latencyMs:     number;
    fallbackUsed:  boolean;
    messages:      McpMessage[];
    response?:     string;
}

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Persist an audit record for an MCP call.
     *
     * NEVER throws — always wraps in try/catch.
     * Caller does not need to handle errors from this method.
     */
    async log(entry: AuditEntry): Promise<void> {
        try {
        // Build a readable input summary from the message array.
        // We take the first 500 chars — enough for debugging without
        // storing full document contents.
        const inputText = entry.messages
            .map(m => `[${m.role}]: ${m.content}`)
            .join('\n');

        await this.prisma.aIAuditLog.create({
            data: {
            userId:        entry.userId,
            correlationId: entry.correlationId,
            taskType:      entry.taskType,
            model:         entry.model,
            promptVersion: entry.promptVersion,
            inputTokens:   entry.inputTokens,
            outputTokens:  entry.outputTokens,
            costUsd:       entry.costUsd,
            latencyMs:     entry.latencyMs,
            fallbackUsed:  entry.fallbackUsed,
            inputSummary:  inputText.substring(0, SUMMARY_MAX_CHARS),
            outputSummary: (entry.response ?? '').substring(0, SUMMARY_MAX_CHARS),
            },
        });
        } catch (err) {
        // Log the failure — but NEVER let it propagate to the caller.
        // The user's request has already completed successfully.
        this.logger.error('Audit log insert failed', {
            correlationId: entry.correlationId,
            error: err instanceof Error ? err.message : String(err),
        });
        }
    }

    /**
     * Fetch recent audit entries for a user — for the admin dashboard.
     * Paginated to avoid loading thousands of rows.
     */
    async findByUser(userId: string, limit = 20, offset = 0) {
        return this.prisma.aIAuditLog.findMany({
        where:   { userId },
        orderBy: { createdAt: 'desc' },
        take:    limit,
        skip:    offset,
        select: {
            id:            true,
            correlationId: true,
            taskType:      true,
            model:         true,
            promptVersion: true,
            costUsd:       true,
            latencyMs:     true,
            fallbackUsed:  true,
            inputSummary:  true,
            outputSummary: true,
            createdAt:     true,
            // Omit raw token counts from dashboard view — use aggregate instead
        },
        });
    }

    /**
     * Aggregate cost and usage stats for the admin dashboard.
     * Returns total cost, avg latency, fallback rate for a time window.
     */
    async getStats(since: Date) {
        const [totals, fallbackCount, totalCount] = await Promise.all([
        this.prisma.aIAuditLog.aggregate({
            where:  { createdAt: { gte: since } },
            _sum:   { costUsd: true, inputTokens: true, outputTokens: true },
            _avg:   { latencyMs: true },
            _count: { id: true },
        }),
        this.prisma.aIAuditLog.count({
            where: { createdAt: { gte: since }, fallbackUsed: true },
        }),
        this.prisma.aIAuditLog.count({
            where: { createdAt: { gte: since } },
        }),
        ]);

        return {
        totalCostUsd:      totals._sum.costUsd       ?? 0,
        totalInputTokens:  totals._sum.inputTokens   ?? 0,
        totalOutputTokens: totals._sum.outputTokens  ?? 0,
        avgLatencyMs:      totals._avg.latencyMs      ?? 0,
        totalRequests:     totals._count.id,
        fallbackRate:      totalCount > 0
            ? parseFloat(((fallbackCount / totalCount) * 100).toFixed(2))
            : 0,
        };
    }
}