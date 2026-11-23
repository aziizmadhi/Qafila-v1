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

## Smaller defaults

- **Unlimited**: any past journey, any number of times, scored against that journey's stats; never touches stats, streak or best distance.
- **Abandoned questions** time out on the server clock (30 s + 2 s grace). Unserved questions can be resumed the same day (plus a 15-minute grace after midnight).
- **Import** confirms after the dry-run diff (`--yes` skips the prompt). Removing an answer that responses already matched needs `--allow-removals`.
- **Dev clock**: `QAFILA_FAKE_TODAY=YYYY-MM-DD` (ignored in production).
- **Unmatched log** is derived from `responses` (match = none) by `npm run export-unmatched`, so retroactive acceptance can never leave it out of sync.
- **Tier thresholds** live in `src/lib/tiers.ts`.

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

`live_total` counts every daily response to the question (correct, wrong and timeouts). `live_count` counts daily responses that matched the canonical. Unlimited responses are never counted.

## Answer secrecy and timing

- The client never reads content tables. Question text is released by `POST /api/runs/:id/next`, which stamps `served_at` once.
- Accepted answers are only sent by `GET /api/runs/:id/results`, which refuses unfinished runs.
- An answer later than `served_at + 32 s` counts as a timeout.
