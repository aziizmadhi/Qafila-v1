-- ═══════════════════════════════════════════════════════════════════════════
-- قافلة — core schema
--
-- Content (journeys → questions → answers/answer_keys) is written only by the
-- import CLI. Play data (runs → responses) is written only by the Next.js
-- server. Neither is ever read directly by the browser (see the RLS migration).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── helpers ────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ─── categories ─────────────────────────────────────────────────────────────
create table public.categories (
  slug    text primary key check (slug ~ '^[a-z][a-z0-9_]{1,30}$' and slug <> 'daily'),
  name_ar text not null,
  sort    smallint not null default 0
);

insert into public.categories (slug, name_ar, sort) values
  ('geography', 'جغرافيا',      1),
  ('history',   'تاريخ',        2),
  ('sports',    'رياضة',        3),
  ('food',      'طعام ومطبخ',   4),
  ('culture',   'ثقافة وفنون',  5),
  ('science',   'علوم',         6),
  ('nature',    'طبيعة',        7),
  ('language',  'لغة',          8);

-- ─── journeys ───────────────────────────────────────────────────────────────
-- One row per (date, track). v1 only uses track = 'daily' (mixed topics).
-- A per-category journey later is just another row with track = <category slug>.
create table public.journeys (
  id           uuid primary key default gen_random_uuid(),
  play_date    date not null,
  track        text not null default 'daily',
  finalized_at timestamptz,               -- set when the day's scores become final
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint journeys_track_valid check (track = 'daily' or track ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint journeys_date_track_key unique (play_date, track)
);
create index journeys_track_date_idx on public.journeys (track, play_date);
create trigger journeys_touch before update on public.journeys
  for each row execute function public.touch_updated_at();

-- ─── questions ──────────────────────────────────────────────────────────────
create table public.questions (
  id         uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  position   smallint not null check (position between 1 and 7),
  category   text not null references public.categories (slug),
  text       text not null check (char_length(text) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_journey_position_key unique (journey_id, position)
);
create index questions_category_idx on public.questions (category);
create trigger questions_touch before update on public.questions
  for each row execute function public.touch_updated_at();

-- ─── accepted answers ───────────────────────────────────────────────────────
create table public.answers (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions (id) on delete cascade,
  canonical      text not null check (char_length(canonical) between 1 and 200),
  canonical_key  text not null check (char_length(canonical_key) between 1 and 200),
  variants       text[] not null default '{}',
  -- Expected share of ALL players giving this answer (D1). Sum per question ≤ 1
  -- is enforced by the importer.
  seed_frequency numeric(6, 5) not null check (seed_frequency between 0 and 1),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint answers_question_canonical_key unique (question_id, canonical_key)
);
create trigger answers_touch before update on public.answers
  for each row execute function public.touch_updated_at();

-- Every normalized spelling (canonical + variants) of every accepted answer.
-- The primary key makes "one spelling → exactly one canonical" a DB guarantee.
create table public.answer_keys (
  question_id uuid not null references public.questions (id) on delete cascade,
  key         text not null,
  answer_id   uuid not null references public.answers (id) on delete cascade,
  primary key (question_id, key)
);
create index answer_keys_answer_idx on public.answer_keys (answer_id);

-- ─── players ────────────────────────────────────────────────────────────────
create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  merged_from uuid[] not null default '{}'
);

create type public.run_mode as enum ('daily', 'unlimited');
create type public.match_kind as enum ('exact', 'fuzzy', 'none', 'timeout');

-- One attempt at a journey. A player has at most one daily run per journey;
-- Unlimited runs are unrestricted.
create table public.runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  journey_id  uuid not null references public.journeys (id) on delete restrict,
  mode        public.run_mode not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  total_km    integer not null default 0 check (total_km between 0 and 700)
);
create unique index runs_one_daily_per_player on public.runs (user_id, journey_id) where mode = 'daily';
create index runs_user_started_idx on public.runs (user_id, started_at desc);
create index runs_journey_idx on public.runs (journey_id);

-- One row per served question. Created when the question is served (that is
-- when the server clock starts); completed on answer or timeout.
create table public.responses (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.runs (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  question_id      uuid not null references public.questions (id) on delete restrict,
  position         smallint not null check (position between 1 and 7),
  counts_for_stats boolean not null,       -- true only for daily runs
  served_at        timestamptz not null default now(),
  answered_at      timestamptz,
  raw_text         text check (char_length(raw_text) <= 200),
  norm_text        text check (char_length(norm_text) <= 200),
  answer_id        uuid references public.answers (id) on delete set null,
  match            public.match_kind,     -- null while the question is open
  score            smallint not null default 0 check (score between 0 and 100),
  constraint responses_run_position_key unique (run_id, position),
  constraint responses_answered_consistent check ((match is null) = (answered_at is null))
);
-- "One submission per player per question" for everything that counts toward rarity.
create unique index responses_one_daily_per_player on public.responses (user_id, question_id)
  where counts_for_stats;
create index responses_question_stats_idx on public.responses (question_id, answer_id) where counts_for_stats;
create index responses_question_idx on public.responses (question_id);
create index responses_unmatched_idx on public.responses (question_id, norm_text) where match = 'none';
create index responses_answered_at_idx on public.responses (answered_at) where match = 'none';

-- ─── live rarity counters (daily responses only) ───────────────────────────
create table public.question_stats (
  question_id uuid primary key references public.questions (id) on delete cascade,
  live_total  integer not null default 0 check (live_total >= 0)  -- correct + wrong + timeouts
);

create table public.answer_stats (
  answer_id   uuid primary key references public.answers (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  live_count  integer not null default 0 check (live_count >= 0)
);
create index answer_stats_question_idx on public.answer_stats (question_id);

-- ─── infrastructure ─────────────────────────────────────────────────────────
-- Fixed-window rate limiting without an external service.
create unlogged table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);

-- Short-lived proof that the browser holding this ticket owned an anonymous
-- account, used to merge its progress after signing in to an existing account.
create table public.merge_tickets (
  id           uuid primary key default gen_random_uuid(),
  anon_user_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '2 hours'
);

create table public.import_runs (
  id         bigint generated always as identity primary key,
  file_name  text not null,
  sha256     text not null,
  applied_at timestamptz not null default now(),
  summary    jsonb not null
);
