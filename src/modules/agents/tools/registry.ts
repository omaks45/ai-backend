import { z } from 'zod';
import { ToolDefinition } from './tool.types';
import { searchDocumentsTool }   from './search-documents.tool';
import { getDocumentSummaryTool } from './get-document-summary.tool';
import { analyzeChunksTool }     from './analyze-chunks.tool';
import { finalAnswerTool }       from './final-answer.tool';

// ─────────────────────────────────────────────────────────────────────────────
// TOOL_REGISTRY — the authoritative whitelist
//
// This is a security boundary. If a tool name is not registered here, the
// executor rejects it unconditionally — even if the LLM hallucinates a
// plausible-sounding name. Unknown tool calls are fed back as errors so the
// model can self-correct within the same iteration.
//
// To add a new tool:
//   1. Create src/agents/tools/your-tool.tool.ts
//   2. Export a ToolDefinition from it
//   3. Add it to TOOL_REGISTRY below
//   That's it. No executor changes required.
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_REGISTRY: Readonly<Record<string, ToolDefinition>> = {
    search_documents:     searchDocumentsTool,
    get_document_summary: getDocumentSummaryTool,
    analyze_chunks:       analyzeChunksTool,
    final_answer:         finalAnswerTool,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Zod → JSON Schema conversion
//
// OpenAI's function-calling format requires JSON Schema, not Zod.
// We derive it from the same Zod object used for validation so there is a
// single source of truth — the schema the LLM sees always matches the schema
// used to validate what it sends back.
//
// final_answer is excluded from the tools list sent to the model because we
// treat it as a special exit signal in the executor. Including it here would
// let the model call it at any time without our interceptor noticing first.
// It is listed in the system prompt description so the model knows it exists.
// ─────────────────────────────────────────────────────────────────────────────

function zodToJsonSchema(schema: z.ZodSchema): Record<string, unknown> {
  // Inline implementation to avoid a heavy dependency (zod-to-json-schema).
  // Covers ZodObject, ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodOptional,
  // ZodDefault, ZodArray — the only types we use in tool schemas.
    return convertZodNode(schema);
}

function convertZodNode(node: z.ZodTypeAny): Record<string, unknown> {
    if (node instanceof z.ZodOptional || node instanceof z.ZodDefault) {
        return convertZodNode((node as any)._def.innerType);
    }

    if (node instanceof z.ZodString) {
        const schema: Record<string, unknown> = { type: 'string' };
        const checks = (node as any)._def.checks as Array<{ kind: string; value?: unknown; message?: string }>;
        for (const c of checks ?? []) {
        if (c.kind === 'min') schema.minLength = c.value;
        if (c.kind === 'max') schema.maxLength = c.value;
        }
        if ((node as any)._def.description) schema.description = (node as any)._def.description;
        return schema;
    }

    if (node instanceof z.ZodNumber) {
        const schema: Record<string, unknown> = { type: 'number' };
        if ((node as any)._def.description) schema.description = (node as any)._def.description;
        return schema;
    }

    if (node instanceof z.ZodBoolean) {
        return { type: 'boolean' };
    }

    if (node instanceof z.ZodEnum) {
        return {
        type:        'string',
        enum:        (node as any)._def.values,
        description: (node as any)._def.description,
        };
    }

    if (node instanceof z.ZodArray) {
        return {
        type:        'array',
        items:       convertZodNode((node as any)._def.type),
        description: (node as any)._def.description,
        };
    }

    if (node instanceof z.ZodObject) {
        const shape  = (node as any)._def.shape();
        const props: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
        props[key] = convertZodNode(value as z.ZodTypeAny);
        // A field is required unless it's ZodOptional or has a ZodDefault
        if (
            !(value instanceof z.ZodOptional) &&
            !(value instanceof z.ZodDefault)
        ) {
            required.push(key);
        }
        }

        const schema: Record<string, unknown> = {
        type:       'object',
        properties: props,
        };
        if (required.length > 0) schema.required = required;
        return schema;
    }

    return {};
    }

    export type OpenAITool = {
        type: 'function';
        function: {
            name:        string;
            description: string;
            parameters:  Record<string, unknown>;
        };
};

/**
 * Returns the tool schemas in OpenAI function-calling format.
 * Excludes final_answer — it is intercepted by the executor, not dispatched
 * through the normal tool-call path.
 */
export function getOpenAIToolSchemas(): OpenAITool[] {
    return Object.values(TOOL_REGISTRY)
        .filter(tool => tool.name !== 'final_answer')
        .map(tool => ({
        type: 'function' as const,
        function: {
            name:        tool.name,
            description: tool.description,
            parameters:  zodToJsonSchema(tool.parameters),
        },
        }));
}

/**
 * Returns all registered tool names — used by observability to label metrics.
 */
export function getRegisteredToolNames(): string[] {
    return Object.keys(TOOL_REGISTRY);
}