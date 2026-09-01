-- DropForeignKey
ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_userId_fkey";

-- DropForeignKey
ALTER TABLE "company" DROP CONSTRAINT "company_createdById_fkey";

-- DropForeignKey
ALTER TABLE "contact" DROP CONSTRAINT "contact_createdById_fkey";

-- DropForeignKey
ALTER TABLE "contact_note" DROP CONSTRAINT "contact_note_authorId_fkey";

-- DropForeignKey
ALTER TABLE "conversation" DROP CONSTRAINT "conversation_userId_fkey";

-- DropForeignKey
ALTER TABLE "lead" DROP CONSTRAINT "lead_createdById_fkey";

-- DropForeignKey
ALTER TABLE "task" DROP CONSTRAINT "task_createdById_fkey";

-- AlterTable
ALTER TABLE "agent_run" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "company" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "contact" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "contact_note" ALTER COLUMN "authorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "conversation" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "lead" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "task" ALTER COLUMN "createdById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
