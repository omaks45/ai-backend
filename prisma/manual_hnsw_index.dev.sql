
-- DEVELOPMENT — Ollama (nomic-embed-text) — vector(768)
--
-- Run once after `npm run migrate:dev`:
--   psql $DATABASE_URL -f prisma/migrations/manual_hnsw_index.dev.sql
--
-- The index uses vector_cosine_ops to match the <=> cosine distance
-- operator used in all similarity queries.
--
-- Parameters:
--   m = 16           Graph connectivity. 16 is the recommended default.
--   ef_construction  Build-time search quality. 64 is the recommended default.
--   = 64

-- Drop the prod index if someone accidentally ran that file first
DROP INDEX IF EXISTS chunk_embedding_hnsw_idx;

CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw_idx
    ON "Chunk"
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Confirm
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'Chunk'
    AND indexname = 'chunk_embedding_hnsw_idx';