/**
 * Every capability an API key can be granted. Currently just the chat
 * endpoint; add here (and to the create-key UI) as more routes accept
 * bearer-token auth.
 */
export const API_KEY_SCOPES = ["ai:chat"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

export class ApiKeyNotFoundError extends Error {
  constructor(apiKeyId: string) {
    super(`API key "${apiKeyId}" not found`);
    this.name = "ApiKeyNotFoundError";
  }
}

/** The bearer token didn't match any key, or matched one that's revoked/expired. Deliberately vague — don't tell a caller which. */
export class InvalidApiKeyError extends Error {
  constructor() {
    super("Invalid or revoked API key");
    this.name = "InvalidApiKeyError";
  }
}
