import { z } from 'zod';
import { ToolDefinition, ToolResult } from './tool.types';

// ─────────────────────────────────────────────────────────────────────────────
// search_documents
//
// The agent's primary tool for retrieving information. Calls the same
// semanticSearch function used by the RAG pipeline — no duplication of
// retrieval logic.
//
// The description is prompt-engineering: it tells the LLM not just WHAT the
// tool does but WHEN to use it and HOW to phrase effective queries.
// ─────────────────────────────────────────────────────────────────────────────

const SearchDocumentsSchema = z.object({
    query: z
        .string()
        .min(3, 'Query must be at least 3 characters')
        .max(500, 'Query must not exceed 500 characters')
        .describe(
        'The search query. Be specific — use noun phrases rather than questions. ' +
        'Example: "parental leave duration" not "what is the parental leave policy?"',
        ),

    documentId: z
        .string()
        .uuid('documentId must be a valid UUID')
        .optional()
        .describe(
        'Optional UUID of a specific document to search within. ' +
        'Omit to search across all of the user\'s documents.',
        ),

    topK: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe('Number of results to return. Use 3–5 for focused queries, 8–10 for broad ones.'),
});

type SearchDocumentsParams = z.infer<typeof SearchDocumentsSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight result shape fed back to the LLM.
// We omit raw embeddings and internal IDs — the LLM doesn't need them and
// they waste context window tokens.
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchResult {
    document:     string;
    section?:     string;
    content:      string;
    /** Cosine similarity score — surfaced so the LLM can judge relevance */
    score:        number;
}

export interface SearchDocumentsOutput {
    results:      SearchResult[];
    totalResults: number;
    /** Hint to the LLM when retrieval quality is low */
    lowConfidence: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// The handler imports semanticSearch lazily to avoid a circular dependency
// in the NestJS module graph. In a full NestJS implementation this would be
// injected via the tool context — see ToolContext extension notes in executor.
// ─────────────────────────────────────────────────────────────────────────────

export const searchDocumentsTool: ToolDefinition<typeof SearchDocumentsSchema> = {
    name: 'search_documents',

    description:
        'Search across the user\'s uploaded documents for passages relevant to a ' +
        'specific topic or question. Returns ranked text passages with similarity ' +
        'scores. Use this to gather evidence before calling final_answer. ' +
        'Prefer narrow, specific queries over broad ones.',

    parameters: SearchDocumentsSchema,

    handler: async (
        params: SearchDocumentsParams,
        context,
    ): Promise<ToolResult<SearchDocumentsOutput>> => {
        // Dynamically resolved so tests can mock it without circular imports.
        // In production the injected SearchService is passed via extended ToolContext.
        const { semanticSearch } = await import('../../services/search.service');

        const rawResults = await semanticSearch({
        query:      params.query,
        userId:     context.userId,
        documentId: params.documentId,
        topK:       params.topK,
        });

        const results: SearchResult[] = rawResults.map(r => ({
        document: r.documentTitle,
        section:  r.sectionTitle ?? undefined,
        content:  r.content,
        score:    Math.round(r.score * 1000) / 1000, // 3 d.p. is enough
        }));

        // If every result scores below 0.4 the retrieval is probably off-topic.
        const lowConfidence = results.length === 0 ||
        results.every(r => r.score < 0.4);

        return {
        success: true,
        data: {
            results,
            totalResults: results.length,
            lowConfidence,
        },
        };
    },
};