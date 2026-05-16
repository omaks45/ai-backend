import { Test, TestingModule } from '@nestjs/testing';
import { HttpService }         from '@nestjs/axios';
import { EventEmitter2 }       from '@nestjs/event-emitter';
import { of }                  from 'rxjs';
import { AgentExecutorService } from './agent-executor.service';
import { AgentMetricsService }  from './services/agent-metrics.service';
import { SearchService }        from '../../modules/search/search.service';
import { DocumentsService }     from '../../modules/documents/documents.service';

// ─────────────────────────────────────────────────────────────────────────────
// AgentExecutorService tests

//   1. HttpService added to DI providers — executor now uses it for LLM calls
//      instead of the removed openai.breaker dynamic import.
//   2. SearchService added to DI providers — injected into ToolContext so
//      search_documents tool can call context.searchService.search().
//   3. DocumentsService added to DI providers — injected into ToolContext so
//      get_document_summary tool can call context.documentsService.findOne().
//   4. callLLM spy unchanged — still controls all LLM output without network
//      calls. HttpService mock only needs to satisfy the DI container.
//
// Testing strategy stays the same: spy on the private callLLM method and
// control LLM output. All guardrail assertions are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

//  LLM response builders

function makeFinalAnswerResponse(
    answer     = 'The answer is 42.',
    sources    = ['handbook.pdf'],
    confidence = 'high',
    ) {
    return {
        usage:   { prompt_tokens: 100, completion_tokens: 50 },
        choices: [{
        message: {
            role:       'assistant',
            content:    null,
            tool_calls: [{
            id:       'call_001',
            type:     'function',
            function: {
                name:      'final_answer',
                arguments: JSON.stringify({ answer, sources, confidence }),
            },
            }],
        },
        }],
    };
}

function makeSearchResponse(query = 'parental leave') {
    return {
        usage:   { prompt_tokens: 80, completion_tokens: 30 },
        choices: [{
        message: {
            role:       'assistant',
            content:    null,
            tool_calls: [{
            id:       'call_search_001',
            type:     'function',
            function: {
                name:      'search_documents',
                arguments: JSON.stringify({ query, topK: 5 }),
            },
            }],
        },
        }],
    };
}

function makePlainTextResponse(text = 'Here is my answer.') {
    return {
        usage:   { prompt_tokens: 60, completion_tokens: 40 },
        choices: [{
        message: {
            role:       'assistant',
            content:    text,
            tool_calls: [],
        },
        }],
    };
}

function makeUnknownToolResponse() {
    return {
        usage:   { prompt_tokens: 70, completion_tokens: 20 },
        choices: [{
        message: {
            role:       'assistant',
            content:    null,
            tool_calls: [{
            id:       'call_ghost',
            type:     'function',
            function: {
                name:      'browse_the_web',
                arguments: JSON.stringify({ url: 'https://example.com' }),
            },
            }],
        },
        }],
    };
}

function makeInvalidArgsResponse() {
    return {
        usage:   { prompt_tokens: 70, completion_tokens: 20 },
        choices: [{
        message: {
            role:       'assistant',
            content:    null,
            tool_calls: [{
            id:       'call_bad_args',
            type:     'function',
            function: {
                name:      'search_documents',
                arguments: JSON.stringify({ topK: 5 }), // missing required `query`
            },
            }],
        },
        }],
    };
}

// Mock factories

function buildMockMetrics(): jest.Mocked<AgentMetricsService> {
    return {
        recordRun:           jest.fn(),
        recordToolCall:      jest.fn(),
        getMetrics:          jest.fn().mockResolvedValue(''),
        getContentType:      jest.fn().mockReturnValue('text/plain'),
        agentIterations:     {} as any,
        agentCostUsd:        {} as any,
        agentTerminations:   {} as any,
        agentToolCallsTotal: {} as any,
        agentDurationSeconds:{} as any,
        agentRunsTotal:      {} as any,
    } as unknown as jest.Mocked<AgentMetricsService>;
}

function buildMockEvents(): jest.Mocked<EventEmitter2> {
    return { emit: jest.fn() } as unknown as jest.Mocked<EventEmitter2>;
}

/**
 * HttpService mock — satisfies NestJS DI but is never actually called because
 * callLLM is spied on and short-circuits before HttpService.post() is reached.
 */
function buildMockHttpService(): jest.Mocked<HttpService> {
    return {
        post: jest.fn().mockReturnValue(of({ data: {} })),
        get:  jest.fn().mockReturnValue(of({ data: {} })),
    } as unknown as jest.Mocked<HttpService>;
}

/**
 * SearchService mock — satisfies DI and is the value placed in ToolContext.
 * search_documents tool calls context.searchService.search() so this must
 * return a valid SearchResult array to avoid handler crashes.
 */
