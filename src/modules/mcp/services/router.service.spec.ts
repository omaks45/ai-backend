import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService }       from '@nestjs/config';
import { RouterService }       from './router.service';

// ─────────────────────────────────────────────────────────────────────────────
// RouterService tests
//
// Covers:
//   routeModel        — correct model per task type, Ollama override
//   calculateCost     — correct math for OpenAI pricing, 0 for Ollama
//   callWithFallback  — success on first try, fallback on primary failure,
//                       throw when all models fail, fallbackUsed flag
// ─────────────────────────────────────────────────────────────────────────────

function buildMockConfig(provider = 'openai') {
  const map: Record<string, string> = {
    OPENAI_API_KEY:      'sk-test-key',
    OLLAMA_API_BASE:     'http://localhost:11434',
    OLLAMA_CHAT_MODEL:   'llama3.2',
    EMBEDDING_PROVIDER:  provider,
    NODE_ENV:            'test',
  };
  return { get: jest.fn((key: string, def = '') => map[key] ?? def) };
}

function makeSuccessResponse(model = 'gpt-4o-mini', content = 'Test answer') {
  return {
    ok:   true,
    json: jest.fn().mockResolvedValue({
      choices: [{ message: { content, tool_calls: [] } }],
      usage:   { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
    text: jest.fn().mockResolvedValue(''),
  };
}

function makeErrorResponse(status = 500, body = 'Internal Server Error') {
  return {
    ok:   false,
    json: jest.fn(),
    text: jest.fn().mockResolvedValue(body),
    status,
  };
}

describe('RouterService', () => {
    let service: RouterService;

    const BASE_REQUEST = {
        systemPrompt:  'You are helpful.',
        messages:      [{ role: 'user' as const, content: 'What is the policy?' }],
        correlationId: 'corr-router-001',
    };

    async function createService(provider = 'openai') {
        const module: TestingModule = await Test.createTestingModule({
        providers: [
            RouterService,
            { provide: ConfigService, useValue: buildMockConfig(provider) },
        ],
        }).compile();
        service = module.get<RouterService>(RouterService);
    }

    afterEach(() => jest.restoreAllMocks());

    it('is defined', async () => {
        await createService();
        expect(service).toBeDefined();
    });

    // ── routeModel ─────────────────────────────────────────────────────────────

    describe('routeModel (OpenAI provider)', () => {
        beforeEach(() => createService('openai'));

        it('routes chat to gpt-4o-mini', () => {
        const model = service.routeModel('chat');
        expect(model.name).toBe('gpt-4o-mini');
        });

        it('routes summary to gpt-4o-mini', () => {
        const model = service.routeModel('summary');
        expect(model.name).toBe('gpt-4o-mini');
        });

        it('routes agent to gpt-4o', () => {
        const model = service.routeModel('agent');
        expect(model.name).toBe('gpt-4o');
        });

        it('returns a model with costPerMillionInput > 0 for OpenAI', () => {
        const model = service.routeModel('chat');
        expect(model.costPerMillionInput).toBeGreaterThan(0);
        });
    });

    describe('routeModel (Ollama provider)', () => {
        beforeEach(() => createService('ollama'));

        it('routes all tasks to the local Ollama model', () => {
        expect(service.routeModel('chat').provider).toBe('ollama');
        expect(service.routeModel('agent').provider).toBe('ollama');
        expect(service.routeModel('summary').provider).toBe('ollama');
        });

        it('returns 0 cost for Ollama model', () => {
        const model = service.routeModel('chat');
        expect(model.costPerMillionInput).toBe(0);
        expect(model.costPerMillionOutput).toBe(0);
        });
    });

    // ── calculateCost ──────────────────────────────────────────────────────────

    describe('calculateCost', () => {
        beforeEach(() => createService('openai'));

        it('calculates cost correctly for gpt-4o-mini', () => {
        // gpt-4o-mini: $0.15/M input, $0.60/M output
        // 1000 input + 500 output = 0.00015 + 0.0003 = 0.00045
        const cost = service.calculateCost('gpt-4o-mini', {
            prompt_tokens:     1_000,
            completion_tokens: 500,
        });
        expect(cost).toBeCloseTo(0.00045, 6);
        });

        it('calculates cost correctly for gpt-4o', () => {
        // gpt-4o: $2.50/M input, $10.00/M output
        // 1000 input + 500 output = 0.0025 + 0.005 = 0.0075
        const cost = service.calculateCost('gpt-4o', {
            prompt_tokens:     1_000,
            completion_tokens: 500,
        });
        expect(cost).toBeCloseTo(0.0075, 6);
        });

        it('returns 0 cost for unknown model (Ollama)', () => {
        const cost = service.calculateCost('llama3.2', {
            prompt_tokens:     1_000,
            completion_tokens: 500,
        });
        expect(cost).toBe(0);
        });

        it('returns 0 when token counts are 0', () => {
        const cost = service.calculateCost('gpt-4o-mini', {
            prompt_tokens:     0,
            completion_tokens: 0,
        });
        expect(cost).toBe(0);
        });

        it('gpt-4o costs more than gpt-4o-mini for the same tokens', () => {
        const usage = { prompt_tokens: 1_000, completion_tokens: 500 };
        const cheapCost    = service.calculateCost('gpt-4o-mini', usage);
        const premiumCost  = service.calculateCost('gpt-4o',      usage);

        expect(premiumCost).toBeGreaterThan(cheapCost);
        });
    });

    // ── callWithFallback ───────────────────────────────────────────────────────

    describe('callWithFallback (OpenAI provider)', () => {
        beforeEach(() => createService('openai'));

        it('returns result on first successful call', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(makeSuccessResponse() as any);

        const model  = service.routeModel('chat');
        const result = await service.callWithFallback(model, BASE_REQUEST);

        expect(result.content).toBe('Test answer');
        expect(result.fallbackUsed).toBe(false);
        });

        it('sets fallbackUsed = false on primary success', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(makeSuccessResponse() as any);

        const result = await service.callWithFallback(service.routeModel('chat'), BASE_REQUEST);
        expect(result.fallbackUsed).toBe(false);
        });

        it('uses fallback model when primary fails', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch')
            .mockRejectedValueOnce(new Error('Primary failed'))
            .mockResolvedValueOnce(makeSuccessResponse('gpt-4o-mini', 'Fallback answer') as any);

        const model  = service.routeModel('agent'); // gpt-4o primary
        const result = await service.callWithFallback(model, BASE_REQUEST);

        expect(result.content).toBe('Fallback answer');
        expect(result.fallbackUsed).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        });

        it('throws when all models in chain fail', async () => {
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('All down'));

        await expect(
            service.callWithFallback(service.routeModel('chat'), BASE_REQUEST),
        ).rejects.toThrow();
        });

        it('throws when API returns non-OK status', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(
            makeErrorResponse(429, 'Rate limit exceeded') as any,
        );

        await expect(
            service.callWithFallback(service.routeModel('chat'), BASE_REQUEST),
        ).rejects.toThrow(/429/);
        });

        it('includes usage in the result', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(makeSuccessResponse() as any);

        const result = await service.callWithFallback(service.routeModel('chat'), BASE_REQUEST);
        expect(result.usage.prompt_tokens).toBe(100);
        expect(result.usage.completion_tokens).toBe(50);
        expect(result.usage.total_tokens).toBe(150);
        });

        it('returns the actual model name used', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(makeSuccessResponse('gpt-4o-mini') as any);

        const result = await service.callWithFallback(service.routeModel('chat'), BASE_REQUEST);
        expect(result.model).toBe('gpt-4o-mini');
        });
    });
});