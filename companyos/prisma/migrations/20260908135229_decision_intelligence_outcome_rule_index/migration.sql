-- CreateIndex
CREATE INDEX "outcome_organizationId_ruleName_ruleVersion_idx" ON "outcome"("organizationId", "ruleName", "ruleVersion");
