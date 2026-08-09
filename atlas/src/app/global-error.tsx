"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/client-error-reporter";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "global");
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            fontFamily: "system-ui, sans-serif",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <h1>Something went wrong</h1>
          <p>The application could not recover from an unexpected error.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              marginTop: "16px",
              padding: "10px 16px",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
