-- DropIndex
DROP INDEX "idea_embedding_idx";

-- DropIndex
DROP INDEX "natalia_embedding_idx";

-- AlterTable
ALTER TABLE "Idea" DROP COLUMN "thesis",
ADD COLUMN     "mainIdea" TEXT NOT NULL;
