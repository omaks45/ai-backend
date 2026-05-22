import { z } from 'zod';
import { ToolDefinition } from './tool.types';
import { searchDocumentsTool }    from './search-documents.tool';
import { getDocumentSummaryTool } from './get-document-summary.tool';
import { analyzeChunksTool }      from './analyze-chunks.tool';
import { finalAnswerTool }        from './final-answer.tool';

// ─────────────────────────────────────────────────────────────────────────────
// TOOL_REGISTRY — the authoritative whitelist
//
// Security boundary: any tool name not in this registry is rejected by the
// executor unconditionally, even if the LLM hallucinates a plausible name.
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
// OpenAI function-calling requires JSON Schema. We derive it from the same
// Zod schemas used for validation — single source of truth.
//
// WHY INLINE INSTEAD OF zod-to-json-schema PACKAGE:
// Avoids an extra dependency and covers exactly the Zod types used in this
// project: ZodObject, ZodString, ZodNumber, ZodBoolean, ZodEnum,
// ZodArray, ZodOptional, ZodDefault.
//
// ZOD VERSION COMPATIBILITY FIX (the bug that caused all test failures):
// Zod changed _def.shape from a getter function to a plain object between
// minor versions. The original code called _def.shape() which throws
// "shape is not a function" on Zod v3.20+.
// Fix: check typeof and call only if it is a function.
//
// Same applies to ZodArray: _def.type vs _def.innerType across versions.
// ─────────────────────────────────────────────────────────────────────────────

function zodToJsonSchema(schema: z.ZodSchema): Record<string, unknown> {
    return convertZodNode(schema);
}

function convertZodNode(node: z.ZodTypeAny): Record<string, unknown> {
    // Unwrap ZodOptional and ZodDefault — both wrap an inner type
    if (node instanceof z.ZodOptional || node instanceof z.ZodDefault) {
        return convertZodNode((node as any)._def.innerType);
    }

    if (node instanceof z.ZodString) {
        const schema: Record<string, unknown> = { type: 'string' };
        const checks = ((node as any)._def.checks ?? []) as Array<{
        kind: string;
        value?: unknown;
        }>;
        for (const c of checks) {
        if (c.kind === 'min') schema.minLength = c.value;
        if (c.kind === 'max') schema.maxLength = c.value;
        if (c.kind === 'uuid') schema.format = 'uuid';
        }
        if ((node as any)._def.description) {
        schema.description = (node as any)._def.description;
        }
        return schema;
    }

    if (node instanceof z.ZodNumber) {
        const schema: Record<string, unknown> = { type: 'number' };
        if ((node as any)._def.description) {
        schema.description = (node as any)._def.description;
        }
        return schema;
    }

    if (node instanceof z.ZodBoolean) {
        return { type: 'boolean' };
    }

    if (node instanceof z.ZodEnum) {
        const schema: Record<string, unknown> = {
        type: 'string',
        enum: (node as any)._def.values,
        };
        if ((node as any)._def.description) {
        schema.description = (node as any)._def.description;
        }
        return schema;
    }

    if (node instanceof z.ZodArray) {
        // Zod v3: element type may be _def.type (older) or _def.type (current).
        // Both are the same key but guard against any edge cases.
        const itemDef = (node as any)._def.type ?? (node as any)._def.innerType;
        const schema: Record<string, unknown> = {
        type:  'array',
        items: convertZodNode(itemDef),
        };
        if ((node as any)._def.description) {
        schema.description = (node as any)._def.description;
        }
        return schema;
    }

    if (node instanceof z.ZodObject) {
        // ── THE FIX ──────────────────────────────────────────────────────────────
        // Zod changed _def.shape from a callable getter to a plain object property
        // between v3 minor versions. Calling _def.shape() on a plain object throws
        // "shape is not a function". We handle both:
        //   - older Zod: _def.shape is a function → call it
        //   - newer Zod: _def.shape is a plain object → use directly
        const rawShape = (node as any)._def.shape;
        const shape: Record<string, z.ZodTypeAny> =
        typeof rawShape === 'function' ? rawShape() : rawShape;

        const props: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
        props[key] = convertZodNode(value as z.ZodTypeAny);
        // A field is required unless it is wrapped in ZodOptional or ZodDefault
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
 * Returns tool schemas in OpenAI function-calling format.
 * Excludes final_answer — the executor intercepts it before dispatch.
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

export function getRegisteredToolNames(): string[] {
    return Object.keys(TOOL_REGISTRY);
}