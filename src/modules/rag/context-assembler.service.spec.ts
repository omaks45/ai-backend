import { Test, TestingModule } from '@nestjs/testing';
import { ContextAssemblerService } from './context-assembler.service';
import { SearchResult }            from '../search/search.service';

// Force the OpenAI provider so contextTokenBudget is always 3_500,
// regardless of the local NODE_ENV / EMBEDDING_PROVIDER env vars.
// Without this, the test runner defaults to OLLAMA_CONFIG (budget 2_500)
// and chunks that total 3_000 or 3_400 tokens are rejected by the assembler.
beforeAll(() => {
    process.env.EMBEDDING_PROVIDER = 'openai';
});

afterAll(() => {
    delete process.env.EMBEDDING_PROVIDER;
});

function makeChunk(overrides: Partial<SearchResult> = {}): SearchResult {
    return {
        chunkId:       'chunk-1',
        documentId:    'doc-1',
        documentTitle: 'Test Doc',
        content:       'Some content here.',
        chunkIndex:    0,
        score:         0.85,
        tokenCount:    100,
        ...overrides,
    };
}

describe('ContextAssemblerService', () => {
    let service: ContextAssemblerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [ContextAssemblerService],
        }).compile();
        service = module.get<ContextAssemblerService>(ContextAssemblerService);
    });

    it('is defined', () => expect(service).toBeDefined());

    // assemble() — happy path

    describe('assemble()', () => {
        it('returns empty context for empty results', () => {
            const ctx = service.assemble([]);
            expect(ctx.chunks).toHaveLength(0);
            expect(ctx.contextText).toBe('');
            expect(ctx.totalTokens).toBe(0);
            expect(ctx.citations).toHaveLength(0);
        });

        it('selects chunks within token budget', () => {
            // 4 chunks × 1_000 tokens each = 4_000 total.
            // Budget is 3_500, so only the first 3 (3_000 tokens) fit.
            const chunks = [
                makeChunk({ chunkId: 'c1', documentId: 'doc-1', chunkIndex: 0,  tokenCount: 1000 }),
                makeChunk({ chunkId: 'c2', documentId: 'doc-2', chunkIndex: 10, tokenCount: 1000 }),
                makeChunk({ chunkId: 'c3', documentId: 'doc-3', chunkIndex: 20, tokenCount: 1000 }),
                makeChunk({ chunkId: 'c4', documentId: 'doc-4', chunkIndex: 30, tokenCount: 1000 }),
            ];
            const ctx = service.assemble(chunks);
            expect(ctx.chunks).toHaveLength(3);
            expect(ctx.totalTokens).toBe(3000);
        });

        it('stops exactly at the token budget boundary', () => {
            // c1 (3_400 tokens) fits within the 3_500 budget; c2 (200 tokens)
            // would push the total to 3_600 and is skipped.
            const chunks = [
                makeChunk({ chunkId: 'c1', documentId: 'doc-1', chunkIndex: 0,  tokenCount: 3400 }),
                makeChunk({ chunkId: 'c2', documentId: 'doc-2', chunkIndex: 10, tokenCount: 200 }),
            ];
            const ctx = service.assemble(chunks);
            expect(ctx.chunks).toHaveLength(1);
            expect(ctx.totalTokens).toBe(3400);
        });

        it('generates 1-based citations matching chunk order', () => {
            const chunks = [
                makeChunk({ chunkId: 'c1' }),
                makeChunk({ chunkId: 'c2', chunkIndex: 5, documentId: 'doc-2' }),
            ];
            const ctx = service.assemble(chunks);
            expect(ctx.citations[0].index).toBe(1);
            expect(ctx.citations[1].index).toBe(2);
        });

        it('context text contains Source labels', () => {
            const ctx = service.assemble([makeChunk()]);
            expect(ctx.contextText).toContain('[Source 1:');
            expect(ctx.contextText).toContain('Test Doc');
        });

        it('separates multiple chunks with ---', () => {
            const chunks = [
                makeChunk({ chunkId: 'c1' }),
                makeChunk({ chunkId: 'c2', chunkIndex: 5, documentId: 'doc-2' }),
            ];
            const ctx = service.assemble(chunks);
            expect(ctx.contextText).toContain('---');
        });
    });


    describe('adjacent chunk deduplication', () => {
        it('skips chunks adjacent to an already-selected chunk from same document', () => {
            const chunks = [
                makeChunk({ chunkId: 'c1', documentId: 'doc-1', chunkIndex: 3 }),
                makeChunk({ chunkId: 'c2', documentId: 'doc-1', chunkIndex: 4 }),
                makeChunk({ chunkId: 'c3', documentId: 'doc-1', chunkIndex: 2 }),
            ];
            const ctx = service.assemble(chunks);
            expect(ctx.chunks).toHaveLength(1);
            expect(ctx.chunks[0].chunkId).toBe('c1');
        });

        it('does NOT deduplicate chunks from different documents', () => {
            const chunks = [
                makeChunk({ chunkId: 'c1', documentId: 'doc-1', chunkIndex: 3 }),
                makeChunk({ chunkId: 'c2', documentId: 'doc-2', chunkIndex: 4 }), // different doc → keep
            ];
            const ctx = service.assemble(chunks);
            expect(ctx.chunks).toHaveLength(2);
        });

        it('keeps non-adjacent chunks from the same document', () => {
            const chunks = [
                makeChunk({ chunkId: 'c1', documentId: 'doc-1', chunkIndex: 0 }),
                makeChunk({ chunkId: 'c2', documentId: 'doc-1', chunkIndex: 5 }), // gap > 1 → keep
            ];
            const ctx = service.assemble(chunks);
            expect(ctx.chunks).toHaveLength(2);
        });
    });

    // citation shape

    describe('citation shape', () => {
        it('citation contains all required fields', () => {
            const ctx = service.assemble([makeChunk()]);
            expect(ctx.citations[0]).toMatchObject({
                index:         1,
                chunkId:       expect.any(String),
                documentId:    expect.any(String),
                documentTitle: expect.any(String),
                chunkIndex:    expect.any(Number),
                score:         expect.any(Number),
            });
        });
    });
});