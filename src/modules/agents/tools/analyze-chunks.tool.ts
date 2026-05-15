import { z } from 'zod';
import { ToolDefinition, ToolResult } from './tool.types';

// ─────────────────────────────────────────────────────────────────────────────
// analyze_chunks
//
// Used after search_documents when the agent needs to COMPARE or AGGREGATE
// data across multiple passages. Common uses:
//   - "Compare the parental leave policies across all documents"
//   - "What is the earliest and latest deadline mentioned?"
//   - "Which document has the highest penalty clause?"
//
// The agent passes the raw passages it retrieved and specifies what to extract.
// This tool calls the LLM internally (cheap model, structured output) so the
// main agent model doesn't have to process the full context itself.
// ─────────────────────────────────────────────────────────────────────────────

const ChunkSchema = z.object({
    document: z.string().describe('Document title this passage came from'),
    content:  z.string().describe('The raw text passage'),
});

const AnalyzeChunksSchema = z.object({
    chunks: z
        .array(ChunkSchema)
        .min(1, 'Provide at least one chunk to analyse')
        .max(10, 'Maximum 10 chunks per analysis call')
        .describe('The text passages retrieved from search_documents'),

    extractionGoal: z
        .string()
        .min(10)
        .max(300)
        .describe(
        'What specific data points to extract or compare. Be precise. ' +
        'Example: "Extract the duration, eligibility criteria, and pay rate ' +
        'of parental leave from each passage."',
        ),

    outputFormat: z
        .enum(['comparison_table', 'list', 'summary'])
        .default('summary')
        .describe(
        'How to structure the output. Use comparison_table when contrasting ' +
        'the same attribute across documents, list for enumerating items, ' +
        'summary for synthesising into prose.',
        ),
});

type AnalyzeChunksParams = z.infer<typeof AnalyzeChunksSchema>;

export interface AnalysisRow {
    document:  string;
    extracted: Record<string, string | number | null>;
}

export interface AnalyzeChunksOutput {
    outputFormat:  string;
    extractionGoal: string;
    rows?:         AnalysisRow[];   // populated for comparison_table
    items?:        string[];        // populated for list
    summary?:      string;          // populated for summary
    conflicts?:    string[];        // flagged when documents contradict each other
}

export const analyzeChunksTool: ToolDefinition<typeof AnalyzeChunksSchema> = {
    name: 'analyze_chunks',

    description:
        'Extract specific data points from retrieved text passages and compare ' +
        'or aggregate them across documents. Use this AFTER search_documents when ' +
        'you need to contrast values across sources or summarise multiple passages ' +
        'into structured data. Do NOT use this as a substitute for search_documents.',

    parameters: AnalyzeChunksSchema,

    handler: async (
        params: AnalyzeChunksParams,
        context,
    ): Promise<ToolResult<AnalyzeChunksOutput>> => {
        const { analyzeChunks } = await import('../../services/analysis.service');

        const result = await analyzeChunks({
        chunks:         params.chunks,
        extractionGoal: params.extractionGoal,
        outputFormat:   params.outputFormat,
        correlationId:  context.correlationId,
        });

        return {
        success:    true,
        data:       result,
        tokensCost: result.tokensCost,
        };
    },
};