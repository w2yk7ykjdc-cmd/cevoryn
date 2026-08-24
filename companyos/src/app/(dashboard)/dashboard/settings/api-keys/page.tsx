import { requirePermission } from "@/server/auth/session";
import { listApiKeys } from "@/server/api-keys/service";
import { ApiKeysClient } from "@/app/(dashboard)/dashboard/settings/api-keys/api-keys-client";

export default async function ApiKeysPage() {
  const { organization } = await requirePermission({ apiKey: ["read"] });
  const apiKeys = await listApiKeys(organization.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
        <p className="text-sm text-muted-foreground">
          Programmatic access to the AI Sales Employee chat endpoint. A new key is shown once, at creation.
        </p>
      </div>
      <ApiKeysClient
        initialKeys={apiKeys.map((key) => ({
          id: key.id,
          name: key.name,
          keyPrefix: key.keyPrefix,
          scopes: key.scopes,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt,
          expiresAt: key.expiresAt,
          revokedAt: key.revokedAt,
          createdByName: key.createdBy.name,
        }))}
      />
    </div>
  );
}
