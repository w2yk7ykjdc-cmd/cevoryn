"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { BillingPlan } from "@/features/billing/config/plans";

interface IyzicoCheckoutDialogProps {
  plan: BillingPlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CheckoutResponse {
  checkoutFormContent?: string;
  error?: string;
}

const fieldClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function IyzicoCheckoutDialog({
  plan,
  open,
  onOpenChange,
}: IyzicoCheckoutDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [checkoutHtml, setCheckoutHtml] = useState<string | null>(null);
  const checkoutContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setCheckoutHtml(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!checkoutHtml || !checkoutContainerRef.current) return;

    const container = checkoutContainerRef.current;
    container.innerHTML = checkoutHtml;

    for (const oldScript of Array.from(container.querySelectorAll("script"))) {
      const newScript = document.createElement("script");
      for (const attribute of Array.from(oldScript.attributes)) {
        newScript.setAttribute(attribute.name, attribute.value);
      }
      newScript.text = oldScript.text;
      oldScript.replaceWith(newScript);
    }

    return () => {
      container.innerHTML = "";
    };
  }, [checkoutHtml]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan) return;

    const formData = new FormData(event.currentTarget);
    const payload = {
      plan,
      customer: {
        name: String(formData.get("name") ?? ""),
        surname: String(formData.get("surname") ?? ""),
        gsmNumber: String(formData.get("gsmNumber") ?? ""),
        identityNumber: String(formData.get("identityNumber") ?? ""),
        billingAddress: {
          address: String(formData.get("address") ?? ""),
          zipCode: String(formData.get("zipCode") ?? ""),
          city: String(formData.get("city") ?? ""),
          country: String(formData.get("country") ?? "Türkiye"),
        },
      },
    };

    try {
      setSubmitting(true);
      const response = await fetch("/api/billing/iyzico/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as CheckoutResponse;

      if (!response.ok || !result.checkoutFormContent) {
        throw new Error(result.error ?? "iyzico ödeme formu başlatılamadı.");
      }

      setCheckoutHtml(result.checkoutFormContent);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ödeme başlatılamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92vh] w-full overflow-y-auto sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>{plan ? `${plan} aboneliği` : "Abonelik"}</SheetTitle>
          <SheetDescription>
            Fatura bilgilerini girin. Kart bilgileri doğrudan iyzico ödeme formunda işlenir ve CEVORYN tarafından saklanmaz.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {checkoutHtml ? (
            <div id="iyzipay-checkout-form" className="responsive" ref={checkoutContainerRef} />
          ) : (
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ad" name="name" autoComplete="given-name" required />
                <Field label="Soyad" name="surname" autoComplete="family-name" required />
                <Field
                  label="Telefon"
                  name="gsmNumber"
                  type="tel"
                  placeholder="+905551112233"
                  autoComplete="tel"
                  required
                />
                <Field
                  label="T.C. kimlik / vergi numarası"
                  name="identityNumber"
                  inputMode="numeric"
                  placeholder="10 veya 11 hane"
                  required
                />
                <Field label="Şehir" name="city" autoComplete="address-level2" required />
                <Field label="Posta kodu" name="zipCode" autoComplete="postal-code" required />
                <Field
                  label="Ülke"
                  name="country"
                  defaultValue="Türkiye"
                  autoComplete="country-name"
                  required
                />
              </div>

              <label className="grid gap-1.5 text-sm font-medium">
                Fatura adresi
                <textarea
                  name="address"
                  minLength={10}
                  maxLength={500}
                  required
                  autoComplete="street-address"
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </label>

              <p className="text-xs text-muted-foreground">
                Bu bilgiler ödeme kuruluşunun yasal ve faturalama gereklilikleri için iyzico sistemine gönderilir.
              </p>

              <Button type="submit" disabled={submitting || !plan}>
                {submitting ? <Loader2 className="animate-spin" /> : null}
                Güvenli ödemeye geç
              </Button>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  name,
  type = "text",
  ...props
}: {
  label: string;
  name: string;
  type?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "type">) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <input className={fieldClassName} name={name} type={type} {...props} />
    </label>
  );
}
