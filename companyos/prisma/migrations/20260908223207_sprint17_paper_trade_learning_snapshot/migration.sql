-- AlterTable
ALTER TABLE "paper_position" ADD COLUMN     "candidateConfidence" INTEGER,
ADD COLUMN     "candidateScore" INTEGER;

-- AlterTable
ALTER TABLE "paper_trade" ADD COLUMN     "candidateConfidence" INTEGER,
ADD COLUMN     "candidateScore" INTEGER;
