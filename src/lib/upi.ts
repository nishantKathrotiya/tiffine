import { formatPaise, paiseToRupees, type Paise } from "./money";

/**
 * UPI deep links.
 *
 * The amount is embedded in the link, so a formatting mistake here means
 * someone pays the wrong sum. Two rules follow from that:
 *
 *   - `am` must be a plain decimal with exactly two places and no separators.
 *     UPI apps reject or misread "1,240.50".
 *   - Every field is percent-encoded. An unescaped "&" in a name would
 *     terminate the amount parameter early.
 */

export type UpiLinkInput = {
  /** Payee VPA, e.g. deep@okhdfcbank */
  payeeVpa: string;
  payeeName: string;
  amountPaise: Paise;
  /** Shown in the payer's app — what this payment is for. */
  note?: string;
};

export function isValidVpa(vpa: string): boolean {
  // handle@provider. Deliberately permissive: banks differ, and single-
  // character handles are legal. This is a typo guard, not an allowlist —
  // rejecting a valid VPA would stop a real person being paid, which is worse
  // than letting a wrong-but-well-formed one through to the payer's app.
  return /^[a-zA-Z0-9._-]{1,64}@[a-zA-Z][a-zA-Z0-9.]{0,63}$/.test(vpa.trim());
}

/**
 * Build a `upi://pay` link.
 *
 * Returns null when the payee isn't configured or the amount is non-positive —
 * a zero-amount UPI link is not something to hand anyone.
 */
export function buildUpiLink(input: UpiLinkInput): string | null {
  const vpa = input.payeeVpa?.trim();
  if (!vpa || !isValidVpa(vpa)) return null;
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) return null;

  // Exactly two decimals, no thousands separators.
  const amount = paiseToRupees(input.amountPaise).toFixed(2);

  const params = new URLSearchParams({
    pa: vpa,
    pn: input.payeeName.trim() || "Tiffine",
    am: amount,
    cu: "INR",
  });

  if (input.note?.trim()) {
    // UPI notes are short; over-long text is dropped by some apps.
    params.set("tn", input.note.trim().slice(0, 50));
  }

  return `upi://pay?${params.toString()}`;
}

/**
 * A WhatsApp-ready message asking one person for their amount.
 *
 * Written to be pasted as-is: the person sees what they owe, for which period,
 * and a link that opens their UPI app with the amount already filled in.
 */
export function buildPaymentMessage(input: {
  personName: string;
  amountPaise: Paise;
  periodLabel: string;
  upiLink: string | null;
}): string {
  const lines = [
    `Hi ${input.personName}, tiffin total for ${input.periodLabel}: ${formatPaise(input.amountPaise)}`,
  ];

  if (input.upiLink) {
    lines.push("", `Pay here: ${input.upiLink}`);
  }

  return lines.join("\n");
}
