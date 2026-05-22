// Seeds the initial PromptTemplate rows from the existing config files.
// Run after the migration:
//   npx ts-node prisma/seed.mcp.ts
//
// WHY SEED INSTEAD OF HARDCODE IN MIGRATION:
// Migrations are schema changes. Initial data is application concern.
// Keeping them separate means you can re-seed a fresh DB without re-running
// migrations, and you can update seed data without touching migrations.
//
// UPSERT STRATEGY:
// Uses upsert on (taskType, version) so re-running the seed is idempotent.
// Existing rows are not overwritten — only created if missing.

import { PrismaClient } from '@prisma/client';
import { RAG_SYSTEM_PROMPT } from '../src/config/rag-prompts.config';
import { AGENT_SYSTEM_PROMPT } from '../src/config/agents-prompts.config';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding prompt templates...');

    // ── chat v1 ───────────────────────────────────────────────────────────────
    await prisma.promptTemplate.upsert({
        where: { taskType_version: { taskType: 'chat', version: 'v1' } },
        update: {},   // Never overwrite — create only if missing
        create: {
        taskType: 'chat',
        version:  'v1',
        name:     'RAG Chat — Initial',
        content:  RAG_SYSTEM_PROMPT,
        isActive: true,
        metadata: JSON.stringify({
            author:    'system',
            changelog: 'Migrated from rag-prompts.config.ts',
        }),
        },
    });
    console.log('   chat v1');

    // ── agent v1 ──────────────────────────────────────────────────────────────
    await prisma.promptTemplate.upsert({
        where: { taskType_version: { taskType: 'agent', version: 'v1' } },
        update: {},
        create: {
        taskType: 'agent',
        version:  'v1',
        name:     'Research Agent — Initial',
        content:  AGENT_SYSTEM_PROMPT,
        isActive: true,
        metadata: JSON.stringify({
            author:    'system',
            changelog: 'Migrated from agents-prompts.config.ts',
        }),
        },
    });
    console.log('   agent v1');

    // ── summary v1 ────────────────────────────────────────────────────────────
    await prisma.promptTemplate.upsert({
        where: { taskType_version: { taskType: 'summary', version: 'v1' } },
        update: {},
        create: {
        taskType: 'summary',
        version:  'v1',
        name:     'Document Summary — Initial',
        content: [
            'You are a document summarisation assistant.',
            'Summarise the provided text concisely and accurately.',
            'Focus on key facts, decisions, and action items.',
            'Do not add information not present in the source text.',
            'Format: 3–5 bullet points followed by a one-sentence conclusion.',
        ].join('\n'),
        isActive: true,
        metadata: JSON.stringify({ author: 'system', changelog: 'Initial summary prompt' }),
        },
    });
    console.log('   summary v1');

    console.log('Seeding complete.');
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());