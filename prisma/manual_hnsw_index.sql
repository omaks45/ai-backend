-- prisma/migrations/manual_hnsw_index.sql
--
-- WHY IS THIS A SEPARATE MANUAL FILE?
-- Prisma Migrate does not know how to generate CREATE INDEX ... USING hnsw
-- because the vector type is declared as Unsupported() in the schema.
-- Run this once after `prisma migrate dev` to add the HNSW vector index.
--
-- WHY HNSW OVER IVFFlat?
-- HNSW (Hierarchical Navigable Small World) builds a navigable graph at index
-- time and consistently achieves high recall (accuracy). IVFFlat is faster to
-- build but recall degrades unless you tune the nprobe parameter.
-- For DocuChat's dataset size HNSW is always the right choice.
--
-- PARAMETER MEANINGS:
--   m = 16           Each node in the graph connects to 16 neighbours.
--                    Higher m → better recall, more memory, slower build.
--                    16 is the recommended default.
--   ef_construction  Search quality during index construction.
--   = 64             Higher → better index quality, slower build time.
--                    64 is the recommended default.
--
-- vector_cosine_ops  Use cosine distance for similarity queries.
--                    MUST match the <=> operator used in SELECT queries.

CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw_idx
    ON "Chunk"
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
