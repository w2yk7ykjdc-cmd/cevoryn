import type { ReactNode } from "react";

export default function ChatRouteLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="flex h-screen overflow-hidden">{children}</div>;
}
