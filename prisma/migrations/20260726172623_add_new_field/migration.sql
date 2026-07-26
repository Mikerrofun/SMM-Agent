-- AlterTable
ALTER TABLE "NataliaPost" ADD COLUMN     "telegramPostUrl" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "NataliaPost_telegramPostUrl_key" ON "NataliaPost"("telegramPostUrl");

