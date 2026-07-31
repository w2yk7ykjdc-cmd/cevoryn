-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'FAILED');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "custom_domain_status" "DomainStatus" NOT NULL DEFAULT 'NONE';
