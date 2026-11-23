-- ═══════════════════════════════════════════════════════════════════════════
-- قافلة — the answer hot path in one database round trip.
--
-- game.submit() catches up the run's clock, enforces the deadline and the
-- retry limits, matches the (already normalized) answer, records it, updates
-- the rarity counters and the run, and returns the result as JSON.
--
-- Chained clocks: once a journey has begun, question n+1 starts
-- TRANSITION after question n ends (its first correct answer, or its
-- displayed deadline). Nothing waits for the client, so there is no pause
-- between questions and no request is needed to move on.
--
-- Timing (keep in sync with src/lib/timing.ts; the DB tests check both):
--   question 30 s · grace 2 s · transition 3 s · 400 ms between attempts ·
--   25 attempts per question · a question may be answered 1.5 s "early"
--   (client clock skew)
--
-- Everything lives in the private `game` schema: never exposed by the API,
-- and not executable by anon/authenticated. Only the server calls it.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create extension if not exists fuzzystrmatch with schema extensions;

create schema if not exists game;
revoke all on schema game from public;

-- ─── rarity score (mirrors src/lib/scoring.ts in float8, same operation order) ─
create or replace function game.score(p_seed float8, p_count int, p_total int)
returns int
language sql immutable
as $$
  with w as (
    select least(1::float8, greatest(0::float8, p_total::float8 / 200)) as w,
           case when p_total > 0
                then least(1::float8, greatest(0::float8, p_count::float8 / p_total::float8))
                else 0::float8 end as live
  ), s as (
    select least(1::float8, greatest(0::float8,
             w * live + (1 - w) * least(1::float8, greatest(0::float8, p_seed)))) as share
    from w
  )
  -- Math.round(x) for x ≥ 0 is floor(x + 0.5)
  select greatest(10, floor(100 * (1 - share) + 0.5)::int) from s
$$;

-- ─── matching (mirrors src/lib/matching: exact key, then ≤ 1 edit if unambiguous) ─
create or replace function game.match(p_question uuid, p_norm text)
returns table (answer_id uuid, kind public.match_kind)
language plpgsql stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if p_norm is null or p_norm = '' then
    return;
  end if;
  return query
    select k.answer_id, 'exact'::public.match_kind
    from public.answer_keys k where k.question_id = p_question and k.key = p_norm;
  if found then
    return;
  end if;
  if char_length(p_norm) < 5 or char_length(p_norm) > 250 then
    return;
  end if;
  select array_agg(distinct k.answer_id) into v_ids
  from public.answer_keys k
  where k.question_id = p_question
    and abs(char_length(k.key) - char_length(p_norm)) <= 1
    and levenshtein_less_equal(p_norm, k.key, 1) <= 1;
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    answer_id := v_ids[1];
    kind := 'fuzzy';
    return next;
  end if;
end $$;

-- ─── chained clock ──────────────────────────────────────────────────────────
-- Close every question whose deadline (+ grace) has passed as a timeout, open
-- the next one TRANSITION after the previous ended, and finish the run after
-- question 7. A run that hasn't begun (no responses) is left alone.
create or replace function game.catch_up(p_run uuid, p_now timestamptz)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_run  public.runs%rowtype;
  r      public.responses%rowtype;
  v_end  timestamptz;
begin
  -- Locked, so two concurrent catch-ups can't both close (and count) the same question.
  select * into v_run from public.runs where id = p_run for update;
  if not found then
    return;
  end if;
  loop
    select * into r from public.responses where run_id = p_run order by position desc limit 1;
    exit when not found;
    if r.match is null then
      exit when p_now <= r.served_at + interval '32 seconds';
      -- The clock ran out: 0 km, and the timeout counts in the denominator (D1).
      v_end := r.served_at + interval '30 seconds';
      update public.responses set match = 'timeout', answered_at = v_end, score = 0
      where id = r.id and match is null;
      if r.counts_for_stats then
        insert into public.question_stats (question_id, live_total) values (r.question_id, 1)
        on conflict (question_id) do update set live_total = public.question_stats.live_total + 1;
      end if;
    else
      v_end := least(r.answered_at, r.served_at + interval '30 seconds');
    end if;
    if r.position >= 7 then
      update public.runs set finished_at = coalesce(finished_at, v_end) where id = p_run;
      exit;
    end if;
    insert into public.responses (run_id, user_id, question_id, position, counts_for_stats, served_at)
    select p_run, v_run.user_id, q.id, r.position + 1, r.counts_for_stats, v_end + interval '3 seconds'
    from public.questions q
    where q.journey_id = v_run.journey_id and q.position = r.position + 1
    on conflict (run_id, position) do nothing;
    exit when not found; -- a journey with a missing question: nothing more to serve
  end loop;
end $$;

-- ─── one attempt ────────────────────────────────────────────────────────────
-- p_norm is normalized by the server (src/lib/normalize). Returns either
-- {"error": code} or the AnswerResult fields (without the tier).
create or replace function game.submit(
  p_user uuid,
  p_run uuid,
  p_position int,
  p_raw text,
  p_norm text,
  p_now timestamptz,
  p_ip_key text,
  p_ip_limit int
)
returns jsonb
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_run       public.runs%rowtype;
  v_resp      public.responses%rowtype;
  v_hits      int;
  v_answer    uuid;
  v_kind      public.match_kind;
  v_inserted  bigint;
  v_attempts  int;
  v_total     int;
  v_count     int;
  v_seed      float8;
  v_canonical text;
  v_score     int;
  v_finished  boolean;
  v_total_km  int;
  v_next      jsonb;
