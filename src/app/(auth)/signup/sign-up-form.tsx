"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signUpSchema, type SignUpInput } from "@/lib/schemas/auth";
import { apiPost, applyFieldErrors } from "@/lib/api/client";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export function SignUpForm({ next = "/" }: { next?: string }) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    // Re-validate as the user corrects a field, so an error clears as soon as
    // it is fixed rather than only on the next submit.
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const result = await apiPost<{ accountStatus: string }>("/api/auth/signup", values);

    if (!result.ok) {
      if (
        !applyFieldErrors(result.error, setError, [
          "name",
          "email",
          "password",
          "confirmPassword",
        ])
      ) {
        setFormError(result.error.message);
      }
      return;
    }

    // Signup creates a session immediately; the dashboard explains the pending
    // state rather than leaving the person on a dead-end screen.
    // Full load for the same reason as sign-in: the cookie is server-set and
    // the layouts above must re-render against it.
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
        label="Your name"
        autoComplete="name"
        autoFocus
        placeholder="Nishant"
        hint="How you'll appear in the group's order list."
        error={errors.name?.message}
        {...register("name")}
      />

      <Field
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@company.com"
        error={errors.email?.message}
        {...register("email")}
      />

      <Field
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder="At least 10 characters"
        hint="A short phrase is easier to remember and harder to guess."
        error={errors.password?.message}
        {...register("password")}
      />

      <Field
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        placeholder="Type it again"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />

      <Button
        type="submit"
        size="lg"
        fullWidth
        isLoading={isSubmitting}
        loadingText="Creating account…"
      >
        Create account
      </Button>
    </form>
  );
}
