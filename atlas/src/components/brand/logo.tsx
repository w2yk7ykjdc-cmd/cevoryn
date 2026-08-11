import Link from "next/link";

import { BRAND } from "@/lib/brand";
import { ROUTES } from "@/lib/constants";

import { LogoMark } from "./logo-mark";

interface LogoProps {
  className?: string;
}

/** Brand mark + wordmark, linking home. For marketing page headers. */
export function Logo({ className }: LogoProps) {
  return (
    <Link
      href={ROUTES.HOME}
      className={`flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}
    >
      <LogoMark size={22} />
      {BRAND.name}
    </Link>
  );
}
