import { Injectable, Logger } from '@nestjs/common';

//Types

export interface ChunkOptions {
    /** Maximum tokens per chunk (default: 500) */
    maxTokens?: number;
    /** Token overlap between adjacent chunks (default: 50) */
    overlapTokens?: number;
    /** Chunks smaller than this are discarded (default: 50) */
    minTokens?: number;
}

export interface TextChunk {
    index: number;
    text: string;
    tokenEstimate: number;
    startChar: number;
    endChar: number;
}

export interface ChunkStats {
    count: number;
    totalTokens: number;
    avgTokens: number;
    minTokens: number;
    maxTokens: number;
}

// llSeparator hierarchy (most to least structural)
const SEPARATORS = ['\n\n', '\n', '. ', '? ', '! ', ' '] as const;

const DEFAULTS = {
    maxTokens:    500,
    overlapTokens: 50,
    minTokens:     50,
} as const;

@Injectable()
export class ChunkerService {
    private readonly logger = new Logger(ChunkerService.name);

    //  Public API

    chunk(text: string, options: ChunkOptions = {}): TextChunk[] {
        const opts = { ...DEFAULTS, ...options };

        if (!text?.trim()) return [];

        // 1. Recursive split respects natural boundaries
        const rawPieces = this.recursiveSplit(text, [...SEPARATORS], opts.maxTokens);

        // 2. Add overlap from previous chunk
        const withOverlap = this.applyOverlap(rawPieces, opts.overlapTokens);

        // 3. Filter undersized chunks, re-index, attach metadata
        const chunks: TextChunk[] = withOverlap
        .filter((p) => this.estimateTokens(p.text) >= opts.minTokens)
        .map((p, index) => ({
            index,
            text: p.text,
            tokenEstimate: this.estimateTokens(p.text),
            startChar: p.startChar,
            endChar: p.startChar + p.text.length,
        }));

        this.logger.debug('Chunking complete', this.computeStats(chunks));
        return chunks;
    }

    computeStats(chunks: TextChunk[]): ChunkStats {
        if (!chunks.length) {
        return { count: 0, totalTokens: 0, avgTokens: 0, minTokens: 0, maxTokens: 0 };
        }

        const tokens = chunks.map((c) => c.tokenEstimate);
        const total  = tokens.reduce((a, b) => a + b, 0);

        return {
        count:      chunks.length,
        totalTokens: total,
        avgTokens:  Math.round(total / chunks.length),
        minTokens:  Math.min(...tokens),
        maxTokens:  Math.max(...tokens),
        };
    }

    /**
     * Estimate tokens using the ~4 chars/token heuristic.
     * Fast O(1) — good enough for chunking decisions.
     */
    estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    //  Private helpers

    /**
     * Recursively split text using the first separator that creates multiple
     * pieces, then merge adjacent pieces that fit within maxTokens.
     * Falls back to the next separator if a piece is still too large.
     */
    private recursiveSplit(
        text: string,
        separators: readonly string[],
        maxTokens: number,
        charOffset = 0,
    ): { text: string; startChar: number }[] {
        // Base case: already small enough
        if (this.estimateTokens(text) <= maxTokens) {
        return [{ text: text.trim(), startChar: charOffset }];
        }

        for (let i = 0; i < separators.length; i++) {
        const sep   = separators[i];
        const parts = text.split(sep).filter((p) => p.trim());

        if (parts.length <= 1) continue; // This separator doesn't help

        // Greedily merge parts into chunks ≤ maxTokens
        const merged = this.mergeIntoChunks(parts, sep, maxTokens, charOffset);

        // Recursively split any chunks still over the limit
        const remaining = separators.slice(i + 1);
        return merged.flatMap((chunk) =>
            this.estimateTokens(chunk.text) > maxTokens && remaining.length > 0
            ? this.recursiveSplit(chunk.text, remaining, maxTokens, chunk.startChar)
            : [chunk],
        );
        }

        // No separator worked — return as-is
        return [{ text: text.trim(), startChar: charOffset }];
    }

    /**
     * Greedily merge consecutive parts into the largest chunk ≤ maxTokens.
     */
    private mergeIntoChunks(
        parts: string[],
        sep: string,
        maxTokens: number,
        baseOffset: number,
    ): { text: string; startChar: number }[] {
        const chunks: { text: string; startChar: number }[] = [];
        let current = '';
        let chunkStart = baseOffset;
        let cursor = baseOffset;

        for (const part of parts) {
        const candidate = current ? `${current}${sep}${part}` : part;

        if (current && this.estimateTokens(candidate) > maxTokens) {
            chunks.push({ text: current.trim(), startChar: chunkStart });
            chunkStart = cursor;
            current    = part;
        } else {
            current = candidate;
        }

        cursor += part.length + sep.length;
        }

        if (current.trim()) {
        chunks.push({ text: current.trim(), startChar: chunkStart });
        }

        return chunks;
    }

    /**
     * Prepend the tail of the previous chunk to create semantic overlap.
     * Overlap is purely additive — does not reduce the original chunk content.
     */
    private applyOverlap(
        pieces: { text: string; startChar: number }[],
        overlapTokens: number,
    ): { text: string; startChar: number }[] {
        if (overlapTokens === 0 || pieces.length <= 1) return pieces;

        return pieces.map((piece, i) => {
        if (i === 0) return piece;

        const prevText   = pieces[i - 1].text;
        const overlapText = this.lastNTokensAsText(prevText, overlapTokens);

        return {
            text:      `${overlapText}\n${piece.text}`,
            startChar: piece.startChar,
        };
        });
    }

    /**
     * Extract approximately the last N tokens from text by taking words.
     * Words are a reasonable proxy for tokens (≈ 0.75 words per token).
     */
    private lastNTokensAsText(text: string, tokenCount: number): string {
        const words      = text.split(/\s+/);
        const wordCount  = Math.ceil(tokenCount / 0.75); // tokens → words
        return words.slice(-wordCount).join(' ');
    }
}
