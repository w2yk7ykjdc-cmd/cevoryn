/**
 * SSO/SAML auth foundation (Phase 2, section 16).
 *
 * Status: interface only, not wired into src/lib/auth.ts or Supabase Auth.
 * CEVORYN authenticates exclusively through Supabase Auth today; adding a
 * second auth path is a real security-sensitive project (session handling,
 * JIT provisioning, org-to-IdP mapping) that must not be faked. This module
 * exists so that project starts from an explicit contract instead of a
 * later scramble to retrofit one, and so nothing in the current
 * organization/membership model would need to change shape to support it -
 * an SsoIdentity always resolves to an existing User row (see
 * organizationId below), it never replaces one.
 */

export type SsoProtocol = "SAML" | "OIDC";

export interface SsoConnectionConfig {
  organizationId: string;
  protocol: SsoProtocol;
  isEnabled: boolean;
  /** IdP metadata URL (SAML) or issuer/discovery URL (OIDC). */
  idpMetadataUrl: string;
  /** Email domains that must authenticate via this connection once enabled. */
  enforcedDomains: string[];
}

export interface SsoIdentity {
  organizationId: string;
  userId: string;
  protocol: SsoProtocol;
  externalSubjectId: string;
  lastAuthenticatedAt: Date;
}

/**
 * What a real SSO integration would need to implement. `resolveIdentity`
 * takes a verified assertion/token (verification itself is IdP-library
 * territory, deliberately out of scope for this interface) and returns the
 * CEVORYN user it maps to, provisioning one if the organization's
 * just-in-time policy allows it.
 */
export interface SsoProvider {
  readonly protocol: SsoProtocol;
  resolveIdentity(
    organizationId: string,
    verifiedAssertion: Record<string, unknown>
  ): Promise<SsoIdentity>;
}
