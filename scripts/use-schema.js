#!/usr/bin/env node

// Copies the correct schema file to prisma/schema.prisma based on
// the EMBEDDING_PROVIDER environment variable (or NODE_ENV as fallback).
//
// Usage:
//   node scripts/use-schema.js          ← reads from env
//   node scripts/use-schema.js ollama   ← force ollama (copies schema.dev.prisma)
//   node scripts/use-schema.js openai   ← force openai (copies schema.prod.prisma)
//
// Provider → filename mapping:
//   ollama  →  prisma/schema.dev.prisma   (vector(768))
//   openai  →  prisma/schema.prod.prisma  (vector(1536))
//
// Called automatically by npm scripts before every prisma command.

const fs      = require('fs');
const path    = require('path');

const root      = path.resolve(__dirname, '..');
const prismaDir = path.join(root, 'prisma');
const target    = path.join(prismaDir, 'schema.prisma');

// Provider → schema filename map
// Keeps provider names (ollama/openai) decoupled from filenames (dev/prod)
const SCHEMA_MAP = {
    ollama: 'schema.dev.prisma',
    openai: 'schema.prod.prisma',
};

// Resolve provider: CLI arg > EMBEDDING_PROVIDER env > NODE_ENV fallback
const arg      = process.argv[2]?.toLowerCase();
const envValue = (process.env.EMBEDDING_PROVIDER || '').toLowerCase();
const nodeEnv  = (process.env.NODE_ENV || 'development').toLowerCase();

let provider;

if (SCHEMA_MAP[arg]) {
    provider = arg;
} else if (SCHEMA_MAP[envValue]) {
    provider = envValue;
} else {
  // Fallback: development → ollama, production → openai
    provider = nodeEnv === 'production' ? 'openai' : 'ollama';
}

//  Resolve source file path 
const source = path.join(prismaDir, SCHEMA_MAP[provider]);

if (!fs.existsSync(source)) {
    console.error(`  Schema file not found: ${source}`);
    console.error(`    Expected one of: ${Object.values(SCHEMA_MAP).join(', ')}`);
    process.exit(1);
}

//  Copy schema
fs.copyFileSync(source, target);

// Read back dimension from the copied file for confirmation
const content    = fs.readFileSync(target, 'utf8');
const dimMatch   = content.match(/vector\((\d+)\)/);
const dimensions = dimMatch ? dimMatch[1] : 'unknown';

console.log(`  schema.prisma → ${SCHEMA_MAP[provider]} (provider=${provider}, vector(${dimensions}))`);