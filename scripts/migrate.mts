/**
 * Apply SQL migrations to the configured database.
 *
 * Tracks applied files in a `_migrations` table so re-running is safe. Uses the
 * plain pg driver rather than neon-http because DDL needs a real session.
 *
 * Run: npx tsx scripts/migrate.mts
 */
import { neon } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env.local.");
  process.exit(1);
}

const sql = neon(connectionString);

/**
 * Split a migration into individual statements.
 *
 * Semicolons inside `$$ ... $$` bodies (the updated_at trigger function) are
 * part of the function, not statement terminators, so dollar-quoted regions are
 * tracked and skipped over.
 */
function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let dollarTag: string | null = null;
  let i = 0;

  while (i < script.length) {
    // Strip line comments first. An apostrophe inside one ("-- Deep's") would
    // otherwise look like the start of a string literal and swallow the rest
    // of the script.
    if (!dollarTag && script.startsWith("--", i)) {
      const lineEnd = script.indexOf("\n", i);
      i = lineEnd === -1 ? script.length : lineEnd + 1;
      current += " ";
      continue;
    }

    // Copy string literals verbatim so semicolons inside them are not treated
    // as terminators.
    if (!dollarTag && script[i] === "'") {
      const start = i;
      i++;
      while (i < script.length) {
        if (script[i] === "'" && script[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (script[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      current += script.slice(start, i);
      continue;
    }

    if (!dollarTag) {
      const opening = /^\$([A-Za-z_]*)\$/.exec(script.slice(i));
      if (opening) {
        dollarTag = opening[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
      if (script[i] === ";") {
        if (current.trim()) statements.push(current.trim());
        current = "";
        i++;
        continue;
      }
    } else if (script.startsWith(dollarTag, i)) {
      current += dollarTag;
      i += dollarTag.length;
      dollarTag = null;
      continue;
    }

    current += script[i];
    i++;
  }

  if (current.trim()) statements.push(current.trim());

  // Drop comment-only fragments left behind by the split.
  return statements.filter((statement) =>
    statement.split("\n").some((line) => line.trim() && !line.trim().startsWith("--")),
  );
}

async function main() {
  await sql`
    create table if not exists _migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql`select filename from _migrations`).map((row) => row.filename as string),
  );

  const dir = join(process.cwd(), "drizzle/migrations");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  let count = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip   ${file} (already applied)`);
      continue;
    }

    const contents = readFileSync(join(dir, file), "utf8");
    process.stdout.write(`  apply  ${file} … `);

    try {
      // Neon's HTTP driver rejects multi-statement strings, so the script is
      // split and sent statement by statement.
      for (const statement of splitStatements(contents)) {
        await sql.query(statement);
      }
      await sql`insert into _migrations (filename) values (${file})`;
      console.log("ok");
      count++;
    } catch (error) {
      console.log("FAILED");
      console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }

  console.log(count === 0 ? "\nNothing to apply — database is up to date.\n" : `\nApplied ${count} migration(s).\n`);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
