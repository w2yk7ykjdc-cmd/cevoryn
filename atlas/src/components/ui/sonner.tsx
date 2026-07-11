"use client";

import { Toaster as SonnerToaster } from "sonner";

interface ToasterProps {
  richColors?: boolean;
  position?:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "top-center"
    | "bottom-center";
}

function Toaster({ richColors = true, position = "bottom-right" }: ToasterProps) {
  return (
    <SonnerToaster
      position={position}
      richColors={richColors}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
    />
  );
}

export { Toaster };
export type { ToasterProps };
