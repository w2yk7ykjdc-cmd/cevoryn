"use client";

import { useState } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";

let paddlePromise: Promise<Paddle | undefined> | null = null;

function getPaddle() {
  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
      environment:
        process.env.NEXT_PUBLIC_PADDLE_ENV === "production"
          ? "production"
          : "sandbox",
    });
  }
  return paddlePromise;
}

export function PaddleCheckoutButton({
  priceId,
  userId,
  email,
  children,
}: {
  priceId: string;
  userId: string;
  email: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const paddleInstance = await getPaddle();
      paddleInstance?.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: { email },
        customData: { userId },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? "Yukleniyor..." : children}
    </button>
  );
}
