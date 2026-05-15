import { z } from 'zod';
import { ToolDefinition, ToolResult } from './tool.types';

// ─────────────────────────────────────────────────────────────────────────────
// get_document_summary
//
// Used when the agent needs to understand what a document covers before
// deciding whether to search it in detail.
//
// Common agent pattern:
//   1. list what documents exist (not a tool — injected into system prompt)
//   2. get_document_summary on likely candidates
//   3. search_documents on the ones that look relevant
//   4. final_answer
//
// This avoids wasting topK slots on irrelevant documents.
// ─────────────────────────────────────────────────────────────────────────────

const GetDocumentSummarySchema = z.object({
    documentId: z
        .string()
        .uuid('documentId must be a valid UUID')
        .describe('UUID of the document to summarise. Must belong to the current user.'),
});

type GetDocumentSummaryParams = z.infer<typeof GetDocumentSummarySchema>;

export interface DocumentSummaryOutput {
    documentId:    string;
    title:         string;
    pageCount?:    number;
    chunkCount:    number;
    /** Top-level topics the document covers */
    topics:        string[];
    /** Short prose summary (2–3 sentences) from document metadata or first chunk */
    summary:       string;
    uploadedAt:    string;
}

export const getDocumentSummaryTool: ToolDefinition<typeof GetDocumentSummarySchema> = {
    name: 'get_document_summary',

    description:
        'Retrieve a high-level summary and topic list for a specific document ' +
        'identified by its UUID. Use this to understand what a document covers ' +
        'before deciding whether to search it in detail. ' +
        'Do NOT use this to retrieve specific facts — use search_documents for that.',

    parameters: GetDocumentSummarySchema,

    handler: async (
        params: GetDocumentSummaryParams,
        context,
    ): Promise<ToolResult<DocumentSummaryOutput>> => {
        const { getDocumentSummary } = await import('../../services/document.service');

        const doc = await getDocumentSummary({
        documentId: params.documentId,
        userId:     context.userId, // enforces row-level ownership
        });

        return {
        success: true,
        data: {
            documentId: doc.id,
            title:      doc.title,
            pageCount:  doc.pageCount ?? undefined,
            chunkCount: doc.chunkCount,
            topics:     doc.topics ?? [],
            summary:    doc.summary ?? 'No summary available.',
            uploadedAt: doc.createdAt.toISOString(),
        },
        };
    },
};