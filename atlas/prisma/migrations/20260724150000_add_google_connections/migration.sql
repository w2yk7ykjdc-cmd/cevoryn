CREATE TABLE "google_connections" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "google_email" TEXT NOT NULL,
  "access_token_encrypted" TEXT NOT NULL,
  "refresh_token_encrypted" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "scopes" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_connections_organization_id_user_id_key"
  ON "google_connections"("organization_id", "user_id");

CREATE INDEX "google_connections_organization_id_idx"
  ON "google_connections"("organization_id");

ALTER TABLE "google_connections"
  ADD CONSTRAINT "google_connections_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
