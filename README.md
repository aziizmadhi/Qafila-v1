# قافلة · Qafila

A daily Arabic trivia game. Seven open questions a day, 30 seconds each. A correct answer moves your camel caravan across the desert, and the rarer it is among all players, the further it goes.

<p align="center">
  <img src="docs/screenshots/question.png" width="260" alt="A question at midday with the waterskin timer">
  <img src="docs/screenshots/journey.png" width="260" alt="The caravan running after a rare answer at dawn">
</p>

- **Pan-Arab, RTL, Arabic only.** Questions are in simple MSA. Answers match in any regional spelling (Gulf, Levant, Egypt, Iraq, Maghreb), in Latin script, or with one typo.
- **Rarity scoring**: `score = max(10, round(100 × (1 − share)))` km per correct answer, 0 for a wrong one. The share is out of *all* players, blended with an editorial estimate until 200 people have answered.
- **Animated pixel art** (PixiJS): parallax desert, the sun crossing the sky over the seven questions, a night camp for the results.
- **Play instantly** as a guest; add an email (magic link) to keep your streak across devices.
- No ads, no payments, no trackers. Installable PWA.

Design decisions are recorded in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## Contents

1. [Stack and layout](#stack-and-layout)
2. [Local setup](#local-setup)
3. [Tests](#tests)
4. [Deployment](#deployment)
5. [Content workflow](#content-workflow)
6. [Replacing sprites](#replacing-sprites)
7. [How it works](#how-it-works)

## Stack and layout

Next.js 16 (App Router, TypeScript) · Tailwind 4 · PixiJS 8 · Supabase (Postgres, Auth, RLS) · Vercel.

```
src/
  app/                 pages (home, play, results, unlimited, profile, privacy) + API routes
    api/runs/…         start/resume, serve next question, answer, results
    api/cron/finalize  nightly: makes the day's scores final
    auth/confirm       magic-link landing (+ guest → account merge)
  components/          RTL UI: GameScreen, ResultsView, Waterskin, RouteStrip, …
  game/
    bridge.ts          the only API the UI uses to drive the scene
    sprites.ts         reads public/sprites/manifest.json
    engine/            PixiJS scene (art-resolution rendering, parallax, tier FX)
  lib/                 pure + unit-tested: normalize/, matching/, scoring, tiers, time, share
  server/              server-only: db, content import, scoring/recompute, game service
scripts/               import, export-unmatched, rescore, finalize, sprites/ (art generator)
supabase/migrations/   schema + RLS
content/               Sheets template, content guide, 14-day seed CSV
public/sprites/        generated PNG strips + manifest.json
tests/db/              integration tests against a real Postgres
```

## Local setup

Requirements: Node 22.12+, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```bash
npm install
supabase start                       # Postgres, Auth, Mailpit (emails) on localhost
supabase db reset                    # applies supabase/migrations
cp .env.example .env.local           # then fill in the values `supabase status` prints:
                                     #   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
                                     #   DATABASE_URL (port 54322)
npm run import -- content/seed/seed_14_days.csv --yes
echo "QAFILA_FAKE_TODAY=2026-11-23" >> .env.local   # play a seeded day (dev only)
npm run dev                          # http://localhost:3000
```

- `supabase/config.toml` already enables anonymous sign-ins and allows `/auth/confirm` as a redirect.
- Magic-link emails appear in Mailpit at http://localhost:54324.
- `QAFILA_FAKE_TODAY` pins "today" to any `YYYY-MM-DD` and is ignored in production. Days before it appear in Unlimited.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | unit tests (normalizer, matcher, scoring, CSV validation, …) |
| `npm run test:db` | integration tests: migrations, RLS, import, game flow, merge |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run import -- file.csv` | validate → dry-run diff → confirm → upsert (+ retroactive rescoring) |
| `npm run import-vocabulary -- file.csv` | add extra names to the answer-suggestion pools (`category,name`) |
| `npm run export-unmatched -- --since=YYYY-MM-DD` | unmatched answers by frequency, as CSV |
| `npm run rescore -- --date=… \| --all [--renormalize]` | re-match and rescore stored responses |
| `npm run finalize` | make finished days final (the nightly cron does this) |
| `npm run sprites` | regenerate placeholder art + manifest + PWA icons |
| `npm run bench:submit` | time the answer endpoint's database work through an added-latency proxy |

## Tests

```bash
npm test             # 140+ unit tests, no services needed
npm run test:db      # needs a Postgres you can create databases on
```

`test:db` creates a throwaway database for each test file. It stubs the bits of Supabase it needs (`auth.users`, `auth.uid()`, the `anon`/`authenticated` roles) and applies the real migrations. Point it at any server with `TEST_DATABASE_URL`. The default is `postgres://postgres@127.0.0.1:55432/postgres`. Against the Supabase CLI database:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
```

The normalizer tests include 79 real spelling variations from different regions.

## Deployment

### 1. Supabase

1. Create a project and link it: `supabase link --project-ref <ref>`.
2. Apply the schema: `supabase db push`.
3. In **Authentication → Sign In / Providers**:
   - enable **Anonymous sign-ins**;
   - keep **Email** enabled with **Confirm email** on.
4. In **Authentication → URL Configuration**:
   - set **Site URL** to your domain;
   - add `https://<your-domain>/auth/confirm` to the redirect URLs.
5. Configure **custom SMTP** for production emails. The built-in sender is heavily rate limited.
6. Optional, for magic links that work on a *different* device than the one that requested them: edit the *Magic Link* and *Change Email Address* templates to link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/profile`
   (use `type=email_change` for the change-email template). `/auth/confirm` supports both this and the default `code` flow.
7. Under **Rate limits**, review the anonymous sign-ins per IP.
8. Recommended: in **Project Settings → JWT Keys**, switch to asymmetric signing keys. The server then verifies sessions locally (about 0.5 ms) instead of calling Supabase Auth on every request (about 50 ms measured against a local auth server; more over a network).

### 2. Vercel

1. Import the repository.
2. Set the environment variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain` (used in share text) |
| `DATABASE_URL` | the **transaction pooler** string (port 6543) |
| `CRON_SECRET` | a random string; Vercel Cron sends it to `/api/cron/finalize` |
| `RATE_LIMIT_SALT` | a random string (IP hashing) |

3. `vercel.json` runs every function in **Tokyo (`hnd1`)**, next to the Supabase database. If your database is elsewhere, change `regions` to the closest Vercel region. To confirm the region in use, open any answer request in the browser's network panel: its `Server-Timing` header ends with `region;desc="hnd1"` (also in the function logs, one JSON line per answer).
4. `vercel.json` schedules the finalize job at 21:20 UTC, which is 00:20 in Riyadh, just after the 15-minute grace period. Results pages also finalize past days lazily, so a missed cron run never blocks anything.

### 3. Content

Run the importer from your machine against production by setting `DATABASE_URL` to the **session pooler** or direct connection string:

```bash
DATABASE_URL=postgresql://… npm run import -- my-sheet.csv
```

## Content workflow

Questions live in Google Sheets: one row per accepted answer. Export CSV and run the importer. You get row-numbered errors and a dry-run diff before anything is written. Unmatched answers are exported for review, and newly added variants are applied retroactively: affected responses are re-matched, and scores and rarity are recomputed.

The full guide (column meanings, what normalization already covers, review loop) is in **[`content/README.md`](content/README.md)**. The template is `content/template/qafila_template.csv`.

## Replacing sprites

All art is in `public/sprites/` as **horizontal strip PNGs** described by `manifest.json`:

```json
"camel_rider_walk": {
  "file": "camel_rider_walk.png",
  "frameWidth": 48, "frameHeight": 48, "frames": 8, "fps": 10,
  "loop": true, "anchor": [0.5, 0.96]
}
```

To drop in real art:

1. In Aseprite, **File → Export Sprite Sheet**:
   - Layout: **Horizontal Strip**;
   - Output: PNG, no padding, no trim.
   - For several animations, export one file per tag.
2. Save it over the file of the same name in `public/sprites/`.
3. Edit its manifest entry if the frame size, frame count, fps or anchor changed, and add `"custom": true` so `npm run sprites` never overwrites it.

No code changes are needed. What the engine and UI expect:

| Sprite | Notes |
|---|---|
| `camel_{rider,pack}_{idle,walk,run,rest}` | facing **left** (the caravan travels right → left); anchor at the feet |
| `sky_gradient` | 8 frames, one per hour: 0 dawn … 6 dusk, 7 night. Tiled horizontally, stretched vertically |
| `dunes_far`, `dunes_near`, `ground` | tile horizontally; `parallax` sets their scroll speed |
| `waterskin`, `waterskin_mask` | the empty flask, and a same-size mask of the pixels water may fill (keep a 1-px leather wall inside the outline). The timer draws water row by row on the mask, so it never covers the outline |
| `route_marker` | frame 0 = miss, 1–5 = camp … desert star |
| `ui_panel`, `ui_button*` | 24×24 9-slice with 8-px corners (CSS `border-image`) |

The placeholder art is generated by `scripts/sprites/` from a 16-colour warm desert palette on a 32-px grid. The palette is stored in the manifest.

## How it works

**A day.** Each journey is 7 questions, the same for everyone, and resets at midnight Asia/Riyadh.

- "انطلق" starts question 1's clock and sends all seven question texts at once (never answers), so moving between questions needs no request.
- The clock is chained on the server: each question starts 3 seconds after the previous one ends (first correct answer, or time up). There's no pause, and refreshing doesn't reset anything. The server allows 2 seconds of network grace.
- Answers are normalized and matched on the server, exactly first, then with a single-edit fuzzy fallback.
- While typing, up to four suggestions appear from a per-category pool (every canonical answer in that category plus extra vocabulary), so a suggestion never gives the answer away.
- A wrong answer shakes the waterskin and the player can try again until the first correct answer or the end of the clock. Every wrong attempt is logged for review; repeating one doesn't count. The server allows one attempt per 400 ms and 25 per question.
- Accepted answers are only sent by the results endpoint, and it refuses runs that aren't finished.

**Scores.**
- An answer scores instantly so the camel can move, but the score is provisional.
- At midnight a finalize step recomputes the day against the final distribution.
- The live share blends linearly from your `seed_frequency` to real data, reaching 100% live at 200 responses per question.
- Unlimited replays of past days are scored against that day's stats and never change them.

**Tiers.** ⛺ المخيم → 🐪 الكثبان → 🌫️ السراب → 🌴 الواحة → 🌟 نجم الصحراء, per answer and per journey. The thresholds were tuned on the seed distribution; see [`docs/DESIGN.md`](docs/DESIGN.md).

**Security.**
- Every table has RLS. Content and stats tables have no policies and no grants for the API roles, so the public anon key can't read them.
- Players can read only their own runs and responses, and can't write anything directly.
- Rate limits run in Postgres: per user and per hashed IP.

**Performance.**
- An answer is one database round trip (`game.submit`, see [`docs/DESIGN.md`](docs/DESIGN.md#the-answer-hot-path)); functions run in the database's region.
- The canvas renders at art resolution (about 195×420 on a phone) and is upscaled by CSS at an integer factor, so the GPU fill cost is tiny.
- The ticker stops when the tab is hidden.
- `prefers-reduced-motion` turns off scrolling, particles, shimmer and falling stars; the caravan simply jumps ahead.

**Privacy.** There are no analytics or third-party scripts, and fonts are self-hosted by `next/font`. IP addresses are only used, salted and hashed, as rate-limit keys. See `/privacy`.