begin
  -- Per-IP limit, sharing the 60-second window used by every other endpoint.
  if p_ip_key is not null then
    insert into public.rate_limits (key, window_start, hits)
    values (p_ip_key, to_timestamp(floor(extract(epoch from now()) / 60) * 60), 1)
    on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
    returning hits into v_hits;
    if v_hits > p_ip_limit then
      return jsonb_build_object('error', 'rate_limited');
    end if;
  end if;

  select * into v_run from public.runs where id = p_run and user_id = p_user for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  perform game.catch_up(p_run, p_now);

  select * into v_resp from public.responses where run_id = p_run and position = p_position for update;
  if not found or v_resp.served_at > p_now + interval '1.5 seconds' then
    return jsonb_build_object('error', 'not_served');
  end if;

  select jsonb_build_object('position', n.position, 'servedAt', n.served_at) into v_next
  from public.responses n where n.run_id = p_run and n.position = p_position + 1;
  select total_km, finished_at is not null into v_total_km, v_finished from public.runs where id = p_run;

  if v_resp.match is not null then
    if v_resp.match = 'timeout' then
      return jsonb_build_object('position', p_position, 'correct', false, 'timedOut', true, 'score', 0,
        'matched', null, 'totalKm', v_total_km, 'finished', v_finished, 'next', v_next);
    end if;
    return jsonb_build_object('error', 'already_answered');
  end if;
  if v_resp.last_attempt_at is not null and p_now < v_resp.last_attempt_at + interval '400 milliseconds' then
    return jsonb_build_object('error', 'too_fast');
  end if;
  if v_resp.attempts >= 25 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;

  select m.answer_id, m.kind into v_answer, v_kind from game.match(v_resp.question_id, p_norm) m;

  if v_answer is null then
    -- Wrong: logged for review; the same spelling twice is one attempt.
    insert into public.attempts (response_id, question_id, raw_text, norm_text, created_at)
    values (v_resp.id, v_resp.question_id, p_raw, p_norm, p_now)
    on conflict (response_id, norm_text) do nothing
    returning id into v_inserted;
    v_attempts := v_resp.attempts + case when v_inserted is null then 0 else 1 end;
    update public.responses set attempts = v_attempts, last_attempt_at = p_now where id = v_resp.id;
    return jsonb_build_object('position', p_position, 'correct', false, 'timedOut', false,
      'duplicate', v_inserted is null, 'attemptsLeft', 25 - v_attempts, 'score', 0, 'matched', null,
      'totalKm', v_total_km, 'finished', false, 'next', null);
  end if;

  -- First correct answer: live counters (daily only), then the score.
  if v_resp.counts_for_stats then
    insert into public.question_stats (question_id, live_total) values (v_resp.question_id, 1)
    on conflict (question_id) do update set live_total = public.question_stats.live_total + 1
    returning live_total into v_total;
    insert into public.answer_stats (answer_id, question_id, live_count) values (v_answer, v_resp.question_id, 1)
    on conflict (answer_id) do update set live_count = public.answer_stats.live_count + 1
    returning live_count into v_count;
  else
    select coalesce((select live_total from public.question_stats where question_id = v_resp.question_id), 0),
           coalesce((select live_count from public.answer_stats where answer_id = v_answer), 0)
      into v_total, v_count;
  end if;
  select seed_frequency::float8, canonical into v_seed, v_canonical from public.answers where id = v_answer;
  v_score := game.score(v_seed, v_count, v_total);

  insert into public.attempts (response_id, question_id, raw_text, norm_text, answer_id, match, created_at)
  values (v_resp.id, v_resp.question_id, p_raw, p_norm, v_answer, v_kind, p_now)
  on conflict (response_id, norm_text) do update set answer_id = excluded.answer_id, match = excluded.match;
  update public.responses
  set answered_at = p_now, raw_text = p_raw, norm_text = p_norm, answer_id = v_answer, match = v_kind,
      score = v_score, attempts = least(attempts + 1, 25), last_attempt_at = p_now
  where id = v_resp.id;

  v_finished := p_position >= 7;
  if v_finished then
    v_next := null;
  else
    -- The next question's clock starts after the transition.
    insert into public.responses (run_id, user_id, question_id, position, counts_for_stats, served_at)
    select p_run, v_run.user_id, q.id, p_position + 1, v_resp.counts_for_stats,
      least(p_now, v_resp.served_at + interval '30 seconds') + interval '3 seconds'
    from public.questions q where q.journey_id = v_run.journey_id and q.position = p_position + 1
    on conflict (run_id, position) do nothing;
    select jsonb_build_object('position', n.position, 'servedAt', n.served_at) into v_next
    from public.responses n where n.run_id = p_run and n.position = p_position + 1;
  end if;
  update public.runs
  set total_km = total_km + v_score,
      finished_at = case when v_finished then coalesce(finished_at, p_now) else finished_at end
  where id = p_run
  returning total_km into v_total_km;

  return jsonb_build_object('position', p_position, 'correct', true, 'timedOut', false, 'score', v_score,
    'matched', v_canonical, 'totalKm', v_total_km, 'finished', v_finished, 'next', v_next);
end $$;

revoke all on all functions in schema game from public;
do $$ begin
  if exists (select from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema game from anon, authenticated';
    execute 'revoke all on schema game from anon, authenticated';
  end if;
end $$;
