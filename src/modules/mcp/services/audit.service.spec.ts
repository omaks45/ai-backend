import { Test, TestingModule } from '@nestjs/testing';
import { AuditService }       from './audit.service';
import { PrismaService }      from '../../../database/prisma.service';

// ─────────────────────────────────────────────────────────────────────────────
// AuditService tests
//
// Covers:
//   log          — inserts AIAuditLog, truncates to 500 chars, never throws
//   findByUser   — queries with userId + pagination
//   getStats     — returns aggregate totals and fallback rate
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_ENTRY = {
    userId:        'user-audit-001',
    correlationId: 'corr-audit-001',
    taskType:      'chat'  as const,
    model:         'gpt-4o-mini',
    promptVersion: 'v1',
    inputTokens:   200,
    outputTokens:  150,
    costUsd:       0.0001,
    latencyMs:     800,
    fallbackUsed:  false,
    messages:      [
        { role: 'user'  as const, content: 'What is the vacation policy?' },
    ],
    response: 'The vacation policy allows 20 days per year.',
};

function buildMockPrisma() {
    return {
        aIAuditLog: {
        create:    jest.fn().mockResolvedValue({ id: 'audit-1' }),
        findMany:  jest.fn().mockResolvedValue([]),
        count:     jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({
            _sum:   { costUsd: 1.50, inputTokens: 10000, outputTokens: 5000 },
            _avg:   { latencyMs: 750 },
            _count: { id: 20 },
        }),
        },
    };
}

