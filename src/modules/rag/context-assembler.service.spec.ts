import { Test, TestingModule } from '@nestjs/testing';
import { ContextAssemblerService } from './context-assembler.service';
import { SearchResult }            from '../search/search.service';

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
        const chunks = [
            makeChunk({ chunkId: 'c1', documentId: 'doc-1', chunkIndex: 0, tokenCount: 1000 }),
            makeChunk({ chunkId: 'c2', documentId: 'doc-2', chunkIndex: 0, tokenCount: 1000 }),
            makeChunk({ chunkId: 'c3', documentId: 'doc-3', chunkIndex: 0, tokenCount: 1000 }),
            makeChunk({ chunkId: 'c4', documentId: 'doc-4', chunkIndex: 0, tokenCount: 1000 }), // exceeds 3500 budget
        ];
        const ctx = service.assemble(chunks);
        expect(ctx.chunks).toHaveLength(3);
        expect(ctx.totalTokens).toBe(3000);
        });

        it('stops exactly at the token budget boundary', () => {
        const chunks = [
            makeChunk({ chunkId: 'c1', documentId: 'doc-1', chunkIndex: 0, tokenCount: 3400 }),
            makeChunk({ chunkId: 'c2', documentId: 'doc-2', chunkIndex: 0, tokenCount: 200 }), // 3400+200=3600 > 3500 → skipped
        ];
        const ctx = service.assemble(chunks);
        expect(ctx.chunks).toHaveLength(1);
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

    // ── deduplication ─────────────────────────────────────────────────────────

    describe('adjacent chunk deduplication', () => {
        it('skips chunks adjacent to an already-selected chunk from same document', () => {
        const chunks = [
            makeChunk({ chunkId: 'c1', documentId: 'doc-1', chunkIndex: 3 }),
            makeChunk({ chunkId: 'c2', documentId: 'doc-1', chunkIndex: 4 }), // adjacent → skip
            makeChunk({ chunkId: 'c3', documentId: 'doc-1', chunkIndex: 2 }), // adjacent → skip
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

    //  citation shape

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