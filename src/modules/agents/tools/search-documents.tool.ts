import { z } from 'zod';
import { ToolDefinition, ToolResult } from './tool.types';

// ─────────────────────────────────────────────────────────────────────────────
// search_documents tool
//
// Calls SearchService via ToolContext — the same service ConversationsService
// uses. No dynamic imports. No separate search.service file needed.
//
// Why context injection instead of dynamic import?
// Dynamic imports bypass NestJS DI, can't be mocked in tests, and the module
// paths they reference don't exist in this project's folder structure.
// ─────────────────────────────────────────────────────────────────────────────

const SearchDocumentsSchema = z.object({
    query: z
        .string()
        .min(3,   'Query must be at least 3 characters')
        .max(500, 'Query must not exceed 500 characters')
        .describe(
        'Search query. Use noun phrases, not questions. ' +
        'Good: "parental leave duration". Bad: "what is the parental leave policy?"',
        ),
    documentId: z
        .string()
        .uuid('documentId must be a valid UUID')
        .optional()
        .describe('Restrict search to one document. Omit to search all documents.'),
    topK: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe('Number of results. Use 3–5 for focused queries, up to 10 for broad ones.'),
});

export interface SearchDocumentsOutput {
    results: Array<{
        document: string;
        content:  string;
        score:    number;
    }>;
    totalResults:  number;
    lowConfidence: boolean;
}

export const searchDocumentsTool: ToolDefinition<typeof SearchDocumentsSchema> = {
    name: 'search_documents',

    description:
        'Search the user\'s uploaded documents for relevant passages. ' +
        'Returns ranked text excerpts with similarity scores. ' +
        'Always use this before final_answer. Prefer specific noun-phrase queries.',

    parameters: SearchDocumentsSchema,

    handler: async (params, context): Promise<ToolResult<SearchDocumentsOutput>> => {
        // context.searchService is the same SearchService used by ConversationsService.
        // It enforces userId ownership at the DB level — users never see other users' chunks.
        const rawResults = await context.searchService.search({
        query:         params.query,
        userId:        context.userId,
        documentId:    params.documentId,
        topK:          params.topK,
        correlationId: context.correlationId,
        });

        const results = rawResults.map(r => ({
        document: r.documentTitle,
        content:  r.content,
        score:    Math.round(r.score * 1000) / 1000,
        }));

        const lowConfidence =
        results.length === 0 || results.every(r => r.score < 0.4);

        return {
        success: true,
        data: { results, totalResults: results.length, lowConfidence },
        };
    },
};