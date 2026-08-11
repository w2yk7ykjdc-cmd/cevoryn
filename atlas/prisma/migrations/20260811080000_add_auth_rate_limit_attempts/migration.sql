-- CreateTable
CREATE TABLE "auth_rate_limit_attempts" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_rate_limit_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_rate_limit_attempts_action_key_created_at_idx" ON "auth_rate_limit_attempts"("action", "key", "created_at");
