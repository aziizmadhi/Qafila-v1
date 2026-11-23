-- ═══════════════════════════════════════════════════════════════════════════
-- Answer suggestions. While typing, players see names from a per-category
-- pool: every canonical answer of every question in that category, plus the
-- extra words below. The pool never depends on the current question and mixes
-- right and wrong answers, so being suggested never means being correct.
-- Filled with `npm run import-vocabulary -- file.csv`.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.vocabulary (
  id         bigint generated always as identity primary key,
  category   text not null references public.categories (slug) on delete cascade,
  name       text not null check (char_length(name) between 1 and 200),
  -- normalizeAnswer(name): one entry per spelling per category
  name_key   text not null check (char_length(name_key) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint vocabulary_category_name_key unique (category, name_key)
);

-- Never readable or writable through the public API (see 20261123000002_rls.sql).
alter table public.vocabulary enable row level security;
revoke all on public.vocabulary from anon, authenticated;
