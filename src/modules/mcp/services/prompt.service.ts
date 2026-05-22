// src/modules/mcp/services/prompt.service.ts
//
// PROMPT VERSIONING
//
// Prompts are stored in the PromptTemplate table, not in config files.
// This lets you change the active prompt without redeploying.
//
// CACHING STRATEGY:
// Every resolvePrompt call would otherwise hit the DB. Since prompts change
// rarely (maybe once a day), we cache the active prompt in Redis for 5 minutes.
// When you activate a new version, call invalidateCache() to bust immediately.
//
// TIME COMPLEXITY:
//   resolvePrompt  — O(1) Redis hit (most calls) or O(log n) DB index scan
//   activatePrompt — O(1) DB updates + O(1) cache bust
//   resolveAB      — O(k) where k = number of active versions (always tiny)
//
// A/B TESTING:
// Multiple prompts for the same taskType can be active simultaneously.
// resolveAB uses a deterministic hash of userId so the same user always
// sees the same version — essential for meaningful comparison.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService }  from '../../../database/prisma.service';
import { CacheService }   from '../../cache/cache.service';
import { TaskType }       from '../mcp.types';

export interface ResolvedPrompt {
  content: string;
  version: string;
}

const CACHE_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class PromptService {
    private readonly logger = new Logger(PromptService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache:  CacheService,
    ) {}

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Resolve the active prompt for a task type.
     * Checks Redis first (O(1)), falls back to DB index scan (O(log n)).
     * Returns the most recently created active prompt if multiple are active.
     */
    async resolvePrompt(taskType: TaskType): Promise<ResolvedPrompt> {
        const cacheKey = this.cacheKey(taskType);

        // L1: Redis cache — avoids DB on the hot path
        const cached = await this.cache.get<ResolvedPrompt>(cacheKey);
        if (cached) return cached;

        // L2: Database — indexed on (taskType, isActive)
        const prompt = await this.prisma.promptTemplate.findFirst({
        where:   { taskType, isActive: true },
        orderBy: { createdAt: 'desc' },
        select:  { content: true, version: true },
        });

        if (!prompt) {
        throw new NotFoundException(
            `No active prompt for task type "${taskType}". ` +
            `Run the seed script: npx ts-node prisma/seed.mcp.ts`,
        );
        }

        const result: ResolvedPrompt = { content: prompt.content, version: prompt.version };
        await this.cache.set(cacheKey, result, CACHE_TTL_SECONDS);
        return result;
    }

    /**
     * Resolve a prompt with A/B testing.
     * If only one version is active, delegates to resolvePrompt (no A/B test running).
     * If multiple versions are active, assigns a version deterministically by userId.
     *
     * WHY DETERMINISTIC SPLITTING:
     * Random splitting means the same user might get v2 for one query and v3 for the
     * next, making quality comparison meaningless. Deterministic hashing ensures each
     * user consistently sees the same version throughout the experiment.
     *
     * Time complexity: O(k) where k = active versions for this taskType (always < 10).
     */
    async resolveAB(taskType: TaskType, userId: string): Promise<ResolvedPrompt> {
        const prompts = await this.prisma.promptTemplate.findMany({
        where:   { taskType, isActive: true },
        orderBy: { version: 'asc' },
        select:  { content: true, version: true },
        });

        if (prompts.length === 0) {
        throw new NotFoundException(`No active prompt for task type "${taskType}"`);
        }

        if (prompts.length === 1) {
        return { content: prompts[0].content, version: prompts[0].version };
        }

        // Deterministic hash: sum of char codes at position 0 and last
        // Simple, fast, good enough distribution for A/B splitting
        const hash  = userId.charCodeAt(0) + userId.charCodeAt(userId.length - 1);
        const index = hash % prompts.length;
        const selected = prompts[index];

        this.logger.debug('A/B prompt selected', {
        taskType,
        userId:  userId.substring(0, 8) + '...',
        version: selected.version,
        totalVariants: prompts.length,
        });

        return { content: selected.content, version: selected.version };
    }

    /**
     * Activate a prompt version.
     * Deactivates all other versions for the same taskType, then activates
     * the target version, then busts the cache for instant effect.
     *
     * Wrapped in a transaction so the deactivate + activate is atomic —
     * no window where zero prompts are active.
     */
    async activatePrompt(taskType: TaskType, version: string): Promise<void> {
        await this.prisma.$transaction(async tx => {
        // Deactivate all current active versions for this task type
        await tx.promptTemplate.updateMany({
            where: { taskType, isActive: true },
            data:  { isActive: false },
        });

        // Activate the target version
        const updated = await tx.promptTemplate.updateMany({
            where: { taskType, version },
            data:  { isActive: true },
        });

        if (updated.count === 0) {
            throw new NotFoundException(
            `Prompt template ${taskType}/${version} not found`,
            );
        }
        });

        // Bust cache immediately — next request uses the new version
        await this.invalidateCache(taskType);

        this.logger.log('Prompt activated', { taskType, version });
    }

    /**
     * Create a new prompt version.
     * Does NOT activate it — caller must call activatePrompt() separately.
     * This lets you create + review before activating.
     */
    async createVersion(data: {
        taskType: TaskType;
        version:  string;
        name:     string;
        content:  string;
        metadata?: Record<string, unknown>;
    }): Promise<void> {
        await this.prisma.promptTemplate.create({
        data: {
            taskType: data.taskType,
            version:  data.version,
            name:     data.name,
            content:  data.content,
            isActive: false,  // Always starts inactive — activate explicitly
            metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
        },
        });

        this.logger.log('Prompt version created', {
        taskType: data.taskType,
        version:  data.version,
        });
    }

    /**
     * List all versions for a task type — for the admin dashboard.
     */
    async listVersions(taskType: TaskType) {
        return this.prisma.promptTemplate.findMany({
        where:   { taskType },
        orderBy: { createdAt: 'desc' },
        select: {
            id:        true,
            taskType:  true,
            version:   true,
            name:      true,
            isActive:  true,
            metadata:  true,
            createdAt: true,
            // Omit content — it can be large; fetch individually when editing
        },
        });
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private cacheKey(taskType: TaskType): string {
        return `mcp:prompt:${taskType}:active`;
    }

    async invalidateCache(taskType: TaskType): Promise<void> {
        await this.cache.del(this.cacheKey(taskType));
    }
}