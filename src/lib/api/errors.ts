/**
 * Typed application errors.
 *
 * Every error carries a stable machine-readable `code` and a message written
 * for a human to read on screen. Handlers throw these; `handleApiRoute` maps
 * them to HTTP statuses. Anything else that escapes is treated as an internal
 * error, logged server-side, and reported to the client as a generic message —
 * stack traces and database detail never reach the browser.
 */

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "DEADLINE_PASSED"
  | "DAY_LOCKED"
  | "ROUND_CLOSED"
  | "ITEM_UNAVAILABLE"
  | "ALREADY_SETTLED"
  | "PERIOD_OVERLAP"
  | "INVALID_PERIOD"
  | "DUPLICATE"
  | "CONFLICT"
  | "MENU_PARSE_FAILED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Field-level messages, keyed by form field name. */
  readonly fields?: Record<string, string>;
  /** Server-only context for logs. Never serialized to the client. */
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      status?: number;
      fields?: Record<string, string>;
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.fields = options.fields;
    this.context = options.context;
  }
}

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  DEADLINE_PASSED: 409,
  DAY_LOCKED: 409,
  ROUND_CLOSED: 409,
  ITEM_UNAVAILABLE: 409,
  ALREADY_SETTLED: 409,
  PERIOD_OVERLAP: 409,
  INVALID_PERIOD: 422,
  DUPLICATE: 409,
  CONFLICT: 409,
  MENU_PARSE_FAILED: 422,
  INTERNAL: 500,
};

/*
 * Constructors for the errors thrown in more than one place. The messages are
 * the exact text a user reads, so they explain the next step rather than just
 * stating a rule.
 */

export const errors = {
  unauthenticated: () =>
    new AppError("UNAUTHENTICATED", "Please sign in to continue."),

  forbidden: (action = "do that") =>
    new AppError("FORBIDDEN", `You don't have permission to ${action}.`),

  notFound: (what = "That") =>
    new AppError("NOT_FOUND", `${what} could not be found.`),

  deadlinePassed: (deadlineLabel: string) =>
    new AppError(
      "DEADLINE_PASSED",
      `Ordering closed at ${deadlineLabel}. You can request a cancellation instead.`,
    ),

  /**
   * `sentToProvider` distinguishes the two locked states. Once counts are with
   * the provider, the fix is a new round, not reopening — and the generic
   * message ("ask an admin") is wrong when the reader *is* the admin.
   */
  dayLocked: (sentToProvider = false) =>
    new AppError(
      "DAY_LOCKED",
      sentToProvider
        ? "Counts for this day have already gone to the provider, so it can't be changed. Open a new round if something needs to change."
        : "Ordering has closed for this day, so it can't be changed.",
    ),

  roundClosed: () =>
    new AppError(
      "ROUND_CLOSED",
      "This round has closed. Refresh to see the latest menu.",
    ),

  itemUnavailable: (itemName: string) =>
    new AppError(
      "ITEM_UNAVAILABLE",
      `${itemName} is no longer available today. Please pick something else.`,
    ),

  alreadySettled: () =>
    new AppError(
      "ALREADY_SETTLED",
      "These days have already been billed in a settlement run, so they can't be changed.",
    ),

  periodOverlap: (runLabel: string) =>
    new AppError(
      "PERIOD_OVERLAP",
      `Some of these days were already billed in ${runLabel}. Exclude them, or include them deliberately if you're re-billing.`,
    ),

  invalidPeriod: (message: string, fields?: Record<string, string>) =>
    new AppError("INVALID_PERIOD", message, { fields }),

  menuParseFailed: () =>
    new AppError(
      "MENU_PARSE_FAILED",
      "Couldn't read that menu automatically. You can add the items manually instead.",
    ),

  internal: (context?: Record<string, unknown>, cause?: unknown) =>
    new AppError(
      "INTERNAL",
      "Something went wrong on our side. Please try again in a moment.",
      { context, cause },
    ),
};
