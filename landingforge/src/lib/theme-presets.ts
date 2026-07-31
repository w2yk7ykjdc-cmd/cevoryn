export type ThemePreset = {
  id: string;
  label: string;
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  textColor: string;
  fontDisplay: string;
  fontBody: string;
  borderRadius: number;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "modern-saas",
    label: "Modern SaaS",
    primaryColor: "#2563EB",
    accentColor: "#22D3EE",
    bgColor: "#FFFFFF",
    textColor: "#0F172A",
    fontDisplay: "Inter",
    fontBody: "Inter",
    borderRadius: 12,
  },
  {
    id: "bold-startup",
    label: "Bold Startup",
    primaryColor: "#DC2626",
    accentColor: "#F59E0B",
    bgColor: "#0F172A",
    textColor: "#F8FAFC",
    fontDisplay: "Inter",
    fontBody: "Inter",
    borderRadius: 8,
  },
  {
    id: "minimal-professional",
    label: "Minimal Professional",
    primaryColor: "#111827",
    accentColor: "#6B7280",
    bgColor: "#FFFFFF",
    textColor: "#111827",
    fontDisplay: "Inter",
    fontBody: "Inter",
    borderRadius: 4,
  },
  {
    id: "warm-friendly",
    label: "Sicak & Samimi",
    primaryColor: "#EA580C",
    accentColor: "#FACC15",
    bgColor: "#FFFBEB",
    textColor: "#1C1917",
    fontDisplay: "Inter",
    fontBody: "Inter",
    borderRadius: 16,
  },
];

export function getThemePreset(id: string): ThemePreset {
  return THEME_PRESETS.find((preset) => preset.id === id) ?? THEME_PRESETS[0];
}
