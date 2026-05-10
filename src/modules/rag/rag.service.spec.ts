// Tests for the provider-agnostic RagService.
// The service supports two providers — tests run the same assertions against
// both by parameterising the provider via jest.each.

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService }       from '@nestjs/config';
import { EventEmitter2 }       from '@nestjs/event-emitter';
import { RagService }          from './rag.service';
import { AssembledContext }    from './context-assembler.service';

//  Helpers

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    chunks:      [{ chunkId: 'c1', documentId: 'd1', documentTitle: 'Doc', content: 'Some content.', chunkIndex: 0, score: 0.9, tokenCount: 50 }],
    contextText: '[Source 1: "Doc", Section 1]\nSome content.',
    totalTokens: 50,
    citations:   [{ index: 1, chunkId: 'c1', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 0, score: 0.9 }],
    ...overrides,
  };
}

// Shared mock fetch response — same OpenAI-compatible shape for both providers
// (RagService normalises Ollama responses to this shape internally)
const mockApiResponse = {
  choices: [{ message: { content: 'The answer is 42.' } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const mockEvents = { emit: jest.fn() };
// Suite 

describe('RagService', () => {
  let service: RagService;

  // Run all tests for both provider configurations
  describe.each([
    { provider: 'ollama', apiKey: '' },
    { provider: 'openai', apiKey: 'sk-test' },
  ])('provider=$provider', ({ provider, apiKey }) => {
    beforeEach(async () => {
      // Set env vars before the module loads so ragConfig() picks them up
      process.env.EMBEDDING_PROVIDER = provider;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RagService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn((key: string, def = '') => key === 'OPENAI_API_KEY' ? apiKey : def) },
          },
          { provide: EventEmitter2, useValue: mockEvents },
        ],
      }).compile();

      service = module.get<RagService>(RagService);
      jest.clearAllMocks();
      mockFetch.mockResolvedValue({ ok: true, json: async () => mockApiResponse });
    });

    afterAll(() => delete process.env.EMBEDDING_PROVIDER);

    it('is defined', () => expect(service).toBeDefined());

    it('returns answer, citations, tokensUsed, costUsd, model, and provider', async () => {
      const result = await service.generate({
        question:            'What is the answer?',
        context:             makeContext(),
        conversationHistory: [],
        userId:              'u1',
        conversationId:      'conv1',
        correlationId:       'corr1',
      });

      expect(result.answer).toBe('The answer is 42.');
      expect(result.citations).toHaveLength(1);
      expect(result.tokensUsed.prompt).toBe(100);
      expect(result.tokensUsed.completion).toBe(50);
      expect(result.tokensUsed.total).toBe(150);
      expect(result.costUsd).toBeGreaterThanOrEqual(0);
      expect(result.model).toBeTruthy();
      expect(result.provider).toBe(provider);
    });

    it('emits ai.chat.completed event with provider info', async () => {
      await service.generate({
        question:            'test',
        context:             makeContext(),
        conversationHistory: [],
        userId:              'u1',
        conversationId:      'conv1',
        correlationId:       'corr1',
      });

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'ai.chat.completed',
        expect.objectContaining({
          provider:         provider,
          userId:           'u1',
          conversationId:   'conv1',
          costUsd:          expect.any(Number),
        }),
      );
    });

    it('ollama cost is always $0; openai cost is > $0 for non-zero tokens', async () => {
      const result = await service.generate({
        question: 'test', context: makeContext(),
        conversationHistory: [], userId: 'u1', conversationId: 'c1', correlationId: 'r1',
      });

      if (provider === 'ollama') {
        expect(result.costUsd).toBe(0);
      } else {
        expect(result.costUsd).toBeGreaterThan(0);
      }
    });
  });

  // ── buildMessages — provider-neutral ───────────────────────────────────────

  describe('buildMessages()', () => {
    beforeEach(async () => {
      process.env.EMBEDDING_PROVIDER = 'ollama';
      const module = await Test.createTestingModule({
        providers: [
          RagService,
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
          { provide: EventEmitter2, useValue: mockEvents },
        ],
      }).compile();
      service = module.get(RagService);
    });

    afterAll(() => delete process.env.EMBEDDING_PROVIDER);

    it('first message is always the system prompt', () => {
      const msgs = service.buildMessages('q', makeContext(), []);
      expect(msgs[0].role).toBe('system');
    });

    it('includes context text in the user message when chunks exist', () => {
      const ctx  = makeContext();
      const msgs = service.buildMessages('my question', ctx, []);
      const user = msgs.find((m) => m.role === 'user')!;
      expect(user.content).toContain(ctx.contextText);
      expect(user.content).toContain('my question');
    });

    it('sends no-context message when chunks array is empty', () => {
      const ctx  = makeContext({ chunks: [], contextText: '', citations: [] });
      const msgs = service.buildMessages('anything', ctx, []);
      const user = msgs.find((m) => m.role === 'user')!;
      expect(user.content).toContain('No relevant context was found');
    });

    it('includes conversation history between system and user messages', () => {
      const history = [
        { role: 'user'      as const, content: 'prev question' },
        { role: 'assistant' as const, content: 'prev answer'   },
      ];
      const msgs = service.buildMessages('q', makeContext(), history);
      expect(msgs[1].content).toBe('prev question');
      expect(msgs[2].content).toBe('prev answer');
    });
  });
});