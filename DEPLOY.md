# Deploying Tiffine

Free-tier stack: **Render** (app + schedulers) and **Neon** (database).
Running cost: **₹0/month**.

Vercel's Hobby plan caps cron at once per day, which cannot drive a 5-minute
deadline sweep — hence Render, whose free tier allows frequent cron jobs.

---

## Before you start

- The code pushed to a GitHub repository
- Your Neon connection string (already in `.env.local`)
- Your existing keys from `.env.local` — **reuse them, don't regenerate**

> **Why reuse the VAPID keys:** a browser ties each push subscription to the
> public key that created it. New keys silently invalidate every existing
> subscription, and people stop receiving notifications with no error.

---

## 1. Push to GitHub

`.env.local` is gitignored, so secrets stay out of the repo. Confirm before the
first push:

```bash
git status --short | grep -c "\.env\.local"   # must print 0
```

---

## 2. Create the Render services

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New** →
   **Blueprint**
2. Connect the repository. Render reads `render.yaml` and proposes three
   services:
   - `tiffine` — the web app
   - `tiffine-sweep-deadlines` — closes expired deadlines every 5 minutes
   - `tiffine-keep-alive` — keeps the app warm 09:00–19:00 IST
3. Render prompts for each secret (they are `sync: false` in the blueprint, so
   they are never committed).

### Environment variables

Copy these from your `.env.local`:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon connection string | Include `?sslmode=require` |
| `AUTH_SECRET` | 32+ char random string | `openssl rand -base64 32` |
| `CRON_SECRET` | random string | Must match on web **and** cron services |
| `NEXT_PUBLIC_APP_URL` | `https://tiffine.onrender.com` | **Your real URL, not localhost** |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | from `.env.local` | Reuse — see warning above |
| `VAPID_PRIVATE_KEY` | from `.env.local` | Reuse |
| `VAPID_SUBJECT` | `mailto:you@example.com` | Required by the Web Push spec |
| `NEXT_PUBLIC_UPI_PAYEE_VPA` | your UPI ID | Powers prefilled payment links |
| `NEXT_PUBLIC_UPI_PAYEE_NAME` | display name | Shown in the payer's app |

Both cron services additionally need **`APP_URL`** set to the same value as
`NEXT_PUBLIC_APP_URL`.

To read your local values:

```bash
grep -E "VAPID|CRON_SECRET|AUTH_SECRET|UPI" .env.local
```

---

## 3. Run the migrations

Once the database URL is set, from your machine:

```bash
npm run migrate
```

Safe to re-run — applied files are tracked in a `_migrations` table.

---

## 4. Create the owner account

```bash
npx tsx scripts/seed-owner.mts you@example.com "Your Name" "a-strong-password"
```

The owner is the only account that can demote admins, and the database permits
exactly one.

---

## 5. Verify the deployment

```bash
# App is up
curl https://<your-app>.onrender.com/api/health

# The sweep rejects unauthenticated callers
curl -o /dev/null -w "%{http_code}\n" \
  https://<your-app>.onrender.com/api/cron/sweep-deadlines   # expect 403

# ...and accepts the secret
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-app>.onrender.com/api/cron/sweep-deadlines   # expect ok:true
```

Then in a browser: sign in, publish a test menu, place an order, close it early,
and check the provider counts.

---

## 6. Notifications — test on a real phone

This is the only part that cannot be verified from a terminal, and the part
most likely to fail quietly.

**iPhone — the home-screen step is mandatory.** Safari does not expose the push
API in a normal tab at all.

1. Open the site in Safari → **Share** → **Add to Home Screen**
2. Open Tiffine **from the home screen** (not the tab)
3. Settings → **Turn on notifications** → **Send a test**
4. **Send 4+ tests in a row.** iOS cancels a subscription after 3 pushes that
   fail to display a notification. The service worker is written to avoid this,
   but only a real device proves it.

**Android:** enable notifications, then background the app and send a test.
Xiaomi/Samsung/Oppo battery managers can kill service workers — if delivery is
unreliable, whitelist the app from battery optimisation.

---

## Known free-tier trade-offs

**Render sleeps after ~15 minutes idle** (~50s cold start). The keep-alive cron
pings `/api/health` every 10 minutes between 03:30–13:30 UTC (09:00–19:00 IST)
to prevent this during ordering hours. Outside that window the first visitor
may wait — acceptable, since nobody orders at 2am.

If you later want to remove that moving part, Render's Starter plan (~$7/mo)
never sleeps, and the keep-alive service can simply be deleted.

**Deadlines close within 5 minutes of passing, not exactly on time.** Not
user-visible: the ordering page and the API enforce the deadline themselves, so
an order at 10:31 is refused regardless of when the sweeper runs. The sweep
handles bookkeeping and the admin summary.

**Neon free tier** suspends compute after inactivity and resumes on the next
query (a second or two). The keep-alive deliberately does **not** touch the
database, so it doesn't burn free compute hours keeping Postgres awake.

---

## Deploying somewhere else

Nothing here is Render-specific. The app is a standard Next.js server
(`npm run build` → `npm run start`), and the sweep is an authenticated HTTPS
GET. Any scheduler works:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/sweep-deadlines
```

Free options: GitHub Actions (`schedule:` in a workflow), cron-job.org,
Cloudflare Workers cron. Vercel's own cron header is still honoured, so the app
also runs unchanged there — just limited to daily sweeps on Hobby.
