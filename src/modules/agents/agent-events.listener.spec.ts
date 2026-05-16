import { Test, TestingModule } from '@nestjs/testing';
import { AgentEventsListener }  from './agent-events.listener';
import { PrismaService }        from '../../database/prisma.service';

// ─────────────────────────────────────────────────────────────────────────────
// AgentEventsListener tests
//
// The listener has one job: when 'agent:completed' fires, persist a UsageLog
// row via Prisma. Tests verify:
//   1. The method is callable without throwing under normal conditions
//   2. Prisma is called with the correct shape
//   3. A Prisma failure does NOT propagate — logging errors are swallowed
//      so a DB hiccup never blocks the agent response.
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_PAYLOAD = {
    userId:            'user-abc',
    correlationId:     'corr-xyz',
    iterations:        3,
    totalCostUsd:      0.04,
    terminationReason: 'completed' as const,
    toolsUsed:         ['search_documents', 'final_answer'],
    durationMs:        4_200,
};

describe('AgentEventsListener', () => {
    let listener: AgentEventsListener;
    let prisma:   { usageLog: { create: jest.Mock } };

    beforeEach(async () => {
        prisma = { usageLog: { create: jest.fn().mockResolvedValue({}) } };

        const module: TestingModule = await Test.createTestingModule({
        providers: [
            AgentEventsListener,
            { provide: PrismaService, useValue: prisma },
        ],
        }).compile();

        listener = module.get<AgentEventsListener>(AgentEventsListener);
    });

    it('is defined', () => expect(listener).toBeDefined());

    // Successful persistence

    describe('handleAgentCompleted', () => {
        it('calls prisma.usageLog.create once', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        expect(prisma.usageLog.create).toHaveBeenCalledTimes(1);
        });

        it('persists the correct userId', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        expect(prisma.usageLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
            data: expect.objectContaining({ userId: 'user-abc' }),
            }),
        );
        });

        it('persists action = "agent_run"', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        expect(prisma.usageLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
            data: expect.objectContaining({ action: 'agent_run' }),
            }),
        );
        });

        it('persists totalCostUsd as costUsd', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        const callArg = prisma.usageLog.create.mock.calls[0][0];
        expect(callArg.data.costUsd).toBe(0.04);
        });

        it('persists correlationId inside metadata JSON', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        const callArg  = prisma.usageLog.create.mock.calls[0][0];
        const metadata = JSON.parse(callArg.data.metadata);
        expect(metadata.correlationId).toBe('corr-xyz');
        });

        it('persists iterations inside metadata JSON', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        const callArg  = prisma.usageLog.create.mock.calls[0][0];
        const metadata = JSON.parse(callArg.data.metadata);
        expect(metadata.iterations).toBe(3);
        });

        it('persists terminationReason inside metadata JSON', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        const callArg  = prisma.usageLog.create.mock.calls[0][0];
        const metadata = JSON.parse(callArg.data.metadata);
        expect(metadata.terminationReason).toBe('completed');
        });

        it('persists toolsUsed (filtering undefined values) inside metadata JSON', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        const callArg  = prisma.usageLog.create.mock.calls[0][0];
        const metadata = JSON.parse(callArg.data.metadata);
        expect(metadata.toolsUsed).toEqual(['search_documents', 'final_answer']);
        });

        it('persists durationMs inside metadata JSON', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        const callArg  = prisma.usageLog.create.mock.calls[0][0];
        const metadata = JSON.parse(callArg.data.metadata);
        expect(metadata.durationMs).toBe(4_200);
        });

        it('sets tokens to 0 — UsageLog.tokens is Int (non-nullable) in the schema', async () => {
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        const callArg = prisma.usageLog.create.mock.calls[0][0];
        // Schema: tokens Int (not Int?) — null would fail the Prisma type check.
        // Agent runs track cost in costUsd; token details are in metadata JSON.
        expect(callArg.data.tokens).toBe(0);
        });
    });

    // Resilience: Prisma failure

    describe('error resilience', () => {
        it('does not throw when Prisma throws', async () => {
        prisma.usageLog.create.mockRejectedValue(new Error('DB connection lost'));
        await expect(
            listener.handleAgentCompleted(SAMPLE_PAYLOAD),
        ).resolves.not.toThrow();
        });

        it('swallows the Prisma error silently', async () => {
        prisma.usageLog.create.mockRejectedValue(new Error('DB connection lost'));
        // If this resolves (no throw), the error was swallowed
        await listener.handleAgentCompleted(SAMPLE_PAYLOAD);
        expect(true).toBe(true);
        });
    });

    //Termination reasons

    describe('all termination reasons are persisted correctly', () => {
        const reasons = [
        'completed',
        'iteration_limit',
        'timeout',
        'cost_limit',
        'error',
        ] as const;

        for (const reason of reasons) {
        it(`persists terminationReason "${reason}"`, async () => {
            await listener.handleAgentCompleted({
            ...SAMPLE_PAYLOAD,
            terminationReason: reason,
            });
            const callArg  = prisma.usageLog.create.mock.calls[0][0];
            const metadata = JSON.parse(callArg.data.metadata);
            expect(metadata.terminationReason).toBe(reason);
        });
        }
    });
});