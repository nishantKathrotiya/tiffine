import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, errors } from "./errors";

/**
 * The single response envelope for every endpoint. Clients discriminate on
 * `ok`, so success and failure never have to be inferred from a status code.
 */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fields?: Record<string, string>;
      };
    };

export function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(error: AppError): NextResponse<ApiResponse<never>> {
  return NextResponse.json(
    {
      ok: false,
      error: { code: error.code, message: error.message, fields: error.fields },
    },
    { status: error.status },
  );
}

/**
 * Flatten a Zod error into per-field messages the client can attach to inputs.
 * Uses the first message per field — showing several at once on one input is
 * noise, and fixing the first usually resolves the rest.
 */
function fieldsFromZodError(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Validate unknown input against a schema, throwing a typed AppError whose
 * field messages are already client-ready.
 *
 * Server handlers call this on every request even when the client form has
 * already validated — endpoints are reachable directly, so client validation
 * is UX and this is enforcement.
 */
export function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", "Please check the highlighted fields.", {
      fields: fieldsFromZodError(result.error),
    });
  }
  return result.data;
}

/** Parse a JSON body, converting malformed JSON into a friendly error. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", "That request wasn't formatted correctly.");
  }
}

/**
 * Wrap a route handler so every thrown error becomes a correct status and a
 * human-readable message, and no internal detail leaks.
 *
 * Usage:
 *   export const POST = handleApiRoute(async (request) => { ... return data })
 */
export function handleApiRoute<TArgs extends unknown[], TData>(
  handler: (request: Request, ...args: TArgs) => Promise<TData>,
) {
  return async (
    request: Request,
    ...args: TArgs
  ): Promise<NextResponse<ApiResponse<TData>>> => {
    try {
      return ok(await handler(request, ...args));
    } catch (caught) {
      if (caught instanceof AppError) {
        // Server-side failures are worth a log line; user mistakes are not.
        if (caught.status >= 500) {
          console.error("[api] %s %s", request.method, new URL(request.url).pathname, {
            code: caught.code,
            context: caught.context,
            cause: caught.cause,
          });
        }
        return fail(caught);
      }

      // Zod errors thrown outside parseOrThrow still deserve field mapping.
      if (caught instanceof ZodError) {
        return fail(
          new AppError("VALIDATION_FAILED", "Please check the highlighted fields.", {
            fields: fieldsFromZodError(caught),
          }),
        );
      }

      // Anything unrecognised: log the truth, return a safe message.
      console.error(
        "[api] Unhandled error on %s %s",
        request.method,
        new URL(request.url).pathname,
        caught,
      );
      return fail(errors.internal(undefined, caught));
    }
  };
}
