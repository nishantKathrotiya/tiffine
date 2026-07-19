import { TZDate } from "@date-fns/tz";
import { format, isAfter } from "date-fns";

/**
 * All date logic is anchored to Asia/Kolkata.
 *
 * The server runs in UTC. A "lunch day" is a local calendar day, so deriving it
 * from a UTC timestamp would file anything after 18:30 IST against the next
 * day — an order placed at 23:50 on the 19th would land on the 20th and corrupt
 * that day's counts and the settlement totals. Every conversion goes through
 * here rather than being done ad hoc at call sites.
 */

export const APP_TIMEZONE = "Asia/Kolkata";

/** A calendar day in IST, as `yyyy-MM-dd`. */
export type DateKey = string;

export function toAppZone(instant: Date): TZDate {
  return new TZDate(instant, APP_TIMEZONE);
}

/** The IST calendar day a given instant falls on. */
export function getDateKey(instant: Date = new Date()): DateKey {
  return format(toAppZone(instant), "yyyy-MM-dd");
}

/**
 * Build a UTC instant from an IST calendar day and wall-clock time.
 * Used when Deep sets a deadline like "today at 10:30".
 */
export function instantFromLocal(dateKey: DateKey, time: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);

  if (!year || !month || !day || Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error(`Invalid date/time: ${dateKey} ${time}`);
  }

  return new Date(
    new TZDate(year, month - 1, day, hours, minutes, 0, 0, APP_TIMEZONE).getTime(),
  );
}

export function isPast(instant: Date, now: Date = new Date()): boolean {
  return isAfter(now, instant);
}

/** e.g. "10:30 am" — for deadline labels in user-facing messages. */
export function formatTime(instant: Date): string {
  return format(toAppZone(instant), "h:mm a").toLowerCase();
}

/** e.g. "Sat, 19 Jul" */
export function formatDayShort(instant: Date | DateKey): string {
  const date = typeof instant === "string" ? parseDateKey(instant) : instant;
  return format(toAppZone(date), "EEE, d MMM");
}

/** e.g. "19 July 2026" */
export function formatDayLong(instant: Date | DateKey): string {
  const date = typeof instant === "string" ? parseDateKey(instant) : instant;
  return format(toAppZone(date), "d MMMM yyyy");
}

/** Midnight IST at the start of the given calendar day. */
export function parseDateKey(dateKey: DateKey): Date {
  return instantFromLocal(dateKey, "00:00");
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDateKey(value);
  return !Number.isNaN(parsed.getTime()) && getDateKey(parsed) === value;
}

/** Inclusive list of IST calendar days between two keys. */
export function eachDateKeyInRange(start: DateKey, end: DateKey): DateKey[] {
  const keys: DateKey[] = [];
  const endTime = parseDateKey(end).getTime();
  let cursor = parseDateKey(start);

  while (cursor.getTime() <= endTime) {
    keys.push(getDateKey(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    // Re-anchor to local midnight so DST or offset changes can't drift the
    // cursor. India has no DST today, but this must not silently break if the
    // timezone constant is ever changed.
    cursor = parseDateKey(getDateKey(cursor));
  }
  return keys;
}

/** Human countdown for a deadline: "in 42m", "in 2h 15m", "closed". */
export function formatCountdown(deadline: Date, now: Date = new Date()): string {
  const msRemaining = deadline.getTime() - now.getTime();
  if (msRemaining <= 0) return "closed";

  const totalMinutes = Math.floor(msRemaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `in ${minutes}m`;
  if (hours < 24) return minutes === 0 ? `in ${hours}h` : `in ${hours}h ${minutes}m`;
  return `in ${Math.floor(hours / 24)}d`;
}
