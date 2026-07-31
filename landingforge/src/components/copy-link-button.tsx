"use client";

import { useState } from "react";

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded border px-2 py-1 text-xs hover:bg-white"
    >
      {copied ? "Kopyalandi!" : "Linki kopyala"}
    </button>
  );
}
