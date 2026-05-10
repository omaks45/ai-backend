
-- PRODUCTION — OpenAI (text-embedding-3-small) — vector(1536)
--
-- Run once after `npm run migrate:prod`:
--   psql $DATABASE_URL -f prisma/migrations/manual_hnsw_index.prod.sql
--
-- Higher dimensions need slightly higher ef_construction for good recall.
-- ef_construction=128 is recommended for 1536-dim vectors.
--
-- Parameters:
--   m = 16           Graph connectivity. 16 is the recommended default.
--   ef_construction  Build-time quality. 128 recommended for 1536-dim.
--   = 128

-- Drop the dev index if it exists (wrong dimensions)
DROP INDEX IF EXISTS chunk_embedding_hnsw_idx;

CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw_idx
    ON "Chunk"
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 128);

-- Confirm
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'Chunk'
    AND indexname = 'chunk_embedding_hnsw_idx';