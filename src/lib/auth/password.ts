import bcrypt from "bcryptjs";
import { z } from "zod";

/**
 * Password hashing and policy.
 *
 * Cost 12 is a deliberate balance: high enough to make offline cracking of a
 * leaked hash expensive, low enough (~250ms) that sign-in stays responsive on
 * a serverless function.
 */
const BCRYPT_COST = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Burn a comparable amount of CPU when an account does not exist.
 *
 * Without this, "no such user" returns much faster than a real password check,
 * and the timing difference lets an attacker enumerate which emails are
 * registered.
 */
export async function fakeVerifyPassword(): Promise<void> {
  await bcrypt.compare(
    "dummy-password-for-timing",
    "$2b$12$abcdefghijklmnopqrstuvwxyz012345678901234567890123456",
  );
}

/**
 * Password policy: length over composition rules. A 10-character passphrase
 * beats "P@ss1!" comfortably, and forcing symbols mostly produces predictable
 * substitutions.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters — a short phrase works well.")
  .max(200, "That password is too long.")
  .refine((value) => value.trim().length > 0, "Password can't be blank.")
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    "That password is too easy to guess. Please pick another.",
  );

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "1234567890",
  "12345678901",
  "qwertyuiop",
  "letmein123",
  "welcome123",
  "admin12345",
  "iloveyou1",
  "tiffin1234",
  "tiffine123",
]);
