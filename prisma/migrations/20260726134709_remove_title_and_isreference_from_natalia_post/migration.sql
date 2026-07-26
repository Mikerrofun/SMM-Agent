/*
  Warnings:

  - You are about to drop the column `isReference` on the `NataliaPost` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `NataliaPost` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX IF EXISTS "NataliaPost_isReference_idx";

-- AlterTable
ALTER TABLE "NataliaPost" DROP COLUMN IF EXISTS "isReference",
DROP COLUMN IF EXISTS "title";
