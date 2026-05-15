import { z } from 'zod';
import { ToolDefinition, ToolResult } from './tool.types';

// ─────────────────────────────────────────────────────────────────────────────
// final_answer
//
// This is the ONLY way the agent can deliver a response to the user.
// Prohibiting plain-text replies (enforced in the system prompt and the
// executor) means every answer is structured, cited, and confidence-rated.
//
// The executor detects this tool call and exits the ReAct loop immediately —
// it does NOT call the handler. The handler exists only for type safety and
// unit testing the schema.
//
// Why structured? When agentTerminations{reason="completed"} fires we want
// the trace to record the exact answer, sources, and confidence so the
// observability dashboard can correlate confidence with user satisfaction.
// ─────────────────────────────────────────────────────────────────────────────

export const FinalAnswerSchema = z.object({
    answer: z
        .string()
        .min(1, 'Answer must not be empty')
        .describe(
        'The complete, self-contained answer to the user\'s question. ' +
        'Write for the user, not for the agent. Include [Source N] inline ' +
        'citations referencing the source numbers in the context.',
        ),

    sources: z
        .array(z.string())
        .describe(
        'Exact document titles used to produce this answer. ' +
        'Must correspond to the "document" field from search_documents results.',
        ),

    confidence: z
        .enum(['high', 'medium', 'low'])
        .describe(
        'high   — answer is directly stated in the sources. ' +
        'medium — answer requires reasonable inference from the sources. ' +
        'low    — sources were insufficient; answer is partial or uncertain.',
        ),

    /** Optional: flag when sources explicitly contradict each other */
    conflicts: z
        .array(z.string())
        .optional()
        .describe(
        'If sources disagree, list each conflict as a plain-English sentence. ' +
        'The answer should acknowledge the conflict rather than pick a side.',
        ),
});

export type FinalAnswerParams = z.infer<typeof FinalAnswerSchema>;

export const finalAnswerTool: ToolDefinition<typeof FinalAnswerSchema> = {
    name: 'final_answer',

    description:
        'Provide the definitive answer to the user\'s question. ' +
        'You MUST call this tool to respond — do not output plain text. ' +
        'Call this when you have gathered sufficient evidence from search_documents ' +
        'or analyze_chunks, OR when you have determined the answer is not in the documents. ' +
        'Set confidence to "low" if information was insufficient.',

    parameters: FinalAnswerSchema,

    // The executor intercepts this tool call before reaching the handler.
    // The handler below is a passthrough used only in unit tests.
    handler: async (params): Promise<ToolResult<FinalAnswerParams>> => ({
        success: true,
        data:    params,
    }),
};