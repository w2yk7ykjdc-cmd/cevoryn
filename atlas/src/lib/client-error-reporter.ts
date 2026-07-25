type ReportableError = Error & { digest?: string };

function truncate(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  return value.slice(0, maxLength);
}

export function reportClientError(
  error: ReportableError,
  boundary: "route" | "global"
) {
  const payload = JSON.stringify({
    boundary,
    name: truncate(error.name, 80),
    message: truncate(error.message, 500),
    digest: truncate(error.digest, 160),
    path: truncate(window.location.pathname, 300),
    occurredAt: new Date().toISOString(),
  });

  try {
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(
        "/api/client-errors",
        new Blob([payload], { type: "application/json" })
      );
      if (sent) return;
    }

    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
      credentials: "same-origin",
    });
  } catch {
    // Error reporting must never replace or mask the original application error.
  }
}
