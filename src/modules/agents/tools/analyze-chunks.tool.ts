import { z } from 'zod';
import { ToolDefinition, ToolResult } from './tool.types';

// ─────────────────────────────────────────────────────────────────────────────
// analyze_chunks tool
//
// Structures passages already retrieved by search_documents so the LLM can
// extract and compare specific data points across documents.
//
// This tool is entirely in-process — no external service, no LLM call.
// The agent model does the actual extraction; this tool structures the request
// so the model knows what to look for in each passage.
// ─────────────────────────────────────────────────────────────────────────────

const ChunkSchema = z.object({
    document: z.string().describe('Document title the passage came from'),
    content:  z.string().describe('The raw text passage from search_documents'),
});

const AnalyzeChunksSchema = z.object({
    chunks: z
        .array(ChunkSchema)
        .min(1,  'Provide at least one chunk')
        .max(10, 'Maximum 10 chunks per call')
        .describe('Passages from search_documents results'),

    extractionGoal: z
        .string()
        .min(10)
        .max(300)
        .describe(
        'What to extract or compare. Be specific. ' +
        'Example: "Extract the duration, eligibility, and pay rate of parental leave."',
        ),

    outputFormat: z
        .enum(['comparison', 'list', 'summary'])
        .default('summary')
        .describe(
        'comparison — contrast same attribute across documents; ' +
        'list — enumerate findings; ' +
        'summary — synthesise into prose.',
        ),
});

type AnalyzeChunksParams = z.infer<typeof AnalyzeChunksSchema>;

export interface AnalyzeChunksOutput {
    outputFormat:   string;
    extractionGoal: string;
    extracted: Array<{
        document: string;
        findings: string;
    }>;
    conflicts?: string[];
}

export const analyzeChunksTool: ToolDefinition<typeof AnalyzeChunksSchema> = {
    name: 'analyze_chunks',

    description:
        'Extract and compare specific data points from retrieved passages. ' +
        'Use AFTER search_documents when comparing the same attribute across documents. ' +
        'Do NOT use as a substitute for search_documents.',

    parameters: AnalyzeChunksSchema,

    // No context services needed — pure structural pass-through.
    // The model reads the returned structure and fills in findings based on
    // the extractionGoal when it processes the tool result.
    handler: async (params: AnalyzeChunksParams): Promise<ToolResult<AnalyzeChunksOutput>> => {
        const extracted = params.chunks.map(chunk => ({
        document: chunk.document,
        findings: chunk.content.slice(0, 600), // trim to avoid bloating context window
        }));

        return {
        success: true,
        data: {
            outputFormat:   params.outputFormat,
            extractionGoal: params.extractionGoal,
            extracted,
        },
        };
    },
};