"use client";

import { Loader2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { handleUnauthorized } from "@/lib/client-auth";

interface CompanyProfileFormValues {
  description: string;
  industry: string;
  products: string[];
  services: string[];
  targetMarkets: string[];
  targetCustomers: string;
  idealCustomerProfile: string;
  geographies: string[];
  competitors: string[];
  suppliers: string[];
  businessModel: string;
  averageDealSize: number | null;
  strategicGoals: string[];
  strategicPriorities: string[];
  capabilities: string[];
  constraints: string[];
}

interface CompanyProfileFormProps {
  initialProfile: CompanyProfileFormValues;
  canManage: boolean;
}

function toCsv(values: string[]): string {
  return values.join(", ");
}

function fromCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function CompanyProfileForm({
  initialProfile,
  canManage,
}: CompanyProfileFormProps) {
  const t = useTranslations("settings.companyProfile");
  const [form, setForm] = useState(initialProfile);
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/radar/company-profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            industry: form.industry || null,
          }),
        });

        if (handleUnauthorized(response)) return;

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(data?.error?.message ?? t("saveFailed"));
          return;
        }

        toast.success(t("saved"));
      } catch (_error) {
        toast.error(t("saveFailed"));
      }
    });
  }

  const listField = (key: keyof CompanyProfileFormValues, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={toCsv(form[key] as string[])}
        disabled={!canManage || isPending}
        placeholder={t("listFieldHint")}
        onChange={(event) =>
          setForm((prev) => ({
            ...prev,
            [key]: fromCsv(event.target.value),
          }))
        }
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="description">{t("description")}</Label>
        <Textarea
          id="description"
          value={form.description}
          disabled={!canManage || isPending}
          placeholder={t("descriptionPlaceholder")}
          rows={3}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, description: event.target.value }))
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="industry">{t("industry")}</Label>
          <Input
            id="industry"
            value={form.industry}
            disabled={!canManage || isPending}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, industry: event.target.value }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="businessModel">{t("businessModel")}</Label>
          <Input
            id="businessModel"
            value={form.businessModel}
            disabled={!canManage || isPending}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                businessModel: event.target.value,
              }))
            }
          />
        </div>
      </div>

      {listField("products", t("products"))}
      {listField("services", t("services"))}
      {listField("targetMarkets", t("targetMarkets"))}

      <div className="space-y-1.5">
        <Label htmlFor="targetCustomers">{t("targetCustomers")}</Label>
        <Textarea
          id="targetCustomers"
          value={form.targetCustomers}
          disabled={!canManage || isPending}
          rows={2}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              targetCustomers: event.target.value,
            }))
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="idealCustomerProfile">
          {t("idealCustomerProfile")}
        </Label>
        <Textarea
          id="idealCustomerProfile"
          value={form.idealCustomerProfile}
          disabled={!canManage || isPending}
          rows={2}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              idealCustomerProfile: event.target.value,
            }))
          }
        />
      </div>

      {listField("geographies", t("geographies"))}
      {listField("competitors", t("competitors"))}
      {listField("suppliers", t("suppliers"))}

      <div className="space-y-1.5">
        <Label htmlFor="averageDealSize">{t("averageDealSize")}</Label>
        <Input
          id="averageDealSize"
          type="number"
          min={0}
          value={form.averageDealSize ?? ""}
          disabled={!canManage || isPending}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              averageDealSize: event.target.value
                ? Number(event.target.value)
                : null,
            }))
          }
        />
      </div>

      {listField("strategicGoals", t("strategicGoals"))}
      {listField("strategicPriorities", t("strategicPriorities"))}
      {listField("capabilities", t("capabilities"))}
      {listField("constraints", t("constraints"))}

      {canManage ? (
        <Button type="button" onClick={save} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t("save")}
        </Button>
      ) : null}
    </div>
  );
}
