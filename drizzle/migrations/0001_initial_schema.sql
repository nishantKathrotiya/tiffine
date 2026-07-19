-- Tiffine — initial schema
--
-- Conventions:
--   * All money is integer paise (bigint). No numeric/float anywhere.
--   * A "date_key" is an IST calendar day stored as a date. The application
--     derives it via lib/time.ts; the DB never infers it from now().
--   * Timestamps are timestamptz (UTC instants).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- People
--
-- Sign-up is email + password. There is no email OTP: admin approval is the
-- gate instead, which is a stronger check for this group because Deep knows all
-- 15 people personally.
-- ---------------------------------------------------------------------------

-- pending  — signed up, awaiting approval. Read-only.
-- approved — full access: may place and edit orders.
-- inactive — access revoked but history preserved. Read-only.
-- rejected — cannot sign in at all.
create type account_status as enum ('pending', 'approved', 'inactive', 'rejected');

create table people (
  id              uuid primary key default gen_random_uuid(),
  email           text           not null,
  -- bcrypt hash. Null only for people seeded by an admin who have not yet set
  -- a password (they complete signup with the same email to claim the row).
  password_hash   text,
  name            text           not null,
  account_status  account_status not null default 'pending',

  -- Operational admin: approve users, publish menus, run settlements, and
  -- promote others. Cannot demote.
  is_admin        boolean     not null default false,
  -- Deep. May additionally demote admins. Deliberately not editable through
  -- the UI so the group cannot lock itself out of admin access.
  is_super_admin  boolean     not null default false,

  approved_by     uuid references people (id) on delete set null,
  approved_at     timestamptz,

  -- Set when an admin merges this person into another. Merged people keep
  -- their row so historical orders stay referentially intact.
  merged_into_id  uuid references people (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint people_email_lowercase check (email = lower(email)),
  constraint people_not_merged_into_self check (merged_into_id is null or merged_into_id <> id),
  -- A super-admin is always an admin, so permission checks never have to test
  -- both flags and cannot disagree.
  constraint people_super_admin_is_admin check (not is_super_admin or is_admin),
  -- An approved account must record who approved it, for the audit trail.
  constraint people_approved_has_approver
    check (account_status <> 'approved' or approved_at is not null)
);

-- Email identifies a person. Self-typed, so the approval queue is what catches
-- typo'd duplicates before they reach a settlement.
create unique index people_email_key on people (lower(email));
create index people_merged_into_idx on people (merged_into_id) where merged_into_id is not null;
create index people_status_idx on people (account_status);
-- At most one super-admin, enforced by the database rather than by convention.
create unique index people_single_super_admin on people ((true)) where is_super_admin;

-- ---------------------------------------------------------------------------
-- Menu days
-- ---------------------------------------------------------------------------

create type menu_day_status as enum (
  'draft', 'published', 'locked', 'sent_to_provider', 'settled'
);

create table menu_days (
  id              uuid primary key default gen_random_uuid(),
  date_key        date            not null unique,
  status          menu_day_status not null default 'draft',
  -- Per-day deadline, not a fixed cron time: the provider sometimes needs
  -- counts early and the group is sometimes late.
  deadline_at     timestamptz,
  locked_at       timestamptz,
  sent_at         timestamptz,
  raw_menu_text   text,
  created_by      uuid references people (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A published day must have a deadline; without one nothing would ever lock.
  constraint menu_days_published_needs_deadline
    check (status = 'draft' or deadline_at is not null)
);

create index menu_days_status_deadline_idx on menu_days (status, deadline_at);

-- ---------------------------------------------------------------------------
-- Order rounds
--
-- Round 1 is the normal poll. Round 2+ happen when the provider comes back
-- after counts were sent ("out of paneer"). Rounds are history; they never
-- multiply what a person is billed.
-- ---------------------------------------------------------------------------

create table order_rounds (
  id            uuid primary key default gen_random_uuid(),
  menu_day_id   uuid not null references menu_days (id) on delete cascade,
  round_number  int  not null,
  reason        text,
  deadline_at   timestamptz not null,
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  created_by    uuid references people (id) on delete set null,

  unique (menu_day_id, round_number),
  constraint order_rounds_number_positive check (round_number >= 1)
);

create index order_rounds_day_idx on order_rounds (menu_day_id);

-- ---------------------------------------------------------------------------
-- Menu items
-- ---------------------------------------------------------------------------

create table menu_items (
  id                uuid   primary key default gen_random_uuid(),
  menu_day_id       uuid   not null references menu_days (id) on delete cascade,
  order_round_id    uuid   not null references order_rounds (id) on delete cascade,
  name              text   not null,
  -- Normalized name, used to collapse "Roti"/"roti"/"Chapati/Roti" into one
  -- item across a period so statements don't fragment.
  normalized_name   text   not null,
  unit_price_paise  bigint not null,
  is_available      boolean not null default true,
  sort_order        int    not null default 0,
  created_at        timestamptz not null default now(),

  constraint menu_items_price_non_negative check (unit_price_paise >= 0),
  constraint menu_items_name_not_blank check (length(trim(name)) > 0)
);

create index menu_items_round_idx on menu_items (order_round_id);
create index menu_items_normalized_idx on menu_items (normalized_name);

-- ---------------------------------------------------------------------------
-- Orders — the effective order
--
-- Exactly one row per (day, person). This is THE guarantee against the
-- paneer-then-dal double-billing bug: it is structurally impossible for a
-- person to hold two orders on one day, rather than merely discouraged.
-- ---------------------------------------------------------------------------

create type order_status as enum ('active', 'cancelled');

create table orders (
  id                uuid         primary key default gen_random_uuid(),
  menu_day_id       uuid         not null references menu_days (id) on delete cascade,
  person_id         uuid         not null references people (id) on delete restrict,
  current_round_id  uuid         not null references order_rounds (id) on delete restrict,
  status            order_status not null default 'active',
  cancelled_at      timestamptz,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),

  unique (menu_day_id, person_id)
);

create index orders_day_idx on orders (menu_day_id);
create index orders_person_idx on orders (person_id);

create table order_lines (
  id                          uuid   primary key default gen_random_uuid(),
  order_id                    uuid   not null references orders (id) on delete cascade,
  menu_item_id                uuid   not null references menu_items (id) on delete restrict,
  quantity                    int    not null,
  -- Frozen at order time. Settlement reads this, never the live menu price, so
  -- a mid-period price change cannot silently re-bill past days.
  unit_price_paise_snapshot   bigint not null,
  item_name_snapshot          text   not null,

  unique (order_id, menu_item_id),
  constraint order_lines_quantity_positive check (quantity > 0 and quantity <= 20),
  constraint order_lines_price_non_negative check (unit_price_paise_snapshot >= 0)
);

create index order_lines_order_idx on order_lines (order_id);

-- Append-only history. Lets Deep see paneer -> dal without either affecting
-- the bill.
create table order_revisions (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders (id) on delete cascade,
  order_round_id  uuid references order_rounds (id) on delete set null,
  -- Snapshot of the lines as they were before this revision replaced them.
  lines           jsonb not null,
  total_paise     bigint not null,
  changed_by      uuid references people (id) on delete set null,
  change_reason   text,
  created_at      timestamptz not null default now()
);

create index order_revisions_order_idx on order_revisions (order_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Cancellation requests
--
-- Before the deadline a person edits or clears their own order — no request.
-- After the deadline they must ask: approved means no tiffin and no charge,
-- rejected means the tiffin is delivered and billed.
-- ---------------------------------------------------------------------------

create type cancellation_status as enum ('pending', 'approved', 'rejected');

create table cancellation_requests (
  id            uuid                primary key default gen_random_uuid(),
  order_id      uuid                not null references orders (id) on delete cascade,
  person_id     uuid                not null references people (id) on delete restrict,
  reason        text,
  status        cancellation_status not null default 'pending',
  decided_by    uuid references people (id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),

  constraint cancellation_decided_consistently
    check ((status = 'pending') = (decided_at is null))
);

-- At most one open request per order.
create unique index cancellation_one_pending_per_order
  on cancellation_requests (order_id) where status = 'pending';
create index cancellation_status_idx on cancellation_requests (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Settlement
-- ---------------------------------------------------------------------------

create type settlement_status as enum ('preview', 'committed', 'voided');
create type payment_status    as enum ('pending', 'paid', 'waived');

create table settlement_runs (
  id                  uuid              primary key default gen_random_uuid(),
  period_start        date              not null,
  period_end          date              not null,
  status              settlement_status not null default 'preview',
  total_paise         bigint            not null default 0,
  -- What the provider actually invoiced. Compared against total_paise so a
  -- mismatch surfaces before money is collected, not after.
  provider_bill_paise bigint,
  notes               text,
  generated_by        uuid references people (id) on delete set null,
  generated_at        timestamptz not null default now(),
  committed_at        timestamptz,

  constraint settlement_period_ordered check (period_end >= period_start),
  constraint settlement_total_non_negative check (total_paise >= 0)
);

create index settlement_runs_period_idx on settlement_runs (period_start, period_end);

create table settlement_lines (
  id                 uuid           primary key default gen_random_uuid(),
  settlement_run_id  uuid           not null references settlement_runs (id) on delete cascade,
  person_id          uuid           not null references people (id) on delete restrict,
  total_paise        bigint         not null,
  payment_status     payment_status not null default 'pending',
  paid_at            timestamptz,
  marked_by          uuid references people (id) on delete set null,

  unique (settlement_run_id, person_id),
  constraint settlement_lines_total_non_negative check (total_paise >= 0)
);

create index settlement_lines_person_idx on settlement_lines (person_id);
create index settlement_lines_unpaid_idx
  on settlement_lines (payment_status) where payment_status = 'pending';

-- The overlap guard. A day may belong to at most one committed run, so a day
-- cannot be billed twice; querying the gaps also reveals days never billed.
create table settled_days (
  settlement_run_id uuid not null references settlement_runs (id) on delete cascade,
  menu_day_id       uuid not null references menu_days (id) on delete restrict,
  primary key (settlement_run_id, menu_day_id)
);

create unique index settled_days_one_run_per_day on settled_days (menu_day_id);

-- ---------------------------------------------------------------------------
-- Push subscriptions
-- ---------------------------------------------------------------------------

create table push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references people (id) on delete cascade,
  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,
  user_agent     text,
  is_active      boolean not null default true,
  -- iOS silently invalidates subscriptions; the sender deactivates on 410/404
  -- rather than deleting, so we can tell "never subscribed" from "expired".
  last_failed_at timestamptz,
  created_at     timestamptz not null default now()
);

create index push_subscriptions_person_idx on push_subscriptions (person_id) where is_active;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references people (id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log (entity_type, entity_id, created_at desc);
create index audit_log_created_idx on audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger people_updated_at     before update on people     for each row execute function set_updated_at();
create trigger menu_days_updated_at  before update on menu_days  for each row execute function set_updated_at();
create trigger orders_updated_at     before update on orders     for each row execute function set_updated_at();
