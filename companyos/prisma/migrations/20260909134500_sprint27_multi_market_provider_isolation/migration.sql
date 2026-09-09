-- Sprint 27: multi-market provider isolation.
-- OrganizationExecutionCredential moves from "one credential per organization"
-- to "one credential per (organization, provider)" -- existing rows already
-- have provider = 'binance', so this is additive/backward-compatible for
-- every organization that has ever configured live credentials.

-- Drop the old organization-only uniqueness.
DROP INDEX IF EXISTS "organization_execution_credential_organizationId_key";

-- Add the new composite uniqueness (organizationId, provider).
CREATE UNIQUE INDEX "organization_execution_credential_organizationId_provider_key" ON "organization_execution_credential"("organizationId", "provider");

-- LiveOrder gains a descriptive `provider` column -- defaults every existing
-- row to 'binance' (the only provider that has ever submitted a real order
-- through this codebase).
ALTER TABLE "live_order" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'binance';
