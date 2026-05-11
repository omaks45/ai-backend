
// CONCEPT: SEMANTIC SEARCH WITH pgvector
//
// HOW IT WORKS:
// 1. Embed the user's question into a vector (768-dim for Ollama, 1536-dim for OpenAI)
//    using the same model and provider used at ingestion time.
// 2. Run a SQL query using the <=> cosine distance operator via pgvector.
// 3. Filter by user ownership — users NEVER see other users' chunks.
// 4. Filter out low-scoring results (minScore) — better no answer than a wrong one.
//
// PROVIDER AWARENESS:
// The vector dimension in the ::vector cast MUST match what is stored in the DB.
// Ollama stores vector(768), OpenAI stores vector(1536).
// We read this at runtime from EmbeddingService.dimensions so the SQL cast is
// always correct regardless of which provider is active.
//
// THE <=> OPERATOR:
// Returns cosine DISTANCE (0 = identical, 2 = opposite).
// We convert to cosine SIMILARITY: score = 1 - distance
// Higher score = more relevant. Range: 0.0 to 1.0
//
// WHY minScore FILTERING?
// Without it you always return topK results even if all are irrelevant.
// A score of 0.28 means "barely related". Including that in the LLM prompt
// adds noise and wastes tokens. Better to return nothing and tell the user
// "I couldn't find that in your documents."
//
// WHY RAW SQL INSTEAD OF PRISMA ORM?
// Prisma does not yet support the vector type natively. The <=> operator
// and ::vector cast require raw SQL until Prisma adds native vector support.
//
// SECURITY: User ownership is enforced at the DB layer, not application layer.
// Even if application code has a bug, the WHERE d."userId" = ${userId} clause
// ensures no cross-user data leakage.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../../database/prisma.service';
import { EmbeddingService }   from '../embedding/embedding.service';
import { RAG_CONFIG }         from '../../config/rag-prompts.config';

export interface SearchResult {
  chunkId:       string;
  documentId:    string;
  documentTitle: string;
  content:       string;
  chunkIndex:    number;
  score:         number;
  tokenCount:    number;
}

export interface SearchOptions {
  query:          string;
  userId:         string;
  documentId?:    string;   // Scope to a single document (optional)
  topK?:          number;
  minScore?:      number;
  correlationId?: string;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const {
      query,
      userId,
      documentId,
      topK      = RAG_CONFIG.topK,
      minScore  = RAG_CONFIG.minScore,
      correlationId,
    } = options;

    const start = Date.now();

    // Step 1: Embed the query
    // Uses the active provider — same model as ingestion, so dimensions always match.
    const { embedding } = await this.embedding.embedOne(query);
    const vectorLiteral  = this.embedding.toVectorLiteral(embedding);

    // Step 2: Build the vector cast using the active provider's dimensions.
    // This ensures ::vector(768) for Ollama and ::vector(1536) for OpenAI.
    // Mismatching dimensions would cause a pgvector runtime error.
    const dims = this.embedding.dimensions;

    // Step 3: pgvector similarity search
    // documentId filter is applied inline to keep the query a single tagged template.
    const rows = documentId
      ? await this.searchWithDocument(vectorLiteral, dims, userId, documentId, topK)
      : await this.searchAllDocuments(vectorLiteral, dims, userId, topK);

    // Step 4: Filter by minimum relevance score
    const results = rows
      .map((r) => ({ ...r, score: Number(r.score) }))
      .filter((r) => r.score >= minScore);

    this.logger.log('Semantic search completed', {
      correlationId,
      userId,
      provider:        this.embedding.providerName,
      dimensions:      dims,
      queryPreview:    query.slice(0, 80),
      totalRetrieved:  rows.length,
      afterFilter:     results.length,
      topScore:        results[0]?.score.toFixed(4) ?? 'n/a',
      durationMs:      Date.now() - start,
    });

    return results;
  }

  //Private query helpers
  // Split into two methods because Prisma tagged templates cannot conditionally
  // interpolate SQL fragments — each branch must be its own complete template.

  private searchAllDocuments(
    vectorLiteral: string,
    dims:          number,
    userId:        string,
    topK:          number,
  ) {
    return this.prisma.$queryRaw<RawRow[]>`
      SELECT
        c.id              AS "chunkId",
        c."documentId",
        d.title           AS "documentTitle",
        c.content,
        c.index           AS "chunkIndex",
        c."tokenCount",
        1 - (c.embedding <=> ${vectorLiteral}::vector(${dims})) AS score
      FROM "Chunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE d."userId"    = ${userId}
        AND d."deletedAt" IS NULL
        AND d.status      = 'ready'
        AND c.embedding   IS NOT NULL
      ORDER BY c.embedding <=> ${vectorLiteral}::vector(${dims})
      LIMIT ${topK}
    `;
  }

  private searchWithDocument(
    vectorLiteral: string,
    dims:          number,
    userId:        string,
    documentId:    string,
    topK:          number,
  ) {
    return this.prisma.$queryRaw<RawRow[]>`
      SELECT
        c.id              AS "chunkId",
        c."documentId",
        d.title           AS "documentTitle",
        c.content,
        c.index           AS "chunkIndex",
        c."tokenCount",
        1 - (c.embedding <=> ${vectorLiteral}::vector(${dims})) AS score
      FROM "Chunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE d."userId"    = ${userId}
        AND d.id          = ${documentId}
        AND d."deletedAt" IS NULL
        AND d.status      = 'ready'
        AND c.embedding   IS NOT NULL
      ORDER BY c.embedding <=> ${vectorLiteral}::vector(${dims})
      LIMIT ${topK}
    `;
  }
}

// Internal type
interface RawRow {
  chunkId:       string;
  documentId:    string;
  documentTitle: string;
  content:       string;
  chunkIndex:    number;
  tokenCount:    number;
  score:         number;
}