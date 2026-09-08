import { computeCompanyIntelligence } from "@/server/intelligence/compute";

export async function computeCompanyIntelligenceProcessor(): Promise<void> {
  await computeCompanyIntelligence();
}
