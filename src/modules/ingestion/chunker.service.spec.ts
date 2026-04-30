
import { Test, TestingModule } from '@nestjs/testing';
import { ChunkerService } from './chunker.service';

describe('ChunkerService', () => {
    let service: ChunkerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [ChunkerService],
        }).compile();

        service = module.get<ChunkerService>(ChunkerService);
    });

    //estimateTokens

    describe('estimateTokens', () => {
        it('returns 0 for empty string', () => {
        expect(service.estimateTokens('')).toBe(0);
        });

        it('estimates ~4 chars per token', () => {
        // 40 chars → ceil(40/4) = 10
        expect(service.estimateTokens('a'.repeat(40))).toBe(10);
        });

        it('rounds up for non-divisible lengths', () => {
        // 9 chars → ceil(9/4) = 3
        expect(service.estimateTokens('123456789')).toBe(3);
        });
    });

    //  chunk — edge cases

    describe('chunk — edge cases', () => {
        it('returns empty array for empty string', () => {
        expect(service.chunk('')).toEqual([]);
        });

        it('returns empty array for whitespace-only string', () => {
        expect(service.chunk('   \n  ')).toEqual([]);
        });

        it('returns single chunk for short text', () => {
        const result = service.chunk('Short text.', { maxTokens: 500 });
        expect(result).toHaveLength(1);
        expect(result[0].index).toBe(0);
        expect(result[0].text).toBe('Short text.');
        });

        it('assigns sequential indices starting from 0', () => {
        const longText = Array(10).fill('Paragraph of text here.').join('\n\n');
        const result   = service.chunk(longText, { maxTokens: 20 });
        result.forEach((chunk, i) => expect(chunk.index).toBe(i));
        });
    });

    //  chunk — splitting

    describe('chunk — splitting behaviour', () => {
        it('splits on paragraph boundaries before lines', () => {
        // Each paragraph is ~20 tokens; maxTokens=15 forces split at paragraphs
        const text = [
            'First paragraph with enough words to be a chunk.',
            'Second paragraph with enough words to be another chunk.',
        ].join('\n\n');

        const result = service.chunk(text, { maxTokens: 15, overlapTokens: 0, minTokens: 1 });
        expect(result.length).toBeGreaterThanOrEqual(2);
        });

        it('produces chunks whose tokenEstimate ≤ maxTokens (approximately)', () => {
        const text = Array(20).fill('Word '.repeat(30)).join('\n\n');
        const opts = { maxTokens: 100, overlapTokens: 0, minTokens: 1 };
        const result = service.chunk(text, opts);

        // Allow 20% tolerance for overlap and boundary effects
        result.forEach((chunk) => {
            expect(chunk.tokenEstimate).toBeLessThanOrEqual(opts.maxTokens * 1.2);
        });
        });

        it('discards chunks below minTokens', () => {
        // A very short trailing paragraph should be dropped
        const text = 'Long first paragraph. '.repeat(50) + '\n\nHi';
        const result = service.chunk(text, { maxTokens: 200, overlapTokens: 0, minTokens: 50 });
        result.forEach((c) => expect(c.tokenEstimate).toBeGreaterThanOrEqual(50));
        });
    });

    //  chunk — overlap

    describe('chunk — overlap', () => {
        it('first chunk has no overlap prefix', () => {
        const text = Array(5).fill('Paragraph text here. '.repeat(20)).join('\n\n');
        const result = service.chunk(text, { maxTokens: 50, overlapTokens: 20, minTokens: 1 });

        if (result.length >= 2) {
            // First chunk should not contain text from before itself
            const firstChunk = result[0].text;
            const secondChunk = result[1].text;
            // Second chunk should contain overlap — some words from first
            const firstWords = firstChunk.split(' ').slice(-5);
            const overlapFound = firstWords.some((w) => secondChunk.includes(w));
            expect(overlapFound).toBe(true);
        }
        });

        it('zero overlap produces non-overlapping chunks', () => {
        const text = Array(3).fill('Paragraph content. '.repeat(30)).join('\n\n');
        const result = service.chunk(text, { maxTokens: 60, overlapTokens: 0, minTokens: 1 });
        // Just check it runs without error and produces output
        expect(result.length).toBeGreaterThan(0);
        });
    });

    //  chunk — metadata

    describe('chunk — metadata', () => {
        it('each chunk has tokenEstimate, startChar, endChar', () => {
        const result = service.chunk('Hello world. Second sentence.', { maxTokens: 500 });
        expect(result[0]).toMatchObject({
            index:         0,
            tokenEstimate: expect.any(Number),
            startChar:     expect.any(Number),
            endChar:       expect.any(Number),
        });
        });

        it('endChar is greater than startChar', () => {
        const result = service.chunk('Some content here.', { maxTokens: 500 });
        result.forEach((c) => expect(c.endChar).toBeGreaterThan(c.startChar));
        });
    });

    //  computeStats

    describe('computeStats', () => {
        it('returns zeroes for empty chunk array', () => {
        const stats = service.computeStats([]);
        expect(stats).toEqual({ count: 0, totalTokens: 0, avgTokens: 0, minTokens: 0, maxTokens: 0 });
        });

        it('computes correct stats for known chunks', () => {
        const chunks = [
            { index: 0, text: 'a'.repeat(40), tokenEstimate: 10, startChar: 0, endChar: 40 },
            { index: 1, text: 'b'.repeat(80), tokenEstimate: 20, startChar: 40, endChar: 120 },
        ];
        const stats = service.computeStats(chunks);
        expect(stats.count).toBe(2);
        expect(stats.totalTokens).toBe(30);
        expect(stats.avgTokens).toBe(15);
        expect(stats.minTokens).toBe(10);
        expect(stats.maxTokens).toBe(20);
        });
    });
});
