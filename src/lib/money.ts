/**
 * Money handling. All amounts are integer paise, everywhere, always.
 *
 * Floating-point rupees produce off-by-a-paisa totals that make a settlement
 * fail to reconcile against the provider's bill. That is precisely the failure
 * that would send Deep back to counting by hand, so rupees exist only at the
 * display boundary and in parsed user input — never in storage or arithmetic.
 */

/** A monetary amount in integer paise. 100 paise = ₹1. */
export type Paise = number;

export function assertPaise(value: number, label = "amount"): asserts value is Paise {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be integer paise, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} is outside the safe integer range: ${value}`);
  }
}

/**
 * Convert a rupee value to paise. Only for parsing user/AI input at the
 * boundary — never in the middle of a calculation.
 *
 * Rounds to the nearest paisa, because `12.1 * 100` is `1209.9999...` in
 * binary floating point and truncating would silently lose a paisa.
 */
export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new Error(`Cannot convert non-finite rupee value: ${rupees}`);
  }
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: Paise): number {
  assertPaise(paise);
  return paise / 100;
}

/**
 * Sum paise safely. Empty sums are 0, and every input is validated, so a stray
 * float or NaN fails loudly here rather than corrupting a settlement total.
 */
export function sumPaise(amounts: readonly Paise[]): Paise {
  let total = 0;
  for (const amount of amounts) {
    assertPaise(amount);
    total += amount;
  }
  assertPaise(total, "sum");
  return total;
}

/** Multiply a unit price by a whole-unit quantity. */
export function multiplyPaise(unitPaise: Paise, quantity: number): Paise {
  assertPaise(unitPaise, "unit price");
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`Quantity must be a non-negative integer, received ${quantity}`);
  }
  const total = unitPaise * quantity;
  assertPaise(total, "line total");
  return total;
}

/**
 * Format paise using the Indian digit grouping (lakh/crore): ₹1,24,500.
 *
 * Paise are shown only when non-zero — provider prices are whole rupees in
 * practice, and "₹40" reads better than "₹40.00" in a menu list.
 */
export function formatPaise(
  paise: Paise,
  options: { showSymbol?: boolean; forceDecimals?: boolean } = {},
): string {
  assertPaise(paise);
  const { showSymbol = true, forceDecimals = false } = options;

  const negative = paise < 0;
  const absolute = Math.abs(paise);
  const needsDecimals = forceDecimals || absolute % 100 !== 0;

  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: needsDecimals ? 2 : 0,
    maximumFractionDigits: needsDecimals ? 2 : 0,
  }).format(absolute / 100);

  return `${negative ? "-" : ""}${showSymbol ? "₹" : ""}${formatted}`;
}

/**
 * Parse a user-entered rupee string ("40", "₹1,240.50") into paise.
 * Returns null on anything unparseable so callers surface a friendly message
 * rather than storing NaN.
 */
export function parseRupeeInput(input: string): Paise | null {
  const cleaned = input.replace(/[₹,\s]/g, "").trim();
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees)) return null;
  return rupeesToPaise(rupees);
}
