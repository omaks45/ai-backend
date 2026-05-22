import { Test, TestingModule }  from '@nestjs/testing';
import { NotFoundException }    from '@nestjs/common';
import { PromptService }        from './prompt.service';
import { PrismaService }        from '../../../database/prisma.service';
import { CacheService }         from '../../cache/cache.service';

const MOCK_PROMPT_V1 = { content: 'You are a helpful assistant v1.', version: 'v1' };
const MOCK_PROMPT_V2 = { content: 'You are a helpful assistant v2.', version: 'v2' };

function buildMockPrisma() {
    const promptTemplate = {
        findFirst:  jest.fn(),
        findMany:   jest.fn(),
        create:     jest.fn(),
        updateMany: jest.fn(),
    };
    return {
        promptTemplate,
        $transaction: jest.fn().mockImplementation((fn: (tx: any) => Promise<any>) =>
        fn({
            promptTemplate: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        }),
        ),
    };
}

function buildMockCache() {
    return {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
    };
}

describe('PromptService', () => {
    let service: PromptService;
    let prisma:  ReturnType<typeof buildMockPrisma>;
    let cache:   ReturnType<typeof buildMockCache>;

    beforeEach(async () => {
        prisma = buildMockPrisma();
        cache  = buildMockCache();

        const module: TestingModule = await Test.createTestingModule({
        providers: [
            PromptService,
            { provide: PrismaService, useValue: prisma },
            { provide: CacheService,  useValue: cache  },
        ],
        }).compile();

        service = module.get<PromptService>(PromptService);
    });

    afterEach(() => jest.clearAllMocks());

    it('is defined', () => expect(service).toBeDefined());

    describe('resolvePrompt', () => {
        it('returns cached prompt without hitting the DB', async () => {
        cache.get.mockResolvedValue(MOCK_PROMPT_V1);
        const result = await service.resolvePrompt('chat');
        expect(result).toEqual(MOCK_PROMPT_V1);
        expect(prisma.promptTemplate.findFirst).not.toHaveBeenCalled();
        });

        it('queries DB on cache miss and caches the result', async () => {
        cache.get.mockResolvedValue(null);
        prisma.promptTemplate.findFirst.mockResolvedValue(MOCK_PROMPT_V1);
        const result = await service.resolvePrompt('chat');
        expect(result).toEqual(MOCK_PROMPT_V1);
        expect(prisma.promptTemplate.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { taskType: 'chat', isActive: true } }),
        );
        expect(cache.set).toHaveBeenCalledWith('mcp:prompt:chat:active', MOCK_PROMPT_V1, 300);
        });

        it('throws NotFoundException when no active prompt exists in DB', async () => {
        cache.get.mockResolvedValue(null);
        prisma.promptTemplate.findFirst.mockResolvedValue(null);
        await expect(service.resolvePrompt('chat')).rejects.toThrow(NotFoundException);
        });

        it('throws NotFoundException with message containing taskType', async () => {
        cache.get.mockResolvedValue(null);
        prisma.promptTemplate.findFirst.mockResolvedValue(null);
        await expect(service.resolvePrompt('agent')).rejects.toThrow(/agent/);
        });

        it('does not call cache.set when DB returns null', async () => {
        cache.get.mockResolvedValue(null);
        prisma.promptTemplate.findFirst.mockResolvedValue(null);
        await service.resolvePrompt('chat').catch(() => {});
        expect(cache.set).not.toHaveBeenCalled();
        });
    });

    describe('resolveAB', () => {
        it('returns the single active prompt when only one version exists', async () => {
        prisma.promptTemplate.findMany.mockResolvedValue([MOCK_PROMPT_V1]);
        const result = await service.resolveAB('chat', 'user-abc');
        expect(result).toEqual(MOCK_PROMPT_V1);
        });

        it('throws NotFoundException when no active prompts exist', async () => {
        prisma.promptTemplate.findMany.mockResolvedValue([]);
        await expect(service.resolveAB('chat', 'user-abc')).rejects.toThrow(NotFoundException);
        });

        it('assigns versions deterministically — same userId always gets same version', async () => {
        prisma.promptTemplate.findMany.mockResolvedValue([MOCK_PROMPT_V1, MOCK_PROMPT_V2]);
        const userId = 'user-abc-123';
        const first  = await service.resolveAB('chat', userId);
        const second = await service.resolveAB('chat', userId);
        expect(first.version).toBe(second.version);
        });

        it('splits traffic across versions for different userIds', async () => {
        // The hash is userId.charCodeAt(0) + userId.charCodeAt(last) % 2.
        // We need two userIds that produce different hash values (one even, one odd).
        // 'A' = 65, 'B' = 66 — use single-char userIds for predictable hashes.
        // hash('A') = 65+65=130 → 130%2=0 → v1
        // hash('B') = 66+66=132 → 132%2=0 → also v1 (same bucket!)
        // Use userIds where first+last char codes differ in parity:
        // 'Aa' → 65+97=162 → 162%2=0 → index 0 → v1
        // 'Ab' → 65+98=163 → 163%2=1 → index 1 → v2
        prisma.promptTemplate.findMany.mockResolvedValue([MOCK_PROMPT_V1, MOCK_PROMPT_V2]);

        const versions = new Set<string>();
        const userIds = ['Aa-test', 'Ab-test']; // guaranteed different buckets
        for (const userId of userIds) {
            const result = await service.resolveAB('chat', userId);
            versions.add(result.version);
        }
        expect(versions.size).toBe(2);
        });

        it('returns v1 or v2 — never an unknown version', async () => {
        prisma.promptTemplate.findMany.mockResolvedValue([MOCK_PROMPT_V1, MOCK_PROMPT_V2]);
        const result = await service.resolveAB('chat', 'user-test-001');
        expect(['v1', 'v2']).toContain(result.version);
        });
    });

    describe('activatePrompt', () => {
        it('runs deactivate + activate inside a transaction', async () => {
        await service.activatePrompt('chat', 'v2');
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        });

        it('busts the cache after activation', async () => {
        await service.activatePrompt('chat', 'v2');
        expect(cache.del).toHaveBeenCalledWith('mcp:prompt:chat:active');
        });

        it('throws NotFoundException when target version does not exist', async () => {
        prisma.$transaction.mockImplementationOnce(async (fn: any) => {
            await fn({
            promptTemplate: {
                updateMany: jest.fn()
                .mockResolvedValueOnce({ count: 1 })
                .mockResolvedValueOnce({ count: 0 }),
            },
            });
        });
        await expect(service.activatePrompt('chat', 'v99')).rejects.toThrow(NotFoundException);
        });

        it('does NOT bust cache when activation fails', async () => {
        prisma.$transaction.mockRejectedValueOnce(new Error('DB error'));
        await service.activatePrompt('chat', 'v2').catch(() => {});
        expect(cache.del).not.toHaveBeenCalled();
        });
    });

    describe('createVersion', () => {
        it('creates the prompt as inactive', async () => {
        prisma.promptTemplate.create.mockResolvedValue({});
        await service.createVersion({
            taskType: 'chat', version: 'v3',
            name: 'New version', content: 'New prompt content for testing purposes',
        });
        expect(prisma.promptTemplate.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
        );
        });

        it('does not bust the cache when creating a new version', async () => {
        prisma.promptTemplate.create.mockResolvedValue({});
        await service.createVersion({
            taskType: 'chat', version: 'v3', name: 'New', content: 'New prompt content here',
        });
        expect(cache.del).not.toHaveBeenCalled();
        });
    });

    describe('listVersions', () => {
        it('queries DB for all versions of the given taskType', async () => {
        prisma.promptTemplate.findMany.mockResolvedValue([]);
        await service.listVersions('agent');
        expect(prisma.promptTemplate.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { taskType: 'agent' } }),
        );
        });
    });

    describe('invalidateCache', () => {
        it('deletes the correct cache key', async () => {
        await service.invalidateCache('summary');
        expect(cache.del).toHaveBeenCalledWith('mcp:prompt:summary:active');
        });
    });
});