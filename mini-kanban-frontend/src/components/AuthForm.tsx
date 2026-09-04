"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button, Input } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import {
  loginSchema,
  registerSchema,
  type LoginValues,
  type RegisterValues,
} from "@/lib/schemas";
import type { User } from "@/lib/types";

type Mode = "login" | "register";

/** Both auth screens are the same form with one extra field, so they share a
 *  component rather than duplicating validation and error handling. */
export function AuthForm({ mode }: { mode: Mode }) {
  const isRegister = mode === "register";
  const router = useRouter();
  const params = useSearchParams();

  // Only ever an internal path: `next` comes from the URL, so treating it as
  // a redirect target without this check would be an open-redirect.
  const rawNext = params.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : "/boards";

  const form = useForm<RegisterValues>({
    resolver: zodResolver(isRegister ? registerSchema : (loginSchema as never)),
    defaultValues: { name: "", email: "", password: "" },
    mode: "onSubmit",
  });

  const submit = useMutation({
    mutationFn: async (values: RegisterValues | LoginValues) => {
      if (isRegister) {
        // Register does not set cookies (backend Phase 4) — log in straight
        // after, so the user lands authenticated rather than on a login form.
        await post<User>("/api/v1/auth/register", values);
      }
      return post<User>("/api/v1/auth/login", {
        email: values.email,
        password: values.password,
      });
    },
    onSuccess: () => {
      // replace, not push: the back button must not return to a form the user
      // has already completed. refresh re-runs middleware with the new cookie.
      router.replace(next);
      router.refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          form.setError("email", { message: "That email is already registered" });
          return;
        }
        if (error.status === 401) {
          form.setError("password", { message: "Email or password is incorrect" });
          return;
        }
        if (error.status === 429) {
          toast.error("Too many attempts — wait a minute and try again.");
          return;
        }
      }
      toast.error("Something went wrong. Please try again.");
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[380px]">
        <header className="mb-6">
          <h1 className="font-archivo text-[32px] font-bold leading-[1.1] tracking-[-.022em] text-[#F6EFE3]">
            {isRegister ? "Open a new drawer" : "Back to the filing room"}
          </h1>
          <p className="mt-2 font-courier text-[12.5px] text-[rgba(255,240,220,.6)]">
            {isRegister
              ? "Create an account to start filing cards."
              : "Sign in to pick up where you left off."}
          </p>
        </header>

        <form
          noValidate
          onSubmit={form.handleSubmit((v) => submit.mutate(v))}
          className="on-paper flex flex-col gap-4 rounded-[4px] border border-card-edge bg-card p-5 shadow-tray"
        >
          {isRegister && (
            <Input
              label="Name"
              autoComplete="name"
              error={form.formState.errors.name?.message}
              {...form.register("name")}
            />
          )}
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            error={form.formState.errors.email?.message}
            {...form.register("email")}
          />
          <Input
            label="Password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            error={form.formState.errors.password?.message}
            {...form.register("password")}
          />

          <Button
            type="submit"
            variant="primary"
            loading={submit.isPending}
            className="mt-1 w-full"
          >
            {submit.isPending
              ? isRegister
                ? "Creating…"
                : "Signing in…"
              : isRegister
                ? "Create account"
                : "Sign in"}
          </Button>

          <p className="text-center font-courier text-[11px] text-faint">
            {isRegister ? "Already have an account? " : "No account yet? "}
            <Link
              href={isRegister ? "/login" : "/register"}
              className="font-bold text-blue underline-offset-2 hover:underline"
            >
              {isRegister ? "Sign in" : "Create one"}
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
