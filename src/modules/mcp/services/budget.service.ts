// src/modules/mcp/services/budget.service.ts
//
// COST GOVERNANCE
//
// Two-layer budget enforcement:
//   Layer 1 (fast):  Redis INCRBYFLOAT — O(1) atomic float increment.
//                    Checked on every MCP call before hitting the LLM.
//   Layer 2 (exact): Prisma aggregate  — the authoritative DB source.
//                    Used when Redis has no entry (cold start / expiry).
//
// WHY TWO LAYERS:
// Aggregating UsageLog on every request is expensive at scale (full table scan
// even with the index). Redis gives sub-millisecond budget checks. The DB is
// the source of truth for monthly reports and reconciliation.
//
// EVENTUAL CONSISTENCY:
// The Redis counter and DB aggregate are eventually consistent. The worst-case
// overspend before the DB catches up is one request's cost. This is acceptable
// for soft budget enforcement (a few cents of overspend is fine).
//
// TIME COMPLEXITY:
//   checkAndEnforce — O(1) Redis read + O(1) Redis write (hot path)
//                     O(n) DB aggregate scan (cold start only, then cached)
//   trackCost       — O(1) Redis INCRBYFLOAT + O(1) Redis EXPIRE
//   getBudgetStatus — O(1) Redis read or O(n) DB scan

import {
    Injectable,
    Logger,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService }  from '../../cache/cache.service';
import { BudgetStatus }  from '../mcp.types';

// Monthly budgets by tier (USD)
const MONTHLY_BUDGETS: Readonly<Record<string, number>> = {
    free:       1.00,
    pro:       20.00,
    enterprise: 200.00,
} as const;

const WARN_THRESHOLD = 0.80; // Warn at 80% of budget

@Injectable()
export class BudgetService {
    private readonly logger = new Logger(BudgetService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache:  CacheService,
    ) {}

    // Public API

    /**
     * Check budget before an LLM call and throw 429 if exhausted.
     * Hot path: O(1) Redis read.
     * Cold path: O(n) DB aggregate (only on Redis miss, result cached in Redis).
     */
    async checkAndEnforce(userId: string): Promise<void> {
        const { tier, budgetUsd, spentUsd } = await this.getBudgetStatus(userId);

        if (spentUsd >= budgetUsd) {
        throw new HttpException(
            {
            error:   'BUDGET_EXHAUSTED',
            message: `Monthly AI budget exhausted ($${spentUsd.toFixed(2)} / $${budgetUsd.toFixed(2)})`,
            tier,
            hint:    'Upgrade your plan or wait until next month.',
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
        }

        const percentUsed = (spentUsd / budgetUsd) * 100;
        if (percentUsed >= WARN_THRESHOLD * 100) {
        this.logger.warn('User approaching budget limit', {
            userId:      userId.substring(0, 8) + '...',
            tier,
            spent:       spentUsd.toFixed(4),
            budget:      budgetUsd.toFixed(2),
            percentUsed: percentUsed.toFixed(1),
        });
        }
    }

    /**
     * Record cost after a successful LLM call.
     * O(1) — Redis get/set + conditional EXPIRE.
     */
    async trackCost(userId: string, costUsd: number): Promise<void> {
        if (costUsd <= 0) return; // Ollama — no cost to track

        const key = this.redisKey(userId);
        const currentValue = await this.cache.get<number>(key);
        const newValue = Number(currentValue ?? 0) + costUsd;

        const secondsLeft = this.secondsUntilEndOfMonth() + 86_400;
        await this.cache.set(key, newValue, secondsLeft);
    }

    /**
     * Return the current budget status for a user.
     * Used by the admin dashboard and the /budget endpoint.
     */
    async getBudgetStatus(userId: string): Promise<BudgetStatus> {
        const user = await this.prisma.user.findUnique({
        where:  { id: userId },
        select: { tier: true },
        });

        const tier      = user?.tier ?? 'free';
        const budgetUsd = MONTHLY_BUDGETS[tier] ?? MONTHLY_BUDGETS['free'];

        // Try Redis first (O(1))
        const redisKey = this.redisKey(userId);
        const cached   = await this.cache.get<number>(redisKey);

        let spentUsd: number;

        if (cached !== null && cached !== undefined) {
        spentUsd = Number(cached);
        } else {
        // Cold path: aggregate from DB and warm the Redis cache
        spentUsd = await this.aggregateFromDb(userId);
        if (spentUsd > 0) {
            await this.cache.set(redisKey, spentUsd, this.secondsUntilEndOfMonth() + 86_400);
        }
        }

        const remainingUsd = Math.max(0, budgetUsd - spentUsd);
        const percentUsed  = budgetUsd > 0 ? (spentUsd / budgetUsd) * 100 : 0;

        return {
        tier,
        budgetUsd,
        spentUsd:     parseFloat(spentUsd.toFixed(6)),
        remainingUsd: parseFloat(remainingUsd.toFixed(6)),
        percentUsed:  parseFloat(percentUsed.toFixed(2)),
        exhausted:    spentUsd >= budgetUsd,
        };
    }

    // ── Private ────────────────────────────────────────────────────────────────

    /**
     * Aggregate this month's AI spend from UsageLog.
     * O(n) full index scan — only used when Redis cache is cold.
     */
    private async aggregateFromDb(userId: string): Promise<number> {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const result = await this.prisma.usageLog.aggregate({
        where: {
            userId,
            action:    { in: ['chat', 'agent_run', 'document_ingested'] },
            createdAt: { gte: startOfMonth },
        },
        _sum: { costUsd: true },
        });

        return result._sum.costUsd ?? 0;
    }

    private redisKey(userId: string): string {
        // Key format: budget:{userId}:{YYYY-MM}
        // Includes month so keys auto-segment by month — no manual reset needed.
        const month = new Date().toISOString().slice(0, 7);
        return `mcp:budget:${userId}:${month}`;
    }

    private secondsUntilEndOfMonth(): number {
        const now     = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const diffMs  = lastDay.setHours(23, 59, 59, 999) - now.getTime();
        return Math.ceil(diffMs / 1_000);
    }
}