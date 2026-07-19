-- Auth.js session storage.
--
-- Sessions live in the database rather than only in a JWT so that an admin
-- deactivating or rejecting an account takes effect immediately. With a
-- stateless JWT the user would keep full access until their token expired,
-- which would let a deactivated person keep ordering.

create table sessions (
  id             uuid primary key default gen_random_uuid(),
  -- Opaque random token stored in the cookie; hashed at rest so a database
  -- leak does not hand over live sessions.
  session_token  text        not null unique,
  person_id      uuid        not null references people (id) on delete cascade,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz not null default now(),
  user_agent     text,
  ip_hash        text
);

create index sessions_person_idx on sessions (person_id);
create index sessions_expires_idx on sessions (expires_at);

-- Rate limiting for sign-in attempts. Without this, a 15-person app with
-- self-chosen passwords is trivially brute-forceable.
create table auth_attempts (
  id           uuid primary key default gen_random_uuid(),
  email        text        not null,
  ip_hash      text,
  succeeded    boolean     not null,
  attempted_at timestamptz not null default now()
);

create index auth_attempts_email_idx on auth_attempts (lower(email), attempted_at desc);
create index auth_attempts_ip_idx on auth_attempts (ip_hash, attempted_at desc);
