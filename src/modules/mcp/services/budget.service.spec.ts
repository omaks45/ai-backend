import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { BudgetService }  from './budget.service';
import { PrismaService }  from '../../../database/prisma.service';
import { CacheService }   from '../../cache/cache.service';

// ─────────────────────────────────────────────────────────────────────────────
// BudgetService tests
//
// CacheService API used by BudgetService:
//   get()          — read the Redis budget counter (returns number | null)
//   set()          — warm the Redis cache on cold DB path
//   incrByFloat()  — atomic float increment for cost tracking (INCRBYFLOAT)
//   ttl()          — check if expiry is set on the key (-1 = no expiry)
//   expire()       — set expiry on a new budget key
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = 'user-budget-test-001';

// ── Mock factories ────────────────────────────────────────────────────────────

function buildMockPrisma(tier = 'free', aggregateResult = 0) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ tier }),
    },
    usageLog: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: aggregateResult } }),
    },
  };
}

function buildMockCache(cachedValue: number | null = null) {
  return {
    get:          jest.fn().mockResolvedValue(cachedValue),
    set:          jest.fn().mockResolvedValue(undefined),
    incrByFloat:  jest.fn().mockResolvedValue(undefined),
    ttl:          jest.fn().mockResolvedValue(-1),  // -1 = key exists, no expiry yet
    expire:       jest.fn().mockResolvedValue(undefined),
    del:          jest.fn().mockResolvedValue(undefined),
  };
}

// ── Shared test helpers ───────────────────────────────────────────────────────

