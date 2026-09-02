-- CreateEnum
CREATE TYPE "TranscriptPostStatus" AS ENUM ('REJECTED', 'SENT', 'DUPLICATE');

-- AlterTable
ALTER TABLE "GeneratedPost" ADD COLUMN     "mainIdea" TEXT;

-- AlterTable
ALTER TABLE "Idea" ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "duplicateOfType" TEXT,
ADD COLUMN     "similarity" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ClientTranscript" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "fileName" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ClientTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptPost" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mainIdea" TEXT NOT NULL,
    "embedding" vector,
    "similarity" DOUBLE PRECISION,
    "duplicateOfType" TEXT,
    "duplicateOfId" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "TranscriptPostStatus" NOT NULL DEFAULT 'REJECTED',

    CONSTRAINT "TranscriptPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientTranscript_uploadedAt_idx" ON "ClientTranscript"("uploadedAt");

-- CreateIndex
CREATE INDEX "TranscriptPost_transcriptId_idx" ON "TranscriptPost"("transcriptId");

-- CreateIndex
CREATE INDEX "TranscriptPost_duplicateOfId_idx" ON "TranscriptPost"("duplicateOfId");

-- CreateIndex
CREATE INDEX "TranscriptPost_transcriptId_status_idx" ON "TranscriptPost"("transcriptId", "status");

-- AddForeignKey
ALTER TABLE "TranscriptPost" ADD CONSTRAINT "TranscriptPost_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "ClientTranscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
