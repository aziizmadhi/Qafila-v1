# قافلة — design record

This file records the decisions approved before implementation. Change it when a decision changes.

## Approved decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Rarity denominator | **All daily responses** to the question, including wrong answers and timeouts. `seed_frequency` = the share of *all* players expected to give that answer (how widely known it is). Per question the seed frequencies must sum to ≤ 1. Live data takes over linearly: weight = min(1, responses / 200). |
| D2 | When a score is final | **Provisional** at answer time (the camel moves immediately), **final at midnight Asia/Riyadh** (cron + lazy finalize on read). Retroactive acceptance recomputes the whole question. |
| D3 | Normalizer extras | ڤ ڥ→ف, ڨ ڧ ٯ→ق, گ ڭ→ك, پ→ب, چ→ج, ژ→ز, ھ ە ۀ ہ→ه; strip zero-width/bidi marks; strip Latin accents; punctuation/hyphens → space; word-final ء after ا dropped; ال/و stripped **per word** (min 2 letters remain). Also: "عبد" + "ال…" are joined (عبد العزيز ≡ عبدالعزيز). |
| D4 | Numerals | Western digits (0–9) everywhere in the UI. |
| D5 | Account conflict | Anonymous runs are merged into the existing account; if both played the same daily journey, the account's run is kept. |
| D6 | Share card | Text only (Web Share API + clipboard), with an RLM mark so the emoji row reads right-to-left. |
| D7 | Retries | A question stays open until the player's **first correct answer** or the deadline (30 s + 2 s grace, enforced on the server). Wrong answers shake the waterskin and are logged; the same answer again (after normalization) is not counted. At most one attempt per 400 ms and 25 distinct attempts per question. No time penalty for wrong answers. Only the first correct answer is the response and enters the rarity stats; the denominator is unchanged (every daily player who reached the question). |
| D8 | Pacing | **Chained clocks, no pauses.** "انطلق" starts question 1 and returns all seven question texts (never answers). Each next question starts 3 s after the previous one ends (its first correct answer, or its displayed deadline); the server derives this from time alone, so moving on needs no request. Leaving mid-journey lets the remaining clocks run out: those questions are timeouts and count in the denominator like any other. |
| D9 | Answer suggestions | Up to 4 names under the input after 2 characters, matched on prefixes with the answer normalizer and ordered by match quality, then alphabetically (never by popularity). The pool is **per category**: every canonical answer of every question in that category plus extra vocabulary, so it mixes right and wrong names and never depends on the current question. Only names are sent: no variants, no question link, no correctness flag, no frequency. Matching on variants is left for later. |

## Smaller defaults

- **Unlimited**: any past journey, any number of times, scored against that journey's stats; never touches stats, streak or best distance.
- **Abandoned journeys** run out on the server clock (D8): any request about the run, or the nightly finalize, closes questions whose time is up. A journey that was never begun can be started the same day (plus a 15-minute grace after midnight).
- **Import** confirms after the dry-run diff (`--yes` skips the prompt). Removing an answer that responses already matched needs `--allow-removals`.
- **Dev clock**: `QAFILA_FAKE_TODAY=YYYY-MM-DD` (ignored in production).
- **Unmatched log** is the `attempts` table (every distinct wrong attempt, kept matched against the current answers by re-matching), exported by `npm run export-unmatched`. Retroactive acceptance walks each player's attempts in order: the earliest one that now matches becomes their answer.
- **Tier thresholds** live in `src/lib/tiers.ts`.
- **Dunes emoji** in the share text is 🐪, not 🏜️: most platforms draw 🏜️ with a cactus, which doesn't belong in an Arabian desert. In-app tier icons are pixel art.
- **Suggestion pools** include canonicals of every imported question in the category, future days too. Comparing the pool before and after an import shows which names were added; importing several days at a time and adding vocabulary dilutes this.
- **Sprites** marked `"custom": true` in the manifest are never overwritten by `npm run sprites`.

## Tier bands (tuned on the seed)

Because every player is in the denominator (D1), correct answers score high: on the seed the most common answer to a question scores 65–94 km (median 82), and a typical correct answer about 91.

| Tier | Answer score | Share of correct seed answers | Journey total |
|---|---|---|---|
| ⛺ المخيم | 10–79 | ~11% | 0–349 |
| 🐪 الكثبان | 80–89 | ~23% | 350–479 |
| 🌫️ السراب | 90–95 | ~34% | 480–569 |
| 🌴 الواحة | 96–98 | ~22% | 570–639 |
| 🌟 نجم الصحراء | 99–100 | ~10% | 640–700 |

A typical journey, with misses included, is about 520 km. Re-tune once live data exists: real players concentrate on the top answers more than seeds assume.

## Scoring

```
w      = min(1, live_total / 200)
share  = w * (live_count / live_total) + (1 - w) * seed_frequency
score  = correct ? max(10, round(100 * (1 - share))) : 0
```

`live_total` counts every daily response to the question (one per player: their first correct answer, or a timeout). `live_count` counts daily responses whose first correct answer was that canonical. Wrong attempts and Unlimited responses are never counted.

## Answer secrecy and timing

- The client never reads content tables. All seven question texts and categories are released by `POST /api/runs/:id/begin`, which starts question 1's clock; nothing about answers is sent.
- Accepted answers are only sent by `GET /api/runs/:id/results`, which refuses unfinished runs.
- An answer later than `served_at + 32 s` (30 s + 2 s network grace) counts as a timeout. A question can't be answered more than 1.5 s before its clock starts (clock skew).
- Timing lives in `src/lib/timing.ts` (browser and server) and in the SQL functions; the DB tests check they agree.

## The answer hot path

`POST /api/runs/:id/answer` makes **one database round trip**: the server normalizes the answer (TypeScript), then a single call to `game.submit()` (a PL/pgSQL function in the private `game` schema) applies the per-IP limit, catches up the chained clock, enforces the deadline and the retry limits, matches (exact key, then the one-edit fallback via `fuzzystrmatch`), logs the attempt, updates the rarity counters and the run, opens the next question, and returns the result.

- Matching and scoring exist in SQL (hot path) and TypeScript (re-matching, rescoring, tests). `tests/db/parity.test.ts` runs every seed key plus thousands of one- and two-edit variations through both and requires identical results.
- Parameters are sent with explicit types: with `prepare: false` (needed for Supabase's transaction pooler), postgres.js otherwise spends an extra round trip describing every parameterized query.
- The `game` schema isn't exposed by the Data API and its functions aren't executable by `anon`/`authenticated`.

Measured with `npm run bench:submit` (server time for the database work of one answer, Postgres behind a proxy that adds a fixed round-trip time):

| Added RTT | Before (22 round trips) | After (1 round trip) |
|---|---|---|
| 0 ms | 3.9 ms | 2.0 ms |
| 2 ms (same region) | 62 ms | 4.6 ms |
| 150 ms (Washington ↔ Tokyo) | 3,337 ms | 154 ms |
