-- Enable pgvector (Supabase supports it out of the box; needed before vector columns)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('NEW', 'SENT', 'SELECTED', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorPost" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "telegramPostUrl" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NataliaPost" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "mainIdea" TEXT NOT NULL,
    "embedding" vector(1536),
    "isReference" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NataliaPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "competitorPostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "embedding" vector(1536),
    "status" "IdeaStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedPost" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "processedPosts" INTEGER NOT NULL DEFAULT 0,
    "generatedIdeas" INTEGER NOT NULL DEFAULT 0,
    "acceptedIdeas" INTEGER NOT NULL DEFAULT 0,
    "rejectedIdeas" INTEGER NOT NULL DEFAULT 0,
    "openaiRequests" INTEGER NOT NULL DEFAULT 0,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_url_key" ON "Competitor"("url");

-- CreateIndex
CREATE INDEX "Competitor_isActive_idx" ON "Competitor"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorPost_telegramPostUrl_key" ON "CompetitorPost"("telegramPostUrl");

-- CreateIndex
CREATE INDEX "CompetitorPost_competitorId_idx" ON "CompetitorPost"("competitorId");

-- CreateIndex
CREATE INDEX "CompetitorPost_isProcessed_idx" ON "CompetitorPost"("isProcessed");

-- CreateIndex
CREATE INDEX "CompetitorPost_publishedAt_idx" ON "CompetitorPost"("publishedAt");

-- CreateIndex
CREATE INDEX "NataliaPost_isReference_idx" ON "NataliaPost"("isReference");

-- CreateIndex
CREATE UNIQUE INDEX "Idea_competitorPostId_key" ON "Idea"("competitorPostId");

-- CreateIndex
CREATE INDEX "Idea_status_idx" ON "Idea"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedPost_ideaId_key" ON "GeneratedPost"("ideaId");

-- CreateIndex
CREATE INDEX "GenerationRun_status_idx" ON "GenerationRun"("status");

-- CreateIndex
CREATE INDEX "GenerationRun_startedAt_idx" ON "GenerationRun"("startedAt");

-- AddForeignKey
ALTER TABLE "CompetitorPost" ADD CONSTRAINT "CompetitorPost_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_competitorPostId_fkey" FOREIGN KEY ("competitorPostId") REFERENCES "CompetitorPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedPost" ADD CONSTRAINT "GeneratedPost_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Vector similarity indexes (HNSW, cosine) for dedup search — see docs/Embeddings.md
CREATE INDEX IF NOT EXISTS "idea_embedding_idx"
    ON "Idea" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "natalia_embedding_idx"
    ON "NataliaPost" USING hnsw (embedding vector_cosine_ops);
