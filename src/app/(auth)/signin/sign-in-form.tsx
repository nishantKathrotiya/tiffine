"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema, type SignInInput } from "@/lib/schemas/auth";
import { apiPost, applyFieldErrors } from "@/lib/api/client";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export function SignInForm({ next = "/" }: { next?: string }) {
  // Errors that aren't tied to a field (bad credentials, rate limiting).
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const result = await apiPost<{ accountStatus: string }>("/api/auth/signin", values);

    if (!result.ok) {
      // Field-level messages land on the inputs; anything else — bad
      // credentials, rate limiting, a declined account — is shown above the
      // form so it can never go unseen.
      if (!applyFieldErrors(result.error, setError, ["email", "password"])) {
        setFormError(result.error.message);
      }
      return;
    }

    // A full document load, not router.push(): the session cookie was just set
    // by the server, and every layout above this point renders from it. A
    // client-side transition would keep the stale signed-out tree, and calling
    // router.refresh() alongside push() cancels the navigation outright.
    window.location.assign(next);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && (
        <div
          role="alert"
          className="border-danger-border bg-danger-subtle flex items-start gap-2 rounded-md border px-3 py-2.5"
        >
          <AlertCircle className="text-danger mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-danger text-body">{formError}</p>
        </div>
      )}

      <Field
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoFocus
        placeholder="you@company.com"
        error={errors.email?.message}
        {...register("email")}
      />

      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        placeholder="Your password"
        error={errors.password?.message}
        {...register("password")}
      />

      <Button
        type="submit"
        size="lg"
        fullWidth
        isLoading={isSubmitting}
        loadingText="Signing in…"
      >
        Sign in
      </Button>
    </form>
  );
}