describe('AuditService', () => {
    let service: AuditService;
    let prisma:  ReturnType<typeof buildMockPrisma>;

    beforeEach(async () => {
        prisma = buildMockPrisma();

        const module: TestingModule = await Test.createTestingModule({
        providers: [
            AuditService,
            { provide: PrismaService, useValue: prisma },
        ],
        }).compile();

        service = module.get<AuditService>(AuditService);
    });

    afterEach(() => jest.clearAllMocks());

    it('is defined', () => expect(service).toBeDefined());

    // ── log ────────────────────────────────────────────────────────────────────

    describe('log', () => {
        it('calls prisma.aIAuditLog.create once', async () => {
        await service.log(SAMPLE_ENTRY);
        expect(prisma.aIAuditLog.create).toHaveBeenCalledTimes(1);
        });

        it('persists the correct userId', async () => {
        await service.log(SAMPLE_ENTRY);
        expect(prisma.aIAuditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
            data: expect.objectContaining({ userId: 'user-audit-001' }),
            }),
        );
        });

        it('persists the correct model', async () => {
        await service.log(SAMPLE_ENTRY);
        expect(prisma.aIAuditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
            data: expect.objectContaining({ model: 'gpt-4o-mini' }),
            }),
        );
        });

        it('persists fallbackUsed correctly', async () => {
        await service.log({ ...SAMPLE_ENTRY, fallbackUsed: true });
        const callArg = prisma.aIAuditLog.create.mock.calls[0][0];
        expect(callArg.data.fallbackUsed).toBe(true);
        });

        it('truncates inputSummary to 500 characters', async () => {
        const longContent = 'A'.repeat(2000);
        await service.log({
            ...SAMPLE_ENTRY,
            messages: [{ role: 'user', content: longContent }],
        });

        const callArg = prisma.aIAuditLog.create.mock.calls[0][0];
        expect(callArg.data.inputSummary.length).toBeLessThanOrEqual(500);
        });

        it('truncates outputSummary to 500 characters', async () => {
        const longResponse = 'B'.repeat(2000);
        await service.log({ ...SAMPLE_ENTRY, response: longResponse });

        const callArg = prisma.aIAuditLog.create.mock.calls[0][0];
        expect(callArg.data.outputSummary.length).toBeLessThanOrEqual(500);
        });

        it('handles empty response gracefully', async () => {
        await service.log({ ...SAMPLE_ENTRY, response: undefined });

        const callArg = prisma.aIAuditLog.create.mock.calls[0][0];
        expect(callArg.data.outputSummary).toBe('');
        });

        it('includes role labels in inputSummary', async () => {
        await service.log(SAMPLE_ENTRY);

        const callArg = prisma.aIAuditLog.create.mock.calls[0][0];
        expect(callArg.data.inputSummary).toContain('[user]');
        });

        // ── NEVER throws ────────────────────────────────────────────────────────
        // This is the most important property of AuditService.

        it('NEVER throws when prisma.create throws', async () => {
        prisma.aIAuditLog.create.mockRejectedValue(new Error('DB full'));

        await expect(service.log(SAMPLE_ENTRY)).resolves.not.toThrow();
        });

        it('NEVER throws on DB connection error', async () => {
        prisma.aIAuditLog.create.mockRejectedValue(new Error('connection lost'));

        await expect(service.log(SAMPLE_ENTRY)).resolves.not.toThrow();
        });

        it('NEVER throws on timeout', async () => {
        prisma.aIAuditLog.create.mockRejectedValue(new Error('query timeout'));

        await expect(service.log(SAMPLE_ENTRY)).resolves.not.toThrow();
        });
    });

    // ── findByUser ─────────────────────────────────────────────────────────────

    describe('findByUser', () => {
        it('queries with the correct userId', async () => {
        await service.findByUser('user-x');

        expect(prisma.aIAuditLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
            where: { userId: 'user-x' },
            }),
        );
        });

        it('applies default limit of 20', async () => {
        await service.findByUser('user-x');

        expect(prisma.aIAuditLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ take: 20 }),
        );
        });

        it('applies default offset of 0', async () => {
        await service.findByUser('user-x');

        expect(prisma.aIAuditLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ skip: 0 }),
        );
        });

        it('applies custom limit and offset', async () => {
        await service.findByUser('user-x', 5, 10);

        expect(prisma.aIAuditLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ take: 5, skip: 10 }),
        );
        });

        it('orders by createdAt descending', async () => {
        await service.findByUser('user-x');

        expect(prisma.aIAuditLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
        );
        });
    });

    // ── getStats ───────────────────────────────────────────────────────────────

    describe('getStats', () => {
        it('returns totalCostUsd from aggregate', async () => {
        const since = new Date('2024-01-01');
        const stats = await service.getStats(since);

        expect(stats.totalCostUsd).toBe(1.50);
        });

        it('returns totalRequests from aggregate count', async () => {
        const stats = await service.getStats(new Date());
        expect(stats.totalRequests).toBe(20);
        });

        it('returns avgLatencyMs from aggregate', async () => {
        const stats = await service.getStats(new Date());
        expect(stats.avgLatencyMs).toBe(750);
        });

        it('calculates fallback rate as percentage', async () => {
        prisma.aIAuditLog.count
            .mockResolvedValueOnce(4)   // fallbackCount
            .mockResolvedValueOnce(20); // totalCount
        // 4/20 = 20%

        const stats = await service.getStats(new Date());
        expect(stats.fallbackRate).toBe(20);
        });

        it('returns 0 fallback rate when no requests exist', async () => {
        prisma.aIAuditLog.aggregate.mockResolvedValue({
            _sum:   { costUsd: 0, inputTokens: 0, outputTokens: 0 },
            _avg:   { latencyMs: 0 },
            _count: { id: 0 },
        });
        prisma.aIAuditLog.count
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(0);

        const stats = await service.getStats(new Date());
        expect(stats.fallbackRate).toBe(0);
        });

        it('handles null sums gracefully', async () => {
        prisma.aIAuditLog.aggregate.mockResolvedValue({
            _sum:   { costUsd: null, inputTokens: null, outputTokens: null },
            _avg:   { latencyMs: null },
            _count: { id: 0 },
        });

        const stats = await service.getStats(new Date());
        expect(stats.totalCostUsd).toBe(0);
        expect(stats.avgLatencyMs).toBe(0);
        });
    });
});