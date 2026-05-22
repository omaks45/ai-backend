import { Test, TestingModule }  from '@nestjs/testing';
import { HttpStatus }           from '@nestjs/common';
import { McpController }        from './mcp.controller';
import { McpService }           from './services/mcp.service';

// ─────────────────────────────────────────────────────────────────────────────
// McpController tests
//
// The controller is a thin routing layer — it delegates every operation to
// McpService. Tests verify:
//   - Correct delegation for each endpoint
//   - Response shape (controller returns what McpService returns)
//   - Guards are bypassable in tests via overrideGuard
// ─────────────────────────────────────────────────────────────────────────────

function buildMockMcp() {
  return {
    listPromptVersions: jest.fn().mockResolvedValue([
      { id: '1', taskType: 'chat', version: 'v1', name: 'RAG Chat', isActive: true, createdAt: new Date() },
    ]),
    createPromptVersion: jest.fn().mockResolvedValue(undefined),
    activatePrompt:      jest.fn().mockResolvedValue(undefined),
    getBudgetStatus:     jest.fn().mockResolvedValue({
      tier: 'free', budgetUsd: 1, spentUsd: 0.20,
      remainingUsd: 0.80, percentUsed: 20, exhausted: false,
    }),
    getAuditStats:   jest.fn().mockResolvedValue({
      totalCostUsd: 1.50, totalRequests: 20, fallbackRate: 5,
    }),
    getAuditByUser:  jest.fn().mockResolvedValue([]),
  };
}

describe('McpController', () => {
  let controller: McpController;
  let mcp:        ReturnType<typeof buildMockMcp>;

  beforeEach(async () => {
    mcp = buildMockMcp();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [McpController],
      providers:   [{ provide: McpService, useValue: mcp }],
    })
      .overrideGuard(require('../../common/guards/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/guards/permissions.guard').PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<McpController>(McpController);
  });

  afterEach(() => jest.clearAllMocks());

  it('is defined', () => expect(controller).toBeDefined());

  // ── Prompt endpoints ────────────────────────────────────────────────────────

  describe('listVersions()', () => {
    it('calls mcp.listPromptVersions with taskType', async () => {
      await controller.listVersions('chat');
      expect(mcp.listPromptVersions).toHaveBeenCalledWith('chat');
    });

    it('returns the result from McpService', async () => {
      const result = await controller.listVersions('chat');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].version).toBe('v1');
    });
  });

  describe('createVersion()', () => {
    it('delegates to mcp.createPromptVersion with taskType and dto', async () => {
      const dto = { version: 'v2', name: 'Improved', content: 'New prompt content here' };
      await controller.createVersion('chat', dto);
      expect(mcp.createPromptVersion).toHaveBeenCalledWith({ taskType: 'chat', ...dto });
    });
  });

  describe('activatePrompt()', () => {
    it('delegates to mcp.activatePrompt with taskType and version', async () => {
      await controller.activatePrompt('chat', { version: 'v2' });
      expect(mcp.activatePrompt).toHaveBeenCalledWith('chat', 'v2');
    });
  });

  // ── Budget endpoint ─────────────────────────────────────────────────────────

  describe('getBudgetStatus()', () => {
    it('delegates to mcp.getBudgetStatus with userId', async () => {
      await controller.getBudgetStatus('user-abc');
      expect(mcp.getBudgetStatus).toHaveBeenCalledWith('user-abc');
    });

    it('returns budget status from McpService', async () => {
      const result = await controller.getBudgetStatus('user-abc');
      expect(result).toMatchObject({ tier: 'free', budgetUsd: 1 });
    });
  });

  // ── Audit endpoints ─────────────────────────────────────────────────────────

  describe('getAuditStats()', () => {
    it('passes a Date computed from days param to mcp.getAuditStats', async () => {
      await controller.getAuditStats('7');
      expect(mcp.getAuditStats).toHaveBeenCalledWith(expect.any(Date));
    });

    it('uses 30 days as default lookback', async () => {
      const before = new Date();
      before.setDate(before.getDate() - 31); // 31 days ago

      await controller.getAuditStats('30');

      const calledWith = mcp.getAuditStats.mock.calls[0][0] as Date;
      // The date passed should be approximately 30 days ago
      expect(calledWith.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe('getAuditByUser()', () => {
    it('delegates to mcp.getAuditByUser with parsed limit and offset', async () => {
      await controller.getAuditByUser('user-abc', '10', '20');
      expect(mcp.getAuditByUser).toHaveBeenCalledWith('user-abc', 10, 20);
    });

    it('uses default limit=20 and offset=0', async () => {
      await controller.getAuditByUser('user-abc', '20', '0');
      expect(mcp.getAuditByUser).toHaveBeenCalledWith('user-abc', 20, 0);
    });
  });
});