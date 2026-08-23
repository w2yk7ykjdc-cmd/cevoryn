import type { ReactNode } from "react";

export default function ChatRouteLayout({ children }: { children: ReactNode }) {
  return <div className="flex h-[100dvh] overflow-hidden">{children}</div>;
}
