// src/modules/health/health.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService }    from '../../database/prisma.service';
import { CacheService }     from '../cache/cache.service';

const mockPrisma = { $queryRaw: jest.fn() };
const mockCache  = { ping: jest.fn() };

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService,  useValue: mockCache  },
      ],
    }).compile();
    controller = module.get<HealthController>(HealthController);
    jest.clearAllMocks();
  });

  // ── liveness ────────────────────────────────────────────────────────────

  describe('liveness()', () => {
    it('returns status ok', () => {
      expect(controller.liveness().status).toBe('ok');
    });

    it('includes uptime as a number', () => {
      expect(typeof controller.liveness().uptime).toBe('number');
    });

    it('includes an ISO timestamp', () => {
      expect(() => new Date(controller.liveness().timestamp)).not.toThrow();
    });

    it('performs no I/O', () => {
      controller.liveness();
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(mockCache.ping).not.toHaveBeenCalled();
    });
  });

  // ── readiness: all healthy ───────────────────────────────────────────────

  describe('readiness() — all healthy', () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockCache.ping.mockResolvedValue('PONG');
    });

    it('returns status ok', async () => {
      expect((await controller.readiness()).status).toBe('ok');
    });

    it('marks database and redis as ok', async () => {
      const { checks } = await controller.readiness();
      expect(checks.database.status).toBe('ok');
      expect(checks.redis.status).toBe('ok');
    });

    it('includes latencyMs for healthy checks', async () => {
      const { checks } = await controller.readiness();
      expect(typeof checks.database.latencyMs).toBe('number');
      expect(typeof checks.redis.latencyMs).toBe('number');
    });
  });

  // ── readiness: database down ─────────────────────────────────────────────

  describe('readiness() — database down', () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));
      mockCache.ping.mockResolvedValue('PONG');
    });

    it('returns status degraded', async () => {
      expect((await controller.readiness()).status).toBe('degraded');
    });

    it('marks database as error', async () => {
      const { checks } = await controller.readiness();
      expect(checks.database.status).toBe('error');
      expect(checks.database.message).toContain('Connection refused');
    });

    it('still marks redis as ok', async () => {
      expect((await controller.readiness()).checks.redis.status).toBe('ok');
    });
  });

  // ── readiness: redis down ────────────────────────────────────────────────

  describe('readiness() — redis down', () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockCache.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    });

    it('returns status degraded', async () => {
      expect((await controller.readiness()).status).toBe('degraded');
    });

    it('marks redis as error', async () => {
      expect((await controller.readiness()).checks.redis.status).toBe('error');
    });
  });

  // ── readiness: both down ────────────────────────────────────────────────

  describe('readiness() — both down', () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('DB down'));
      mockCache.ping.mockRejectedValue(new Error('Redis down'));
    });

    it('returns degraded with both checks as error', async () => {
      const result = await controller.readiness();
      expect(result.status).toBe('degraded');
      expect(result.checks.database.status).toBe('error');
      expect(result.checks.redis.status).toBe('error');
    });
  });
});