describe('BudgetService', () => {
  // Declare at describe scope — createService() reassigns these.
  // Tests reference these variables directly — always the current instance.
  let service: BudgetService;
  let prisma:  ReturnType<typeof buildMockPrisma>;
  let cache:   ReturnType<typeof buildMockCache>;

  async function createService(
    tier        = 'free',
    dbSpent     = 0,
    redisCached: number | null = null,
  ) {
    prisma = buildMockPrisma(tier, dbSpent);
    cache  = buildMockCache(redisCached);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService,  useValue: cache  },
      ],
    }).compile();

    service = module.get<BudgetService>(BudgetService);
  }

  afterEach(() => jest.clearAllMocks());

  it('is defined', async () => {
    await createService();
    expect(service).toBeDefined();
  });

  // ── checkAndEnforce ──────────────────────────────────────────────────────────

  describe('checkAndEnforce', () => {
    it('passes without throwing when user is under budget', async () => {
      await createService('free', 0, 0.50);
      await expect(service.checkAndEnforce(USER_ID)).resolves.not.toThrow();
    });

    it('throws 429 HttpException when budget is exactly exhausted', async () => {
      await createService('free', 0, 1.00);
      await expect(service.checkAndEnforce(USER_ID)).rejects.toThrow(HttpException);
    });

    it('throws with status 429 TOO_MANY_REQUESTS', async () => {
      await createService('free', 0, 1.50);
      try {
        await service.checkAndEnforce(USER_ID);
        fail('should have thrown');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it('throws with error code BUDGET_EXHAUSTED', async () => {
      await createService('free', 0, 1.00);
      try {
        await service.checkAndEnforce(USER_ID);
      } catch (e) {
        const body = (e as HttpException).getResponse() as any;
        expect(body.error).toBe('BUDGET_EXHAUSTED');
      }
    });

    it('does not throw at 79% of budget', async () => {
      await createService('free', 0, 0.79);
      await expect(service.checkAndEnforce(USER_ID)).resolves.not.toThrow();
    });

    it('does not throw at exactly 80% (warn threshold, not hard limit)', async () => {
      await createService('free', 0, 0.80);
      await expect(service.checkAndEnforce(USER_ID)).resolves.not.toThrow();
    });

    it('respects pro tier budget of $20', async () => {
      await createService('pro', 0, 15.00);
      await expect(service.checkAndEnforce(USER_ID)).resolves.not.toThrow();
    });

    it('throws for pro tier when $20 is exhausted', async () => {
      await createService('pro', 0, 20.00);
      await expect(service.checkAndEnforce(USER_ID)).rejects.toThrow(HttpException);
    });

    it('respects enterprise tier budget of $200', async () => {
      await createService('enterprise', 0, 150.00);
      await expect(service.checkAndEnforce(USER_ID)).resolves.not.toThrow();
    });

    it('throws for enterprise when $200 is exhausted', async () => {
      await createService('enterprise', 0, 200.00);
      await expect(service.checkAndEnforce(USER_ID)).rejects.toThrow(HttpException);
    });

    it('treats unknown tier as free ($1 budget)', async () => {
      await createService('unknown_tier', 0, 1.00);
      await expect(service.checkAndEnforce(USER_ID)).rejects.toThrow(HttpException);
    });
  });

  // ── trackCost ────────────────────────────────────────────────────────────────
  //
  // Each test calls createService() itself so service + cache are freshly
  // created and the cache reference is always in sync with what was injected.

  describe('trackCost', () => {
    it('DIAGNOSTIC — cache mock has incrByFloat and service is injected correctly', async () => {
      await createService();
      // Prove the cache mock reference matches what's injected into the service
      expect(typeof cache.incrByFloat).toBe('function');
      // Prove the service itself references the same cache mock
      expect((service as any).cache).toBe(cache);
    });

    it('calls incrByFloat with the correct key and cost amount', async () => {
      await createService();
      await service.trackCost(USER_ID, 0.05);

      expect(cache.incrByFloat).toHaveBeenCalledWith(
        expect.stringContaining(USER_ID),
        0.05,
      );
    });

    it('skips incrByFloat when cost is 0 (Ollama — free)', async () => {
      await createService();
      await service.trackCost(USER_ID, 0);

      expect(cache.incrByFloat).not.toHaveBeenCalled();
    });

    it('skips incrByFloat when cost is negative', async () => {
      await createService();
      await service.trackCost(USER_ID, -0.01);

      expect(cache.incrByFloat).not.toHaveBeenCalled();
    });

    it('sets expiry when TTL is -1 (new key, no expiry yet)', async () => {
      await createService();
      cache.ttl.mockResolvedValue(-1);

      await service.trackCost(USER_ID, 0.01);

      expect(cache.expire).toHaveBeenCalledWith(
        expect.stringContaining(USER_ID),
        expect.any(Number),
      );
    });

    it('does NOT reset expiry when key already has a TTL', async () => {
      await createService();
      cache.ttl.mockResolvedValue(86_400); // key already has TTL

      await service.trackCost(USER_ID, 0.01);

      expect(cache.expire).not.toHaveBeenCalled();
    });

    it('includes the current month in the Redis key', async () => {
      await createService();
      await service.trackCost(USER_ID, 0.01);

      const month = new Date().toISOString().slice(0, 7); // e.g. "2026-05"
      expect(cache.incrByFloat).toHaveBeenCalledWith(
        expect.stringContaining(month),
        expect.any(Number),
      );
    });

    it('includes the userId in the Redis key', async () => {
      await createService();
      await service.trackCost(USER_ID, 0.01);

      expect(cache.incrByFloat).toHaveBeenCalledWith(
        expect.stringContaining(USER_ID),
        expect.any(Number),
      );
    });
  });

  // ── getBudgetStatus ──────────────────────────────────────────────────────────

  describe('getBudgetStatus', () => {
    it('returns spentUsd from Redis when cache is warm', async () => {
      await createService('free', 0, 0.30);
      const status = await service.getBudgetStatus(USER_ID);

      expect(status.spentUsd).toBe(0.3);
      expect(prisma.usageLog.aggregate).not.toHaveBeenCalled();
    });

    it('falls back to DB aggregate when Redis cache is cold', async () => {
      await createService('free', 0.25, null);
      const status = await service.getBudgetStatus(USER_ID);

      expect(status.spentUsd).toBe(0.25);
      expect(prisma.usageLog.aggregate).toHaveBeenCalledTimes(1);
    });

    it('returns correct remainingUsd', async () => {
      await createService('free', 0, 0.40);
      const status = await service.getBudgetStatus(USER_ID);

      expect(status.remainingUsd).toBeCloseTo(0.60, 4);
    });

    it('returns 0 remainingUsd when over budget', async () => {
      await createService('free', 0, 1.50);
      const status = await service.getBudgetStatus(USER_ID);

      expect(status.remainingUsd).toBe(0);
    });

    it('returns correct percentUsed', async () => {
      await createService('pro', 0, 10.00); // $10 of $20 = 50%
      const status = await service.getBudgetStatus(USER_ID);

      expect(status.percentUsed).toBeCloseTo(50, 1);
    });

    it('marks exhausted = true when spent >= budget', async () => {
      await createService('free', 0, 1.00);
      const status = await service.getBudgetStatus(USER_ID);

      expect(status.exhausted).toBe(true);
    });

    it('marks exhausted = false when under budget', async () => {
      await createService('free', 0, 0.50);
      const status = await service.getBudgetStatus(USER_ID);

      expect(status.exhausted).toBe(false);
    });

    it('returns correct tier and budgetUsd for enterprise', async () => {
      await createService('enterprise', 0, 0);
      const status = await service.getBudgetStatus(USER_ID);

      expect(status.tier).toBe('enterprise');
      expect(status.budgetUsd).toBe(200);
    });

    it('warms Redis cache when DB is queried on cold path', async () => {
      await createService('free', 0.20, null);
      await service.getBudgetStatus(USER_ID);

      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining(USER_ID),
        0.20,
        expect.any(Number),
      );
    });

    it('does not cache 0 DB result', async () => {
      await createService('free', 0, null);
      await service.getBudgetStatus(USER_ID);

      expect(cache.set).not.toHaveBeenCalled();
    });
  });
});