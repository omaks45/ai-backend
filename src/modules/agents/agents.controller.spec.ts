import { Test, TestingModule }   from '@nestjs/testing';
import { HttpStatus }            from '@nestjs/common';
import { AgentController }       from './agents.controller';
import { AgentExecutorService }  from './agent-executor.service';
import { DocumentsService }      from '../documents/documents.service';

// ─────────────────────────────────────────────────────────────────────────────
// AgentController tests
//
// The controller has exactly one responsibility: wire the HTTP request into
// the executor and return the result. Tests verify:
//   1. It calls executor.runAgent with the correct arguments
//   2. It fetches documents and passes them as availableDocs
//   3. It shapes the response correctly (answer, sources, confidence, metadata)
//   4. It returns 200 for every termination reason — clients read terminationReason
//
// Guards (JwtAuthGuard, PermissionsGuard) are overridden with pass-through
// mocks — guard logic is tested in their own spec files, not here.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared mock factories ─────────────────────────────────────────────────────

function buildMockExecutor() {
  return {
    runAgent: jest.fn().mockResolvedValue({
      answer:            'Parental leave is 12 weeks.',
      sources:           ['handbook.pdf'],
      confidence:        'high',
      iterations:        2,
      totalCostUsd:      0.04,
      terminationReason: 'completed',
      trace:             [],
    }),
  };
}

function buildMockDocuments() {
  return {
    findAll: jest.fn().mockResolvedValue({
      data: [
        { id: 'doc-1', title: 'Employee Handbook' },
        { id: 'doc-2', title: 'Benefits Policy'   },
      ],
      meta: { page: 1, limit: 100, total: 2 },
    }),
  };
}

/** Builds a minimal Express-like request object */
function buildRequest(correlationId = 'corr-test-001') {
  return { correlationId, user: { id: 'user-test-001' } } as any;
}

const SAMPLE_USER = { id: 'user-test-001' };
const SAMPLE_DTO  = { question: 'What is the parental leave policy?' };

// Test suite

describe('AgentController', () => {
  let controller: AgentController;
  let executor:   ReturnType<typeof buildMockExecutor>;
  let documents:  ReturnType<typeof buildMockDocuments>;

  beforeEach(async () => {
    executor  = buildMockExecutor();
    documents = buildMockDocuments();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        { provide: AgentExecutorService, useValue: executor  },
        { provide: DocumentsService,     useValue: documents },
      ],
    })
      // Override guards so they don't block controller tests.
      // Guard logic is tested separately in guards spec files.
      .overrideGuard(require('../../common/guards/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/guards/permissions.guard').PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentController>(AgentController);
  });

  afterEach(() => jest.clearAllMocks());

  it('is defined', () => expect(controller).toBeDefined());

  //  research() — happy path

  describe('research()', () => {
    it('calls executor.runAgent once', async () => {
      await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(executor.runAgent).toHaveBeenCalledTimes(1);
    });

    it('passes the question to executor.runAgent', async () => {
      await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(executor.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ question: SAMPLE_DTO.question }),
      );
    });

    it('passes the userId to executor.runAgent', async () => {
      await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(executor.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: SAMPLE_USER.id }),
      );
    });

    it('passes the correlationId from the request', async () => {
      await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest('corr-custom'));
      expect(executor.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'corr-custom' }),
      );
    });

    it('fetches documents and passes them as availableDocs', async () => {
      await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());

      expect(executor.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          availableDocs: [
            { id: 'doc-1', title: 'Employee Handbook' },
            { id: 'doc-2', title: 'Benefits Policy'   },
          ],
        }),
      );
    });

    it('calls documents.findAll with the correct userId', async () => {
      await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(documents.findAll).toHaveBeenCalledWith(
        SAMPLE_USER.id,
        expect.objectContaining({ page: 1, limit: 100 }),
      );
    });
  });

  // Response shape

  describe('response shape', () => {
    it('returns answer from executor result', async () => {
      const result = await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(result.answer).toBe('Parental leave is 12 weeks.');
    });

    it('returns sources from executor result', async () => {
      const result = await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(result.sources).toEqual(['handbook.pdf']);
    });

    it('returns confidence from executor result', async () => {
      const result = await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(result.confidence).toBe('high');
    });

    it('returns metadata.iterations', async () => {
      const result = await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(result.metadata.iterations).toBe(2);
    });

    it('returns metadata.costUsd rounded to 4 decimal places', async () => {
      const result = await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(result.metadata.costUsd).toBe(0.04);
    });

    it('returns metadata.terminationReason', async () => {
      const result = await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(result.metadata.terminationReason).toBe('completed');
    });

    it('does NOT expose the trace in the response', async () => {
      const result = await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect((result as any).trace).toBeUndefined();
    });
  });

  // Guardrail terminations still return a result
  //
  // The controller always returns 200 regardless of terminationReason.
  // Clients read terminationReason to decide how to present partial results.

  describe('guardrail terminations', () => {
    const guardrailCases: Array<{
      reason:     string;
      answer:     string;
      confidence: string;
    }> = [
      { reason: 'iteration_limit', answer: 'Partial: iteration limit reached.', confidence: 'low'  },
      { reason: 'timeout',         answer: 'Partial: timed out.',               confidence: 'low'  },
      { reason: 'cost_limit',      answer: 'Partial: cost ceiling hit.',        confidence: 'low'  },
      { reason: 'error',           answer: 'An error occurred.',                confidence: 'low'  },
    ];

    for (const { reason, answer, confidence } of guardrailCases) {
      it(`returns the partial answer for terminationReason "${reason}"`, async () => {
        executor.runAgent.mockResolvedValueOnce({
          answer,
          sources:           [],
          confidence,
          iterations:        5,
          totalCostUsd:      0.20,
          terminationReason: reason,
          trace:             [],
        });

        const result = await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());

        expect(result.answer).toBe(answer);
        expect(result.metadata.terminationReason).toBe(reason);
        expect(result.confidence).toBe('low');
      });
    }
  });

  //  Empty document list 

  describe('no documents available', () => {
    it('passes empty availableDocs when user has no documents', async () => {
      documents.findAll.mockResolvedValueOnce({ data: [], meta: { total: 0 } });

      await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());

      expect(executor.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ availableDocs: [] }),
      );
    });
  });

  //  costUsd precision

  describe('costUsd formatting', () => {
    it('rounds to 4 decimal places', async () => {
      executor.runAgent.mockResolvedValueOnce({
        answer: 'ok', sources: [], confidence: 'high',
        iterations: 1, totalCostUsd: 0.123456789,
        terminationReason: 'completed', trace: [],
      });

      const result = await controller.research(SAMPLE_DTO, SAMPLE_USER, buildRequest());
      expect(result.metadata.costUsd).toBe(0.1235);
    });
  });
});