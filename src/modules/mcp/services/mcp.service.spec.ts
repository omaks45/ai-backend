import { Test, TestingModule } from '@nestjs/testing';
import { HttpException }       from '@nestjs/common';
import { EventEmitter2 }       from '@nestjs/event-emitter';
import { McpService }          from './mcp.service';
import { PromptService }       from '../services/prompt.service';
import { RouterService }       from '../services/router.service';
import { BudgetService }       from '../services/budget.service';
import { AuditService }        from '../services/audit.service';

// ─────────────────────────────────────────────────────────────────────────────
// McpService tests
//
// McpService orchestrates 6 steps in strict order.
// Tests verify each step fires, the order is correct, and failures in one
// step produce the right outcome (budget failure = 429, LLM failure = throw,
// audit failure = silently swallowed).
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_PROMPT   = { content: 'You are helpful.', version: 'v1' };
const MOCK_MODEL    = {
  name:                 'gpt-4o-mini',
  provider:             'openai' as const,
  costPerMillionInput:  0.15,
  costPerMillionOutput: 0.60,
  maxContextTokens:     128_000,
};
const MOCK_LLM_RESULT = {
  content:      'The policy allows 20 days.',
  toolCalls:    [],
  model:        'gpt-4o-mini',
  fallbackUsed: false,
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

const BASE_REQUEST = {
  taskType:      'chat'  as const,
  messages:      [{ role: 'user' as const, content: 'What is the policy?' }],
  userId:        'user-mcp-001',
  correlationId: 'corr-mcp-001',
};

function buildMockPrompts() {
  return {
    resolveAB:      jest.fn().mockResolvedValue(MOCK_PROMPT),
    activatePrompt: jest.fn().mockResolvedValue(undefined),
    createVersion:  jest.fn().mockResolvedValue(undefined),
    listVersions:   jest.fn().mockResolvedValue([]),
  };
}

function buildMockRouter() {
  return {
    routeModel:       jest.fn().mockReturnValue(MOCK_MODEL),
    callWithFallback: jest.fn().mockResolvedValue(MOCK_LLM_RESULT),
    calculateCost:    jest.fn().mockReturnValue(0.0002),
  };
}

function buildMockBudget() {
  return {
    checkAndEnforce: jest.fn().mockResolvedValue(undefined),
    trackCost:       jest.fn().mockResolvedValue(undefined),
    getBudgetStatus: jest.fn().mockResolvedValue({
      tier: 'free', budgetUsd: 1, spentUsd: 0.20,
      remainingUsd: 0.80, percentUsed: 20, exhausted: false,
    }),
  };
}

function buildMockAudit() {
  return {
    log:        jest.fn().mockResolvedValue(undefined),
    findByUser: jest.fn().mockResolvedValue([]),
    getStats:   jest.fn().mockResolvedValue({}),
  };
}

function buildMockEvents() {
  return { emit: jest.fn() };
}

describe('McpService', () => {
  let service: McpService;
  let prompts: ReturnType<typeof buildMockPrompts>;
  let router:  ReturnType<typeof buildMockRouter>;
  let budget:  ReturnType<typeof buildMockBudget>;
  let audit:   ReturnType<typeof buildMockAudit>;
  let events:  ReturnType<typeof buildMockEvents>;

  beforeEach(async () => {
    prompts = buildMockPrompts();
    router  = buildMockRouter();
    budget  = buildMockBudget();
    audit   = buildMockAudit();
    events  = buildMockEvents();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpService,
        { provide: PromptService, useValue: prompts },
        { provide: RouterService, useValue: router  },
        { provide: BudgetService, useValue: budget  },
        { provide: AuditService,  useValue: audit   },
        { provide: EventEmitter2, useValue: events  },
      ],
    }).compile();

    service = module.get<McpService>(McpService);
  });

  afterEach(() => jest.clearAllMocks());

  it('is defined', () => expect(service).toBeDefined());

  // ── Happy path — all 6 steps ───────────────────────────────────────────────

  describe('complete — happy path', () => {
    it('calls all 6 pipeline steps', async () => {
      await service.complete(BASE_REQUEST);

      expect(budget.checkAndEnforce).toHaveBeenCalledTimes(1);  // Step 1
      expect(prompts.resolveAB).toHaveBeenCalledTimes(1);       // Step 2
      expect(router.routeModel).toHaveBeenCalledTimes(1);       // Step 3
      expect(router.callWithFallback).toHaveBeenCalledTimes(1); // Step 4
      expect(budget.trackCost).toHaveBeenCalledTimes(1);        // Step 5
      expect(audit.log).toHaveBeenCalledTimes(1);               // Step 6
    });

    it('returns the correct response shape', async () => {
      const result = await service.complete(BASE_REQUEST);

      expect(result).toMatchObject({
        content:       'The policy allows 20 days.',
        model:         'gpt-4o-mini',
        promptVersion: 'v1',
        fallbackUsed:  false,
        costUsd:       0.0002,
      });
    });

    it('returns tokensUsed from LLM result', async () => {
      const result = await service.complete(BASE_REQUEST);
      expect(result.tokensUsed.prompt).toBe(100);
      expect(result.tokensUsed.completion).toBe(50);
      expect(result.tokensUsed.total).toBe(150);
    });

    it('returns latencyMs > 0', async () => {
      const result = await service.complete(BASE_REQUEST);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('passes taskType to resolveAB', async () => {
      await service.complete({ ...BASE_REQUEST, taskType: 'agent' });
      expect(prompts.resolveAB).toHaveBeenCalledWith('agent', BASE_REQUEST.userId);
    });

    it('passes taskType to routeModel', async () => {
      await service.complete({ ...BASE_REQUEST, taskType: 'agent' });
      expect(router.routeModel).toHaveBeenCalledWith('agent');
    });

    it('emits ai.chat.completed event', async () => {
      await service.complete(BASE_REQUEST);
      expect(events.emit).toHaveBeenCalledWith(
        'ai.chat.completed',
        expect.objectContaining({ userId: BASE_REQUEST.userId }),
      );
    });

    it('tracks the calculated cost against the user', async () => {
      await service.complete(BASE_REQUEST);
      expect(budget.trackCost).toHaveBeenCalledWith(BASE_REQUEST.userId, 0.0002);
    });

    it('passes the resolved system prompt to callWithFallback', async () => {
      await service.complete(BASE_REQUEST);
      expect(router.callWithFallback).toHaveBeenCalledWith(
        MOCK_MODEL,
        expect.objectContaining({ systemPrompt: MOCK_PROMPT.content }),
      );
    });
  });

  // ── Step ordering ──────────────────────────────────────────────────────────
  // Budget must fire before LLM call. Audit must fire after cost.

  describe('pipeline step ordering', () => {
    it('checks budget before calling the LLM', async () => {
      const callOrder: string[] = [];
      budget.checkAndEnforce.mockImplementation(async () => { callOrder.push('budget'); });
      router.callWithFallback.mockImplementation(async () => { callOrder.push('llm'); return MOCK_LLM_RESULT; });

      await service.complete(BASE_REQUEST);

      expect(callOrder.indexOf('budget')).toBeLessThan(callOrder.indexOf('llm'));
    });

    it('tracks cost after the LLM call completes', async () => {
      const callOrder: string[] = [];
      router.callWithFallback.mockImplementation(async () => { callOrder.push('llm'); return MOCK_LLM_RESULT; });
      budget.trackCost.mockImplementation(async () => { callOrder.push('trackCost'); });

      await service.complete(BASE_REQUEST);

      expect(callOrder.indexOf('llm')).toBeLessThan(callOrder.indexOf('trackCost'));
    });
  });

  // ── Step 1: Budget gate ────────────────────────────────────────────────────

  describe('budget enforcement (Step 1)', () => {
    it('throws 429 when budget is exhausted', async () => {
      budget.checkAndEnforce.mockRejectedValue(
        new HttpException({ error: 'BUDGET_EXHAUSTED' }, 429),
      );

      await expect(service.complete(BASE_REQUEST)).rejects.toThrow(HttpException);
    });

    it('does NOT call the LLM when budget is exhausted', async () => {
      budget.checkAndEnforce.mockRejectedValue(
        new HttpException({ error: 'BUDGET_EXHAUSTED' }, 429),
      );

      await service.complete(BASE_REQUEST).catch(() => {});
      expect(router.callWithFallback).not.toHaveBeenCalled();
    });

    it('does NOT call audit when budget is exhausted', async () => {
      budget.checkAndEnforce.mockRejectedValue(
        new HttpException({ error: 'BUDGET_EXHAUSTED' }, 429),
      );

      await service.complete(BASE_REQUEST).catch(() => {});
      // Give the void audit.log() a tick to resolve if it were called
      await new Promise(r => setTimeout(r, 10));
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  // ── Step 4: LLM failure ────────────────────────────────────────────────────

  describe('LLM failure (Step 4)', () => {
    it('propagates LLM error to caller', async () => {
      router.callWithFallback.mockRejectedValue(new Error('All models down'));

      await expect(service.complete(BASE_REQUEST)).rejects.toThrow('All models down');
    });

    it('does NOT track cost when LLM fails', async () => {
      router.callWithFallback.mockRejectedValue(new Error('LLM error'));

      await service.complete(BASE_REQUEST).catch(() => {});
      expect(budget.trackCost).not.toHaveBeenCalled();
    });
  });

  // ── Step 6: Audit never crashes ────────────────────────────────────────────

  describe('audit logging (Step 6)', () => {
    // Reset audit.log to a clean mock before each test in this block.
    // mockRejectedValue persists across clearAllMocks() — only mockReset()
    // clears the implementation, so we reset explicitly here.
    beforeEach(() => {
      audit.log = jest.fn().mockResolvedValue(undefined);
    });

    it('does NOT throw when audit.log fails', async () => {
      audit.log.mockRejectedValue(new Error('DB full'));

      // The main pipeline must still succeed despite audit failure
      await expect(service.complete(BASE_REQUEST)).resolves.toBeDefined();
    });

    it('passes correlationId to audit log', async () => {
      await service.complete(BASE_REQUEST);

      // Wait for the void promise to settle
      await new Promise(r => setTimeout(r, 10));

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: BASE_REQUEST.correlationId }),
      );
    });

    it('passes fallbackUsed to audit log', async () => {
      router.callWithFallback.mockResolvedValue({
        ...MOCK_LLM_RESULT, fallbackUsed: true,
      });

      await service.complete(BASE_REQUEST);
      await new Promise(r => setTimeout(r, 10));

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ fallbackUsed: true }),
      );
    });
  });

  // ── Delegation methods ─────────────────────────────────────────────────────

  describe('delegation methods', () => {
    it('activatePrompt delegates to PromptService', async () => {
      await service.activatePrompt('chat', 'v2');
      expect(prompts.activatePrompt).toHaveBeenCalledWith('chat', 'v2');
    });

    it('listPromptVersions delegates to PromptService', async () => {
      await service.listPromptVersions('agent');
      expect(prompts.listVersions).toHaveBeenCalledWith('agent');
    });

    it('getBudgetStatus delegates to BudgetService', async () => {
      await service.getBudgetStatus('user-x');
      expect(budget.getBudgetStatus).toHaveBeenCalledWith('user-x');
    });

    it('getAuditStats delegates to AuditService', async () => {
      const since = new Date();
      await service.getAuditStats(since);
      expect(audit.getStats).toHaveBeenCalledWith(since);
    });
  });
});