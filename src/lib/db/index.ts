import { neon, types as pgTypes } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Return `date` columns as plain "yyyy-MM-dd" strings.
 *
 * By default the driver parses them into JS Date objects at UTC midnight,
 * which in IST is 18:30 the *previous* day — so `2026-07-15` read back as the
 * 14th and every settlement boundary silently shifted by one. A calendar day
 * has no time zone; keeping it a string is the only representation that can't
 * drift.
 *
 * OID 1082 = date. Timestamps (timestamptz) are untouched: those are real
 * instants and must stay Date objects.
 */
const PG_OID_DATE = 1082;
pgTypes.setTypeParser(PG_OID_DATE, (value: string) => value);

/**
 * Neon database client.
 *
 * Uses the HTTP driver, which suits serverless request handlers: no pool to
 * exhaust and no connection to leak between invocations.
 *
 * The client is created lazily on first query rather than at module load, so
 * importing a route handler during `next build` does not require a live
 * DATABASE_URL. Env validation still runs on the first real request.
 *
 * Note that neon-http cannot run interactive transactions. Multi-statement work
 * that must be atomic — committing a settlement run, applying a re-poll — goes
 * through `db.batch()` or a single statement with CTEs, not begin/commit.
 */

type Database = NeonHttpDatabase<typeof schema>;

let instance: Database | null = null;

function getDb(): Database {
  if (!instance) {
    instance = drizzle({
      client: neon(env.DATABASE_URL),
      schema,
      casing: "snake_case",
    });
  }
  return instance;
}

/**
 * Proxy so call sites keep the familiar `db.select()` shape while construction
 * stays deferred to the first property access.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver);
  },
});

export { schema };
export * from "./schema";
