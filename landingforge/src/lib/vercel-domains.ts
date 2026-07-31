type VercelDomainResponse = {
  name: string;
  verified: boolean;
  verification?: { type: string; domain: string; value: string; reason: string }[];
};

export class VercelNotConfiguredError extends Error {
  constructor() {
    super(
      "Vercel domain entegrasyonu yapilandirilmamis (VERCEL_API_TOKEN / VERCEL_PROJECT_ID eksik).",
    );
    this.name = "VercelNotConfiguredError";
  }
}

function getVercelConfig() {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !projectId) return null;
  return { token, projectId, teamId };
}

function withTeam(url: string, teamId?: string) {
  return teamId ? `${url}${url.includes("?") ? "&" : "?"}teamId=${teamId}` : url;
}

export async function addDomainToVercelProject(
  domain: string,
): Promise<VercelDomainResponse> {
  const config = getVercelConfig();
  if (!config) throw new VercelNotConfiguredError();

  const url = withTeam(
    `https://api.vercel.com/v10/projects/${config.projectId}/domains`,
    config.teamId,
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: domain }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Domain Vercel'e eklenemedi.");
  }
  return data;
}

export async function getDomainVerification(
  domain: string,
): Promise<VercelDomainResponse> {
  const config = getVercelConfig();
  if (!config) throw new VercelNotConfiguredError();

  const url = withTeam(
    `https://api.vercel.com/v9/projects/${config.projectId}/domains/${domain}`,
    config.teamId,
  );

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}` },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Domain durumu alinamadi.");
  }
  return data;
}

export async function removeDomainFromVercelProject(domain: string): Promise<void> {
  const config = getVercelConfig();
  if (!config) throw new VercelNotConfiguredError();

  const url = withTeam(
    `https://api.vercel.com/v9/projects/${config.projectId}/domains/${domain}`,
    config.teamId,
  );

  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.token}` },
  });

  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error?.message || "Domain Vercel'den kaldirilamadi.");
  }
}
