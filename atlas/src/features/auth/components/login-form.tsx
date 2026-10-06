"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Globe2,
  Layers3,
  Loader2,
  LockKeyhole,
  Mail,
  Radar,
  ShieldCheck,
  Sparkles,
  Users,
  Eye,
  EyeOff,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

import { googleLoginAction, loginAction } from "../actions/auth";
import { createLoginSchema } from "../schemas/auth";
import type { LoginInput } from "../schemas/auth";

interface LoginFormProps {
  redirectTo?: string;
  authError?: string;
  passwordReset?: boolean;
  sessionExpired?: boolean;
}

function BrandMark() {
  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-200/40 bg-white/[0.04] shadow-[0_0_35px_rgba(245,190,92,0.12)]"
    >
      <svg viewBox="0 0 32 32" className="h-6 w-6 text-amber-200" fill="none">
        <path
          d="M16 3.5 20.2 11l8.3 5-8.3 5L16 28.5 11.8 21 3.5 16l8.3-5L16 3.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M16 8.5 18.1 13l4.4 3-4.4 3L16 23.5 13.9 19 9.5 16l4.4-3L16 8.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
    </div>
  );
}

export function LoginForm({
  redirectTo,
  authError,
  passwordReset = false,
  sessionExpired = false,
}: LoginFormProps) {
  const router = useRouter();
  const t = useTranslations("auth.login");
  const landing = useTranslations("landing");
  const nav = useTranslations("nav");
  const tValidation = useTranslations("auth.validation");
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const signupHref = redirectTo
    ? ROUTES.SIGNUP + "?next=" + encodeURIComponent(redirectTo)
    : ROUTES.SIGNUP;

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<LoginInput>({
    resolver: zodResolver(
      createLoginSchema({
        invalidEmail: tValidation("invalidEmail"),
        passwordMinLength: tValidation("passwordMinLength"),
        passwordComplexity: tValidation("passwordComplexity"),
        passwordsDoNotMatch: tValidation("passwordsDoNotMatch"),
      })
    ),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(data: LoginInput) {
    setIsPending(true);

    try {
      const result = await loginAction(data, redirectTo);
      if (!result.success) {
        toast.error(result.error);
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, messages]) => {
            setError(field as keyof LoginInput, {
              message: messages[0],
            });
          });
        }
        return;
      }

      const target = result.data || ROUTES.DASHBOARD;
      router.prefetch(target);
      router.replace(target);
    } catch (error) {
      console.error("Login failed:", error);
      toast.error(t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050713] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_35%,rgba(81,76,145,0.28),transparent_32%),radial-gradient(circle_at_78%_20%,rgba(30,91,150,0.2),transparent_30%),linear-gradient(135deg,#03040a_0%,#080c1d_52%,#11172b_100%)]" />
      <div className="absolute -left-32 top-24 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="absolute right-0 top-0 h-[32rem] w-[32rem] rounded-full bg-amber-300/5 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col px-5 py-5 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <Link href="/" className="group flex items-center gap-3">
            <BrandMark />
            <span className="text-lg font-semibold tracking-[0.22em] text-white">
              CEVORYN
            </span>
          </Link>

          <div className="flex items-center gap-3 text-sm text-white/60">
            <span className="hidden sm:inline">{t("noAccount")}</span>
            <Link
              href={signupHref}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.03] px-4 py-2 font-medium text-white transition hover:border-amber-200/50 hover:bg-white/[0.07]"
            >
              {t("signUpLink")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </header>

        <div className="flex flex-1 items-center py-10 lg:py-14">
          <div className="grid w-full gap-10 lg:grid-cols-[1fr_minmax(420px,520px)] lg:items-center lg:gap-20">
            <section className="relative max-w-2xl">
              <div className="absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl" />

              <div className="relative">
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-amber-100/80">
                  <Sparkles className="h-3.5 w-3.5" />
                  {landing("tagline")}
                </div>

                <h1 className="max-w-xl text-5xl font-semibold leading-[0.98] tracking-[-0.04em] sm:text-6xl lg:text-7xl">
                  {landing("tagline")}
                </h1>

                <p className="mt-7 max-w-xl text-base leading-7 text-white/60 sm:text-lg">
                  {landing("subtitle")}
                </p>

                <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 backdrop-blur-xl">
                    <BrainCircuit className="h-5 w-5 text-amber-200" />
                    <p className="mt-4 text-sm font-semibold">
                      {landing("features.chat.title")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-white/45">
                      {landing("features.chat.description")}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 backdrop-blur-xl">
                    <Radar className="h-5 w-5 text-amber-200" />
                    <p className="mt-4 text-sm font-semibold">{nav("radar")}</p>
                    <p className="mt-1 text-xs leading-5 text-white/45">
                      {landing("features.brief.description")}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 backdrop-blur-xl">
                    <Users className="h-5 w-5 text-amber-200" />
                    <p className="mt-4 text-sm font-semibold">
                      {landing("features.team.title")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-white/45">
                      {landing("features.team.description")}
                    </p>
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-white/45">
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-amber-200/80" />
                    Secure by design
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Layers3 className="h-4 w-4 text-amber-200/80" />
                    One workspace
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Globe2 className="h-4 w-4 text-amber-200/80" />
                    Access anywhere
                  </span>
                </div>
              </div>
            </section>

            <section className="relative">
              <div className="absolute -inset-5 rounded-[2rem] bg-indigo-500/10 blur-2xl" />

              <div className="relative overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#0b0e19]/90 p-6 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:p-8">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/60 to-transparent" />

                <div className="mb-8 text-center">
                  <div className="mb-5 flex justify-center">
                    <BrandMark />
                  </div>
                  <h2 className="text-3xl font-semibold tracking-tight">
                    {t("title")}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-white/50">
                    {t("description")}
                  </p>
                </div>

                {passwordReset && (
                  <div
                    role="status"
                    className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{t("passwordResetSuccess")}</p>
                  </div>
                )}

                {sessionExpired && (
                  <div
                    role="status"
                    className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-50"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{t("sessionExpired")}</p>
                  </div>
                )}

                {authError && (
                  <p
                    role="alert"
                    className="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100"
                  >
                    {authError}
                  </p>
                )}

                <form action={googleLoginAction} className="mb-5">
                  {redirectTo && (
                    <input
                      type="hidden"
                      name="redirectTo"
                      value={redirectTo}
                    />
                  )}
                  <Button
                    type="submit"
                    variant="outline"
                    className="h-12 w-full rounded-xl border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08] hover:text-white"
                  >
                    <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-900">
                      G
                    </span>
                    {t("continueWithGoogle")}
                  </Button>
                </form>

                <div className="relative mb-5">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-[#0b0e19] px-3 text-white/35">
                      {t("or")}
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-white/80">
                      {t("email")}
                    </Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@company.com"
                        autoComplete="email"
                        aria-invalid={!!errors.email}
                        aria-describedby={
                          errors.email ? "email-error" : undefined
                        }
                        className="h-12 rounded-xl border-white/15 bg-white/[0.035] pl-10 text-white placeholder:text-white/25 focus-visible:border-amber-200/60 focus-visible:ring-amber-200/20"
                        {...register("email")}
                      />
                    </div>
                    {errors.email && (
                      <p id="email-error" className="text-sm text-red-300">
                        {errors.email.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-white/80">
                        {t("password")}
                      </Label>
                      <Link
                        href={ROUTES.FORGOT_PASSWORD}
                        className="text-sm text-amber-200/80 transition hover:text-amber-100 hover:underline"
                      >
                        {t("forgotPassword")}
                      </Link>
                    </div>

                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        aria-invalid={!!errors.password}
                        aria-describedby={
                          errors.password ? "password-error" : undefined
                        }
                        className="h-12 rounded-xl border-white/15 bg-white/[0.035] pl-10 pr-11 text-white placeholder:text-white/25 focus-visible:border-amber-200/60 focus-visible:ring-amber-200/20"
                        {...register("password")}
                      />
                      <button
                        type="button"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 transition hover:text-white/70"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {errors.password && (
                      <p id="password-error" className="text-sm text-red-300">
                        {errors.password.message}
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="h-12 w-full rounded-xl border-0 bg-gradient-to-r from-amber-100 to-amber-200 text-slate-950 shadow-[0_10px_40px_rgba(245,190,92,0.12)] transition hover:from-amber-50 hover:to-amber-100"
                    disabled={isPending}
                  >
                    {isPending && <Loader2 className="animate-spin" />}
                    {t("submit")}
                    {!isPending && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </form>

                <div className="mt-7 border-t border-white/10 pt-6 text-center text-sm text-white/45">
                  {t("noAccount")}{" "}
                  <Link
                    href={signupHref}
                    className="font-medium text-amber-200 transition hover:text-amber-100 hover:underline"
                  >
                    {t("signUpLink")}
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>

        <footer className="border-t border-white/10 py-5">
          <div className="grid gap-4 text-xs text-white/40 sm:grid-cols-3">
            <div className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-200/70" />
              Secure workspace
            </div>
            <div className="inline-flex items-center gap-2 sm:justify-center">
              <BrainCircuit className="h-4 w-4 text-amber-200/70" />
              Intelligence powered by AI
            </div>
            <div className="inline-flex items-center gap-2 sm:justify-end">
              <Users className="h-4 w-4 text-amber-200/70" />
              Built for individuals & teams
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
