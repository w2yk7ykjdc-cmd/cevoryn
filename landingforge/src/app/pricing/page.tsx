import { requireUser } from "@/lib/get-current-user";
import { PaddleCheckoutButton } from "@/components/paddle-checkout-button";

export default async function PricingPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-16">
      <h1 className="text-3xl font-semibold">Plan sec</h1>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-lg border p-6">
          <h2 className="text-xl font-medium">Pro</h2>
          <PaddleCheckoutButton
            priceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO!}
            userId={user.id}
            email={user.email}
          >
            Pro&apos;ya gec
          </PaddleCheckoutButton>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border p-6">
          <h2 className="text-xl font-medium">Business</h2>
          <PaddleCheckoutButton
            priceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_BUSINESS!}
            userId={user.id}
            email={user.email}
          >
            Business&apos;a gec
          </PaddleCheckoutButton>
        </div>
      </div>
    </div>
  );
}
