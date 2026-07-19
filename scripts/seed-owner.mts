/**
 * Create the super-admin (owner) account.
 *
 * Run once per environment. The owner is the only account that can demote
 * admins, and the database allows exactly one, so this is deliberately a
 * separate step rather than something the signup flow can grant.
 *
 * Run: npx tsx scripts/seed-owner.mts <email> <name> <password>
 */
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const [email, name, password] = process.argv.slice(2);

if (!email || !name || !password) {
  console.error("Usage: npx tsx scripts/seed-owner.mts <email> <name> <password>");
  process.exit(1);
}

if (password.length < 10) {
  console.error("Password must be at least 10 characters.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const normalizedEmail = email.trim().toLowerCase();

  const existingOwner = await sql`select email from people where is_super_admin = true limit 1`;
  if (existingOwner.length > 0) {
    console.error(
      `An owner already exists (${existingOwner[0].email}). ` +
        `The database permits only one; remove that flag first if you need to move it.`,
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const existingPerson = await sql`select id from people where email = ${normalizedEmail}`;

  if (existingPerson.length > 0) {
    await sql`
      update people
         set is_admin = true, is_super_admin = true, account_status = 'approved',
             approved_at = now(), password_hash = ${passwordHash}, name = ${name}
       where email = ${normalizedEmail}
    `;
    console.log(`Promoted existing account ${normalizedEmail} to owner.`);
  } else {
    await sql`
      insert into people (email, name, password_hash, account_status, is_admin, is_super_admin, approved_at)
      values (${normalizedEmail}, ${name}, ${passwordHash}, 'approved', true, true, now())
    `;
    console.log(`Created owner account ${normalizedEmail}.`);
  }

  console.log("Sign in at /signin with that email and password.");
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
