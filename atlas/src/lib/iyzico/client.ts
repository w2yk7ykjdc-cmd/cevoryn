import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { getIyzicoConfig } from "@/lib/iyzico/config";

export interface IyzicoErrorResponse {
  status?: "success" | "failure";
  errorCode?: string;
  errorMessage?: string;
  errorGroup?: string;
  conversationId?: string;
}

export class IyzicoApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly response?: IyzicoErrorResponse
  ) {
    super(message);
    this.name = "IyzicoApiError";
  }
}

function createAuthorization(
  apiKey: string,
  secretKey: string,
  randomKey: string,
  path: string,
  body: string
): string {
  const signature = createHmac("sha256", secretKey)
    .update(`${randomKey}${path}${body}`)
    .digest("hex");
  const value = `apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`;
  return `IYZWSv2 ${Buffer.from(value, "utf8").toString("base64")}`;
}

export async function iyzicoRequest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<T> {
  const { apiKey, secretKey, baseUrl } = getIyzicoConfig();
  const method = init.method ?? "POST";
  const body = init.body === undefined ? "" : JSON.stringify(init.body);
  const randomKey = `${Date.now()}${randomUUID().replaceAll("-", "")}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: createAuthorization(apiKey, secretKey, randomKey, path, body),
      "Content-Type": "application/json",
      "x-iyzi-rnd": randomKey,
    },
    body: method === "GET" ? undefined : body,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as T & IyzicoErrorResponse;
  if (!response.ok || payload.status === "failure") {
    throw new IyzicoApiError(
      payload.errorMessage || `iyzico request failed with status ${response.status}.`,
      response.status,
      payload
    );
  }

  return payload;
}
