-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "Chunk" ADD COLUMN     "embedding" vector(1536),
ADD COLUMN     "endChar" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startChar" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "IngestionMetric" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "embeddingTokens" INTEGER NOT NULL DEFAULT 0,
    "embeddingCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "cacheHits" INTEGER NOT NULL DEFAULT 0,
    "cacheMisses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestionMetric_userId_idx" ON "IngestionMetric"("userId");

-- CreateIndex
CREATE INDEX "IngestionMetric_documentId_idx" ON "IngestionMetric"("documentId");

-- CreateIndex
CREATE INDEX "IngestionMetric_createdAt_idx" ON "IngestionMetric"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- AddForeignKey
ALTER TABLE "IngestionMetric" ADD CONSTRAINT "IngestionMetric_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
