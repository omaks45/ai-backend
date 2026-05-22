import { Test, TestingModule } from '@nestjs/testing';
import { RagService }          from './rag.service';
import { McpService }          from '../mcp/services/mcp.service';

// ─────────────────────────────────────────────────────────────────────────────
// RagService tests — post-MCP refactor
//
// RagService now has ONE dependency: McpService.
// ConfigService and EventEmitter2 are gone — the MCP handles providers,
// cost tracking, and event emission internally.
//
// Tests verify:
//   generate()      — delegates to mcp.complete(), shapes the RAGResponse
//   buildMessages() — pure message construction, no external deps
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_MCP_RESPONSE = {
  content:       'A phoneme is the smallest unit of sound.',
  toolCalls:     [],
  model:         'gpt-4o-mini',
  promptVersion: 'v1',
  tokensUsed:    { prompt: 100, completion: 50, total: 150 },
  costUsd:       0.0001,
  latencyMs:     800,
  fallbackUsed:  false,
};

const MOCK_CONTEXT = {
  contextText:  '[Source 1]\nA phoneme is the smallest unit of sound.',
  chunks: [
    {
      chunkId:       'chunk-1',
      documentId:    'doc-1',
      documentTitle: 'handbook.pdf',
      content:       'A phoneme is the smallest unit of sound.',
      chunkIndex:    0,
      score:         0.9,
      tokenCount:    50,
    },
  ],
  citations: [
    {
      index:         1,
      chunkId:       'chunk-1',
      documentId:    'doc-1',
      documentTitle: 'handbook.pdf',
      chunkIndex:    0,
      score:         0.9,
    },
  ],
  totalTokens: 50,
};

const EMPTY_CONTEXT = {
  contextText:  '',
  chunks:       [],
  citations:    [],
  totalTokens:  0,
};

function buildMockMcp() {
  return {
    complete: jest.fn().mockResolvedValue(MOCK_MCP_RESPONSE),
  };
}

describe('RagService', () => {
  let service: RagService;
  let mcp:     ReturnType<typeof buildMockMcp>;

  beforeEach(async () => {
    mcp = buildMockMcp();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: McpService, useValue: mcp },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
  });

  afterEach(() => jest.clearAllMocks());

  it('is defined', () => expect(service).toBeDefined());

  // ── generate() ─────────────────────────────────────────────────────────────

  describe('generate()', () => {
    const BASE_OPTIONS = {
      question:            'What is a phoneme?',
      context:             MOCK_CONTEXT,
      conversationHistory: [],
      userId:              'user-rag-001',
      conversationId:      'conv-001',
      correlationId:       'corr-001',
    };

    it('calls mcp.complete once', async () => {
      await service.generate(BASE_OPTIONS);
      expect(mcp.complete).toHaveBeenCalledTimes(1);
    });

    it('calls mcp.complete with taskType chat', async () => {
      await service.generate(BASE_OPTIONS);
      expect(mcp.complete).toHaveBeenCalledWith(
        expect.objectContaining({ taskType: 'chat' }),
      );
    });

    it('passes userId to mcp.complete', async () => {
      await service.generate(BASE_OPTIONS);
      expect(mcp.complete).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-rag-001' }),
      );
    });

    it('passes correlationId to mcp.complete', async () => {
      await service.generate(BASE_OPTIONS);
      expect(mcp.complete).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'corr-001' }),
      );
    });

    it('returns answer from mcp.complete content', async () => {
      const result = await service.generate(BASE_OPTIONS);
      expect(result.answer).toBe('A phoneme is the smallest unit of sound.');
    });

    it('returns citations from the assembled context', async () => {
      const result = await service.generate(BASE_OPTIONS);
      expect(result.citations).toEqual(MOCK_CONTEXT.citations);
    });

    it('returns tokensUsed from mcp response', async () => {
      const result = await service.generate(BASE_OPTIONS);
      expect(result.tokensUsed).toEqual({ prompt: 100, completion: 50, total: 150 });
    });

    it('returns costUsd from mcp response', async () => {
      const result = await service.generate(BASE_OPTIONS);
      expect(result.costUsd).toBe(0.0001);
    });

    it('returns model from mcp response', async () => {
      const result = await service.generate(BASE_OPTIONS);
      expect(result.model).toBe('gpt-4o-mini');
    });

    it('sets provider to openai when model starts with gpt', async () => {
      const result = await service.generate(BASE_OPTIONS);
      expect(result.provider).toBe('openai');
    });

    it('sets provider to ollama when model does not start with gpt', async () => {
      mcp.complete.mockResolvedValue({ ...MOCK_MCP_RESPONSE, model: 'llama3.2' });
      const result = await service.generate(BASE_OPTIONS);
      expect(result.provider).toBe('ollama');
    });

    it('propagates mcp.complete errors to caller', async () => {
      mcp.complete.mockRejectedValue(new Error('Budget exhausted'));
      await expect(service.generate(BASE_OPTIONS)).rejects.toThrow('Budget exhausted');
    });
  });

  // ── buildMessages() ────────────────────────────────────────────────────────
  // buildMessages is pure data transformation — no external deps needed.

  describe('buildMessages()', () => {
    it('returns a user message when context has chunks', () => {
      const messages = service.buildMessages('What is a phoneme?', MOCK_CONTEXT, []);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
    });

    it('includes context text in the user message', () => {
      const messages = service.buildMessages('What is a phoneme?', MOCK_CONTEXT, []);
      expect(messages[0].content).toContain('relevant context');
    });

    it('includes the question in the user message', () => {
      const messages = service.buildMessages('What is a phoneme?', MOCK_CONTEXT, []);
      expect(messages[0].content).toContain('What is a phoneme?');
    });

    it('sends no-context message when chunks array is empty', () => {
      const messages = service.buildMessages('What is a phoneme?', EMPTY_CONTEXT, []);
      expect(messages[0].content).toContain('No relevant context');
    });

    it('includes conversation history before the user message', () => {
      const history = [
        { role: 'user'      as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi!'   },
      ];
      const messages = service.buildMessages('New question', MOCK_CONTEXT, history);
      // history[0], history[1], then the new user message = 3 total
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].content).toBe('Hi!');
    });

    it('caps history at maxHistoryMessages (default 10)', () => {
      const history = Array.from({ length: 15 }, (_, i) => ({
        role:    'user' as const,
        content: `message ${i}`,
      }));
      const messages = service.buildMessages('Q', MOCK_CONTEXT, history);
      // 10 history + 1 user message = 11
      expect(messages).toHaveLength(11);
    });

    it('does NOT include a system message — MCP prepends it', () => {
      const messages = service.buildMessages('Q', MOCK_CONTEXT, []);
      // buildMessages only returns user/assistant messages.
      // The system prompt is prepended by McpService from the DB.
      // Every message returned must have role 'user' or 'assistant'.
      const allUserOrAssistant = messages.every(
        m => m.role === 'user' || m.role === 'assistant',
      );
      expect(allUserOrAssistant).toBe(true);
    });
  });
});