"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MembershipContext } from "@/types";

import { Sidebar } from "./sidebar";

interface MobileNavProps {
  membership: MembershipContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileNav({ membership, open, onOpenChange }: MobileNavProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <Sidebar membership={membership} />
      </SheetContent>
    </Sheet>
  );
}
