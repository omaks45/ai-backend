import { z } from 'zod';
import { ToolDefinition, ToolResult } from './tool.types';

// ─────────────────────────────────────────────────────────────────────────────
// get_document_summary tool
//
// Calls DocumentsService.findOne via ToolContext.
// findOne already enforces row-level ownership — if the document belongs to
// another user it throws NotFoundException, which the executor catches and
// feeds back to the model as a tool error.
// ─────────────────────────────────────────────────────────────────────────────

const GetDocumentSummarySchema = z.object({
    documentId: z
        .string()
        .uuid('documentId must be a valid UUID')
        .describe('UUID of the document. Must belong to the current user.'),
});

export interface DocumentSummaryOutput {
    documentId: string;
    title:      string;
    chunkCount: number;
    status:     string;
    uploadedAt: string;
}

export const getDocumentSummaryTool: ToolDefinition<typeof GetDocumentSummarySchema> = {
    name: 'get_document_summary',

    description:
        'Get metadata for a specific document: title, chunk count, processing status. ' +
        'Use this to confirm a document exists and is ready before searching it. ' +
        'Do NOT use this to retrieve facts — use search_documents for that.',

    parameters: GetDocumentSummarySchema,

    handler: async (params, context): Promise<ToolResult<DocumentSummaryOutput>> => {
        // DocumentsService.findOne enforces ownership: throws 404 if doc belongs
        // to a different user, so no extra ownership check is needed here.
        const doc = await context.documentsService.findOne(
        params.documentId,
        context.userId,
        );

        return {
        success: true,
        data: {
            documentId: doc.id,
            title:      doc.title,
            chunkCount: doc.chunkCount,
            status:     doc.status,
            uploadedAt: doc.createdAt.toISOString(),
        },
        };
    },
};