function buildMockSearch(): jest.Mocked<SearchService> {
    return {
        search: jest.fn().mockResolvedValue([
        {
            chunkId:       'chunk-1',
            documentId:    'doc-1',
            documentTitle: 'Employee Handbook',
            content:       'Parental leave is 12 weeks.',
            chunkIndex:    0,
            score:         0.92,
            tokenCount:    50,
        },
        ]),
    } as unknown as jest.Mocked<SearchService>;
}

/**
 * DocumentsService mock — satisfies DI and ToolContext.
 * get_document_summary tool calls context.documentsService.findOne().
 */
function buildMockDocuments(): jest.Mocked<DocumentsService> {
    return {
        findOne: jest.fn().mockResolvedValue({
        id:         'doc-1',
        title:      'Employee Handbook',
        chunkCount: 42,
        status:     'ready',
        createdAt:  new Date('2024-01-01'),
        }),
        findAll: jest.fn().mockResolvedValue({
        data: [{ id: 'doc-1', title: 'Employee Handbook' }],
        meta: { page: 1, limit: 100, total: 1 },
        }),
    } as unknown as jest.Mocked<DocumentsService>;
}

// Shared setup

describe('AgentExecutorService', () => {
    let service:    AgentExecutorService;
    let metrics:    jest.Mocked<AgentMetricsService>;
    let events:     jest.Mocked<EventEmitter2>;
    let httpService: jest.Mocked<HttpService>;
    let search:     jest.Mocked<SearchService>;
    let documents:  jest.Mocked<DocumentsService>;
    let callLLMSpy: jest.SpyInstance;

    const BASE_OPTIONS = {
        question:      'What is the parental leave policy?',
        userId:        'user-abc-123',
        correlationId: 'corr-xyz-456',
    };

    beforeEach(async () => {
        metrics     = buildMockMetrics();
        events      = buildMockEvents();
        httpService = buildMockHttpService();
        search      = buildMockSearch();
        documents   = buildMockDocuments();

        const module: TestingModule = await Test.createTestingModule({
        providers: [
            AgentExecutorService,
            { provide: AgentMetricsService, useValue: metrics     },
            { provide: EventEmitter2,       useValue: events      },
            { provide: HttpService,         useValue: httpService },
            { provide: SearchService,       useValue: search      },
            { provide: DocumentsService,    useValue: documents   },
        ],
        }).compile();

        service = module.get<AgentExecutorService>(AgentExecutorService);

        // Spy on private callLLM — controls all LLM output without network I/O.
        // HttpService.post is never reached because this spy intercepts first.
        callLLMSpy = jest
        .spyOn(service as any, 'callLLM')
        .mockResolvedValue(makeFinalAnswerResponse());
    });

    afterEach(() => jest.restoreAllMocks());

    // Instantiation

    it('is defined', () => expect(service).toBeDefined());

    //  Happy path: clean completion

    describe('happy path — final_answer on first iteration', () => {
        it('returns terminationReason "completed"', async () => {
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.terminationReason).toBe('completed');
        });

        it('returns the answer from final_answer args', async () => {
        callLLMSpy.mockResolvedValue(makeFinalAnswerResponse('Policy is 12 weeks.'));
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.answer).toBe('Policy is 12 weeks.');
        });

        it('returns the sources from final_answer args', async () => {
        callLLMSpy.mockResolvedValue(
            makeFinalAnswerResponse('Answer', ['handbook.pdf', 'policy.docx']),
        );
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.sources).toEqual(['handbook.pdf', 'policy.docx']);
        });

        it('returns the confidence level from final_answer', async () => {
        callLLMSpy.mockResolvedValue(makeFinalAnswerResponse('Answer', [], 'high'));
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.confidence).toBe('high');
        });

        it('records iterations = 1', async () => {
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.iterations).toBe(1);
        });

        it('adds a trace entry for the final_answer call', async () => {
        const result = await service.runAgent(BASE_OPTIONS);
        const finalStep = result.trace.find(s => s.tool === 'final_answer');
        expect(finalStep).toBeDefined();
        expect(finalStep?.phase).toBe('act');
        });

        it('emits agent:completed event', async () => {
        await service.runAgent(BASE_OPTIONS);
        expect(events.emit).toHaveBeenCalledWith(
            'agent:completed',
            expect.objectContaining({
            userId:        BASE_OPTIONS.userId,
            correlationId: BASE_OPTIONS.correlationId,
            }),
        );
        });

        it('calls metrics.recordToolCall with final_answer success', async () => {
        await service.runAgent(BASE_OPTIONS);
        expect(metrics.recordToolCall).toHaveBeenCalledWith('final_answer', 'success');
        });
    });

    // Multi-step: search → final_answer

    describe('multi-step path — search then final_answer', () => {
        it('completes after search + final_answer iterations', async () => {
        callLLMSpy
            .mockResolvedValueOnce(makeSearchResponse())
            .mockResolvedValueOnce(makeFinalAnswerResponse('Policy found.'));

        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.terminationReason).toBe('completed');
        expect(result.answer).toBe('Policy found.');
        });

        it('records 2 iterations', async () => {
        callLLMSpy
            .mockResolvedValueOnce(makeSearchResponse())
            .mockResolvedValueOnce(makeFinalAnswerResponse());

        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.iterations).toBe(2);
        });

        it('records a tool call for search_documents', async () => {
        callLLMSpy
            .mockResolvedValueOnce(makeSearchResponse())
            .mockResolvedValueOnce(makeFinalAnswerResponse());

        await service.runAgent(BASE_OPTIONS);

        expect(metrics.recordToolCall).toHaveBeenCalledWith(
            'search_documents',
            'success',
        );
        });

        it('calls SearchService.search with the correct query', async () => {
        callLLMSpy
            .mockResolvedValueOnce(makeSearchResponse('parental leave'))
            .mockResolvedValueOnce(makeFinalAnswerResponse());

        await service.runAgent(BASE_OPTIONS);

        expect(search.search).toHaveBeenCalledWith(
            expect.objectContaining({ query: 'parental leave' }),
        );
        });
    });

    //  Guardrail 1a: timeout

    describe('guardrail — timeout', () => {
        it('returns terminationReason "timeout" when elapsed exceeds timeoutMs', async () => {
        const result = await service.runAgent({
            ...BASE_OPTIONS,
            config: { timeoutMs: 0 },
        });
        expect(result.terminationReason).toBe('timeout');
        });

        it('returns confidence "low" on timeout', async () => {
        const result = await service.runAgent({
            ...BASE_OPTIONS,
            config: { timeoutMs: 0 },
        });
        expect(result.confidence).toBe('low');
        });

        it('emits agent:completed even on timeout', async () => {
        await service.runAgent({ ...BASE_OPTIONS, config: { timeoutMs: 0 } });
        expect(events.emit).toHaveBeenCalledWith(
            'agent:completed',
            expect.objectContaining({ terminationReason: 'timeout' }),
        );
        });
    });

    // Guardrail 1b: iteration limit

    describe('guardrail — iteration limit', () => {
        it('returns terminationReason "iteration_limit" when loop exhausted', async () => {
        callLLMSpy.mockResolvedValue(makeUnknownToolResponse());

        const result = await service.runAgent({
            ...BASE_OPTIONS,
            config: { maxIterations: 2, costCeilingUsd: 0 },
        });

        expect(result.terminationReason).toBe('iteration_limit');
        });

        it('returns confidence "low" when iteration limit hit', async () => {
        callLLMSpy.mockResolvedValue(makeUnknownToolResponse());

        const result = await service.runAgent({
            ...BASE_OPTIONS,
            config: { maxIterations: 2, costCeilingUsd: 0 },
        });

        expect(result.confidence).toBe('low');
        });
    });

    // Guardrail 2: cost ceiling

    describe('guardrail — cost ceiling', () => {
        it('stops when cost exceeds the ceiling', async () => {
        callLLMSpy.mockResolvedValue({
            usage:   { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
            choices: [{
            message: {
                role: 'assistant', content: null,
                tool_calls: [{
                id: 'call_1', type: 'function',
                function: { name: 'browse_the_web', arguments: '{}' },
                }],
            },
            }],
        });

        const result = await service.runAgent({
            ...BASE_OPTIONS,
            config: { maxIterations: 10, costCeilingUsd: 0.01 },
        });

        expect(['cost_limit', 'iteration_limit']).toContain(result.terminationReason);
        });

        it('skips cost check when costCeilingUsd is 0 (Ollama)', async () => {
        callLLMSpy.mockResolvedValue(makeFinalAnswerResponse());
        const result = await service.runAgent({
            ...BASE_OPTIONS,
            config: { costCeilingUsd: 0 },
        });
        expect(result.terminationReason).toBe('completed');
        });
    });

    //  Guardrail 3: tool whitelist

    describe('guardrail — tool whitelist', () => {
        it('rejects an unknown tool name', async () => {
        callLLMSpy
            .mockResolvedValueOnce(makeUnknownToolResponse())
            .mockResolvedValueOnce(makeFinalAnswerResponse());

        await service.runAgent(BASE_OPTIONS);

        expect(metrics.recordToolCall).toHaveBeenCalledWith('browse_the_web', 'rejected');
        });

        it('continues the loop after rejecting the unknown tool', async () => {
        callLLMSpy
            .mockResolvedValueOnce(makeUnknownToolResponse())
            .mockResolvedValueOnce(makeFinalAnswerResponse('Recovered answer.'));

        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.terminationReason).toBe('completed');
        expect(result.answer).toBe('Recovered answer.');
        });
    });

    //  Guardrail 4: input validation

    describe('guardrail — input validation', () => {
        it('rejects invalid args and continues the loop', async () => {
        callLLMSpy
            .mockResolvedValueOnce(makeInvalidArgsResponse())
            .mockResolvedValueOnce(makeFinalAnswerResponse('Fixed answer.'));

        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.terminationReason).toBe('completed');
        expect(metrics.recordToolCall).toHaveBeenCalledWith('search_documents', 'error');
        });
    });

    //  Guardrail 5: execution trace

    describe('guardrail — execution trace', () => {
        it('trace is non-empty after a completed run', async () => {
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.trace.length).toBeGreaterThan(0);
        });

        it('every trace step has phase, step, durationMs, costUsd', async () => {
        const result = await service.runAgent(BASE_OPTIONS);
        for (const step of result.trace) {
            expect(step).toMatchObject({
            step:       expect.any(Number),
            phase:      expect.stringMatching(/^(think|act|observe)$/),
            durationMs: expect.any(Number),
            costUsd:    expect.any(Number),
            });
        }
        });

        it('trace captures the rejected unknown tool call', async () => {
        callLLMSpy
            .mockResolvedValueOnce(makeUnknownToolResponse())
            .mockResolvedValueOnce(makeFinalAnswerResponse());

        const result      = await service.runAgent(BASE_OPTIONS);
        const rejectedStep = result.trace.find(s => s.tool === 'browse_the_web');
        expect(rejectedStep).toBeDefined();
        expect((rejectedStep?.output as any)?.error).toBe('Unknown tool');
        });

        it('trace captures successful search_documents observe step', async () => {
        callLLMSpy
            .mockResolvedValueOnce(makeSearchResponse())
            .mockResolvedValueOnce(makeFinalAnswerResponse());

        const result        = await service.runAgent(BASE_OPTIONS);
        const observeStep   = result.trace.find(
            s => s.tool === 'search_documents' && s.phase === 'observe',
        );
        expect(observeStep).toBeDefined();
        });
    });

    // Plain-text fallback (Ollama)

    describe('plain-text response fallback', () => {
        it('treats a no-tool-call response as completed', async () => {
        callLLMSpy.mockResolvedValue(makePlainTextResponse('Direct answer.'));
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.terminationReason).toBe('completed');
        expect(result.answer).toBe('Direct answer.');
        });

        it('sets confidence to "medium" for plain-text responses', async () => {
        callLLMSpy.mockResolvedValue(makePlainTextResponse());
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.confidence).toBe('medium');
        });
    });

    // LLM call failure

    describe('LLM call failure', () => {
        it('returns terminationReason "error" when LLM throws', async () => {
        callLLMSpy.mockRejectedValue(new Error('Network error'));
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.terminationReason).toBe('error');
        });

        it('returns confidence "low" on LLM error', async () => {
        callLLMSpy.mockRejectedValue(new Error('Network error'));
        const result = await service.runAgent(BASE_OPTIONS);
        expect(result.confidence).toBe('low');
        });
    });

    // Document list injection

    describe('document list in system prompt', () => {
        it('includes document titles in the system message', async () => {
        await service.runAgent({
            ...BASE_OPTIONS,
            availableDocs: [
            { id: 'doc-1', title: 'Employee Handbook 2024' },
            { id: 'doc-2', title: 'Benefits Policy'        },
            ],
        });

        const systemMsg = (callLLMSpy.mock.calls[0][1] as Array<{ role: string; content: string }>)
            .find(m => m.role === 'system');

        expect(systemMsg?.content).toContain('Employee Handbook 2024');
        expect(systemMsg?.content).toContain('Benefits Policy');
        });

        it('shows fallback text when no documents available', async () => {
        await service.runAgent({ ...BASE_OPTIONS, availableDocs: [] });

        const systemMsg = (callLLMSpy.mock.calls[0][1] as Array<{ role: string; content: string }>)
            .find(m => m.role === 'system');

        expect(systemMsg?.content).toContain('No documents uploaded yet');
        });
    });

    // Cost tracking

    describe('cost tracking', () => {
        it('returns 0 totalCostUsd for Ollama (costCeilingUsd: 0)', async () => {
        const result = await service.runAgent({
            ...BASE_OPTIONS,
            config: { costCeilingUsd: 0 },
        });
        expect(result.totalCostUsd).toBe(0);
        });
    });
});