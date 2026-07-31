"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText,
  formAction,
  className,
}: {
  children: React.ReactNode;
  pendingText: string;
  formAction: (formData: FormData) => void;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending}
      className={className}
    >
      {pending ? pendingText : children}
    </button>
  );
}
