-- ═══════════════════════════════════════════════════════════════════════════
-- Retries: a question stays open until the player's first correct answer or
-- its deadline. `responses` keeps one row per served question (the outcome);
-- every distinct thing the player typed is logged in `attempts`.
--
-- responses.match after this migration:
--   null          the question is open
--   exact / fuzzy the first correct answer (counted in rarity stats)
--   timeout       no correct answer before the deadline (score 0)
--   none          closed by an answer that is no longer accepted (a variant
--                 was removed after the fact), or a pre-retry wrong answer
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.responses
  add column attempts smallint not null default 0 check (attempts between 0 and 25),
  add column last_attempt_at timestamptz;

comment on column public.responses.attempts is 'Distinct answers submitted (duplicates after normalization are not counted).';

create table public.attempts (
  id          bigint generated always as identity primary key,
  response_id uuid not null references public.responses (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  raw_text    text not null check (char_length(raw_text) <= 200),
  norm_text   text not null check (char_length(norm_text) <= 200),
  -- Kept current by re-matching (retroactive acceptance). none = unmatched.
  answer_id   uuid references public.answers (id) on delete set null,
  match       public.match_kind not null default 'none' check (match in ('exact', 'fuzzy', 'none')),
  created_at  timestamptz not null default now(),
  -- The same spelling twice in one question is one attempt.
  constraint attempts_one_per_spelling unique (response_id, norm_text)
);
create index attempts_question_idx on public.attempts (question_id);
create index attempts_unmatched_idx on public.attempts (created_at) where match = 'none';

-- Answers given before retries existed become attempts, so re-matching only
-- ever has to look at one table.
insert into public.attempts (response_id, question_id, raw_text, norm_text, answer_id, match, created_at)
select id, question_id, raw_text, coalesce(norm_text, ''), answer_id,
  case when match in ('exact', 'fuzzy') then match else 'none'::public.match_kind end, answered_at
from public.responses
where raw_text is not null and answered_at is not null
on conflict do nothing;

update public.responses set attempts = 1, last_attempt_at = answered_at
where raw_text is not null and answered_at is not null;

-- Never readable or writable through the public API (see 20261123000002_rls.sql).
alter table public.attempts enable row level security;
revoke all on public.attempts from anon, authenticated;
