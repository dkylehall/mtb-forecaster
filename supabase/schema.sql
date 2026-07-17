-- Saved riding areas, one row per pin per user.
--
-- Run this in the Supabase SQL editor before wiring the client. RLS must be on
-- BEFORE any real data lands: the anon key ships in the browser bundle and is
-- public by design, so these policies are the only thing separating one user's
-- areas from everyone else's.

create table if not exists public.areas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  region     text not null default '',
  lat        double precision not null,
  lon        double precision not null,
  drainage   text not null default 'medium'
               check (drainage in ('fast', 'medium', 'slow')),
  created_at timestamptz not null default now(),

  -- Backstop against exact re-pins of the same spot. Note this is NOT the same
  -- rule the client uses: areas.js treats anything within ~0.003° (~1,000 ft) as
  -- the same area, which Postgres can't express in a unique constraint. The
  -- client stays the real dedupe; this only catches identical coordinates.
  unique (user_id, lat, lon)
);

alter table public.areas enable row level security;

-- Four separate policies rather than one `for all`: a write path that forgets
-- `with check` would let a user insert rows owned by someone else, so the read
-- rule and the write rule are worth stating apart.

create policy "areas are selectable by their owner"
  on public.areas for select
  using (auth.uid() = user_id);

create policy "areas are insertable by their owner"
  on public.areas for insert
  with check (auth.uid() = user_id);

create policy "areas are updatable by their owner"
  on public.areas for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "areas are deletable by their owner"
  on public.areas for delete
  using (auth.uid() = user_id);

create index if not exists areas_user_id_idx on public.areas (user_id);

-- Scoring preferences: one row per user, the whole settings bag as jsonb. See
-- src/lib/prefs.js for why this is one opaque blob rather than a column per
-- setting (preferences have no natural cross-device merge, so they sync
-- last-writer-wins as a unit).

create table if not exists public.prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  blob       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.prefs enable row level security;

create policy "prefs are selectable by their owner"
  on public.prefs for select
  using (auth.uid() = user_id);

create policy "prefs are insertable by their owner"
  on public.prefs for insert
  with check (auth.uid() = user_id);

create policy "prefs are updatable by their owner"
  on public.prefs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "prefs are deletable by their owner"
  on public.prefs for delete
  using (auth.uid() = user_id);
