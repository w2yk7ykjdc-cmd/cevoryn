-- CreateEnum
CREATE TYPE "ProprietaryDataSourceKind" AS ENUM ('DOCUMENT_STORE', 'CRM', 'ERP', 'INTERNAL_API', 'KNOWLEDGE_BASE');

-- CreateTable
CREATE TABLE "proprietary_data_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_kind" "ProprietaryDataSourceKind" NOT NULL DEFAULT 'KNOWLEDGE_BASE',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "url" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "added_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proprietary_data_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proprietary_data_records_organization_id_created_at_idx" ON "proprietary_data_records"("organization_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "proprietary_data_records" ADD CONSTRAINT "proprietary_data_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
