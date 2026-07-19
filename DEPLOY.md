# Deploying Tiffine

Free-tier stack: **Vercel** (app), **Neon** (database), **Upstash QStash**
(deadline scheduling). Running cost: **₹0/month**.

**Why scheduling doesn't live on the host:** Vercel Hobby caps cron at once per
day, and Render has no free cron plan at all. Neither can drive a per-day
deadline. QStash schedules one callback at each day's exact deadline instead —
free, and more precise than any polling sweep.

Vercel serverless functions don't idle-sleep, so no keep-alive ping is needed.

---

## Before you start

- The code pushed to a GitHub repository
- Your Neon connection string and keys from `.env.local` — **reuse them, don't
  regenerate**

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

## 2. Import into Vercel

1. [vercel.com/new](https://vercel.com/new) → import the repository
2. Framework preset: **Next.js** (auto-detected)
3. Leave Root Directory, Build Command, and Output Directory at their defaults
4. Add the environment variables below **before** the first deploy

### Environment variables

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon connection string | Include `?sslmode=require` |
| `AUTH_SECRET` | 32+ char random string | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | `https://<your-app>.vercel.app` | **Your real URL, not localhost** |
| `QSTASH_TOKEN` | from Upstash console | Schedules the deadline callback |
| `QSTASH_URL` | from Upstash console | e.g. `https://qstash-eu-central-1.upstash.io` |
| `QSTASH_CURRENT_SIGNING_KEY` | from Upstash console | Verifies callbacks are genuinely QStash |
| `QSTASH_NEXT_SIGNING_KEY` | from Upstash console | Used during key rotation |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | from `.env.local` | Reuse — see warning above |
| `VAPID_PRIVATE_KEY` | from `.env.local` | Reuse |
| `VAPID_SUBJECT` | `mailto:you@example.com` | Required by the Web Push spec |
| `NEXT_PUBLIC_UPI_PAYEE_VPA` | your UPI ID | Powers prefilled payment links |
| `NEXT_PUBLIC_UPI_PAYEE_NAME` | display name | Shown in the payer's app |
| `CRON_SECRET` | random string | Optional — only for manually triggering a sweep |

To read your local values:

```bash
grep -E "VAPID|QSTASH|AUTH_SECRET|UPI|CRON_SECRET" .env.local
```

> **`NEXT_PUBLIC_APP_URL` must be the deployed URL.** QStash calls back to it,
> and it's baked into the share links Deep pastes into WhatsApp. Vercel assigns
> the domain on first deploy — set the variable, then redeploy.

---

## 3. Run the migrations

From your machine, once `DATABASE_URL` points at the production database:

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
curl https://<your-app>.vercel.app/api/health

# The QStash callback rejects unsigned requests
curl -X POST -o /dev/null -w "%{http_code}\n" \
  https://<your-app>.vercel.app/api/qstash/close-day        # expect 403
```

Then in the browser: sign in, publish a menu **for today or tomorrow**, and
confirm the day got a scheduled job:

```bash
npm run check:cron
```

Finally, place an order, close the day early, and check the provider counts.

---

## 6. Notifications — test on a real phone

This is the only part that can't be verified from a terminal, and the part most
likely to fail quietly.

**iPhone — the home-screen step is mandatory.** Safari does not expose the push
API in a normal tab at all.

1. Open the site in Safari → **Share** → **Add to Home Screen**
2. Open Tiffine **from the home screen** (not the tab)
3. Settings → **Turn on notifications** → **Send a test**
4. **Send 4+ tests in a row.** iOS cancels a subscription after 3 pushes that
   fail to display a notification. The service worker is written to avoid this,
   but only a real device proves it.

**Android:** enable notifications, background the app, then send a test.
Xiaomi/Samsung/Oppo battery managers can kill service workers — if delivery is
unreliable, whitelist the app from battery optimisation.

---

## How deadline closing works

Publishing a menu schedules **one QStash callback** for that day's exact
deadline. Closing early cancels it; a re-poll reschedules it for the new round.

The callback (`/api/qstash/close-day`) verifies QStash's signature — the URL is
public, so without that anyone could close a poll early — and is idempotent,
because QStash delivers at-least-once and retries failures.

**QStash free-tier limits:** 1,000 messages/day (this app uses 1–2) and a
**7-day maximum delay**. Publishing more than 7 days ahead logs a warning and
skips scheduling; ordering still closes correctly because the deadline is
enforced on read, just without the automatic status change.

`/api/cron/sweep-deadlines` remains as a manual fallback — it closes anything
overdue — but nothing needs to call it on a schedule:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-app>.vercel.app/api/cron/sweep-deadlines
```

---

## Known free-tier trade-offs

**Neon suspends compute after inactivity** and resumes on the next query (a
second or two on the first request after a quiet spell).

**Vercel Hobby is for non-commercial use.** Fine for an office lunch group;
worth re-reading their terms if that ever changes.

---

## Deploying somewhere else

Nothing here is Vercel-specific — it's a standard Next.js server
(`npm run build` → `npm run start`). QStash calls back over HTTPS, so any host
works as long as `NEXT_PUBLIC_APP_URL` points at it and the URL is publicly
reachable. QStash cannot reach `localhost`; the scheduler detects that and skips
scheduling in local development.
