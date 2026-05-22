-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "inputSummary" TEXT NOT NULL,
    "outputSummary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptTemplate_taskType_isActive_idx" ON "PromptTemplate"("taskType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_taskType_version_key" ON "PromptTemplate"("taskType", "version");

-- CreateIndex
CREATE INDEX "AIAuditLog_userId_createdAt_idx" ON "AIAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIAuditLog_taskType_createdAt_idx" ON "AIAuditLog"("taskType", "createdAt");

-- CreateIndex
CREATE INDEX "AIAuditLog_model_createdAt_idx" ON "AIAuditLog"("model", "createdAt");

-- CreateIndex
CREATE INDEX "AIAuditLog_correlationId_idx" ON "AIAuditLog"("correlationId");
