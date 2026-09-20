-- CreateTable
CREATE TABLE "NataliaChannelPost" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mainIdea" TEXT NOT NULL,
    "embedding" vector,
    "similarity" DOUBLE PRECISION,
    "duplicateOfType" TEXT,
    "duplicateOfId" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "TranscriptPostStatus" NOT NULL DEFAULT 'REJECTED',

    CONSTRAINT "NataliaChannelPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NataliaChannelPost_status_idx" ON "NataliaChannelPost"("status");

-- CreateIndex
CREATE INDEX "NataliaChannelPost_duplicateOfId_idx" ON "NataliaChannelPost"("duplicateOfId");

