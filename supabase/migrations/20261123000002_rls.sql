-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security
--
-- The browser holds the public anon key, so anything reachable through the
-- Supabase REST API must be locked down here. The game server and the CLI
-- connect with the database owner role and are not affected by RLS.
--
-- * Content, stats and infrastructure tables: RLS on, NO policies, and all
--   privileges revoked → invisible to `anon` and `authenticated`. This is what
--   guarantees accepted answers never reach a client before the server decides.
-- * runs / responses / profiles: a signed-in player (anonymous players are
--   `authenticated` too) may read their own rows only. No write policies:
--   every write goes through the server, which enforces timing and scoring.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.categories     enable row level security;
alter table public.journeys       enable row level security;
alter table public.questions      enable row level security;
alter table public.answers        enable row level security;
alter table public.answer_keys    enable row level security;
alter table public.question_stats enable row level security;
alter table public.answer_stats   enable row level security;
alter table public.rate_limits    enable row level security;
alter table public.merge_tickets  enable row level security;
alter table public.import_runs    enable row level security;
alter table public.profiles       enable row level security;
alter table public.runs           enable row level security;
alter table public.responses      enable row level security;

-- Belt and braces: remove the default grants Supabase gives API roles.
revoke all on table
  public.categories, public.journeys, public.questions, public.answers,
  public.answer_keys, public.question_stats, public.answer_stats,
  public.rate_limits, public.merge_tickets, public.import_runs,
  public.profiles, public.runs, public.responses
from anon, authenticated;

revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Own rows, read-only.
grant select on table public.profiles, public.runs, public.responses to authenticated;

create policy "profiles: players read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "runs: players read their own runs"
  on public.runs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "responses: players read their own responses"
  on public.responses for select to authenticated
  using ((select auth.uid()) = user_id);
