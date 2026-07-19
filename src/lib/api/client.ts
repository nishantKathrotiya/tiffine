import type { ApiResponse } from "./response";

/**
 * Client-side API caller.
 *
 * Returns the discriminated envelope rather than throwing, so callers handle
 * failure explicitly instead of relying on a try/catch they might omit. The
 * server's `message` is already written for humans and is shown as-is.
 */

export type ApiFailure = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

export async function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  return request<T>(path, { method: "GET" });
}

async function request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });

    const payload = (await response.json()) as ApiResponse<T>;

    if (!payload.ok) {
      return { ok: false, error: payload.error };
    }
    return { ok: true, data: payload.data };
  } catch {
    // Network failure, or a response that wasn't JSON — both are unusable, and
    // a connection problem is the likeliest cause worth naming.
    return {
      ok: false,
      error: {
        code: "NETWORK",
        message: "Couldn't reach the server. Check your connection and try again.",
      },
    };
  }
}

/**
 * Apply server-side field errors to a react-hook-form instance.
 *
 * Keeps server validation feeling identical to client validation: the message
 * lands on the offending input rather than in a detached banner.
 *
 * Generic over the form's field names so it accepts `setError` directly. The
 * server may name a field the form doesn't have (schemas drift), so unknown
 * keys are reported as handled but skipped rather than crashing the form.
 *
 * Returns true only if at least one message was placed on a real field —
 * callers fall back to a form-level banner when it returns false, so a
 * server error is never silently swallowed.
 */
export function applyFieldErrors<TFieldName extends string>(
  error: ApiFailure,
  setError: (field: TFieldName, err: { type: string; message: string }) => void,
  knownFields?: readonly TFieldName[],
): boolean {
  if (!error.fields) return false;

  let applied = 0;
  for (const [field, message] of Object.entries(error.fields)) {
    if (knownFields && !knownFields.includes(field as TFieldName)) continue;
    setError(field as TFieldName, { type: "server", message });
    applied++;
  }
  return applied > 0;
}
