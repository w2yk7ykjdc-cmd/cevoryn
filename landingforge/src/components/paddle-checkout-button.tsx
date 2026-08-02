"use client";

import { useState } from "react";
import {
  CheckoutEventNames,
  initializePaddle,
  type Paddle,
} from "@paddle/paddle-js";

let paddlePromise: Promise<Paddle | undefined> | null = null;

function getPaddle() {
  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
      environment:
        process.env.NEXT_PUBLIC_PADDLE_ENV === "production"
          ? "production"
          : "sandbox",
      // The webhook is what actually upgrades the user's plan, and it
      // can lag a checkout by a couple of seconds - this only confirms
      // the payment went through and sends the user somewhere that'll
      // reflect the new plan once it lands, instead of leaving them on
      // /pricing with no acknowledgement that anything happened.
      eventCallback(event) {
        if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) {
          window.location.href = "/dashboard?paddle=success";
        }
      },
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
